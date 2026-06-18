import { test, expect, describe } from 'bun:test';
import { runHolisticReview, ReviewOptions } from '../src/review-orchestrator';
import { AIService, AIGenerateOptions, AIResponse } from '../src/ai-services';
import { PullRequestAnalysisTarget, PullRequestContext } from '../src/pr-utils';

// ---------------------------------------------------------------------------
// Programmable fake AIService. Routes by prompt content so a single fake can
// serve the review, verification and synthesis calls the orchestrator makes.
// ---------------------------------------------------------------------------
class FakeAIService implements AIService {
  calls: { prompt: string; jsonMode?: boolean }[] = [];
  private reviewResponses: string[];
  private reviewIndex = 0;
  verifyResponder: (prompt: string) => string = () => '{"confirmed":[]}';
  synthResponder: (prompt: string) => string = () => 'synthesized summary';

  constructor(reviewResponses: string[]) {
    this.reviewResponses = reviewResponses;
  }

  async generateComment(
    prompt: string,
    _maxTokens: number,
    _temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    this.calls.push({ prompt, jsonMode: options?.jsonMode });
    if (prompt.includes('Merge the partial summaries')) {
      return { content: this.synthResponder(prompt) };
    }
    if (prompt.includes('decide whether it is a genuine')) {
      return { content: this.verifyResponder(prompt) };
    }
    const r = this.reviewResponses[this.reviewIndex++] ?? '{"summary":"","findings":[]}';
    return { content: r };
  }

  reviewCalls() {
    return this.calls.filter(
      (c) => !c.prompt.includes('Merge the partial summaries') && !c.prompt.includes('decide whether it is a genuine')
    );
  }
  verifyCalls() {
    return this.calls.filter((c) => c.prompt.includes('decide whether it is a genuine'));
  }
  synthCalls() {
    return this.calls.filter((c) => c.prompt.includes('Merge the partial summaries'));
  }
}

const emptyContext: PullRequestContext = { title: '', description: '', workItems: [], humanComments: [] };

function target(content: string, changedLines?: number[]): PullRequestAnalysisTarget {
  return { content, isDiff: true, firstChangedLine: changedLines?.[0], changedLines };
}

function opts(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    maxTokens: 4000,
    temperature: 0.2,
    maxInputTokens: 200000,
    minSeverity: 'low',
    enableVerification: false,
    ...overrides,
  };
}

function review(summary: string, findings: any[]): string {
  return JSON.stringify({ summary, findings });
}

describe('runHolisticReview — happy path', () => {
  test('single batch produces summary + anchored finding, one AI call', async () => {
    const ai = new FakeAIService([
      review('looks reasonable', [
        { file: 'src/a.ts', line: 10, severity: 'high', title: 'Null deref', body: 'fix it', snippet: 'x.y' },
      ]),
    ]);
    const targets = { 'src/a.ts': target('   10 + x.y', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    expect(result.summary).toBe('looks reasonable');
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].line).toBe(10); // anchored to a changed line
    expect(result.findings[0].severity).toBe('high');
    expect(result.findings[0].fingerprint).toBeTruthy();
    expect(result.suppressedCount).toBe(0);
    expect(result.degraded).toBe(false);
    expect(ai.reviewCalls().length).toBe(1);
    expect(ai.reviewCalls()[0].jsonMode).toBe(true); // structured output requested
  });
});

describe('runHolisticReview — minSeverity filter', () => {
  test('drops findings below threshold and counts them', async () => {
    const ai = new FakeAIService([
      review('s', [
        { file: 'src/a.ts', line: 10, severity: 'high', title: 'Big', body: '', snippet: 'a' },
        { file: 'src/a.ts', line: 10, severity: 'low', title: 'Tiny', body: '', snippet: 'b' },
      ]),
    ]);
    const targets = { 'src/a.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts({ minSeverity: 'medium' }));

    expect(result.findings.length).toBe(1);
    expect(result.findings[0].title).toBe('Big');
    expect(result.suppressedCount).toBe(1);
  });
});

describe('runHolisticReview — anchor resolution', () => {
  test('snaps near-misses and drops far-off cited lines to file-level', async () => {
    const ai = new FakeAIService([
      review('s', [
        { file: 'src/a.ts', line: 12, severity: 'high', title: 'Near', body: '', snippet: 'a' },
        { file: 'src/a.ts', line: 999, severity: 'high', title: 'Far', body: '', snippet: 'b' },
      ]),
    ]);
    const targets = { 'src/a.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    const near = result.findings.find((f) => f.title === 'Near')!;
    const far = result.findings.find((f) => f.title === 'Far')!;
    expect(near.line).toBe(10); // snapped to nearest changed line within window
    expect(far.line).toBeUndefined(); // dropped to file-level
  });
});

describe('runHolisticReview — verification pass', () => {
  test('keeps only confirmed findings', async () => {
    const ai = new FakeAIService([
      review('s', [
        { file: 'src/a.ts', line: 10, severity: 'high', title: 'Real', body: '', snippet: 'a' },
        { file: 'src/a.ts', line: 10, severity: 'high', title: 'Bogus', body: '', snippet: 'b' },
      ]),
    ]);
    ai.verifyResponder = () => '{"confirmed":[0]}'; // keep only the first

    const targets = { 'src/a.ts': target('   10 + a', [10]) };
    const result = await runHolisticReview(ai, targets, emptyContext, opts({ enableVerification: true }));

    expect(ai.verifyCalls().length).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].title).toBe('Real');
  });

  test('fails open: a broken verification response keeps all findings', async () => {
    const ai = new FakeAIService([
      review('s', [{ file: 'src/a.ts', line: 10, severity: 'high', title: 'A', body: '', snippet: 'a' }]),
    ]);
    ai.verifyResponder = () => 'garbage not json';

    const targets = { 'src/a.ts': target('   10 + a', [10]) };
    const result = await runHolisticReview(ai, targets, emptyContext, opts({ enableVerification: true }));

    expect(result.findings.length).toBe(1);
  });
});

