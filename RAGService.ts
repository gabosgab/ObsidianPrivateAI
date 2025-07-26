import { App, TFile, EventRef, Events, Notice, ProgressBarComponent } from 'obsidian';
import { VectorDatabase, ParagraphSearchResult, ParagraphDocument } from './VectorDatabase';
import { LoggingUtility } from './LoggingUtility';
import { SearchResult } from './SearchService';
import { EmbeddingService, EmbeddingConfig } from './EmbeddingService';
import * as CRC32 from 'crc-32';

export interface RAGSearchResult {
	file: TFile;
	content: string;
	similarity: number;
	title: string;
	path: string;
	paragraphIndex?: number;
	matchedParagraph?: string;
}

interface ProgressCallback {
	(current: number, total: number, message: string): void;
}

interface ChunkContent {
	text: string;
	index: number;
}

export interface RAGInitializationOptions {
	autoMaintenance?: boolean; // Whether to automatically maintain the index
	backgroundIndexing?: boolean; // Whether to run indexing in background
	silentMode?: boolean; // Whether to suppress notices during auto-maintenance
}

export enum MaintenanceOperation {
	REBUILD = 'rebuild',
	UPDATE = 'update'
}

export class RAGService {
	private app: App;
	private vectorDB: VectorDatabase;
	private embeddingService: EmbeddingService;
	private fileChangeRef?: EventRef;
	private fileRenameRef?: EventRef;
	private fileDeleteRef?: EventRef;
	private isIndexing: boolean = false;
	private indexingAbortController?: AbortController;
	private progressCallback?: ProgressCallback;
	private initOptions: RAGInitializationOptions;
	
	constructor(app: App, embeddingConfig: EmbeddingConfig, initOptions: RAGInitializationOptions = {}) {
		this.app = app;
		const indexPath = this.app.vault.configDir + '/plugins/ObsidianPrivateAI/vector-index/embeddings.json';
		this.vectorDB = new VectorDatabase(this.app, indexPath);
		this.embeddingService = new EmbeddingService(embeddingConfig);
		this.initOptions = {
			autoMaintenance: true,
			backgroundIndexing: true,
			silentMode: false,
			...initOptions
		};
	}

	/**
	 * Initialize the RAG service with automatic maintenance
	 */
	async initialize(): Promise<void> {
		try {
			await this.vectorDB.load();
			const stats = this.vectorDB.getStats();
			LoggingUtility.log(`RAG Service initialized with ${stats.documentCount} paragraph documents across ${stats.fileCount} files`);
			
			// Automatic maintenance if enabled
			if (this.initOptions.autoMaintenance) {
				const isFreshInstall = await this.detectFreshInstall();
				
				if (isFreshInstall) {
					LoggingUtility.log('Fresh install detected, starting automatic index rebuild...');
					if (!this.initOptions.silentMode) {
						new Notice('Fresh install detected. Building RAG database for the first time...');
					}
					
					if (this.initOptions.backgroundIndexing) {
						// Run in background without blocking initialization
						this.runBackgroundMaintenance(MaintenanceOperation.REBUILD);
					} else {
						// Run synchronously
						await this.forceRebuildIndex(this.createAutoMaintenanceProgressCallback());
					}
				} else {
					LoggingUtility.log('Existing installation detected, running smart update...');
					if (!this.initOptions.silentMode) {
						new Notice('Checking for file changes and updating RAG database...');
					}
					
					if (this.initOptions.backgroundIndexing) {
						// Run in background without blocking initialization
						this.runBackgroundMaintenance(MaintenanceOperation.UPDATE);
					} else {
						// Run synchronously
						await this.buildIndex(this.createAutoMaintenanceProgressCallback());
					}
				}
			}
		} catch (error) {
			LoggingUtility.error('Failed to initialize RAG service:', error);
		}
	}

