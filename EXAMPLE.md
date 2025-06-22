# Example Usage

This document shows how to set up and use the Local LLM Chat plugin with different providers.

## Quick Start with Ollama

1. **Install Ollama**:
   ```bash
   # macOS/Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   
   # Windows
   # Download from https://ollama.ai/download
   ```

2. **Start Ollama**:
   ```bash
   ollama serve
   ```

3. **Pull a Model**:
   ```bash
   ollama pull llama2
   ```

4. **Configure Plugin**:
   - Open Obsidian Settings
   - Go to Community Plugins > Local LLM Chat
   - Set Provider to "Ollama"
   - API Endpoint: `http://localhost:11434/api/chat`
   - Model Name: `llama2`

5. **Start Chatting**:
   - Click the chat icon in the ribbon
   - Type your question and press Enter

## Using LM Studio

1. **Download LM Studio**: Visit [lmstudio.ai](https://lmstudio.ai)

2. **Load a Model**:
   - Open LM Studio
   - Download a model (e.g., Llama 2 7B)
   - Load the model

3. **Start Local Server**:
   - Go to Local Server tab
   - Click "Start Server"
   - Note the endpoint URL

4. **Configure Plugin**:
   - Provider: "LM Studio"
   - API Endpoint: `http://localhost:1234/v1/chat/completions`
   - Model Name: `local-model`

## Using vLLM

1. **Install vLLM**:
   ```bash
   pip install vllm
   ```

2. **Start Server**:
   ```bash
   python -m vllm.entrypoints.openai.api_server \
     --model meta-llama/Llama-2-7b-chat-hf \
     --host 0.0.0.0 \
     --port 8000
   ```

3. **Configure Plugin**:
   - Provider: "vLLM"
   - API Endpoint: `http://localhost:8000/v1/chat/completions`
   - Model Name: `meta-llama/Llama-2-7b-chat-hf`

## Custom Provider

For any other LLM that follows the OpenAI API format:

1. **Configure Plugin**:
   - Provider: "Custom"
   - API Endpoint: Your LLM's endpoint
   - Model Name: Your model name
   - API Key: If required

## Example Conversations

### Writing Help
```
User: Help me write a blog post about machine learning
Assistant: I'd be happy to help you write a blog post about machine learning! Here's a structured approach...

User: Can you make it more technical?
Assistant: Certainly! Here's a more technical version focusing on the mathematical foundations...
```

### Code Assistance
```
User: Write a Python function to sort a list of dictionaries by a specific key
Assistant: Here's a Python function to sort a list of dictionaries by a specific key:

def sort_dict_list(data, key):
    return sorted(data, key=lambda x: x[key])

# Example usage:
data = [{'name': 'Alice', 'age': 30}, {'name': 'Bob', 'age': 25}]
sorted_data = sort_dict_list(data, 'age')
```

### Research Questions
```
User: What are the main differences between supervised and unsupervised learning?
Assistant: Here are the key differences between supervised and unsupervised learning:

Supervised Learning:
- Uses labeled training data
- Goal is to predict outputs for new inputs
- Examples: classification, regression

Unsupervised Learning:
- Uses unlabeled data
- Goal is to find patterns or structure
- Examples: clustering, dimensionality reduction
```

## Troubleshooting

### "Connection Failed" Error
- Check if your LLM server is running
- Verify the API endpoint URL
- Ensure the port is not blocked by firewall

### "Model Not Found" Error
- Verify the model name is correct
- Check if the model is loaded in your LLM server
- Try a different model name

### Slow Responses
- Reduce the max tokens setting
- Lower the temperature for faster, more focused responses
- Check your system resources

### Plugin Not Loading
- Ensure all files are in the correct location
- Check Obsidian console for error messages
- Verify the plugin is enabled in settings 