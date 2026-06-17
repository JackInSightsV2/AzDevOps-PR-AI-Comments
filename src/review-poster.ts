import {
  CommentThreadStatus,
  CommentType,
  GitPullRequestCommentThread,
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { ResolvedFinding, ReviewResult, Severity } from './review-orchestrator';

// Thread property keys used to recognize our own machine-posted threads on
// re-runs. Kept here so pr-utils (which filters human comments) and the poster
// agree on the same markers.
export const SUMMARY_PROPERTY = 'AiReviewSummary';
export const FINDING_PROPERTY = 'AiReviewFinding';
export const FINGERPRINT_PROPERTY = 'AiFindingFingerprint';

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: '🔴 CRITICAL',
  high: '🟠 HIGH',
  medium: '🟡 MEDIUM',
  low: '🔵 LOW',
  info: '⚪ INFO',
};

export function formatFindingComment(finding: ResolvedFinding): string {
  return `**${SEVERITY_LABELS[finding.severity]}: ${finding.title}**\n\n${finding.body}`;
}

export function formatSummaryComment(result: ReviewResult): string {
  let content = `**🤖 AI Pull Request Review**\n\n${result.summary || 'No summary was produced.'}`;
  content += `\n\n_${result.findings.length} finding(s) posted._`;
  if (result.suppressedCount > 0) {
    content += ` _${result.suppressedCount} lower-severity finding(s) suppressed by the minimum-severity filter._`;
  }
  return content;
}

// A structural subset of the Git API surface the poster uses. Lets tests pass a
// lightweight fake without depending on the full azure-devops-node-api client.
export interface GitApiLike {
  getThreads(repositoryId: string, pullRequestId: number): Promise<GitPullRequestCommentThread[] | undefined>;
  createThread(thread: GitPullRequestCommentThread, repositoryId: string, pullRequestId: number): Promise<any>;
  updateThread(
    thread: GitPullRequestCommentThread,
    repositoryId: string,
    pullRequestId: number,
    threadId: number
  ): Promise<any>;
  updateComment(
    comment: { commentType: CommentType; content: string },
    repositoryId: string,
    pullRequestId: number,
    threadId: number,
    commentId: number
  ): Promise<any>;
}

/**
 * Posts the holistic review to the PR:
 *  - the summary thread, updated in place if it already exists;
 *  - each finding, skipped if an open thread with the same fingerprint exists;
 *  - threads for findings that no longer appear are closed (stale resolution).
 *
 * Every Git call is individually guarded so one failure doesn't abort the rest.
 */
export async function postReview(
  gitApi: GitApiLike,
  repositoryId: string,
  pullRequestId: number,
  isActive: boolean,
  result: ReviewResult
): Promise<void> {
  const threadStatus = isActive ? CommentThreadStatus.Active : CommentThreadStatus.Closed;

  let existingThreads: GitPullRequestCommentThread[] = [];
  try {
    existingThreads = (await gitApi.getThreads(repositoryId, pullRequestId)) ?? [];
  } catch (err) {
    console.log(`Could not fetch existing threads (continuing): ${err}`);
  }

  // ---- Summary thread (update in place if present) ----
  const summaryContent = formatSummaryComment(result);
  const existingSummary = existingThreads.find((t) => t.properties && t.properties[SUMMARY_PROPERTY]);
  if (existingSummary && existingSummary.id && existingSummary.comments && existingSummary.comments[0]?.id) {
    try {
      await gitApi.updateComment(
        { commentType: CommentType.Text, content: summaryContent },
        repositoryId,
        pullRequestId,
        existingSummary.id,
        existingSummary.comments[0].id!
      );
      console.log('Updated existing review summary.');
    } catch (err) {
      console.log(`Could not update summary thread: ${err}`);
    }
  } else {
    const summaryThread: GitPullRequestCommentThread = {
      comments: [{ commentType: CommentType.Text, content: summaryContent }],
      status: threadStatus,
      properties: { [SUMMARY_PROPERTY]: 'true' },
    };
    try {
      await gitApi.createThread(summaryThread, repositoryId, pullRequestId);
      console.log('Posted review summary.');
    } catch (err) {
      console.log(`Could not post summary thread: ${err}`);
    }
  }

  // ---- Findings: dedup against existing, post new, close stale ----
  const existingFindingThreads = existingThreads.filter(
    (t) => t.properties && t.properties[FINGERPRINT_PROPERTY]
  );
  const openByFingerprint = new Map<string, GitPullRequestCommentThread>();
  for (const t of existingFindingThreads) {
    const fp = t.properties![FINGERPRINT_PROPERTY] as unknown as string;
    if (t.status !== CommentThreadStatus.Closed) {
      openByFingerprint.set(fp, t);
    }
  }

  const currentFingerprints = new Set(result.findings.map((f) => f.fingerprint));

  for (const finding of result.findings) {
    if (openByFingerprint.has(finding.fingerprint)) {
      console.log(`Finding already posted, skipping: ${finding.title}`);
      continue;
    }

    const threadContext: any = finding.line
      ? {
          filePath: finding.file,
          rightFileStart: { line: finding.line, offset: 1 },
          rightFileEnd: { line: finding.line, offset: 1 },
        }
      : { filePath: finding.file };

    const thread: GitPullRequestCommentThread = {
      comments: [{ commentType: CommentType.Text, content: formatFindingComment(finding) }],
      status: threadStatus,
      threadContext,
      properties: { [FINDING_PROPERTY]: 'true', [FINGERPRINT_PROPERTY]: finding.fingerprint },
    };

    try {
      await gitApi.createThread(thread, repositoryId, pullRequestId);
      console.log(`Posted finding (${finding.severity}) on ${finding.file}${finding.line ? `:${finding.line}` : ''}`);
    } catch (err) {
      console.log(`Could not post finding for ${finding.file}: ${err}`);
    }
  }

  // Close threads whose finding no longer appears in this run.
  for (const [fingerprint, thread] of openByFingerprint.entries()) {
    if (currentFingerprints.has(fingerprint)) continue;
    if (!thread.id) continue;
    try {
      await gitApi.updateThread(
        { status: CommentThreadStatus.Closed },
        repositoryId,
        pullRequestId,
        thread.id
      );
      console.log(`Closed stale finding thread ${thread.id}.`);
    } catch (err) {
      console.log(`Could not close stale thread ${thread.id}: ${err}`);
    }
  }
}
