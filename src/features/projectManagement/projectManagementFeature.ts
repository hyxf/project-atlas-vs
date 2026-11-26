import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import { openJetBrainsProject, syncJetBrainsMenuContext } from './jetbrainsApps';
import { untaggedFilter } from './model';
import type { ListFilter, ProjectClickState, ProjectItem, SortBy } from './types';
import { editProjectForm } from './projectForm';
import { containsPath, duplicateDirectory, normalizePath, ProjectService } from './service';
import { ProjectStore, type ProjectViewVisibility } from './store';
import { ProjectDecorationProvider, ProjectDropController, ProjectNode, ProjectsTree } from './tree';
import { openXcodeProject, syncXcodeMenuContext } from './xcodeApp';

let service: ProjectService;
let tree: ProjectsTree;
let lastProjectClick: ProjectClickState | undefined;
const doubleClickInterval = 500;

export function activateProjectManagement(context: vscode.ExtensionContext): void {
    const store = new ProjectStore();
    service = new ProjectService(store);
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
        favorite: (node) => setFavorite(resolveProject(node), true),
        unfavorite: (node) => setFavorite(resolveProject(node), false),
        editTags: (node) => editTags(resolveProject(node)),
        copyPath: (node) => copyPath(resolveProject(node)),
        reveal: (node) => reveal(resolveProject(node)),
        openTerminal: (node) => openTerminal(resolveProject(node)),
        openWithPycharm: (node) =>
            openJetBrainsProject(resolveProject(node), 'pycharm', service.markOpened.bind(service)),
        openWithIdea: (node) => openJetBrainsProject(resolveProject(node), 'idea', service.markOpened.bind(service)),
        openWithXcode: (node) => openXcodeProject(resolveProject(node), service.markOpened.bind(service)),
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
        showDescriptions: () => setShowDescriptions(true),
        showDescriptionsSelected: () => setShowDescriptions(true),
        hideDescriptions: () => setShowDescriptions(false),
        hideDescriptionsSelected: () => setShowDescriptions(false),
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
    context.subscriptions.push(
        vscode.commands.registerCommand('project-atlas.editProjectViews', () => run(() => editProjectViews(store))),
    );
    for (const [name, handler] of Object.entries(handlers)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${name}`, (...args) => run(() => handler(...args))),
        );
    }
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void run(trackCurrentWorkspace)));
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => void run(syncCurrentProjectContext)));
    void run(async () => {
        await applyProjectViewVisibility(await store.viewVisibility());
        await syncMenuContext();
        await syncJetBrainsMenuContext();
        await syncXcodeMenuContext();
        await trackCurrentWorkspace();
    });
}

async function editProjectViews(store: ProjectStore): Promise<void> {
    const current = await store.viewVisibility();
    const panel = vscode.window.createWebviewPanel(
        'projectAtlas.viewVisibility',
        'Edit Project Atlas View Visibility',
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [] },
    );
    panel.webview.html = viewVisibilityHtml(current);
    panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object' || (message as { type?: unknown }).type !== 'save') {
            return;
        }
        const values = (message as { values?: unknown }).values;
        if (!values || typeof values !== 'object') {
            return;
        }
        const candidate = values as Record<string, unknown>;
        const keys = Object.keys(defaultVisibilityKeys);
        if (keys.some((key) => typeof candidate[key] !== 'boolean')) {
            return;
        }
        const visibility = Object.fromEntries(keys.map((key) => [key, candidate[key]])) as ProjectViewVisibility;
        try {
            await store.replaceViewVisibility(visibility);
            await applyProjectViewVisibility(visibility);
            await panel.webview.postMessage({ type: 'saved' });
        } catch (error) {
            await vscode.window.showErrorMessage(
                `Project Atlas: ${error instanceof Error ? error.message : String(error)}`,
            );
            await panel.webview.postMessage({ type: 'saveFailed' });
        }
    });
}

function viewVisibilityHtml(visibility: ProjectViewVisibility): string {
    const checkbox = (key: keyof ProjectViewVisibility, label: string, detail: string) =>
        `<label class="row"><span class="copy"><span class="label">${label}</span><span class="detail">${detail}</span></span><input type="checkbox" name="${key}" ${visibility[key] ? 'checked' : ''}></label>`;
    const groups = [
        {
            title: 'Projects',
            views: [
                ['githubRepositories', 'GitHub Repositories', 'Repositories saved from GitHub'],
                ['gitRepositories', 'Git Repositories', 'Saved local Git repositories'],
                ['npmPackages', 'npm packages', 'Dependencies in the active workspace'],
            ],
        },
        {
            title: 'Template Views',
            views: [
                [
                    'templates',
                    'Show template sections',
                    'Controls the four sections inside Project Atlas: Templates. Its Activity Bar icon stays visible.',
                ],
            ],
        },
    ] satisfies { title: string; views: [keyof ProjectViewVisibility, string, string][] }[];
    const sections = groups
        .map(
            ({ title, views }) =>
                `<section><h2>${title}</h2><div class="list">${views.map(([key, label, detail]) => checkbox(key, label, detail)).join('')}</div></section>`,
        )
        .join('');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Project Atlas Views</title><style>
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:32px;max-width:720px;margin:0 auto}
header{margin-bottom:24px}h1{font-size:22px;line-height:28px;font-weight:500;margin:0 0 8px}.intro{font-size:13px;line-height:20px;color:var(--vscode-descriptionForeground);margin:0}
section+section{margin-top:32px}h2{font-size:15px;line-height:20px;font-weight:500;margin:0 0 8px}.list{border-top:1px solid var(--vscode-panel-border);border-bottom:1px solid var(--vscode-panel-border)}.row{min-height:68px;box-sizing:border-box;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:12px 4px;border-bottom:1px solid var(--vscode-panel-border);cursor:pointer}.row:last-child{border-bottom:0}.row:hover .label{color:var(--vscode-textLink-foreground)}
.copy{display:grid;gap:4px}.label{font-size:14px;line-height:20px}.detail{font-size:12px;line-height:16px;color:var(--vscode-descriptionForeground)}input{accent-color:var(--vscode-focusBorder);width:16px;height:16px;margin:0;flex:none;cursor:pointer}input:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:3px}
.actions{display:flex;justify-content:flex-end;margin-top:24px}button{min-height:32px;border:0;border-radius:2px;padding:0 16px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:2px}button:disabled{opacity:.6;cursor:wait}
</style></head><body><header><h1>Project Atlas views</h1><p class="intro">Choose which sections appear in the Project Atlas sidebars.</p></header>
<form id="form">${sections}<div class="actions"><button id="save" type="submit">Save</button></div></form>
<script>
const vscode=acquireVsCodeApi(),form=document.getElementById('form'),save=document.getElementById('save');form.addEventListener('submit',event=>{event.preventDefault();if(save.disabled)return;const values={};for(const input of document.querySelectorAll('input[type=checkbox]'))values[input.name]=input.checked;save.disabled=true;vscode.postMessage({type:'save',values})});window.addEventListener('message',event=>{if(event.data?.type==='saved'||event.data?.type==='saveFailed')save.disabled=false})
</script></body></html>`;
}

const defaultVisibilityKeys: Record<keyof ProjectViewVisibility, true> = {
    githubRepositories: true,
    gitRepositories: true,
    npmPackages: true,
    templates: true,
};

async function applyProjectViewVisibility(visibility: ProjectViewVisibility): Promise<void> {
    await Promise.all([
        vscode.commands.executeCommand(
            'setContext',
            'projectAtlas.showGithubRepositories',
            visibility.githubRepositories,
        ),
        vscode.commands.executeCommand('setContext', 'projectAtlas.showGitRepositories', visibility.gitRepositories),
        vscode.commands.executeCommand('setContext', 'projectAtlas.showNpmPackages', visibility.npmPackages),
        vscode.commands.executeCommand('setContext', 'projectAtlas.showTemplates', visibility.templates),
    ]);
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
    await syncJetBrainsMenuContext();
    await syncXcodeMenuContext();
    await syncCurrentProjectContext();
    tree.refresh();
}

async function saveCurrent(): Promise<void> {
    const folder = await currentWorkspaceFolder();
    if (!folder) {
        return;
    }
    const existing = await service.findByPath(folder.uri.fsPath);
    await editProjectForm(
        existing ?? projectDefaults(folder.uri.fsPath),
        async (values) => {
            const saved = await service.save(values.name, folder.uri.fsPath, values.tags, values.favorite);
            await service.markOpened(saved);
            await syncCurrentProjectContext();
            tree.refresh();
            void vscode.window.showInformationMessage(
                `Project Atlas: ${existing ? 'Updated' : 'Saved'} “${saved.name}”.`,
            );
        },
        undefined,
        await allProjectTags(),
    );
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
    await editProjectForm(
        projectDefaults(folderPath),
        async (values) => {
            await service.save(values.name, folderPath, values.tags, values.favorite);
            await syncCurrentProjectContext();
            tree.refresh();
        },
        undefined,
        await allProjectTags(),
    );
}

async function editProject(project: ProjectItem | undefined): Promise<void> {
    if (!project) {
        return;
    }
    await editProjectForm(
        project,
        async (values) => {
            await service.updateDetails(project.id, values);
            tree.refresh();
        },
        undefined,
        await allProjectTags(),
    );
}

async function allProjectTags(): Promise<string[]> {
    return [...new Set((await service.projects()).flatMap((project) => project.tags))];
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
        await setFavorite(project, !project.favorite);
    }
}

async function setFavorite(project: ProjectItem | undefined, favorite: boolean): Promise<void> {
    if (project && project.favorite !== favorite) {
        await service.update({ ...project, favorite });
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
async function setShowDescriptions(showDescriptions: boolean): Promise<void> {
    const settings = await service.store.settings();
    settings.showDescriptions = showDescriptions;
    await service.store.replaceSettings(settings);
    await vscode.commands.executeCommand('setContext', 'projectAtlas.showDescriptions', showDescriptions);
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
    const settings = await service.store.settings();
    await vscode.commands.executeCommand('setContext', 'projectAtlas.showDescriptions', settings.showDescriptions);
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
