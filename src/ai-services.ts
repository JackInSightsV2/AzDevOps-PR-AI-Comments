import axios from 'axios';

// Interface for AI service responses
export interface AIResponse {
  content: string;
  error?: string;
}

// Optional per-call generation options. Kept optional so existing callers
// (the legacy per-file path) keep working unchanged.
export interface AIGenerateOptions {
  // When true, ask the provider to return strict JSON. Providers whose SDK
  // exposes a native JSON mode (OpenAI response_format) use it; the rest rely
  // on prompt instructions, so the orchestrator must also instruct JSON in the
  // prompt regardless.
  jsonMode?: boolean;
}

// Base AI service interface
export interface AIService {
  generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse>;
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

// Newer OpenAI models (GPT-5+, o-series) only accept the default temperature.
// They are exactly the models that also require max_completion_tokens, so reuse
// that detection rather than maintaining a second list.
function openAiRejectsTemperature(modelName: string): boolean {
  return requiresMaxCompletionTokens(modelName);
}

// Anthropic removed sampling parameters (temperature/top_p/top_k) on Opus 4.7,
// Opus 4.8 and the Fable family — sending temperature returns a 400. Sonnet 4.6
// and earlier still accept it. Detect the families that reject it.
function anthropicRejectsTemperature(modelName: string): boolean {
  const m = modelName.trim().toLowerCase();
  if (m.includes('fable') || m.includes('mythos')) {
    return true;
  }
  // claude-opus-4-7 / 4-8 (and any later opus 4.x ≥ 7) reject sampling params.
  const opusMatch = m.match(/opus-4-(\d+)/);
  if (opusMatch) {
    const minor = parseInt(opusMatch[1], 10);
    if (!Number.isNaN(minor) && minor >= 7) {
      return true;
    }
  }
  return false;
}

// OpenAI implementation
export class OpenAIService implements AIService {
  private client: any;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-5.4') {
    // Lazy-load to avoid requiring 'openai' unless provider is used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAI } = require('openai');
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    try {
      // Build request body with appropriate parameter based on model
      const requestBody: any = {
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
      };

      // Newer reasoning models (GPT-5+, o-series) only accept the default
      // temperature; sending a custom one 400s. Omit it for those.
      if (!openAiRejectsTemperature(this.model)) {
        requestBody.temperature = temperature;
      }

      // Use the appropriate token parameter based on model version
      if (requiresMaxCompletionTokens(this.model)) {
        requestBody.max_completion_tokens = maxTokens;
      } else {
        requestBody.max_tokens = maxTokens;
      }

      // Native JSON mode keeps the structured-output contract tight.
      if (options?.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
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

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    try {
      // Using the new Azure OpenAI API format
      const url = `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=2023-12-01-preview`;

      const requestBody: any = {
        model: this.deploymentName,
        messages: [{ role: 'user', content: prompt }],
      };

      // Newer reasoning deployments only accept the default temperature.
      if (!openAiRejectsTemperature(this.deploymentName)) {
        requestBody.temperature = temperature;
      }

      // Use the appropriate parameter based on model version
      if (requiresMaxCompletionTokens(this.deploymentName)) {
        requestBody.max_completion_tokens = maxTokens;
      } else {
        requestBody.max_tokens = maxTokens;
      }

      if (options?.jsonMode) {
        requestBody.response_format = { type: 'json_object' };
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

  constructor(apiKey: string, model: string = 'gemini-3-pro') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    try {
      // Using direct API call with axios instead of the DiscussServiceClient
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

      const generationConfig: any = {
        temperature: temperature,
        maxOutputTokens: maxTokens
      };
      if (options?.jsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }

      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig
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

  constructor(projectId: string, location: string = 'us-central1', model: string = 'gemini-3-pro') {
    this.projectId = projectId;
    this.location = location;
    this.model = model;
  }

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
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

      const generationConfig: any = {
        maxOutputTokens: maxTokens,
        temperature: temperature,
      };
      if (options?.jsonMode) {
        generationConfig.responseMimeType = 'application/json';
      }

      const generativeModel = vertexAI.preview.getGenerativeModel({
        model: this.model,
        generationConfig,
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

  constructor(apiKey: string, model: string = 'claude-sonnet-4-6') {
    // Lazy-load to avoid requiring '@anthropic-ai/sdk' unless provider is used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Anthropic } = require('@anthropic-ai/sdk');
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    _options?: AIGenerateOptions
  ): Promise<AIResponse> {
    try {
      // Using the Anthropic SDK as shown in the example. Note: structured JSON
      // is driven by the prompt, not output_config.format — the bundled SDK
      // predates that parameter, and prompt-based JSON is our cross-provider
      // baseline anyway.
      const requestBody: any = {
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      };

      // Opus 4.7/4.8 and the Fable family reject sampling params (400). Only
      // send temperature to models that still accept it.
      if (!anthropicRejectsTemperature(this.model)) {
        requestBody.temperature = temperature;
      }

      const response = await this.client.messages.create(requestBody);

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

  async generateComment(
    prompt: string,
    maxTokens: number,
    temperature: number,
    options?: AIGenerateOptions
  ): Promise<AIResponse> {
    try {
      const requestBody: any = {
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          num_predict: maxTokens,
          temperature: temperature,
        },
      };
      // Ollama supports constrained JSON output via the top-level `format` field.
      if (options?.jsonMode) {
        requestBody.format = 'json';
      }

      const response = await axios.post(
        `${this.endpoint}/api/generate`,
        requestBody
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
      return new OpenAIService(apiKey, modelName || 'gpt-5.4');
    case 'azure':
      if (!apiEndpoint) {
        throw new Error('API endpoint is required for Azure OpenAI');
      }
      return new AzureOpenAIService(apiKey, apiEndpoint, modelName);
    case 'google':
      return new GoogleAIService(apiKey, modelName || 'gemini-3-pro');
    case 'vertexai':
      return new VertexAIService(apiKey, 'us-central1', modelName || 'gemini-3-pro');
    case 'anthropic':
      return new AnthropicService(apiKey, modelName || 'claude-sonnet-4-6');
    case 'ollama':
      if (!apiEndpoint) {
        throw new Error('API endpoint is required for Ollama');
      }
      return new OllamaService(apiEndpoint, modelName || 'qwen3');
    default:
      throw new Error(`Unsupported AI provider: ${provider}`);
  }
} 