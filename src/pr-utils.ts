import * as azdev from 'azure-devops-node-api';
import {
  GitPullRequestIterationChanges,
  VersionControlChangeType,
  GitVersionType,
  CommentType
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { Readable } from 'stream';
import path from 'path';
import { structuredPatch } from 'diff';

export interface PullRequestAnalysisTarget {
  content: string;
  isDiff: boolean;
  firstChangedLine?: number;
  truncated?: boolean;
  // Right-file line numbers that were added/modified in this change. These are
  // the only lines an inline finding may legitimately anchor to. Undefined for
  // full-file targets (where we don't compute a diff).
  changedLines?: number[];
}

// Contextual signals about the PR (beyond the diffs) fed to the holistic
// reviewer so it can judge intent. Every field is best-effort: a failed fetch
// yields an empty value rather than aborting the review.
export interface PullRequestContext {
  title: string;
  description: string;
  workItems: string[];
  humanComments: string[];
}

type ChangeEntries = NonNullable<GitPullRequestIterationChanges['changeEntries']>;

/**
 * Converts a returned content (string or stream) into a string.
 */
async function streamToString(obj: any): Promise<string> {
  if (typeof obj === 'string') {
    return obj;
  }
  if (!obj) {
    return '';
  }
  // Check for browser ReadableStream
  if (typeof ReadableStream !== 'undefined' && obj instanceof ReadableStream) {
    const reader = obj.getReader();
    let result = '';
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) {
        result += new TextDecoder().decode(value);
      }
    }
    return result;
  }
  // Fallback: if it's a Node.js Readable stream
  if (obj instanceof Readable) {
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      obj.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      obj.on('error', (err) => reject(err));
      obj.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  }
  return String(obj);
}

/**
 * Determines if a file is likely to be binary based on its extension.
 */
function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.ico', '.webp',
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.bin', '.dat', '.class',
    '.mp3', '.mp4', '.avi', '.mov', '.flv'
  ];
  const extension = path.extname(filePath).toLowerCase();
  return binaryExtensions.includes(extension);
}

/**
 * Retrieves the diff of a pull request (added/modified/deleted files)
 * and returns a formatted string with custom markers.
 */
export async function getPullRequestDiff(
  connection: azdev.WebApi,
  repositoryId: string,
  pullRequestId: number,
  project?: string,
  maxDiffLines: number = 600
): Promise<Record<string, PullRequestAnalysisTarget>> {
  try {
    console.log(`Getting diff for PR #${pullRequestId} in repository ${repositoryId}`);
    const { gitApi, changeEntries } = await loadLatestIterationChanges(connection, repositoryId, pullRequestId, project);

    const fileDiffs: Record<string, PullRequestAnalysisTarget> = {};
    for (const change of changeEntries) {
      if (!change.item || !change.item.path) {
        continue;
      }

      const filePath = change.item.path;
      if (isBinaryFile(filePath)) {
        console.log(`Skipping binary file: ${filePath}`);
        continue;
      }

      if (change.changeType === VersionControlChangeType.Delete) {
        fileDiffs[filePath] = {
          content: `File was deleted: ${filePath}`,
          isDiff: true,
          firstChangedLine: 1
        };
        continue;
      }

      const newObjectId = change.item.objectId;
      const baseObjectId = (change as any)?.originalObjectId ?? change.item?.originalObjectId;
      const basePath = (change as any)?.originalPath ?? filePath;

      const newContent = await getContentForObjectId(
        gitApi,
        repositoryId,
        project,
        filePath,
        newObjectId
      );
      if (!newContent) {
        console.log(`⚠️ Unable to retrieve new content for ${filePath}, skipping diff generation.`);
        continue;
      }

      const baseContent = baseObjectId
        ? await getContentForObjectId(gitApi, repositoryId, project, basePath, baseObjectId)
        : '';

      const annotated = buildAnnotatedDiff(
        basePath || filePath,
        filePath,
        baseContent ?? '',
        newContent ?? ''
      );

      let diffContent = annotated.text;
      let truncated = false;

      const diffLines = diffContent.split('\n');
      if (diffLines.length > maxDiffLines) {
        diffContent = diffLines.slice(0, maxDiffLines).join('\n') +
          `\n\n(Diff truncated to ${maxDiffLines} lines)`;
        truncated = true;
      }

      fileDiffs[filePath] = {
        content: diffContent,
        isDiff: true,
        firstChangedLine: annotated.firstChangedLine ?? 1,
        truncated,
        changedLines: annotated.changedLines
      };
    }

    if (Object.keys(fileDiffs).length === 0) {
      return buildErrorTarget('No file changes found in this pull request that could be processed.', true);
    }

    return fileDiffs;
  } catch (error) {
    console.log(`❌ Unexpected error in getPullRequestDiff: ${error}`);
    return buildErrorTarget(`Unexpected error: ${error}`, true);
  }
}

