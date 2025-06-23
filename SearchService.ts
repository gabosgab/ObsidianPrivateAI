import { App, TFile, CachedMetadata, getAllTags } from 'obsidian';

export interface SearchResult {
	file: TFile;
	content: string;
	relevance: number;
	title: string;
	path: string;
}

export interface SearchOptions {
	maxResults: number;
	maxTokens: number;
	threshold: number;
}

export class SearchService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Search for relevant notes in the Obsidian vault
	 */
	async searchVault(query: string, options: SearchOptions): Promise<SearchResult[]> {
		try {
			console.log('Searching vault for:', query);
			console.log('Search options:', options);
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			console.log(`Found ${files.length} markdown files to search`);
			
			const results: SearchResult[] = [];

			// Search through each file
			for (const file of files) {
				try {
					const result = await this.searchFile(file, query, options);
					if (result && result.relevance >= options.threshold) {
						results.push(result);
						console.log(`Found relevant file: ${result.title} (${(result.relevance * 100).toFixed(1)}% relevant)`);
					}
				} catch (error) {
					console.warn(`Error searching file ${file.path}:`, error);
				}
			}

			// Sort by relevance and limit results
			results.sort((a, b) => b.relevance - a.relevance);
			const finalResults = results.slice(0, options.maxResults);
			
			console.log(`Search completed. Found ${finalResults.length} relevant notes out of ${results.length} total matches.`);
			return finalResults;

		} catch (error) {
			console.error('Error searching vault:', error);
			return [];
		}
	}

	/**
	 * Search a single file for relevance to the query
	 */
	private async searchFile(file: TFile, query: string, options: SearchOptions): Promise<SearchResult | null> {
		try {
			// Read file content
			const content = await this.app.vault.read(file);
			const metadata = this.app.metadataCache.getFileCache(file);
			
			// Calculate relevance score
			const relevance = this.calculateRelevance(query, content, metadata, file);
			
			if (relevance < options.threshold) {
				return null;
			}

			// Extract relevant content
			const relevantContent = this.extractRelevantContent(content, query, options.maxTokens);
			
			return {
				file,
				content: relevantContent,
				relevance,
				title: this.getFileTitle(file, metadata),
				path: file.path
			};

		} catch (error) {
			console.warn(`Error processing file ${file.path}:`, error);
			return null;
		}
	}

	/**
	 * Calculate relevance score for a file based on the query
	 */
	private calculateRelevance(query: string, content: string, metadata: CachedMetadata | null, file: TFile): number {
		const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
		const contentLower = content.toLowerCase();
		const fileName = file.basename.toLowerCase();
		const filePath = file.path.toLowerCase();
		
		let score = 0;
		let totalTerms = queryTerms.length;

		for (const term of queryTerms) {
			let termScore = 0;
			
			// Check file name (highest weight)
			if (fileName.includes(term)) {
				termScore += 10;
			}
			
			// Check file path
			if (filePath.includes(term)) {
				termScore += 5;
			}
			
			// Check content
			const contentMatches = (contentLower.match(new RegExp(term, 'gi')) || []).length;
			termScore += Math.min(contentMatches * 0.5, 5); // Cap at 5 points for content matches
			
			// Check tags
			if (metadata?.tags) {
				for (const tag of metadata.tags) {
					if (tag.tag.toLowerCase().includes(term)) {
						termScore += 3;
						break;
					}
				}
			}
			
			// Check frontmatter
			if (metadata?.frontmatter) {
				const frontmatterStr = JSON.stringify(metadata.frontmatter).toLowerCase();
				if (frontmatterStr.includes(term)) {
					termScore += 2;
				}
			}
			
			// Check headings
			if (metadata?.headings) {
				for (const heading of metadata.headings) {
					if (heading.heading.toLowerCase().includes(term)) {
						termScore += 2;
						break;
					}
				}
			}
			
			score += termScore;
		}

		// Normalize score to 0-1 range
		return Math.min(score / (totalTerms * 10), 1);
	}

	/**
	 * Extract the most relevant content from a file
	 */
	private extractRelevantContent(content: string, query: string, maxTokens: number): string {
		const lines = content.split('\n');
		const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
		
		// Score each line based on query relevance
		const scoredLines = lines.map((line, index) => {
			const lineLower = line.toLowerCase();
			let score = 0;
			
			for (const term of queryTerms) {
				if (lineLower.includes(term)) {
					score += 1;
				}
			}
			
			// Bonus for headings
			if (line.startsWith('#')) {
				score += 2;
			}
			
			// Bonus for lines near other relevant lines
			const nearbyRelevant = lines.slice(Math.max(0, index - 2), index + 3)
				.some(nearbyLine => {
					const nearbyLower = nearbyLine.toLowerCase();
					return queryTerms.some(term => nearbyLower.includes(term));
				});
			
			if (nearbyRelevant) {
				score += 0.5;
			}
			
			return { line, score, index };
		});
		
		// Sort by score and take top lines
		scoredLines.sort((a, b) => b.score - a.score);
		
		// Reconstruct content from top-scoring lines, maintaining order
		const selectedIndices = scoredLines
			.slice(0, Math.ceil(maxTokens / 50)) // Rough estimate: 50 tokens per line
			.map(item => item.index)
			.sort((a, b) => a - b);
		
		const selectedLines = selectedIndices.map(index => lines[index]);
		let result = selectedLines.join('\n');
		
		// Truncate if too long (rough token estimation)
		if (result.length > maxTokens * 4) { // Rough estimate: 4 characters per token
			result = result.substring(0, maxTokens * 4) + '...';
		}
		
		return result;
	}

	/**
	 * Get a readable title for the file
	 */
	private getFileTitle(file: TFile, metadata: CachedMetadata | null): string {
		// Try to get title from frontmatter
		if (metadata?.frontmatter?.title) {
			return metadata.frontmatter.title;
		}
		
		// Try to get title from first heading
		if (metadata?.headings && metadata.headings.length > 0) {
			return metadata.headings[0].heading;
		}
		
		// Fall back to filename
		return file.basename;
	}

	/**
	 * Format search results for inclusion in LLM context
	 */
	formatSearchResults(results: SearchResult[]): string {
		if (results.length === 0) {
			return '';
		}

		let context = '\n\n--- RELEVANT OBSIDIAN NOTES ---\n\n';
		
		for (const result of results) {
			context += `**${result.title}** (${result.path})\n`;
			context += `Relevance: ${(result.relevance * 100).toFixed(1)}%\n\n`;
			context += result.content + '\n\n';
			context += '---\n\n';
		}

		return context;
	}
} 