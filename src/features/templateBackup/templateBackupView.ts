import * as vscode from 'vscode';
import { getBackupDocument } from './templateBackupService';
import { TemplateBackup, TemplateBackupFile } from './templateBackupTypes';

export class TemplateBackupItem extends vscode.TreeItem {
    readonly children: vscode.TreeItem[];

    constructor(backup: TemplateBackup | undefined, files: readonly TemplateBackupFile[]) {
        super('VS Code Settings Sync', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'templateBackup';
        this.iconPath = new vscode.ThemeIcon('cloud');
        this.tooltip = 'Back up or restore the configured files using VS Code Settings Sync.';
        this.description = backup ? `Backup: ${new Date(backup.createdAt).toLocaleString()}` : 'No backup yet';
        this.children = files.map((file) => new TemplateBackupFileItem(file, backup));
    }
}

export class TemplateBackupFileItem extends vscode.TreeItem {
    constructor(
        readonly file: TemplateBackupFile,
        backup: TemplateBackup | undefined,
    ) {
        super(file.name);
        const contents = backup && getBackupDocument(backup, file)?.contents;
        this.contextValue = 'templateBackupFile';
        this.description = contents === undefined ? 'Not backed up' : formatSize(Buffer.byteLength(contents, 'utf8'));
        this.iconPath = new vscode.ThemeIcon(contents === undefined ? 'circle-outline' : 'check');
        this.tooltip = file.file;
    }
}

export class TemplateBackupSignInItem extends vscode.TreeItem {
    constructor() {
        super('Sign in to enable template backup');
        this.description = 'VS Code Settings Sync requires a GitHub or Microsoft account';
        this.tooltip = 'Sign in, then enable VS Code Settings Sync to back up and restore templates across devices.';
        this.iconPath = new vscode.ThemeIcon('account');
        this.command = { command: 'project-atlas.signInForTemplateBackup', title: 'Sign In for Template Backup' };
    }
}

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
