import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import { ListFilter, ProjectItem, SortBy, untaggedFilter } from './model';
import { editProjectForm } from './projectForm';
import { containsPath, duplicateDirectory, normalizePath, ProjectService } from './service';
import { ProjectStore } from './store';
import { ProjectDecorationProvider, ProjectDropController, ProjectNode, ProjectsTree } from './tree';

let service: ProjectService;
let tree: ProjectsTree;
let lastProjectClick: { id: string; at: number } | undefined;
const doubleClickInterval = 500;

export function activateProjectManagement(context: vscode.ExtensionContext): void {
    service = new ProjectService(new ProjectStore());
    tree = new ProjectsTree(service);
    const handlers: Record<string, (...args: unknown[]) => unknown> = {
        refresh,
        saveCurrent,
        add: addProject,
        quickOpen: () => quickOpen(false),
        quickOpenNewWindow: () => quickOpen(true),
        search: searchProjects,
        openOnDoubleClick: (node) => openProjectOnDoubleClick(resolveProject(node)),
        openCurrentWindow: (node) => openProject(resolveProject(node), false),
        openNewWindow: (node) => openProject(resolveProject(node), true),
        closeCurrent: (node) => closeCurrentProject(resolveProject(node)),
        edit: (node) => editProject(resolveProject(node)),
        toggleFavorite: (node) => toggleFavorite(resolveProject(node)),
        editTags: (node) => editTags(resolveProject(node)),
        copyPath: (node) => copyPath(resolveProject(node)),
        reveal: (node) => reveal(resolveProject(node)),
        openTerminal: (node) => openTerminal(resolveProject(node)),
        duplicate: (node) => duplicateProject(resolveProject(node)),
        remove: (node) => removeProject(resolveProject(node)),
        delete: (node) => deleteProject(resolveProject(node)),
        toggleView,
        filterByTag,
        filterAll: () => setFilter('ALL'),
        filterRecent: () => setFilter('RECENT'),
        filterFavorites: () => setFilter('FAVORITES'),
        filterAllSelected: () => setFilter('ALL'),
        filterRecentSelected: () => setFilter('RECENT'),
        filterFavoritesSelected: () => setFilter('FAVORITES'),
        sortName: () => setSort('NAME'),
        sortPath: () => setSort('PATH'),
        sortRecent: () => setSort('RECENT'),
        sortNameSelected: () => setSort('NAME'),
        sortPathSelected: () => setSort('PATH'),
        sortRecentSelected: () => setSort('RECENT'),
        openDataFile,
    };
    context.subscriptions.push(
        vscode.window.createTreeView('projectAtlas.projects', {
            treeDataProvider: tree,
            dragAndDropController: new ProjectDropController(async (uris, token) => {
                await run(() => addDroppedProjects(uris, token));
            }),
        }),
    );
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(new ProjectDecorationProvider()));
    for (const [name, handler] of Object.entries(handlers)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, (...args) => run(() => handler(...args))),
        );
    }
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void run(trackCurrentWorkspace)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => void run(syncCurrentProjectContext)));
    void run(async () => {
        await syncMenuContext();
        await trackCurrentWorkspace();
    });
}

async function run(action: () => unknown): Promise<unknown> {
    try {
        return await action();
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
        );
        return undefined;
    }
}

async function refresh(): Promise<void> {
    await service.projects(true);
    await syncMenuContext();
    await syncCurrentProjectContext();
    tree.refresh();
}

async function saveCurrent(): Promise<void> {
    const folder = await currentWorkspaceFolder();
    if (!folder) {
        return;
    }
    const existing = await service.findByPath(folder.uri.fsPath);
    await editProjectForm(existing ?? projectDefaults(folder.uri.fsPath), async (values) => {
        const saved = await service.save(values.name, folder.uri.fsPath, values.tags, values.favorite);
        await service.markOpened(saved);
        await syncCurrentProjectContext();
        tree.refresh();
        void vscode.window.showInformationMessage(`Project Atlas: ${existing ? 'Updated' : 'Saved'} “${saved.name}”.`);
    });
}

async function currentWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        throw new Error('Open a folder or workspace first.');
    }
    const activeFolder =
        vscode.window.activeTextEditor &&
        vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    if (activeFolder || folders.length === 1) {
        return activeFolder ?? folders[0];
    }
    const selected = await vscode.window.showQuickPick(
        folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
        {
            title: 'Save Current Project',
            placeHolder: 'Choose a workspace folder',
            matchOnDescription: true,
        },
    );
    return selected?.folder;
}

async function addProject(): Promise<void> {
    const selected = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        title: 'Add Folder',
    });
    if (!selected?.[0]) {
        return;
    }
    await addFolder(selected[0].fsPath);
}

