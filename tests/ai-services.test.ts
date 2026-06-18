import { test, expect, describe } from 'bun:test';
import { isNoComment } from '../src/ai-services';

describe('isNoComment', () => {
  test('treats empty / whitespace as nothing to say', () => {
    expect(isNoComment(undefined)).toBe(true);
    expect(isNoComment('')).toBe(true);
    expect(isNoComment('   \n  ')).toBe(true);
  });

  test('recognizes NO_COMMENT sentinels (incl. markdown/quote decoration)', () => {
    expect(isNoComment('NO_COMMENT')).toBe(true);
    expect(isNoComment('no_comment')).toBe(true);
    expect(isNoComment('NO COMMENT')).toBe(true);
    expect(isNoComment('**NO_COMMENT**')).toBe(true);
    expect(isNoComment('"NO_COMMENT."')).toBe(true);
    expect(isNoComment('NO COMMENTS')).toBe(true);
  });

  test('keeps real feedback', () => {
    expect(isNoComment('NO_COMMENT needed because the loop is off by one')).toBe(false);
    expect(isNoComment('This method has a null-reference risk on line 21.')).toBe(false);
    expect(isNoComment('{"findings":[]}')).toBe(false);
  });
});
