import tl = require('azure-pipelines-task-lib/task')
import azdev = require('azure-devops-node-api')
import { Comment, CommentThreadStatus, CommentType, GitPullRequestCommentThread } from 'azure-devops-node-api/interfaces/GitInterfaces'
import * as fs from 'fs'
import * as path from 'path'
import { createAIService } from './ai-services'
import { getPullRequestDiff, getPullRequestFiles, getPullRequestContext, PullRequestAnalysisTarget } from './pr-utils'
import { runHolisticReview, normalizeSeverity } from './review-orchestrator'
import { postReview } from './review-poster'

async function run() {
  try {
    // Check if AI generation is enabled
    const useAIGeneration = tl.getBoolInput('useAIGeneration', false);
    let commentContent: string | undefined = undefined;

    // Get PR information first as we'll need it for both paths
    const pullRequestInput: string | undefined = tl.getInput('pullRequestId', false) ?? tl.getVariable('System.PullRequest.PullRequestId') ?? '-1'
    const pullRequestId = parseInt(pullRequestInput)
    if (pullRequestId < 0) {
      console.log(`No pull request id - skipping PR comment`)
      return
    }
    const repositoryId: string | undefined = tl.getInput('repositoryId', false) ?? tl.getVariable('Build.Repository.ID') ?? ''

    // Set up Azure DevOps connection
    const accessToken = tl.getEndpointAuthorizationParameter('SystemVssConnection', 'AccessToken', false) ?? ''
    const authHandler = azdev.getPersonalAccessTokenHandler(accessToken)
    const collectionUri = tl.getVariable('System.CollectionUri') ?? ''
    const connection = new azdev.WebApi(collectionUri, authHandler)
    
    // Get the Git API
    const gitApi = await connection.getGitApi();
    const isActive = tl.getBoolInput('active', false);

    // If AI generation is enabled, generate the comment using the selected provider
    if (useAIGeneration) {
      console.log('AI comment generation is enabled');
      
      // Get AI configuration
      const aiProvider = tl.getInput('aiProvider', true) ?? 'openai';
      const modelName = tl.getInput('modelName', false) ?? '';
      // apiKey is not required for Ollama (local models need no key). For every
      // other provider, createAIService throws a clear error if it's missing.
      const apiKey = tl.getInput('apiKey', false) ?? '';
      
      // Get the appropriate API endpoint based on the provider
      let apiEndpoint = '';
      if (aiProvider === 'azure') {
        apiEndpoint = tl.getInput('azureApiEndpoint', false) ?? '';
      } else if (aiProvider === 'ollama') {
        apiEndpoint = tl.getInput('ollamaApiEndpoint', false) ?? 'http://localhost:11434';
      }
        
      const promptTemplate = tl.getInput('promptTemplate', false) ?? 'Review the following code file and provide constructive feedback:\n\n{diff}';
      const maxTokens = parseInt(tl.getInput('maxTokens', false) ?? '1000');
      const temperature = parseFloat(tl.getInput('temperature', false) ?? '0.7');
      const enableInlineComments = tl.getBoolInput('enableInlineComments', false);
      const analyzeChangesOnly = tl.getBoolInput('analyzeChangesOnly', false);
        
      // Get max file size in lines (defaults to 1500 if not specified)
      const maxFileSizeInLines = parseInt(tl.getInput('maxFileSizeInLines', false) ?? '1500');

      // Review mode: holistic (default) sees the whole PR at once and posts a
      // summary + line-anchored findings; perFile preserves the legacy loop.
      const reviewMode = (tl.getInput('reviewMode', false) ?? 'holistic').trim().toLowerCase();
      if (reviewMode !== 'perfile') {
        await runHolisticReviewMode(
          connection,
          gitApi,
          repositoryId,
          pullRequestId,
          isActive,
          {
            aiProvider,
            apiKey,
            modelName,
            apiEndpoint,
            maxTokens,
            temperature,
            maxFileSizeInLines,
            promptTemplate,
          }
        );
        return;
      }

      try {
        // Get coding standards if specified
        let codingStandards = '';
        const codingStandardsFile: string | undefined = tl.getPathInput('codingStandardsFile', false);
        if (codingStandardsFile && tl.filePathSupplied('codingStandardsFile')) {
          console.log(`Coding standards file given: ${codingStandardsFile}`);
          if (!fs.existsSync(codingStandardsFile)) {
            console.log(`Warning: Coding standards file ${codingStandardsFile} does not exist. Proceeding without coding standards.`);
          } else {
            try {
              codingStandards = fs.readFileSync(codingStandardsFile, 'utf8');
              console.log(`Successfully read coding standards file (${codingStandards.length} characters)`);
            } catch (err: any) {
              console.log(`Error reading coding standards file: ${err.message}. Proceeding without coding standards.`);
            }
          }
        }

          const analysisModeLabel = analyzeChangesOnly ? 'changes-only' : 'full-file';
          console.log(`Analysis mode: ${analysisModeLabel === 'changes-only' ? 'Using PR diffs (changed lines only)' : 'Using full file contents'}`);
          console.log(`Maximum input size set to ${maxFileSizeInLines} lines`);

          const inlineCommentsEnabled = enableInlineComments && analyzeChangesOnly;
          if (enableInlineComments && !analyzeChangesOnly) {
            console.log('Inline comments require analyzeChangesOnly=true; falling back to file-level comments.');
          }

          const analysisTargets: Record<string, PullRequestAnalysisTarget> = analyzeChangesOnly
            ? await getPullRequestDiff(connection, repositoryId, pullRequestId, undefined, maxFileSizeInLines)
            : await getPullRequestFiles(connection, repositoryId, pullRequestId, undefined, maxFileSizeInLines);

          const analysisEntries = Object.entries(analysisTargets);
          if (analysisEntries.length === 0) {
            console.log('No files could be retrieved for analysis');
            tl.setResult(tl.TaskResult.Failed, 'No files could be retrieved for analysis');
            return;
          }

          if (analysisEntries.length === 1 && analysisEntries[0][0] === 'ERROR.txt') {
            const errorMessage = analysisEntries[0][1]?.content ?? 'No files could be retrieved for analysis';
            console.log(`Analysis error: ${errorMessage}`);
            tl.setResult(tl.TaskResult.Failed, errorMessage);
            return;
          }
          
          console.log(`Retrieved ${analysisEntries.length} analysis targets`);
        
          // Create a comment for each file
          for (const [filePath, analysisTarget] of analysisEntries) {
            if (filePath === 'ERROR.txt') {
              continue;
            }
            if (!analysisTarget || !analysisTarget.content) {
              console.log(`Skipping file ${filePath} - no content available`);
              continue;
            }

            // Get file extensions to process (if specified)
            const fileExtensions = tl.getDelimitedInput('allowedFileExtensions', ',', false) || [];
            if (fileExtensions.length > 0) {
              const fileExtension = path.extname(filePath).toLowerCase();
              const shouldProcess = fileExtensions.some((ext: string) => {
                const normalizedExt = ext.trim().toLowerCase();
                return normalizedExt === fileExtension || normalizedExt === fileExtension.substring(1);
              });
              
              if (!shouldProcess) {
                console.log(`Skipping file ${filePath} - extension ${fileExtension} not in allowed list: ${fileExtensions.join(', ')}`);
                continue;
              }
            }

            const exclusionString = tl.getInput('exclusionString', false);
            if (exclusionString && analysisTarget.content.includes(exclusionString)) {
              console.log(`Skipping file ${filePath} - excluded by user`);
              continue;
            }

            // Create a file-specific prompt
            const filePrompt = promptTemplate
              .replace('{diff}', `File: ${filePath}\n\n${analysisTarget.content}`)
              .replace('{standards}', codingStandards)
              .replace('{analysisMode}', analysisTarget.isDiff ? 'diff' : 'full');
            
            // Save prompt to file
            savePromptToFile(filePrompt, aiProvider);
            
            // Generate a comment for this file
            console.log(`Generating comment for file: ${filePath} (${analysisTarget.isDiff ? 'diff' : 'full'})`);
            const aiService = createAIService(aiProvider, apiKey, modelName, apiEndpoint);
            const aiResponse = await aiService.generateComment(filePrompt, maxTokens, temperature);
            
            if (aiResponse.error) {
              console.log(`Error generating AI comment for ${filePath}: ${aiResponse.error}`);
              continue;
            }
            
            // Create a thread for this file
            let fileCommentContent = `**AI Review for ${filePath}**\n\n${aiResponse.content}`;
            if (analysisTarget.truncated) {
              fileCommentContent += `\n\n_Note: Input content was truncated to ${maxFileSizeInLines} lines._`;
            }
            
            const threadContext = inlineCommentsEnabled
              ? {
                  filePath,
                  rightFileStart: {
                    line: analysisTarget.firstChangedLine ?? 1,
                    offset: 1,
                  },
                  rightFileEnd: {
                    line: analysisTarget.firstChangedLine ?? 1,
                    offset: 1,
                  },
                }
              : {
                  filePath,
                };
            
            if (inlineCommentsEnabled) {
              console.log(`Posting inline comment for ${filePath} at line ${analysisTarget.firstChangedLine ?? 1}`);
            }
          
            // Create a thread for this file
            const thread: GitPullRequestCommentThread = {
              comments: [{
                commentType: CommentType.Text,
                content: fileCommentContent,
              }],
              lastUpdatedDate: new Date(),
              publishedDate: new Date(),
              status: isActive ? CommentThreadStatus.Active : CommentThreadStatus.Closed,
              properties: {
                'PullRequestCommentTask': 'true'
              },
              threadContext
            };
            
            try {
              await gitApi.createThread(thread, repositoryId, pullRequestId);
              console.log(`Comment added for file: ${filePath}`);
            } catch (error) {
              console.log(`Error adding comment for file ${filePath}: ${error}`);
            }
          }
        
        // We've created comments for each file, so we don't need to create a general comment
        return;
        
      } catch (error: any) {
        console.log(`Error in AI comment generation: ${error.message}`);
        tl.setResult(tl.TaskResult.Failed, `Error in AI comment generation: ${error.message}`);
        return;
      }
    } else {
      // Use traditional comment input method
      const markdownFile: string | undefined = tl.getPathInput('markdownFile', false)
      // We need to check if the markdown file was given with "filePathSupplied"
      // because the task lib will return root folder string in any case as part of the getPathInput return value
      if (markdownFile != undefined && tl.filePathSupplied('markdownFile')) {
        console.log(`Markdown file given: ${markdownFile}`)
        if (!fs.existsSync(markdownFile)) {
          throw new Error(`File ${markdownFile} does not exist`)
        }
        console.log(`Reading markdown content from file: ${markdownFile}`)
        try {
          commentContent = fs.readFileSync(markdownFile, 'utf8')
        } catch (err: any) {
          console.log(`Error reading markdown file: ${err.message}`)
        }
      }
      
      // If no markdown file or reading failed, use the comment input
      if (!commentContent) {
        commentContent = tl.getInput('comment', true)
      }
    }

    // Validate comment content
    if (commentContent == '' || commentContent == undefined) {
      console.log(`Empty comment - skipping PR comment`)
      return
    }

    const addCommentOnlyOnce = tl.getBoolInput('addCommentOnlyOnce', false)
    if (addCommentOnlyOnce) {
      // Get old threads and check if there is already a thread with the comment task property
      const threads = await gitApi.getThreads(repositoryId, pullRequestId)
      console.log(`Checking if there is a thread with comment task property to add the PR comment only once`)
      if (threads != undefined && threads.length > 0) {
        for (const thread of threads) {
          console.log(`Checking thread: ${thread.id} with properties: ${JSON.stringify(thread.properties ?? {})}`)
          if (thread.properties != undefined && thread.properties['PullRequestCommentTask'] != undefined) {
            console.log(`Thread already exists with comment task property - skipping PR comment`)
            return
          }
        }
      }
    }

    const updatePreviousComment = tl.getBoolInput('updatePreviousComment', false)
    if (updatePreviousComment) {
      // Get old threads and check if there is already a thread with the comment task property
      const threads = await gitApi.getThreads(repositoryId, pullRequestId)
      console.log(`Checking if there is a thread with comment task property to update the PR comment`)
      if (threads != undefined && threads.length > 0) {
        for (const thread of threads) {
          console.log(`Checking thread: ${thread.id} with properties: ${JSON.stringify(thread.properties ?? {})}`)
          if (thread.properties != undefined &&
            thread.properties['PullRequestCommentTask'] != undefined &&
            thread.id != undefined) {
            console.log(`Thread already exists with comment task property - updating PR comment`)

            const comments = await gitApi.getComments(repositoryId, pullRequestId, thread.id)
            if (comments == undefined || comments.length < 1) {
              console.log(`No comments found in thread - skipping PR comment update`)
              break
            }
            console.log(`Updating first comment in thread: ${comments[0].id}`)

            const firstComment = comments[0]
            if (
              firstComment.commentType != CommentType.Text ||
              firstComment.id == undefined
            ) {
              console.log(`First comment is not a text comment - skipping PR comment update`)
              return
            }
            const updatedComment: Comment = {
              commentType: CommentType.Text,
              content: commentContent,
            }

            const c = await gitApi.updateComment(
              updatedComment,
              repositoryId,
              pullRequestId,
              thread.id,
              firstComment.id
            )
            console.log(`Comment updated on pull request: ${commentContent}`)
            return
          }
        }
      }
      console.log(`No thread found with comment task property - skipping PR comment update and adding new comment`)
    }

    const thread: GitPullRequestCommentThread = {
      comments: [{
        commentType: CommentType.Text,
        content: commentContent,
      }],
      lastUpdatedDate: new Date(),
      publishedDate: new Date(),
      status: isActive ? CommentThreadStatus.Active : CommentThreadStatus.Closed,
      properties: {
        'PullRequestCommentTask': 'true'
      }
    }
    const t = await gitApi.createThread(thread, repositoryId, pullRequestId)
    console.log(`Comment added on pull request: ${commentContent}`)
  }
  catch (err: any) {
    tl.setResult(tl.TaskResult.Failed, err.message)
  }
}

