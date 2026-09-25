import * as vscode from 'vscode';
import {
    getConfiguredTemplateBackupFiles,
    getTemplateRefreshCommands,
    TemplateBackupService,
} from './templateBackupService';
import { TemplateBackupFileItem, TemplateBackupItem, TemplateBackupSignInItem } from './templateBackupView';

export { getConfiguredTemplateBackupFiles, TemplateBackupService } from './templateBackupService';
export { templateBackupKey } from './templateBackupTypes';
export type { TemplateBackupStorage } from './templateBackupTypes';

const templateBackupBusyContext = 'projectAtlas.templateBackupBusy';
const templateBackupSignedInContext = 'projectAtlas.templateBackupSignedIn';
const templateBackupAvailableContext = 'projectAtlas.templateBackupAvailable';

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
    const setSignedIn = (value: boolean) =>
        vscode.commands.executeCommand('setContext', templateBackupSignedInContext, value);
    const updateSignedInState = async (): Promise<boolean> => {
        const signedIn = await hasSettingsSyncAccount();
        await setSignedIn(signedIn);
        return signedIn;
    };
    const updateBackupState = () =>
        vscode.commands.executeCommand('setContext', templateBackupAvailableContext, service.getBackup() !== undefined);
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
        vscode.commands.registerCommand('project-atlas.editTemplateBackupFile', async (item: unknown) => {
            if (!(item instanceof TemplateBackupFileItem)) {
                return;
            }
            await vscode.window.showTextDocument(
                await vscode.workspace.openTextDocument(vscode.Uri.file(item.file.file)),
            );
        }),
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
