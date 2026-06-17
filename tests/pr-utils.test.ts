import { test, expect, describe } from 'bun:test';
import { buildAnnotatedDiff } from '../src/pr-utils';

describe('buildAnnotatedDiff', () => {
  test('annotates added lines with real right-file line numbers and records them as changed', () => {
    const oldStr = 'line1\nline2\nline3\n';
    const newStr = 'line1\nline2\nINSERTED\nline3\n';
    const { text, changedLines, firstChangedLine } = buildAnnotatedDiff('f', 'f', oldStr, newStr);

    // The inserted line becomes new-file line 3.
    expect(changedLines).toContain(3);
    expect(firstChangedLine).toBe(3);
    // The annotated text shows the line number next to the '+' marker.
    expect(text).toMatch(/3 \+ INSERTED/);
  });

  test('removed lines do not appear in changedLines', () => {
    const oldStr = 'a\nb\nc\n';
    const newStr = 'a\nc\n';
    const { text, changedLines } = buildAnnotatedDiff('f', 'f', oldStr, newStr);
    // 'b' was removed; nothing was added, so there are no right-side changed lines.
    expect(changedLines.length).toBe(0);
    expect(text).toMatch(/- b/);
  });

  test('modified line records the new line number', () => {
    const oldStr = 'header\nvalue = 1\nfooter\n';
    const newStr = 'header\nvalue = 2\nfooter\n';
    const { changedLines } = buildAnnotatedDiff('f', 'f', oldStr, newStr);
    // 'value = 2' is the addition at new-file line 2.
    expect(changedLines).toContain(2);
  });

  test('no changes yields empty changed lines', () => {
    const same = 'x\ny\nz\n';
    const { changedLines, firstChangedLine } = buildAnnotatedDiff('f', 'f', same, same);
    expect(changedLines.length).toBe(0);
    expect(firstChangedLine).toBeUndefined();
  });
});
