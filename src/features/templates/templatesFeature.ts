import { changeAiPrompt, AiPrompt } from '../aiPrompts/aiPromptStore';
import * as path from 'path';
import * as vscode from 'vscode';
import { commonCommandsFile, CommonCommand, readCommonCommandSnapshot } from '../commonCommands/commonCommandStore';
import { formatGitMessage, GitMessage, gitMessagesFile, readGitMessageSnapshot } from '../gitMessages/gitMessageStore';
import { reorderTemplates, TemplateSnapshot } from './templateStore';
import { assertSaved, registerTemplateCommands } from './templateCommands';

export class TemplateItem<T> extends vscode.TreeItem {
    readonly children: vscode.TreeItem[] = [];

    constructor(
        label: string,
        readonly snapshot: TemplateSnapshot<T>,
        readonly index: number,
        readonly file: string,
        kind: 'commonCommand' | 'gitMessage' | 'aiPrompt',
    ) {
        super(label);
        this.contextValue = kind;
    }
}

export class GitMessageTypeGroup extends vscode.TreeItem {
    readonly children: TemplateItem<GitMessage>[] = [];

    constructor(type: string, file: string) {
        super(type, vscode.TreeItemCollapsibleState.Expanded);
        this.id = JSON.stringify(['gitMessageType', file, type]);
        this.contextValue = 'gitMessageType';
        this.iconPath = new vscode.ThemeIcon('symbol-enum');
    }
}

export class CommonCommandTagGroup extends vscode.TreeItem {
    readonly children: TemplateItem<CommonCommand>[] = [];

    constructor(readonly tag: string) {
        super(tag || 'Untagged', vscode.TreeItemCollapsibleState.Expanded);
        this.id = JSON.stringify(['commonCommandTagGroup', tag]);
        this.contextValue = 'commonCommandTagGroup';
        this.iconPath = new vscode.ThemeIcon('tag');
    }
}

export class TemplatesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<void>();
    private readonly parents = new Map<vscode.TreeItem, vscode.TreeItem | undefined>();
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
            const children =
                element instanceof TemplateItem ||
                element instanceof GitMessageTypeGroup ||
                element instanceof CommonCommandTagGroup
                    ? element.children
                    : [];
            for (const child of children) {
                this.parents.set(child, element);
            }
            return children;
        }
        try {
            const children = await this.loadItems();
            this.parents.clear();
            return children;
        } catch (error) {
            const item = new vscode.TreeItem('Unable to load templates');
            item.description = error instanceof Error ? error.message : String(error);
            item.tooltip = item.description;
            item.iconPath = new vscode.ThemeIcon('warning');
            return [item];
        }
    }

    getParent(element: vscode.TreeItem): vscode.TreeItem | undefined {
        return this.parents.get(element);
    }

    dispose(): void {
        this.changed.dispose();
    }
}

export async function expandTreeView(
    view: vscode.TreeView<vscode.TreeItem>,
    provider: vscode.TreeDataProvider<vscode.TreeItem>,
): Promise<void> {
    const expand = async (item: vscode.TreeItem): Promise<void> => {
        const children = await provider.getChildren(item);
        if (!children?.length) {
            return;
        }
        await view.reveal(item, { select: false, focus: false, expand: true });
        for (const child of children) {
            await expand(child);
        }
    };
    for (const item of (await provider.getChildren()) ?? []) {
        await expand(item);
    }
}

export async function loadCommonCommandItems(file = commonCommandsFile): Promise<vscode.TreeItem[]> {
    const snapshot = await readCommonCommandSnapshot(file);
    const groups = new Map<string, CommonCommandTagGroup>();
    for (const [index, command] of snapshot.entries.entries()) {
        const tags = [...new Set(command.tags ?? [])];
        for (const tag of tags.length ? tags : ['']) {
            let group = groups.get(tag);
            if (!group) {
                group = new CommonCommandTagGroup(tag);
                groups.set(tag, group);
            }
            group.children.push(createCommonCommandItem(command, snapshot, index, file, tag));
            group.description = String(group.children.length);
        }
    }
    const untagged = groups.get('');
    groups.delete('');
    return [...groups.values(), ...(untagged ? [untagged] : [])];
}

