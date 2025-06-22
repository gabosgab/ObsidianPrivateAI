export interface LLMConfig {
	apiEndpoint: string;
	modelName: string;
	apiKey?: string;
	maxTokens?: number;
	temperature?: number;
}

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ChatRequest {
	messages: ChatMessage[];
	model: string;
	max_tokens?: number;
	temperature?: number;
	stream?: boolean;
}

export interface ChatResponse {
	choices: Array<{
		message: {
			content: string;
			role: string;
		};
		finish_reason: string;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

export class LLMService {
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		this.config = config;
	}

	async sendMessage(message: string, conversationHistory: ChatMessage[] = []): Promise<string> {
		try {
			const messages: ChatMessage[] = [
				...conversationHistory,
				{ role: 'user', content: message }
			];

			const request: ChatRequest = {
				messages,
				model: this.config.modelName,
				max_tokens: this.config.maxTokens || 1000,
				temperature: this.config.temperature || 0.7,
				stream: false
			};

			console.log('Sending request to:', this.config.apiEndpoint);
			console.log('Request payload:', JSON.stringify(request, null, 2));

			const response = await this.makeAPIRequest(request);
			return response.choices[0]?.message?.content || 'No response received';
		} catch (error) {
			console.error('Error sending message to LLM:', error);
			
			// Provide more specific error messages
			if (error.message.includes('Failed to fetch')) {
				throw new Error(`Cannot connect to LLM server at ${this.config.apiEndpoint}. Please check:\n1. Is your LLM server running?\n2. Is the endpoint URL correct?\n3. Are there any firewall/network issues?`);
			}
			
			throw new Error(`Failed to get response from LLM: ${error.message}`);
		}
	}

	private async makeAPIRequest(request: ChatRequest): Promise<ChatResponse> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.config.apiKey) {
			headers['Authorization'] = `Bearer ${this.config.apiKey}`;
		}

		console.log('Making API request to:', this.config.apiEndpoint);
		console.log('Headers:', headers);

		try {
			const response = await fetch(this.config.apiEndpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(request),
				// Add timeout and other fetch options
				signal: AbortSignal.timeout(30000), // 30 second timeout
			});

			console.log('Response status:', response.status);
			console.log('Response headers:', response.headers);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('API Error Response:', errorText);
				throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const responseData = await response.json();
			console.log('Response data:', responseData);
			return responseData;
		} catch (error) {
			console.error('Fetch error details:', error);
			
			// Handle specific error types
			if (error.name === 'AbortError') {
				throw new Error('Request timed out after 30 seconds');
			}
			
			if (error.message.includes('Failed to fetch')) {
				throw new Error(`Network error: ${error.message}`);
			}
			
			throw error;
		}
	}

	// Helper method to test connection
	async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			console.log('Testing connection to:', this.config.apiEndpoint);
			
			const testRequest: ChatRequest = {
				messages: [{ role: 'user', content: 'Hello' }],
				model: this.config.modelName,
				max_tokens: 10,
			};

			await this.makeAPIRequest(testRequest);
			return { success: true };
		} catch (error) {
			console.error('Connection test failed:', error);
			return { 
				success: false, 
				error: error.message 
			};
		}
	}

	// Method to get supported models (if the API supports it)
	async getAvailableModels(): Promise<string[]> {
		try {
			const modelsEndpoint = this.config.apiEndpoint.replace('/chat/completions', '/models');
			console.log('Fetching models from:', modelsEndpoint);
			
			const response = await fetch(modelsEndpoint, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
				},
				signal: AbortSignal.timeout(10000), // 10 second timeout
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.status}`);
			}

			const data = await response.json();
			return data.data?.map((model: any) => model.id) || [];
		} catch (error) {
			console.error('Failed to fetch available models:', error);
			return [];
		}
	}

	// Method to validate configuration
	validateConfig(): { valid: boolean; errors: string[] } {
		const errors: string[] = [];
		
		if (!this.config.apiEndpoint) {
			errors.push('API endpoint is required');
		}
		
		if (!this.config.modelName) {
			errors.push('Model name is required');
		}
		
		// Validate URL format
		try {
			new URL(this.config.apiEndpoint);
		} catch {
			errors.push('Invalid API endpoint URL format');
		}
		
		return {
			valid: errors.length === 0,
			errors
		};
	}
}

// Factory function to create LLM service based on provider
export function createLLMService(provider: 'ollama' | 'lmstudio' | 'vllm' | 'custom', config: Partial<LLMConfig>): LLMService {
	const defaultConfigs = {
		ollama: {
			apiEndpoint: 'http://localhost:11434/api/chat',
			modelName: 'llama2',
		},
		lmstudio: {
			apiEndpoint: 'http://localhost:1234/v1/chat/completions',
			modelName: 'local-model',
		},
		vllm: {
			apiEndpoint: 'http://localhost:8000/v1/chat/completions',
			modelName: 'llama-3.1-8b-instruct',
		},
		custom: {
			apiEndpoint: 'http://localhost:8000/v1/chat/completions',
			modelName: 'custom-model',
		}
	};

	const defaultConfig = defaultConfigs[provider];
	const finalConfig: LLMConfig = {
		...defaultConfig,
		...config,
	};

	return new LLMService(finalConfig);
} 