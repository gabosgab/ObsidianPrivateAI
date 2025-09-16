import { LoggingUtility } from './LoggingUtility';
import { App } from 'obsidian';

export interface ImageDocument {
	id: string; // unique id for the paragraph (e.g., "image.png#c1")
	vector: number[];
	metadata: {
		filePath: string;
		fileName: string;
		title: string;
		paragraphIndex: number;
		paragraphText: string; // store the actual extracted text for retrieval
		fileChecksum: string; // checksum of entire file
		lastModified: number;
		fileSize: number;
		sourceType: 'image'; // type of source file
		extractedText: boolean; // whether text was extracted from image
	};
}

interface ImageVectorIndex {
	version: string;
	documents: ImageDocument[];
	dimension: number;
	lastUpdated: number;
}

export interface ImageSearchResult {
	document: ImageDocument;
	similarity: number;
}

export class ImageVectorDatabase {
	private index: ImageVectorIndex;
	private indexPath: string;
	private app: App;

	constructor(app: App, indexPath: string) {
		this.app = app;
		this.indexPath = indexPath;
		this.index = {
			version: '2.0', // Increment version for paragraph-based storage
			documents: [],
			dimension: 0, // Will be set when first document is added
			lastUpdated: Date.now()
		};
	}

	/**
	 * Load the index from disk
	 */
	async load(): Promise<void> {
		try {
			const data = await this.app.vault.adapter.read(this.indexPath);
			const loadedIndex = JSON.parse(data);
			
			// Check if we need to migrate from old format
			if (loadedIndex.version === '1.0') {
				LoggingUtility.log('Detected old image vector index format, will need rebuild for paragraph support');
				// Clear old index as structure is incompatible
				this.index = {
					version: '2.0',
					documents: [],
					dimension: 0,
					lastUpdated: Date.now()
				};
			} else {
				this.index = loadedIndex;
			}
			
			LoggingUtility.log(`Loaded image vector index v${this.index.version} with ${this.index.documents.length} image documents`);
		} catch (error) {
			LoggingUtility.log('No existing image vector index found, starting fresh');
			this.index = {
				version: '2.0',
				documents: [],
				dimension: 0,
				lastUpdated: Date.now()
			};
		}
	}

	/**
	 * Save the index to disk
	 */
	async save(): Promise<void> {
		try {
			// Ensure the directory exists before writing the file
			const pathParts = this.indexPath.split('/');
			const fileName = pathParts.pop(); // Remove filename
			const directoryPath = pathParts.join('/');
			
			// Create directory if it doesn't exist
			if (directoryPath && directoryPath !== '') {
				try {
					const directoryExists = await this.app.vault.adapter.exists(directoryPath);
					if (!directoryExists) {
						await this.app.vault.createFolder(directoryPath);
						LoggingUtility.log(`Created directory: ${directoryPath}`);
					}
				} catch (directoryError) {
					// If createFolder fails, try creating parent directories recursively
					LoggingUtility.log(`Directory creation failed, attempting recursive creation: ${directoryPath}`);
					await this.createDirectoryRecursively(directoryPath);
				}
			}
			
			const data = JSON.stringify(this.index, null, 2);
			await this.app.vault.adapter.write(this.indexPath, data);
			LoggingUtility.log(`Saved image vector index with ${this.index.documents.length} image documents`);
		} catch (error) {
			LoggingUtility.error('Failed to save image vector index:', error);
			throw error;
		}
	}

	/**
	 * Create directory recursively if parent directories don't exist
	 */
	private async createDirectoryRecursively(directoryPath: string): Promise<void> {
		const pathParts = directoryPath.split('/').filter(part => part !== '');
		let currentPath = '';
		
		for (const part of pathParts) {
			currentPath += (currentPath ? '/' : '') + part;
			
			try {
				const exists = await this.app.vault.adapter.exists(currentPath);
				if (!exists) {
					await this.app.vault.createFolder(currentPath);
					LoggingUtility.log(`Created directory: ${currentPath}`);
				}
			} catch (error) {
				// Continue trying even if individual directory creation fails
				LoggingUtility.warn(`Could not create directory ${currentPath}:`, error);
			}
		}
	}

	/**
	 * Add or update paragraphs for a file
	 */
	async upsertFileDocuments(filePath: string, imageDocuments: ImageDocument[]): Promise<void> {
		// Remove existing documents for this file
		await this.removeFileDocuments(filePath);
		
		// Add new image documents
		for (const document of imageDocuments) {
			// Set dimension from first document if not set
			if (this.index.dimension === 0 && document.vector.length > 0) {
				this.index.dimension = document.vector.length;
				LoggingUtility.log(`Set image vector dimension to ${this.index.dimension}`);
			}
			
			// Validate dimension
			if (document.vector.length !== this.index.dimension) {
				throw new Error(`Image vector dimension mismatch. Expected ${this.index.dimension}, got ${document.vector.length}`);
			}
			
			this.index.documents.push(document);
		}
		
		this.index.lastUpdated = Date.now();
		LoggingUtility.log(`Updated ${imageDocuments.length} image documents for file: ${filePath}`);
	}