async function addDroppedProjects(uris: readonly vscode.Uri[], token: vscode.CancellationToken): Promise<void> {
    for (const uri of uris) {
        if (token.isCancellationRequested) {
            return;
        }
        if (uri.scheme !== 'file' || !(await isDirectory(uri.fsPath))) {
            await vscode.window.showWarningMessage('Project Atlas: Only folders can be added.');
            continue;
        }
        await addFolder(uri.fsPath);
    }
}

async function addFolder(folderPath: string): Promise<void> {
    if (await service.findByPath(folderPath)) {
        await vscode.window.showInformationMessage('Project Atlas: Project already exists.');
        return;
    }
    await editProjectForm(projectDefaults(folderPath), async (values) => {
        await service.save(values.name, folderPath, values.tags, values.favorite);
        await syncCurrentProjectContext();
        tree.refresh();
    });
}

async function editProject(project: ProjectItem | undefined): Promise<void> {
    if (!project) {
        return;
    }
    await editProjectForm(project, async (values) => {
        await service.updateDetails(project.id, values);
        tree.refresh();
    });
}

async function quickOpen(newWindow: boolean): Promise<void> {
    const settings = await service.store.settings(true);
    const picked = await pickProject(
        service.sort(await service.projects(), settings.sortBy),
        newWindow ? 'Open Project in New Window' : 'Open Project',
    );
    if (picked) {
        await openProject(picked, newWindow);
    }
}

async function searchProjects(): Promise<void> {
    const picked = await pickProject(await service.projects(true), 'Search Projects');
    if (picked) {
        await openProject(picked);
    }
}

async function pickProject(projects: ProjectItem[], title: string): Promise<ProjectItem | undefined> {
    if (!projects.length) {
        await vscode.window.showInformationMessage('Project Atlas: No saved projects.');
        return;
    }
    return (
        await vscode.window.showQuickPick(
            projects.map((project) => ({
                label: `${project.favorite ? '$(star-full) ' : ''}${project.name}`,
                description: project.tags.join(' · '),
                detail: project.path,
                project,
            })),
            { title, matchOnDescription: true, matchOnDetail: true },
        )
    )?.project;
}

async function openProject(project: ProjectItem | undefined, newWindow?: boolean): Promise<void> {
    if (!project) {
        return;
    }
    if (!(await isDirectory(project.path))) {
        throw new Error(`Project directory is missing: ${project.path}`);
    }
    const settings = await service.store.settings();
    const forceNew = newWindow ?? settings.defaultOpenMode === 'NEW_WINDOW';
    await service.markOpened(project);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(project.path), {
        forceNewWindow: forceNew,
        forceReuseWindow: !forceNew,
    });
}

async function closeCurrentProject(project: ProjectItem | undefined): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const activeFolder =
        vscode.window.activeTextEditor &&
        vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const currentFolder = activeFolder ?? (folders?.length === 1 ? folders[0] : undefined);
    if (!project || !currentFolder || normalizePath(project.path) !== normalizePath(currentFolder.uri.fsPath)) {
        return;
    }
    await vscode.commands.executeCommand('workbench.action.closeFolder');
}

async function openProjectOnDoubleClick(project: ProjectItem | undefined): Promise<void> {
    if (!project) {
        return;
    }
    const now = Date.now();
    if (lastProjectClick?.id === project.id && now - lastProjectClick.at <= doubleClickInterval) {
        lastProjectClick = undefined;
        await openProject(project);
        return;
    }
    lastProjectClick = { id: project.id, at: now };
}

async function toggleFavorite(project?: ProjectItem): Promise<void> {
    if (project) {
        await service.update({ ...project, favorite: !project.favorite });
        tree.refresh();
    }
}
async function editTags(project?: ProjectItem): Promise<void> {
    if (!project) {
        return;
    }
    const tags = await pickRepositoryTags(
        (await service.projects()).flatMap((item) => item.tags),
        project.tags,
        `Tags for ${project.name}`,
    );
    if (tags !== undefined) {
        await service.update({ ...project, tags });
        tree.refresh();
    }
}
async function copyPath(project?: ProjectItem): Promise<void> {
    if (project) {
        await vscode.env.clipboard.writeText(project.path);
    }
}
async function reveal(project?: ProjectItem): Promise<void> {
    if (project) {
        await vscode.env.openExternal(vscode.Uri.file(project.path));
    }
}
async function openTerminal(project?: ProjectItem): Promise<void> {
    if (project) {
        vscode.window.createTerminal({ name: project.name, cwd: project.path }).show();
    }
}

