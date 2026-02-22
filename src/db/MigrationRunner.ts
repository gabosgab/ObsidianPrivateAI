import { Migration } from './migrations/Migration';
import { Migration001 } from './migrations/001_initial_schema';
import { LoggingUtility } from '../utils/LoggingUtility';

export class MigrationRunner {
    private migrations: Migration[] = [];

    constructor() {
        // Register migrations here
        this.migrations = [
            new Migration001()
        ];

        // Sort migrations by version
        this.migrations.sort((a, b) => a.version - b.version);
    }

    async run(db: any, currentVersion: number): Promise<void> {
        const pendingMigrations = this.migrations.filter(m => m.version > currentVersion);

        if (pendingMigrations.length === 0) {
            LoggingUtility.log('No pending migrations');
            return;
        }

        LoggingUtility.log(`Found ${pendingMigrations.length} pending migrations`);

        for (const migration of pendingMigrations) {
            try {
                LoggingUtility.log(`Applying migration version ${migration.version}...`);

                // Execute migration within a transaction
                db.run("BEGIN TRANSACTION");

                try {
                    await migration.up(db);

                    // Update schema version
                    // Note: validation of schema_versions existence should ideally be done before this runner or be part of migration 0
                    // But since we handle pre-migration, we assume schema_versions table exists or will be created by this flow
                    db.run('INSERT INTO schema_versions (version, migrated_at) VALUES (?, ?)', [migration.version, Date.now()]);

                    db.run("COMMIT");
                    LoggingUtility.log(`Migration version ${migration.version} applied successfully`);
                } catch (error) {
                    db.run("ROLLBACK");
                    throw error;
                }
            } catch (error) {
                LoggingUtility.error(`Failed to apply migration version ${migration.version}:`, error);
                throw error; // Stop execution on failure
            }
        }
    }
}
