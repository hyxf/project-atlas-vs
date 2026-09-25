import * as vscode from 'vscode';
import { favoriteTags, npmPackageTooltip, readFavorites, readInstalled, readTrash } from './npmPackagesStore';
import { DependencyKind, PackageEntry } from './npmPackagesTypes';

type NpmTreeNode = NpmInstallNode | NpmPackageGroupNode | NpmFavoriteTagNode | NpmPackageNode;

export class NpmPackagesTree implements vscode.TreeDataProvider<NpmTreeNode> {
    private readonly changed = new vscode.EventEmitter<NpmTreeNode | undefined>();
    readonly onDidChangeTreeData = this.changed.event;

    async refresh(): Promise<void> {
        this.changed.fire(undefined);
    }

    async getChildren(element?: NpmTreeNode): Promise<NpmTreeNode[]> {
        if (element instanceof NpmInstallNode) {
            const installed = await readInstalled();
            return [
                new NpmPackageGroupNode('dependencies', installed.dependencies, element),
                new NpmPackageGroupNode('devDependencies', installed.devDependencies, element),
            ];
        }
        if (element instanceof NpmPackageGroupNode) {
            if (element.kind === 'favorites') {
                return groupFavorites(element.entries, element);
            }
            if (element.kind === 'trash') {
                return element.entries.map((entry) => new NpmPackageNode(entry, 'npmTrashedPackage', element));
            }
            const favorites = new Set((await readFavorites()).map((entry) => entry.name));
            return element.entries.map(
                (entry) =>
                    new NpmPackageNode(
                        entry,
                        favorites.has(entry.name) ? 'npmInstalledPackageFavorite' : 'npmInstalledPackage',
                        element,
                    ),
            );
        }
        if (element instanceof NpmFavoriteTagNode) {
            const installed = await readInstalled();
            const names = new Set([...installed.dependencies, ...installed.devDependencies].map((entry) => entry.name));
            return element.entries.map(
                (entry) =>
                    new NpmPackageNode(
                        entry,
                        names.has(entry.name) ? 'npmFavoritePackage' : 'npmFavoritePackageAddable',
                        element,
                    ),
            );
        }
        return [
            new NpmInstallNode(),
            new NpmPackageGroupNode('favorites', await readFavorites()),
            new NpmPackageGroupNode('trash', await readTrash()),
        ];
    }

    getTreeItem(element: NpmTreeNode): vscode.TreeItem {
        return element;
    }

    getParent(element: NpmTreeNode): NpmInstallNode | NpmPackageGroupNode | NpmFavoriteTagNode | undefined {
        return element instanceof NpmPackageNode ||
            element instanceof NpmPackageGroupNode ||
            element instanceof NpmFavoriteTagNode
            ? element.parent
            : undefined;
    }
}

export class NpmPackageNode extends vscode.TreeItem {
    constructor(
        readonly entry: PackageEntry,
        contextValue:
            | 'npmInstalledPackage'
            | 'npmInstalledPackageFavorite'
            | 'npmFavoritePackage'
            | 'npmFavoritePackageAddable'
            | 'npmTrashedPackage',
        readonly parent: NpmPackageGroupNode | NpmFavoriteTagNode,
    ) {
        super(entry.version ? `${entry.name} · ${entry.version}` : entry.name, vscode.TreeItemCollapsibleState.None);
        this.id = `${parent.id}:${entry.name}`;
        if (contextValue === 'npmFavoritePackage') {
            this.description = '· ✓';
        }
        this.tooltip = npmPackageTooltip(entry.name, entry.version, entry.description);
        this.contextValue = contextValue;
        this.iconPath = new vscode.ThemeIcon('package');
    }
}

class NpmInstallNode extends vscode.TreeItem {
    constructor() {
        super('Install', vscode.TreeItemCollapsibleState.Expanded);
        this.id = 'npm-install';
        this.contextValue = 'npmInstall';
        this.iconPath = new vscode.ThemeIcon('cloud-download');
    }
}

class NpmPackageGroupNode extends vscode.TreeItem {
    constructor(
        readonly kind: DependencyKind | 'favorites' | 'trash',
        readonly entries: PackageEntry[],
        readonly parent?: NpmInstallNode | undefined,
    ) {
        const label =
            kind === 'dependencies'
                ? 'Dependencies'
                : kind === 'devDependencies'
                  ? 'Dev Dependencies'
                  : kind === 'favorites'
                    ? 'Favorites'
                    : 'Trash';
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.id = parent ? `${parent.id}:${kind}` : `npm-group:${kind}`;
        this.contextValue =
            kind === 'favorites'
                ? 'npmFavoritePackageGroup'
                : kind === 'trash'
                  ? 'npmTrashPackageGroup'
                  : 'npmPackageGroup';
        this.description = String(entries.length);
        this.iconPath = new vscode.ThemeIcon(
            kind === 'favorites' ? 'star-full' : kind === 'trash' ? 'trash' : 'library',
        );
    }
}

class NpmFavoriteTagNode extends vscode.TreeItem {
    constructor(
        readonly tag: string,
        readonly entries: PackageEntry[],
        readonly parent: NpmPackageGroupNode,
    ) {
        super(tag, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `${parent.id}:tag:${tag}`;
        this.contextValue = 'npmFavoriteTagGroup';
        this.description = String(entries.length);
        this.iconPath = new vscode.ThemeIcon('tag');
    }
}

function groupFavorites(entries: PackageEntry[], parent: NpmPackageGroupNode): NpmFavoriteTagNode[] {
    const groups = new Map<string, PackageEntry[]>();
    for (const entry of entries) {
        const tags = favoriteTags(entry);
        for (const tag of tags.length ? tags : ['untagged']) {
            groups.set(tag, [...(groups.get(tag) ?? []), entry]);
        }
    }
    return [...groups.entries()]
        .sort(([left], [right]) => {
            if (left === 'untagged') {
                return 1;
            }
            if (right === 'untagged') {
                return -1;
            }
            return left.localeCompare(right);
        })
        .map(([tag, taggedEntries]) => new NpmFavoriteTagNode(tag, taggedEntries, parent));
}
