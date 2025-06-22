import fs from 'fs';
import path from 'path';

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

console.log(`Version bumped from ${currentVersion} to ${newVersion}`);

// Create versions.json if it doesn't exist
const versionsPath = path.join(process.cwd(), 'versions.json');
if (!fs.existsSync(versionsPath)) {
    const versions = {
        "1.0.0": "0.15.0"
    };
    fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2));
    console.log('Created versions.json');
} 