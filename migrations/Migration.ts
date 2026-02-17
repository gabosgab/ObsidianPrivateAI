export interface Migration {
    version: number;
    up(db: any): Promise<void>;
}
