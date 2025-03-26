// This script is used to test the AI services. You need to ensure you have a .env file in the _devlog/testfiles directory.
// The .env file should contain the API keys for the AI services you want to test.
// The script will then test each AI service and save the response to a file in the _devlog/testfiles directory.
//
// Usage:
//   1. Create a .env file in _devlog/testfiles with your API keys:
//      OPENAI_API_KEY=your_openai_key
//      AZURE_OPENAI_API_KEY=your_azure_key
//      AZURE_OPENAI_ENDPOINT=your_azure_endpoint
//      ANTHROPIC_API_KEY=your_anthropic_key
//      GOOGLE_AI_API_KEY=your_google_key
//
//   2. Run the script:
//      node scripts/test-ai-services.js
//
//   3. Check the output files in _devlog/testfiles:
//      - openai_response.md
//      - azure_response.md
//      - anthropic_response.md
//      - google_response.md
//
// The script will:
//   - Load API keys from the .env file
//   - Compile the TypeScript files to ensure the latest code is tested
//   - Test each AI service with a sample code review prompt
//   - Save the responses to markdown files in the _devlog/testfiles directory
//
// This allows you to verify that all AI services are working correctly before deploying the extension.

// Test script for AI services
const fs = require('fs');
const path = require('path');

// Load environment variables from .env file
function loadEnv() {
  const envPath = path.join(__dirname, '../_devlog/testfiles/.env');
  console.log(`Loading environment variables from ${envPath}`);
  
  try {
    // Read the .env file
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = {};
    
    // Improved parsing to handle multiline values and special characters
    const lines = envContent.split('\n');
    let currentKey = null;
    let currentValue = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('#')) continue;
      
      // Check if this is a new key=value pair
      const keyValueMatch = line.match(/^([^=]+)=(.*)$/);
      
      if (keyValueMatch) {
        // If we were building a previous value, save it
        if (currentKey) {
          envVars[currentKey] = currentValue.trim();
          process.env[currentKey] = currentValue.trim();
        }
        
        // Start a new key-value pair
        currentKey = keyValueMatch[1].trim();
        currentValue = keyValueMatch[2];
      } else if (currentKey) {
        // Continue building the current value
        currentValue += '\n' + line;
      }
    }
    
    // Save the last key-value pair if there is one
    if (currentKey) {
      envVars[currentKey] = currentValue.trim();
      process.env[currentKey] = currentValue.trim();
    }
    
    // Manual parsing as a fallback
    if (Object.keys(envVars).length === 0) {
      console.log("Using manual parsing as fallback...");
      
      // Try to extract keys using regex patterns
      const openaiKeyMatch = envContent.match(/OPENAI_API_KEY=([^\n]+)/);
      if (openaiKeyMatch) {
        process.env.OPENAI_API_KEY = openaiKeyMatch[1].trim();
        envVars.OPENAI_API_KEY = openaiKeyMatch[1].trim();
      }
      
      const azureKeyMatch = envContent.match(/AZURE_OPENAI_API_KEY=([^\n]+)/);
      if (azureKeyMatch) {
        process.env.AZURE_OPENAI_API_KEY = azureKeyMatch[1].trim();
        envVars.AZURE_OPENAI_API_KEY = azureKeyMatch[1].trim();
      }
      
      const azureEndpointMatch = envContent.match(/AZURE_OPENAI_ENDPOINT=([^\n]+)/);
      if (azureEndpointMatch) {
        process.env.AZURE_OPENAI_ENDPOINT = azureEndpointMatch[1].trim();
        envVars.AZURE_OPENAI_ENDPOINT = azureEndpointMatch[1].trim();
      }
      
      const anthropicKeyMatch = envContent.match(/ANTHROPIC_API_KEY=([^\n]+)/);
      if (anthropicKeyMatch) {
        process.env.ANTHROPIC_API_KEY = anthropicKeyMatch[1].trim();
        envVars.ANTHROPIC_API_KEY = anthropicKeyMatch[1].trim();
      }
      
      const googleKeyMatch = envContent.match(/GOOGLE_AI_API_KEY=([^\n]+)/);
      if (googleKeyMatch) {
        process.env.GOOGLE_AI_API_KEY = googleKeyMatch[1].trim();
        envVars.GOOGLE_AI_API_KEY = googleKeyMatch[1].trim();
      }
    }
    
    // Display loaded environment variables status
    console.log('\n--- Environment Variables Status ---');
    const requiredKeys = [
      'OPENAI_API_KEY',
      'AZURE_OPENAI_API_KEY',
      'AZURE_OPENAI_ENDPOINT',
      'ANTHROPIC_API_KEY',
      'GOOGLE_AI_API_KEY'
    ];
    
    let missingKeys = [];
    
    requiredKeys.forEach(key => {
      if (process.env[key]) {
        console.log(`${key}: Loaded successfully`);
      } else {
        console.log(`${key}: NOT FOUND`);
        missingKeys.push(key);
      }
    });
    
    console.log('--- End of Environment Variables Status ---\n');
    
    if (missingKeys.length > 0) {
      console.log(`WARNING: Missing required environment variables: ${missingKeys.join(', ')}`);
      console.log('Tests will be skipped for services with missing API keys.\n');
    }
    
    return envVars;
  } catch (error) {
    console.error(`Error loading .env file: ${error.message}`);
    return {};
  }
}

