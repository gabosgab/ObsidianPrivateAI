import { LoggingUtility } from './LoggingUtility';

export interface LLMConfig {
	apiEndpoint: string;
	maxTokens?: number;
	temperature?: number;
}

// Centralized error message function
function getLLMErrorMessage(error: any, endpoint?: string): string {
	// Check if it's a network/connection error
	if (error.message.includes('Failed to fetch') || 
		error.message.includes('NetworkError') ||
		error.message.includes('ERR_NETWORK') ||
		error.message.includes('ERR_CONNECTION_REFUSED') ||
		error.message.includes('ERR_EMPTY_RESPONSE')) {
		return `It appears your local LLM server is not running.
* Check that LM Studio is running and a model is loaded
* Check that you started local server
* Check that Cross-Origin-Resource-Sharing CORS is enabled		
`;
	}
	
	// Check if it's a timeout error
	if (error.name === 'AbortError' && error.message.includes('timeout')) {
		return 'Request cancelled';
	}
	
	// Check if it's a server error (5xx)
	if (error.message.includes('500') || error.message.includes('502') || 
		error.message.includes('503') || error.message.includes('504')) {
		return 'Is your LLM server running? 500 error';
	}
	
	// For other errors, return a generic message
	return `## ⚠️ Connection Error

It appears your local LLM server is not running.

### Troubleshooting Steps
* Check that LM Studio is running and a model is loaded
* **In LM Studio, click the Local Server tab on the left hand side:**
    * Verify that the server is running
    * Verify that Cross-Origin-Resource-Sharing CORS is enabled
    * Verify that the port number matches that in the settings page of this plugin
`;
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

			LoggingUtility.log('Sending request to:', this.config.apiEndpoint);
			LoggingUtility.log('Request payload:', JSON.stringify(request, null, 2));

			const response = await this.makeAPIRequest(request);
			return response.choices[0]?.message?.content || 'No response content';
		} catch (error) {
			LoggingUtility.error('Error sending message to LLM:', error);
			throw error;
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

			LoggingUtility.log('Sending streaming request to:', this.config.apiEndpoint);
			LoggingUtility.log('Request payload:', JSON.stringify(request, null, 2));

			await this.makeStreamingAPIRequest(request, callback, abortSignal);
		} catch (error) {
			if (error.name === 'AbortError') {
				LoggingUtility.log('Request was cancelled by user');
				return;
			}
			LoggingUtility.error('Error sending streaming message to LLM:', error);
			throw error;
		}
	}

	private async makeAPIRequest(request: ChatRequest): Promise<ChatResponse> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		LoggingUtility.log('Making API request to:', this.config.apiEndpoint);
		LoggingUtility.log('Headers:', headers);

		try {
			const response = await fetch(this.config.apiEndpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(request),
				signal: AbortSignal.timeout(30000), // 30 second timeout
			});

			LoggingUtility.log('Response status:', response.status);
			LoggingUtility.log('Response headers:', response.headers);

			if (!response.ok) {
				const errorText = await response.text();
				LoggingUtility.error('API Error Response:', errorText);
				throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
			}

			const responseData = await response.json();
			LoggingUtility.log('Response data:', responseData);
			return responseData;
		} catch (error) {
			LoggingUtility.error('Fetch error details:', error);
			throw new Error(getLLMErrorMessage(error, this.config.apiEndpoint));
		}
	}

	private async makeStreamingAPIRequest(request: ChatRequest, callback: StreamCallback, abortSignal?: AbortSignal): Promise<void> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};

		LoggingUtility.log('Making streaming API request to:', this.config.apiEndpoint);

		try {
			const response = await fetch(this.config.apiEndpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(request),
				signal: abortSignal || AbortSignal.timeout(60000), // 60 second timeout for streaming
			});

			LoggingUtility.log('Streaming response status:', response.status);

			if (!response.ok) {
				const errorText = await response.text();
				LoggingUtility.error('Streaming API Error Response:', errorText);
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
								LoggingUtility.warn('Failed to parse streaming chunk:', data, parseError);
							}
						}
					}
				}
			} finally {
				reader.releaseLock();
			}
		} catch (error) {
			LoggingUtility.error('Streaming fetch error details:', error);
			
			// Handle specific error types
			if (error.name === 'AbortError') {
				// Re-throw as AbortError so the caller can detect user cancellation
				throw error;
			}
			
			throw new Error(getLLMErrorMessage(error, this.config.apiEndpoint));
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
			LoggingUtility.log('Testing connection to:', this.config.apiEndpoint);
			
			const testRequest: ChatRequest = {
				messages: [{ role: 'user', content: 'Hello' }],
				max_tokens: 10,
			};

			await this.makeAPIRequest(testRequest);
			return { success: true };
		} catch (error) {
			LoggingUtility.error('Connection test failed:', error);
			return { 
				success: false, 
				error: getLLMErrorMessage(error, this.config.apiEndpoint)
			};
		}
	}

	// Method to get supported models (if the API supports it)
	async getAvailableModels(): Promise<string[]> {
		try {
			const modelsEndpoint = this.config.apiEndpoint.replace('/chat/completions', '/models');
			LoggingUtility.log('Fetching models from:', modelsEndpoint);
			
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			
			const response = await fetch(modelsEndpoint, {
				method: 'GET',
				headers,
				signal: AbortSignal.timeout(10000), // 10 second timeout
			});

			if (!response.ok) {
				throw new Error(`Failed to fetch models: ${response.status}`);
			}

			const data = await response.json();
			return data.data?.map((model: any) => model.id) || [];
		} catch (error) {
			LoggingUtility.error('Failed to fetch available models:', error);
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