/**
 * Retrieves the complete files modified in a pull request for LLM analysis.
 * It gets the list of changed file paths from the PR API, then reads the files directly
 * from the local workspace where the branch is checked out.
 * 
 * @param connection The Azure DevOps connection.
 * @param repositoryId The repository ID.
 * @param pullRequestId The pull request ID.
 * @param project Optional project name.
 * @param maxFileSizeInLines Maximum number of lines per file (defaults to 1500).
 * @returns A record with file paths as keys and their content as values.
 */
export async function getPullRequestFiles(
  connection: azdev.WebApi,
  repositoryId: string,
  pullRequestId: number,
  project?: string,
  maxFileSizeInLines: number = 1500
): Promise<Record<string, PullRequestAnalysisTarget>> {
  try {
    console.log(`Getting changed file names from PR #${pullRequestId} in repository ${repositoryId}`);
    console.log(`Maximum file size set to ${maxFileSizeInLines} lines`);

    const startTime = new Date();
    const buildSourcesDir = process.env['BUILD_SOURCESDIRECTORY'] || '';
    if (!buildSourcesDir) {
      console.log('❌ BUILD_SOURCESDIRECTORY environment variable is not set');
      return buildErrorTarget('BUILD_SOURCESDIRECTORY environment variable is not set. Cannot locate files.');
    }
    console.log(`Build source directory: ${buildSourcesDir}`);

    const { changeEntries } = await loadLatestIterationChanges(connection, repositoryId, pullRequestId, project);
    console.log('STEP 3: Processing changed files');
    console.log(`Found ${changeEntries.length} changes in PR #${pullRequestId}`);

    const changedFilePaths: string[] = [];
    for (const change of changeEntries) {
      if (!change.item || !change.item.path) {
        console.log('⚠️ Change entry missing item or path, skipping');
        continue;
      }

      const filePath = change.item.path;
      console.log(`Processing change: ${filePath}, change type: ${change.changeType}`);

      if (change.changeType === VersionControlChangeType.Delete) {
        console.log(`Skipping deleted file: ${filePath}`);
        continue;
      }

      if (isBinaryFile(filePath)) {
        console.log(`Skipping binary file: ${filePath}`);
        continue;
      }

      changedFilePaths.push(filePath);
    }

    if (changedFilePaths.length === 0) {
      console.log('❌ No relevant files found in PR changes');
      return buildErrorTarget('No relevant files found in PR changes');
    }

    console.log(`STEP 4: Reading ${changedFilePaths.length} files from disk`);

    const completeFiles: Record<string, PullRequestAnalysisTarget> = {};
    const fs = require('fs');

    for (const filePath of changedFilePaths) {
      const fullPath = path.join(buildSourcesDir, filePath);
      console.log(`Reading file from disk: ${fullPath}`);

      try {
        if (!fs.existsSync(fullPath)) {
          console.log(`⚠️ File not found on disk: ${fullPath}`);
          continue;
        }

        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');

        let normalizedContent = content;
        let truncated = false;
        if (lines.length > maxFileSizeInLines) {
          console.log(`📝 File ${filePath} is too large (${lines.length} lines), truncating to ${maxFileSizeInLines} lines`);
          normalizedContent = `File truncated to ${maxFileSizeInLines} lines due to size:\n\n` +
            lines.slice(0, maxFileSizeInLines).join('\n');
          truncated = true;
        }

        completeFiles[filePath] = {
          content: normalizedContent,
          isDiff: false,
          firstChangedLine: 1,
          truncated
        };

        console.log(`✅ Successfully read file: ${filePath} (${lines.length} lines)`);
      } catch (fsError) {
        console.log(`❌ Error reading file from disk: ${fsError}`);
      }
    }

    const endTime = new Date();
    const elapsedMs = endTime.getTime() - startTime.getTime();

    if (Object.keys(completeFiles).length === 0) {
      console.log(`❌ No files were successfully read after ${elapsedMs}ms`);
      return buildErrorTarget('Failed to read any files from the PR changes');
    }

    console.log(`✅ Retrieved ${Object.keys(completeFiles).length} files in ${elapsedMs}ms`);
    console.log('Files successfully read:');
    Object.keys(completeFiles).forEach(file => {
      const target = completeFiles[file];
      const lineCount = target.content.split('\n').length;
      console.log(`- ${file} (${lineCount} lines)`);
    });

    return completeFiles;
  } catch (error: any) {
    console.log(`❌ Unexpected error in getPullRequestFiles: ${error}`);
    const message = error?.message ?? `Unexpected error: ${error}`;
    return buildErrorTarget(message);
  }
}