function createCommonCommandItem(
    command: CommonCommand,
    snapshot: TemplateSnapshot<CommonCommand>,
    index: number,
    file: string,
    tag: string,
): TemplateItem<CommonCommand> {
    const item = new TemplateItem<CommonCommand>(command.command, snapshot, index, file, 'commonCommand');
    item.id = JSON.stringify(['commonCommand', tag, index]);
    item.description = command.description ? `· ${command.description}` : '';
    item.tooltip = [command.command, (command.tags ?? []).join(', ') || 'Untagged', command.description]
        .filter(Boolean)
        .join('\n\n');
    item.iconPath = new vscode.ThemeIcon('terminal');
    return item;
}

export type GitMessageViewMode = 'LIST' | 'GROUP';

export async function loadGitMessageItems(
    file = gitMessagesFile,
    mode: GitMessageViewMode = 'GROUP',
): Promise<vscode.TreeItem[]> {
    const snapshot = await readGitMessageSnapshot(file);
    const groups = new Map<string, GitMessageTypeGroup>();
    const items: TemplateItem<GitMessage>[] = [];
    for (const [index, message] of snapshot.entries.entries()) {
        let group = groups.get(message.type);
        if (!group) {
            group = new GitMessageTypeGroup(message.type, file);
            groups.set(message.type, group);
        }
        const item = new TemplateItem<GitMessage>(formatGitMessage(message), snapshot, index, file, 'gitMessage');
        item.tooltip = formatGitMessage(message);
        item.iconPath = new vscode.ThemeIcon('git-commit');
        group.children.push(item);
        items.push(item);
    }
    return mode === 'LIST' ? items : [...groups.values()];
}

export class TemplateDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    readonly dragMimeTypes: readonly string[];
    readonly dropMimeTypes: readonly string[];
    private readonly mime: string;

    constructor(
        id: string,
        private readonly file: string,
        private readonly refresh: () => void,
        private readonly canSort: () => boolean = () => true,
    ) {
        this.mime = `application/vnd.code.tree.${id.toLowerCase()}`;
        this.dragMimeTypes = [this.mime];
        this.dropMimeTypes = [this.mime];
    }

    handleDrag(
        source: readonly vscode.TreeItem[],
        transfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): void {
        if (
            this.canSort() &&
            !token.isCancellationRequested &&
            source.length === 1 &&
            source[0] instanceof TemplateItem
        ) {
            transfer.set(this.mime, new vscode.DataTransferItem(source[0]));
        }
    }

    async handleDrop(
        target: vscode.TreeItem | undefined,
        transfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const source: unknown = transfer.get(this.mime)?.value;
        if (
            !this.canSort() ||
            token.isCancellationRequested ||
            !(source instanceof TemplateItem) ||
            source.file !== this.file
        ) {
            return;
        }
        const isMessage = source.contextValue === 'gitMessage';
        if (!isMessage && source.contextValue !== 'commonCommand' && source.contextValue !== 'aiPrompt') {
            return;
        }
        const snapshot: TemplateSnapshot<CommonCommand | GitMessage | AiPrompt> = source.snapshot;
        const entry = snapshot.entries[source.index];
        if (!entry) {
            return;
        }
        let before: number | undefined;
        if (target instanceof TemplateItem) {
            if (
                target.file !== this.file ||
                target.contextValue !== source.contextValue ||
                target.snapshot.contents !== snapshot.contents
            ) {
                return;
            }
            before = target.index;
        } else if (target !== undefined) {
            return;
        }
        const order = snapshot.entries.map((_, index) => index).filter((index) => index !== source.index);
        if (before === source.index) {
            return;
        }
        order.splice(before === undefined ? order.length : order.indexOf(before), 0, source.index);
        if (order.every((value, index) => value === index)) {
            return;
        }
        try {
            assertSaved(this.file);
            if (source.contextValue === 'aiPrompt') {
                await changeAiPrompt(source.snapshot, { type: 'reorder', order }, this.file);
            } else {
                await reorderTemplates(this.file, isMessage ? 'messages' : 'commands', snapshot, order);
            }
            this.refresh();
        } catch (error) {
            this.refresh();
            await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
        }
    }
}

