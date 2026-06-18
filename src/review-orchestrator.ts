import * as crypto from 'crypto';
import { AIService } from './ai-services';
import { PullRequestAnalysisTarget, PullRequestContext } from './pr-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// What the model is asked to return, before validation/anchoring.
export interface RawFinding {
  file: string;
  line?: number;
  severity: string;
  title: string;
  body: string;
  // The exact text of the flagged line, used to make the fingerprint stable
  // across unrelated line-number shifts between runs.
  snippet?: string;
}

// A finding after severity normalization, anchor resolution and fingerprinting.
export interface ResolvedFinding {
  file: string;
  line?: number; // resolved right-file anchor; undefined => file-level thread
  severity: Severity;
  title: string;
  body: string;
  fingerprint: string;
}

export interface ReviewResult {
  summary: string;
  findings: ResolvedFinding[];
  suppressedCount: number; // findings dropped by the minSeverity filter
  degraded: boolean;       // true if some/all structured output couldn't be parsed
  error?: string;          // populated when the pipeline malfunctioned
}

export interface ReviewOptions {
  maxTokens: number;        // output token cap per call
  temperature: number;
  maxInputTokens: number;   // input budget that drives batching
  minSeverity: Severity;
  enableVerification: boolean;
  customInstructions?: string;
  codingStandards?: string;
  // If supplied, used instead of the built-in review instructions. JSON-format
  // rules are always appended regardless, so a template that dictates a
  // different output format will degrade to summary-only.
  promptTemplate?: string;
  // Optional sink for assembled prompts (debug). Called once per AI call.
  onPrompt?: (label: string, prompt: string) => void;
}

interface FileEntry {
  path: string;
  target: PullRequestAnalysisTarget;
}

// ---------------------------------------------------------------------------
// Severity helpers (pure)
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export function normalizeSeverity(value: string | undefined): Severity {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'critical' || v === 'blocker') return 'critical';
  if (v === 'high' || v === 'major' || v === 'error') return 'high';
  if (v === 'medium' || v === 'moderate' || v === 'warning' || v === 'warn') return 'medium';
  if (v === 'low' || v === 'minor') return 'low';
  if (v === 'info' || v === 'informational' || v === 'nit' || v === 'note') return 'info';
  // Unknown severities default to medium so they aren't silently filtered out.
  return 'medium';
}

export function severityRank(sev: Severity): number {
  return SEVERITY_ORDER.indexOf(sev);
}

export function meetsMinSeverity(sev: Severity, min: Severity): boolean {
  return severityRank(sev) >= severityRank(min);
}

// ---------------------------------------------------------------------------
// Token budget + batching (pure)
// ---------------------------------------------------------------------------

/** Cheap, provider-agnostic token estimate (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits file entries into batches whose combined size stays under
 * `fileTokenBudget`. A single file larger than the budget gets its own batch
 * (it will still be sent — truncation already happened upstream in pr-utils).
 * Pure and order-preserving so it is straightforward to unit test.
 */
