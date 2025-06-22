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

			const response = await this.makeAPIRequest(request);
			return response.choices[0]?.message?.content || 'No response received';
		} catch (error) {
			console.error('Error sending message to LLM:', error);
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

		const response = await fetch(this.config.apiEndpoint, {
			method: 'POST',
			headers,
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
		}

		return await response.json();
	}

	// Helper method to test connection
	async testConnection(): Promise<boolean> {
		try {
			const testRequest: ChatRequest = {
				messages: [{ role: 'user', content: 'Hello' }],
				model: this.config.modelName,
				max_tokens: 10,
			};

			await this.makeAPIRequest(testRequest);
			return true;
		} catch (error) {
			console.error('Connection test failed:', error);
			return false;
		}
	}

	// Method to get supported models (if the API supports it)
	async getAvailableModels(): Promise<string[]> {
		try {
			const response = await fetch(`${this.config.apiEndpoint.replace('/chat/completions', '/models')}`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
				}
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