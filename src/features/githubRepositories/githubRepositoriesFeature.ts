import { watch } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { GitHubConfigurationStore } from './config';
import { GitHubApiClient } from './githubApiClient';
import { GitHubRepositoriesTree, GitHubRepositoryNode, GitHubTreeNode } from './tree';
import { GitHubConfiguration, GitHubProxyConfiguration } from './model';
import {
    CloneCancellationError,
    cloneRepository,
    ensureDefaultCloneParent,
    resolveCloneTarget,
} from '../repositoryManagement/cloneService';
import { repositoryIdentityKey } from '../repositoryManagement/repositoryUrl';
import { RepositoryStore } from '../repositoryManagement/store';
import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import { ProjectService } from '../projectManagement/service';
import { ProjectStore } from '../projectManagement/store';
import { DoubleClickTracker } from './doubleClick';

interface ChangedGitHubSettings {
    token: boolean;
    user: boolean;
    proxyEnabled: boolean;
    httpProxy: boolean;
    socketProxy: boolean;
}

export function activateGitHubRepositories(context: vscode.ExtensionContext): void {
    const configurationStore = new GitHubConfigurationStore();
    const repositoryStore = new RepositoryStore();
    const projectService = new ProjectService(new ProjectStore());
    const tree = new GitHubRepositoriesTree(configurationStore, new GitHubApiClient(), repositoryStore, () =>
        githubConfiguration(configurationStore),
    );
    const doubleClick = new DoubleClickTracker();
    let synchronizing = false;
    let revealRequest = 0;
    let syncingSettings = false;
    const synchronize = () =>
        run(async () => {
            if (synchronizing) {
                return;
            }
            revealRequest += 1;
            synchronizing = true;
            await vscode.commands.executeCommand('setContext', 'projectAtlas.githubRepositoriesRefreshing', true);
            let count: number;
            try {
                count = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Synchronizing GitHub Repositories',
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ message: 'Loading all repositories from GitHub…' });
                        return tree.synchronize();
                    },
                );
            } finally {
                synchronizing = false;
                await vscode.commands.executeCommand('setContext', 'projectAtlas.githubRepositoriesRefreshing', false);
            }
            await vscode.window.showInformationMessage(`Project Atlas: Synchronized ${count} GitHub repositories.`);
        });
    void vscode.commands.executeCommand('setContext', 'projectAtlas.githubRepositoriesRefreshing', false);
    void run(async () => {
        await configurationStore.ensureFile();
        const configurationWatcher = watch(
            path.dirname(configurationStore.file),
            { persistent: false },
            (_event, name) => {
                if (name?.toString() !== path.basename(configurationStore.file) || syncingSettings) {
                    return;
                }
                void run(async () => {
                    syncingSettings = true;
                    try {
                        await syncSettingsFromGithubJson(configurationStore);
                    } finally {
                        syncingSettings = false;
                    }
                });
            },
        );
        context.subscriptions.push({ dispose: () => configurationWatcher.close() });
        syncingSettings = true;
        try {
            await syncSettingsFromGithubJson(configurationStore);
        } finally {
            syncingSettings = false;
        }
        tree.refresh();
    });
    const treeView = vscode.window.createTreeView('projectAtlas.githubRepos', { treeDataProvider: tree });
    context.subscriptions.push(
        treeView,
        treeView.onDidExpandElement(() => void setGithubRepositoriesCollapsed(false)),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (syncingSettings) {
                return;
            }
            const changed: ChangedGitHubSettings = {
                token: event.affectsConfiguration('projectAtlas.github.token'),
                user: event.affectsConfiguration('projectAtlas.github.user'),
                proxyEnabled: event.affectsConfiguration('projectAtlas.github.proxyEnabled'),
                httpProxy: event.affectsConfiguration('projectAtlas.github.httpProxy'),
                socketProxy: event.affectsConfiguration('projectAtlas.github.socketProxy'),
            };
            if (
                event.affectsConfiguration('projectAtlas.github') ||
                changed.token ||
                changed.user ||
                changed.proxyEnabled ||
                changed.httpProxy ||
                changed.socketProxy
            ) {
                void run(async () => syncConfiguredSettingsToGithubJson(configurationStore, changed));
            }
        }),
        vscode.commands.registerCommand('project-atlas.refreshGithubRepositories', synchronize),
        vscode.commands.registerCommand('project-atlas.openSettings', () =>
            run(async () => {
                syncingSettings = true;
                try {
                    await syncSettingsFromGithubJson(configurationStore);
                } finally {
                    syncingSettings = false;
                }
                await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:billchiu.project-atlas-vs');
            }),
        ),
        vscode.commands.registerCommand('project-atlas.openGithubConfig', () =>
            run(async () => {
                const file = await configurationStore.ensureFile();
                await vscode.window.showTextDocument(vscode.Uri.file(file));
            }),
        ),
        vscode.commands.registerCommand('project-atlas.searchGithubRepositories', () =>
            run(async () => {
                await vscode.commands.executeCommand('projectAtlas.githubRepos.focus');
                await vscode.commands.executeCommand('list.find');
            }),
        ),
        vscode.commands.registerCommand('project-atlas.collapseGithubRepositories', () =>
            run(async () => {
                await vscode.commands.executeCommand('projectAtlas.githubRepos.focus');
                revealRequest += 1;
                tree.collapseAll();
                await setGithubRepositoriesCollapsed(true);
            }),
        ),
        vscode.commands.registerCommand('project-atlas.expandGithubRepositories', () =>
            run(async () => {
                await vscode.commands.executeCommand('projectAtlas.githubRepos.focus');
                const currentRevealRequest = revealRequest + 1;
                revealRequest = currentRevealRequest;
                tree.expandAll();
                await revealTopGithubRepositoryNode({
                    request: currentRevealRequest,
                    currentRequest: () => revealRequest,
                    topNode: async () => (await tree.getChildren())[0],
                    reveal: async (node) => {
                        await treeView.reveal(node, { select: false, focus: false, expand: true });
                    },
                });
                await setGithubRepositoriesCollapsed(false);
            }),
        ),
        vscode.commands.registerCommand('project-atlas.openGithubRepository', (node: unknown) =>
            run(async () => {
                if (node instanceof GitHubRepositoryNode) {
                    await vscode.env.openExternal(vscode.Uri.parse(node.repository.htmlUrl));
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.addGithubRepositoryToRepos', (node: unknown) =>
            run(async () => {
                if (!(node instanceof GitHubRepositoryNode)) {
                    return;
                }
                const repository = node.repository;
                const repositories = await repositoryStore.repositories();
                const key = repositoryIdentityKey(repository.sshUrl);
                if (
                    repositories.some(
                        (saved) => saved.url === repository.sshUrl || repositoryIdentityKey(saved.url) === key,
                    )
                ) {
                    tree.refresh();
                    return;
                }
                const tags = await pickRepositoryTags(repositories.flatMap((saved) => saved.tags));
                if (tags === undefined) {
                    return;
                }
                const result = await repositoryStore.addIfMissing({
                    group: repository.owner,
                    name: repository.name,
                    url: repository.sshUrl,
                    tags,
                    ...(repository.description === undefined ? {} : { description: repository.description }),
                });
                tree.refresh();
                await vscode.commands.executeCommand('project-atlas.refreshRepositories');
                if (result === 'added') {
                    await vscode.window.showInformationMessage(
                        `Project Atlas: Saved ${repository.fullName} to repos.json.`,
                    );
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.copyGithubRepositorySshUrl', (node: unknown) =>
            run(async () => {
                if (node instanceof GitHubRepositoryNode) {
                    await vscode.env.clipboard.writeText(node.repository.sshUrl);
                    await vscode.window.showInformationMessage(
                        `Project Atlas: Copied SSH URL for ${node.repository.fullName}.`,
                    );
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.handleGithubRepositoryClick', (node: unknown) =>
            run(async () => {
                if (node instanceof GitHubRepositoryNode && doubleClick.register(node.repository.id.toString())) {
                    await vscode.env.openExternal(vscode.Uri.parse(node.repository.htmlUrl));
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.cloneGithubRepository', (node: unknown) =>
            run(async () => {
                if (!(node instanceof GitHubRepositoryNode)) {
                    return;
                }
                const repository = node.repository;
                const defaultParent = await ensureDefaultCloneParent();
                const selected = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    title: `Choose Parent Folder for ${repository.name}`,
                    openLabel: 'Select Clone Location',
                    defaultUri: vscode.Uri.file(defaultParent),
                });
                if (!selected?.[0]) {
                    return;
                }
                const parentPath = selected[0].fsPath;
                const target = await resolveCloneTarget(parentPath, repository.name);
                const configuration = await githubConfiguration(configurationStore);
                const cloneUrl = repository.sshUrl;
                const confirmation = await vscode.window.showInformationMessage(
                    `Clone ${repository.fullName}?`,
                    { modal: true, detail: `Source: ${cloneUrl}\nDestination: ${target}` },
                    'Clone',
                );
                if (confirmation !== 'Clone') {
                    return;
                }
                let clonedPath: string;
                try {
                    clonedPath = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Cloning ${repository.fullName}`,
                            cancellable: true,
                        },
                        (_progress, token) =>
                            cloneRepository(
                                {
                                    group: repository.owner,
                                    name: repository.name,
                                    url: cloneUrl,
                                    tags: [],
                                    ...(repository.description === undefined
                                        ? {}
                                        : { description: repository.description }),
                                },
                                parentPath,
                                token,
                                { proxy: configuration.proxy },
                            ),
                    );
                } catch (error) {
                    if (error instanceof CloneCancellationError) {
                        const message = error.cleaned
                            ? `Project Atlas: Clone cancelled. Partial clone data was removed from ${error.target}.`
                            : `Project Atlas: Clone cancelled, but partial clone data could not be removed from ${error.target}.`;
                        await (error.cleaned
                            ? vscode.window.showInformationMessage(message)
                            : vscode.window.showWarningMessage(message));
                        return;
                    }
                    if (error instanceof vscode.CancellationError) {
                        return;
                    }
                    throw error;
                }
                const repositoryKey = repositoryIdentityKey(repository.sshUrl);
                const savedRepository = (await repositoryStore.repositories()).find(
                    (saved) => repositoryIdentityKey(saved.url) === repositoryKey,
                );
                try {
                    const tags = savedRepository?.tags ?? [];
                    await projectService.save(repository.name, clonedPath, tags, false);
                    await vscode.commands.executeCommand('project-atlas.refresh');
                } catch (error) {
                    throw new Error(
                        `Cloned to ${clonedPath}, but could not sync project.json: ${error instanceof Error ? error.message : String(error)}`,
                        { cause: error },
                    );
                }
                const action = await vscode.window.showInformationMessage(
                    `Project Atlas: Cloned ${repository.fullName} and added it to Projects.`,
                    'Open in Finder',
                    'Open in New Window',
                );
                if (action === 'Open in Finder') {
                    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(clonedPath));
                } else if (action === 'Open in New Window') {
                    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(clonedPath), true);
                }
            }),
        ),
    );
    void setGithubRepositoriesCollapsed(false);
}

async function setGithubRepositoriesCollapsed(collapsed: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'projectAtlas.githubRepositoriesCollapsed', collapsed);
}

async function run(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export async function revealTopGithubRepositoryNode({
    request,
    currentRequest,
    topNode,
    reveal,
    wait = waitForTreeRefresh,
}: {
    request: number;
    currentRequest: () => number;
    topNode: () => Promise<GitHubTreeNode | undefined>;
    reveal: (node: GitHubTreeNode) => Promise<void>;
    wait?: () => Promise<void>;
}): Promise<void> {
    await wait();
    if (request !== currentRequest()) {
        return;
    }

    const node = await topNode();
    if (node === undefined || request !== currentRequest()) {
        return;
    }

    try {
        await reveal(node);
    } catch (error) {
        if (request !== currentRequest() && isCannotResolveTreeItemError(error)) {
            return;
        }
        if (!isCannotResolveTreeItemError(error)) {
            throw error;
        }

        await wait();
        if (request !== currentRequest()) {
            return;
        }
        const retryNode = await topNode();
        if (retryNode === undefined || request !== currentRequest()) {
            return;
        }
        await reveal(retryNode);
    }
}

function waitForTreeRefresh(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

export function isCannotResolveTreeItemError(error: unknown): boolean {
    return error instanceof Error && error.message.includes('Cannot resolve tree item');
}

export async function githubConfiguration(store: GitHubConfigurationStore): Promise<GitHubConfiguration> {
    return store.configuration();
}

export async function githubProxyConfiguration(store: GitHubConfigurationStore): Promise<GitHubProxyConfiguration> {
    return store.proxyConfiguration();
}

async function syncSettingsFromGithubJson(store: GitHubConfigurationStore): Promise<void> {
    const credentials = await store.credentials();
    const proxy = await store.proxyConfiguration();
    const settings = vscode.workspace.getConfiguration('projectAtlas.github');
    await Promise.all([
        settings.update('token', credentials.token?.trim() ?? '', vscode.ConfigurationTarget.Global),
        settings.update('user', credentials.user?.trim() ?? '', vscode.ConfigurationTarget.Global),
        settings.update('proxyEnabled', proxy.enabled, vscode.ConfigurationTarget.Global),
        settings.update('httpProxy', proxy.url ?? '', vscode.ConfigurationTarget.Global),
        settings.update('socketProxy', proxy.socketUrl ?? '', vscode.ConfigurationTarget.Global),
    ]);
}

async function syncConfiguredSettingsToGithubJson(
    store: GitHubConfigurationStore,
    changed: ChangedGitHubSettings,
): Promise<void> {
    const settings = vscode.workspace.getConfiguration('projectAtlas.github');
    if (!changed.token && !changed.user && !changed.proxyEnabled && !changed.httpProxy && !changed.socketProxy) {
        return;
    }
    await store.replaceSettings({
        ...(changed.token ? { token: settings.get<string>('token', '').trim() } : {}),
        ...(changed.user ? { user: settings.get<string>('user', '').trim() } : {}),
        ...(changed.proxyEnabled ? { proxyEnabled: settings.get<boolean>('proxyEnabled', false) } : {}),
        ...(changed.httpProxy ? { httpProxy: settings.get<string>('httpProxy', '').trim() } : {}),
        ...(changed.socketProxy ? { socketProxy: settings.get<string>('socketProxy', '').trim() } : {}),
    });
}
