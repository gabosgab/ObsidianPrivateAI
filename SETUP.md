# Setup Guide

## Prerequisites

Before you can build and run this Obsidian plugin, you need to install Node.js and npm.

### Installing Node.js

1. **Download Node.js**: Visit [nodejs.org](https://nodejs.org/) and download the LTS version
2. **Install Node.js**: Run the installer and follow the setup wizard
3. **Verify Installation**: Open a new terminal/command prompt and run:
   ```bash
   node --version
   npm --version
   ```

### Alternative Installation Methods

#### Windows (using Chocolatey)
```bash
choco install nodejs
```

#### Windows (using Scoop)
```bash
scoop install nodejs
```

#### macOS (using Homebrew)
```bash
brew install node
```

#### Linux (using apt)
```bash
sudo apt update
sudo apt install nodejs npm
```

## Building the Plugin

Once Node.js and npm are installed:

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build the Plugin**:
   ```bash
   npm run build
   ```

3. **Development Mode** (with hot reloading):
   ```bash
   npm run dev
   ```

## Installing in Obsidian

1. **Copy Files**: Copy the entire plugin folder to your Obsidian vault's `.obsidian/plugins/` directory
2. **Enable Plugin**: In Obsidian, go to Settings > Community Plugins and enable "Local LLM Chat"
3. **Configure Settings**: Go to the plugin settings and configure your local LLM endpoint

## Troubleshooting

### "npm is not recognized"
- Make sure Node.js is properly installed
- Restart your terminal/command prompt after installation
- Check that Node.js is added to your system PATH

### Build Errors
- Make sure all dependencies are installed: `npm install`
- Check that TypeScript is installed: `npm install -g typescript`
- Verify your Node.js version is compatible (v14 or higher recommended)

### Plugin Not Loading
- Check the Obsidian console for error messages
- Ensure all files are copied to the correct location
- Verify the plugin is enabled in Obsidian settings 