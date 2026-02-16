import { LoggingUtility } from './LoggingUtility';
import { App } from 'obsidian';
import initSqlJs from '@webreflection/sql.js';
import * as path from 'path';
import * as fs from 'fs';

export interface VectorDocument {
	id: string; // unique id for the paragraph (e.g., "file.md#p1" or "image.png#c1")
	vector: number[]; // embedding vector
	metadata: {
		filePath: string;
		fileName?: string; // optional, mainly for images
		title: string;
		paragraphIndex: number;
		paragraphText: string; // store the actual paragraph text for retrieval
		fileChecksum: string; // checksum of entire file
		lastModified?: number; // optional, mainly for images
		fileSize?: number; // optional, mainly for images
		sourceType: 'markdown' | 'image'; // type of source file
		extractedText?: boolean; // whether text was extracted from image
	};
}

export interface VectorSearchResult {
	document: VectorDocument;
	similarity: number;
}

export class UnifiedVectorDatabase {
	private db: any | null = null;
	private dbPath: string;
	private app: App;
	private dimension: number = 0;

	constructor(app: App, dbPath: string) {
		this.app = app;
		this.dbPath = dbPath;
	}

	/**
	 * Initialize the database connection and create tables if needed
	 */
	async load(): Promise<void> {
		try {
			// Ensure the directory exists
			const dbDir = path.dirname(this.dbPath);
			if (!fs.existsSync(dbDir)) {
				fs.mkdirSync(dbDir, { recursive: true });
				LoggingUtility.log(`Created database directory: ${dbDir}`);
			}

			// Open database connection
			// Load WASM file from plugin directory (two levels up from db file: vector-index/embeddings.db -> plugin/sql-wasm.wasm)
			const wasmPath = path.join(path.dirname(path.dirname(this.dbPath)), 'sql-wasm.wasm');
			const wasmBinary = fs.readFileSync(wasmPath);
			const SQL = await initSqlJs({
				wasmBinary
			});

			// Load database if it exists, otherwise create new
			let dbFile;
			if (fs.existsSync(this.dbPath)) {
				dbFile = fs.readFileSync(this.dbPath);
			}
			this.db = new SQL.Database(dbFile);

			// Enable WAL mode for better concurrency - sql.js might not support this as it's in-memory/file-backed, but we can try
			// Note: sql.js is usually synchronous and in-memory, requiring explicit save.
			// The original code assumed standard SQLite. usage of WAL with sql.js (file-backed emulation) might be no-op.
			try {
				this.db.run("PRAGMA journal_mode = WAL");
			} catch (e) {
				LoggingUtility.warn("Could not set WAL mode (might be unsupported in this WASM build):", e);
			}

			// Create the documents table if it doesn't exist
			this.db.run(`
				CREATE TABLE IF NOT EXISTS documents (
					id TEXT PRIMARY KEY,
					file_path TEXT NOT NULL,
					file_name TEXT,
					title TEXT NOT NULL,
					paragraph_index INTEGER NOT NULL,
					paragraph_text TEXT NOT NULL,
					file_checksum TEXT NOT NULL,
					last_modified INTEGER,
					file_size INTEGER,
					source_type TEXT NOT NULL CHECK(source_type IN ('markdown', 'image')),
					extracted_text INTEGER DEFAULT 0,
					vector_json TEXT NOT NULL,
					dimension INTEGER NOT NULL,
					created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
					updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
				);
			`);

			this.db.run(`CREATE INDEX IF NOT EXISTS idx_file_path ON documents(file_path);`);
			this.db.run(`CREATE INDEX IF NOT EXISTS idx_source_type ON documents(source_type);`);
			this.db.run(`CREATE INDEX IF NOT EXISTS idx_file_checksum ON documents(file_checksum);`);

			// Get dimension from first document if exists
			const dimStmt = this.db.prepare('SELECT dimension FROM documents LIMIT 1');
			if (dimStmt.step()) {
				const row = dimStmt.getAsObject();
				if (row.dimension) {
					this.dimension = row.dimension;
					LoggingUtility.log(`Loaded vector dimension: ${this.dimension} from database`);
				}
			}
			dimStmt.free();

			// Get document count
			const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM documents');
			countStmt.step();
			const countResult = countStmt.getAsObject();
			countStmt.free();

			LoggingUtility.log(`Loaded unified vector database with ${countResult.count} documents`);
		} catch (error) {
			LoggingUtility.error('Failed to load unified vector database:', error);
			throw error;
		}
	}

	/**
	 * Close the database connection
	 */
	async close(): Promise<void> {
		if (this.db) {
			this.db.close();
			this.db = null;
			LoggingUtility.log('Closed unified vector database');
		}
	}

	/**
	 * Add or update documents for a file
	 */
	async upsertFileDocuments(filePath: string, documents: VectorDocument[]): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		if (documents.length === 0) {
			return;
		}

