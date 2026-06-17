import { test, expect, describe } from 'bun:test';
import { CommentThreadStatus, CommentType, GitPullRequestCommentThread } from 'azure-devops-node-api/interfaces/GitInterfaces';
import {
  postReview,
  GitApiLike,
  SUMMARY_PROPERTY,
  FINDING_PROPERTY,
  FINGERPRINT_PROPERTY,
} from '../src/review-poster';
import { ResolvedFinding, ReviewResult } from '../src/review-orchestrator';

// ---------------------------------------------------------------------------
// Recording fake Git API. Captures every create/update so tests can assert on
// exactly what the poster did.
// ---------------------------------------------------------------------------
class FakeGitApi implements GitApiLike {
  created: GitPullRequestCommentThread[] = [];
  updatedThreads: { thread: GitPullRequestCommentThread; threadId: number }[] = [];
  updatedComments: { content: string; threadId: number; commentId: number }[] = [];
  private existing: GitPullRequestCommentThread[];

  constructor(existing: GitPullRequestCommentThread[] = []) {
    this.existing = existing;
  }

  async getThreads() {
    return this.existing;
  }
  async createThread(thread: GitPullRequestCommentThread) {
    this.created.push(thread);
    return thread;
  }
  async updateThread(thread: GitPullRequestCommentThread, _r: string, _p: number, threadId: number) {
    this.updatedThreads.push({ thread, threadId });
    return thread;
  }
  async updateComment(comment: { commentType: CommentType; content: string }, _r: string, _p: number, threadId: number, commentId: number) {
    this.updatedComments.push({ content: comment.content, threadId, commentId });
    return comment;
  }

  createdSummaries() {
    return this.created.filter((t) => t.properties && t.properties[SUMMARY_PROPERTY]);
  }
  createdFindings() {
    return this.created.filter((t) => t.properties && t.properties[FINDING_PROPERTY]);
  }
}

function finding(over: Partial<ResolvedFinding> = {}): ResolvedFinding {
  return {
    file: 'src/a.ts',
    line: 10,
    severity: 'high',
    title: 'Issue',
    body: 'details',
    fingerprint: 'fp-default',
    ...over,
  };
}

function result(findings: ResolvedFinding[], summary = 'overview', suppressedCount = 0): ReviewResult {
  return { summary, findings, suppressedCount, degraded: false };
}

const REPO = 'repo';
const PR = 42;

describe('postReview — first run (no existing threads)', () => {
  test('posts a summary thread and one thread per finding', async () => {
    const git = new FakeGitApi([]);
    const r = result([
      finding({ fingerprint: 'fp1', line: 10 }),
      finding({ fingerprint: 'fp2', line: undefined, file: 'src/b.ts', title: 'File-level' }),
    ]);

    await postReview(git, REPO, PR, true, r);

    expect(git.createdSummaries().length).toBe(1);
    expect(git.createdFindings().length).toBe(2);

    // Summary content reflects counts.
    expect(git.createdSummaries()[0].comments![0].content).toContain('2 finding(s) posted');
  });

  test('anchors line findings on the right file and leaves file-level findings unanchored', async () => {
    const git = new FakeGitApi([]);
    await postReview(git, REPO, PR, true, result([
      finding({ fingerprint: 'fp1', line: 10, file: 'src/a.ts' }),
      finding({ fingerprint: 'fp2', line: undefined, file: 'src/b.ts' }),
    ]));

    const anchored = git.createdFindings().find((t) => (t.threadContext as any)?.rightFileStart);
    const fileLevel = git.createdFindings().find((t) => !(t.threadContext as any)?.rightFileStart);

    expect((anchored!.threadContext as any).filePath).toBe('src/a.ts');
    expect((anchored!.threadContext as any).rightFileStart.line).toBe(10);
    expect((fileLevel!.threadContext as any).filePath).toBe('src/b.ts');
    expect((fileLevel!.threadContext as any).rightFileStart).toBeUndefined();
  });

  test('isActive controls thread status', async () => {
    const gitActive = new FakeGitApi([]);
    await postReview(gitActive, REPO, PR, true, result([finding()]));
    expect(gitActive.createdFindings()[0].status).toBe(CommentThreadStatus.Active);

    const gitClosed = new FakeGitApi([]);
    await postReview(gitClosed, REPO, PR, false, result([finding()]));
    expect(gitClosed.createdFindings()[0].status).toBe(CommentThreadStatus.Closed);
  });
});

