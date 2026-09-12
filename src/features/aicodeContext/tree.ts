import * as vscode from 'vscode';
import { ContextService } from './contextService';

export type NodeKind = 'workspace' | 'group' | 'directory' | 'file' | 'error' | 'missingConfig';

export class ContextNode extends vscode.TreeItem {
    public constructor(
        public readonly kind: NodeKind,
        public readonly folder: vscode.WorkspaceFolder,
        label: string,
        public readonly relativePath?: string,
        state: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    ) {
        super(label, state);
        this.id = `${folder.uri.toString()}::${kind}::${relativePath ?? ''}`;
        this.contextValue = `aicode.${kind}`;
    }
}

export class AICodeTreeProvider implements vscode.TreeDataProvider<ContextNode> {
    private readonly emitter = new vscode.EventEmitter<ContextNode | undefined>();
    private expansionGeneration = 0;
    private expansionMode: 'normal' | 'expanded' | 'collapsed' = 'normal';
    public readonly onDidChangeTreeData = this.emitter.event;

    public constructor(private readonly service: ContextService) {
        service.onDidChange(() => this.refresh());
    }

    public refresh(): void {
        this.emitter.fire(undefined);
    }

    public resetToCollapsed(): void {
        this.expansionMode = 'collapsed';
        this.expansionGeneration += 1;
        this.refresh();
    }

    public resetToExpanded(): void {
        this.expansionMode = 'expanded';
        this.expansionGeneration += 1;
        this.refresh();
    }

    public getTreeItem(element: ContextNode): vscode.TreeItem {
        return element;
    }

    public getParent(element: ContextNode): ContextNode | undefined {
        if (element.kind === 'workspace') {
            return undefined;
        }
        if (element.kind === 'group' || element.kind === 'error' || element.kind === 'missingConfig') {
            return (vscode.workspace.workspaceFolders?.length ?? 0) > 1
                ? new ContextNode(
                      'workspace',
                      element.folder,
                      element.folder.name,
                      undefined,
                      vscode.TreeItemCollapsibleState.Expanded,
                  )
                : undefined;
        }
        const relativePath = element.relativePath ?? '';
        const slash = relativePath.lastIndexOf('/');
        if (slash < 0) {
            return new ContextNode('group', element.folder, '', undefined, vscode.TreeItemCollapsibleState.Expanded);
        }
        const parentPath = relativePath.slice(0, slash);
        return new ContextNode(
            'directory',
            element.folder,
            parentPath.split('/').at(-1) ?? parentPath,
            parentPath,
            vscode.TreeItemCollapsibleState.Collapsed,
        );
    }

    public async getChildren(element?: ContextNode): Promise<ContextNode[]> {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (element === undefined) {
            if (folders.length > 1) {
                return this.identify(
                    folders.map(
                        (folder) =>
                            new ContextNode(
                                'workspace',
                                folder,
                                folder.name,
                                undefined,
                                vscode.TreeItemCollapsibleState.Expanded,
                            ),
                    ),
                );
            }
            return folders[0] === undefined ? [] : this.identify(await this.workspaceChildren(folders[0]));
        }
        if (element.kind === 'workspace') return this.identify(await this.workspaceChildren(element.folder));
        if (element.kind === 'group') return this.identify(await this.pathChildren(element.folder, ''));
        if (element.kind === 'directory')
            return this.identify(await this.pathChildren(element.folder, element.relativePath ?? ''));
        return [];
    }

    private identify(nodes: ContextNode[]): ContextNode[] {
        for (const node of nodes) {
            node.id = `${node.id}::${this.expansionGeneration}`;
        }
        return nodes;
    }

    private async workspaceChildren(folder: vscode.WorkspaceFolder): Promise<ContextNode[]> {
        const result = await this.service.load(folder);
        if (result.kind === 'missing') {
            const node = new ContextNode('missingConfig', folder, 'No .aicode.json — open to create');
            node.command = { command: 'aicode.openConfig', title: 'Open Configuration', arguments: [node] };
            return [node];
        }
        if (result.kind === 'invalid') {
            const node = new ContextNode('error', folder, result.message);
            node.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'));
            node.command = { command: 'aicode.openConfig', title: 'Open Configuration', arguments: [node] };
            return [node];
        }
        const node = new ContextNode(
            'group',
            folder,
            result.config.activeGroup,
            undefined,
            this.expansionMode === 'collapsed' && (vscode.workspace.workspaceFolders?.length ?? 0) > 1
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.Expanded,
        );
        if (result.config.activeGroup === 'Default') {
            node.contextValue = 'aicode.group.default';
        }
        node.description = `${result.config.groups[result.config.activeGroup]?.length ?? 0} files`;
        node.iconPath = new vscode.ThemeIcon('list-tree');
        return [node];
    }

    private async pathChildren(folder: vscode.WorkspaceFolder, prefix: string): Promise<ContextNode[]> {
        const result = await this.service.load(folder);
        if (result.kind !== 'ok') return [];
        const entries = result.config.groups[result.config.activeGroup] ?? [];
        const directories = new Set<string>();
        const files: string[] = [];
        for (const entry of entries) {
            if (prefix !== '' && !entry.startsWith(`${prefix}/`)) continue;
            const rest = prefix === '' ? entry : entry.slice(prefix.length + 1);
            const slash = rest.indexOf('/');
            if (slash >= 0) directories.add(rest.slice(0, slash));
            else files.push(entry);
        }
        const directoryNodes = await Promise.all(
            [...directories].sort().map(async (name) => {
                const relativePath = prefix === '' ? name : `${prefix}/${name}`;
                const node = new ContextNode(
                    'directory',
                    folder,
                    name,
                    relativePath,
                    this.expansionMode === 'collapsed'
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.Expanded,
                );
                node.iconPath = vscode.ThemeIcon.Folder;
                const uri = vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
                if (await this.service.hasMissingFiles(folder, uri)) {
                    node.contextValue = 'aicode.directory.hasMissing';
                    node.description = '(*)';
                }
                return node;
            }),
        );
        const fileNodes = await Promise.all(
            files.sort().map(async (relativePath) => {
                const node = new ContextNode(
                    'file',
                    folder,
                    relativePath.split('/').at(-1) ?? relativePath,
                    relativePath,
                );
                node.resourceUri = vscode.Uri.joinPath(folder.uri, ...relativePath.split('/'));
                node.command = { command: 'aicode.openFile', title: 'Open', arguments: [node] };
                try {
                    await vscode.workspace.fs.stat(node.resourceUri);
                    node.iconPath = vscode.ThemeIcon.File;
                } catch {
                    node.description = '(missing)';
                    node.iconPath = new vscode.ThemeIcon(
                        'warning',
                        new vscode.ThemeColor('problemsErrorIcon.foreground'),
                    );
                }
                return node;
            }),
        );
        return [...directoryNodes, ...fileNodes];
    }
}
