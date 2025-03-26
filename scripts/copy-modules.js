const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Copying node_modules to dist/node_modules...');

const distModulesPath = path.join(__dirname, '..', 'dist', 'node_modules');

// Create dist/node_modules directory if it doesn't exist
if (!fs.existsSync(distModulesPath)) {
  fs.mkdirSync(distModulesPath, { recursive: true });
}

try {
  // Use platform-specific commands for better performance
  if (process.platform === 'win32') {
    // Windows - simple copy first
    execSync(`xcopy /E /I /H /Y "${path.join(__dirname, '..', 'node_modules')}\\*" "${distModulesPath}\\"`);
    
    // Then remove problematic files
    console.log('Removing SVG files and documentation folders...');
    execSync(`del /s /q "${distModulesPath}\\*.svg"`);
    execSync(`for /d /r "${distModulesPath}" %d in (doc docs test tests example examples) do @if exist "%d" rd /s /q "%d"`);
  } else {
    // Unix-like
    execSync(`cp -R "${path.join(__dirname, '..', 'node_modules')}/"* "${distModulesPath}/"`);
    
    // Then remove problematic files
    console.log('Removing SVG files and documentation folders...');
    execSync(`find "${distModulesPath}" -name "*.svg" -type f -delete`);
    execSync(`find "${distModulesPath}" -type d -name "doc" -o -name "docs" -o -name "test" -o -name "tests" -o -name "example" -o -name "examples" | xargs rm -rf`);
  }
  
  console.log('node_modules copied successfully.');
} catch (error) {
  // console.error('Error copying node_modules:', error);
  process.exit(1);
}