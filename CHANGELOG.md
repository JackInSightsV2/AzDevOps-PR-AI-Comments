# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [2.0.4] - 2026-06-18

### Fixed
- Per-file mode no longer posts a thread when the model declines to comment: empty responses and `NO_COMMENT`-style sentinels (which some prompt templates instruct the model to return for clean files) are now skipped instead of posted verbatim. (#25)
- A holistic review that parses to a recognizable but empty result (e.g. `{"summary":"","findings":[]}` or all-empty category groups) is now reported as "no issues found" rather than degrading to a parse-failure warning. (#25)

## [2.0.3] - 2026-06-18

### Fixed
- Holistic reviews from weaker/local models (e.g. Ollama) are no longer discarded as "degraded" when the model returns valid JSON in a non-standard shape. The parser now coerces common variants into findings: category-grouped objects (e.g. `security_vulnerabilities`/`performance_problems`, with severity inferred from the group name), aliased container keys (`issues`/`problems`/`comments`), bare top-level arrays, and per-finding field aliases (`message`/`description` → body, `path`/`fileName` → file, `lineNumber` → line). (#25)
- A finding that omits its file is now anchored to the reviewed file when the pull request touches only one file, instead of being dropped.

### Changed
- Marketplace publish step uses `--no-wait-validation`; the validation long-poll was flaky (`ECONNRESET` on slow validations marked successful deploys as failed). The extension still goes live once server-side validation passes.

## [2.0.2] - 2026-06-18

### Fixed
- Hardened structured-output parsing for reasoning models (qwen3, deepseek-r1): `<think>…</think>` blocks (including a dangling unclosed one) are stripped before parsing, and the JSON object is extracted by brace-balanced scanning that ignores braces inside strings, so stray braces in prose/reasoning no longer corrupt extraction. (#21/#25)

## [2.0.1] - 2026-06-17

### Fixed
- Reordered `src/task.json` inputs so `reviewMode` precedes `analyzeChangesOnly`; Marketplace package validation requires an input referenced in a `visibleRule` to be defined earlier in the inputs array. (2.0.0 failed validation on upload and could not be published.)

## [2.0.0] - 2026-06-17

Major release. AI review is now **holistic by default**: the reviewer reasons across the whole pull request rather than commenting file-by-file.

### Added
- **Holistic review mode** (`reviewMode`, default `holistic`): the AI sees all changed files at once, plus the PR title/description, linked work items (incl. acceptance criteria), existing human comments, and your coding standards, then posts a single summary thread plus line-anchored findings.
- **Severity-rated findings** with a `minSeverity` filter (`info`/`low`/`medium`/`high`/`critical`); suppressed counts are noted in the summary.
- **Idempotent re-runs**: findings are fingerprinted (line-number-independent) so they aren't re-posted on each push; the summary is updated in place and findings that no longer apply are auto-closed.
- **Verification pass** (`enableVerification`, default on): a confirm-or-drop critic step that suppresses false positives.
- **Large-PR batching** (`maxInputTokens`): oversized pull requests are split, reviewed in parts, and synthesised into one summary.
- New inputs: `customInstructions`, `skipDraftPullRequests`, `debug` (writes assembled prompts to the agent temp dir).
- Annotated diffs that prefix each line with its real right-file line number, enabling precise inline anchoring with snap-to-changed-line resolution.
- Best-effort PR context retrieval (`getPullRequestContext`) covering title, description, work items, and human comments.
- Cross-provider JSON output mode (`jsonMode`) using each provider's native structured-output support where available.
- Unit test suite under `tests/` (orchestrator, poster, diff utils) plus GitHub Actions CI (typecheck + `bun test`) and a marketplace-deploy workflow gated on the same tests and a tag/manifest version check.

### Changed
- **Default behaviour**: holistic review replaces the per-file loop. The legacy behaviour remains available via `reviewMode: perFile`.
- The reviewer is now advisory and **never fails the build** — malfunctions warn and report `SucceededWithIssues`.
- `maxTokens` default raised to `8000` to accommodate a summary plus multiple findings.
- Refactored into dedicated layers: `review-orchestrator.ts` (review pipeline) and `review-poster.ts` (thread reconciliation) alongside the existing entry point, provider abstraction, and PR utilities.
- Updated provider/model handling: newer OpenAI reasoning models and recent Anthropic models that reject sampling parameters are detected and have `temperature` omitted automatically.

### Migration
- The task major version is now `2`. Azure DevOps keys task references on the major version, so pipelines using `prAiProvider@1` stay on the latest 1.x and do **not** auto-upgrade — change the reference to `prAiProvider@2` to adopt v2.
- Once on `@2`, review is holistic by default. To preserve the previous per-file behaviour, set `reviewMode: perFile`. The `promptTemplate`, `analyzeChangesOnly`, and `enableInlineComments` inputs apply to per-file mode only.

## [1.0.25] - 2026-06-16

### Added
- Marketplace deploy workflow and a `bump-version` helper that keeps `package.json`, `vss-extension.json`, and `src/task.json` in sync (#22).

## [1.0.24] - 2025-01-09

### Fixed
- **Critical Fix**: Fixed empty `{diff}` placeholder issue where GPT API responses indicated no content was present
- Fixed `getContentForObjectId` function incorrectly using `GitVersionType.Commit` with blob object IDs
- Changed blob content retrieval to use `getBlobContent()` API method directly with blob SHA instead of treating it as a commit SHA
- Added fallback mechanism to `getItemText` if blob retrieval fails
- Enhanced logging for better debugging of content retrieval issues
- This fix ensures that diff content is properly retrieved and populated in the prompt template

## [1.0.23] - 2025-12-06

### Fixed
- Fixed OpenAI API error for GPT-5 models (e.g., `gpt-5-mini`) that require `max_completion_tokens` instead of `max_tokens`
- Updated `OpenAIService` to automatically detect and use the correct parameter based on model version
- Enhanced model detection to support reasoning models (`o1`, `o3`, `o4`) that also require `max_completion_tokens`
- Improved `AzureOpenAIService` to use the same unified detection logic for consistency
- System now maintains backward compatibility with older models (GPT-4, GPT-3, etc.) that use `max_tokens`

## [1.0.22] - 2025-12-04

### Fixed
- Hardcoded OpenAI model remvoed and now respects the parameter. 


## [1.0.21] - 2025-11-10

### Fixed
- Inline comments are now only emitted when `analyzeChangesOnly` is true, preventing full-file runs from anchoring every comment at line 1.

## [1.0.20] - 2025-11-10

### Added
- `analyzeChangesOnly` task input to let users choose between diff-only and full-file AI analysis
- Inline PR review comments via the new `enableInlineComments` switch
- `{analysisMode}` placeholder in prompt templates for mode-aware instructions

### Changed
- Refactored diff utilities to return first-changed-line metadata for inline positioning
- Documentation updated with new switches, prompt guidance, and YAML examples

## [1.0.19] - 2025-11-10

### Changed
- Version alignment

## [1.0.15] - 2025-11-10

### Fixed
- Fixed `allowedFileExtensions` parameter not working due to incorrect parameter name in code
- The task.json defined `allowedFileExtensions` but the TypeScript code was reading `fileExtensions`
- File extension filtering now works correctly as documented

### Changed
- Enhanced AzureOpenAIService to support GPT-5 model parameters
- Updated AzureOpenAIService to conditionally use `max_completion_tokens` for GPT-5 and newer models, ensuring compatibility with different model versions
- Refactored request body construction for clarity and maintainability
- Added multiple new dependencies in package-lock.json for improved functionality

## [1.0.14] - 2025-08-08

### Changed
- Updated documentaion

## [1.0.13] - 2025-08-08

### Fixed
- Improved module copying logic to better handle nested dependencies

## [1.0.1] - 2025-06-06

### Fixed
- **BREAKING FIX**: Fixed exit code 1 errors that were preventing task execution
- Fixed task name documentation typo from `AIPullRequestCommentIntergration` to correct task name `prAiProvider`
- Fixed comment field validation issue where `required: true` was causing failures when AI generation was enabled
- Added comprehensive API key validation to prevent runtime errors for all AI providers (except Ollama)
- Enhanced input validation with proper error handling for missing configuration
- Added validation for Azure OpenAI endpoint and model name requirements
- Added validation for Ollama model name requirements
- Improved error messages with clear, actionable feedback for troubleshooting

### Added
- Repository ID validation to ensure proper Azure DevOps context
- Access token validation with helpful permission guidance
- Collection URI validation for Azure DevOps connection
- Provider-specific configuration validation for better user experience
- Comprehensive error handling with appropriate task result codes (Failed, Skipped)
- Better logging and diagnostic information for debugging issues

### Changed
- Comment field is no longer marked as required when AI generation is enabled
- Task now uses `TaskResult.Skipped` instead of silent failure when no PR context is available
- Enhanced error messages provide specific guidance for each type of configuration issue
- Improved validation occurs before attempting to create AI services or make API calls

## [1.0.0] - 2024-03-26

### Added
- Full file analysis instead of just diffs for more comprehensive AI reviews
- Maximum file size limit option to prevent overwhelming AI models
- File truncation feature for large files (configurable with maxFileSizeInLines)
- Enhanced error handling with detailed logging for better troubleshooting
- Support for binary file detection and exclusion
- Performance improvements and timing measurements for PR processing

### Changed
- Version bump from 0.1.0 to 1.0.0 for official release
- Made the extension public in the marketplace
- Enhanced documentation in task inputs with clearer descriptions

### Fixed
- Improved file path handling for more reliable file access
- Enhanced robustness when dealing with missing or inaccessible files
- Better error reporting for API service failures

## [0.1.0] - 2025-03-06

### Added
- Initial release of the Azure DevOps PR Comment Extension with AI Integration
- Support for multiple AI providers:
  - OpenAI (GPT models)
  - Azure OpenAI
  - Google AI (Gemini models)
  - Google Vertex AI
  - Anthropic (Claude models)
  - Ollama (local models)
- Coding standards integration to guide AI reviews
- Customizable AI prompts with PR diff context
- Control over comment behavior (active/closed, update existing comments)
- Support for markdown formatting in comments
- Test script for verifying AI service integrations
- Comprehensive documentation and examples

### Changed
- Modernized build process using Node.js scripts instead of batch files
- Improved project structure with clear separation of concerns
- Enhanced error handling and logging throughout the codebase

### Fixed
- Proper environment variable handling for API keys
- Secure handling of sensitive information 