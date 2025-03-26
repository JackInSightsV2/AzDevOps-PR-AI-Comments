const fs = require('fs');
const path = require('path');

console.log('Cleaning dist directory...');

const distPath = path.join(__dirname, '..', 'dist');

// Check if dist directory exists
if (fs.existsSync(distPath)) {
  // Delete all files and subdirectories in dist
  const deleteRecursive = (dirPath) => {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach((file) => {
        const curPath = path.join(dirPath, file);
        if (fs.lstatSync(curPath).isDirectory()) {
          // Recursive delete for directories
          deleteRecursive(curPath);
        } else {
          // Delete file
          fs.unlinkSync(curPath);
        }
      });
      // Delete the now-empty directory
      fs.rmdirSync(dirPath);
    }
  };

  deleteRecursive(distPath);
}

// Create dist directory
fs.mkdirSync(distPath, { recursive: true });

console.log('Dist directory cleaned and recreated.'); 