describe('postReview — summary update on re-run', () => {
  test('updates the existing summary comment in place instead of creating a new one', async () => {
    const existingSummary: GitPullRequestCommentThread = {
      id: 100,
      properties: { [SUMMARY_PROPERTY]: 'true' } as any,
      comments: [{ id: 1, commentType: CommentType.Text, content: 'old summary' }],
    };
    const git = new FakeGitApi([existingSummary]);

    await postReview(git, REPO, PR, true, result([]));

    expect(git.createdSummaries().length).toBe(0); // not recreated
    expect(git.updatedComments.length).toBe(1);
    expect(git.updatedComments[0].threadId).toBe(100);
    expect(git.updatedComments[0].commentId).toBe(1);
  });
});

describe('postReview — fingerprint dedup', () => {
  test('skips a finding whose fingerprint already has an open thread', async () => {
    const existing: GitPullRequestCommentThread = {
      id: 200,
      status: CommentThreadStatus.Active,
      properties: { [FINDING_PROPERTY]: 'true', [FINGERPRINT_PROPERTY]: 'fp1' } as any,
      comments: [{ id: 1, commentType: CommentType.Text, content: 'already here' }],
    };
    const git = new FakeGitApi([existing]);

    await postReview(git, REPO, PR, true, result([finding({ fingerprint: 'fp1' })]));

    expect(git.createdFindings().length).toBe(0); // not re-posted
  });

  test('re-posts a finding whose previous thread was already closed', async () => {
    const existing: GitPullRequestCommentThread = {
      id: 200,
      status: CommentThreadStatus.Closed,
      properties: { [FINDING_PROPERTY]: 'true', [FINGERPRINT_PROPERTY]: 'fp1' } as any,
      comments: [{ id: 1, commentType: CommentType.Text, content: 'was closed' }],
    };
    const git = new FakeGitApi([existing]);

    await postReview(git, REPO, PR, true, result([finding({ fingerprint: 'fp1' })]));

    expect(git.createdFindings().length).toBe(1); // closed => treated as gone => reposted
  });
});

describe('postReview — stale finding resolution', () => {
  test('closes an open finding thread that no longer appears in this run', async () => {
    const stale: GitPullRequestCommentThread = {
      id: 300,
      status: CommentThreadStatus.Active,
      properties: { [FINDING_PROPERTY]: 'true', [FINGERPRINT_PROPERTY]: 'gone' } as any,
      comments: [{ id: 1, commentType: CommentType.Text, content: 'obsolete' }],
    };
    const git = new FakeGitApi([stale]);

    // Current run finds something else entirely.
    await postReview(git, REPO, PR, true, result([finding({ fingerprint: 'fresh' })]));

    expect(git.createdFindings().length).toBe(1); // the fresh one
    expect(git.updatedThreads.length).toBe(1); // the stale one closed
    expect(git.updatedThreads[0].threadId).toBe(300);
    expect(git.updatedThreads[0].thread.status).toBe(CommentThreadStatus.Closed);
  });

  test('does not close a thread whose finding is still present', async () => {
    const keep: GitPullRequestCommentThread = {
      id: 300,
      status: CommentThreadStatus.Active,
      properties: { [FINDING_PROPERTY]: 'true', [FINGERPRINT_PROPERTY]: 'fp1' } as any,
      comments: [{ id: 1, commentType: CommentType.Text, content: 'still valid' }],
    };
    const git = new FakeGitApi([keep]);

    await postReview(git, REPO, PR, true, result([finding({ fingerprint: 'fp1' })]));

    expect(git.updatedThreads.length).toBe(0); // not closed
    expect(git.createdFindings().length).toBe(0); // and not duplicated
  });
});

describe('postReview — resilience', () => {
  test('a failing createThread does not abort the rest of the run', async () => {
    const git = new FakeGitApi([]);
    let first = true;
    const orig = git.createThread.bind(git);
    git.createThread = async (t: GitPullRequestCommentThread) => {
      if (first) {
        first = false;
        throw new Error('transient ADO error');
      }
      return orig(t);
    };

    // Summary create throws; the two findings should still be attempted.
    await postReview(git, REPO, PR, true, result([
      finding({ fingerprint: 'fp1' }),
      finding({ fingerprint: 'fp2' }),
    ]));

    expect(git.createdFindings().length).toBe(2);
  });
});
