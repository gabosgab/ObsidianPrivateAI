import { App, TFile, EventRef, Events, Notice, ProgressBarComponent } from 'obsidian';
import { VectorDatabase, ParagraphSearchResult, ParagraphDocument } from './VectorDatabase';
import { LoggingUtility } from './LoggingUtility';
import { SearchResult } from './SearchService';
import { EmbeddingService, EmbeddingConfig } from './EmbeddingService';
import { ImageTextExtractor } from './ImageTextExtractor';
import * as CRC32 from 'crc-32';
import * as path from 'path';


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
	progressCallback?: (current: number, total: number, message: string) => void; // Progress updates
	completionCallback?: () => void; // Called when indexing completes
}

export enum MaintenanceOperation {
	REBUILD = 'rebuild',
	UPDATE = 'update'
}

export class RAGService {
	private app: App;
	private vectorDB: VectorDatabase;
	private embeddingService: EmbeddingService;
	private imageTextExtractor?: ImageTextExtractor;
	private imageProcessingEnabled: boolean = true;
	private fileChangeRef?: EventRef;
	private fileRenameRef?: EventRef;
	private fileDeleteRef?: EventRef;
	private workspaceChangeRef?: EventRef;
	private isIndexing: boolean = false;
	private indexingAbortController?: AbortController;
	private progressCallback?: ProgressCallback;
	private initOptions: RAGInitializationOptions;
	private fileUpdateQueue: Map<string, NodeJS.Timeout> = new Map();
	private isProcessingFileUpdates: boolean = false;
	private pendingActiveFileUpdates: Set<string> = new Set();
	private activeFileCheckInterval?: NodeJS.Timeout;
	private lastActiveFilePath: string | null = null;
	