	/**
	 * Detect if this is a fresh install
	 */
	private async detectFreshInstall(): Promise<boolean> {
		try {
			const stats = this.vectorDB.getStats();
			
			// Consider it fresh if:
			// 1. No documents exist
			// 2. Very few documents compared to markdown files (less than 10% coverage)
			const markdownFiles = this.app.vault.getMarkdownFiles();
			const coverageRatio = markdownFiles.length > 0 ? stats.fileCount / markdownFiles.length : 0;
			
			const isFresh = stats.documentCount === 0 || coverageRatio < 0.1;
			
			LoggingUtility.log(`Fresh install detection: ${stats.documentCount} documents, ${stats.fileCount} indexed files, ${markdownFiles.length} total markdown files, coverage: ${(coverageRatio * 100).toFixed(1)}%`);
			
			return isFresh;
		} catch (error) {
			LoggingUtility.warn('Error detecting fresh install, assuming fresh:', error);
			return true; // Err on the side of rebuilding
		}
	}

	/**
	 * Run maintenance operations in the background
	 */
	private async runBackgroundMaintenance(operation: MaintenanceOperation): Promise<void> {
		// Use setTimeout to run in background without blocking
		setTimeout(async () => {
			try {
				if (operation === MaintenanceOperation.REBUILD) {
					await this.forceRebuildIndex(this.createAutoMaintenanceProgressCallback());
				} else {
					await this.buildIndex(this.createAutoMaintenanceProgressCallback());
				}
			} catch (error) {
				LoggingUtility.error(`Background maintenance (${operation}) failed:`, error);
				if (!this.initOptions.silentMode) {
					new Notice(`RAG database ${operation} failed: ${error.message}`);
				}
			}
		}, 100); // Small delay to ensure UI is ready
	}

	/**
	 * Create a progress callback for auto-maintenance operations
	 */
	private createAutoMaintenanceProgressCallback(): ProgressCallback | undefined {
		if (this.initOptions.silentMode) {
			return undefined; // No progress updates in silent mode
		}
		
		return (current: number, total: number, message: string) => {
			// Log progress but don't show UI progress in auto-maintenance
			if (current % 10 === 0 || current === total) {
				LoggingUtility.log(`Auto-maintenance progress: ${current}/${total} - ${message}`);
			}
		};
	}

	/**
	 * Update initialization options
	 */
	updateInitializationOptions(options: Partial<RAGInitializationOptions>): void {
		this.initOptions = { ...this.initOptions, ...options };
		LoggingUtility.log('Updated RAG initialization options:', this.initOptions);
	}

	/**
	 * Split content into meaningful chunks of approximately 200 words
	 */
	private splitIntoParagraphs(content: string): ChunkContent[] {
		// Remove frontmatter if present
		let cleanContent = content;
		const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
		if (frontmatterMatch) {
			cleanContent = content.substring(frontmatterMatch[0].length);
		}

		const targetWords = 200;
		const maxWords = 250; // Force break at this point
		const chunks: ChunkContent[] = [];
		
		// Split into lines for processing
		const lines = cleanContent.split('\n');
		let currentChunk = '';
		let currentWordCount = 0;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			// Skip empty lines at the start of a chunk
			if (currentChunk === '' && line === '') {
				continue;
			}
			
			const lineWordCount = line.split(/\s+/).filter(word => word.length > 0).length;
			const wouldExceedTarget = currentWordCount + lineWordCount > targetWords;
			const wouldExceedMax = currentWordCount + lineWordCount > maxWords;
			
			// Check if this line is a natural break point
			const isNaturalBreak = this.isNaturalBreakPoint(line, lines[i + 1]);
			
			// Decide whether to start a new chunk
			if (currentChunk !== '' && (wouldExceedMax || (wouldExceedTarget && isNaturalBreak))) {
				// Finalize current chunk
				const cleanChunk = currentChunk.trim().replace(/\s+/g, ' ');
				if (cleanChunk.length > 0) {
					chunks.push({
						text: cleanChunk,
						index: chunks.length
					});
				}
				
				// Start new chunk
				currentChunk = line;
				currentWordCount = lineWordCount;
			} else {
				// Add line to current chunk
				if (currentChunk === '') {
					currentChunk = line;
				} else {
					currentChunk += (line === '' ? '\n' : '\n' + line);
				}
				currentWordCount += lineWordCount;
			}
			
			// Handle case where a single line exceeds max words
			if (currentWordCount > maxWords) {
				const cleanChunk = currentChunk.trim().replace(/\s+/g, ' ');
				if (cleanChunk.length > 0) {
					// Try to break at sentence boundaries if the chunk is too long
					const splitChunks = this.splitLongChunk(cleanChunk, maxWords);
					for (const splitChunk of splitChunks) {
						chunks.push({
							text: splitChunk,
							index: chunks.length
						});
					}
				}
				currentChunk = '';
				currentWordCount = 0;
			}
		}
		
