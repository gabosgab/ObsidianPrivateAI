import { Migration } from './Migration';
import { LoggingUtility } from '../LoggingUtility';

export class Migration001 implements Migration {
    version = 1;

    async up(db: any): Promise<void> {
        LoggingUtility.log('Running Migration 1: Creating initial schema');

        // Create the documents table
        db.run(`
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

        db.run(`CREATE INDEX IF NOT EXISTS idx_file_path ON documents(file_path);`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_source_type ON documents(source_type);`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_file_checksum ON documents(file_checksum);`);

        LoggingUtility.log('Migration 1 complete');
    }
}
