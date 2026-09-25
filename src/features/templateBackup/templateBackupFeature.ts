import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { aiPromptsFile } from '../aiPrompts/aiPromptStore';
import { commonCommandsFile } from '../commonCommands/commonCommandStore';
import { gitMessagesFile } from '../gitMessages/gitMessageStore';

export const templateBackupKey = 'projectAtlas.templateBackup.v1';
const templateBackupBusyContext = 'projectAtlas.templateBackupBusy';
const templateBackupSignedInContext = 'projectAtlas.templateBackupSignedIn';
const templateBackupAvailableContext = 'projectAtlas.templateBackupAvailable';

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

export interface TemplateBackupFile {
    key: string;
    name: string;
    file: string;
}

interface TemplateBackupDocument {
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

export class TemplateBackupItem extends vscode.TreeItem {
    readonly children: vscode.TreeItem[];

    constructor(backup: TemplateBackup | undefined, files: readonly TemplateBackupFile[]) {
        super('VS Code Settings Sync', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'templateBackup';
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.tooltip = 'Back up or restore the configured files using VS Code Settings Sync.';
        this.description = backup ? `Backup: ${new Date(backup.createdAt).toLocaleString()}` : 'No backup yet';
        this.children = files.map(({ key, name, file }) => {
            const item = new vscode.TreeItem(name);
            const contents = backup && getBackupDocument(backup, { key, name, file })?.contents;
            item.description =
                contents === undefined ? 'Not backed up' : formatSize(Buffer.byteLength(contents, 'utf8'));
            item.iconPath = new vscode.ThemeIcon(contents === undefined ? 'circle-outline' : 'check');
            return item;
        });
    }
}

class TemplateBackupSignInItem extends vscode.TreeItem {
    constructor() {
        super('Sign in to enable template backup');
        this.description = 'VS Code Settings Sync requires a GitHub or Microsoft account';
        this.tooltip = 'Sign in, then enable VS Code Settings Sync to back up and restore templates across devices.';
        this.iconPath = new vscode.ThemeIcon('account');
        this.command = { command: 'project-atlas.signInForTemplateBackup', title: 'Sign In for Template Backup' };
    }
}

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

export function activateTemplateBackup(context: vscode.ExtensionContext): void {
    let files = getConfiguredTemplateBackupFiles();
    let service = new TemplateBackupService(context.globalState, files);
    service.enableSync();
    const changed = new vscode.EventEmitter<void>();
    const provider: vscode.TreeDataProvider<vscode.TreeItem> = {
        onDidChangeTreeData: changed.event,
        getTreeItem: (item) => item,
        getChildren: async (item) => {
            if (item instanceof TemplateBackupItem) {
                return item.children;
            }
            if (!(await updateSignedInState())) {
                return [new TemplateBackupSignInItem()];
            }
            await updateBackupState();
            return [new TemplateBackupItem(service.getBackup(), files)];
        },
    };
    const refresh = () => changed.fire();
    const reloadConfiguredFiles = () => {
        try {
            files = getConfiguredTemplateBackupFiles();
            service = new TemplateBackupService(context.globalState, files);
            service.enableSync();
            void updateBackupState();
            refresh();
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    };
    const setSignedIn = (value: boolean) =>
        vscode.commands.executeCommand('setContext', templateBackupSignedInContext, value);
    const updateSignedInState = async (): Promise<boolean> => {
        const signedIn = await hasSettingsSyncAccount();
        await setSignedIn(signedIn);
        return signedIn;
    };
    const updateBackupState = () =>
        vscode.commands.executeCommand('setContext', templateBackupAvailableContext, service.getBackup() !== undefined);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    let statusTimeout: NodeJS.Timeout | undefined;
    const showStatus = (icon: string, message: string, hideAfter?: number) => {
        if (statusTimeout) {
            clearTimeout(statusTimeout);
        }
        status.text = `$(${icon}) Project Atlas: ${message}`;
        status.tooltip = status.text;
        status.show();
        if (hideAfter !== undefined) {
            statusTimeout = setTimeout(() => status.hide(), hideAfter);
        }
    };
    let busy = false;
    const setBusy = (value: boolean) => vscode.commands.executeCommand('setContext', templateBackupBusyContext, value);
    const runInBackground = (title: string, operation: () => Promise<void>) => {
        if (busy) {
            return;
        }
        busy = true;
        void setBusy(true);
        showStatus('sync~spin', title);
        void (async () => {
            try {
                if (!(await updateSignedInState())) {
                    throw new Error(
                        'Sign in to GitHub or Microsoft and enable VS Code Settings Sync before using template backup.',
                    );
                }
                await operation();
                showStatus('check', `${title} complete`, 3000);
            } catch (error) {
                showStatus('error', error instanceof Error ? error.message : String(error), 5000);
            } finally {
                busy = false;
                await setBusy(false);
                await updateBackupState();
                refresh();
            }
        })();
    };
    const register = (name: string, title: string, handler: () => Promise<void>) =>
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, () => runInBackground(title, handler)),
        );