		// Add final chunk if it exists
		if (currentChunk.trim().length > 0) {
			const cleanChunk = currentChunk.trim().replace(/\s+/g, ' ');
			chunks.push({
				text: cleanChunk,
				index: chunks.length
			});
		}
		
		// Filter out chunks that are too short to be meaningful
		const meaningfulChunks = chunks.filter(chunk => {
			const wordCount = chunk.text.split(/\s+/).filter(word => word.length > 0).length;
			return wordCount >= 10; // Minimum 10 words per chunk
		});

		LoggingUtility.log(`Split content into ${meaningfulChunks.length} chunks (~200 words each)`);
		return meaningfulChunks;
	}

	/**
	 * Check if a line represents a natural break point
	 */
	private isNaturalBreakPoint(currentLine: string, nextLine?: string): boolean {
		// Empty line followed by content
		if (currentLine === '' && nextLine && nextLine.trim() !== '') {
			return true;
		}
		
		// Heading patterns
		if (currentLine.match(/^#{1,6}\s+/) || // Markdown headings
			currentLine.match(/^.+\n[=-]+$/) || // Underlined headings
			currentLine.match(/^\d+\.\s+/) || // Numbered lists
			currentLine.match(/^[-*+]\s+/)) { // Bullet points
			return true;
		}
		
		// End of bullet point series (current line is bullet, next is not)
		if (currentLine.match(/^[-*+]\s+/) && nextLine && !nextLine.match(/^[-*+]\s+/) && nextLine.trim() !== '') {
			return true;
		}
		
		// End of numbered list series
		if (currentLine.match(/^\d+\.\s+/) && nextLine && !nextLine.match(/^\d+\.\s+/) && nextLine.trim() !== '') {
			return true;
		}
		
		// Code blocks
		if (currentLine.match(/^```/) || currentLine.match(/^~~~`/)) {
			return true;
		}
		
		// Horizontal rules
		if (currentLine.match(/^[-*_]{3,}$/)) {
			return true;
		}
		
		// Block quotes
		if (currentLine.match(/^>\s+/)) {
			return true;
		}
		
		return false;
	}

	/**
	 * Split a chunk that's too long into smaller pieces at sentence boundaries
	 */
	private splitLongChunk(chunk: string, maxWords: number): string[] {
		const words = chunk.split(/\s+/);
		if (words.length <= maxWords) {
			return [chunk];
		}
		
		const chunks: string[] = [];
		const sentences = chunk.split(/[.!?]+\s+/);
		
		let currentChunk = '';
		let currentWordCount = 0;
		
		for (const sentence of sentences) {
			const sentenceWords = sentence.split(/\s+/).filter(word => word.length > 0).length;
			
			if (currentWordCount + sentenceWords > maxWords && currentChunk !== '') {
				// Start new chunk
				chunks.push(currentChunk.trim());
				currentChunk = sentence;
				currentWordCount = sentenceWords;
			} else {
				// Add to current chunk
				if (currentChunk === '') {
					currentChunk = sentence;
				} else {
					currentChunk += '. ' + sentence;
				}
				currentWordCount += sentenceWords;
			}
		}
		
		// Add final chunk
		if (currentChunk.trim().length > 0) {
			chunks.push(currentChunk.trim());
		}
		
		// If we still have chunks that are too long, force split them
		const finalChunks: string[] = [];
		for (const chunkToCheck of chunks) {
			const chunkWords = chunkToCheck.split(/\s+/);
			if (chunkWords.length > maxWords) {
				// Force split by word count
				for (let i = 0; i < chunkWords.length; i += maxWords) {
					const subChunk = chunkWords.slice(i, i + maxWords).join(' ');
					finalChunks.push(subChunk);
				}
			} else {
				finalChunks.push(chunkToCheck);
			}
		}
		
		return finalChunks;
	}

	/**
	 * Start watching for file changes
	 */
	startFileWatcher(): void {
		// Watch for file modifications
		this.fileChangeRef = this.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				// Check if file actually changed by comparing checksum
				try {
					const content = await this.app.vault.read(file);
					const newChecksum = CRC32.str(content).toString(16);
					
					const existingDocs = this.vectorDB.getFileDocuments(file.path);
					if (existingDocs.length > 0 && existingDocs[0].metadata.fileChecksum === newChecksum) {
						// File content hasn't actually changed, skip update
						LoggingUtility.log(`File modification detected but content unchanged: ${file.path}`);
						return;
					}
					
					LoggingUtility.log(`File content changed: ${file.path} (checksum: ${newChecksum})`);
					await this.updateFileEmbeddings(file);
					await this.vectorDB.save();
				} catch (error) {
					LoggingUtility.error(`Error checking file modification: ${file.path}`, error);
				}
			}
		});

		// Watch for file renames
		this.fileRenameRef = this.app.vault.on('rename', async (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				LoggingUtility.log(`File renamed from ${oldPath} to ${file.path}`);
				await this.vectorDB.removeFileDocuments(oldPath);
				await this.updateFileEmbeddings(file);
			}
		});

		// Watch for file deletions
		this.fileDeleteRef = this.app.vault.on('delete', async (file) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				LoggingUtility.log(`File deleted: ${file.path}`);
				await this.vectorDB.removeFileDocuments(file.path);
				await this.vectorDB.save();
			}
		});

		LoggingUtility.log('File watcher started');
	}

	/**
	 * Stop watching for file changes
	 */
	stopFileWatcher(): void {
		if (this.fileChangeRef) {
			this.app.vault.offref(this.fileChangeRef);
		}
		if (this.fileRenameRef) {
			this.app.vault.offref(this.fileRenameRef);
		}
		if (this.fileDeleteRef) {
			this.app.vault.offref(this.fileDeleteRef);
		}
		LoggingUtility.log('File watcher stopped');
	}

	/**
	 * Build or rebuild the entire RAG database (smart update based on checksums)
	 */
	async buildIndex(progressCallback?: ProgressCallback): Promise<void> {
		if (this.isIndexing) {
			new Notice('Indexing is already in progress');
			return;
		}

		this.isIndexing = true;
		this.progressCallback = progressCallback;
		this.indexingAbortController = new AbortController();

		try {
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			LoggingUtility.log(`Starting to analyze ${files.length} files for changes`);
			
			// Calculate checksums for all files to determine what needs updating
			const fileStats = new Map<string, { checksum: string; lastModified: number; size: number }>();
			const existingFiles = new Set<string>();
			
			if (this.progressCallback) {
				this.progressCallback(0, files.length, 'Analyzing files for changes...');
			}
			
			for (let i = 0; i < files.length; i++) {
				if (this.indexingAbortController.signal.aborted) {
					LoggingUtility.log('Indexing aborted by user');
					return;
				}
				
				const file = files[i];
				existingFiles.add(file.path);
				
				try {
					const content = await this.app.vault.read(file);
					const checksum = CRC32.str(content).toString(16);
					
					fileStats.set(file.path, {
						checksum: checksum,
						lastModified: file.stat.mtime,
						size: file.stat.size
					});
				} catch (error) {
					LoggingUtility.warn(`Could not read file for checksum: ${file.path}`, error);
				}
				
				// Yield control periodically
				if (i % 10 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}
			
			// Remove documents for files that no longer exist
			await this.vectorDB.removeObsoleteDocuments(existingFiles);
			
			// Find files that need updating
			const filesToUpdate = this.vectorDB.getFilesNeedingUpdate(fileStats);
			
			LoggingUtility.log(`Found ${filesToUpdate.length} files that need updating out of ${files.length} total files`);
			
			if (filesToUpdate.length === 0) {
				LoggingUtility.log('All files are up to date, no indexing needed');
				new Notice('RAG database is already up to date');
				return;
			}
			
			// Process only the files that need updating
			for (let i = 0; i < filesToUpdate.length; i++) {
				if (this.indexingAbortController.signal.aborted) {
					LoggingUtility.log('Indexing aborted by user');
					break;
				}
				
				const filePath = filesToUpdate[i];
				const file = this.app.vault.getAbstractFileByPath(filePath);
				
				if (file instanceof TFile) {
					if (this.progressCallback) {
						this.progressCallback(i + 1, filesToUpdate.length, `Indexing: ${file.basename}`);
					}
					
					await this.updateFileEmbeddings(file);
					
					// Save periodically to avoid losing progress
					if ((i + 1) % 10 === 0) {
						await this.vectorDB.save();
					}
					
					// Yield control to the UI thread every few files to keep Obsidian responsive
					if (i % 3 === 0) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
				}
			}
			
			// Final save
			await this.vectorDB.save();
			
			const stats = this.vectorDB.getStats();
			LoggingUtility.log(`Indexing complete. Updated ${filesToUpdate.length} files. Total: ${stats.documentCount} paragraph documents across ${stats.fileCount} files`);
			new Notice(`RAG indexing complete: Updated ${filesToUpdate.length} files`);
			
		} catch (error) {
			LoggingUtility.error('Error during indexing:', error);
			new Notice('Error during RAG indexing: ' + error.message);
		} finally {
			this.isIndexing = false;
			this.progressCallback = undefined;
			this.indexingAbortController = undefined;
		}
	}

	/**
	 * Cancel ongoing indexing
	 */
	cancelIndexing(): void {
		if (this.indexingAbortController) {
			this.indexingAbortController.abort();
		}
	}

	/**
	 * Force a complete rebuild of the entire RAG database (clears existing index)
	 */
	async forceRebuildIndex(progressCallback?: ProgressCallback): Promise<void> {
		if (this.isIndexing) {
			new Notice('Indexing is already in progress');
			return;
		}

		this.isIndexing = true;
		this.progressCallback = progressCallback;
		this.indexingAbortController = new AbortController();

		try {
			// Clear existing index completely
			await this.vectorDB.clear();
			LoggingUtility.log('Cleared existing vector index for complete rebuild');
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			LoggingUtility.log(`Starting complete rebuild of ${files.length} files`);
			
			// Process all files
			for (let i = 0; i < files.length; i++) {
				if (this.indexingAbortController.signal.aborted) {
					LoggingUtility.log('Indexing aborted by user');
					break;
				}
				
				const file = files[i];
				if (this.progressCallback) {
					this.progressCallback(i + 1, files.length, `Indexing: ${file.basename}`);
				}
				
				await this.updateFileEmbeddings(file);
				
				// Save periodically to avoid losing progress
				if ((i + 1) % 10 === 0) {
					await this.vectorDB.save();
				}
				
				// Yield control to the UI thread every few files to keep Obsidian responsive
				if (i % 3 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}
			
			// Final save
			await this.vectorDB.save();
			
			const stats = this.vectorDB.getStats();
			LoggingUtility.log(`Complete rebuild finished. Indexed ${stats.documentCount} paragraph documents across ${stats.fileCount} files`);
			new Notice(`RAG complete rebuild finished: ${stats.fileCount} files indexed`);
			
		} catch (error) {
			LoggingUtility.error('Error during complete rebuild:', error);
			new Notice('Error during RAG complete rebuild: ' + error.message);
		} finally {
			this.isIndexing = false;
			this.progressCallback = undefined;
			this.indexingAbortController = undefined;
		}
	}

	/**
	 * Generate embedding using the embedding service
	 */
	private async generateEmbedding(text: string): Promise<number[]> {
		try {
			// Clean up the text before sending to embedding service
			const cleanText = text.replace(/\s+/g, ' ').trim();
			
			// Truncate if too long (most embedding models have token limits)
			const maxLength = 8000; // Conservative limit
			const truncatedText = cleanText.length > maxLength 
				? cleanText.substring(0, maxLength) + '...' 
				: cleanText;
			
			return await this.embeddingService.generateEmbedding(truncatedText);
		} catch (error) {
			LoggingUtility.error('Error generating embedding:', error);
			throw error;
		}
	}

	/**
	 * Update embeddings for a single file (creates embeddings for each paragraph)
	 */
	private async updateFileEmbeddings(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const metadata = this.app.metadataCache.getFileCache(file);
			const title = this.getFileTitle(file, metadata);
			
			// Calculate checksum
			const checksum = CRC32.str(content).toString(16);
			
			// Split content into chunks
			const chunks = this.splitIntoParagraphs(content);
			
			if (chunks.length === 0) {
				LoggingUtility.log(`No chunks found in file: ${file.path}`);
				return;
			}
			
			// Yield control briefly for very large files
			if (content.length > 50000) {
				await new Promise(resolve => setTimeout(resolve, 0));
			}
			
			// Generate embeddings for all chunks
			const texts = chunks.map(c => c.text);
			const embeddings = await this.embeddingService.generateEmbeddings(texts);
			
			// Create chunk documents
			const chunkDocuments = chunks.map((chunk, index) => ({
				id: `${file.path}#c${chunk.index}`,
				vector: embeddings[index],
				metadata: {
					filePath: file.path,
					fileName: file.basename,
					title: title,
					paragraphIndex: chunk.index,
					paragraphText: chunk.text,
					fileChecksum: checksum,
					lastModified: file.stat.mtime,
					fileSize: file.stat.size
				}
			}));
			
			// Store in vector database
			await this.vectorDB.upsertFileDocuments(file.path, chunkDocuments);
			
			LoggingUtility.log(`Updated ${chunkDocuments.length} chunk embeddings for file: ${file.path}`);
			
		} catch (error) {
			LoggingUtility.error(`Error updating embeddings for ${file.path}:`, error);
		}
	}

	/**
	 * Search for similar documents using RAG (now searches by paragraph)
	 */
	async search(query: string, limit: number = 5, threshold: number = 0.3): Promise<RAGSearchResult[]> {
		// Generate query embedding
		const queryEmbedding = await this.generateEmbedding(query);
		
		// Search in vector database for paragraphs
		const results = this.vectorDB.search(queryEmbedding, limit, threshold);
		
		// Convert to RAGSearchResult format
		const ragResults: RAGSearchResult[] = [];
		
		for (const result of results) {
			const file = this.app.vault.getAbstractFileByPath(result.document.metadata.filePath);
			if (file instanceof TFile) {
				ragResults.push({
					file: file,
					content: result.document.metadata.paragraphText,
					similarity: result.similarity,
					title: result.document.metadata.title,
					path: result.document.metadata.filePath,
					paragraphIndex: result.document.metadata.paragraphIndex,
					matchedParagraph: result.document.metadata.paragraphText
				});
			}
		}
		
		return ragResults;
	}

	/**
	 * Search for similar documents grouped by file (useful for getting context from multiple paragraphs)
	 */
	async searchGroupedByFile(query: string, maxFiles: number = 3, maxParagraphsPerFile: number = 3, threshold: number = 0.3): Promise<Map<string, RAGSearchResult[]>> {
		// Generate query embedding
		const queryEmbedding = await this.generateEmbedding(query);
		
		// Search in vector database for paragraphs grouped by file
		const resultsMap = this.vectorDB.searchGroupedByFile(queryEmbedding, maxFiles, maxParagraphsPerFile, threshold);
		
		// Convert to RAGSearchResult format
		const ragResultsMap = new Map<string, RAGSearchResult[]>();
		
		for (const [filePath, paragraphResults] of resultsMap) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				const ragResults = paragraphResults.map(result => ({
					file: file,
					content: result.document.metadata.paragraphText,
					similarity: result.similarity,
					title: result.document.metadata.title,
					path: result.document.metadata.filePath,
					paragraphIndex: result.document.metadata.paragraphIndex,
					matchedParagraph: result.document.metadata.paragraphText
				}));
				
				ragResultsMap.set(filePath, ragResults);
			}
		}
		
		return ragResultsMap;
	}

	/**
	 * Get file title from metadata
	 */
	private getFileTitle(file: TFile, metadata: any): string {
		if (metadata?.frontmatter?.title) {
			return metadata.frontmatter.title;
		}
		if (metadata?.headings && metadata.headings.length > 0) {
			return metadata.headings[0].heading;
		}
		return file.basename;
	}

	/**
	 * Format RAG search results for LLM context
	 */
	formatSearchResults(results: RAGSearchResult[]): string {
		if (results.length === 0) {
			return '';
		}

		let context = '\n\n--- RELEVANT NOTES (RAG) ---\n\n';
		
		for (const result of results) {
			context += `**${result.title}** (${result.path}`;
			if (result.paragraphIndex !== undefined) {
				context += `, paragraph ${result.paragraphIndex + 1}`;
			}
			context += `)\n`;
			context += `Similarity: ${(result.similarity * 100).toFixed(1)}%\n\n`;
			context += result.content + '\n\n';
			context += '---\n\n';
		}

		return context;
	}

	/**
	 * Format grouped RAG search results for LLM context (shows context from multiple paragraphs per file)
	 */
	formatGroupedSearchResults(resultsMap: Map<string, RAGSearchResult[]>): string {
		if (resultsMap.size === 0) {
			return '';
		}

		let context = '\n\n--- RELEVANT NOTES (RAG) ---\n\n';
		
		for (const [filePath, results] of resultsMap) {
			if (results.length > 0) {
				context += `**${results[0].title}** (${filePath})\n\n`;
				
				// Sort by paragraph index for logical reading order
				const sortedResults = results.sort((a, b) => (a.paragraphIndex || 0) - (b.paragraphIndex || 0));
				
				for (const result of sortedResults) {
					context += `[Paragraph ${result.paragraphIndex! + 1}, Similarity: ${(result.similarity * 100).toFixed(1)}%]\n`;
					context += result.content + '\n\n';
				}
				
				context += '---\n\n';
			}
		}

		return context;
	}

	/**
	 * Get index statistics
	 */
	getStats(): { documentCount: number; fileCount: number; lastUpdated: Date; sizeInBytes: number } {
		return this.vectorDB.getStats();
	}

	/**
	 * Check if index is empty
	 */
	isIndexEmpty(): boolean {
		const stats = this.vectorDB.getStats();
		return stats.documentCount === 0;
	}

	/**
	 * Update embedding configuration
	 */
	updateEmbeddingConfig(config: EmbeddingConfig): void {
		this.embeddingService.updateConfig(config);
	}

	/**
	 * Test embedding service connection
	 */
	async testEmbeddingConnection(): Promise<{ success: boolean; error?: string; dimensions?: number }> {
		return await this.embeddingService.testConnection();
	}
} 