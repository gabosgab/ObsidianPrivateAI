export interface LLMConfig {
	apiEndpoint: string;
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

export interface StreamChunk {
	choices: Array<{
		delta: {
			content?: string;
			role?: string;
		};
		finish_reason?: string;
	}>;
}

export type StreamCallback = (chunk: string, isComplete: boolean) => void;

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

	async sendMessageStream(message: string, conversationHistory: ChatMessage[] = [], callback: StreamCallback, abortSignal?: AbortSignal): Promise<void> {
		try {
			const messages: ChatMessage[] = [
				...conversationHistory,
				{ role: 'user', content: message }
			];

			const request: ChatRequest = {
				messages,
				max_tokens: this.config.maxTokens || 1000,
				temperature: this.config.temperature || 0.7,
				stream: true
			};

			console.log('Sending streaming request to:', this.config.apiEndpoint);
			console.log('Request payload:', JSON.stringify(request, null, 2));

			await this.makeStreamingAPIRequest(request, callback, abortSignal);
		} catch (error) {
			console.error('Error sending streaming message to LLM:', error);
			
			// Check if it's an abort error - don't throw for user cancellation
			if (error.name === 'AbortError') {
				console.log('Request was cancelled by user');
				return; // Exit gracefully without throwing an error
			}
			
			// Provide more specific error messages
			if (error.message.includes('Failed to fetch')) {
				throw new Error(`Cannot connect to LLM server at ${this.config.apiEndpoint}. Please check:\n1. Is your LLM server running?\n2. Is the endpoint URL correct?\n3. Are there any firewall/network issues?`);
			}
			
			throw new Error(`Failed to get streaming response from LLM: ${error.message}`);
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

	private async makeStreamingAPIRequest(request: ChatRequest, callback: StreamCallback, abortSignal?: AbortSignal): Promise<void> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		if (this.config.apiKey) {
			headers['Authorization'] = `Bearer ${this.config.apiKey}`;
		}

		console.log('Making streaming API request to:', this.config.apiEndpoint);

		try {
			const response = await fetch(this.config.apiEndpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(request),
				signal: abortSignal || AbortSignal.timeout(60000), // 60 second timeout for streaming
			});

			console.log('Streaming response status:', response.status);

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Streaming API Error Response:', errorText);
				throw new Error(`Streaming API request failed: ${response.status} ${response.statusText} - ${errorText}`);
			}

			if (!response.body) {
				throw new Error('No response body for streaming request');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let isCompleted = false; // Flag to prevent multiple completion signals

			try {
				while (true) {
					const { done, value } = await reader.read();
					
					if (done) {
						// Process any remaining buffer
						if (buffer.trim() && !isCompleted) {
							this.processStreamChunk(buffer, callback);
						}
						if (!isCompleted) {
							callback('', true); // Signal completion
							isCompleted = true;
						}
						break;
					}

					// Decode the chunk and add to buffer
					buffer += decoder.decode(value, { stream: true });

					// Process complete lines
					const lines = buffer.split('\n');
					buffer = lines.pop() || ''; // Keep incomplete line in buffer

					for (const line of lines) {
						if (line.trim() && line.startsWith('data: ')) {
							const data = line.slice(6); // Remove 'data: ' prefix
							
							if (data === '[DONE]') {
								if (!isCompleted) {
									callback('', true); // Signal completion
									isCompleted = true;
								}
								return;
							}

							try {
								const chunk: StreamChunk = JSON.parse(data);
								this.processStreamChunk(chunk, callback, isCompleted);
								// Check if completion was signaled by processStreamChunk
								if (chunk.choices?.some(choice => choice.finish_reason)) {
									isCompleted = true;
								}
							} catch (parseError) {
								console.warn('Failed to parse streaming chunk:', data, parseError);
							}
						}
					}
				}
			} finally {
				reader.releaseLock();
			}
		} catch (error) {
			console.error('Streaming fetch error details:', error);
			
			// Handle specific error types
			if (error.name === 'AbortError') {
				// Re-throw as AbortError so the caller can detect user cancellation
				throw error;
			}
			
			if (error.message.includes('Failed to fetch')) {
				throw new Error(`Network error during streaming: ${error.message}`);
			}
			
			throw error;
		}
	}

	private processStreamChunk(chunk: StreamChunk | string, callback: StreamCallback, isCompleted: boolean = false): void {
		if (typeof chunk === 'string') {
			// Handle raw string chunks (fallback)
			if (chunk.trim() && !isCompleted) {
				callback(chunk, false);
			}
			return;
		}

		// Handle structured chunks
		for (const choice of chunk.choices) {
			if (choice.delta?.content && !isCompleted) {
				callback(choice.delta.content, false);
			}
			
			if (choice.finish_reason && !isCompleted) {
				callback('', true); // Signal completion
				return;
			}
		}
	}

	// Helper method to test connection
	async testConnection(): Promise<{ success: boolean; error?: string }> {
		try {
			console.log('Testing connection to:', this.config.apiEndpoint);
			
			const testRequest: ChatRequest = {
				messages: [{ role: 'user', content: 'Hello' }],
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

// Factory function to create LLM service
export function createLLMService(config: Partial<LLMConfig>): LLMService {
	const defaultConfig: LLMConfig = {
		apiEndpoint: 'http://localhost:1234/v1/chat/completions',
		...config,
	};

	return new LLMService(defaultConfig);
} 