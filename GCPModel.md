# Google AI Setup Guide for Azure DevOps PR Comments Extension

This guide walks you through setting up Google AI (Gemini) models and integrating them with the Azure DevOps AI PR Comments Extension.

## Overview

The extension supports Google AI through two methods:
- **Google AI Studio** (recommended for most users)
- **Google Vertex AI** (for enterprise/GCP users)

This guide focuses on Google AI Studio setup, which is simpler and more accessible.

## Prerequisites

- Google account
- Access to Google AI Studio
- Azure DevOps organization with proper permissions

## Step-by-Step Setup Process

### Step 1: Access Google Cloud Console

1. Navigate to [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account
3. Select or create a project for your Gemini API usage

![Google Cloud Console Landing Page](GCP/Console%20Page%201.png)

### Step 2: Enable the Generative AI API

1. In the Google Cloud Console, navigate to "APIs & Services" 
2. Search for "Generative Language API" or "AI Platform API"
3. Click on the API and then click "Enable"
4. Wait for the API to be enabled for your project

![Enable Generative AI API](GCP/Console%20Page%202.png)

### Step 3: Navigate to Credentials/API Keys

1. Once the API is enabled, go to "APIs & Services" → "Credentials"
2. Look for the option to create credentials
3. Select "API Key" from the dropdown options

![Navigate to API Keys](GCP/Console%20Page%203.png)

### Step 4: Create and Configure API Key

1. Click "Create API Key" 
2. The system will generate a new API key
3. Configure restrictions and permissions for the key
4. Restrict the key to only the Generative Language API for security

![Create and Configure API Key](GCP/Console%20Page%204.png)

### Step 5: Copy and Secure Your API Key

1. Copy the generated API key to a secure location
2. **Important**: Store this key securely - it won't be shown again
3. Consider setting up key restrictions and quotas
4. Use Azure DevOps pipeline variables for secure storage

![Final API Key Display](GCP/Console%20Page%205.png)

## Azure DevOps Integration

### 1. Store API Key Securely

Add your Google AI API key to Azure DevOps pipeline variables:

1. Go to your Azure DevOps project
2. Navigate to Pipelines → Library
3. Create a new variable group or edit existing one
4. Add a variable named `GOOGLE_AI_API_KEY`
5. Set the value to your API key and mark it as secret

### 2. Configure the Pipeline Task

Use the following YAML configuration in your Azure DevOps pipeline:

```yaml
- task: prAiProvider@1
  displayName: 'Google AI Review'
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-pro'
    apiKey: '$(GOOGLE_AI_API_KEY)'
    codingStandardsFile: '$(Build.SourcesDirectory)/docs/coding-standards.md'
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

### 3. Available Google AI Models

The extension supports various Google AI models:

| Model Name | Description | Use Case |
|------------|-------------|----------|
| `gemini-pro` | Standard Gemini Pro model | General code review |
| `gemini-2.0-flash` | Fast, efficient model | Quick reviews |
| `gemini-1.5-pro` | Enhanced capabilities | Complex code analysis |
| `gemini-1.5-flash` | Balanced speed/quality | Most use cases |

### 4. Configuration Options

#### Required Inputs:
- `aiProvider`: Set to `'google'`
- `apiKey`: Your Google AI API key
- `modelName`: The Gemini model to use

#### Optional Inputs:
- `maxTokens`: Maximum response length (default: 1000)
- `temperature`: Creativity level 0.0-1.0 (default: 0.7)
- `promptTemplate`: Custom prompt template
- `codingStandardsFile`: Path to your coding standards

## Example Configurations

### Basic Configuration

```yaml
- task: prAiProvider@0.2.1
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-pro'
    apiKey: '$(GOOGLE_AI_API_KEY)'
```

### Advanced Configuration with Coding Standards

```yaml
- task: prAiProvider@0.2.1
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-1.5-pro'
    apiKey: '$(GOOGLE_AI_API_KEY)'
    maxFileSizeInLines: '2000'
    codingStandardsFile: '$(Build.SourcesDirectory)/standards/coding-guidelines.md'
    promptTemplate: |
      As a senior code reviewer, analyze this code for:
      1. Code quality and best practices
      2. Security vulnerabilities
      3. Performance implications
      4. Adherence to our coding standards
      
      CODING STANDARDS:
      {standards}
      
      CODE TO REVIEW:
      {diff}
      
      Provide specific, actionable feedback with line references where applicable.
    maxTokens: '1500'
    temperature: '0.3'
    active: true
```

### Multiple Model Strategy

You can run multiple models for different perspectives:

```yaml
# Fast review for all PRs
- task: prAiProvider@0.2.1
  displayName: 'Quick AI Review'
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-2.0-flash'
    apiKey: '$(GOOGLE_AI_API_KEY)'
    maxTokens: '500'
    temperature: '0.5'

# Detailed review for important files
- task: prAiProvider@0.2.1
  displayName: 'Detailed AI Review'
  condition: contains(variables['Build.SourceBranch'], 'main')
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-1.5-pro'
    apiKey: '$(GOOGLE_AI_API_KEY)'
    maxTokens: '2000'
    temperature: '0.3'
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "API key is required for google provider"
- **Cause**: API key is missing or empty
- **Solution**: Ensure `$(GOOGLE_AI_API_KEY)` variable is set and not empty

#### 2. "Invalid API key" or Authentication Errors
- **Cause**: API key is incorrect or expired
- **Solution**: 
  - Verify the API key in Google AI Studio
  - Generate a new API key if needed
  - Ensure the key has proper permissions

#### 3. "Model not found" Errors
- **Cause**: Invalid model name specified
- **Solution**: Use supported model names like `gemini-pro`, `gemini-1.5-pro`, etc.

#### 4. Rate Limiting Issues
- **Cause**: Exceeding API quotas
- **Solution**: 
  - Check usage in Google AI Studio
  - Reduce `maxTokens` or add delays between requests
  - Consider upgrading your quota

#### 5. "No response generated"
- **Cause**: Model couldn't process the input
- **Solution**:
  - Check if files are too large (use `maxFileSizeInLines`)
  - Verify prompt template is valid
  - Ensure content isn't triggering safety filters

## Best Practices

### 1. Security
- Always store API keys as pipeline secrets
- Never commit API keys to source control
- Regularly rotate API keys
- Use least-privilege access

### 2. Performance
- Use `gemini-2.0-flash` for faster responses
- Set appropriate `maxFileSizeInLines` to avoid large payloads
- Use lower `maxTokens` for simple reviews

### 3. Cost Management
- Monitor usage in Google AI Studio
- Set appropriate token limits
- Use conditional execution for expensive models
- Consider different models for different scenarios

### 4. Quality
- Customize prompt templates for your team's needs
- Include coding standards for consistent reviews
- Use temperature settings appropriate for your use case:
  - Lower (0.1-0.3): More consistent, focused reviews
  - Higher (0.7-1.0): More creative, varied feedback

## Monitoring and Maintenance

### 1. Monitor API Usage
- Check Google AI Studio dashboard regularly
- Set up alerts for quota usage
- Review costs and usage patterns

### 2. Update Models
- Stay updated with new Gemini model releases
- Test new models in development before production
- Update model names in pipelines as needed

### 3. Performance Monitoring
- Monitor task execution times
- Track comment quality and usefulness
- Gather feedback from development team

## Support and Resources

- [Google AI Studio Documentation](https://ai.google.dev/)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Azure DevOps Extension Repository](https://github.com/JackInSightsV2/AzDevOps-PR-AI-Comments)

## Alternative Method: Using Google AI Studio (Simpler Approach)

If you prefer a simpler approach without dealing with Google Cloud Console project setup, you can use Google AI Studio directly:

### Quick Setup via AI Studio

1. **Go directly to Google AI Studio API Keys page**
   - Navigate to [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
   - Sign in with your Google account

2. **Create API Key**
   - Click "Create API Key" button
   - The key will be generated automatically
   - No need to manually enable APIs or configure projects

3. **Copy and Use**
   - Copy the generated API key
   - Use it directly in your Azure DevOps pipeline configuration

### When to Use Each Method

| Method | Best For | Pros | Cons |
|--------|----------|------|------|
| **Google Cloud Console** | Enterprise users, existing GCP projects | Full control, project management, detailed billing | More complex setup |
| **Google AI Studio** | Individual developers, quick testing | Simple and fast, no project setup needed | Limited project management |

### AI Studio Configuration Example

```yaml
- task: prAiProvider@0.2.1
  displayName: 'Google AI Studio Review'
  inputs:
    useAIGeneration: true
    aiProvider: 'google'
    modelName: 'gemini-pro'
    apiKey: '$(GOOGLE_AI_API_KEY)'  # API key from AI Studio
    promptTemplate: 'Review this code for best practices: {diff}'
```

**Note**: Both methods create API keys that work with the same Google AI models. Choose the method that best fits your workflow and organizational requirements.
