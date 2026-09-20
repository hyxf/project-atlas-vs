import * as vscode from 'vscode';
import { RepositoryItem } from './model';
import { RepositoryStore } from './store';
import { parseRepositoryHost } from './repositoryUrl';

export type RepositoryViewMode = 'TAGS' | 'GROUPS' | 'HOSTS';

export class RepositoryTagNode extends vscode.TreeItem {
    constructor(readonly tag: string | undefined) {
        super(tag ?? 'untagged', vscode.TreeItemCollapsibleState.Expanded);
        this.id = `repository-tag:${tag ?? '__untagged__'}`;
        this.contextValue = 'repositoryTag';
        this.iconPath = new vscode.ThemeIcon('tag');
    }
}

export class RepositoryNode extends vscode.TreeItem {
    constructor(
        readonly repository: RepositoryItem,
        tag: string | undefined,
        nameOnly = false,
    ) {
        super(
            nameOnly ? repository.name : `${repository.group}/${repository.name}`,
            vscode.TreeItemCollapsibleState.None,
        );
        this.id = `repository:${tag ?? '__untagged__'}:${repository.url}`;
        if (repository.description !== undefined) {
            this.description = repository.description;
        }
        this.tooltip = [repository.url, repository.description, ...repository.tags].filter(Boolean).join('\n');
        this.contextValue = 'repository';
        this.iconPath = new vscode.ThemeIcon('repo');
    }
}

export class RepositoryGroupNode extends vscode.TreeItem {
    constructor(readonly group: string) {
        super(group, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `repository-group:${group}`;
        this.contextValue = 'repositoryGroup';
        this.iconPath = new vscode.ThemeIcon('organization');
    }
}

export class RepositoryHostNode extends vscode.TreeItem {
    constructor(readonly host: string) {
        super(host, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `repository-host:${host}`;
        this.contextValue = 'repositoryHost';
        this.iconPath = new vscode.ThemeIcon('globe');
    }
}

type RepositoryTreeNode = RepositoryTagNode | RepositoryGroupNode | RepositoryHostNode | RepositoryNode;

export class RepositoriesTree implements vscode.TreeDataProvider<RepositoryTreeNode> {
    private readonly changed = new vscode.EventEmitter<RepositoryTreeNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    constructor(
        private readonly store: RepositoryStore,
        private mode: RepositoryViewMode = 'TAGS',
    ) {}

    refresh(): void {
        this.changed.fire(undefined);
    }

    setMode(mode: RepositoryViewMode): void {
        this.mode = mode;
        this.refresh();
    }

    getTreeItem(element: RepositoryTreeNode): vscode.TreeItem {
        return element;
    }

    getParent(_element: RepositoryTreeNode): undefined {
        return undefined;
    }

    async getChildren(element?: RepositoryTreeNode): Promise<RepositoryTreeNode[]> {
        const repositories = await this.store.repositories();
        if (element instanceof RepositoryTagNode) {
            return repositories
                .filter((repository) =>
                    element.tag === undefined ? repository.tags.length === 0 : repository.tags.includes(element.tag),
                )
                .sort(compareRepositories)
                .map((repository) => new RepositoryNode(repository, element.tag));
        }
        if (element instanceof RepositoryGroupNode) {
            return repositories
                .filter((repository) => repository.group === element.group)
                .sort(compareRepositories)
                .map((repository) => new RepositoryNode(repository, `group:${element.group}`, true));
        }
        if (element instanceof RepositoryHostNode) {
            return repositories
                .filter((repository) => (parseRepositoryHost(repository.url) ?? 'unknown') === element.host)
                .sort(compareRepositories)
                .map((repository) => new RepositoryNode(repository, `host:${element.host}`));
        }
        if (element instanceof RepositoryNode) {
            return [];
        }
        if (this.mode === 'GROUPS') {
            return [...new Set(repositories.map((repository) => repository.group))]
                .sort(compare)
                .map((group) => new RepositoryGroupNode(group));
        }
        if (this.mode === 'HOSTS') {
            return [...new Set(repositories.map((repository) => parseRepositoryHost(repository.url) ?? 'unknown'))]
                .sort(compare)
                .map((host) => new RepositoryHostNode(host));
        }
        const tags = [...new Set(repositories.flatMap((repository) => repository.tags))].sort(compare);
        if (repositories.some((repository) => repository.tags.length === 0)) {
            return [...tags.map((tag) => new RepositoryTagNode(tag)), new RepositoryTagNode(undefined)];
        }
        return tags.map((tag) => new RepositoryTagNode(tag));
    }
}

function compareRepositories(left: RepositoryItem, right: RepositoryItem): number {
    return compare(`${left.group}/${left.name}`, `${right.group}/${right.name}`);
}

function compare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
}
