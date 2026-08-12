import type { Database } from 'sql.js';

export interface Migration {
    version: number;
    up(db: Database): Promise<void>;
}
