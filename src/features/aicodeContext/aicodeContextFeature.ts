import * as vscode from 'vscode';
import { classifyChangedPaths, parseBranchOptions } from './branchComparison';
import { ContextService } from './contextService';
import { buildMarkdown } from './markdown';
import { CONFIG_FILE, ContextTarget } from './model';
import { AICodeTreeProvider, ContextNode } from './tree';

const doubleClickIntervalMs = 500;

export function activateAICodeContext(context: vscode.ExtensionContext): void {
    const service = new ContextService();
    const provider = new AICodeTreeProvider(service);
    const tree = vscode.window.createTreeView('aicode.contextFiles', {
        treeDataProvider: provider,
        canSelectMany: true,
    });
    const compareProvider = new CompareResultsProvider();
    const compareTree = vscode.window.createTreeView('aicode.compareResults', {
        treeDataProvider: compareProvider,
    });
    const decoration = new ConfigDecorationProvider(service);
    const indicator = new EditorIndicator(service, context);
    const resourceContextSubscription = service.onDidChange(() => void updateExplorerResourceContext(service));
    context.subscriptions.push(
        service,
        tree,
        tree.onDidExpandElement(() => void setContextFilesCollapsed(false)),
        compareTree,
        compareProvider,
        decoration,
        indicator,
        resourceContextSubscription,
        vscode.window.registerFileDecorationProvider(decoration),
    );
    void updateExplorerResourceContext(service);

    const command = (id: string, handler: (...args: unknown[]) => Promise<void>) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, (...args) => run(() => handler(...args))));
    let lastFileActivation: { uri: string; time: number } | undefined;
    command('aicode.openFile', async (argument) => {
        const node = argument instanceof ContextNode && argument.kind === 'file' ? argument : undefined;
        if (node?.resourceUri === undefined) {
            return;
        }
        const now = Date.now();
        const uri = node.resourceUri.toString();
        const isDoubleClick = lastFileActivation?.uri === uri && now - lastFileActivation.time <= doubleClickIntervalMs;
        lastFileActivation = { uri, time: now };
        if (!isDoubleClick) {
            return;
        }
        lastFileActivation = undefined;
        await vscode.commands.executeCommand('vscode.open', node.resourceUri);
    });
    command('aicode.selectGroup', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const loaded = await requireConfig(service, folder);
        if (loaded === undefined) {
            return;
        }
        const chosen = await vscode.window.showQuickPick(
            Object.keys(loaded.groups)
                .sort()
                .map((name) =>
                    name === loaded.activeGroup ? { label: name, description: 'Current' } : { label: name },
                ),
            { placeHolder: 'Select context group' },
        );
        if (chosen !== undefined) {
            await service.selectGroup(folder, chosen.label);
        }
    });
    command('aicode.createGroup', async (argument) => groupInput(service, argument, 'Create Context Group', false));
    command('aicode.duplicateGroup', async (argument) =>
        groupInput(service, argument, 'Duplicate Context Group', true),
    );
    command('aicode.renameGroup', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const loaded = await requireConfig(service, folder);
        if (loaded === undefined) {
            return;
        }
        if (loaded.activeGroup === 'Default') {
            return;
        }
        const name = await vscode.window.showInputBox({ title: 'Rename Context Group', value: loaded.activeGroup });
        if (name !== undefined && name.trim() !== '') {
            await service.renameGroup(folder, name);
        }
    });
    command('aicode.deleteGroup', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const loaded = await requireConfig(service, folder);
        if (loaded === undefined) {
            return;
        }
        if (loaded.activeGroup === 'Default') {
            return;
        }
        const answer = await vscode.window.showWarningMessage(
            `Delete context group “${loaded.activeGroup}”?`,
            { modal: true },
            'Delete',
        );
        if (answer === 'Delete') {
            await service.deleteGroup(folder);
        }
    });
    command('aicode.openConfig', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const loaded = await service.load(folder);
        if (loaded.kind === 'missing') {
            await service.mutate(folder, () => true);
        }
        await vscode.window.showTextDocument(service.configUri(folder));
    });
    command('aicode.addToContext', async (argument, selected) => {
        const uris = getUris(argument, selected);
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const actual = uris.length > 0 ? uris : activeUri();
        const count = await service.add(folder, actual);
        await vscode.window.showInformationMessage(
            count > 0 ? `Added ${count} file(s) to AICode Context.` : 'No eligible files to add.',
        );
    });
    command('aicode.removeFromContext', async (argument, selected) => {
        const uris = getUris(argument, selected);
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const paths =
            uris.length > 0
                ? uris.map((uri) => service.resolve(uri)?.relativePath).filter(isString)
                : nodePaths(argument);
        const count = await service.remove(folder, paths);
        await vscode.window.showInformationMessage(
            count > 0 ? `Removed ${count} file(s) from AICode Context.` : 'No matching context files.',
        );
    });
    command('aicode.removeAllFiles', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const count = await service.clearActiveGroup(folder);
        await vscode.window.showInformationMessage(
            count > 0 ? `Removed ${count} file(s) from AICode Context.` : 'The active context group is empty.',
        );
    });
    command('aicode.removeFile', async (argument) => {
        await vscode.commands.executeCommand('aicode.removeFromContext', argument);
    });
    command('aicode.removeDirectory', async (argument) => {
        await vscode.commands.executeCommand('aicode.removeFromContext', argument);
    });
    command('aicode.addMissingFiles', async (argument) => {
        const folder = await selectFolder(service, argument);
        if (folder === undefined) {
            return;
        }
        const node = argument instanceof ContextNode ? argument : undefined;
        const uri =
            node?.relativePath === undefined
                ? folder.uri
                : vscode.Uri.joinPath(folder.uri, ...node.relativePath.split('/'));
        const count = await service.add(folder, [uri]);
        await vscode.window.showInformationMessage(
            count > 0 ? `Added ${count} missing file(s).` : 'No missing files found.',
        );
    });
    command('aicode.copyFileList', async (argument) => {
        const resolved = await loadSelected(service, argument);
        if (resolved === undefined) {
            return;
        }
        const paths = resolved.config.groups[resolved.config.activeGroup] ?? [];
        if (paths.length === 0) {
            await vscode.window.showWarningMessage('The active context group is empty.');
            return;
        }
        await vscode.env.clipboard.writeText(paths.map((entry) => `@${entry}`).join('\n'));
        await vscode.window.showInformationMessage(`Copied ${paths.length} context file(s).`);
    });
    command('aicode.copyMarkdown', async (argument) => {
        const resolved = await loadSelected(service, argument);
        if (resolved === undefined) {
            return;
        }
        const markdown = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Building AICode context Markdown…',
                cancellable: false,
            },
            () => buildMarkdown(resolved.folder, resolved.config),
        );
        await vscode.env.clipboard.writeText(markdown);
        await vscode.window.showInformationMessage('Copied AICode Context as Markdown.');
    });
    command('aicode.copyRelativePath', async (argument, selected) => {
        const uris = getUris(argument, selected);
        const targets = uris.map((uri) => service.resolve(uri)).filter(isTarget);
        if (targets.length === 0) {
            return;
        }
        const multiRoot = new Set(targets.map((target) => target.folder.uri.toString())).size > 1;
        const paths = targets.map((target) => `${multiRoot ? `${target.folder.name}/` : ''}${target.relativePath}`);
        await vscode.env.clipboard.writeText(paths.join('\n'));
        await vscode.window.showInformationMessage(
            paths.length === 1 ? `Copied relative path: ${paths[0]}` : `Copied ${paths.length} relative paths.`,
        );
    });
    command('aicode.addToTerminal', async (argument, selected) => {
        const terminal = vscode.window.activeTerminal;
        if (terminal === undefined) {
            await vscode.window.showWarningMessage('No active terminal.');
            return;
        }
        const targets = getUris(argument, selected)
            .map((uri) => service.resolve(uri))
            .filter(isTarget);
        if (targets.length === 0) {
            return;
        }
        terminal.sendText(targets.map((target) => shellQuote(`@${target.relativePath}`)).join(' '), false);
        terminal.show(false);
    });
    command('aicode.refresh', async () => provider.refresh());
    command('aicode.expandAll', async () => {
        provider.resetToExpanded();
        await setContextFilesCollapsed(false);
    });
    command('aicode.collapseAll', async () => {
        provider.resetToCollapsed();
        await setContextFilesCollapsed(true);
    });
    command('aicode.showEditorIndicator', async (argument) =>
        indicator.setVisible(await selectFolder(service, argument), true),
    );
    command('aicode.hideEditorIndicator', async (argument) =>
        indicator.setVisible(await selectFolder(service, argument), false),
    );
    command('aicode.compareBranches', async (argument) =>
        compareBranches(service, compareProvider, compareTree, argument, true),
    );
    command('aicode.compareBranchesWithoutFetch', async (argument) =>
        compareBranches(service, compareProvider, compareTree, argument, false),
    );
    command('aicode.refreshCompareResults', async () => refreshCompareResults(service, compareProvider, compareTree));
    command('aicode.clearCompareResults', async () => {
        await compareProvider.clear();
        compareTree.description = '';
    });
    command('aicode.openCompareResult', async (argument) => {
        if (argument instanceof CompareResultNode && argument.entry !== undefined) {
            await openCompareResult(argument.result, argument.entry);
        }
    });
    void setContextFilesCollapsed(false);
}

