import * as vscode from 'vscode';
import { GitHubApiClient } from './githubApiClient';
import { GitHubConfigurationStore } from './config';
import { GitHubConfiguration, GitHubRepository } from './model';
import { repositoryIdentityKey } from '../repositoryManagement/repositoryUrl';
import { RepositoryStore } from '../repositoryManagement/store';

export class GitHubRepositoryNode extends vscode.TreeItem {
    constructor(
        readonly repository: GitHubRepository,
        addable: boolean,
        readonly visibility: 'Public' | 'Private',
        readonly languageRepositories: GitHubRepository[],
        readonly visibilityRepositories: GitHubRepository[],
    ) {
        super(repository.fullName, vscode.TreeItemCollapsibleState.None);
        this.id = `github-repository:${repository.id}`;
        this.contextValue = addable ? 'githubRepositoryAddable' : 'githubRepositorySaved';
        if (repository.archived) {
            this.description = 'Archived';
        }
        this.tooltip = [
            repository.fullName,
            repository.description,
            repository.archived ? 'Archived' : undefined,
            repository.htmlUrl,
        ]
            .filter(Boolean)
            .join('\n');
        this.iconPath = new vscode.ThemeIcon('repo');
        this.command = {
            command: 'project-atlas.handleGithubRepositoryClick',
            title: 'Open GitHub Repository',
            arguments: [this],
        };
    }
}

export class GitHubVisibilityNode extends vscode.TreeItem {
    constructor(
        readonly visibility: 'Public' | 'Private',
        readonly repositories: GitHubRepository[],
    ) {
        super(visibility, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `github-visibility:${visibility.toLowerCase()}`;
        this.contextValue = 'githubVisibility';
        this.description = repositories.length.toString();
        this.iconPath = new vscode.ThemeIcon(visibility === 'Private' ? 'lock' : 'globe');
    }
}

export class GitHubLanguageNode extends vscode.TreeItem {
    constructor(
        readonly visibility: 'Public' | 'Private',
        readonly language: string | undefined,
        readonly repositories: GitHubRepository[],
        readonly visibilityRepositories: GitHubRepository[],
    ) {
        super(language ?? 'Unknown', vscode.TreeItemCollapsibleState.Expanded);
        this.id = `github-language:${visibility.toLowerCase()}:${language ?? '__unknown__'}`;
        this.contextValue = 'githubLanguage';
        this.description = repositories.length.toString();
        this.iconPath = new vscode.ThemeIcon('symbol-color');
    }
}

export type GitHubTreeNode = GitHubVisibilityNode | GitHubLanguageNode | GitHubRepositoryNode;

export class GitHubRepositoriesTree implements vscode.TreeDataProvider<GitHubTreeNode> {
    private readonly changed = new vscode.EventEmitter<GitHubTreeNode | undefined>();
    private expansionGeneration = 0;
    private languageExpansionState = vscode.TreeItemCollapsibleState.Expanded;
    readonly onDidChangeTreeData = this.changed.event;

    constructor(
        private readonly configurationStore: GitHubConfigurationStore,
        private readonly client: GitHubApiClient,
        private readonly repositoryStore: RepositoryStore,
        private readonly configurationProvider: () => Promise<GitHubConfiguration> = () =>
            this.configurationStore.configuration(),
    ) {}

    refresh(): void {
        this.changed.fire(undefined);
    }

    collapseAll(): void {
        this.languageExpansionState = vscode.TreeItemCollapsibleState.Collapsed;
        this.expansionGeneration += 1;
        this.refresh();
    }

    expandAll(): void {
        this.languageExpansionState = vscode.TreeItemCollapsibleState.Expanded;
        this.expansionGeneration += 1;
        this.refresh();
    }

    async synchronize(): Promise<number> {
        const configuration = await this.configurationProvider();
        const repositories = await this.client.repositories(configuration);
        await this.configurationStore.replaceRepositories(repositories);
        this.refresh();
        return repositories.length;
    }

    getTreeItem(element: GitHubTreeNode): vscode.TreeItem {
        return element;
    }

    async getParent(element: GitHubTreeNode): Promise<GitHubTreeNode | undefined> {
        if (element instanceof GitHubVisibilityNode) {
            return undefined;
        }
        if (element instanceof GitHubLanguageNode) {
            return this.visibilityNode(element.visibilityRepositories, element.visibility);
        }
        return this.identify(
            new GitHubLanguageNode(
                element.visibility,
                element.repository.language,
                element.languageRepositories,
                element.visibilityRepositories,
            ),
        );
    }

    async getChildren(element?: GitHubTreeNode): Promise<GitHubTreeNode[]> {
        if (element instanceof GitHubRepositoryNode) {
            return [];
        }
        if (element instanceof GitHubLanguageNode) {
            const savedRepositoryKeys = new Set(
                (await this.repositoryStore.repositories())
                    .map((repository) => repositoryIdentityKey(repository.url))
                    .filter((key): key is string => key !== undefined),
            );
            return element.repositories.sort(compareRepositories).map((repository) => {
                const key = repositoryIdentityKey(repository.sshUrl);
                return new GitHubRepositoryNode(
                    repository,
                    key === undefined || !savedRepositoryKeys.has(key),
                    element.visibility,
                    element.repositories,
                    element.visibilityRepositories,
                );
            });
        }
        if (element instanceof GitHubVisibilityNode) {
            const languages = new Map<string | undefined, GitHubRepository[]>();
            for (const repository of element.repositories) {
                const repositories = languages.get(repository.language) ?? [];
                repositories.push(repository);
                languages.set(repository.language, repositories);
            }
            return [...languages.entries()]
                .sort(([left], [right]) => compare(left ?? 'Unknown', right ?? 'Unknown'))
                .map(([language, repositories]) =>
                    this.identify(
                        new GitHubLanguageNode(element.visibility, language, repositories, element.repositories),
                    ),
                );
        }
        const repositories = await this.configurationStore.repositories();
        return [
            this.visibilityNode(
                repositories.filter((repository) => !repository.private),
                'Public',
            ),
            this.visibilityNode(
                repositories.filter((repository) => repository.private),
                'Private',
            ),
        ];
    }

    private visibilityNode(repositories: GitHubRepository[], visibility: 'Public' | 'Private'): GitHubVisibilityNode {
        return this.identify(new GitHubVisibilityNode(visibility, repositories));
    }

    private identify<T extends GitHubTreeNode>(node: T): T {
        node.id = `${node.id}:${this.expansionGeneration}`;
        if (node instanceof GitHubLanguageNode) {
            node.collapsibleState = this.languageExpansionState;
        }
        return node;
    }
}

function compareRepositories(left: GitHubRepository, right: GitHubRepository): number {
    return compare(left.fullName, right.fullName);
}

function compare(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
}
