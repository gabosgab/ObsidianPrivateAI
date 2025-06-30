import { App, TFile, CachedMetadata, getAllTags } from 'obsidian';
import { LoggingUtility } from './LoggingUtility';

export interface SearchResult {
	file: TFile;
	content: string;
	relevance: number;
	title: string;
	path: string;
}

export interface SearchOptions {
	maxResults?: number;
	maxTokens?: number;
	threshold?: number;
}

export class SearchService {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Search for relevant notes in the Obsidian vault
	 */
	async searchVault(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
		LoggingUtility.log('Searching vault for:', query);
		LoggingUtility.log('Search options:', options);

		const files = this.app.vault.getMarkdownFiles();
		LoggingUtility.log(`Found ${files.length} markdown files to search`);

		const results: SearchResult[] = [];

		for (const file of files) {
			try {
				const result = await this.searchFile(file, query, options);
				if (result && result.relevance >= (options.threshold || 0.1)) {
					results.push(result);
					LoggingUtility.log(`Found relevant file: ${result.title} (${(result.relevance * 100).toFixed(1)}% relevant)`);
				}
			} catch (error) {
				LoggingUtility.warn(`Error searching file ${file.path}:`, error);
			}
		}

		// Sort by relevance and limit results
		const sortedResults = results.sort((a, b) => b.relevance - a.relevance);
		const finalResults = sortedResults.slice(0, options.maxResults || 5);

		LoggingUtility.log(`Search completed. Found ${finalResults.length} relevant notes out of ${results.length} total matches.`);
		return finalResults;
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
			
			if (relevance < (options.threshold || 0.1)) {
				return null;
			}

			// Extract relevant content
			const relevantContent = this.extractRelevantContent(content, query, options.maxTokens || 1000);
			
			return {
				file,
				content: relevantContent,
				relevance,
				title: this.getFileTitle(file, metadata),
				path: file.path
			};

		} catch (error) {
			LoggingUtility.warn(`Error processing file ${file.path}:`, error);
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

	/**
	 * Get all open markdown notes as context
	 */
	async getCurrentNoteContext(): Promise<SearchResult[]> {
		try {
			// Get all open leaves
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			const openMarkdownFiles: TFile[] = [];

			// Collect all open markdown files
			for (const leaf of leaves) {
				const file = (leaf.view as any).file;
				if (file && file.extension === 'md') {
					openMarkdownFiles.push(file);
				}
			}

			// Also check the active leaf in case it's not in the markdown leaves
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view.getViewType().includes('markdown')) {
				const activeFile = (activeLeaf.view as any).file;
				if (activeFile && activeFile.extension === 'md' && !openMarkdownFiles.some(f => f.path === activeFile.path)) {
					openMarkdownFiles.push(activeFile);
				}
			}

			if (openMarkdownFiles.length === 0) {
				LoggingUtility.log('No open markdown files found');
				return [];
			}

			LoggingUtility.log(`Found ${openMarkdownFiles.length} open markdown files:`, openMarkdownFiles.map(f => f.path));

			// Create search results for all open files
			const results: SearchResult[] = [];
			for (const file of openMarkdownFiles) {
				try {
					const content = await this.app.vault.read(file);
					const metadata = this.app.metadataCache.getFileCache(file);
					
					results.push({
						file,
						content: content,
						relevance: 1.0, // Full relevance since they're open
						title: this.getFileTitle(file, metadata),
						path: file.path
					});
				} catch (error) {
					LoggingUtility.warn(`Error reading file ${file.path}:`, error);
				}
			}

			return results;

		} catch (error) {
			LoggingUtility.warn('Error getting current note context:', error);
			return [];
		}
	}
} 