	constructor(app: App, embeddingConfig: EmbeddingConfig, initOptions: RAGInitializationOptions = {}) {
		this.app = app;
		const indexPath = `${this.app.vault.configDir}/plugins/ObsidianPrivateAI/vector-index/embeddings.json`;
		LoggingUtility.log('RAGService constructor called with indexPath:', path.resolve(indexPath));
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
	 * Initialize the image text extractor with LLM service
	 */
	initializeImageTextExtractor(llmService: any): void {
		try {
			this.imageTextExtractor = new ImageTextExtractor(llmService, this.app);
			LoggingUtility.log('Image text extractor initialized');
		} catch (error) {
			LoggingUtility.warn('Failed to initialize image text extractor:', error);
		}
	}

	/**
	 * Set whether image processing is enabled
	 */
	setImageProcessingEnabled(enabled: boolean): void {
		this.imageProcessingEnabled = enabled;
		LoggingUtility.log(`Image processing ${enabled ? 'enabled' : 'disabled'}`);
	}

	/**
	 * Manually trigger image processing for all images in the vault
	 */
	async processImagesManually(progressCallback?: (current: number, total: number, message: string) => void): Promise<void> {
		if (!this.imageProcessingEnabled) {
			throw new Error('Image processing is disabled in settings');
		}

		if (!this.imageTextExtractor) {
			throw new Error('Image text extractor not initialized');
		}

		try {
			// Get all image files in the vault
			const imageFiles = this.app.vault.getFiles().filter(file => ImageTextExtractor.isImageFile(file));
			
			if (imageFiles.length === 0) {
				new Notice('No image files found in vault');
				return;
			}

			LoggingUtility.log(`Starting manual image processing for ${imageFiles.length} images`);

			// Check vision capabilities first
			const capabilities = await this.imageTextExtractor.checkVisionCapabilities();
			if (!capabilities.supportsVision) {
				throw new Error('LLM model does not support vision capabilities');
			}

			// Process each image with progress reporting
			for (let i = 0; i < imageFiles.length; i++) {
				const imageFile = imageFiles[i];
				
				if (progressCallback) {
					progressCallback(i + 1, imageFiles.length, `Processing image: ${imageFile.basename}`);
				}
				
				try {
					LoggingUtility.log(`Processing image ${i + 1}/${imageFiles.length}: ${imageFile.path}`);
					
					// Extract text from image
					const result = await this.imageTextExtractor.extractTextFromImage(imageFile);
					
					if (result.success && result.extractedText.trim()) {
						// Create a virtual document for the extracted text
						const extractedText = result.extractedText;
						
						// Split extracted text into chunks
						const chunks = this.splitIntoParagraphs(extractedText);
						
						if (chunks.length > 0) {
							// Generate embeddings for chunks
							const texts = chunks.map(c => c.text);
							const embeddings = await this.embeddingService.generateEmbeddings(texts);
							
							// Create chunk documents for the image
							const chunkDocuments = chunks.map((chunk, index) => ({
								id: `${imageFile.path}#c${chunk.index}`,
								vector: embeddings[index],
								metadata: {
									filePath: imageFile.path,
									fileName: imageFile.basename,
									title: `Image: ${imageFile.basename}`,
									paragraphIndex: chunk.index,
									paragraphText: chunk.text,
									fileChecksum: CRC32.buf(new TextEncoder().encode(extractedText)).toString(16),
									lastModified: imageFile.stat.mtime,
									fileSize: imageFile.stat.size,
									sourceType: 'image' as const,
									extractedText: true
								}
							}));
							
							// Store in vector database
							await this.vectorDB.upsertFileDocuments(imageFile.path, chunkDocuments);
							
							LoggingUtility.log(`Successfully processed image ${imageFile.path} with ${chunks.length} text chunks`);
						}
					} else {
						LoggingUtility.log(`No text extracted from image ${imageFile.path}: ${result.error || 'No text found'}`);
					}
					
					// Yield control periodically
					if (i % 3 === 0) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
					
				} catch (error) {
					LoggingUtility.error(`Error processing image ${imageFile.path}:`, error);
				}
			}

			// Save the updated index
			await this.vectorDB.save();
			
			const stats = this.getStats();
			LoggingUtility.log(`Manual image processing complete. Total: ${stats.documentCount} paragraph documents (${stats.markdownDocuments} markdown, ${stats.imageDocuments} image) across ${stats.fileCount} files (${stats.markdownFiles} markdown, ${stats.imageFiles} image)`);
			
			new Notice(`Image processing complete! Processed ${imageFiles.length} images.`);
			
		} catch (error) {
			LoggingUtility.error('Error during manual image processing:', error);
			throw error;
		}
	}

	/**
	 * Get indexing status
	 */
	get isCurrentlyIndexing(): boolean {
		return this.isIndexing;
	}

	/**
	 * Initialize the RAG service with automatic maintenance
	 */
	async initialize(): Promise<void> {
		try {
			await this.vectorDB.load();
			const stats = this.getStats();
			LoggingUtility.log(`RAG Service initialized with ${stats.documentCount} total paragraph documents (${stats.markdownDocuments} markdown, ${stats.imageDocuments} image) across ${stats.fileCount} total files (${stats.markdownFiles} markdown, ${stats.imageFiles} image)`);
			
			// Automatic maintenance if enabled
			if (this.initOptions.autoMaintenance) {
				const isFreshInstall = await this.detectFreshInstall();
				
				if (isFreshInstall) {
					LoggingUtility.log('Fresh install detected, starting automatic index rebuild...');
					
					if (this.initOptions.backgroundIndexing) {
						// Run in background without blocking initialization
						this.runBackgroundMaintenance(MaintenanceOperation.REBUILD);
					} else {
						// Run synchronously
						await this.forceRebuildIndex(this.createAutoMaintenanceProgressCallback());
					}
				} else {
					LoggingUtility.log('Existing installation detected, running smart update...');
					
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
				const progressCallback = this.createAutoMaintenanceProgressCallback();
				
				if (operation === MaintenanceOperation.REBUILD) {
					await this.forceRebuildIndex(progressCallback);
				} else {
					await this.buildIndex(progressCallback);
				}
				
				// Notify completion
				if (this.initOptions.completionCallback) {
					this.initOptions.completionCallback();
				}
			} catch (error) {
				LoggingUtility.error(`Background maintenance (${operation}) failed:`, error);
				if (!this.initOptions.silentMode) {
					// Check if it's a connection error and show appropriate message
					if (error.message && error.message.includes('Could not establish connection to LM Studio')) {
						new Notice(`RAG database ${operation} failed: Cannot connect to LM Studio. Please ensure LM Studio is running with an embedding model loaded.`, 10000);
					} else {
						new Notice(`RAG database ${operation} failed: ${error.message}`, 8000);
					}
				}
			}
		}, 100); // Small delay to ensure UI is ready
	}

	/**
	 * Create a progress callback for auto-maintenance operations
	 */
	private createAutoMaintenanceProgressCallback(): ProgressCallback | undefined {
		return (current: number, total: number, message: string) => {
			// Call the initialization progress callback if provided
			if (this.initOptions.progressCallback) {
				this.initOptions.progressCallback(current, total, message);
			}
			
			// Log progress but don't show UI progress in silent mode
			if (!this.initOptions.silentMode && (current % 10 === 0 || current === total)) {
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
	 * Process images in the vault to extract text and add to the index
	 */
	async processImagesInVault(enabled: boolean = true): Promise<void> {
		if (!enabled) {
			LoggingUtility.log('Image text extraction is disabled, skipping image processing');
			return;
		}
		
		if (!this.imageTextExtractor) {
			LoggingUtility.log('Image text extractor not initialized, skipping image processing');
			return;
		}

		try {
			// Get all image files in the vault
			const imageFiles = this.app.vault.getFiles().filter(file => ImageTextExtractor.isImageFile(file));
			
			if (imageFiles.length === 0) {
				LoggingUtility.log('No image files found in vault');
				return;
			}

			LoggingUtility.log(`Found ${imageFiles.length} image files to process`);

			// Check vision capabilities first
			const capabilities = await this.imageTextExtractor.checkVisionCapabilities();
			if (!capabilities.supportsVision) {
				LoggingUtility.log('LLM model does not support vision, skipping image processing');
				return;
			}

			// Process each image
			for (let i = 0; i < imageFiles.length; i++) {
				const imageFile = imageFiles[i];
				
				try {
					LoggingUtility.log(`Processing image ${i + 1}/${imageFiles.length}: ${imageFile.path}`);
					
					// Extract text from image
					const result = await this.imageTextExtractor.extractTextFromImage(imageFile);
					
					if (result.success && result.extractedText.trim()) {
						// Create a virtual document for the extracted text
						const extractedText = result.extractedText;
						
						// Split extracted text into chunks
						const chunks = this.splitIntoParagraphs(extractedText);
						
						if (chunks.length > 0) {
							// Generate embeddings for chunks
							const texts = chunks.map(c => c.text);
							const embeddings = await this.embeddingService.generateEmbeddings(texts);
							
							// Create chunk documents for the image
							const chunkDocuments = chunks.map((chunk, index) => ({
								id: `${imageFile.path}#c${chunk.index}`,
								vector: embeddings[index],
								metadata: {
									filePath: imageFile.path,
									fileName: imageFile.basename,
									title: `Image: ${imageFile.basename}`,
									paragraphIndex: chunk.index,
									paragraphText: chunk.text,
									fileChecksum: CRC32.str(extractedText).toString(16),
									lastModified: imageFile.stat.mtime,
									fileSize: imageFile.stat.size,
									sourceType: 'image' as const,
									extractedText: true
								}
							}));
							
							// Store in vector database
							await this.vectorDB.upsertFileDocuments(imageFile.path, chunkDocuments);
							
							LoggingUtility.log(`Successfully processed image ${imageFile.path} with ${chunks.length} text chunks`);
						}
					} else {
						LoggingUtility.log(`No text extracted from image ${imageFile.path}: ${result.error || 'No text found'}`);
					}
					
					// Yield control periodically
					if (i % 5 === 0) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
					
				} catch (error) {
					LoggingUtility.error(`Error processing image ${imageFile.path}:`, error);
				}
			}

			// Save the updated index
			await this.vectorDB.save();
			LoggingUtility.log('Image processing complete');
			
		} catch (error) {
			LoggingUtility.error('Error processing images in vault:', error);
		}
	}

	/**
	 * Check if a file is currently being edited (active in workspace)
	 */
	private isFileCurrentlyActive(file: TFile): boolean {
		try {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (!activeLeaf || !activeLeaf.view) {
				return false;
			}

			// Check if the active view is a markdown view with this file
			if (activeLeaf.view.getViewType() === 'markdown') {
				const activeFile = (activeLeaf.view as any).file;
				return activeFile && activeFile.path === file.path;
			}

			return false;
		} catch (error) {
			LoggingUtility.warn('Error checking if file is active:', error);
			return false; // Err on the side of processing if we can't detect
		}
	}

	/**
	 * Start watching for file changes
	 * 
	 * This implements a smart file watching system that prevents UI freezing:
	 * 1. Files being actively edited are skipped and tracked for later processing
	 * 2. When user switches notes, the previously active file is immediately processed
	 * 3. Background processing with debouncing handles file updates without blocking UI
	 * 4. Periodic backup processing ensures no files are missed (every 30 seconds)
	 */
	startFileWatcher(): void {
		// Watch for file modifications
		this.fileChangeRef = this.app.vault.on('modify', async (file) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				// Skip processing if this is the currently active file being edited
				if (this.isFileCurrentlyActive(file)) {
					LoggingUtility.log(`Skipping RAG update for active file: ${file.path}`);
					// Track this file for later processing when it becomes inactive
					this.pendingActiveFileUpdates.add(file.path);
					return;
				}
				
				// Queue the file update to run in background with debouncing
				this.queueFileUpdate(file, 'modify');
			}
		});

		// Watch for file renames
		this.fileRenameRef = this.app.vault.on('rename', async (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				// Renames should always be processed as they don't interfere with editing
				this.queueFileUpdate(file, 'rename', oldPath);
			}
		});

		// Watch for file deletions
		this.fileDeleteRef = this.app.vault.on('delete', async (file) => {
			if (file instanceof TFile && file.extension === 'md' && !this.isIndexing) {
				// Remove from pending updates if it was there
				this.pendingActiveFileUpdates.delete(file.path);
				
				// Process deletions immediately as they're quick and file is gone
				setTimeout(async () => {
					try {
						LoggingUtility.log(`File deleted: ${file.path}`);
						await this.vectorDB.removeFileDocuments(file.path);
						await this.vectorDB.save();
					} catch (error) {
						LoggingUtility.error(`Error processing file deletion: ${file.path}`, error);
					}
				}, 0);
			}
		});

		// Watch for workspace active leaf changes (when user switches notes)
		this.workspaceChangeRef = this.app.workspace.on('active-leaf-change', (leaf) => {
			this.handleActiveLeafChange(leaf);
		});

		// Initialize current active file tracking
		this.updateLastActiveFile();

		// Start periodic check for previously active files that are now inactive (as backup)
		this.startActiveFileMonitoring();

		LoggingUtility.log('File watcher started');
	}

	/**
	 * Handle when the active leaf changes (user switches notes)
	 */
	private handleActiveLeafChange(leaf: any): void {
		try {
			// Get the file that was previously active
			const previousActiveFile = this.lastActiveFilePath;
			
			// Update to current active file
			this.updateLastActiveFile();
			
			// Process the previously active file if it needs updating
			if (previousActiveFile && this.pendingActiveFileUpdates.has(previousActiveFile)) {
				const file = this.app.vault.getAbstractFileByPath(previousActiveFile);
				if (file instanceof TFile) {
					LoggingUtility.log(`Note switched, immediately processing previously active file: ${previousActiveFile}`);
					this.pendingActiveFileUpdates.delete(previousActiveFile);
					
					// Process immediately since the file is no longer active
					setTimeout(() => {
						this.queueFileUpdate(file, 'modify');
					}, 100); // Small delay to ensure the switch is complete
				}
			}
		} catch (error) {
			LoggingUtility.warn('Error handling active leaf change:', error);
		}
	}

	/**
	 * Update tracking of the last active file
	 */
	private updateLastActiveFile(): void {
		try {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view && activeLeaf.view.getViewType() === 'markdown') {
				const activeFile = (activeLeaf.view as any).file;
				this.lastActiveFilePath = activeFile ? activeFile.path : null;
			} else {
				this.lastActiveFilePath = null;
			}
		} catch (error) {
			LoggingUtility.warn('Error updating last active file:', error);
			this.lastActiveFilePath = null;
		}
	}