export function activateTemplates(context: vscode.ExtensionContext): void {
    registerTemplateCommands(context);
    const commonCommandsRegistration = registerView(
        context,
        'projectAtlas.commonCommands',
        commonCommandsFile,
        loadCommonCommandItems,
        'project-atlas.refreshCommonCommands',
    );
    let mode: GitMessageViewMode =
        context.globalState.get('projectAtlas.gitMessageViewMode') === 'LIST' ? 'LIST' : 'GROUP';
    void vscode.commands.executeCommand('setContext', 'projectAtlas.gitMessageViewMode', mode);
    const gitMessagesRegistration = registerView(
        context,
        'projectAtlas.gitMessages',
        gitMessagesFile,
        () => loadGitMessageItems(gitMessagesFile, mode),
        'project-atlas.refreshGitMessages',
        () => mode === 'LIST',
    );
    for (const [viewName, viewId, registration] of [
        ['commonCommands', 'projectAtlas.commonCommands', commonCommandsRegistration],
        ['gitMessages', 'projectAtlas.gitMessages', gitMessagesRegistration],
    ] as const) {
        const setCollapsed = (collapsed: boolean) =>
            vscode.commands.executeCommand('setContext', `projectAtlas.${viewName}Collapsed`, collapsed);
        context.subscriptions.push(
            vscode.commands.registerCommand(
                `project-atlas.collapse${viewName[0]!.toUpperCase()}${viewName.slice(1)}`,
                async () => {
                    await vscode.commands.executeCommand(`${viewId}.focus`);
                    await vscode.commands.executeCommand(`workbench.actions.treeView.${viewId}.collapseAll`);
                    await setCollapsed(true);
                },
            ),
            vscode.commands.registerCommand(
                `project-atlas.expand${viewName[0]!.toUpperCase()}${viewName.slice(1)}`,
                async () => {
                    await vscode.commands.executeCommand(`${viewId}.focus`);
                    await registration.expandAll();
                    await setCollapsed(false);
                },
            ),
        );
        void setCollapsed(false);
    }
    let switching = Promise.resolve();
    for (const [command, nextMode] of [
        ['project-atlas.gitMessagesListView', 'LIST'],
        ['project-atlas.gitMessagesGroupView', 'GROUP'],
    ] as const) {
        context.subscriptions.push(
            vscode.commands.registerCommand(command, () => {
                const next = switching
                    .catch(() => undefined)
                    .then(async () => {
                        if (mode === nextMode) {
                            return;
                        }
                        mode = nextMode;
                        await gitMessagesRegistration.recreate();
                        await vscode.commands.executeCommand('setContext', 'projectAtlas.gitMessageViewMode', mode);
                        await context.globalState.update('projectAtlas.gitMessageViewMode', mode);
                    });
                switching = next;
                return next;
            }),
        );
    }
}

function registerView(
    context: vscode.ExtensionContext,
    id: string,
    file: string,
    loadItems: () => Promise<vscode.TreeItem[]>,
    refreshCommand: string,
    canSort: () => boolean = () => true,
): TemplateViewRegistration {
    const provider = new TemplatesTreeProvider(loadItems);
    const registration = new TemplateViewRegistration(id, file, provider, canSort);
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
    );
    context.subscriptions.push(
        provider,
        registration,
        watcher,
        watcher.onDidCreate(() => provider.refresh()),
        watcher.onDidChange(() => provider.refresh()),
        watcher.onDidDelete(() => provider.refresh()),
        vscode.commands.registerCommand(refreshCommand, () => provider.refresh()),
    );
    return registration;
}

/** Re-register the view because VS Code captures DnD capabilities at creation time. */
export class TemplateViewRegistration implements vscode.Disposable {
    private view: vscode.TreeView<vscode.TreeItem> | undefined;
    private visibility: vscode.Disposable | undefined;
    private disposed = false;

    constructor(
        private readonly id: string,
        private readonly file: string,
        private readonly provider: TemplatesTreeProvider,
        private readonly canSort: () => boolean,
        private readonly createView: typeof vscode.window.createTreeView = vscode.window.createTreeView,
    ) {
        this.create();
    }

    private create(): void {
        this.view = this.createView(this.id, {
            treeDataProvider: this.provider,
            ...(this.canSort()
                ? {
                      dragAndDropController: new TemplateDragAndDropController(
                          this.id,
                          this.file,
                          () => this.provider.refresh(),
                          () => !this.disposed && this.canSort(),
                      ),
                  }
                : {}),
        });
        this.view.description = path.basename(this.file);
        this.visibility = this.view.onDidChangeVisibility(({ visible }) => {
            if (visible) {
                this.provider.refresh();
            }
        });
    }

    async recreate(): Promise<void> {
        this.visibility?.dispose();
        const previous = this.view;
        this.view = undefined;
        await previous?.dispose();
        if (!this.disposed) {
            this.create();
        }
    }

    async expandAll(): Promise<void> {
        if (this.view) {
            await expandTreeView(this.view, this.provider);
        }
    }

    dispose(): void {
        this.disposed = true;
        this.visibility?.dispose();
        this.view?.dispose();
        this.view = undefined;
    }
}
