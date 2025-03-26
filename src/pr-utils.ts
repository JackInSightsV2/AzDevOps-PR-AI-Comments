import * as azdev from 'azure-devops-node-api';
import {
  GitPullRequestIterationChanges,
  VersionControlChangeType,
  GitVersionType
} from 'azure-devops-node-api/interfaces/GitInterfaces';
import { Readable } from 'stream';
import path from 'path';

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
  project?: string
): Promise<string> {
  console.log(`Getting diff for PR #${pullRequestId} in repository ${repositoryId}`);

  const gitApi = await connection.getGitApi();

  // Get all iterations for the PR
  const iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project);
  if (!iterations || iterations.length === 0) {
    return 'No iterations found for this pull request.';
  }

  // Use the latest iteration
  const latestIteration = iterations[iterations.length - 1];
  if (!latestIteration.id) {
    return 'Could not determine the latest iteration ID for this pull request.';
  }
  const iterationId = typeof latestIteration.id === 'string'
    ? parseInt(latestIteration.id, 10)
    : latestIteration.id;

  // Retrieve changes for the latest iteration
  const iterationChanges: GitPullRequestIterationChanges =
    await gitApi.getPullRequestIterationChanges(repositoryId, pullRequestId, iterationId, project);
  if (!iterationChanges.changeEntries || iterationChanges.changeEntries.length === 0) {
    return 'No changes found in this pull request.';
  }

  // Object to hold file diffs
  const fileDiffs: Record<string, string> = {};
  // Extensions to skip (binaries)
  const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'ico', 'vsix', 'exe', 'dll', 'pdb', 'zip', 'tar', 'gz', 'bin'];

  /**
   * Helper function to retrieve file content as a string using getItemText.
   * We pass undefined for optional parameters until the version descriptor slot,
   * and cast that parameter as any to avoid TS errors.
   */
  async function getFileContentAsString(filePath: string, objectId?: string): Promise<string> {
    if (!objectId) return 'No valid objectId for file.';
    try {
      let contentStream: any;
      try {
        contentStream = await gitApi.getItemText(
          repositoryId,       // repoId
          filePath,           // path
          project,            // project
          undefined,          // fileName
          undefined,          // download?
          undefined,          // scopePath
          undefined,          // recursionLevel
          undefined,          // includeContentMetadata
          undefined,          // latestProcessedChange
          undefined,          // format
          { version: objectId, versionType: GitVersionType.Commit } as any // versionDescriptor cast as any
        );
      } catch (err) {
        console.warn(`getItemText failed for ${filePath}: ${err}`);
        // Fallback to getItemContent with the same parameter order
        contentStream = await gitApi.getItemContent(
          repositoryId,
          filePath,
          project,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { version: objectId, versionType: GitVersionType.Commit } as any
        );
      }
      return await streamToString(contentStream);
    } catch (error) {
      console.error(`Error retrieving content for ${filePath}: ${error}`);
      return `Could not retrieve file content: ${error}`;
    }
  }

  // Process each change in the iteration
  for (const change of iterationChanges.changeEntries) {
    if (!change.item || !change.item.path) continue;
    const filePath = change.item.path;
    const fileExt = filePath.split('.').pop()?.toLowerCase() || '';
    if (binaryExtensions.includes(fileExt)) {
      console.log(`Skipping binary file: ${filePath}`);
      continue;
    }
    // Use change.item.objectId as the new content reference
    const objectId = change.item.objectId;
    if (change.changeType === VersionControlChangeType.Add) {
      const content = await getFileContentAsString(filePath, objectId);
      const lines = content.split('\n');
      fileDiffs[filePath] = lines.length > 100
        ? `Added file (truncated to 100 lines):\n\n${lines.slice(0, 100).join('\n')}\n\n(File truncated due to size)`
        : `Added file:\n\n${content}`;
    } else if (change.changeType === VersionControlChangeType.Edit) {
      const content = await getFileContentAsString(filePath, objectId);
      const lines = content.split('\n');
      fileDiffs[filePath] = lines.length > 100
        ? `Modified file (truncated to 100 lines):\n\n${lines.slice(0, 100).join('\n')}\n\n(File truncated due to size)`
        : `Modified file:\n\n${content}`;
    } else if (change.changeType === VersionControlChangeType.Delete) {
      fileDiffs[filePath] = `File was deleted: ${filePath}`;
    }
  }

  if (Object.keys(fileDiffs).length === 0) {
    return 'No file changes found in this pull request that could be processed.';
  }

  let result = '###FILE_DIFFS_START###\n';
  for (const [filePath, diffContent] of Object.entries(fileDiffs)) {
    result += `###FILE_PATH:${filePath}###\n${diffContent}\n###FILE_CONTENT_END###\n`;
  }
  result += '###FILE_DIFFS_END###';

  return result;
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
): Promise<Record<string, string>> {
  try {
    console.log(`Getting changed file names from PR #${pullRequestId} in repository ${repositoryId}`);
    console.log(`Maximum file size set to ${maxFileSizeInLines} lines`);

    // Track the start time to log performance
    const startTime = new Date();
    
    // Source directory where the branch is checked out
    const buildSourcesDir = process.env['BUILD_SOURCESDIRECTORY'] || '';
    if (!buildSourcesDir) {
      console.log('❌ BUILD_SOURCESDIRECTORY environment variable is not set');
      return { 'ERROR.txt': 'BUILD_SOURCESDIRECTORY environment variable is not set. Cannot locate files.' };
    }
    console.log(`Build source directory: ${buildSourcesDir}`);

    const gitApi = await connection.getGitApi();
    console.log('Successfully connected to Git API');

    // Log step to make debugging easier
    console.log('STEP 1: Getting PR iterations to identify latest changes');
    
    // Get iterations and use the latest iteration
    let iterations;
    try {
      iterations = await gitApi.getPullRequestIterations(repositoryId, pullRequestId, project);
      console.log(`Retrieved ${iterations?.length || 0} iterations for PR #${pullRequestId}`);
    } catch (iterError) {
      console.log(`❌ Error getting PR iterations: ${JSON.stringify(iterError)}`);
      return { 'ERROR.txt': `Could not get PR iterations: ${iterError}` };
    }
    
    if (!iterations || iterations.length === 0) {
      console.log('❌ No iterations found for this pull request');
      return { 'ERROR.txt': 'No iterations found for this pull request' };
    }

    // Use the latest iteration
    const latestIteration = iterations[iterations.length - 1];
    if (!latestIteration.id) {
      console.log('❌ Could not determine the latest iteration ID');
      return { 'ERROR.txt': 'Could not determine the latest iteration ID' };
    }
    
    const iterationId = typeof latestIteration.id === 'string'
      ? parseInt(latestIteration.id, 10)
      : latestIteration.id;
    console.log(`Using iteration ID: ${iterationId}`);

    // Log step to make debugging easier
    console.log('STEP 2: Getting changed files for the latest iteration');
    
    // Get the changed files from the latest iteration
    let changes;
    try {
      changes = await gitApi.getPullRequestIterationChanges(repositoryId, pullRequestId, iterationId, project);
      console.log(`Retrieved changes for iteration ${iterationId}`);
    } catch (changesError) {
      console.log(`❌ Error getting PR changes: ${JSON.stringify(changesError)}`);
      return { 'ERROR.txt': `Could not get PR changes: ${changesError}` };
    }

    // Check if we have valid changes
    if (!changes || !changes.changeEntries || changes.changeEntries.length === 0) {
      console.log('❌ No changes found in the latest PR iteration');
      return { 'ERROR.txt': 'No changes found in the latest PR iteration' };
    }

    // Log step to make debugging easier
    console.log('STEP 3: Processing changed files');
    console.log(`Found ${changes.changeEntries.length} changes in PR #${pullRequestId}`);
    
    // Extract the list of changed file paths
    const changedFilePaths: string[] = [];
    
    for (const change of changes.changeEntries) {
      if (!change.item || !change.item.path) {
        console.log('⚠️ Change entry missing item or path, skipping');
        continue;
      }
      
      const filePath = change.item.path;
      console.log(`Processing change: ${filePath}, change type: ${change.changeType}`);
      
      // Skip deleted files
      if (change.changeType === VersionControlChangeType.Delete) {
        console.log(`Skipping deleted file: ${filePath}`);
        continue;
      }
      
      // Skip binary files
      if (isBinaryFile(filePath)) {
        console.log(`Skipping binary file: ${filePath}`);
        continue;
      }
      
      changedFilePaths.push(filePath);
    }
    
    if (changedFilePaths.length === 0) {
      console.log('❌ No relevant files found in PR changes');
      return { 'ERROR.txt': 'No relevant files found in PR changes' };
    }
    
    console.log(`STEP 4: Reading ${changedFilePaths.length} files from disk`);

    // Read the file contents from the local workspace
    const completeFiles: Record<string, string> = {};
    const fs = require('fs');
    
    for (const filePath of changedFilePaths) {
      const fullPath = path.join(buildSourcesDir, filePath);
      console.log(`Reading file from disk: ${fullPath}`);
      
      try {
        // Check if file exists
        if (!fs.existsSync(fullPath)) {
          console.log(`⚠️ File not found on disk: ${fullPath}`);
          continue;
        }
        
        // Read file content
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        
        // Apply line limit if needed
        if (lines.length > maxFileSizeInLines) {
          console.log(`📝 File ${filePath} is too large (${lines.length} lines), truncating to ${maxFileSizeInLines} lines`);
          completeFiles[filePath] = `File truncated to ${maxFileSizeInLines} lines due to size:\n\n` +
                                  lines.slice(0, maxFileSizeInLines).join('\n');
        } else {
          completeFiles[filePath] = content;
        }
        
        console.log(`✅ Successfully read file: ${filePath} (${lines.length} lines)`);
      } catch (fsError) {
        console.log(`❌ Error reading file from disk: ${fsError}`);
      }
    }
    
    // Calculate elapsed time
    const endTime = new Date();
    const elapsedMs = endTime.getTime() - startTime.getTime();
    
    if (Object.keys(completeFiles).length === 0) {
      console.log(`❌ No files were successfully read after ${elapsedMs}ms`);
      return { 'ERROR.txt': 'Failed to read any files from the PR changes' };
    } else {
      console.log(`✅ Retrieved ${Object.keys(completeFiles).length} files in ${elapsedMs}ms`);
      
      // Log all files that were successfully read
      console.log('Files successfully read:');
      Object.keys(completeFiles).forEach(file => {
        const lineCount = completeFiles[file].split('\n').length;
        console.log(`- ${file} (${lineCount} lines)`);
      });
    }
    
    return completeFiles;
  } catch (error) {
    console.log(`❌ Unexpected error in getPullRequestFiles: ${error}`);
    return { 'ERROR.txt': `Unexpected error: ${error}` };
  }
}
