import axios from 'axios';

// Interface for AI service responses
export interface AIResponse {
  content: string;
  error?: string;
}

// Base AI service interface
export interface AIService {
  generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse>;
}

// Helper function to determine if a model requires max_completion_tokens instead of max_tokens
// GPT-5 and newer models, as well as o1, o3, o4 models require max_completion_tokens
function requiresMaxCompletionTokens(modelName: string): boolean {
  const normalizedModel = modelName.trim().toLowerCase();
  
  // Check for o1, o3, o4 models (reasoning models)
  if (normalizedModel.startsWith('o1') || normalizedModel.startsWith('o3') || normalizedModel.startsWith('o4')) {
    return true;
  }
  
  // Check for GPT-5 and newer models
  const gptVersionMatch = normalizedModel.match(/^gpt-(\d+)(\D|$)/);
  if (gptVersionMatch) {
    const numericPart = gptVersionMatch[1];
    let versionNumber = parseInt(numericPart, 10);
    if (Number.isNaN(versionNumber)) {
      return false;
    }
    // Handle cases like gpt-5-mini where the version is "5"
    if (versionNumber >= 5) {
      return true;
    }
    // Handle cases like gpt-45 where it might be interpreted as 4.5
    if (numericPart.length === 2 && numericPart[1] === '5') {
      const major = parseInt(numericPart[0], 10);
      if (!Number.isNaN(major)) {
        versionNumber = major + 0.5;
        if (versionNumber >= 5) {
          return true;
        }
      }
    }
  }
  
  return false;
}

// OpenAI implementation
export class OpenAIService implements AIService {
  private client: any;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4o') {
    // Lazy-load to avoid requiring 'openai' unless provider is used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAI } = require('openai');
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      // Build request body with appropriate parameter based on model
      const requestBody: any = {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature,
      };
      
      // Use the appropriate parameter based on model version
      if (requiresMaxCompletionTokens(this.model)) {
        requestBody.max_completion_tokens = maxTokens;
      } else {
        requestBody.max_tokens = maxTokens;
      }
      
      const response = await this.client.chat.completions.create(requestBody);

      return {
        content: response.choices[0]?.message?.content || 'No response generated',
      };
    } catch (error: any) {
      return {
        content: '',
        error: `OpenAI error: ${error.message}`,
      };
    }
  }
}

// Azure OpenAI implementation
export class AzureOpenAIService implements AIService {
  private apiKey: string;
  private endpoint: string;
  private deploymentName: string;

  constructor(apiKey: string, endpoint: string, deploymentName: string) {
    this.apiKey = apiKey;
    this.endpoint = endpoint;
    this.deploymentName = deploymentName;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      // Using the new Azure OpenAI API format
      const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=2023-12-01-preview`;
      
      const requestBody: any = {
        model: this.deploymentName,
        messages: [{ role: 'user', content: prompt }],
        temperature: temperature,
      };
      
      // Use the appropriate parameter based on model version
      if (requiresMaxCompletionTokens(this.deploymentName)) {
        requestBody.max_completion_tokens = maxTokens;
      } else {
        requestBody.max_tokens = maxTokens;
      }
      
      const response = await axios.post(
        url,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey,
            'x-ms-model-mesh-model-name': this.deploymentName,
          },
        }
      );

      return {
        content: response.data.choices[0]?.message?.content || 'No response generated',
      };
    } catch (error: any) {
      console.error('Azure OpenAI error details:', error.response?.data || error.message);
      return {
        content: '',
        error: `Azure OpenAI error: ${error.message}`,
      };
    }
  }
}

// Google AI implementation
export class GoogleAIService implements AIService {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-1.5-pro') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      // Using direct API call with axios instead of the DiscussServiceClient
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      
      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: maxTokens
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Extract the response text from the API response
      const content = response.data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
      
      return { content };
    } catch (error: any) {
      console.error('Google AI error details:', error.response?.data || error.message);
      return {
        content: '',
        error: `Google AI error: ${error.message}`
      };
    }
  }
}

// Google Vertex AI implementation
export class VertexAIService implements AIService {
  private projectId: string;
  private location: string;
  private model: string;
  private vertexCtor?: any;

  constructor(projectId: string, location: string = 'us-central1', model: string = 'gemini-1.5-pro') {
    this.projectId = projectId;
    this.location = location;
    this.model = model;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      // Lazy-load to avoid requiring '@google-cloud/vertexai' unless provider is used
      if (!this.vertexCtor) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { VertexAI } = require('@google-cloud/vertexai');
        this.vertexCtor = VertexAI;
      }
      const vertexAI = new this.vertexCtor({
        project: this.projectId,
        location: this.location,
      });

      const generativeModel = vertexAI.preview.getGenerativeModel({
        model: this.model,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperature,
        },
      });

      const result = await generativeModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      });

      return {
        content: result.response.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated',
      };
    } catch (error: any) {
      return {
        content: '',
        error: `Vertex AI error: ${error.message}`,
      };
    }
  }
}

// Anthropic implementation using the SDK
export class AnthropicService implements AIService {
  private client: any;
  private model: string;

  constructor(apiKey: string, model: string = 'claude-3.5-sonnet-20241022') {
    // Lazy-load to avoid requiring '@anthropic-ai/sdk' unless provider is used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Anthropic } = require('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      // Using the Anthropic SDK as shown in the example
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: temperature,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Extract the text content safely
      let content = 'No response generated';
      if (response.content && response.content.length > 0) {
        const firstContent = response.content[0];
        if ('text' in firstContent) {
          content = firstContent.text;
        }
      }

      return { content };
    } catch (error: any) {
      console.error('Anthropic error details:', error);
      return {
        content: '',
        error: `Anthropic error: ${error.message}`,
      };
    }
  }
}

// Ollama implementation
export class OllamaService implements AIService {
  private endpoint: string;
  private model: string;

  constructor(endpoint: string, model: string) {
    this.endpoint = endpoint;
    this.model = model;
  }

  async generateComment(prompt: string, maxTokens: number, temperature: number): Promise<AIResponse> {
    try {
      const response = await axios.post(
        `${this.endpoint}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          options: {
            num_predict: maxTokens,
            temperature: temperature,
          },
        }
      );

      return {
        content: response.data.response || 'No response generated',
      };
    } catch (error: any) {
      return {
        content: '',
        error: `Ollama error: ${error.message}`,
      };
    }
  }
}

// Factory to create the appropriate AI service
export function createAIService(
  provider: string,
  apiKey: string,
  modelName: string,
  apiEndpoint?: string
): AIService {
  // Validate API key for providers that require it (all except Ollama)
  if (provider !== 'ollama' && (!apiKey || apiKey.trim() === '')) {
    throw new Error(`API key is required for ${provider} provider`);
  }
  
  switch (provider) {
    case 'openai':
      return new OpenAIService(apiKey, modelName || 'gpt-4o');
    case 'azure':
      if (!apiEndpoint) {
        throw new Error('API endpoint is required for Azure OpenAI');
      }
      return new AzureOpenAIService(apiKey, apiEndpoint, modelName);
    case 'google':
      return new GoogleAIService(apiKey, modelName || 'gemini-1.5-pro');
    case 'vertexai':
      return new VertexAIService(apiKey, 'us-central1', modelName || 'gemini-1.5-pro');
    case 'anthropic':
      return new AnthropicService(apiKey, modelName || 'claude-3.5-sonnet-20241022');
    case 'ollama':
      if (!apiEndpoint) {
        throw new Error('API endpoint is required for Ollama');
      }
      return new OllamaService(apiEndpoint, modelName);
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
} 