async function groupInput(service: ContextService, argument: unknown, title: string, copy: boolean): Promise<void> {
    const folder = await selectFolder(service, argument);
    if (folder === undefined) {
        return;
    }
    const config = await requireConfig(service, folder);
    if (config === undefined) {
        return;
    }
    const value = copy ? `${config.activeGroup} Copy` : '';
    const name = await vscode.window.showInputBox({ title, value });
    if (name !== undefined && name.trim() !== '') {
        await service.createGroup(folder, name, copy);
    }
}

async function updateExplorerResourceContext(service: ContextService): Promise<void> {
    const resources: Record<string, true> = {};
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const loaded = await service.load(folder);
        if (loaded.kind !== 'ok') {
            continue;
        }
        for (const relativePath of loaded.config.groups[loaded.config.activeGroup] ?? []) {
            const segments = relativePath.split('/');
            for (let length = 1; length <= segments.length; length += 1) {
                resources[vscode.Uri.joinPath(folder.uri, ...segments.slice(0, length)).toString()] = true;
            }
        }
    }
    await vscode.commands.executeCommand('setContext', 'aicode.contextResources', resources);
}

async function selectFolder(_service: ContextService, argument: unknown): Promise<vscode.WorkspaceFolder | undefined> {
    if (argument instanceof ContextNode) {
        return argument.folder;
    }
    const uri = argument instanceof vscode.Uri ? argument : vscode.window.activeTextEditor?.document.uri;
    const direct = uri === undefined ? undefined : vscode.workspace.getWorkspaceFolder(uri);
    if (direct !== undefined) {
        return direct;
    }
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        await vscode.window.showWarningMessage('Open a folder or workspace before using AICode Context.');
        return undefined;
    }
    if (folders.length === 1) {
        return folders[0];
    }
    const choice = await vscode.window.showQuickPick(folders.map((folder) => ({ label: folder.name, folder })));
    return choice?.folder;
}

