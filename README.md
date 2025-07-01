# Private AI Chat for Obsidian

A powerful Obsidian plugin that integrates local Large Language Models (LLMs) with your Obsidian vault, providing intelligent chat capabilities with automatic context retrieval from your notes.

## Features

- 🤖 **Local LLM Integration**: Connect to local LLM servers (Ollama, LM Studio, vLLM, or custom endpoints)
- 🔍 **Smart Vault Search**: Automatically search your Obsidian vault for relevant information to provide contextual responses
- 📚 **Context-Aware Responses**: The AI can reference and cite specific notes from your vault
- 🎯 **Relevance Scoring**: Advanced search algorithm that scores note relevance based on content, tags, headings, and metadata
- 🔄 **Real-time Streaming**: Get responses as they're generated with streaming support
- ⚙️ **Flexible Configuration**: Customize search parameters, token limits, and relevance thresholds
- 🎨 **Markdown Support**: Full markdown rendering in responses
- 📱 **Clickable References**: Click on referenced notes to open them directly in Obsidian

## Search Features

The plugin includes an intelligent search system that:

- **Searches across all markdown files** in your vault
- **Scores relevance** based on:
  - File names and paths
  - Content matches
  - Tags and frontmatter
  - Headings and structure
- **Extracts relevant content** from matching notes
- **Provides context** to the LLM for more accurate responses
- **Shows which notes were used** in each response
- **Allows quick access** to referenced notes

## Setup

### 1. Install the Plugin

We're pending review by the Obsidian plugin review team, in the meantime, you can follow our beta test quickstart guide.

#### [Beta Test Quickstart Guide (google doc)](https://docs.google.com/document/d/1Nc3dROvNJC2yl5uiznA5759tQ3afBucKm8paYyjJTBo/edit?usp=sharing)

### Example Queries

- "What did I write about machine learning?"
- "Find my notes on project planning"
- "What are my thoughts on productivity systems?"
- "Summarize my research on AI"

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## Attributions

This project respects and is compatible with the original licenses of all code and dependencies used:

### Development Tools
- **[esbuild](https://esbuild.github.io/)** - MIT License - Used for bundling the plugin
- **[TypeScript](https://www.typescriptlang.org/)** - Apache-2.0 License - Used for type safety
- **[Obsidian API](https://github.com/obsidianmd/obsidian-api)** - MIT License - Official Obsidian plugin API

### Dependencies
All development dependencies are used under their respective open-source licenses (MIT, Apache-2.0, ISC, BSD) and are properly externalized in the build process.

### Third-Party Services
This plugin integrates with local LLM services but does not include any of their code:
- **[LM Studio](https://lmstudio.ai/)** - Proprietary - Local LLM interface

## License

This project is licensed under the [MIT License](LICENSE.md).