/**
 * Builds a unified diff where every emitted line is prefixed with its real
 * new-file (right-side) line number, and collects the set of right-side line
 * numbers that were added/modified. The line numbers let the AI cite an exact
 * line, and `changedLines` lets the orchestrator validate that a cited line is
 * a legitimate inline anchor (snap/drop otherwise).
 *
 * Format per line:
 *   "   123 + added text"      (addition — anchorable, recorded in changedLines)
 *   "       - removed text"    (deletion — no right-side line)
 *   "   123   context text"    (unchanged context)
 */
export function buildAnnotatedDiff(
  oldPath: string,
  newPath: string,
  oldStr: string,
  newStr: string
): { text: string; changedLines: number[]; firstChangedLine?: number } {
  const patch = structuredPatch(oldPath, newPath, oldStr, newStr, '', '', { context: 3 });
  const out: string[] = [];
  const changedLines: number[] = [];
  let firstChangedLine: number | undefined;

  for (const hunk of patch.hunks) {
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    let newLineNo = hunk.newStart;

    for (const raw of hunk.lines) {
      const marker = raw[0];
      const text = raw.slice(1);

      if (marker === '+') {
        out.push(`${String(newLineNo).padStart(6)} + ${text}`);
        changedLines.push(newLineNo);
        if (firstChangedLine === undefined) {
          firstChangedLine = newLineNo;
        }
        newLineNo++;
      } else if (marker === '-') {
        // Removed line — exists only on the left/base side, no right-file number.
        out.push(`${' '.repeat(6)} - ${text}`);
      } else if (marker === '\\') {
        // "\ No newline at end of file" — metadata, not a real line.
        out.push(`${' '.repeat(6)}   ${text}`);
      } else {
        // Context line (leading space).
        out.push(`${String(newLineNo).padStart(6)}   ${text}`);
        newLineNo++;
      }
    }
  }

  return { text: out.join('\n'), changedLines, firstChangedLine };
}

/**
 * Best-effort fetch of contextual signals about the PR (title, description,
 * linked work items, existing human comments) for the holistic reviewer. Each
 * source is fetched independently; a failure logs a warning and yields an empty
 * value rather than aborting the review.
 */