export function batchEntries(entries: FileEntry[], fileTokenBudget: number): FileEntry[][] {
  const batches: FileEntry[][] = [];
  let current: FileEntry[] = [];
  let currentTokens = 0;

  for (const entry of entries) {
    const entryTokens = estimateTokens(renderFileBlock(entry));
    if (current.length > 0 && currentTokens + entryTokens > fileTokenBudget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(entry);
    currentTokens += entryTokens;
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

// ---------------------------------------------------------------------------
// Anchor resolution (pure)
// ---------------------------------------------------------------------------

/**
 * Resolves the model's cited line to a legitimate inline anchor.
 *  - No line cited            -> file-level (undefined)
 *  - No changedLines (full-file target) -> trust the cited line
 *  - Cited line is a changed line       -> use it
 *  - Within `snapWindow` of a changed line -> snap to the nearest one
 *  - Otherwise               -> file-level (undefined)
 */
export function resolveAnchor(
  line: number | undefined,
  changedLines: number[] | undefined,
  snapWindow = 5
): number | undefined {
  if (line === undefined || line === null || Number.isNaN(line)) {
    return undefined;
  }
  if (!changedLines || changedLines.length === 0) {
    return line; // full-file target: nothing to validate against
  }
  if (changedLines.includes(line)) {
    return line;
  }
  let nearest: number | undefined;
  let nearestDist = Infinity;
  for (const cl of changedLines) {
    const dist = Math.abs(cl - line);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = cl;
    }
  }
  if (nearest !== undefined && nearestDist <= snapWindow) {
    return nearest;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fingerprint (pure)
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Stable fingerprint for cross-run dedup. Deliberately excludes the line number
 * so a finding survives when unrelated edits shift it up or down a few lines.
 */
export function fingerprintFinding(file: string, severity: Severity, title: string, snippet?: string): string {
  const basis = [
    file ?? '',
    severity,
    normalizeText(title),
    normalizeText(snippet ?? '')
  ].join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// JSON parsing (pure, tolerant)
// ---------------------------------------------------------------------------

/**
 * Extracts a JSON object from a model response that may be wrapped in markdown
 * code fences or surrounded by prose. Returns null if no parseable object with
 * the expected shape is found.
 */
/**
 * Removes <think>...</think> reasoning blocks emitted by reasoning models
 * (qwen3, deepseek-r1, etc.). Their tokens routinely contain stray braces and
 * quotes that corrupt JSON extraction (issues #21/#25). Also drops a dangling
 * unclosed <think> whose reasoning ran to the end of the output.
 */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/**
 * Returns the first balanced {...} object span, ignoring braces that appear
 * inside JSON string literals. More robust than first-`{`/last-`}` when the
 * model wraps the object in prose or emits trailing text after it.
 */
export function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Container keys (besides "findings") that weaker models use for the issue list.
const FINDING_CONTAINER_KEYS = ['findings', 'issues', 'problems', 'comments', 'review_comments', 'reviewComments'];

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

// Infers a severity from a category/group key (e.g. "performance_problems")
// when the finding itself doesn't carry one. Returns undefined when unknown so
// normalizeSeverity can apply its own default.
function severityFromKey(key: string): string | undefined {
  const k = key.toLowerCase();
  if (k.includes('critical') || k.includes('blocker')) return 'critical';
  if (k.includes('security') || k.includes('vulnerab') || k.includes('inject')) return 'high';
  if (k.includes('bug') || k.includes('correctness') || k.includes('error') || k.includes('null') || k.includes('crash')) return 'high';
  if (k.includes('perf')) return 'medium';
  if (k.includes('style') || k.includes('nit') || k.includes('suggest') || k.includes('info')) return 'low';
  return undefined;
}

// Maps a single loosely-shaped object to a RawFinding, tolerating the common
// field-name variants different models emit. `categoryKey`, when present, names
// the group the item came from and seeds the severity/title.
function normalizeRawFinding(item: any, categoryKey?: string): RawFinding | null {
  if (!item || typeof item !== 'object') return null;

  const file = asText(item.file ?? item.path ?? item.filePath ?? item.fileName ?? item.filename);

  const lineRaw = item.line ?? item.lineNumber ?? item.line_number ?? item.lineNo;
  let line: number | undefined;
  if (typeof lineRaw === 'number') line = lineRaw;
  else if (typeof lineRaw === 'string' && /^\d+$/.test(lineRaw.trim())) line = parseInt(lineRaw, 10);

  const severity = asText(item.severity ?? item.level ?? severityFromKey(categoryKey ?? '') ?? '');
  const message = asText(item.message ?? item.detail ?? item.explanation ?? item.comment);
  const body = asText(item.body ?? item.description ?? '') || message;
  const title = asText(item.title ?? item.issue ?? '').trim()
    || body.split('\n')[0].slice(0, 120)
    || categoryKey
    || 'Finding';
  const snippet = asText(item.snippet ?? item.code ?? item.lineContent);

  if (!title && !body) return null;
  return { file, line, severity, title, body, snippet: snippet || undefined };
}

function collectFindings(arr: any[], categoryKey?: string): RawFinding[] {
  const out: RawFinding[] = [];
  for (const item of arr) {
    const f = normalizeRawFinding(item, categoryKey);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Coerces a parsed JSON value into our { summary, findings } shape, accepting
 * the schema variants weaker models produce: a bare findings array, an aliased
 * container key, or category-grouped arrays (e.g. "performance_problems"),
 * plus per-finding field aliases. Returns null when nothing usable is present.
 */
export function coerceReview(parsed: any): { summary: string; findings: RawFinding[] } | null {
  if (Array.isArray(parsed)) {
    const findings = collectFindings(parsed);
    return findings.length > 0 ? { summary: '', findings } : null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const summary = typeof parsed.summary === 'string'
    ? parsed.summary
    : typeof parsed.overview === 'string'
      ? parsed.overview
      : '';

  // A recognized container key wins outright.
  let findings: RawFinding[] | null = null;
  for (const key of FINDING_CONTAINER_KEYS) {
    if (Array.isArray(parsed[key])) {
      findings = collectFindings(parsed[key]);
      break;
    }
  }

  // Otherwise treat every array-of-objects property as a finding group, using
  // its key to seed severity (the category-grouped shape from issue #25).
  if (findings === null) {
    const collected: RawFinding[] = [];
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value) && value.some((v) => v && typeof v === 'object')) {
        collected.push(...collectFindings(value as any[], key));
      }
    }
    findings = collected;
  }

  if (summary || findings.length > 0) {
    return { summary, findings };
  }
  return null;
}

export function parseReviewJson(raw: string): { summary: string; findings: RawFinding[] } | null {
  if (!raw) return null;

  let text = stripReasoning(raw.trim());

  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    text = fence[1].trim();
  }

  // Try the whole text, then the first balanced object, then the outermost
  // object span, then a bare array span.
  const candidates: string[] = [text];
  const balanced = firstBalancedObject(text);
  if (balanced) candidates.push(balanced);
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(text.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      const result = coerceReview(JSON.parse(candidate));
      if (result) return result;
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt assembly (pure)
// ---------------------------------------------------------------------------

const JSON_RULES = `
Respond with a single JSON object and nothing else (no prose, no markdown fences). Shape:
{
  "summary": "A concise overview of the pull request and the most important risks.",
  "findings": [
    {
      "file": "<exact file path as shown>",
      "line": <the line number shown in the annotated diff for the line the issue is on, or omit for a file-level note>,
      "severity": "critical | high | medium | low | info",
      "title": "<short, specific finding title>",
      "body": "<explanation and suggested fix>",
      "snippet": "<the exact text of the flagged line, copied verbatim>"
    }
  ]
}
Rules:
- Only cite a "line" number that is shown in the annotated diff. Prefer added/changed lines.
- Report only high-confidence, substantive issues. Prefer silence over speculation. Do not report pure style nits.
- If there are no issues, return an empty "findings" array and summarize that the change looks sound.`;

const BUILT_IN_INSTRUCTIONS = `You are a senior software engineer performing a holistic review of an Azure DevOps pull request. You can see all of the changed files together; reason across files, not just within each one. Judge whether the change matches its stated intent, look for correctness bugs, security issues, broken contracts, and missing edge cases.`;

export function renderContextBlock(context: PullRequestContext, codingStandards?: string): string {
  const parts: string[] = [];
  if (context.title) {
    parts.push(`## Pull request title\n${context.title}`);
  }
  if (context.description) {
    parts.push(`## Pull request description\n${context.description}`);
  }
  if (context.workItems && context.workItems.length > 0) {
    parts.push(`## Linked work items\n${context.workItems.join('\n\n')}`);
  }
  if (codingStandards && codingStandards.trim()) {
    parts.push(`## Coding standards\n${codingStandards.trim()}`);
  }
  if (context.humanComments && context.humanComments.length > 0) {
    parts.push(
      `## Existing human review comments (do not repeat points already raised)\n` +
        context.humanComments.map((c) => `- ${c}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

function renderFileBlock(entry: FileEntry): string {
  return `### File: ${entry.path}\n${entry.target.content}`;
}

export function buildReviewPrompt(
  contextBlock: string,
  filesBlock: string,
  options: ReviewOptions
): string {
  const base = options.promptTemplate && options.promptTemplate.trim()
    ? options.promptTemplate.trim()
    : BUILT_IN_INSTRUCTIONS;

  const sections = [base];
  if (options.customInstructions && options.customInstructions.trim()) {
    sections.push(`## Additional instructions\n${options.customInstructions.trim()}`);
  }
  if (contextBlock) {
    sections.push(contextBlock);
  }
  sections.push(`## Changed files\n${filesBlock}`);
  sections.push(JSON_RULES);
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

// Rough allowance (tokens) reserved for the instructions/context wrapper so the
// file budget doesn't blow the input window.
const PROMPT_OVERHEAD_TOKENS = 1500;

export async function runHolisticReview(
  aiService: AIService,
  analysisTargets: Record<string, PullRequestAnalysisTarget>,
  context: PullRequestContext,
  options: ReviewOptions
): Promise<ReviewResult> {
  const entries: FileEntry[] = Object.entries(analysisTargets)
    .filter(([path, target]) => path !== 'ERROR.txt' && target && target.content)
    .map(([path, target]) => ({ path, target }));

  if (entries.length === 0) {
    return { summary: '', findings: [], suppressedCount: 0, degraded: false, error: 'No files to review' };
  }

  const contextBlock = renderContextBlock(context, options.codingStandards);
  const contextTokens = estimateTokens(contextBlock);
  const fileTokenBudget = Math.max(
    1000,
    options.maxInputTokens - contextTokens - PROMPT_OVERHEAD_TOKENS
  );

  const batches = batchEntries(entries, fileTokenBudget);

  const rawFindings: RawFinding[] = [];
  const batchSummaries: string[] = [];
  let anyParsed = false;
  let anyFailed = false;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const filesBlock = batch.map(renderFileBlock).join('\n\n');
    const prompt = buildReviewPrompt(contextBlock, filesBlock, options);
    const label = batches.length > 1 ? `review batch ${i + 1}/${batches.length}` : 'review';
    if (options.onPrompt) options.onPrompt(label, prompt);

    const parsed = await callAndParse(aiService, prompt, options);
    if (parsed) {
      anyParsed = true;
      rawFindings.push(...parsed.findings);
      if (parsed.summary) batchSummaries.push(parsed.summary);
    } else {
      anyFailed = true;
    }
  }

  if (!anyParsed) {
    // Nothing parsed at all -> degrade to a summary-only note.
    return {
      summary: 'The AI reviewer could not produce a structured review for this pull request.',
      findings: [],
      suppressedCount: 0,
      degraded: true,
      error: 'Failed to parse structured review output'
    };
  }

  // Resolve, fingerprint and internally dedup the candidates.
  const resolved = resolveFindings(rawFindings, analysisTargets);
  const deduped = dedupeByFingerprint(resolved);

  // Optional verification (false-positive suppression). Runs once over the
  // merged candidate set. Fails open: a verification glitch keeps the findings.
  let verified = deduped;
  if (options.enableVerification && deduped.length > 0) {
    verified = await verifyFindings(aiService, deduped, contextBlock, options);
  }

  // minSeverity filter (count suppressed for the summary).
  const kept: ResolvedFinding[] = [];
  let suppressedCount = 0;
  for (const f of verified) {
    if (meetsMinSeverity(f.severity, options.minSeverity)) {
      kept.push(f);
    } else {
      suppressedCount++;
    }
  }

  // Summary: single batch reuses its summary; multiple batches get a synthesis.
  let summary: string;
  if (batchSummaries.length <= 1) {
    summary = batchSummaries[0] ?? '';
  } else {
    summary = await synthesizeSummary(aiService, batchSummaries, kept, options);
  }

  return {
    summary,
    findings: kept,
    suppressedCount,
    degraded: anyFailed,
  };
}

/** Calls the model in JSON mode, parsing with one retry before giving up. */
async function callAndParse(
  aiService: AIService,
  prompt: string,
  options: ReviewOptions
): Promise<{ summary: string; findings: RawFinding[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await aiService.generateComment(prompt, options.maxTokens, options.temperature, { jsonMode: true });
    if (response.error) {
      console.log(`AI call error (attempt ${attempt + 1}): ${response.error}`);
      continue;
    }
    const parsed = parseReviewJson(response.content);
    if (parsed) {
      return parsed;
    }
    console.log(`Could not parse structured output (attempt ${attempt + 1}).`);
  }
  return null;
}

function resolveFindings(
  raw: RawFinding[],
  analysisTargets: Record<string, PullRequestAnalysisTarget>
): ResolvedFinding[] {
  // When a model omits the file but only one file was reviewed, the finding can
  // only belong to that file — attach it rather than dropping it. (Coerced
  // alternate-schema output frequently lacks a per-finding file; issue #25.)
  const fileKeys = Object.keys(analysisTargets).filter((k) => k !== 'ERROR.txt');
  const soleFile = fileKeys.length === 1 ? fileKeys[0] : undefined;

  const out: ResolvedFinding[] = [];
  for (const f of raw) {
    if (!f || !f.title) continue;
    const file = f.file || soleFile;
    if (!file) continue;
    const target = analysisTargets[file];
    const severity = normalizeSeverity(f.severity);
    const line = resolveAnchor(
      typeof f.line === 'number' ? f.line : undefined,
      target?.changedLines
    );
    out.push({
      file,
      line,
      severity,
      title: f.title,
      body: f.body ?? '',
      fingerprint: fingerprintFinding(file, severity, f.title, f.snippet)
    });
  }
  return out;
}

export function dedupeByFingerprint(findings: ResolvedFinding[]): ResolvedFinding[] {
  const seen = new Set<string>();
  const out: ResolvedFinding[] = [];
  for (const f of findings) {
    if (seen.has(f.fingerprint)) continue;
    seen.add(f.fingerprint);
    out.push(f);
  }
  return out;
}

/**
 * Critic pass: asks the model to confirm which candidate findings are real.
 * Returns the surviving findings. Fails open (keeps everything) on any error.
 */
async function verifyFindings(
  aiService: AIService,
  findings: ResolvedFinding[],
  contextBlock: string,
  options: ReviewOptions
): Promise<ResolvedFinding[]> {
  const list = findings
    .map((f, idx) => `${idx}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}\n   ${f.body}`)
    .join('\n');

  const prompt = `${contextBlock ? contextBlock + '\n\n' : ''}You previously proposed the following code-review findings for this pull request. For each one, decide whether it is a genuine, high-confidence issue. Drop anything speculative, incorrect, or that you are unsure about.

Findings:
${list}

Respond with a single JSON object and nothing else:
{ "confirmed": [<indices of the findings that are definitely real>] }`;

  if (options.onPrompt) options.onPrompt('verification', prompt);

  const response = await aiService.generateComment(prompt, options.maxTokens, options.temperature, { jsonMode: true });
  if (response.error) {
    console.log(`Verification call failed, keeping all findings: ${response.error}`);
    return findings;
  }

  const confirmed = parseConfirmedIndices(response.content);
  if (confirmed === null) {
    console.log('Could not parse verification output, keeping all findings.');
    return findings;
  }

  const keepSet = new Set(confirmed);
  const survivors = findings.filter((_, idx) => keepSet.has(idx));
  console.log(`Verification kept ${survivors.length}/${findings.length} findings.`);
  return survivors;
}

export function parseConfirmedIndices(raw: string): number[] | null {
  if (!raw) return null;
  let text = stripReasoning(raw.trim());
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  const candidate =
    firstBalancedObject(text) ??
    (firstBrace !== -1 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text);
  try {
    const obj = JSON.parse(candidate);
    if (obj && Array.isArray(obj.confirmed)) {
      return obj.confirmed
        .map((n: any) => parseInt(n, 10))
        .filter((n: number) => !Number.isNaN(n));
    }
  } catch {
    // fall through
  }
  return null;
}

/** Writes a unified summary across batches. Falls back to concatenation. */
async function synthesizeSummary(
  aiService: AIService,
  batchSummaries: string[],
  findings: ResolvedFinding[],
  options: ReviewOptions
): Promise<string> {
  const prompt = `You reviewed a large pull request in several parts. Merge the partial summaries below into one concise overall summary of the pull request and its most important risks. Do not list individual findings; they are posted separately.

Partial summaries:
${batchSummaries.map((s, i) => `Part ${i + 1}: ${s}`).join('\n\n')}`;

  if (options.onPrompt) options.onPrompt('synthesis', prompt);

  const response = await aiService.generateComment(prompt, options.maxTokens, options.temperature);
  if (response.error || !response.content) {
    return batchSummaries.join('\n\n');
  }
  return response.content.trim();
}
