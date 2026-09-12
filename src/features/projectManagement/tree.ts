import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { ProjectItem, untaggedFilter } from './model';
import { normalizePath, ProjectService } from './service';

export class ProjectNode extends vscode.TreeItem {
    constructor(
        readonly project: ProjectItem,
        id = project.id,
    ) {
        super(project.name, vscode.TreeItemCollapsibleState.None);
        this.id = id;
        this.tooltip = `${project.name}\n${project.path}${project.tags.length ? `\n${project.tags.join(' · ')}` : ''}`;
        this.resourceUri = vscode.Uri.from({ scheme: 'project-atlas', path: `/${project.id}`, query: project.path });
        this.contextValue = 'project';
        this.command = { command: 'project-atlas.openOnDoubleClick', title: 'Open Project', arguments: [this] };
        this.iconPath = new vscode.ThemeIcon(project.favorite ? 'star-full' : 'folder');
    }
}

export class ProjectDecorationProvider implements vscode.FileDecorationProvider {
    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== 'project-atlas') {
            return undefined;
        }
        const current = vscode.workspace.workspaceFolders?.some(
            (folder) => normalizePath(folder.uri.fsPath) === normalizePath(uri.query),
        );
        return current ? { badge: '✓', tooltip: 'Current workspace' } : undefined;
    }
}

class TagNode extends vscode.TreeItem {
    constructor(readonly tag: string | undefined) {
        super(tag ?? 'Untagged', vscode.TreeItemCollapsibleState.Expanded);
        this.id = `tag:${tag ?? untaggedFilter}`;
        this.contextValue = 'tag';
        this.iconPath = new vscode.ThemeIcon('tag');
    }
}

export class ProjectsTree implements vscode.TreeDataProvider<ProjectNode | TagNode> {
    private readonly changed = new vscode.EventEmitter<ProjectNode | TagNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;
    private selectedTagFilters: string[] = [];
    constructor(private readonly service: ProjectService) {}
    refresh(): void {
        this.changed.fire(undefined);
    }
    setTagFilters(filters: readonly string[]): void {
        this.selectedTagFilters = [...filters];
        this.refresh();
    }
    getTreeItem(element: ProjectNode | TagNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: ProjectNode | TagNode): Promise<Array<ProjectNode | TagNode>> {
        const settings = await this.service.store.settings();
        let projects = await this.service.projects();
        if (this.selectedTagFilters.length) {
            projects = projects.filter((item) =>
                this.selectedTagFilters.some((tag) =>
                    tag === untaggedFilter ? item.tags.length === 0 : item.tags.includes(tag),
                ),
            );
        }
        if (settings.selectedListFilter === 'FAVORITES') {
            projects = projects.filter((item) => item.favorite);
        }
        if (settings.selectedListFilter === 'RECENT') {
            projects = projects.filter((item) => item.lastOpenedAt !== null && item.lastOpenedAt !== undefined);
        }
        projects = this.service.sort(projects, settings.selectedListFilter === 'RECENT' ? 'RECENT' : settings.sortBy);
        if (element instanceof TagNode) {
            return Promise.all(
                projects
                    .filter((project) =>
                        element.tag === undefined ? project.tags.length === 0 : project.tags.includes(element.tag),
                    )
                    .map((project) => this.node(project, element.id)),
            );
        }
        if (settings.selectedView === 'TAGS') {
            const tags = [...new Set(projects.flatMap((project) => project.tags))].sort((a, b) => a.localeCompare(b));
            const nodes = tags.map((tag) => new TagNode(tag));
            if (projects.some((project) => project.tags.length === 0)) {
                nodes.push(new TagNode(undefined));
            }
            return nodes;
        }
        return Promise.all(projects.map((project) => this.node(project)));
    }

    private async node(project: ProjectItem, parentId?: string): Promise<ProjectNode> {
        const node = new ProjectNode(project, parentId ? `${parentId}:${project.id}` : project.id);
        const exists = await fs.stat(project.path).then(
            (stat) => stat.isDirectory(),
            () => false,
        );
        if (!exists) {
            node.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
        }
        return node;
    }
}

export class ProjectDropController implements vscode.TreeDragAndDropController<ProjectNode | TagNode> {
    readonly dragMimeTypes: readonly string[] = [];
    readonly dropMimeTypes: readonly string[] = ['text/uri-list', 'files'];

    constructor(
        private readonly accept: (uris: readonly vscode.Uri[], token: vscode.CancellationToken) => Promise<void>,
    ) {}

    async handleDrop(
        _target: ProjectNode | TagNode | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const uris: vscode.Uri[] = [];
        const uriList = dataTransfer.get('text/uri-list');
        if (uriList) {
            uris.push(...parseUriList(await uriList.asString()));
        }
        for (const [, item] of dataTransfer) {
            const file = item.asFile();
            if (file?.uri) {
                uris.push(file.uri);
            }
        }
        if (token.isCancellationRequested) {
            return;
        }
        const unique = [...new Map(uris.map((uri) => [uri.toString(), uri])).values()];
        if (unique.length) {
            await this.accept(unique, token);
        }
    }
}

export function parseUriList(value: string): vscode.Uri[] {
    return value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .flatMap((line) => {
            try {
                return [vscode.Uri.parse(line, true)];
            } catch {
                return [];
            }
        });
}
