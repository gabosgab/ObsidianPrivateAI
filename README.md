# Local LLM Chat for Obsidian

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

1. Download the latest release
2. Extract the files to your Obsidian plugins folder
3. Enable the plugin in Obsidian settings

### 2. Configure Your LLM

1. Open the plugin settings
2. Select your LLM provider:
   - **Ollama**: Install from [ollama.ai](https://ollama.ai) and run `ollama serve`
   - **LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai)
   - **vLLM**: Install with `pip install vllm`
   - **Custom**: Use any OpenAI-compatible API endpoint

3. Configure your API endpoint and settings
4. Test the connection using the "Test Connection" button

### 3. Configure Search Settings

- **Enable Obsidian Search**: Toggle vault search on/off
- **Max Search Results**: Number of notes to include as context (1-10)
- **Max Context Tokens**: Maximum tokens from search results (500-4000)
- **Search Relevance Threshold**: Minimum relevance score (0-1)

## Usage

### Basic Chat

1. Click the chat icon in the ribbon or use the command palette
2. Type your question in the chat interface
3. The AI will search your vault for relevant information and respond

### Search Controls

- **Toggle Search**: Use the search button in the chat header to enable/disable search
- **View Used Notes**: Each response shows which notes were used as context
- **Open References**: Click on any referenced note to open it in Obsidian

### Example Queries

- "What did I write about machine learning?"
- "Find my notes on project planning"
- "What are my thoughts on productivity systems?"
- "Summarize my research on AI"

## Configuration

### LLM Settings

- **Provider**: Choose your local LLM provider
- **API Endpoint**: URL for your LLM server
- **API Key**: Optional authentication key
- **Max Tokens**: Maximum response length
- **Temperature**: Controls response randomness

### Search Settings

- **Enable Search**: Master toggle for vault search
- **Max Results**: Limit number of notes used as context
- **Max Tokens**: Limit context size to manage token usage
- **Relevance Threshold**: Filter out low-relevance notes

## Supported LLM Providers

### Ollama
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start server
ollama serve

# Pull a model
ollama pull llama2

# Default endpoint: http://localhost:11434/api/chat
```

### LM Studio
1. Download and install LM Studio
2. Load a model in the app
3. Start the local server
4. Use the provided endpoint URL

### vLLM
```bash
# Install vLLM
pip install vllm

# Start server
python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-2-7b-chat-hf

# Default endpoint: http://localhost:8000/v1/chat/completions
```

### Custom Endpoints
Use any OpenAI-compatible API endpoint by selecting "Custom" and providing your endpoint URL.

## Troubleshooting

### Connection Issues
- Ensure your LLM server is running
- Check the API endpoint URL
- Verify firewall/network settings
- Test with the "Test Connection" button

### Search Issues
- Check that you have markdown files in your vault
- Adjust the relevance threshold if no results are found
- Increase max results if you want more context
- Check the browser console for search logs

### Performance
- Reduce max search results for faster responses
- Lower the max context tokens to reduce processing time
- Increase the relevance threshold to filter out less relevant notes

## Development

### Building
```bash
npm install
npm run build
```

### Testing
1. Build the plugin
2. Copy to your Obsidian plugins folder
3. Enable in Obsidian settings
4. Test with your local LLM server

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the MIT License.