		// Set dimension from first document if not set
		if (this.dimension === 0 && documents[0].vector.length > 0) {
			this.dimension = documents[0].vector.length;
			LoggingUtility.log(`Set vector dimension to ${this.dimension}`);
		}

		// Validate dimension for all documents
		for (const doc of documents) {
			if (doc.vector.length !== this.dimension) {
				throw new Error(`Vector dimension mismatch. Expected ${this.dimension}, got ${doc.vector.length}`);
			}
		}

		// Start transaction
		this.db.run("BEGIN TRANSACTION");
		try {
			// Remove existing documents for this file
			this.db.run('DELETE FROM documents WHERE file_path = ?', [filePath]);

			// Insert new documents
			const insertStmt = this.db.prepare(`
				INSERT INTO documents (
					id, file_path, file_name, title, paragraph_index, paragraph_text,
					file_checksum, last_modified, file_size, source_type, extracted_text,
					vector_json, dimension, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
			`);

			for (const doc of documents) {
				insertStmt.run([
					doc.id,
					doc.metadata.filePath,
					doc.metadata.fileName || null,
					doc.metadata.title,
					doc.metadata.paragraphIndex,
					doc.metadata.paragraphText,
					doc.metadata.fileChecksum,
					doc.metadata.lastModified || null,
					doc.metadata.fileSize || null,
					doc.metadata.sourceType,
					doc.metadata.extractedText ? 1 : 0,
					JSON.stringify(doc.vector),
					this.dimension
				]);
			}
			insertStmt.free();

			this.db.run("COMMIT");
			LoggingUtility.log(`Updated ${documents.length} documents for file: ${filePath}`);

			// Persist to disk immediately since sql.js is in-memory
			await this.save();
		} catch (error) {
			this.db.run("ROLLBACK");
			throw error;
		}
	}

	/**
	 * Remove all documents for a specific file
	 */
	async removeFileDocuments(filePath: string): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		this.db.run('DELETE FROM documents WHERE file_path = ?', [filePath]);
		const changes = this.db.getRowsModified();

		// Persist to disk
		await this.save();

		if (changes > 0) {
			LoggingUtility.log(`Removed ${changes} documents for file: ${filePath}`);
		}
	}

	/**
	 * Search for similar documents using cosine similarity
	 */
	search(queryVector: number[], limit: number = 5, threshold: number = 0.5): VectorSearchResult[] {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		LoggingUtility.log(`Searching for ${limit} similar documents with threshold ${threshold}`);

		// Validate query vector dimension
		if (queryVector.length !== this.dimension) {
			throw new Error(`Query vector dimension mismatch. Expected ${this.dimension}, got ${queryVector.length}`);
		}

		// Get all documents
		const stmt = this.db.prepare('SELECT * FROM documents');
		const rows: any[] = [];
		while (stmt.step()) {
			rows.push(stmt.getAsObject());
		}
		stmt.free();

		if (rows.length === 0) {
			return [];
		}

		const startTime = Date.now();

		// Calculate similarities
		const similarities: VectorSearchResult[] = [];
		for (const row of rows) {
			const docVector = JSON.parse(row.vector_json) as number[];
			const similarity = this.cosineSimilarity(queryVector, docVector);

			if (similarity >= threshold) {
				const document: VectorDocument = {
					id: row.id,
					vector: docVector,
					metadata: {
						filePath: row.file_path,
						fileName: row.file_name || undefined,
						title: row.title,
						paragraphIndex: row.paragraph_index,
						paragraphText: row.paragraph_text,
						fileChecksum: row.file_checksum,
						lastModified: row.last_modified || undefined,
						fileSize: row.file_size || undefined,
						sourceType: row.source_type,
						extractedText: row.extracted_text === 1
					}
				};

				similarities.push({
					document,
					similarity
				});
			}
		}

		// Sort by similarity and limit results
		const results = similarities
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);

		LoggingUtility.log(`Found ${results.length} similar documents in ${Date.now() - startTime}ms`);
		return results;
	}

	/**
	 * Search for similar documents and group by file
	 */
	searchGroupedByFile(queryVector: number[], maxFiles: number = 3, maxParagraphsPerFile: number = 3, threshold: number = 0.5): Map<string, VectorSearchResult[]> {
		const allResults = this.search(queryVector, maxFiles * maxParagraphsPerFile * 2, threshold);

		// Group by file
		const resultsByFile = new Map<string, VectorSearchResult[]>();

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
	 * Clear the entire database
	 */
	async clear(): Promise<void> {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		this.db.run('DELETE FROM documents');
		// Persist changes
		await this.save();

		this.dimension = 0;
		LoggingUtility.log('Cleared unified vector database');
	}

	/**
	 * Get statistics about the database
	 */
	getStats(): { documentCount: number; fileCount: number; lastUpdated: Date; sizeInBytes: number } {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM documents');
		countStmt.step();
		const countResult = countStmt.getAsObject();
		countStmt.free();

		const fileCountStmt = this.db.prepare('SELECT COUNT(DISTINCT file_path) as count FROM documents');
		fileCountStmt.step();
		const fileCountResult = fileCountStmt.getAsObject();
		fileCountStmt.free();

		const lastUpdatedStmt = this.db.prepare('SELECT MAX(updated_at) as last_updated FROM documents');
		lastUpdatedStmt.step();
		const lastUpdatedResult = lastUpdatedStmt.getAsObject();
		lastUpdatedStmt.free();

		// Get database file size
		let sizeInBytes = 0;
		try {
			if (fs.existsSync(this.dbPath)) {
				const stats = fs.statSync(this.dbPath);
				sizeInBytes = stats.size;
			}
		} catch (error) {
			LoggingUtility.warn('Could not get database file size:', error);
		}

		return {
			documentCount: Number(countResult.count),
			fileCount: Number(fileCountResult.count),
			lastUpdated: lastUpdatedResult.last_updated ? new Date(lastUpdatedResult.last_updated * 1000) : new Date(),
			sizeInBytes
		};
	}

	/**
	 * Check if a file exists in the database
	 */
	hasFile(filePath: string): boolean {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		const stmt = this.db.prepare('SELECT COUNT(*) as count FROM documents WHERE file_path = ?');
		stmt.bind([filePath]);
		stmt.step();
		const result = stmt.getAsObject();
		stmt.free();

		return result.count > 0;
	}

	/**
	 * Get all documents for a specific file
	 */
	getFileDocuments(filePath: string): VectorDocument[] {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		const stmt = this.db.prepare('SELECT * FROM documents WHERE file_path = ? ORDER BY paragraph_index');
		stmt.bind([filePath]);
		const rows: any[] = [];
		while (stmt.step()) {
			rows.push(stmt.getAsObject());
		}
		stmt.free();

		return rows.map((row: any) => ({
			id: row.id,
			vector: JSON.parse(row.vector_json) as number[],
			metadata: {
				filePath: row.file_path,
				fileName: row.file_name || undefined,
				title: row.title,
				paragraphIndex: row.paragraph_index,
				paragraphText: row.paragraph_text,
				fileChecksum: row.file_checksum,
				lastModified: row.last_modified || undefined,
				fileSize: row.file_size || undefined,
				sourceType: row.source_type,
				extractedText: row.extracted_text === 1
			}
		}));
	}

	/**
	 * Get all documents in the database
	 */
	getAllDocuments(): VectorDocument[] {
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		const stmt = this.db.prepare('SELECT * FROM documents');
		const rows: any[] = [];
		while (stmt.step()) {
			rows.push(stmt.getAsObject());
		}
		stmt.free();

		return rows.map((row: any) => ({
			id: row.id,
			vector: JSON.parse(row.vector_json) as number[],
			metadata: {
				filePath: row.file_path,
				fileName: row.file_name || undefined,
				title: row.title,
				paragraphIndex: row.paragraph_index,
				paragraphText: row.paragraph_text,
				fileChecksum: row.file_checksum,
				lastModified: row.last_modified || undefined,
				fileSize: row.file_size || undefined,
				sourceType: row.source_type,
				extractedText: row.extracted_text === 1
			}
		}));
	}

	/**
	 * Check if a file needs to be updated based on checksum
	 */
	fileNeedsUpdate(filePath: string, checksum: string, lastModified: number, size: number): boolean {
		const fileDocuments = this.getFileDocuments(filePath);

		if (fileDocuments.length === 0) {
			return true; // File doesn't exist in database
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
		if (!this.db) {
			throw new Error('Database not initialized. Call load() first.');
		}

		// Get all file paths from database
		const stmt = this.db.prepare('SELECT DISTINCT file_path FROM documents');
		const rows: any[] = [];
		while (stmt.step()) {
			rows.push(stmt.getAsObject());
		}
		stmt.free();

		const dbFilePaths = new Set(rows.map((row: any) => row.file_path));

		// Find files that exist in database but not in file system
		const filesToRemove: string[] = [];
		for (const dbFilePath of dbFilePaths) {
			if (!existingFiles.has(dbFilePath as string)) {
				filesToRemove.push(dbFilePath as string);
			}
		}

		// Remove documents for obsolete files
		if (filesToRemove.length > 0) {
			this.db.run("BEGIN TRANSACTION");
			try {
				const deleteStmt = this.db.prepare('DELETE FROM documents WHERE file_path = ?');
				for (const filePath of filesToRemove) {
					deleteStmt.run([filePath]);
				}
				deleteStmt.free();
				this.db.run("COMMIT");

				LoggingUtility.log(`Removed ${filesToRemove.length} obsolete file entries from database`);

				// Persist changes
				await this.save();
			} catch (error) {
				this.db.run("ROLLBACK");
				LoggingUtility.error('Failed to remove obsolete documents:', error);
			}
		}
	}

	/**
	 * Save the database to disk
	 */
	async save(): Promise<void> {
		if (this.db) {
			const data = this.db.export();
			const buffer = Buffer.from(data);
			fs.writeFileSync(this.dbPath, buffer);
		}
	}
}