    register('backupTemplateData', 'Backing up Project Atlas templates', async () => {
        await service.backup();
    });
    register('restoreTemplateData', 'Restoring Project Atlas templates', async () => {
        const backup = service.getBackup();
        if (!backup) {
            throw new Error('No valid template backup is available in VS Code Settings Sync.');
        }
        const confirmed = await vscode.window.showWarningMessage(
            'Restore the configured files from the VS Code Settings Sync backup?',
            {
                modal: true,
                detail: `The local files will be replaced with the backup from ${new Date(backup.createdAt).toLocaleString()}.`,
            },
            'Restore',
        );
        if (confirmed !== 'Restore') {
            return;
        }
        await service.restore();
        for (const command of getTemplateRefreshCommands(files)) {
            await vscode.commands.executeCommand(command);
        }
    });
    register('deleteTemplateBackup', 'Deleting Project Atlas template backup', async () => {
        if (!service.getBackup()) {
            throw new Error('No valid template backup is available in VS Code Settings Sync.');
        }
        const confirmed = await vscode.window.showWarningMessage(
            'Delete the template backup from VS Code Settings Sync?',
            {
                modal: true,
                detail: 'The deletion will be synchronized to VS Code Settings Sync and other devices after the next native sync.',
            },
            'Delete Backup',
        );
        if (confirmed !== 'Delete Backup') {
            return;
        }
        await service.deleteBackup();
    });
    register('refreshTemplateBackup', 'Refreshing Project Atlas template backup', async () => {
        await Promise.resolve();
    });
    context.subscriptions.push(
        status,
        vscode.commands.registerCommand('project-atlas.signInForTemplateBackup', () => {
            if (busy) {
                return;
            }
            busy = true;
            void setBusy(true);
            void (async () => {
                try {
                    const provider = await vscode.window.showQuickPick(
                        [
                            { label: 'GitHub', providerId: 'github' },
                            { label: 'Microsoft', providerId: 'microsoft' },
                        ],
                        { placeHolder: 'Choose the account to use with VS Code Settings Sync' },
                    );
                    if (!provider) {
                        return;
                    }
                    await vscode.authentication.getSession(provider.providerId, [], { createIfNone: true });
                    if (!(await updateSignedInState())) {
                        throw new Error('Sign-in did not create an available account session.');
                    }
                    void vscode.window.showInformationMessage(
                        'Project Atlas: Signed in. Enable VS Code Settings Sync to synchronize template backups across devices.',
                    );
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
                    );
                } finally {
                    busy = false;
                    await setBusy(false);
                    refresh();
                }
            })();
        }),
        vscode.authentication.onDidChangeSessions(() => refresh()),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('projectAtlas.templateBackup.files')) {
                reloadConfiguredFiles();
            }
        }),
    );
    void setBusy(false);
    void updateSignedInState();
    void updateBackupState();
    context.subscriptions.push(
        changed,
        vscode.window.registerTreeDataProvider('projectAtlas.templateBackup', provider),
    );
}

async function hasSettingsSyncAccount(): Promise<boolean> {
    const accounts = await Promise.all(
        ['github', 'microsoft'].map(async (providerId) => {
            try {
                return await vscode.authentication.getAccounts(providerId);
            } catch {
                return [];
            }
        }),
    );
    return accounts.some((providerAccounts) => providerAccounts.length > 0);
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

function getBackupDocument(backup: TemplateBackup, file: TemplateBackupFile): TemplateBackupDocument | undefined {
    return backup.documents[file.key] ?? getLegacyBackupDocument(backup, file);
}

function getLegacyBackupDocument(backup: TemplateBackup, file: TemplateBackupFile): TemplateBackupDocument | undefined {
    const legacyName = legacyTemplateBackupNames.get(path.resolve(file.file));
    return legacyName ? backup.documents[legacyName] : undefined;
}

function getTemplateRefreshCommands(files: readonly TemplateBackupFile[]): string[] {
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

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
