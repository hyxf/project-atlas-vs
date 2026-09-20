import * as vscode from 'vscode';
import { runGit } from '../gitTagRelease/gitTagService';
import { GitHubConfigurationStore } from '../githubRepositories/config';
import { githubProxyConfiguration } from '../githubRepositories/githubRepositoriesFeature';
import { ProjectItem } from '../projectManagement/model';
import { ProjectStore } from '../projectManagement/store';
import { ProjectService } from '../projectManagement/service';
import { CloneCancellationError, cloneRepository, ensureDefaultCloneParent, resolveCloneTarget } from './cloneService';
import { syncProjectRepositories } from './repositorySyncService';
import { editRepositoryForm } from './repositoryForm';
import { RepositoryStore } from './store';
import { pickRepositoryTags } from './tagPicker';
import { RepositoriesTree, RepositoryNode, RepositoryViewMode } from './tree';

export function activateRepositoryManagement(context: vscode.ExtensionContext): void {
    const store = new RepositoryStore();
    const projectStore = new ProjectStore();
    const projectService = new ProjectService(projectStore);
    const githubConfigurationStore = new GitHubConfigurationStore();
    const tree = new RepositoriesTree(store);
    void run(async () => setRepositoryViewMode(tree, await store.viewMode()));
    const treeView = vscode.window.createTreeView('projectAtlas.repos', { treeDataProvider: tree });
    context.subscriptions.push(
        treeView,
        treeView.onDidExpandElement(() => void setRepositoriesCollapsed(false)),
    );
    void setRepositoriesCollapsed(false);
    context.subscriptions.push(
        vscode.commands.registerCommand('project-atlas.saveCurrentRepository', () =>
            run(async () => {
                const projects = await projectStore.projects(true);
                if (!projects.length) {
                    await vscode.window.showInformationMessage('Project Atlas: No projects are saved in project.json.');
                    return;
                }
                const result = await syncProjectRepositories(projects, store, remoteUrlForProject);
                tree.refresh();
                if (result.failed) {
                    await vscode.window.showWarningMessage(
                        `Project Atlas: Repository refresh completed. Saved ${result.added}, failed ${result.failed}.`,
                    );
                } else if (!result.added) {
                    await vscode.window.showInformationMessage(
                        `Project Atlas: All ${result.existing} project repositories are already saved.`,
                    );
                } else {
                    await vscode.window.showInformationMessage(
                        `Project Atlas: Saved ${result.added} project repositories.`,
                    );
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.refreshRepositories', () => tree.refresh()),
        vscode.commands.registerCommand('project-atlas.collapseRepositories', () =>
            run(async () => {
                await vscode.commands.executeCommand('projectAtlas.repos.focus');
                await vscode.commands.executeCommand('workbench.actions.treeView.projectAtlas.repos.collapseAll');
                await setRepositoriesCollapsed(true);
            }),
        ),
        vscode.commands.registerCommand('project-atlas.expandRepositories', () =>
            run(async () => {
                await vscode.commands.executeCommand('projectAtlas.repos.focus');
                await expandAllRepositories(treeView, tree);
                await setRepositoriesCollapsed(false);
            }),
        ),
        ...(['TAGS', 'GROUPS', 'HOSTS'] as const).map((mode) =>
            vscode.commands.registerCommand(`project-atlas.repositoryView${mode}`, () =>
                run(async () => {
                    await store.replaceViewMode(mode);
                    await setRepositoryViewMode(tree, mode);
                }),
            ),
        ),
        vscode.commands.registerCommand('project-atlas.addRepository', () =>
            run(async () => {
                await editRepositoryForm(store, undefined, () => tree.refresh());
            }),
        ),
        vscode.commands.registerCommand('project-atlas.openRepositoryDataFile', () =>
            run(async () =>
                vscode.window.showTextDocument(vscode.Uri.file(await store.ensureFile())).then(() => undefined),
            ),
        ),
        vscode.commands.registerCommand('project-atlas.deleteRepository', (node: unknown) =>
            run(async () => {
                if (!(node instanceof RepositoryNode)) {
                    return;
                }
                const repository = node.repository;
                const confirmation = await vscode.window.showWarningMessage(
                    `Remove ${repository.group}/${repository.name} from Git Repositories?`,
                    {
                        modal: true,
                        detail: 'This removes only the repos.json record. It does not delete any local repository.',
                    },
                    'Remove',
                );
                if (confirmation !== 'Remove') {
                    return;
                }
                if (await store.remove(repository.url)) {
                    tree.refresh();
                    await vscode.window.showInformationMessage(
                        `Project Atlas: Removed ${repository.group}/${repository.name}.`,
                    );
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.editRepositoryTags', (node: unknown) =>
            run(async () => {
                if (!(node instanceof RepositoryNode)) {
                    return;
                }
                const repositories = await store.repositories();
                const tags = await pickRepositoryTags(
                    repositories.flatMap((repository) => repository.tags),
                    node.repository.tags,
                );
                if (tags === undefined) {
                    return;
                }
                if (await store.updateTags(node.repository.url, tags)) {
                    tree.refresh();
                    await vscode.window.showInformationMessage(
                        `Project Atlas: Updated tags for ${node.repository.group}/${node.repository.name}.`,
                    );
                }
            }),
        ),
        vscode.commands.registerCommand('project-atlas.editRepository', (node: unknown) =>
            run(async () => {
                if (!(node instanceof RepositoryNode)) {
                    return;
                }
                await editRepositoryForm(store, node.repository, () => tree.refresh());
            }),
        ),
        vscode.commands.registerCommand('project-atlas.cloneRepository', (node: unknown) =>
            run(async () => {
                if (!(node instanceof RepositoryNode)) {
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
                const confirmation = await vscode.window.showInformationMessage(
                    `Clone ${repository.group}/${repository.name}?`,
                    { modal: true, detail: `Source: ${repository.url}\nDestination: ${target}` },
                    'Clone',
                );
                if (confirmation !== 'Clone') {
                    return;
                }
                const proxy = await githubProxyConfiguration(githubConfigurationStore);
                let clonedPath: string;
                try {
                    clonedPath = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: `Cloning ${repository.group}/${repository.name}`,
                            cancellable: true,
                        },
                        (_progress, token) => cloneRepository(repository, parentPath, token, { proxy }),
                    );
                } catch (error) {
                    if (error instanceof CloneCancellationError) {
                        if (error.cleaned) {
                            await vscode.window.showInformationMessage(
                                `Project Atlas: Clone cancelled. Partial clone data was removed from ${error.target}.`,
                            );
                        } else {
                            await vscode.window.showWarningMessage(
                                `Project Atlas: Clone cancelled, but partial clone data could not be removed from ${error.target}. Remove it before retrying.`,
                            );
                        }
                        return;
                    }
                    if (error instanceof vscode.CancellationError) {
                        return;
                    }
                    throw error;
                }
                try {
                    await projectService.save(repository.name, clonedPath, repository.tags, false);
                    await vscode.commands.executeCommand('project-atlas.refresh');
                } catch (error) {
                    throw new Error(
                        `Cloned to ${clonedPath}, but could not sync project.json: ${error instanceof Error ? error.message : String(error)}`,
                        { cause: error },
                    );
                }
                const action = await vscode.window.showInformationMessage(
                    `Project Atlas: Cloned ${repository.group}/${repository.name} and added it to Projects.`,
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
}

async function setRepositoryViewMode(tree: RepositoriesTree, mode: RepositoryViewMode): Promise<void> {
    tree.setMode(mode);
    await vscode.commands.executeCommand('setContext', 'projectAtlas.repositoryViewMode', mode);
}

async function setRepositoriesCollapsed(collapsed: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'projectAtlas.repositoriesCollapsed', collapsed);
}

async function expandAllRepositories(treeView: vscode.TreeView<unknown>, tree: RepositoriesTree): Promise<void> {
    for (const node of await tree.getChildren()) {
        await treeView.reveal(node, { expand: true, focus: false, select: false });
    }
}

async function remoteUrlForProject(project: ProjectItem): Promise<string | undefined> {
    const result = await runGit(project.path, ['config', '--get', 'remote.origin.url']);
    return result.code === 0 ? result.stdout.trim() || undefined : undefined;
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
