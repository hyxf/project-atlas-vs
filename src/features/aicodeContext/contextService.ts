import * as path from 'path';
import * as vscode from 'vscode';
import { ConfigRepository, normalizeRelativePath, validateGroupName } from './configRepository';
import {
    AICodeConfig,
    CONFIG_FILE,
    ConfigLoadResult,
    ContextTarget,
    DEFAULT_GROUP,
    cloneConfig,
    defaultConfig,
} from './model';

export class ContextService implements vscode.Disposable {
    private readonly repository = new ConfigRepository();
    private readonly changedEmitter = new vscode.EventEmitter<vscode.WorkspaceFolder>();
    private readonly queues = new Map<string, Promise<void>>();
    private readonly watchers: vscode.Disposable[] = [];
    public readonly onDidChange = this.changedEmitter.event;

    public constructor() {
        const pattern = `**/${CONFIG_FILE}`;
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.watchers.push(
            watcher,
            watcher.onDidCreate((uri) => this.externalChange(uri)),
            watcher.onDidChange((uri) => this.externalChange(uri)),
            watcher.onDidDelete((uri) => this.externalChange(uri)),
            vscode.workspace.onDidDeleteFiles((event) => void this.syncDeleted(event.files)),
            vscode.workspace.onDidRenameFiles((event) => void this.syncRenamed(event.files)),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.fireAll()),
        );
    }

    public dispose(): void {
        this.changedEmitter.dispose();
        this.watchers.forEach((item) => item.dispose());
    }

    public load(folder: vscode.WorkspaceFolder): Promise<ConfigLoadResult> {
        return this.repository.load(folder);
    }

    public configUri(folder: vscode.WorkspaceFolder): vscode.Uri {
        return this.repository.configUri(folder);
    }

    public async mutate(folder: vscode.WorkspaceFolder, change: (config: AICodeConfig) => boolean): Promise<boolean> {
        let result = false;
        await this.enqueue(folder, async () => {
            const loaded = await this.load(folder);
            if (loaded.kind === 'invalid') {
                throw new Error(loaded.message);
            }
            const config = loaded.kind === 'ok' ? cloneConfig(loaded.config) : defaultConfig();
            if (!change(config)) {
                return;
            }
            await this.repository.save(folder, config, loaded.kind === 'ok' ? loaded.stamp : undefined);
            result = true;
            this.changedEmitter.fire(folder);
        });
        return result;
    }

    public async selectGroup(folder: vscode.WorkspaceFolder, name: string): Promise<boolean> {
        return this.mutate(folder, (config) => {
            if (!(name in config.groups)) {
                throw new Error(`Context group ${JSON.stringify(name)} does not exist.`);
            }
            if (config.activeGroup === name) {
                return false;
            }
            config.activeGroup = name;
            return true;
        });
    }

    public async createGroup(folder: vscode.WorkspaceFolder, input: string, copyCurrent = false): Promise<boolean> {
        const name = validateGroupName(input);
        return this.mutate(folder, (config) => {
            if (name in config.groups) {
                throw new Error(`Context group ${JSON.stringify(name)} already exists.`);
            }
            config.groups[name] = copyCurrent ? [...(config.groups[config.activeGroup] ?? [])] : [];
            config.activeGroup = name;
            return true;
        });
    }

    public async renameGroup(folder: vscode.WorkspaceFolder, input: string): Promise<boolean> {
        const name = validateGroupName(input);
        return this.mutate(folder, (config) => {
            const oldName = config.activeGroup;
            if (name === oldName) {
                return false;
            }
            if (name in config.groups) {
                throw new Error(`Context group ${JSON.stringify(name)} already exists.`);
            }
            config.groups = Object.fromEntries(
                Object.entries(config.groups).map(([key, value]) => [key === oldName ? name : key, value]),
            );
            config.activeGroup = name;
            return true;
        });
    }

    public async deleteGroup(folder: vscode.WorkspaceFolder): Promise<boolean> {
        return this.mutate(folder, (config) => {
            delete config.groups[config.activeGroup];
            const first = Object.keys(config.groups)[0];
            if (first === undefined) {
                config.groups[DEFAULT_GROUP] = [];
                config.activeGroup = DEFAULT_GROUP;
            } else {
                config.activeGroup = first;
            }
            return true;
        });
    }

    public async add(folder: vscode.WorkspaceFolder, uris: readonly vscode.Uri[]): Promise<number> {
        const paths = await this.collectEligible(folder, uris);
        let added = 0;
        await this.mutate(folder, (config) => {
            const current = config.groups[config.activeGroup] ?? [];
            const known = new Set(current);
            const additions = paths.filter((entry) => !known.has(entry)).sort((a, b) => a.localeCompare(b));
            added = additions.length;
            current.push(...additions);
            config.groups[config.activeGroup] = current;
            return additions.length > 0;
        });
        return added;
    }

    public async remove(folder: vscode.WorkspaceFolder, relativePaths: readonly string[]): Promise<number> {
        let removed = 0;
        await this.mutate(folder, (config) => {
            const targets = relativePaths.map((entry) => normalizeRelativePath(entry));
            const current = config.groups[config.activeGroup] ?? [];
            const next = current.filter(
                (entry) => !targets.some((target) => entry === target || entry.startsWith(`${target}/`)),
            );
            removed = current.length - next.length;
            config.groups[config.activeGroup] = next;
            return removed > 0;
        });
        return removed;
    }

    public async clearActiveGroup(folder: vscode.WorkspaceFolder): Promise<number> {
        let removed = 0;
        await this.mutate(folder, (config) => {
            const current = config.groups[config.activeGroup] ?? [];
            removed = current.length;
            config.groups[config.activeGroup] = [];
            return removed > 0;
        });
        return removed;
    }

    public async hasMissingFiles(folder: vscode.WorkspaceFolder, directory: vscode.Uri): Promise<boolean> {
        const loaded = await this.load(folder);
        if (loaded.kind !== 'ok') {
            return false;
        }
        const current = new Set(loaded.config.groups[loaded.config.activeGroup] ?? []);
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(directory, '**/*'),
            defaultExclude(),
            10000,
        );
        for (const file of files) {
            const target = this.resolve(file);
            if (
                target !== undefined &&
                target.relativePath !== CONFIG_FILE &&
                !current.has(target.relativePath) &&
                !(await isBinary(file))
            ) {
                return true;
            }
        }
        return false;
    }

    public resolve(uri: vscode.Uri): ContextTarget | undefined {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder === undefined || uri.toString() === folder.uri.toString()) {
            return undefined;
        }
        const relativePath = path.posix.relative(folder.uri.path, uri.path);
        if (relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
            return undefined;
        }
        return { folder, relativePath: normalizeRelativePath(relativePath), uri };
    }

    private async collectEligible(folder: vscode.WorkspaceFolder, uris: readonly vscode.Uri[]): Promise<string[]> {
        const results = new Set<string>();
        for (const uri of uris) {
            const target = this.resolve(uri);
            if (target?.folder.uri.toString() !== folder.uri.toString()) {
                continue;
            }
            const stat = await vscode.workspace.fs.stat(uri);
            if ((stat.type & vscode.FileType.Directory) !== 0) {
                const pattern = new vscode.RelativePattern(uri, '**/*');
                const files = await vscode.workspace.findFiles(pattern, defaultExclude(), 10000);
                for (const file of files) {
                    const nested = this.resolve(file);
                    if (nested !== undefined && nested.relativePath !== CONFIG_FILE && !(await isBinary(file))) {
                        results.add(nested.relativePath);
                    }
                }
            } else if (target.relativePath !== CONFIG_FILE && !(await isBinary(uri))) {
                results.add(target.relativePath);
            }
        }
        return [...results];
    }

    private async syncDeleted(uris: readonly vscode.Uri[]): Promise<void> {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const targets = uris.flatMap((uri) => {
                const target = this.resolve(uri);
                return target?.folder.uri.toString() === folder.uri.toString() ? [target.relativePath] : [];
            });
            if (targets.length > 0) {
                await this.mutateAllGroups(
                    folder,
                    (entry) => !targets.some((target) => entry === target || entry.startsWith(`${target}/`)),
                );
            }
        }
    }

    private async syncRenamed(files: readonly { oldUri: vscode.Uri; newUri: vscode.Uri }[]): Promise<void> {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            const pairs = files.flatMap(({ oldUri, newUri }) => {
                const oldTarget = this.resolve(oldUri);
                const newTarget = this.resolve(newUri);
                return oldTarget?.folder.uri.toString() === folder.uri.toString()
                    ? [
                          {
                              old: oldTarget.relativePath,
                              next:
                                  newTarget?.folder.uri.toString() === folder.uri.toString()
                                      ? newTarget.relativePath
                                      : undefined,
                          },
                      ]
                    : [];
            });
            if (pairs.length === 0) {
                continue;
            }
            await this.mutate(folder, (config) => {
                let changed = false;
                for (const [name, entries] of Object.entries(config.groups)) {
                    const next = entries.flatMap((entry) => {
                        const pair = pairs.find(({ old }) => entry === old || entry.startsWith(`${old}/`));
                        if (pair === undefined) {
                            return [entry];
                        }
                        changed = true;
                        return pair.next === undefined ? [] : [`${pair.next}${entry.slice(pair.old.length)}`];
                    });
                    config.groups[name] = [...new Set(next)];
                }
                return changed;
            });
        }
    }

    private mutateAllGroups(folder: vscode.WorkspaceFolder, keep: (entry: string) => boolean): Promise<boolean> {
        return this.mutate(folder, (config) => {
            let changed = false;
            for (const [name, entries] of Object.entries(config.groups)) {
                const next = entries.filter(keep);
                changed ||= next.length !== entries.length;
                config.groups[name] = next;
            }
            return changed;
        });
    }

    private enqueue(folder: vscode.WorkspaceFolder, task: () => Promise<void>): Promise<void> {
        const key = folder.uri.toString();
        const previous = this.queues.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.queues.set(key, next);
        return next.finally(() => {
            if (this.queues.get(key) === next) {
                this.queues.delete(key);
            }
        });
    }

    private externalChange(uri: vscode.Uri): void {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder !== undefined && uri.toString() === this.configUri(folder).toString()) {
            this.changedEmitter.fire(folder);
        }
    }

    private fireAll(): void {
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            this.changedEmitter.fire(folder);
        }
    }
}

function defaultExclude(): string {
    return '**/{.git,.vscode,.gradle,build,target,out,node_modules,dist,.mvn,venv,__pycache__}/**';
}

async function isBinary(uri: vscode.Uri): Promise<boolean> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return bytes.subarray(0, 8192).includes(0);
    } catch {
        return true;
    }
}