describe('runHolisticReview — parse robustness', () => {
  test('malformed output then valid on retry still succeeds (not degraded)', async () => {
    const ai = new FakeAIService(['this is not json', review('recovered', [])]);
    const targets = { 'src/a.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    expect(result.summary).toBe('recovered');
    expect(result.degraded).toBe(false);
    expect(ai.reviewCalls().length).toBe(2); // one retry
  });

  test('two failed attempts degrade to a summary-only result', async () => {
    const ai = new FakeAIService(['nope', 'still nope']);
    const targets = { 'src/a.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    expect(result.degraded).toBe(true);
    expect(result.error).toBeTruthy();
    expect(result.findings.length).toBe(0);
  });
});

describe('runHolisticReview — dedup', () => {
  test('identical findings within a run are deduped', async () => {
    const dup = { file: 'src/a.ts', line: 10, severity: 'high', title: 'Same', body: 'x', snippet: 'a' };
    const ai = new FakeAIService([review('s', [dup, { ...dup }])]);
    const targets = { 'src/a.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());
    expect(result.findings.length).toBe(1);
  });
});

describe('runHolisticReview — large PR batching + synthesis', () => {
  test('splits oversized PR into batches and synthesizes one summary', async () => {
    const big = 'x'.repeat(6000); // ~1500 tokens each, forces a per-file split
    const ai = new FakeAIService([
      review('part one', [{ file: 'src/a.ts', line: 1, severity: 'high', title: 'A', body: '', snippet: 'a' }]),
      review('part two', [{ file: 'src/b.ts', line: 1, severity: 'high', title: 'B', body: '', snippet: 'b' }]),
    ]);
    ai.synthResponder = () => 'unified summary';

    const targets = {
      'src/a.ts': target(`    1 + ${big}`, [1]),
      'src/b.ts': target(`    1 + ${big}`, [1]),
    };

    const result = await runHolisticReview(ai, targets, emptyContext, opts({ maxInputTokens: 2000 }));

    expect(ai.reviewCalls().length).toBe(2); // two batches
    expect(ai.synthCalls().length).toBe(1); // synthesized
    expect(result.summary).toBe('unified summary');
    expect(result.findings.map((f) => f.title).sort()).toEqual(['A', 'B']);
  });
});

describe('runHolisticReview — alternate schema recovery', () => {
  test('category-grouped output is coerced into findings instead of degrading', async () => {
    const ai = new FakeAIService([
      JSON.stringify({
        performance_problems: [
          { file: 'src/a.ts', line: 10, message: 'slow query' },
        ],
      }),
    ]);
    const targets = { 'src/a.ts': target('   10 + slow', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    expect(result.degraded).toBe(false);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0].body).toBe('slow query');
    expect(result.findings[0].line).toBe(10);
  });

  test('a file-less finding is anchored to the sole reviewed file', async () => {
    const ai = new FakeAIService([
      review('s', [{ line: 10, severity: 'high', title: 'No file given', body: 'x', snippet: 'a' }]),
    ]);
    const targets = { 'src/only.ts': target('   10 + a', [10]) };

    const result = await runHolisticReview(ai, targets, emptyContext, opts());

    expect(result.findings.length).toBe(1);
    expect(result.findings[0].file).toBe('src/only.ts');
  });
});

describe('runHolisticReview — no files', () => {
  test('returns an error result when there is nothing to review', async () => {
    const ai = new FakeAIService([]);
    const result = await runHolisticReview(ai, {}, emptyContext, opts());
    expect(result.error).toBeTruthy();
    expect(result.findings.length).toBe(0);
    expect(ai.calls.length).toBe(0); // never calls the model
  });
});
