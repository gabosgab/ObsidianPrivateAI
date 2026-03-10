import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MigrationRunner } from '../../src/db/MigrationRunner';
import { Migration } from '../../src/db/migrations/Migration';
import { LoggingUtility } from '../../src/utils/LoggingUtility';

// Mock LoggingUtility
vi.mock('../../src/utils/LoggingUtility', () => ({
    LoggingUtility: {
        log: vi.fn(),
        error: vi.fn()
    }
}));

// Mock 001_initial_schema to avoid running its actual logic
vi.mock('../../src/db/migrations/001_initial_schema', () => {
    return {
        Migration001: class {
            version = 1;
            up = vi.fn().mockResolvedValue(undefined);
        }
    };
});

describe('MigrationRunner', () => {
    let mockDb: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDb = {
            run: vi.fn()
        };
    });

    it('should set up initial migrations in constructor', () => {
        const runner = new MigrationRunner();

        // Verify that the migrations array is initialized
        // @ts-ignore: access private field
        expect(runner.migrations.length).toBeGreaterThan(0);
        // @ts-ignore
        expect(runner.migrations[0].version).toBe(1);
    });

    it('should not run any migrations if pendingMigrations is empty', async () => {
        const runner = new MigrationRunner();
        // @ts-ignore
        runner.migrations = [{ version: 1, up: vi.fn() }];

        await runner.run(mockDb, 1);

        expect(LoggingUtility.log).toHaveBeenCalledWith('No pending migrations');
        expect(mockDb.run).not.toHaveBeenCalled();
    });

    it('should run pending migrations successfully', async () => {
        const runner = new MigrationRunner();
        const m1: Migration = { version: 1, up: vi.fn().mockResolvedValue(undefined) };
        const m2: Migration = { version: 2, up: vi.fn().mockResolvedValue(undefined) };
        // @ts-ignore
        runner.migrations = [m1, m2];

        await runner.run(mockDb, 0);

        // Should have called up on both migrations
        expect(m1.up).toHaveBeenCalledWith(mockDb);
        expect(m2.up).toHaveBeenCalledWith(mockDb);

        // Check database transactions
        expect(mockDb.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
        expect(mockDb.run).toHaveBeenCalledWith(
            'INSERT INTO schema_versions (version, migrated_at) VALUES (?, ?)',
            [1, expect.any(Number)]
        );
        expect(mockDb.run).toHaveBeenCalledWith(
            'INSERT INTO schema_versions (version, migrated_at) VALUES (?, ?)',
            [2, expect.any(Number)]
        );
        expect(mockDb.run).toHaveBeenCalledWith("COMMIT");

        // Should log success
        expect(LoggingUtility.log).toHaveBeenCalledWith('Migration version 1 applied successfully');
        expect(LoggingUtility.log).toHaveBeenCalledWith('Migration version 2 applied successfully');
    });

    it('should rollback and throw if a migration fails', async () => {
        const runner = new MigrationRunner();
        const error = new Error('Migration failed');
        const m1: Migration = { version: 1, up: vi.fn().mockRejectedValue(error) };
        const m2: Migration = { version: 2, up: vi.fn().mockResolvedValue(undefined) };
        // @ts-ignore
        runner.migrations = [m1, m2];

        await expect(runner.run(mockDb, 0)).rejects.toThrow('Migration failed');

        // Should rollback
        expect(mockDb.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
        expect(mockDb.run).toHaveBeenCalledWith("ROLLBACK");
        expect(mockDb.run).not.toHaveBeenCalledWith("COMMIT");

        // Second migration should not run
        expect(m2.up).not.toHaveBeenCalled();

        // Should log error
        expect(LoggingUtility.error).toHaveBeenCalledWith('Error during migration 1:', error);
    });

    it('should throw if BEGIN TRANSACTION fails', async () => {
        const runner = new MigrationRunner();
        const m1: Migration = { version: 1, up: vi.fn().mockResolvedValue(undefined) };
        // @ts-ignore
        runner.migrations = [m1];

        const error = new Error('DB Error');
        mockDb.run.mockImplementation(() => {
            throw error;
        });

        await expect(runner.run(mockDb, 0)).rejects.toThrow('DB Error');

        // migration up should not be called
        expect(m1.up).not.toHaveBeenCalled();

        // Should log outer error
        expect(LoggingUtility.error).toHaveBeenCalledWith('Failed to apply migration version 1:', error);
    });
});