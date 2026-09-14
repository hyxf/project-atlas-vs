import * as path from 'path';
import * as vscode from 'vscode';
import { commonCommandsFile, CommonCommand, readCommonCommandSnapshot } from '../commonCommands/commonCommandStore';
import { formatGitMessage, GitMessage, gitMessagesFile, readGitMessageSnapshot } from '../gitMessages/gitMessageStore';
import { TemplateSnapshot } from './templateStore';
import { registerTemplateCommands } from './templateCommands';

export class TemplateItem<T> extends vscode.TreeItem {
    readonly children: vscode.TreeItem[] = [];

    constructor(
        label: string,
        readonly snapshot: TemplateSnapshot<T>,
        readonly index: number,
        readonly file: string,
        kind: 'commonCommand' | 'gitMessage',
    ) {
        super(label);
        this.contextValue = kind;
    }
}

export class TemplatesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.changed.event;

    constructor(private readonly loadItems: () => Promise<vscode.TreeItem[]>) {}

    refresh(): void {
        this.changed.fire();
    }

    getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
        return item;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (element) {
            return element instanceof TemplateItem ? element.children : [];
        }
        try {
            return await this.loadItems();
        } catch (error) {
            const item = new vscode.TreeItem('Unable to load templates');
            item.description = error instanceof Error ? error.message : String(error);
            item.tooltip = item.description;
            item.iconPath = new vscode.ThemeIcon('warning');
            return [item];
        }
    }

    dispose(): void {
        this.changed.dispose();
    }
}

export async function loadCommonCommandItems(file = commonCommandsFile): Promise<vscode.TreeItem[]> {
    const snapshot = await readCommonCommandSnapshot(file);
    return snapshot.entries.map((command, index) => {
        const item = new TemplateItem<CommonCommand>(command.command, snapshot, index, file, 'commonCommand');
        if (command.description) {
            item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
            for (const line of command.description.split(/\r?\n/)) {
                const description = new vscode.TreeItem(line || ' ');
                description.tooltip = command.description;
                item.children.push(description);
            }
        }
        item.tooltip = [command.command, command.description].filter(Boolean).join('\n\n');
        item.iconPath = new vscode.ThemeIcon('terminal');
        return item;
    });
}

export async function loadGitMessageItems(file = gitMessagesFile): Promise<vscode.TreeItem[]> {
    const snapshot = await readGitMessageSnapshot(file);
    return snapshot.entries.map((message, index) => {
        const item = new TemplateItem<GitMessage>(formatGitMessage(message), snapshot, index, file, 'gitMessage');
        item.tooltip = formatGitMessage(message);
        item.iconPath = new vscode.ThemeIcon('git-commit');
        return item;
    });
}

export function activateTemplates(context: vscode.ExtensionContext): void {
    registerTemplateCommands(context);
    registerView(
        context,
        'projectAtlas.commonCommands',
        commonCommandsFile,
        loadCommonCommandItems,
        'project-atlas.refreshCommonCommands',
    );
    registerView(
        context,
        'projectAtlas.gitMessages',
        gitMessagesFile,
        loadGitMessageItems,
        'project-atlas.refreshGitMessages',
    );
}

function registerView(
    context: vscode.ExtensionContext,
    id: string,
    file: string,
    loadItems: () => Promise<vscode.TreeItem[]>,
    refreshCommand: string,
): void {
    const provider = new TemplatesTreeProvider(loadItems);
    const view = vscode.window.createTreeView(id, { treeDataProvider: provider });
    view.description = path.basename(file);
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
    );
    context.subscriptions.push(
        provider,
        view,
        watcher,
        watcher.onDidCreate(() => provider.refresh()),
        watcher.onDidChange(() => provider.refresh()),
        watcher.onDidDelete(() => provider.refresh()),
        view.onDidChangeVisibility(({ visible }) => {
            if (visible) {
                provider.refresh();
            }
        }),
        vscode.commands.registerCommand(refreshCommand, () => provider.refresh()),
    );
}