// Function to save prompt to file
function savePromptToFile(prompt: string, aiProvider: string): void {
  try {
    // Create a timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `prompt_${aiProvider}_${timestamp}.txt`;
    
    // Use the agent's temp directory or build directory
    const promptDir = path.join(tl.getVariable('Agent.TempDirectory') || tl.getVariable('Build.ArtifactStagingDirectory') || '.', 'ai_prompts');
    
    // Ensure directory exists
    if (!fs.existsSync(promptDir)) {
      fs.mkdirSync(promptDir, { recursive: true });
    }
    
    const filePath = path.join(promptDir, filename);
    
    // Write the prompt to the file
    fs.writeFileSync(filePath, prompt);
    
    console.log(`Prompt saved to: ${filePath}`);
  } catch (error) {
    console.log(`Error saving prompt to file: ${error}`);
  }
}

// The legacy per-file default template. In holistic mode this is treated as
// "not customized" so we use the built-in review instructions instead.
const DEFAULT_PER_FILE_TEMPLATE = 'Review the following code file and provide constructive feedback:\n\n{diff}';

interface HolisticArgs {
  aiProvider: string;
  apiKey: string;
  modelName: string;
  apiEndpoint: string;
  maxTokens: number;
  temperature: number;
  maxFileSizeInLines: number;
  promptTemplate: string;
}

