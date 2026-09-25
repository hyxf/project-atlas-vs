export const templateBackupKey = 'projectAtlas.templateBackup.v1';

export interface TemplateBackupFile {
    key: string;
    name: string;
    file: string;
}

export interface TemplateBackupDocument {
    contents: string;
}

export interface TemplateBackup {
    schemaVersion: 1;
    createdAt: string;
    documents: Record<string, TemplateBackupDocument>;
}

export interface TemplateBackupStorage {
    get<T>(section: string): T | undefined;
    update(section: string, value: unknown): Thenable<void>;
    setKeysForSync(keys: readonly string[]): void;
}