async function requireConfig(service: ContextService, folder: vscode.WorkspaceFolder) {
    const loaded = await service.load(folder);
    if (loaded.kind === 'invalid') {
        throw new Error(loaded.message);
    }
    return loaded.kind === 'ok' ? loaded.config : { activeGroup: 'Default', groups: { Default: [] } };
}

async function loadSelected(service: ContextService, argument: unknown) {
    const folder = await selectFolder(service, argument);
    if (folder === undefined) {
        return undefined;
    }
    const config = await requireConfig(service, folder);
    return config === undefined ? undefined : { folder, config };
}

function getUris(first: unknown, second: unknown): vscode.Uri[] {
    if (Array.isArray(second)) {
        return second.filter((entry): entry is vscode.Uri => entry instanceof vscode.Uri);
    }
    if (first instanceof ContextNode && first.relativePath !== undefined) {
        return [vscode.Uri.joinPath(first.folder.uri, ...first.relativePath.split('/'))];
    }
    return first instanceof vscode.Uri ? [first] : activeUri();
}

function activeUri(): vscode.Uri[] {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri === undefined ? [] : [uri];
}

function nodePaths(value: unknown): string[] {
    return value instanceof ContextNode && value.relativePath !== undefined ? [value.relativePath] : [];
}

function isString(value: string | undefined): value is string {
    return value !== undefined;
}
function isTarget(value: ContextTarget | undefined): value is ContextTarget {
    return value !== undefined;
}
function shellQuote(value: string): string {
    return /^[A-Za-z0-9_@./-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'"'"'`)}'`;
}

async function run(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        await vscode.window.showErrorMessage(
            `AICode Context: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

class ConfigDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
    public readonly onDidChangeFileDecorations = this.emitter.event;
    public constructor(service: ContextService) {
        service.onDidChange((folder) => this.emitter.fire(service.configUri(folder)));
    }
    public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder === undefined || uri.toString() !== vscode.Uri.joinPath(folder.uri, CONFIG_FILE).toString()) {
            return undefined;
        }
        return { badge: 'AI', color: new vscode.ThemeColor('charts.purple'), tooltip: 'AICode Context configuration' };
    }
    public dispose(): void {
        this.emitter.dispose();
    }
}

class EditorIndicator implements vscode.Disposable {
    private readonly bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    private readonly disposables: vscode.Disposable[];
    public constructor(
        private readonly service: ContextService,
        private readonly context: vscode.ExtensionContext,
    ) {
        this.bar.text = '$(symbol-file) AICode Context';
        this.bar.command = 'aicode.removeFromContext';
        this.disposables = [
            this.bar,
            vscode.window.onDidChangeActiveTextEditor(() => void this.update()),
            vscode.workspace.onDidChangeWorkspaceFolders(() => void this.update()),
            service.onDidChange(() => void this.update()),
        ];
        void this.update();
    }
    public async setVisible(folder: vscode.WorkspaceFolder | undefined, visible: boolean): Promise<void> {
        if (folder === undefined) {
            return;
        }
        const key = `aicode.indicator.${folder.uri.toString()}`;
        await this.context.workspaceState.update(key, visible);
        await this.update();
    }
    private async update(): Promise<void> {
        this.bar.hide();
        const uri = vscode.window.activeTextEditor?.document.uri;
        const target = uri === undefined ? undefined : this.service.resolve(uri);
        const contextFolder =
            target?.folder ??
            (vscode.workspace.workspaceFolders?.length === 1 ? vscode.workspace.workspaceFolders[0] : undefined);
        const visible =
            contextFolder !== undefined &&
            this.context.workspaceState.get(`aicode.indicator.${contextFolder.uri.toString()}`, false);
        await vscode.commands.executeCommand('setContext', 'aicode.editorIndicatorVisible', visible);
        if (target === undefined || !visible) {
            return;
        }
        const loaded = await this.service.load(target.folder);
        if (
            loaded.kind !== 'ok' ||
            !(loaded.config.groups[loaded.config.activeGroup] ?? []).includes(target.relativePath)
        ) {
            return;
        }
        this.bar.tooltip = `${target.folder.name} · ${loaded.config.activeGroup} · ${target.relativePath}`;
        this.bar.show();
    }
    public dispose(): void {
        this.disposables.forEach((item) => item.dispose());
    }
}

interface CompareResult {
    folder: vscode.WorkspaceFolder;
    current: string;
    compare: string;
    entries: Array<{ path: string; changed: boolean }>;
}

class CompareResultNode extends vscode.TreeItem {
    public constructor(
        public readonly result: CompareResult,
        public readonly entry: string | undefined,
        public readonly changed: boolean,
    ) {
        super(
            entry ??
                `${changed ? 'Changed' : 'Unchanged'} (${result.entries.filter((item) => item.changed === changed).length})`,
            entry === undefined
                ? changed
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None,
        );
        if (entry === undefined) {
            this.contextValue = 'aicode.compareGroup';
            this.iconPath = new vscode.ThemeIcon(changed ? 'diff' : 'check');
            return;
        }
        this.contextValue = 'aicode.compareFile';
        this.iconPath = new vscode.ThemeIcon('file');
        this.tooltip = `${entry}\nLeft: ${displayBranch(result.compare)}\nRight: ${result.current} (Working Tree)`;
        this.command = { command: 'aicode.openCompareResult', title: 'Open Comparison', arguments: [this] };
    }
}

class CompareResultsProvider implements vscode.TreeDataProvider<CompareResultNode>, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<CompareResultNode | undefined>();
    private result: CompareResult | undefined;
    public readonly onDidChangeTreeData = this.emitter.event;

    public getTreeItem(element: CompareResultNode): vscode.TreeItem {
        return element;
    }

    public current(): CompareResult | undefined {
        return this.result;
    }

    public getChildren(element?: CompareResultNode): CompareResultNode[] {
        if (this.result === undefined) {
            return [];
        }
        if (element === undefined) {
            return [
                new CompareResultNode(this.result, undefined, true),
                new CompareResultNode(this.result, undefined, false),
            ];
        }
        if (element.entry !== undefined) {
            return [];
        }
        return this.result.entries
            .filter((entry) => entry.changed === element.changed)
            .map((entry) => new CompareResultNode(this.result!, entry.path, entry.changed));
    }

    public async setResult(result: CompareResult): Promise<void> {
        this.result = result;
        await vscode.commands.executeCommand('setContext', 'aicode.compareResultsAvailable', true);
        this.emitter.fire(undefined);
    }

    public async clear(): Promise<void> {
        this.result = undefined;
        await vscode.commands.executeCommand('setContext', 'aicode.compareResultsAvailable', false);
        this.emitter.fire(undefined);
    }

    public dispose(): void {
        this.emitter.dispose();
    }
}

async function compareBranches(
    service: ContextService,
    resultsProvider: CompareResultsProvider,
    resultsTree: vscode.TreeView<CompareResultNode>,
    argument: unknown,
    fetchBranches: boolean,
): Promise<void> {
    const folder = await selectFolder(service, argument);
    if (folder === undefined) {
        return;
    }
    const config = await requireConfig(service, folder);
    if (config === undefined) {
        return;
    }
    const paths = config.groups[config.activeGroup] ?? [];
    if (!(await saveDirtyContextFiles(service, folder, paths))) {
        return;
    }
    if (fetchBranches && !(await fetchLatestBranches(folder))) {
        return;
    }
    const current = (await execGit(folder, ['branch', '--show-current'])).trim();
    if (current === '') {
        await vscode.window.showWarningMessage('Detached HEAD is not supported.');
        return;
    }
    const branches = parseBranchOptions(
        await execGit(folder, [
            'for-each-ref',
            '--format=%(refname)%00%(refname:short)%00%(symref)',
            'refs/heads',
            'refs/remotes',
        ]),
        current,
    );
    if (branches.length === 0) {
        await vscode.window.showInformationMessage(`No branch is available to compare with ${current}.`);
        return;
    }
    const selection = await vscode.window.showQuickPick(
        branches.map((branch) => ({
            label: `$(git-branch) ${branch.label}`,
            description: branch.type,
            detail: `${branch.label} ↔ ${current} (Working Tree)`,
            branch: branch.ref,
        })),
        {
            title: 'Compare Context Branches',
            placeHolder: `Select a branch to compare with ${current}`,
        },
    );
    if (selection === undefined) {
        return;
    }
    const compare = selection.branch;
    await resultsProvider.setResult(await buildCompareResult(folder, current, compare, paths));
    resultsTree.description = `${current} ↔ ${displayBranch(compare)}`;
    await vscode.commands.executeCommand('aicode.compareResults.focus');
}

async function refreshCompareResults(
    service: ContextService,
    resultsProvider: CompareResultsProvider,
    resultsTree: vscode.TreeView<CompareResultNode>,
): Promise<void> {
    const previous = resultsProvider.current();
    if (previous === undefined) {
        return;
    }
    const paths = previous.entries.map((entry) => entry.path);
    if (!(await saveDirtyContextFiles(service, previous.folder, paths))) {
        return;
    }
    const current = (await execGit(previous.folder, ['branch', '--show-current'])).trim();
    if (current === '') {
        await vscode.window.showWarningMessage('Detached HEAD is not supported.');
        return;
    }
    await resultsProvider.setResult(await buildCompareResult(previous.folder, current, previous.compare, paths));
    resultsTree.description = `${current} ↔ ${displayBranch(previous.compare)}`;
}

async function buildCompareResult(
    folder: vscode.WorkspaceFolder,
    current: string,
    compare: string,
    paths: string[],
): Promise<CompareResult> {
    const [trackedOutput, untrackedOutput] = await Promise.all([
        execGit(folder, ['diff', '--name-only', '--no-renames', compare, '--', ...paths]),
        execGit(folder, ['ls-files', '--others', '--exclude-standard', '--', ...paths]),
    ]);
    const changed = classifyChangedPaths(paths, trackedOutput, untrackedOutput);
    const entries = paths
        .map((entry) => ({ path: entry, changed: changed.has(entry) }))
        .sort((left, right) => Number(right.changed) - Number(left.changed) || left.path.localeCompare(right.path));
    return { folder, current, compare, entries };
}

async function openCompareResult(result: CompareResult, relativePath: string): Promise<void> {
    const workingUri = vscode.Uri.joinPath(result.folder.uri, ...relativePath.split('/'));
    const compareUri = workingUri.with({
        scheme: 'git',
        query: JSON.stringify({ path: workingUri.fsPath, ref: result.compare }),
    });
    await vscode.commands.executeCommand(
        'vscode.diff',
        compareUri,
        workingUri,
        `${relativePath} — ${displayBranch(result.compare)} (Left) ↔ ${result.current} (Right, Working Tree)`,
    );
}

async function setContextFilesCollapsed(collapsed: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'aicode.contextFilesCollapsed', collapsed);
}

function displayBranch(branch: string): string {
    return branch.replace(/^refs\/(?:heads|remotes)\//u, '').replace(/^remotes\//u, '');
}

async function saveDirtyContextFiles(
    service: ContextService,
    folder: vscode.WorkspaceFolder,
    paths: string[],
): Promise<boolean> {
    const contextPaths = new Set(paths);
    const dirtyDocuments = vscode.workspace.textDocuments.filter((document) => {
        if (!document.isDirty || document.isUntitled) {
            return false;
        }
        const target = service.resolve(document.uri);
        return target?.folder.uri.toString() === folder.uri.toString() && contextPaths.has(target.relativePath);
    });
    if (dirtyDocuments.length === 0) {
        return true;
    }
    const choice = await vscode.window.showWarningMessage(
        `${dirtyDocuments.length} context file(s) have unsaved changes. Save them before comparing branches?`,
        { modal: true },
        'Save and Continue',
    );
    if (choice !== 'Save and Continue') {
        return false;
    }
    const saved = await Promise.all(dirtyDocuments.map((document) => document.save()));
    if (saved.every(Boolean)) {
        return true;
    }
    await vscode.window.showErrorMessage('Some context files could not be saved. Branch comparison was cancelled.');
    return false;
}

async function fetchLatestBranches(folder: vscode.WorkspaceFolder): Promise<boolean> {
    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Fetching the latest Git branches…',
                cancellable: false,
            },
            () => execGit(folder, ['fetch', '--all', '--prune']),
        );
        return true;
    } catch {
        const choice = await vscode.window.showWarningMessage(
            'Could not fetch the latest branches. Remote branches may be outdated.',
            { modal: true },
            'Continue with Cached Branches',
        );
        return choice === 'Continue with Cached Branches';
    }
}

async function execGit(folder: vscode.WorkspaceFolder, args: string[]): Promise<string> {
    const cp = await import('child_process');
    return new Promise((resolve, reject) =>
        cp.execFile('git', ['-C', folder.uri.fsPath, ...args], { encoding: 'utf8' }, (error, stdout, stderr) =>
            error === null ? resolve(stdout) : reject(new Error(stderr.trim() || error.message)),
        ),
    );
}