	/**
	 * Remove all documents for a specific file
	 */
	async removeFileDocuments(filePath: string): Promise<void> {
		const initialLength = this.index.documents.length;
		this.index.documents = this.index.documents.filter(doc => doc.metadata.filePath !== filePath);
		
		const removedCount = initialLength - this.index.documents.length;
		if (removedCount > 0) {
			this.index.lastUpdated = Date.now();
			LoggingUtility.log(`Removed ${removedCount} image documents for file: ${filePath}`);
		}
	}

	/**
	 * Search for similar paragraphs using cosine similarity
	 */
	search(queryVector: number[], limit: number = 5, threshold: number = 0.5): ImageSearchResult[] {
		LoggingUtility.log(`Searching for ${limit} similar image paragraphs with threshold ${threshold}`);
		if (this.index.documents.length === 0) {
			return [];
		}

		const startTime = Date.now();
		// Calculate similarities
		const similarities = this.index.documents.map(doc => ({
			document: doc,
			similarity: this.cosineSimilarity(queryVector, doc.vector)
		}));

		// Filter by threshold and sort by similarity
		const results = similarities
			.filter(item => item.similarity >= threshold)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);

		LoggingUtility.log(`Found ${results.length} similar image paragraphs in ${Date.now() - startTime}ms`);
		return results;
	}

	/**
	 * Search for similar paragraphs and group by file
	 */
	searchGroupedByFile(queryVector: number[], maxFiles: number = 3, maxParagraphsPerFile: number = 3, threshold: number = 0.5): Map<string, ImageSearchResult[]> {
		const allResults = this.search(queryVector, maxFiles * maxParagraphsPerFile * 2, threshold);
		
		// Group by file
		const resultsByFile = new Map<string, ImageSearchResult[]>();
		
		for (const result of allResults) {
			const filePath = result.document.metadata.filePath;
			
			if (!resultsByFile.has(filePath)) {
				resultsByFile.set(filePath, []);
			}
			
			const fileResults = resultsByFile.get(filePath)!;
			if (fileResults.length < maxParagraphsPerFile) {
				fileResults.push(result);
			}
		}
		
		// Keep only top files by best paragraph similarity
		const sortedFiles = Array.from(resultsByFile.entries())
			.sort((a, b) => b[1][0].similarity - a[1][0].similarity)
			.slice(0, maxFiles);
		
		return new Map(sortedFiles);
	}

	/**
	 * Calculate cosine similarity between two vectors
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error('Vectors must have the same dimension');
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		normA = Math.sqrt(normA);
		normB = Math.sqrt(normB);

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (normA * normB);
	}

	/**
	 * Clear the entire index
	 */
	async clear(): Promise<void> {
		this.index = {
			version: '2.0',
			documents: [],
			dimension: 0, // Will be set when first document is added
			lastUpdated: Date.now()
		};
		await this.save();
		LoggingUtility.log('Cleared image vector index');
	}

	/**
	 * Get statistics about the index
	 */
	getStats(): { documentCount: number; fileCount: number; lastUpdated: Date; sizeInBytes: number } {
		const sizeInBytes = JSON.stringify(this.index).length;
		const uniqueFiles = new Set(this.index.documents.map(doc => doc.metadata.filePath));
		
		return {
			documentCount: this.index.documents.length,
			fileCount: uniqueFiles.size,
			lastUpdated: new Date(this.index.lastUpdated),
			sizeInBytes
		};
	}

	/**
	 * Check if a file exists in the index
	 */
	hasFile(filePath: string): boolean {
		return this.index.documents.some(doc => doc.metadata.filePath === filePath);
	}

	/**
	 * Get all documents for a specific file
	 */
	getFileDocuments(filePath: string): ImageDocument[] {
		return this.index.documents.filter(doc => doc.metadata.filePath === filePath);
	}

	/**
	 * Get all documents in the index
	 */
	getAllDocuments(): ImageDocument[] {
		return [...this.index.documents];
	}

	/**
	 * Check if a file needs to be updated based on checksum
	 */
	fileNeedsUpdate(filePath: string, checksum: string, lastModified: number, size: number): boolean {
		const fileDocuments = this.getFileDocuments(filePath);
		
		if (fileDocuments.length === 0) {
			return true; // File doesn't exist in index
		}

		// Check if any of the key properties have changed
		const firstDoc = fileDocuments[0];
		return firstDoc.metadata.fileChecksum !== checksum;
	}

	/**
	 * Get files that need updating based on file stats
	 */
	getFilesNeedingUpdate(fileStats: Map<string, { checksum: string; lastModified: number; size: number }>): string[] {
		const needsUpdate: string[] = [];
		
		for (const [filePath, stats] of fileStats) {
			if (this.fileNeedsUpdate(filePath, stats.checksum, stats.lastModified, stats.size)) {
				needsUpdate.push(filePath);
			}
		}
		
		return needsUpdate;
	}

	/**
	 * Remove documents for files that no longer exist in the file system
	 */
	async removeObsoleteDocuments(existingFiles: Set<string>): Promise<void> {
		const before = this.index.documents.length;
		this.index.documents = this.index.documents.filter(doc => existingFiles.has(doc.metadata.filePath));
		const after = this.index.documents.length;
		
		if (before !== after) {
			this.index.lastUpdated = Date.now();
			LoggingUtility.log(`Removed ${before - after} obsolete image documents`);
		}
	}
}
