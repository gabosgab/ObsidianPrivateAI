# Example Usage

This document shows how to set up and use the Private AI Chat plugin with different providers.

## Quick Start with Ollama

### Ollama Setup

1. **Install Ollama**:
   ```bash
   # macOS/Linux
   curl -fsSL https://ollama.ai/install.sh | sh
   
   # Windows
   # Download from https://ollama.ai/download
   ```

2. **Pull a Model**:
   ```bash
   ollama pull llama2
   ```

3. **Start Ollama**:
   ```bash
   ollama serve
   ```

4. **Plugin Configuration**:
   - Provider: `ollama`
   - API Endpoint: `http://localhost:11434/api/chat`

## Using LM Studio

### LM Studio Setup

1. **Download and Install**:
   - Download from https://lmstudio.ai/
   - Install and launch LM Studio

2. **Load a Model**:
   - Download a model (e.g., Llama 2 7B)
   - Load the model
   - Start the local server

3. **Plugin Configuration**:
   - Provider: `lmstudio`
   - API Endpoint: `http://localhost:1234/v1/chat/completions`

## Using vLLM

### vLLM Setup

1. **Install vLLM**:
   ```bash
   pip install vllm
   ```

2. **Start vLLM Server**:
   ```bash
   vllm serve meta-llama/Llama-2-7b-chat-hf \
     --host 0.0.0.0 \
     --port 8000
   ```

3. **Plugin Configuration**:
   - Provider: `vllm`
   - API Endpoint: `http://localhost:8000/v1/chat/completions`

## Custom Provider

### Custom Setup

1. **Configure your own LLM server** to use the OpenAI-compatible API format

2. **Plugin Configuration**:
   - Provider: `custom`
   - API Endpoint: Your custom endpoint URL

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

### Slow Responses
- Reduce the max tokens setting
- Lower the temperature for faster, more focused responses
- Check your system resources

### Plugin Not Loading
- Ensure all files are in the correct location
- Check Obsidian console for error messages
- Verify the plugin is enabled in settings 