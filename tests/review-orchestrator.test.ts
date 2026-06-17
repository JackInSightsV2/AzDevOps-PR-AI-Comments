import { test, expect, describe } from 'bun:test';
import {
  estimateTokens,
  batchEntries,
  resolveAnchor,
  normalizeSeverity,
  severityRank,
  meetsMinSeverity,
  fingerprintFinding,
  parseReviewJson,
  parseConfirmedIndices,
  dedupeByFingerprint,
  ResolvedFinding,
} from '../src/review-orchestrator';

// Minimal FileEntry shape (batchEntries only reads path + target.content).
function entry(path: string, content: string): any {
  return { path, target: { content, isDiff: true } };
}

describe('estimateTokens', () => {
  test('approximates ~4 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('batchEntries', () => {
  test('keeps everything in one batch when under budget', () => {
    const entries = [entry('a.ts', 'x'.repeat(40)), entry('b.ts', 'y'.repeat(40))];
    const batches = batchEntries(entries, 10000);
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(2);
  });

  test('splits into multiple batches when over budget', () => {
    // Each rendered block is well over 5 tokens; budget of 5 forces a split per file.
    const entries = [
      entry('a.ts', 'x'.repeat(400)),
      entry('b.ts', 'y'.repeat(400)),
      entry('c.ts', 'z'.repeat(400)),
    ];
    const batches = batchEntries(entries, 5);
    expect(batches.length).toBe(3);
  });

  test('preserves order across batches', () => {
    const entries = [entry('a.ts', 'x'.repeat(400)), entry('b.ts', 'y'.repeat(400))];
    const batches = batchEntries(entries, 5);
    expect(batches[0][0].path).toBe('a.ts');
    expect(batches[1][0].path).toBe('b.ts');
  });

  test('an oversized single file still gets its own batch', () => {
    const batches = batchEntries([entry('big.ts', 'x'.repeat(100000))], 5);
    expect(batches.length).toBe(1);
    expect(batches[0][0].path).toBe('big.ts');
  });
});

describe('resolveAnchor', () => {
  const changed = [10, 11, 20, 21];

  test('no line cited -> file-level (undefined)', () => {
    expect(resolveAnchor(undefined, changed)).toBeUndefined();
  });

  test('full-file target (no changedLines) trusts the cited line', () => {
    expect(resolveAnchor(42, undefined)).toBe(42);
    expect(resolveAnchor(42, [])).toBe(42);
  });

  test('cited line that is a changed line is kept', () => {
    expect(resolveAnchor(20, changed)).toBe(20);
  });

  test('cited line near a changed line snaps to the nearest', () => {
    expect(resolveAnchor(23, changed)).toBe(21); // within window 5
  });

  test('cited line far from any changed line drops to file-level', () => {
    expect(resolveAnchor(200, changed)).toBeUndefined();
  });
});

describe('severity helpers', () => {
  test('normalizeSeverity maps synonyms and unknowns', () => {
    expect(normalizeSeverity('Critical')).toBe('critical');
    expect(normalizeSeverity('major')).toBe('high');
    expect(normalizeSeverity('warning')).toBe('medium');
    expect(normalizeSeverity('nit')).toBe('info');
    expect(normalizeSeverity('something-weird')).toBe('medium');
    expect(normalizeSeverity(undefined)).toBe('medium');
  });

  test('severityRank orders correctly', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('info')).toBeLessThan(severityRank('low'));
  });

  test('meetsMinSeverity filters below threshold', () => {
    expect(meetsMinSeverity('high', 'medium')).toBe(true);
    expect(meetsMinSeverity('medium', 'medium')).toBe(true);
    expect(meetsMinSeverity('low', 'medium')).toBe(false);
    expect(meetsMinSeverity('info', 'low')).toBe(false);
  });
});

describe('fingerprintFinding', () => {
  test('is stable across line-number shifts (line is not part of the basis)', () => {
    const a = fingerprintFinding('src/x.ts', 'high', 'SQL injection', 'db.query(input)');
    const b = fingerprintFinding('src/x.ts', 'high', 'SQL injection', 'db.query(input)');
    expect(a).toBe(b);
  });

  test('normalizes whitespace/case in title and snippet', () => {
    const a = fingerprintFinding('src/x.ts', 'high', 'SQL Injection', 'db.query(input)');
    const b = fingerprintFinding('src/x.ts', 'high', '  sql   injection ', 'db.query(input)');
    expect(a).toBe(b);
  });

  test('differs when file, severity, title or snippet differ', () => {
    const base = fingerprintFinding('src/x.ts', 'high', 'Bug', 'code');
    expect(fingerprintFinding('src/y.ts', 'high', 'Bug', 'code')).not.toBe(base);
    expect(fingerprintFinding('src/x.ts', 'low', 'Bug', 'code')).not.toBe(base);
    expect(fingerprintFinding('src/x.ts', 'high', 'Other', 'code')).not.toBe(base);
    expect(fingerprintFinding('src/x.ts', 'high', 'Bug', 'other')).not.toBe(base);
  });
});

describe('dedupeByFingerprint', () => {
  test('removes duplicate fingerprints, keeps first', () => {
    const findings: ResolvedFinding[] = [
      { file: 'a', severity: 'high', title: 'x', body: '', fingerprint: 'fp1' },
      { file: 'a', severity: 'high', title: 'x', body: '', fingerprint: 'fp1' },
      { file: 'b', severity: 'low', title: 'y', body: '', fingerprint: 'fp2' },
    ];
    const out = dedupeByFingerprint(findings);
    expect(out.length).toBe(2);
    expect(out.map((f) => f.fingerprint)).toEqual(['fp1', 'fp2']);
  });
});

describe('parseReviewJson', () => {
  test('parses a bare JSON object', () => {
    const r = parseReviewJson('{"summary":"ok","findings":[]}');
    expect(r).not.toBeNull();
    expect(r!.summary).toBe('ok');
    expect(r!.findings.length).toBe(0);
  });

  test('parses JSON inside ```json fences', () => {
    const r = parseReviewJson('```json\n{"summary":"s","findings":[{"file":"a","severity":"high","title":"t","body":"b"}]}\n```');
    expect(r).not.toBeNull();
    expect(r!.findings[0].file).toBe('a');
  });

  test('parses JSON surrounded by prose', () => {
    const r = parseReviewJson('Here is my review:\n{"summary":"s","findings":[]}\nThanks!');
    expect(r).not.toBeNull();
    expect(r!.summary).toBe('s');
  });

  test('returns null on unparseable input', () => {
    expect(parseReviewJson('not json at all')).toBeNull();
    expect(parseReviewJson('')).toBeNull();
  });
});

describe('parseConfirmedIndices', () => {
  test('extracts the confirmed array', () => {
    expect(parseConfirmedIndices('{"confirmed":[0,2,3]}')).toEqual([0, 2, 3]);
  });

  test('handles fenced output', () => {
    expect(parseConfirmedIndices('```json\n{"confirmed":[1]}\n```')).toEqual([1]);
  });

  test('returns null when missing', () => {
    expect(parseConfirmedIndices('nope')).toBeNull();
  });
});
