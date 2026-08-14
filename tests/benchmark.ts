import { App } from 'obsidian';
import { UnifiedVectorDatabase } from '../src/db/UnifiedVectorDatabase';
import * as fs from 'fs';
import * as path from 'path';
import initSqlJs from '@webreflection/sql.js';

// Minimal mock to bypass import errors outside browser/obsidian env
const mockApp = {} as App;

async function runBenchmark() {
    const dbPath = path.join(__dirname, 'test-benchmark.db');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

    const db = new UnifiedVectorDatabase(mockApp, dbPath);
    await db.load();

    console.log("Inserting 1000 files...");
    const fileStats = new Map<string, { checksum: string; lastModified: number; size: number }>();

    db['db'].run("BEGIN TRANSACTION");
    const insertStmt = db['db'].prepare(`
        INSERT INTO documents (
            id, file_path, file_name, title, paragraph_index, paragraph_text,
            file_checksum, last_modified, file_size, source_type, extracted_text,
            vector_json, dimension, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `);
    const vectorJson = JSON.stringify([0.1, 0.2, 0.3]);
    for (let i = 0; i < 1000; i++) {
        const filePath = `file_${i}.md`;
        const checksum = `hash_${i}`;
        insertStmt.run([
            `${filePath}#p1`, filePath, null, `Title ${i}`, 1, `Text ${i}`,
            checksum, null, null, 'markdown', 0, vectorJson, 3
        ]);
        fileStats.set(filePath, {
            checksum: i % 2 === 0 ? checksum : `hash_changed_${i}`,
            lastModified: Date.now(),
            size: 100
        });
    }
    insertStmt.free();
    db['db'].run("COMMIT");

    for (let i = 1000; i < 1100; i++) {
        fileStats.set(`file_${i}.md`, {
            checksum: `hash_${i}`,
            lastModified: Date.now(),
            size: 100
        });
    }

    console.log("Running optimized benchmark...");
    const start = performance.now();

    const needsUpdate = db.getFilesNeedingUpdate(fileStats);

    const end = performance.now();
    console.log(`Time taken: ${(end - start).toFixed(2)} ms`);
    console.log(`Files needing update: ${needsUpdate.length}`);

    await db.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
}

runBenchmark().catch(console.error);