import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Read current manifest
const manifestPath = path.join(process.cwd(), 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Get current version
const currentVersion = manifest.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

// Increment patch version
const newVersion = `${major}.${minor}.${patch + 1}`;

// Update manifest
manifest.version = newVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

// Update package.json
const packagePath = path.join(process.cwd(), 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));

console.log(`Version bumped from ${currentVersion} to ${newVersion}`);
execSync(`git add manifest.json package.json`, { stdio: 'inherit' });
execSync(`git commit -m "Bump version to ${newVersion}"`, { stdio: 'inherit' });

// Git tag and push
console.log(`Creating git tag ${newVersion}...`);
execSync(`git tag ${newVersion}`, { stdio: 'inherit' });

console.log('Pushing tags to remote...');
execSync('git push', { stdio: 'inherit' });
execSync('git push --tags', { stdio: 'inherit' });

// Wait 30 seconds
console.log('Waiting 30 seconds for GitHub action to create the release...');
await new Promise(resolve => setTimeout(resolve, 30000));

// Open releases page in browser
const releaseUrl = 'https://github.com/gabosgab/ObsidianPrivateAI/releases';
console.log(`Opening ${releaseUrl} in browser...`);

// Cross-platform browser opening
const platform = process.platform;
let openCommand;

if (platform === 'darwin') {
  openCommand = `open "${releaseUrl}"`;
} else if (platform === 'win32') {
  openCommand = `start "${releaseUrl}"`;
} else {
  openCommand = `xdg-open "${releaseUrl}"`;
}

execSync(openCommand, { stdio: 'inherit' });
console.log('Done!');