// Load environment variables
const envVars = loadEnv();

// Read test files
const codeStandardsPath = path.join(__dirname, '../_devlog/testfiles/ex_codestandards.md');
const badCodePath = path.join(__dirname, '../_devlog/testfiles/badcode.js');

const codeStandards = fs.readFileSync(codeStandardsPath, 'utf8');
const badCode = fs.readFileSync(badCodePath, 'utf8');

// Create prompt for AI services
const createPrompt = () => {
  return `
You are a code review assistant. Your task is to review the following JavaScript code and provide feedback based on the coding standards provided.

## Coding Standards:
${codeStandards}

## Code to Review:
\`\`\`javascript
${badCode}
\`\`\`

Please provide a detailed code review that:
1. Identifies violations of the coding standards
2. Suggests specific improvements for each issue
3. Provides examples of how the code should be rewritten
4. Prioritizes the most critical issues to address first

Format your response as a structured code review with clear sections and code examples.
`;
};

// Ensure directory exists for responses
const responsesDir = path.join(__dirname, '../_devlog/testfiles');
if (!fs.existsSync(responsesDir)) {
  fs.mkdirSync(responsesDir, { recursive: true });
}

// Save response to file with prompt included
function saveResponseToFile(content, filename, prompt) {
  const fullContent = `# Input Prompt\n\n${prompt}\n\n# AI Response\n\n${content}`;
  fs.writeFileSync(path.join(responsesDir, filename), fullContent);
  console.log(`Full response saved to _devlog/testfiles/${filename}\n`);
}

// First, compile the TypeScript files to ensure we're testing the latest version
console.log('Compiling TypeScript files...');
const { execSync } = require('child_process');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('TypeScript compilation successful.\n');
} catch (error) {
  console.error('Error compiling TypeScript:', error.message);
  process.exit(1);
}

// Now import the compiled AI services
console.log('Importing AI services from compiled TypeScript...');
const { createAIService } = require('../dist/ai-services');