// Orchestrates a holistic, whole-PR review: gather diffs + context, run the
// orchestrator, then post a summary thread and line-anchored findings with
// fingerprint dedup. Never hard-fails the task — malfunctions warn and set
// SucceededWithIssues.
async function runHolisticReviewMode(
  connection: azdev.WebApi,
  gitApi: any,
  repositoryId: string,
  pullRequestId: number,
  isActive: boolean,
  args: HolisticArgs
): Promise<void> {
  try {
    // Skip drafts if requested.
    const skipDraft = tl.getBoolInput('skipDraftPullRequests', false);
    if (skipDraft) {
      try {
        const pr = await gitApi.getPullRequestById(pullRequestId);
        if (pr?.isDraft) {
          console.log('Pull request is a draft and skipDraftPullRequests is enabled - skipping review.');
          return;
        }
      } catch (err) {
        console.log(`Could not determine draft status (continuing): ${err}`);
      }
    }

    // Holistic-mode inputs.
    const minSeverity = normalizeSeverity(tl.getInput('minSeverity', false) ?? 'low');
    const customInstructions = tl.getInput('customInstructions', false) ?? '';
    // Default true; only an explicit "false" disables verification.
    const enableVerification = ((tl.getInput('enableVerification', false) ?? 'true').trim().toLowerCase()) !== 'false';
    const maxInputTokens = parseInt(tl.getInput('maxInputTokens', false) ?? '200000');
    const debug = tl.getBoolInput('debug', false);

    // Coding standards (optional).
    let codingStandards = '';
    const codingStandardsFile = tl.getPathInput('codingStandardsFile', false);
    if (codingStandardsFile && tl.filePathSupplied('codingStandardsFile') && fs.existsSync(codingStandardsFile)) {
      try {
        codingStandards = fs.readFileSync(codingStandardsFile, 'utf8');
        console.log(`Read coding standards file (${codingStandards.length} characters)`);
      } catch (err: any) {
        console.log(`Could not read coding standards file: ${err.message}`);
      }
    }

    // In holistic mode the per-file default template is treated as unset; a
    // genuinely customized template is used as the base instructions with the
    // legacy placeholders stripped (holistic assembles its own file block).
    const holisticTemplate =
      args.promptTemplate && args.promptTemplate.trim() && args.promptTemplate !== DEFAULT_PER_FILE_TEMPLATE
        ? args.promptTemplate.replace(/\{diff\}|\{standards\}|\{analysisMode\}/g, '').trim()
        : undefined;

    // Gather PR context and annotated diffs (changes-only, for line anchoring).
    console.log('Gathering pull request context and diffs for holistic review...');
    const context = await getPullRequestContext(connection, repositoryId, pullRequestId);
    const analysisTargets = await getPullRequestDiff(connection, repositoryId, pullRequestId, undefined, args.maxFileSizeInLines);

    const entries = Object.entries(analysisTargets);
    if (entries.length === 1 && entries[0][0] === 'ERROR.txt') {
      const message = entries[0][1]?.content ?? 'No files could be retrieved for analysis';
      tl.warning(`Holistic review could not run: ${message}`);
      tl.setResult(tl.TaskResult.SucceededWithIssues, message);
      return;
    }
    if (entries.length === 0) {
      tl.warning('Holistic review found no files to analyze.');
      tl.setResult(tl.TaskResult.SucceededWithIssues, 'No files to analyze');
      return;
    }

    const aiService = createAIService(args.aiProvider, args.apiKey, args.modelName, args.apiEndpoint);

    const result = await runHolisticReview(aiService, analysisTargets, context, {
      maxTokens: args.maxTokens,
      temperature: args.temperature,
      maxInputTokens,
      minSeverity,
      enableVerification,
      customInstructions,
      codingStandards,
      promptTemplate: holisticTemplate,
      onPrompt: debug ? (label, prompt) => savePromptToFile(`[${label}]\n\n${prompt}`, args.aiProvider) : undefined,
    });

    if (result.error && result.findings.length === 0 && !result.summary) {
      tl.warning(`Holistic review malfunctioned: ${result.error}`);
      tl.setResult(tl.TaskResult.SucceededWithIssues, result.error);
      return;
    }

    await postReview(gitApi, repositoryId, pullRequestId, isActive, result);

    if (result.degraded) {
      tl.warning('Holistic review completed with degraded output (some parts could not be parsed).');
      tl.setResult(tl.TaskResult.SucceededWithIssues, 'Review completed with degraded output');
    }
  } catch (error: any) {
    // Reviewer is advisory infrastructure — never block the pipeline on a malfunction.
    tl.warning(`Holistic review error: ${error?.message ?? error}`);
    tl.setResult(tl.TaskResult.SucceededWithIssues, `Holistic review error: ${error?.message ?? error}`);
  }
}

run()
