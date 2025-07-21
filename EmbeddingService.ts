import { LoggingUtility } from './LoggingUtility';
import { requestUrl } from 'obsidian';

interface EmbeddingRequest {
	input: string | string[];
	model?: string;
}

interface EmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
	model: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

export interface EmbeddingConfig {
	endpoint: string;
	model: string;
}

export class EmbeddingService {
	private config: EmbeddingConfig;

	constructor(config: EmbeddingConfig) {
		this.config = config;
	}

	/**
	 * Generate embeddings for a text
	 */
	async generateEmbedding(text: string): Promise<number[]> {
		try {
			const request: EmbeddingRequest = {
				input: text,
				model: this.config.model
			};

			LoggingUtility.log('Generating embedding for text length:', text.length);

			const response = await requestUrl({
				url: this.config.endpoint,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(request)
			});

			if (response.status >= 400) {
				const errorText = response.text;
				LoggingUtility.error('Embedding API Error Response:', errorText);
				throw new Error(`Embedding API request failed: ${response.status} - ${errorText}`);
			}

			const responseData = response.json as EmbeddingResponse;
			
			if (!responseData.data || responseData.data.length === 0) {
				throw new Error('No embedding data returned from API');
			}

			const embedding = responseData.data[0].embedding;
			LoggingUtility.log(`Generated embedding with ${embedding.length} dimensions`);
			
			return embedding;

		} catch (error) {
			LoggingUtility.error('Error generating embedding:', error);
			throw new Error(`Failed to generate embedding: ${error.message}`);
		}
	}

	/**
	 * Generate embeddings for multiple texts
	 */
	async generateEmbeddings(texts: string[]): Promise<number[][]> {
		try {
			const request: EmbeddingRequest = {
				input: texts,
				model: this.config.model
			};

			LoggingUtility.log('Generating embeddings for', texts.length, 'texts');

			const response = await requestUrl({
				url: this.config.endpoint,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(request)
			});

			if (response.status >= 400) {
				const errorText = response.text;
				LoggingUtility.error('Embedding API Error Response:', errorText);
				throw new Error(`Embedding API request failed: ${response.status} - ${errorText}`);
			}

			const responseData = response.json as EmbeddingResponse;
			
			if (!responseData.data || responseData.data.length === 0) {
				throw new Error('No embedding data returned from API');
			}

			// Sort by index to ensure correct order
			const sortedData = responseData.data.sort((a, b) => a.index - b.index);
			const embeddings = sortedData.map(item => item.embedding);
			
			LoggingUtility.log(`Generated ${embeddings.length} embeddings with ${embeddings[0]?.length || 0} dimensions each`);
			
			return embeddings;

		} catch (error) {
			LoggingUtility.error('Error generating embeddings:', error);
			throw new Error(`Failed to generate embeddings: ${error.message}`);
		}
	}

	/**
	 * Test the embedding endpoint
	 */
	async testConnection(): Promise<{ success: boolean; error?: string; dimensions?: number }> {
		try {
			LoggingUtility.log('Testing embedding endpoint:', this.config.endpoint);
			
			const testEmbedding = await this.generateEmbedding('test');
			
			return { 
				success: true, 
				dimensions: testEmbedding.length 
			};
		} catch (error) {
			LoggingUtility.error('Embedding connection test failed:', error);
			return { 
				success: false, 
				error: error.message 
			};
		}
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: EmbeddingConfig): void {
		this.config = config;
		LoggingUtility.log('Updated embedding service config:', config);
	}
} 