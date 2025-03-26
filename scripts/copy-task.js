const fs = require('fs');
const path = require('path');

console.log('Copying task.json from src to dist...');

const srcTaskPath = path.join(__dirname, '..', 'src', 'task.json');
const distTaskPath = path.join(__dirname, '..', 'dist', 'task.json');

// Check if source task.json exists
if (fs.existsSync(srcTaskPath)) {
  // Copy the file
  fs.copyFileSync(srcTaskPath, distTaskPath);
  console.log('task.json copied successfully.');
} else {
  // console.error('Error: src/task.json not found!');
  process.exit(1);
} 