// Test each AI service
async function testAIServices() {
  console.log('\nTesting AI services from TypeScript implementation...\n');
  
  // Check if we have any API keys before proceeding
  const hasAnyApiKey = 
    process.env.OPENAI_API_KEY || 
    process.env.AZURE_OPENAI_API_KEY || 
    process.env.ANTHROPIC_API_KEY || 
    process.env.GOOGLE_AI_API_KEY;
  
  if (!hasAnyApiKey) {
    console.log('ERROR: No API keys were loaded. Skipping all tests.');
    return;
  }
  
  const prompt = createPrompt();
  const maxTokens = 1000;
  const temperature = 0.7;
  
  // Test OpenAI
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.log('Skipping OpenAI test: No API key found');
    } else {
      console.log('Testing OpenAI implementation from TypeScript...');
      const openaiService = createAIService('openai', process.env.OPENAI_API_KEY, 'gpt-4');
      const openaiResponse = await openaiService.generateComment(prompt, maxTokens, temperature);
      
      if (openaiResponse.error) {
        console.error(`OpenAI Error: ${openaiResponse.error}`);
      } else {
        console.log('OpenAI Response:');
        console.log('-------------------');
        console.log(openaiResponse.content.substring(0, 500) + '...');
        console.log('-------------------\n');
        
        // Save full response to file with prompt
        saveResponseToFile(openaiResponse.content, 'openai_response.md', prompt);
      }
    }
  } catch (error) {
    console.error(`Error testing OpenAI: ${error.message}`);
  }
  
  // Test Azure OpenAI
  try {
    if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
      console.log('Skipping Azure OpenAI test: Missing API key or endpoint');
    } else {
      console.log('Testing Azure OpenAI implementation from TypeScript...');
      
      // Use the correct deployment and endpoint from the user's configuration
      const deploymentName = 'gpt-4o-mini'; 
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      console.log(`Using Azure OpenAI deployment: ${deploymentName}`);
      console.log(`Using Azure OpenAI endpoint: ${endpoint}`);
      
      // Note: The TypeScript implementation might not support the API version parameter
      // We're using the compiled version which should match the TypeScript implementation
      const azureService = createAIService(
        'azure', 
        process.env.AZURE_OPENAI_API_KEY, 
        deploymentName, 
        endpoint
      );
      
      try {
        const azureResponse = await azureService.generateComment(prompt, maxTokens, temperature);
        
        if (azureResponse.error) {
          console.error(`Azure OpenAI Error: ${azureResponse.error}`);
        } else {
          console.log('Azure OpenAI Response:');
          console.log('-------------------');
          console.log(azureResponse.content.substring(0, 500) + '...');
          console.log('-------------------\n');
          
          // Save full response to file with prompt
          saveResponseToFile(azureResponse.content, 'azure_response.md', prompt);
        }
      } catch (deploymentError) {
        console.error(`Error with deployment ${deploymentName}: ${deploymentError.message}`);
        console.log('Please check your Azure OpenAI resource for available deployments.');
      }
    }
  } catch (error) {
    console.error(`Error testing Azure OpenAI: ${error.message}`);
  }
  
  // Test Anthropic
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log('Skipping Anthropic test: No API key found');
    } else {
      console.log('Testing Anthropic implementation from TypeScript...');
      const anthropicService = createAIService('anthropic', process.env.ANTHROPIC_API_KEY, 'claude-3-opus-20240229');
      const anthropicResponse = await anthropicService.generateComment(prompt, maxTokens, temperature);
      
      if (anthropicResponse.error) {
        console.error(`Anthropic Error: ${anthropicResponse.error}`);
      } else {
        console.log('Anthropic Response:');
        console.log('-------------------');
        console.log(anthropicResponse.content.substring(0, 500) + '...');
        console.log('-------------------\n');
        
        // Save full response to file with prompt
        saveResponseToFile(anthropicResponse.content, 'anthropic_response.md', prompt);
      }
    }
  } catch (error) {
    console.error(`Error testing Anthropic: ${error.message}`);
  }
  
  // Test Google AI
  try {
    if (!process.env.GOOGLE_AI_API_KEY) {
      console.log('Skipping Google AI test: No API key found');
    } else {
      console.log('Testing Google AI implementation from TypeScript...');
      const googleService = createAIService('google', process.env.GOOGLE_AI_API_KEY, 'gemini-2.0-flash');
      const googleResponse = await googleService.generateComment(prompt, maxTokens, temperature);
      
      if (googleResponse.error) {
        console.error(`Google AI Error: ${googleResponse.error}`);
      } else {
        console.log('Google AI Response:');
        console.log('-------------------');
        console.log(googleResponse.content.substring(0, 500) + '...');
        console.log('-------------------\n');
        
        // Save full response to file with prompt
        saveResponseToFile(googleResponse.content, 'google_response.md', prompt);
      }
    }
  } catch (error) {
    console.error(`Error testing Google AI: ${error.message}`);
  }
  
  console.log('AI service testing completed.');
}

// Run the tests
testAIServices().catch(error => {
  console.error('Error running tests:', error);
}); 