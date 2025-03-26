# Azure DevOps PR Comment Extension with AI Integration

This Azure DevOps extension allows you to add AI-generated comments to pull requests directly from your pipeline tasks. It supports multiple AI providers, giving you flexibility in choosing the model that best fits your needs.

## Features

- Add comments to pull requests from your Azure DevOps pipelines
- Generate comments using AI from various providers:
  - OpenAI (GPT models)
  - Azure OpenAI
  - Google AI (Gemini models)
  - Google Vertex AI
  - Anthropic (Claude models)
  - Ollama (local models)
- **NEW**: Use your team's coding standards to guide AI reviews
- Customize AI prompts with PR diff context
- Control comment behavior (active/closed, update existing comments)
- Support for markdown formatting in comments

![AI-Generated PR Comment Example](assets/images/screenshots/screen1.png)

### How It Works

1. Create a markdown file with your team's coding standards (Keep it simple; have a look at the examples folder)
2. Reference this file in your pipeline task configuration
3. The AI model will use these standards when reviewing code changes
4. Receive tailored feedback that follows your team's guidelines

See the [examples/CODING_STANDARDS_GUIDE.md](https://github.com/JackInSightsV2/azure-devops-pr-comment-extension/blob/main/examples/CODING_STANDARDS_GUIDE.md) for detailed instructions and best practices.

## Getting Started

### Installation

1. Install the extension from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=ByteInSights.AI-PR-Integration)
2. Permissions: Your agent that deploys the pipeline will need access to make comments on a PR (Check the Screenshots to See How)
3. Add the task to your pipeline YAML:

```yaml
- task: AIPullRequestCommentIntergration@1
  displayName: 'Add AI Comment to PR'
  inputs:
    useAIGeneration: true
    aiProvider: 'openai'
    modelName: 'gpt-4'
    apiKey: '$(OPENAI_API_KEY)'
    codingStandardsFile: '$(Build.SourcesDirectory)/docs/coding-standards.md' <-- Put the path to your standards here. 
    promptTemplate: |
      Review the following code changes according to our coding standards:
      
      CODING STANDARDS:
      {standards}
      
      CODE CHANGES:
      {diff}
    maxTokens: '1000'
    temperature: '0.7'
    active: true
```

### Configuration Options

#### AI Generation Options

