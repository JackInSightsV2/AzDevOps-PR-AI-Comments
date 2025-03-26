# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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