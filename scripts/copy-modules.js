const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Copying ALL node_modules packages...');

const sourceModulesPath = path.join(__dirname, '..', 'node_modules');
const distModulesPath = path.join(__dirname, '..', 'dist', 'node_modules');

// Create dist/node_modules directory if it doesn't exist
if (!fs.existsSync(distModulesPath)) {
  fs.mkdirSync(distModulesPath, { recursive: true });
}

// FUCK IT: Copy ALL packages to avoid missing dependencies. We'll deal with file limits later.

// Exclude build-time only packages that consume too many files
const buildTimeOnlyPackages = [
  'lodash',           // 1,049 files - used by webpack build tools only
  'caniuse-lite',     // 835 files - used by webpack browserslist only  
  'webpack',          // 613 files - build tool system only
  'webpack-cli',      // build tool
  'webpack-dev-server', // build tool
  'webpack-dev-middleware', // build tool
  'webpack-merge',    // build tool
  'webpack-sources',  // build tool
  'html-webpack-plugin', // build tool
  'terser-webpack-plugin', // build tool
  'css-loader',       // build tool
  'style-loader',     // build tool
  'ts-loader',        // build tool
  'mini-css-extract-plugin', // build tool (if present)
];

// Get ALL packages from node_modules
const allPackages = fs.readdirSync(sourceModulesPath, { withFileTypes: true })
  .filter(dirent => dirent.isDirectory())
  .map(dirent => dirent.name)
  .filter(name => !name.startsWith('.')) // Exclude hidden directories
  .sort();

console.log(`Found ${allPackages.length} total packages, excluding ${buildTimeOnlyPackages.length} build-time packages`);

// Create package list with all packages except build-time only ones
const packagesToCopy = allPackages
  .filter(name => !buildTimeOnlyPackages.includes(name))
  .map(name => {
    // Special handling for scoped packages
    if (name.startsWith('@')) {
      const scopedPackages = fs.readdirSync(path.join(sourceModulesPath, name), { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => ({ name: `${name}/${dirent.name}`, mainJsFiles: [''] }));
      return scopedPackages;
    }
    
    // Special cases for packages with specific dist structures
    if (name === 'axios') {
      return { name, mainJsFiles: ['', 'dist', 'lib'] };
    }
    if (name === '@google-cloud/vertexai') {
      return { name, mainJsFiles: ['', 'build'] };
    }
    if (name === 'openai' || name === '@anthropic-ai/sdk') {
      return { name, mainJsFiles: ['', 'dist'] };
    }
    
    return { name, mainJsFiles: [''] };
  }).flat();

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
    
    // Note: All JSON files are now copied automatically with the JS/CJS files above
    
    // Copy JS files from main directories (root, lib, out, etc.)
    for (const jsDir of pkg.mainJsFiles) {
      try {
        const sourcePath = path.join(pkgPath, jsDir);
        const destPath = path.join(destPkgPath, jsDir);
        
        if (fs.existsSync(sourcePath)) {
          // Create destination directory
          if (!fs.existsSync(destPath)) {
            fs.mkdirSync(destPath, { recursive: true });
          }
          
          // Copy JS, CJS, and JSON files (recursively, preserving structure, excluding test folders)
          if (process.platform === 'win32') {
            console.log(`Copying JS, CJS, and JSON files from ${sourcePath} to ${destPath}`);
            // xcopy cannot filter recursively by extension while preserving folder structure in one call reliably.
                                     // Use PowerShell to mirror .js, .cjs, and .json files, excluding test/dev folders.
            const ps = `Get-ChildItem -Path "${sourcePath}" -Recurse -Include *.js,*.cjs,*.json | Where-Object { $_.FullName -notmatch '\\\\(test|tests|spec|specs|example|examples|demo|demos|benchmark|benchmarks|\\.nyc_output|coverage|docs)\\\\' } | ForEach-Object { $rel = $_.FullName.Substring('${sourcePath}'.length).TrimStart('\\'); $target = Join-Path "${destPath}" $rel; New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($target)) -Force > $null; Copy-Item $_.FullName $target -Force }`;
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`);
          } else {
            console.log(`Copying JS, CJS, and JSON files from ${sourcePath} to ${destPath}`);
                                     // For Unix-like systems - include .js, .cjs, and .json files, excluding test/dev folders
            execSync(`find "${sourcePath}" \\( -name "*.js" -o -name "*.cjs" -o -name "*.json" \\) -type f ! -path "*/test/*" ! -path "*/tests/*" ! -path "*/spec/*" ! -path "*/specs/*" ! -path "*/example/*" ! -path "*/examples/*" ! -path "*/demo/*" ! -path "*/demos/*" ! -path "*/benchmark/*" ! -path "*/benchmarks/*" ! -path "*/.nyc_output/*" ! -path "*/coverage/*" ! -path "*/docs/*" -exec cp --parents -t "${destPkgPath}" {} \\;`);
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

    // Special handling: ensure azure-pipelines-task-lib can resolve 'uuid/v4'
    if (pkg.name === 'azure-pipelines-task-lib') {
      try {
        const nestedUuidSrc = path.join(pkgPath, 'node_modules', 'uuid');
        if (fs.existsSync(nestedUuidSrc)) {
          const nestedUuidDest = path.join(destPkgPath, 'node_modules', 'uuid');
          if (!fs.existsSync(nestedUuidDest)) {
            fs.mkdirSync(nestedUuidDest, { recursive: true });
          }

          // Copy package.json if present
          const nestedPkgJson = path.join(nestedUuidSrc, 'package.json');
          if (fs.existsSync(nestedPkgJson)) {
            fs.copyFileSync(nestedPkgJson, path.join(nestedUuidDest, 'package.json'));
          }

          // Copy all JS files recursively
          if (process.platform === 'win32') {
            const psNested = `Get-ChildItem -Path "${nestedUuidSrc}" -Recurse -Filter *.js | ForEach-Object { $rel = $_.FullName.Substring('${nestedUuidSrc}'.length).TrimStart('\\'); $target = Join-Path "${nestedUuidDest}" $rel; New-Item -ItemType Directory -Path ([System.IO.Path]::GetDirectoryName($target)) -Force > $null; Copy-Item $_.FullName $target -Force }`;
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psNested}"`);
          } else {
            execSync(`find "${nestedUuidSrc}" -name "*.js" -type f -exec cp --parents -t "${nestedUuidDest}" {} \\;`);
          }

          // Create v4.js shim for legacy uuid structure
          const v4ShimPath = path.join(nestedUuidDest, 'v4.js');
          if (!fs.existsSync(v4ShimPath)) {
            fs.writeFileSync(v4ShimPath, "module.exports = require('./v4-legacy.js') || require('./').v4;");
            console.log('Created v4.js shim in nested uuid');
          }

          console.log('Copied nested uuid for azure-pipelines-task-lib');
        }
      } catch (err) {
        console.error('Error ensuring uuid for azure-pipelines-task-lib:', err.message);
      }
    }

    // Additional UUID v4 shim at top level for safety
    if (pkg.name === 'uuid') {
      try {
        const v4ShimPath = path.join(destPkgPath, 'v4.js');
        if (!fs.existsSync(v4ShimPath)) {
          // For uuid v3.x.x, v4 is available as a property of the main module
          fs.writeFileSync(v4ShimPath, "module.exports = require('./').v4;");
          console.log('Created v4.js shim at uuid root');
        }
      } catch (err) {
        console.error('Error creating UUID v4 shim:', err.message);
      }
    }
  }
  
  console.log('Minimal essential files copied successfully.');
} catch (error) {
  console.error('Error in copy process:', error);
  process.exit(1);
}