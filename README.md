# Obsidian Local LLM Chat Plugin

A plugin for Obsidian that provides a chat interface for interacting with local LLMs directly within your workspace.

## Features

- **Chat Interface**: A clean, modern chat interface that appears in the right sidebar
- **Message History**: Persistent chat history with timestamps
- **Real-time Responses**: Live interaction with your local LLM
- **Keyboard Shortcuts**: Send messages with Enter key
- **Settings Panel**: Configure your LLM endpoint and model preferences
- **Responsive Design**: Works well on different screen sizes

## Installation

### From Obsidian Community Plugins (Recommended)
1. Open Obsidian Settings
2. Go to Community Plugins
3. Turn off Safe mode
4. Click Browse and search for "Local LLM Chat"
5. Click Install, then Enable

### Manual Installation
1. Download the latest release from the releases page
2. Extract the files to your Obsidian vault's `.obsidian/plugins/` folder
3. Reload Obsidian
4. Enable the plugin in Settings > Community Plugins

## Setup

1. **Install Dependencies**: Run `npm install` to install required packages
2. **Build the Plugin**: Run `npm run build` to compile the TypeScript code
3. **Development Mode**: Run `npm run dev` for development with hot reloading

## Quick Deployment (Windows)

For Windows users, you can use the provided deployment scripts to automatically build and install the plugin:

### Using Batch File (Recommended for most users)
```bash
# Double-click or run from command line
deploy-plugin.bat
```

### Using PowerShell (Better error handling)
```powershell
# Run in PowerShell
.\deploy-plugin.ps1

# Or specify a custom Obsidian path
.\deploy-plugin.ps1 -ObsidianPath "C:\Users\YourName\Documents\ObsidianVault\.obsidian\plugins"
```

The deployment scripts will:
1. Check if Node.js is installed
2. Install dependencies if needed
3. Build the plugin
4. Copy the necessary files to your Obsidian plugins directory
5. Provide clear instructions for the next steps

## Configuration

1. Open Obsidian Settings
2. Go to Community Plugins > Local LLM Chat
3. Configure the following settings:
   - **API Endpoint**: URL of your local LLM API (e.g., `http://localhost:8000/v1/chat/completions`)
   - **Model Name**: The model to use for chat completions

## Usage

1. **Open Chat**: Click the chat icon in the ribbon or use the command palette
2. **Send Messages**: Type your question and press Enter or click Send
3. **View History**: Scroll through your conversation history
4. **Close Chat**: The chat panel can be closed like any other Obsidian panel

## Local LLM Setup

This plugin is designed to work with any local LLM that provides a compatible API. Popular options include:

- **Ollama**: Easy setup with `ollama serve`
- **LM Studio**: Desktop application with API server
- **vLLM**: High-performance inference server
- **Text Generation WebUI**: Web-based interface with API

### Example API Endpoints:
- Ollama: `http://localhost:11434/api/chat`
- LM Studio: `http://localhost:1234/v1/chat/completions`
- vLLM: `http://localhost:8000/v1/chat/completions`

## Development

### Project Structure
```
├── main.ts              # Main plugin file
├── ChatView.ts          # Chat interface component
├── LLMService.ts        # LLM API service layer
├── styles.css           # CSS styles for the chat interface
├── manifest.json        # Plugin metadata
├── package.json         # Dependencies and scripts
├── esbuild.config.mjs   # Build configuration
├── tsconfig.json        # TypeScript configuration
├── deploy-plugin.bat    # Windows batch deployment script
└── deploy-plugin.ps1    # PowerShell deployment script
```

### Building
```bash
# Install dependencies
npm install

# Development build with watch mode
npm run dev

# Production build
npm run build
```

### Deployment
```bash
# Windows - using batch file
deploy-plugin.bat

# Windows - using PowerShell
.\deploy-plugin.ps1

# Manual deployment
npm run build
# Then copy main.js, manifest.json, and styles.css to your Obsidian plugins folder
```

### Customization

The plugin is designed to be easily customizable:

- **Styling**: Modify `styles.css` to change the appearance
- **API Integration**: Update the `LLMService.ts` for different API formats
- **Features**: Add new functionality by extending the existing classes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

If you encounter any issues or have questions:

1. Check the [Issues](https://github.com/yourusername/obsidian-local-llm/issues) page
2. Create a new issue with detailed information
3. Include your Obsidian version and plugin version

## Changelog

### Version 1.0.0
- Initial release
- Basic chat interface
- Settings panel
- Message history
- Keyboard shortcuts
- Deployment scripts for Windows