async function duplicateProject(project?: ProjectItem): Promise<void> {
    if (!project || !(await isDirectory(project.path))) {
        throw new Error('Project directory is missing.');
    }
    const target = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Duplicating ${project.name}…` },
        () => duplicateDirectory(project.path),
    );
    await service.save(path.basename(target), target, project.tags, project.favorite);
    tree.refresh();
}

async function removeProject(project?: ProjectItem): Promise<void> {
    if (!project) {
        return;
    }
    if (
        (await vscode.window.showWarningMessage(
            `Remove “${project.name}” from Project Atlas? Files will not be deleted.`,
            { modal: true },
            'Remove',
        )) === 'Remove'
    ) {
        await service.remove(project.id);
        await syncCurrentProjectContext();
        tree.refresh();
    }
}
async function deleteProject(project?: ProjectItem): Promise<void> {
    if (!project) {
        return;
    }
    const normalized = normalizePath(project.path);
    if (path.parse(normalized).root === normalized) {
        throw new Error('The filesystem root cannot be deleted.');
    }
    if (!(await isDirectory(normalized))) {
        throw new Error(`Project directory is missing: ${normalized}`);
    }
    const realTarget = await fs.realpath(normalized);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const workspacePath = normalizePath(folder.uri.fsPath);
        const realWorkspace = await fs.realpath(workspacePath).catch(() => workspacePath);
        if (containsPath(realTarget, realWorkspace)) {
            throw new Error('A currently open workspace is inside this project. Close it first.');
        }
    }
    const choice = await vscode.window.showWarningMessage(
        `Delete “${project.name}”?`,
        { modal: true, detail: `${normalized}\n\nMove to Trash is recoverable. Delete Permanently cannot be undone.` },
        'Move to Trash',
        'Delete Permanently',
    );
    if (choice) {
        await vscode.workspace.fs.delete(vscode.Uri.file(normalized), {
            recursive: true,
            useTrash: choice === 'Move to Trash',
        });
        await service.remove(project.id);
        await syncCurrentProjectContext();
        tree.refresh();
    }
}

async function toggleView(): Promise<void> {
    const settings = await service.store.settings();
    settings.selectedView = settings.selectedView === 'LIST' ? 'TAGS' : 'LIST';
    await service.store.replaceSettings(settings);
    tree.refresh();
}
async function filterByTag(): Promise<void> {
    const tags = [...new Set((await service.projects()).flatMap((project) => project.tags))].sort((a, b) =>
        a.localeCompare(b),
    );
    const picked = await vscode.window.showQuickPick(
        [
            ...tags.map((tag) => ({ label: tag, picked: true, value: tag })),
            {
                label: 'Untagged',
                description: 'Projects without tags',
                picked: true,
                value: untaggedFilter,
            },
        ],
        {
            title: 'Filter Projects by Tag',
            placeHolder: 'Select tags; leave empty to show all tags',
            canPickMany: true,
        },
    );
    if (!picked) {
        return;
    }
    tree.setTagFilters(picked.map((item) => item.value));
}
async function setFilter(filter: ListFilter): Promise<void> {
    const settings = await service.store.settings();
    settings.selectedListFilter = filter;
    settings.selectedFilter = filter;
    await service.store.replaceSettings(settings);
    await syncMenuContext(filter, settings.sortBy);
    tree.refresh();
}
async function setSort(sort: SortBy): Promise<void> {
    const settings = await service.store.settings();
    settings.sortBy = sort;
    await service.store.replaceSettings(settings);
    await syncMenuContext(settings.selectedListFilter, sort);
    tree.refresh();
}
async function syncMenuContext(filter?: ListFilter, sort?: SortBy): Promise<void> {
    if (!filter || !sort) {
        const settings = await service.store.settings();
        filter = settings.selectedListFilter;
        sort = settings.sortBy;
    }
    await vscode.commands.executeCommand('setContext', 'projectAtlas.filter', filter);
    await vscode.commands.executeCommand('setContext', 'projectAtlas.sort', sort);
}
async function openDataFile(): Promise<void> {
    await vscode.window.showTextDocument(vscode.Uri.file(await service.store.ensureFile()));
}

async function trackCurrentWorkspace(): Promise<void> {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const project = await service.findByPath(folder.uri.fsPath);
        if (project) {
            await service.markOpened(project);
        }
    }
    await syncCurrentProjectContext();
    tree.refresh();
}
async function syncCurrentProjectContext(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    const activeFolder =
        vscode.window.activeTextEditor &&
        vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
    const currentFolder = activeFolder ?? (folders?.length === 1 ? folders[0] : undefined);
    const saved = currentFolder
        ? (await service.projects(true)).some(
              (project) => normalizePath(project.path) === normalizePath(currentFolder.uri.fsPath),
          )
        : false;
    await vscode.commands.executeCommand('setContext', 'projectAtlas.currentProjectSaved', saved);
    tree.refresh();
}
function resolveProject(value: unknown): ProjectItem | undefined {
    if (value instanceof ProjectNode) {
        return value.project;
    }
    return value && typeof value === 'object' && 'id' in value ? (value as ProjectItem) : undefined;
}
function projectDefaults(projectPath: string): ProjectItem {
    return { id: '', name: path.basename(projectPath), path: projectPath, tags: [], favorite: false };
}
async function isDirectory(projectPath: string): Promise<boolean> {
    return fs.stat(projectPath).then(
        (value) => value.isDirectory(),
        () => false,
    );
}
