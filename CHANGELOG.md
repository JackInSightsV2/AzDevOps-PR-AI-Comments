# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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