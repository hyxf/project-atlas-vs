import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { aiPromptsFile } from '../aiPrompts/aiPromptStore';
import { commonCommandsFile } from '../commonCommands/commonCommandStore';
import { gitMessagesFile } from '../gitMessages/gitMessageStore';
import {
    TemplateBackup,
    TemplateBackupDocument,
    TemplateBackupFile,
    TemplateBackupStorage,
    templateBackupKey,
} from './templateBackupTypes';

const defaultTemplateBackupPaths = [
    '${userHome}/.project-atlas/aiprompts.json',
    '${userHome}/.project-atlas/commoncmd.json',
    '${userHome}/.project-atlas/gitmessage.json',
] as const;
const legacyTemplateBackupNames = new Map<string, string>([
    [path.resolve(aiPromptsFile), 'aiprompts.json'],
    [path.resolve(commonCommandsFile), 'commoncmd.json'],
    [path.resolve(gitMessagesFile), 'gitmessage.json'],
]);

export class TemplateBackupService {
    constructor(
        private readonly storage: TemplateBackupStorage,
        private readonly files: readonly TemplateBackupFile[] = getConfiguredTemplateBackupFiles(),
    ) {}

    enableSync(): void {
        this.storage.setKeysForSync([templateBackupKey]);
    }

    getBackup(): TemplateBackup | undefined {
        const value = this.storage.get<unknown>(templateBackupKey);
        return isTemplateBackup(value) ? value : undefined;
    }

    async backup(): Promise<TemplateBackup> {
        assertFilesSaved(this.files.map(({ file }) => file));
        const documents: TemplateBackup['documents'] = {};
        for (const { key, file } of this.files) {
            documents[key] = { contents: await fs.readFile(file, 'utf8') };
        }
        const backup: TemplateBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), documents };
        await this.storage.update(templateBackupKey, backup);
        return backup;
    }

    async restore(): Promise<TemplateBackup> {
        const backup = this.getBackup();
        if (!backup) {
            throw new Error('No valid template backup is available in VS Code Settings Sync.');
        }
        const documents = this.files.flatMap((entry) => {
            const document = getBackupDocument(backup, entry);
            return document ? [{ file: entry.file, contents: document.contents }] : [];
        });
        if (!documents.length) {
            throw new Error('The backup does not contain any files from the current template backup configuration.');
        }
        assertFilesSaved(documents.map(({ file }) => file));
        for (const { file, contents } of documents) {
            await writeFileAtomically(file, contents);
        }
        return backup;
    }

    async deleteBackup(): Promise<void> {
        await this.storage.update(templateBackupKey, undefined);
    }
}

export function getConfiguredTemplateBackupFiles(
    configuredPaths = vscode.workspace
        .getConfiguration('projectAtlas.templateBackup')
        .get<readonly string[]>('files', defaultTemplateBackupPaths),
): TemplateBackupFile[] {
    if (!configuredPaths.length) {
        throw new Error('Configure at least one file in projectAtlas.templateBackup.files.');
    }
    const files = configuredPaths.map((configuredPath) => {
        const key = configuredPath.trim();
        if (!key) {
            throw new Error('projectAtlas.templateBackup.files cannot contain an empty path.');
        }
        const file = resolveTemplateBackupPath(key);
        return { key, name: path.basename(file), file };
    });
    if (new Set(files.map(({ file }) => file)).size !== files.length) {
        throw new Error('projectAtlas.templateBackup.files cannot contain duplicate paths.');
    }
    return files;
}

export function getBackupDocument(
    backup: TemplateBackup,
    file: TemplateBackupFile,
): TemplateBackupDocument | undefined {
    return backup.documents[file.key] ?? getLegacyBackupDocument(backup, file);
}

export function getTemplateRefreshCommands(files: readonly TemplateBackupFile[]): string[] {
    const refreshCommands = new Map<string, string>([
        [path.resolve(aiPromptsFile), 'project-atlas.refreshAiPrompts'],
        [path.resolve(commonCommandsFile), 'project-atlas.refreshCommonCommands'],
        [path.resolve(gitMessagesFile), 'project-atlas.refreshGitMessages'],
    ]);
    return files.flatMap(({ file }) => {
        const command = refreshCommands.get(path.resolve(file));
        return command ? [command] : [];
    });
}

function resolveTemplateBackupPath(configuredPath: string): string {
    const userHome = os.homedir();
    const expandedPath = configuredPath.replace(/^~(?=$|[/\\])/, userHome).replaceAll('${userHome}', userHome);
    if (!path.isAbsolute(expandedPath)) {
        throw new Error(`Template backup paths must be absolute: ${configuredPath}`);
    }
    return path.resolve(expandedPath);
}

function assertFilesSaved(files: readonly string[]): void {
    const unsaved = vscode.workspace.textDocuments.find(
        (document) =>
            document.isDirty && files.some((file) => path.resolve(file) === path.resolve(document.uri.fsPath)),
    );
    if (unsaved) {
        throw new Error(`Save or discard unsaved changes in ${path.basename(unsaved.uri.fsPath)} before continuing.`);
    }
}

function isTemplateBackup(value: unknown): value is TemplateBackup {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    const backup = value as Partial<TemplateBackup>;
    return (
        backup.schemaVersion === 1 &&
        typeof backup.createdAt === 'string' &&
        !!backup.documents &&
        typeof backup.documents === 'object' &&
        !Array.isArray(backup.documents) &&
        Object.values(backup.documents).every(
            (document) =>
                !!document &&
                typeof document === 'object' &&
                typeof (document as TemplateBackupDocument).contents === 'string',
        )
    );
}

function getLegacyBackupDocument(backup: TemplateBackup, file: TemplateBackupFile): TemplateBackupDocument | undefined {
    const legacyName = legacyTemplateBackupNames.get(path.resolve(file.file));
    return legacyName ? backup.documents[legacyName] : undefined;
}

async function writeFileAtomically(file: string, contents: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}
