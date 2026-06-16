#!/usr/bin/env node
// Bump the extension version across the three files that must stay in sync.
// Usage: node scripts/bump-version.js <major|minor|patch|X.Y.Z>
// Edits only the version fields in place — preserves each file's existing formatting.
const fs = require('fs');

const arg = process.argv[2] || 'patch';

// Current version is the source of truth in vss-extension.json.
const vssText = fs.readFileSync('vss-extension.json', 'utf8');
const cur = (vssText.match(/"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"/) || []);
if (!cur.length) {
  console.error('Could not read current version from vss-extension.json');
  process.exit(1);
}
const [maj, min, pat] = [Number(cur[1]), Number(cur[2]), Number(cur[3])];

let next;
if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else if (arg === 'major') next = `${maj + 1}.0.0`;
else if (arg === 'minor') next = `${maj}.${min + 1}.0`;
else if (arg === 'patch') next = `${maj}.${min}.${pat + 1}`;
else {
  console.error(`Unknown bump arg "${arg}". Use major|minor|patch|X.Y.Z`);
  process.exit(1);
}
const [nMaj, nMin, nPat] = next.split('.').map(Number);

// package.json + vss-extension.json: replace the "version": "X.Y.Z" string field.
for (const file of ['package.json', 'vss-extension.json']) {
  const text = fs.readFileSync(file, 'utf8');
  const updated = text.replace(/("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${next}$2`);
  if (updated === text) { console.error(`No version field updated in ${file}`); process.exit(1); }
  fs.writeFileSync(file, updated);
}

// src/task.json: version is an object { Major, Minor, Patch }.
let task = fs.readFileSync('src/task.json', 'utf8');
const before = task;
task = task
  .replace(/("Major"\s*:\s*)\d+/, `$1${nMaj}`)
  .replace(/("Minor"\s*:\s*)\d+/, `$1${nMin}`)
  .replace(/("Patch"\s*:\s*)\d+/, `$1${nPat}`);
if (task === before) { console.error('No version object updated in src/task.json'); process.exit(1); }
fs.writeFileSync('src/task.json', task);

console.log(`Bumped ${maj}.${min}.${pat} -> ${next} across package.json, vss-extension.json, src/task.json`);
