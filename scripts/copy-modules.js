const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Copying node_modules to dist/node_modules...');

const sourceModulesPath = path.join(__dirname, '..', 'node_modules');
const distModulesPath = path.join(__dirname, '..', 'dist', 'node_modules');

// Create dist/node_modules directory if it doesn't exist
if (!fs.existsSync(distModulesPath)) {
  fs.mkdirSync(distModulesPath, { recursive: true });
}

// Simplified approach - just copy package.json and specific JS files
const packagesToCopy = [
  // These are the essential packages - only include what's absolutely necessary
  { name: '@anthropic-ai/sdk', mainJsFiles: ['dist'] },
  { name: '@google-cloud/vertexai', mainJsFiles: ['build'] },
  { name: 'axios', mainJsFiles: ['dist'] },
  { name: 'azure-devops-extension-api', mainJsFiles: [''] }, // root js files
  { name: 'azure-devops-extension-sdk', mainJsFiles: [''] }, // root js files
  { name: 'azure-devops-node-api', mainJsFiles: ['WebApi'] },
  { name: 'azure-pipelines-task-lib', mainJsFiles: ['lib'] },
  { name: 'openai', mainJsFiles: ['dist'] }
];

// Function to remove problematic directories
function removeProblematicDirs(dirPath) {
  // Skip if directory doesn't exist
  if (!fs.existsSync(dirPath)) return;

  // Check for $$ directories
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      // Remove directories with $$ in the name
      if (entry.name.includes('$$')) {
        try {
          console.log(`Removing problematic directory: ${fullPath}`);
          if (process.platform === 'win32') {
            execSync(`rd /s /q "${fullPath}"`);
          } else {
            execSync(`rm -rf "${fullPath}"`);
          }
        } catch (err) {
          console.error(`Error removing directory ${fullPath}: ${err.message}`);
        }
      } else {
        // Recursively check subdirectories
        removeProblematicDirs(fullPath);
      }
    }
  }
}

try {
  console.log('Copying minimal essential files...');
  
  // Create @types directory for TypeScript packages if it doesn't exist
  const typesDir = path.join(distModulesPath, '@types');
  if (!fs.existsSync(typesDir)) {
    fs.mkdirSync(typesDir, { recursive: true });
  }
  
  for (const pkg of packagesToCopy) {
    const pkgPath = path.join(sourceModulesPath, pkg.name);
    const destPkgPath = path.join(distModulesPath, pkg.name);
    
    // Skip if package doesn't exist
    if (!fs.existsSync(pkgPath)) {
      console.log(`Package ${pkg.name} not found, skipping...`);
      continue;
    }
    
    console.log(`Processing ${pkg.name}...`);
    
    // Create destination package directory
    const packageParts = pkg.name.split('/');
    let currentPath = distModulesPath;
    
    for (const part of packageParts) {
      currentPath = path.join(currentPath, part);
      if (!fs.existsSync(currentPath)) {
        fs.mkdirSync(currentPath, { recursive: true });
      }
    }
    
    // Copy package.json
    try {
      const pkgJsonPath = path.join(pkgPath, 'package.json');
      if (fs.existsSync(pkgJsonPath)) {
        fs.copyFileSync(pkgJsonPath, path.join(destPkgPath, 'package.json'));
        console.log(`Copied package.json for ${pkg.name}`);
      }
    } catch (err) {
      console.error(`Error copying package.json for ${pkg.name}: ${err.message}`);
    }
    
    // Copy JS files from main directories
    for (const jsDir of pkg.mainJsFiles) {
      try {
        const sourcePath = path.join(pkgPath, jsDir);
        const destPath = path.join(destPkgPath, jsDir);
        
        if (fs.existsSync(sourcePath)) {
          // Create destination directory
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
          }
          
          // Copy JS files only
          if (process.platform === 'win32') {
            console.log(`Copying JS files from ${sourcePath} to ${destPath}`);
            // Use xcopy with /s to copy only js files
            execSync(`xcopy /s /y "${sourcePath}\\*.js" "${destPath}\\"`);
          } else {
            console.log(`Copying JS files from ${sourcePath} to ${destPath}`);
            // For Unix-like systems
            execSync(`find "${sourcePath}" -name "*.js" -type f -exec cp --parents -t "${destPkgPath}" {} \\;`);
          }
        } else {
          console.log(`Source path ${sourcePath} doesn't exist, skipping`);
        }
      } catch (err) {
        console.error(`Error copying JS files for ${pkg.name}: ${err.message}`);
      }
    }
    
    // Remove problematic directories with $$ characters
    removeProblematicDirs(destPkgPath);
  }
  
  console.log('Minimal essential files copied successfully.');
} catch (error) {
  console.error('Error in copy process:', error);
  process.exit(1);
}