export async function getPullRequestContext(
  connection: azdev.WebApi,
  repositoryId: string,
  pullRequestId: number,
  project?: string
): Promise<PullRequestContext> {
  const ctx: PullRequestContext = { title: '', description: '', workItems: [], humanComments: [] };

  let gitApi: any;
  try {
    gitApi = await connection.getGitApi();
  } catch (error) {
    console.log(`⚠️ Could not connect to Git API for PR context: ${error}`);
    return ctx;
  }

  // Title + description
  try {
    const pr = await gitApi.getPullRequestById(pullRequestId, project);
    ctx.title = pr?.title ?? '';
    ctx.description = pr?.description ?? '';
  } catch (error) {
    console.log(`⚠️ Could not fetch PR title/description: ${error}`);
  }

  // Linked work items (acceptance criteria etc.)
  try {
    const refs = await gitApi.getPullRequestWorkItemRefs(repositoryId, pullRequestId, project);
    const ids = (refs ?? [])
      .map((r: any) => parseInt(r.id, 10))
      .filter((n: number) => !Number.isNaN(n));
    if (ids.length > 0) {
      const witApi = await connection.getWorkItemTrackingApi();
      const items = await witApi.getWorkItems(
        ids,
        ['System.WorkItemType', 'System.Title', 'System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria']
      );
      for (const wi of items ?? []) {
        const fields = wi.fields ?? {};
        const type = fields['System.WorkItemType'] ?? 'Work Item';
        const title = fields['System.Title'] ?? '';
        const desc = stripHtml(fields['System.Description'] ?? '');
        const ac = stripHtml(fields['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '');
        let entry = `${type} #${wi.id}: ${title}`;
        if (desc) {
          entry += `\n  ${desc}`;
        }
        if (ac) {
          entry += `\n  Acceptance criteria: ${ac}`;
        }
        ctx.workItems.push(entry);
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not fetch linked work items: ${error}`);
  }

  // Existing human comments (skip our own machine-posted threads)
  try {
    const threads = await gitApi.getThreads(repositoryId, pullRequestId, project);
    for (const thread of threads ?? []) {
      const props = thread.properties ?? {};
      if (props['PullRequestCommentTask'] || props['AiReviewFinding'] || props['AiReviewSummary']) {
        continue;
      }
      for (const comment of thread.comments ?? []) {
        if (comment.commentType === CommentType.System) {
          continue;
        }
        const content = (comment.content ?? '').trim();
        if (content) {
          ctx.humanComments.push(content);
        }
      }
    }
  } catch (error) {
    console.log(`⚠️ Could not fetch existing PR threads: ${error}`);
  }

  return ctx;
}

/** Strips HTML tags and decodes the most common entities from work-item fields. */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadLatestIterationChanges(
  connection: azdev.WebApi,
  repositoryId: string,
  pullRequestId: number,
  project?: string
): Promise<{ gitApi: any; iterationId: number; changeEntries: ChangeEntries }> {
  const gitApi = await connection.getGitApi();
  console.log('Successfully connected to Git API');

  console.log('STEP 1: Getting PR iterations to identify latest changes');
  let iterations;
  try {
    iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project);
    console.log(`Retrieved ${iterations?.length || 0} iterations for PR #${pullRequestId}`);
  } catch (iterError) {
    console.log(`❌ Error getting PR iterations: ${JSON.stringify(iterError)}`);
    throw new Error(`Could not get PR iterations: ${iterError}`);
  }

  if (!iterations || iterations.length === 0) {
    console.log('❌ No iterations found for this pull request');
    throw new Error('No iterations found for this pull request');
  }

  const latestIteration = iterations[iterations.length - 1];
  if (!latestIteration.id) {
    console.log('❌ Could not determine the latest iteration ID');
    throw new Error('Could not determine the latest iteration ID');
  }

  const iterationId = typeof latestIteration.id === 'string'
    ? parseInt(latestIteration.id, 10)
    : latestIteration.id;
  console.log(`Using iteration ID: ${iterationId}`);

  console.log('STEP 2: Getting changed files for the latest iteration');
  let changes: GitPullRequestIterationChanges;
  try {
    changes = await gitApi.getPullRequestIterationChanges(repositoryId, pullRequestId, iterationId, project);
    console.log(`Retrieved changes for iteration ${iterationId}`);
  } catch (changesError) {
    console.log(`❌ Error getting PR changes: ${JSON.stringify(changesError)}`);
    throw new Error(`Could not get PR changes: ${changesError}`);
  }

  if (!changes || !changes.changeEntries || changes.changeEntries.length === 0) {
    console.log('❌ No changes found in the latest PR iteration');
    throw new Error('No changes found in the latest PR iteration');
  }

  const changeEntries = changes.changeEntries;
  if (!changeEntries || changeEntries.length === 0) {
    console.log('❌ No change entries returned for this iteration');
    throw new Error('No change entries returned for this iteration');
  }

  return { gitApi, iterationId, changeEntries: changeEntries as ChangeEntries };
}

async function getContentForObjectId(
  gitApi: any,
  repositoryId: string,
  project: string | undefined,
  filePath: string,
  objectId?: string
): Promise<string> {
  if (!objectId) {
    return '';
  }

  try {
    let contentStream: any;
    
    // First, try to get blob content directly using the object ID
    // The objectId from PR iteration changes is a blob SHA, not a commit SHA
    try {
      console.log(`Attempting to get blob content for ${filePath} with objectId: ${objectId}`);
      contentStream = await gitApi.getBlobContent(
        repositoryId,
        objectId,       // sha1 - the blob object ID
        project,
        true,           // download - return as downloadable content
        filePath        // fileName - for content-disposition header
      );
    } catch (blobErr) {
      console.warn(`getBlobContent failed for ${filePath}: ${blobErr}`);
      
      // Fallback: try getItemText with the file path directly (without version)
      // This gets the file from the default branch, which may be different
      try {
        console.log(`Fallback: trying getItemText for ${filePath}`);
        contentStream = await gitApi.getItemText(
          repositoryId,
          filePath,
          project
        );
      } catch (itemErr) {
        console.warn(`getItemText also failed for ${filePath}: ${itemErr}`);
        return '';
      }
    }

    const content = await streamToString(contentStream);
    if (content) {
      console.log(`✅ Successfully retrieved content for ${filePath} (${content.length} chars)`);
    } else {
      console.log(`⚠️ Retrieved empty content for ${filePath}`);
    }
    return content;
  } catch (error) {
    console.error(`Error retrieving content for ${filePath} (${objectId}): ${error}`);
    return '';
  }
}

function buildErrorTarget(message: string, isDiff = false): Record<string, PullRequestAnalysisTarget> {
  return {
    'ERROR.txt': {
      content: message,
      isDiff,
      firstChangedLine: 1
    }
  };
}
