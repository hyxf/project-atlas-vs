import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { aiPromptsFile, ensureAiPromptsFile } from '../aiPrompts/aiPromptStore';
import { commonCommandsFile, ensureCommonCommandsFile } from '../commonCommands/commonCommandStore';
import { gitMessagesFile, ensureGitMessagesFile } from '../gitMessages/gitMessageStore';

export const templateBackupKey = 'projectAtlas.templateBackup.v1';
const templateBackupBusyContext = 'projectAtlas.templateBackupBusy';
const templateBackupSignedInContext = 'projectAtlas.templateBackupSignedIn';
const templateBackupAvailableContext = 'projectAtlas.templateBackupAvailable';

const templateBackupFiles = [
    { name: 'aiprompts.json', file: aiPromptsFile },
    { name: 'commoncmd.json', file: commonCommandsFile },
    { name: 'gitmessage.json', file: gitMessagesFile },
] as const;

interface TemplateBackupDocument {
    contents: string;
}

export interface TemplateBackup {
    schemaVersion: 1;
    createdAt: string;
    documents: Record<(typeof templateBackupFiles)[number]['name'], TemplateBackupDocument>;
}

export interface TemplateBackupStorage {
    get<T>(section: string): T | undefined;
    update(section: string, value: unknown): Thenable<void>;
    setKeysForSync(keys: readonly string[]): void;
}

export class TemplateBackupItem extends vscode.TreeItem {
    readonly children: vscode.TreeItem[];

    constructor(backup: TemplateBackup | undefined) {
        super('VS Code Settings Sync', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'templateBackup';
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.tooltip = 'Back up or restore AI Prompts, Common Commands, and Git Messages using VS Code Settings Sync.';
        this.description = backup ? `Backup: ${new Date(backup.createdAt).toLocaleString()}` : 'No backup yet';
        this.children = templateBackupFiles.map(({ name }) => {
            const item = new vscode.TreeItem(name);
            const contents = backup?.documents[name].contents;
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
        private readonly files: readonly {
            name: (typeof templateBackupFiles)[number]['name'];
            file: string;
        }[] = templateBackupFiles,
        private readonly ensureFiles: () => Promise<void> = ensureTemplateFiles,
    ) {}

    enableSync(): void {
        this.storage.setKeysForSync([templateBackupKey]);
    }

    getBackup(): TemplateBackup | undefined {
        const value = this.storage.get<unknown>(templateBackupKey);
        return isTemplateBackup(value) ? value : undefined;
    }

    async backup(): Promise<TemplateBackup> {
        await this.ensureFiles();
        assertFilesSaved(this.files.map(({ file }) => file));
        const documents = {} as TemplateBackup['documents'];
        for (const { name, file } of this.files) {
            documents[name] = { contents: await fs.readFile(file, 'utf8') };
        }
        const backup: TemplateBackup = { schemaVersion: 1, createdAt: new Date().toISOString(), documents };
        await this.storage.update(templateBackupKey, backup);
        return backup;
    }

    async restore(): Promise<TemplateBackup> {
        assertFilesSaved(this.files.map(({ file }) => file));
        const backup = this.getBackup();
        if (!backup) {
            throw new Error('No valid template backup is available in VS Code Settings Sync.');
        }
        for (const { name, file } of this.files) {
            await writeFileAtomically(file, backup.documents[name].contents);
        }
        return backup;
    }

    async deleteBackup(): Promise<void> {
        await this.storage.update(templateBackupKey, undefined);
    }
}

export function activateTemplateBackup(context: vscode.ExtensionContext): void {
    const service = new TemplateBackupService(context.globalState);
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
            return [new TemplateBackupItem(service.getBackup())];
        },
    };
    const refresh = () => changed.fire();
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
            'Restore AI Prompts, Common Commands, and Git Messages from the VS Code Settings Sync backup?',
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
        for (const command of [
            'project-atlas.refreshAiPrompts',
            'project-atlas.refreshCommonCommands',
            'project-atlas.refreshGitMessages',
        ]) {
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

async function ensureTemplateFiles(): Promise<void> {
    await Promise.all([ensureAiPromptsFile(), ensureCommonCommandsFile(), ensureGitMessagesFile()]);
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
        templateBackupFiles.every(({ name }) => typeof backup.documents?.[name]?.contents === 'string')
    );
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