- **useAIGeneration**: Enable AI-generated comments
- **aiProvider**: Select the AI provider (openai, azure, google, vertexai, anthropic, ollama)
- **modelName**: Specify the model name (e.g., gpt-4, claude-3-opus, gemini-pro)
- **apiKey**: API key for the selected provider (use pipeline variables for security)
- **azureApiEndpoint**: Custom API endpoint URL for Azure OpenAI
- **ollamaApiEndpoint**: API endpoint URL for Ollama (default: http://localhost:11434)
- **codingStandardsFile**: Path to a markdown file containing coding standards to guide the AI
- **promptTemplate**: Template for the AI prompt (use {diff} to include PR changes and {standards} to include coding standards)
- **maxTokens**: Maximum number of tokens for the AI response
- **temperature**: Controls randomness in the AI response (0.0-1.0)

#### Comment Options

- **comment**: Static comment text (when not using AI generation)
- **markdownFile**: Path to a markdown file for comment content
- **active**: Add comment as active (true) or closed (false)
- **addCommentOnlyOnce**: Only add comment if it doesn't already exist
- **updatePreviousComment**: Update existing comment if it exists
- **pullRequestId**: Target pull request ID (defaults to current PR)
- **repositoryId**: Target repository ID (defaults to current repo)

## Examples

### Using OpenAI with Coding Standards

```yaml
- task: AIPullRequestCommentIntergration@1
  inputs:
    useAIGeneration: true
    aiProvider: 'openai'
    modelName: 'gpt-4'
    apiKey: '$(OPENAI_API_KEY)'
    codingStandardsFile: '$(Build.SourcesDirectory)/docs/coding-standards.md'
    promptTemplate: |
      You are a code reviewer following our team's coding standards.
      
      CODING STANDARDS:
      {standards}
      
      Review the following code changes and provide constructive feedback:
      {diff}
```

For more examples, see the [examples/pipeline-with-coding-standards.yml](https://github.com/JackInSightsV2/azure-devops-pr-comment-extension/blob/main/examples/pipeline-with-coding-standards.yml) file.

### Using Azure OpenAI

```yaml
- task: AIPullRequestCommentIntergration@1
  inputs:
    useAIGeneration: true
    aiProvider: 'azure'
    modelName: 'gpt-4o-mini'
    apiKey: '$(AZURE_OPENAI_API_KEY)'
    azureApiEndpoint: 'https://your-resource.openai.azure.com'
    promptTemplate: 'Review this code for performance issues: {diff}'
```

### Using Anthropic Claude

```yaml
- task: AIPullRequestCommentIntergration@1
  inputs:
    useAIGeneration: true
    aiProvider: 'anthropic'
    modelName: 'claude-3-opus-20240229'
    apiKey: '$(ANTHROPIC_API_KEY)'
    promptTemplate: 'Review this code for best practices: {diff}'
```

### Using Google AI (Gemini)

```yaml
- task: AIPullRequestCommentIntergration@1
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-2.0-flash'
    apiKey: '$(GOOGLE_AI_API_KEY)'
    promptTemplate: 'Review this code for security issues: {diff}'
```

### Using Ollama (Local Models)

```yaml
- task: AIPullRequestCommentIntergration@1
  inputs:
    useAIGeneration: true
    aiProvider: 'ollama'
    modelName: 'llama3'
    ollamaApiEndpoint: 'http://localhost:11434'
    promptTemplate: 'Review this code: {diff}'
```

## Creating a Coding Standards File

Create a markdown file in your repository with your team's coding standards. For example:

```markdown
# Team Coding Standards

## Naming Conventions
- Use camelCase for variables and functions
- Use PascalCase for classes and interfaces
- Use UPPER_SNAKE_CASE for constants

## TypeScript Best Practices
- Always specify return types for functions
- Prefer interfaces over type aliases for object types
- Use optional chaining and nullish coalescing when appropriate

## Code Organization
- Group related functions together
- Keep files under 300 lines when possible
- Use meaningful comments for complex logic

## Error Handling
- Always catch and handle errors appropriately
- Provide meaningful error messages
- Use typed errors when possible
```

For a comprehensive example, see CODING_STANDARDS_GUIDE.md

## Development

### Project Structure

The project is organized as follows:

- `src/` - TypeScript source files
  - `ai-services.ts` - Implementation of various AI service providers
  - `index.ts` - Main entry point for the extension
  - `pr-utils.ts` - Utilities for working with pull requests
- `dist/` - Compiled JavaScript files (generated during build)
- `scripts/` - Build and utility scripts
  - `test-ai-services.js` - Script to test AI service integrations
- `_devlog/testfiles/` - Test files for development and testing

### Building the Project

To build the project, run:

```bash
npm run build
```

This will:
1. Clean the `dist` directory
2. Compile TypeScript files
3. Copy the task.json file to the dist directory
4. Copy required node_modules to the dist directory

### Testing AI Services

The project includes a test script to verify AI service integrations. To use it:

1. Create a `.env` file in the `_devlog/testfiles/` directory with your API keys:
   ```
   OPENAI_API_KEY=your_openai_key
   AZURE_OPENAI_API_KEY=your_azure_key
   AZURE_OPENAI_ENDPOINT=your_azure_endpoint
   ANTHROPIC_API_KEY=your_anthropic_key
   GOOGLE_AI_API_KEY=your_google_key
   ```

2. Run the test script:
   ```bash
   node scripts/test-ai-services.js
   ```

The script will:
- Load API keys from the `.env` file
- Compile the TypeScript files to ensure the latest code is tested
- Test each AI service with a sample code review prompt
- Save the responses to markdown files in the `_devlog/testfiles/` directory

This allows you to verify that all AI services are working correctly before deploying the extension.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test your changes with the test script
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE.txt file for details.