	/**
	 * Start monitoring for files that were active but are now inactive (backup system)
	 */
	private startActiveFileMonitoring(): void {
		// Check every 30 seconds for files that need processing (reduced frequency since we have immediate processing)
		this.activeFileCheckInterval = setInterval(() => {
			if (this.pendingActiveFileUpdates.size > 0) {
				this.processPendingActiveFiles();
			}
		}, 30000); // 30 second interval (was 10 seconds)
	}

	/**
	 * Process files that were previously active but may now be inactive
	 */
	private async processPendingActiveFiles(): Promise<void> {
		const filesToProcess: string[] = [];
		
		for (const filePath of this.pendingActiveFileUpdates) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile && !this.isFileCurrentlyActive(file)) {
				filesToProcess.push(filePath);
			}
		}
		
		// Process files that are no longer active
		for (const filePath of filesToProcess) {
			this.pendingActiveFileUpdates.delete(filePath);
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (file instanceof TFile) {
				LoggingUtility.log(`Processing previously active file that is now inactive: ${filePath}`);
				this.queueFileUpdate(file, 'modify');
			}
		}
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
		if (this.workspaceChangeRef) {
			this.app.workspace.offref(this.workspaceChangeRef);
		}
		
		// Clear any pending file update timers
		for (const timeout of this.fileUpdateQueue.values()) {
			clearTimeout(timeout);
		}
		this.fileUpdateQueue.clear();
		
		// Clear active file monitoring
		if (this.activeFileCheckInterval) {
			clearInterval(this.activeFileCheckInterval);
			this.activeFileCheckInterval = undefined;
		}
		this.pendingActiveFileUpdates.clear();
		this.lastActiveFilePath = null;
		
		LoggingUtility.log('File watcher stopped');
	}

	/**
	 * Queue file updates to run in background with debouncing
	 */
	private queueFileUpdate(file: TFile, operation: 'modify' | 'rename', oldPath?: string): void {
		const filePath = file.path;
		
		// Clear existing timeout for this file if it exists
		if (this.fileUpdateQueue.has(filePath)) {
			clearTimeout(this.fileUpdateQueue.get(filePath)!);
		}
		
		// Set new timeout to process the file update after a brief delay
		const timeout = setTimeout(async () => {
			try {
				this.fileUpdateQueue.delete(filePath);
				
				// Double-check if file is still active before processing
				if (operation === 'modify' && this.isFileCurrentlyActive(file)) {
					LoggingUtility.log(`File became active during queue delay, skipping RAG update: ${file.path}`);
					// Track this file for later processing when it becomes inactive
					this.pendingActiveFileUpdates.add(file.path);
					return;
				}
				
				// Remove from pending active files if it was there
				this.pendingActiveFileUpdates.delete(filePath);
				
				await this.processFileUpdateBackground(file, operation, oldPath);
			} catch (error) {
				LoggingUtility.error(`Error processing file update for ${filePath}:`, error);
			}
		}, 500); // 500ms debounce delay
		
		this.fileUpdateQueue.set(filePath, timeout);
	}

	/**
	 * Process file updates in background to avoid blocking UI
	 */
	private async processFileUpdateBackground(file: TFile, operation: 'modify' | 'rename', oldPath?: string): Promise<void> {
		// Prevent overlapping background updates
		if (this.isProcessingFileUpdates) {
			// Re-queue for later processing
			setTimeout(() => {
				this.queueFileUpdate(file, operation, oldPath);
			}, 1000);
			return;
		}

		this.isProcessingFileUpdates = true;

		try {
			if (operation === 'modify') {
				// Check if file actually changed by comparing checksum
				const fileBinary = await this.app.vault.readBinary(file);
				const newChecksum = CRC32.buf(new Uint8Array(fileBinary)).toString(16);
				
				const existingDocs = this.vectorDB.getFileDocuments(file.path);
				if (existingDocs.length > 0 && existingDocs[0].metadata.fileChecksum === newChecksum) {
					// File content hasn't actually changed, skip update
					LoggingUtility.log(`File modification detected but content unchanged: ${file.path}`);
					return;
				}
				
				LoggingUtility.log(`File content changed: ${file.path} (checksum: ${newChecksum})`);
				await this.updateFileEmbeddings(file);
				await this.vectorDB.save();
				
			} else if (operation === 'rename') {
				LoggingUtility.log(`File renamed from ${oldPath} to ${file.path}`);
				if (oldPath) {
					await this.vectorDB.removeFileDocuments(oldPath);
				}
				await this.updateFileEmbeddings(file);
				await this.vectorDB.save();
			}
			
			// Yield control periodically during processing
			await new Promise(resolve => setTimeout(resolve, 0));
			
		} finally {
			this.isProcessingFileUpdates = false;
		}
	}

	/**
	 * Verify and wait for embedding service connection before proceeding
	 */
	private async ensureEmbeddingConnection(): Promise<void> {
		const maxRetries = 10;
		const retryDelay = 2000; // 2 seconds between retries
		
		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			LoggingUtility.log(`Verifying embedding service connection (attempt ${attempt}/${maxRetries})...`);
			
			const connectionTest = await this.testEmbeddingConnection();
			
			if (connectionTest.success) {
				LoggingUtility.log(`Embedding service connection verified successfully (${connectionTest.dimensions} dimensions)`);
				return;
			}
			
			LoggingUtility.warn(`Connection attempt ${attempt} failed: ${connectionTest.error}`);
			
			if (attempt === maxRetries) {
				throw new Error(`Could not establish connection to LM Studio after ${maxRetries} attempts. Please ensure LM Studio is running and the embedding model is loaded. Last error: ${connectionTest.error}`);
			}
			
			// Wait before next retry
			LoggingUtility.log(`Waiting ${retryDelay}ms before next connection attempt...`);
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}
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
			// Verify embedding service connection before proceeding
			if (this.progressCallback) {
				this.progressCallback(0, 1, 'Verifying connection to LM Studio...');
			}
			await this.ensureEmbeddingConnection();
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			LoggingUtility.log(`Starting to analyze ${files.length} markdown files for changes`);
			
			// Calculate checksums for all files to determine what needs updating
			const fileStats = new Map<string, { checksum: string; lastModified: number; size: number }>();
			const existingFiles = new Set<string>();
			
			if (this.progressCallback) {
				this.progressCallback(0, files.length, 'Analyzing markdown files for changes...');
			}
			
			for (let i = 0; i < files.length; i++) {
				if (this.indexingAbortController.signal.aborted) {
					LoggingUtility.log('Indexing aborted by user');
					return;
				}
				
				const file = files[i];
				existingFiles.add(file.path);
				
				try {
					const content = await this.app.vault.readBinary(file);
					const checksum = CRC32.buf(new Uint8Array(content)).toString(16);
					
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
			
			LoggingUtility.log(`Found ${filesToUpdate.length} markdown files that need updating out of ${files.length} total files`);
			
			if (filesToUpdate.length === 0) {
				LoggingUtility.log('All markdown files are up to date, no indexing needed');
			} else {
				// Pre-calculate total chunks across all files that need updating
				let totalChunks = 0;
				const fileChunkCounts = new Map<string, number>();
				
				if (this.progressCallback) {
					this.progressCallback(0, filesToUpdate.length, 'Calculating total chunks for markdown files...');
				}
				
				for (let i = 0; i < filesToUpdate.length; i++) {
					const filePath = filesToUpdate[i];
					const file = this.app.vault.getAbstractFileByPath(filePath);
					
					if (file instanceof TFile) {
						try {
							const content = await this.app.vault.read(file);
							const chunks = this.splitIntoParagraphs(content);
							const chunkCount = chunks.length;
							fileChunkCounts.set(filePath, chunkCount);
							totalChunks += chunkCount;
						} catch (error) {
							LoggingUtility.warn(`Could not read file for chunk calculation: ${filePath}`, error);
							fileChunkCounts.set(filePath, 0);
						}
					}
					
					// Yield control periodically during chunk counting
					if (i % 10 === 0) {
						await new Promise(resolve => setTimeout(resolve, 0));
					}
				}
				
				LoggingUtility.log(`Total chunks to process: ${totalChunks} across ${filesToUpdate.length} markdown files`);
				
				// Process markdown files and track chunk-level progress
				let processedChunks = 0;
				
				for (let i = 0; i < filesToUpdate.length; i++) {
					if (this.indexingAbortController.signal.aborted) {
						LoggingUtility.log('Indexing aborted by user');
						break;
					}
					
					const filePath = filesToUpdate[i];
					const file = this.app.vault.getAbstractFileByPath(filePath);
					
					if (file instanceof TFile) {
						const chunkCount = fileChunkCounts.get(filePath) || 0;
						
						if (this.progressCallback && chunkCount > 0) {
							this.progressCallback(processedChunks + 1, totalChunks, `Processing chunk 1 of ${chunkCount} chunks in ${file.basename}`);
						}
						
						await this.updateFileEmbeddingsWithProgress(file, (chunkIndex, totalFileChunks) => {
							if (this.progressCallback) {
								const currentChunk = processedChunks + chunkIndex + 1;
								this.progressCallback(currentChunk, totalChunks, `Processing chunk ${chunkIndex + 1} of ${totalFileChunks} chunks in ${file.basename}`);
							}
						});
						
						processedChunks += chunkCount;
						
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
				
				// Final save for markdown files
				await this.vectorDB.save();
				
				LoggingUtility.log(`Markdown file processing complete. Updated ${filesToUpdate.length} files with ${processedChunks} total chunks.`);
			}
			
			// Process images LAST if image text extractor is available
			if (this.imageTextExtractor && this.imageProcessingEnabled) {
				LoggingUtility.log('Starting image processing phase...');
				
				// Get all image files in the vault
				const imageFiles = this.app.vault.getFiles().filter(file => ImageTextExtractor.isImageFile(file));
				
				if (imageFiles.length > 0) {
					if (this.progressCallback) {
						this.progressCallback(0, imageFiles.length, 'Processing images for text extraction...');
					}
					
					// Check vision capabilities first
					const capabilities = await this.imageTextExtractor.checkVisionCapabilities();
					if (!capabilities.supportsVision) {
						LoggingUtility.log('LLM model does not support vision, skipping image processing');
					} else {
						// Process each image
						for (let i = 0; i < imageFiles.length; i++) {
							if (this.indexingAbortController.signal.aborted) {
								LoggingUtility.log('Image processing aborted by user');
								break;
							}
							
							const imageFile = imageFiles[i];
							
							if (this.progressCallback) {
								this.progressCallback(i + 1, imageFiles.length, `Processing image: ${imageFile.basename}`);
							}
							
							try {
								LoggingUtility.log(`Processing image ${i + 1}/${imageFiles.length}: ${imageFile.path}`);
								
								// Check if image has changed since last extraction by comparing checksum
								const imageBinary = await this.app.vault.readBinary(imageFile);
								const newImageChecksum = CRC32.buf(new Uint8Array(imageBinary)).toString(16);
								
								const existingImageDocs = this.vectorDB.getFileDocuments(imageFile.path);
								if (existingImageDocs.length > 0 && existingImageDocs[0].metadata.fileChecksum === newImageChecksum) {
									// Image content hasn't changed, skip extraction
									LoggingUtility.log(`Image unchanged since last extraction: ${imageFile.path} (checksum: ${newImageChecksum})`);
									continue;
								}
								
								LoggingUtility.log(`Image content changed, extracting text: ${imageFile.path} (checksum: ${newImageChecksum})`);

								// Extract text from image
								const result = await this.imageTextExtractor.extractTextFromImage(imageFile);
								
								if (result.success && result.extractedText.trim()) {
									// Create a virtual document for the extracted text
									const extractedText = result.extractedText;
									
									// Split extracted text into chunks
									const chunks = this.splitIntoParagraphs(extractedText);
									
									if (chunks.length > 0) {
										// Generate embeddings for chunks
										const texts = chunks.map(c => c.text);
										const embeddings = await this.embeddingService.generateEmbeddings(texts);
										
										// Create chunk documents for the image
										const chunkDocuments = chunks.map((chunk, index) => ({
											id: `${imageFile.path}#c${chunk.index}`,
											vector: embeddings[index],
											metadata: {
												filePath: imageFile.path,
												fileName: imageFile.basename,
												title: `Image: ${imageFile.basename}`,
												paragraphIndex: chunk.index,
												paragraphText: chunk.text,
												fileChecksum: CRC32.str(extractedText).toString(16),
												lastModified: imageFile.stat.mtime,
												fileSize: imageFile.stat.size,
												sourceType: 'image' as const,
												extractedText: true
											}
										}));
										
										// Store in vector database
										await this.vectorDB.upsertFileDocuments(imageFile.path, chunkDocuments);
										// Save periodically to avoid losing progress
										if ((i + 1) % 2 === 0) {
											await this.vectorDB.save();
										}
										
										LoggingUtility.log(`Successfully processed image ${imageFile.path} with ${chunks.length} text chunks`);
									}
								} else {
									LoggingUtility.log(`No text extracted from image ${imageFile.path}: ${result.error || 'No text found'}`);
								}
								
								// Yield control periodically
								if (i % 3 === 0) {
									await new Promise(resolve => setTimeout(resolve, 0));
								}
								
							} catch (error) {
								LoggingUtility.error(`Error processing image ${imageFile.path}:`, error);
							}
						}
						
						// Save the updated index after image processing
						await this.vectorDB.save();
						LoggingUtility.log(`Image processing complete. Processed ${imageFiles.length} images.`);
					}
				} else {
					LoggingUtility.log('No image files found in vault');
				}
			} else {
				LoggingUtility.log('Image processing skipped - extractor not available or disabled');
			}
			
			const stats = this.vectorDB.getStats();
			LoggingUtility.log(`Indexing complete. Total: ${stats.documentCount} paragraph documents across ${stats.fileCount} files (including images)`);
			
		} catch (error) {
			LoggingUtility.error('Error during indexing:', error);
			// Check if it's a connection error and show appropriate message
			if (error.message && error.message.includes('Could not establish connection to LM Studio')) {
				new Notice('RAG indexing failed: Cannot connect to LM Studio. Please ensure LM Studio is running with an embedding model loaded.', 10000);
			} else {
				new Notice('Error during RAG indexing: ' + error.message, 8000);
			}
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
			// Verify embedding service connection before proceeding
			if (this.progressCallback) {
				this.progressCallback(0, 1, 'Verifying connection to LM Studio...');
			}
			await this.ensureEmbeddingConnection();
			
			// Clear existing index completely
			await this.vectorDB.clear();
			LoggingUtility.log('Cleared existing vector index for complete rebuild');
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			LoggingUtility.log(`Starting complete rebuild of ${files.length} markdown files`);
			
			// Pre-calculate total chunks across all files
			let totalChunks = 0;
			const fileChunkCounts = new Map<string, number>();
			
			if (this.progressCallback) {
				this.progressCallback(0, files.length, 'Calculating total chunks for markdown files...');
			}
			
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				
				try {
					const content = await this.app.vault.read(file);
					const chunks = this.splitIntoParagraphs(content);
					const chunkCount = chunks.length;
					fileChunkCounts.set(file.path, chunkCount);
					totalChunks += chunkCount;
				} catch (error) {
					LoggingUtility.warn(`Could not read file for chunk calculation: ${file.path}`, error);
					fileChunkCounts.set(file.path, 0);
				}
				
				// Yield control periodically during chunk counting
				if (i % 10 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}
			
			LoggingUtility.log(`Total chunks to process: ${totalChunks} across ${files.length} markdown files`);
			
			// Process markdown files and track chunk-level progress
			let processedChunks = 0;
			
			for (let i = 0; i < files.length; i++) {
				if (this.indexingAbortController.signal.aborted) {
					LoggingUtility.log('Indexing aborted by user');
					break;
				}
				
				const file = files[i];
				const chunkCount = fileChunkCounts.get(file.path) || 0;
				
				if (this.progressCallback && chunkCount > 0) {
					this.progressCallback(processedChunks + 1, totalChunks, `Processing chunk 1 of ${chunkCount} chunks in ${file.basename}`);
				}
				
				await this.updateFileEmbeddingsWithProgress(file, (chunkIndex: number, totalFileChunks: number) => {
					if (this.progressCallback) {
						const currentChunk = processedChunks + chunkIndex + 1;
						this.progressCallback(currentChunk, totalChunks, `Processing chunk ${chunkIndex + 1} of ${totalFileChunks} chunks in ${file.basename}`);
					}
				});
				
				processedChunks += chunkCount;
				
				// Save periodically to avoid losing progress
				if ((i + 1) % 10 === 0) {
					await this.vectorDB.save();
				}
				
				// Yield control to the UI thread every few files to keep Obsidian responsive
				if (i % 3 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}
			
			// Final save for markdown files
			await this.vectorDB.save();
			
			LoggingUtility.log(`Markdown file rebuild complete. Indexed ${processedChunks} total chunks across ${files.length} files.`);
			
			// Process images LAST if image text extractor is available
			if (this.imageTextExtractor && this.imageProcessingEnabled) {
				LoggingUtility.log('Starting image processing phase...');
				
				// Get all image files in the vault
				const imageFiles = this.app.vault.getFiles().filter(file => ImageTextExtractor.isImageFile(file));
				
				if (imageFiles.length > 0) {
					if (this.progressCallback) {
						this.progressCallback(0, imageFiles.length, 'Processing images for text extraction...');
					}
					
					// Check vision capabilities first
					const capabilities = await this.imageTextExtractor.checkVisionCapabilities();
					if (!capabilities.supportsVision) {
						LoggingUtility.log('LLM model does not support vision, skipping image processing');
					} else {
						// Process each image
						for (let i = 0; i < imageFiles.length; i++) {
							if (this.indexingAbortController.signal.aborted) {
								LoggingUtility.log('Image processing aborted by user');
								break;
							}
							
							const imageFile = imageFiles[i];
							
							if (this.progressCallback) {
								this.progressCallback(i + 1, imageFiles.length, `Processing image: ${imageFile.basename}`);
							}
							
							try {
								LoggingUtility.log(`Processing image ${i + 1}/${imageFiles.length}: ${imageFile.path}`);
								
								// Extract text from image
								const result = await this.imageTextExtractor.extractTextFromImage(imageFile);
								
								if (result.success && result.extractedText.trim()) {
									// Create a virtual document for the extracted text
									const extractedText = result.extractedText;
									
									// Split extracted text into chunks
									const chunks = this.splitIntoParagraphs(extractedText);
									
									if (chunks.length > 0) {
										// Generate embeddings for chunks
										const texts = chunks.map(c => c.text);
										const embeddings = await this.embeddingService.generateEmbeddings(texts);
										const imageBinary = await imageFile.vault.readBinary(imageFile);

										// Create chunk documents for the image
										const chunkDocuments = chunks.map((chunk, index) => ({
											id: `${imageFile.path}#c${chunk.index}`,
											vector: embeddings[index],
											metadata: {
												filePath: imageFile.path,
												fileName: imageFile.basename,
												title: `Image: ${imageFile.basename}`,
												paragraphIndex: chunk.index,
												paragraphText: chunk.text,
												fileChecksum: CRC32.buf(new Uint8Array(imageBinary)).toString(16),
												lastModified: imageFile.stat.mtime,
												fileSize: imageFile.stat.size,
												sourceType: 'image' as const,
												extractedText: true
											}
										}));
										
										// Store in vector database
										await this.vectorDB.upsertFileDocuments(imageFile.path, chunkDocuments);
										await this.vectorDB.save();
										
										LoggingUtility.log(`Successfully processed image ${imageFile.path} with ${chunks.length} text chunks`);
									}
								} else {
									LoggingUtility.log(`No text extracted from image ${imageFile.path}: ${result.error || 'No text found'}`);
								}
								
								// Yield control periodically
								if (i % 3 === 0) {
									await new Promise(resolve => setTimeout(resolve, 0));
								}
								
							} catch (error) {
								LoggingUtility.error(`Error processing image ${imageFile.path}:`, error);
							}
						}
						
						// Save the updated index after image processing
						await this.vectorDB.save();
						LoggingUtility.log(`Image processing complete. Processed ${imageFiles.length} images.`);
					}
				} else {
					LoggingUtility.log('No image files found in vault');
				}
			} else {
				LoggingUtility.log('Image processing skipped - extractor not available or disabled');
			}
			
			const stats = this.vectorDB.getStats();
			LoggingUtility.log(`Complete rebuild finished. Total: ${stats.documentCount} paragraph documents across ${stats.fileCount} files (including images)`);
			
		} catch (error) {
			LoggingUtility.error('Error during complete rebuild:', error);
			// Check if it's a connection error and show appropriate message
			if (error.message && error.message.includes('Could not establish connection to LM Studio')) {
				new Notice('RAG complete rebuild failed: Cannot connect to LM Studio. Please ensure LM Studio is running with an embedding model loaded.', 10000);
			} else {
				new Notice('Error during RAG complete rebuild: ' + error.message, 8000);
			}
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
			const binaryContent = await this.app.vault.readBinary(file);
			const metadata = this.app.metadataCache.getFileCache(file);
			const title = this.getFileTitle(file, metadata);
			
			// Calculate checksum from binary content
			const checksum = CRC32.buf(new Uint8Array(binaryContent)).toString(16);
			
			// Split content into chunks
			const chunks = this.splitIntoParagraphs(content);
			
			if (chunks.length === 0) {
				LoggingUtility.log(`No chunks found in file: ${file.path}`);
				return;
			}
			
			// Yield control briefly before starting embedding generation
			await new Promise(resolve => setTimeout(resolve, 0));
			
			// Generate embeddings for all chunks
			const texts = chunks.map(c => c.text);
			const embeddings = await this.embeddingService.generateEmbeddings(texts);
			
			// Yield control after embedding generation
			await new Promise(resolve => setTimeout(resolve, 0));
			
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
					fileSize: file.stat.size,
					sourceType: 'markdown' as const
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
	 * Update embeddings for a single file with chunk-level progress reporting
	 */
	private async updateFileEmbeddingsWithProgress(file: TFile, progressCallback?: (chunkIndex: number, totalChunks: number) => void): Promise<void> {
		try {
			const content = await this.app.vault.read(file);
			const binaryContent = await this.app.vault.readBinary(file);
			const metadata = this.app.metadataCache.getFileCache(file);
			const title = this.getFileTitle(file, metadata);
			
			// Calculate checksum from binary content
			const checksum = CRC32.buf(new Uint8Array(binaryContent)).toString(16);
			
			// Split content into chunks
			const chunks = this.splitIntoParagraphs(content);
			
			if (chunks.length === 0) {
				LoggingUtility.log(`No chunks found in file: ${file.path}`);
				return;
			}
			
			// Generate embeddings for chunks one at a time with progress reporting
			const chunkDocuments = [];
			
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				
				// Report progress for current chunk
				if (progressCallback) {
					progressCallback(i, chunks.length);
				}
				
				// Yield control briefly before each embedding generation
				if (i % 5 === 0) {
					await new Promise(resolve => setTimeout(resolve, 0));
				}
				
				// Generate embedding for this chunk
				const embedding = await this.generateEmbedding(chunk.text);
				
				// Create chunk document
				const chunkDocument = {
					id: `${file.path}#c${chunk.index}`,
					vector: embedding,
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
				};
				
				chunkDocuments.push(chunkDocument);
			}
			
			// Store in vector database
			await this.vectorDB.upsertFileDocuments(file.path, chunkDocuments);
			
			// Report final progress
			if (progressCallback) {
				progressCallback(chunks.length, chunks.length);
			}
			
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
	getStats(): { 
		documentCount: number; 
		fileCount: number; 
		lastUpdated: Date; 
		sizeInBytes: number;
		markdownDocuments: number;
		imageDocuments: number;
		markdownFiles: number;
		imageFiles: number;
	} {
		const baseStats = this.vectorDB.getStats();
		
		// Get detailed breakdown of document types
		const documents = this.vectorDB.getAllDocuments();
		let markdownDocuments = 0;
		let imageDocuments = 0;
		let markdownFiles = new Set<string>();
		let imageFiles = new Set<string>();
		
		for (const doc of documents) {
			if (doc.metadata.sourceType === 'image') {
				imageDocuments++;
				imageFiles.add(doc.metadata.filePath);
			} else {
				markdownDocuments++;
				markdownFiles.add(doc.metadata.filePath);
			}
		}
		
		return {
			...baseStats,
			markdownDocuments,
			imageDocuments,
			markdownFiles: markdownFiles.size,
			imageFiles: imageFiles.size
		};
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