import { randomUUID } from 'crypto';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { applyEdits, modify } from 'jsonc-parser';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as vscode from 'vscode';
import { GitHubConfigurationStore } from '../githubRepositories/config';
import { ensureDocumentSaved, ensureSourceUnchanged } from '../packageVersion/packageVersionService';

type DependencyKind = 'dependencies' | 'devDependencies';

interface PackageEntry {
    name: string;
    version?: string | undefined;
    kind?: DependencyKind | undefined;
}

interface NpmSearchResult {
    name: string;
    version: string;
    description?: string | undefined;
}

const favoritesFile = path.join(os.homedir(), '.project-atlas', 'npmfav.json');
const proxyConfigurationStore = new GitHubConfigurationStore();

export function activateNpmPackages(context: vscode.ExtensionContext): void {
    const provider = new NpmPackagesTree();
    const refresh = async () => {
        await provider.refresh();
        await setVisibility();
    };
    const setVisibility = async () => {
        const uri = workspacePackageUri();
        let available = false;
        if (uri) {
            try {
                available = (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File;
            } catch {
                available = false;
            }
        }
        await vscode.commands.executeCommand('setContext', 'projectAtlas.npmPackagesAvailable', available);
    };
    const register = (name: string, action: (...args: never[]) => Promise<void>) =>
        context.subscriptions.push(vscode.commands.registerCommand(`project-atlas.${name}`, action));

    register('refreshNpmPackages', refresh);
    register('searchNpmPackages', async () => openSearchPanel(provider));
    register('addNpmPackage', async () => openSearchPanel(provider));
    register('editNpmFavoritesFile', async () => {
        await ensureFavoritesFile();
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(favoritesFile)));
    });
    register('openNpmPackageHomepage', async (item: NpmPackageNode) => {
        if (item) {
            await vscode.env.openExternal(
                vscode.Uri.parse(`https://www.npmjs.com/package/${encodeURIComponent(item.entry.name)}`),
            );
        }
    });
    register('removeNpmPackage', async (item: NpmPackageNode) => {
        if (item?.entry.kind) {
            const confirmed = await vscode.window.showWarningMessage(
                `Remove ${item.entry.name} from ${item.entry.kind === 'dependencies' ? 'Dependencies' : 'Dev Dependencies'}?`,
                { modal: true },
                'Remove',
            );
            if (confirmed !== 'Remove') {
                return;
            }
            await updateDependencies(item.entry.name, item.entry.kind, false);
            await refresh();
        }
    });
    register('addFavoriteNpmPackageToDependencies', async (item: NpmPackageNode) => {
        if (!item || item.entry.kind || (await isInstalled(item.entry.name))) {
            return;
        }
        await updateDependencies(item.entry.name, 'dependencies', true, item.entry.version || 'latest');
        await refresh();
    });
    register('addFavoriteNpmPackageToDevDependencies', async (item: NpmPackageNode) => {
        if (!item || item.entry.kind || (await isInstalled(item.entry.name))) {
            return;
        }
        await updateDependencies(item.entry.name, 'devDependencies', true, item.entry.version || 'latest');
        await refresh();
    });
    register('addNpmPackageFavorite', async (item: NpmPackageNode) => {
        if (!item) {
            return;
        }
        await saveFavorite(item.entry);
        await refresh();
    });
    register('removeNpmPackageFavorite', async (item: NpmPackageNode) => {
        if (item) {
            await removeFavorite(item.entry.name);
            await refresh();
        }
    });

    context.subscriptions.push(vscode.window.registerTreeDataProvider('projectAtlas.npmPackages', provider));
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()),
        vscode.workspace.createFileSystemWatcher('**/package.json'),
    );
    const watcher = context.subscriptions[context.subscriptions.length - 1] as vscode.FileSystemWatcher;
    context.subscriptions.push(
        watcher.onDidCreate(() => void refresh()),
        watcher.onDidChange(() => void refresh()),
        watcher.onDidDelete(() => void refresh()),
    );
    void refresh();
}

type NpmTreeNode = NpmInstallNode | NpmPackageGroupNode | NpmPackageNode;

class NpmPackagesTree implements vscode.TreeDataProvider<NpmTreeNode> {
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
                const installed = await readInstalled();
                const names = new Set(
                    [...installed.dependencies, ...installed.devDependencies].map((entry) => entry.name),
                );
                return element.entries.map(
                    (entry) =>
                        new NpmPackageNode(
                            entry,
                            names.has(entry.name) ? 'npmFavoritePackage' : 'npmFavoritePackageAddable',
                            element,
                        ),
                );
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
        const favorites = await readFavorites();
        return [new NpmInstallNode(), new NpmPackageGroupNode('favorites', favorites)];
    }

    getTreeItem(element: NpmTreeNode): vscode.TreeItem {
        return element;
    }

    getParent(element: NpmTreeNode): NpmInstallNode | NpmPackageGroupNode | undefined {
        return element instanceof NpmPackageNode || element instanceof NpmPackageGroupNode ? element.parent : undefined;
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
    readonly label: string;
    constructor(
        readonly kind: DependencyKind | 'favorites',
        readonly entries: PackageEntry[],
        readonly parent?: NpmInstallNode | undefined,
    ) {
        const label =
            kind === 'dependencies' ? 'Dependencies' : kind === 'devDependencies' ? 'Dev Dependencies' : 'Favorites';
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.label = label;
        this.id = parent ? `${parent.id}:${kind}` : `npm-group:${kind}`;
        this.contextValue = 'npmPackageGroup';
        this.description = String(entries.length);
        this.iconPath = new vscode.ThemeIcon(kind === 'favorites' ? 'star-full' : 'library');
    }
}

class NpmPackageNode extends vscode.TreeItem {
    constructor(
        readonly entry: PackageEntry,
        contextValue:
            'npmInstalledPackage' | 'npmInstalledPackageFavorite' | 'npmFavoritePackage' | 'npmFavoritePackageAddable',
        readonly parent: NpmPackageGroupNode,
    ) {
        super(entry.name, vscode.TreeItemCollapsibleState.None);
        this.id = `${parent.id}:${entry.name}`;
        if (entry.version) {
            this.description = entry.version;
        }
        this.tooltip = entry.version ? `${entry.name}@${entry.version}` : entry.name;
        this.contextValue = contextValue;
        this.iconPath = new vscode.ThemeIcon(contextValue.startsWith('npmInstalled') ? 'package' : 'star-full');
    }
}

function workspacePackageUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length === 1 ? vscode.Uri.joinPath(folders[0]!.uri, 'package.json') : undefined;
}

async function readInstalled(): Promise<Record<DependencyKind, PackageEntry[]>> {
    const uri = workspacePackageUri();
    if (!uri) {
        return { dependencies: [], devDependencies: [] };
    }
    try {
        const document = parsePackageJson(await vscode.workspace.fs.readFile(uri));
        return {
            dependencies: entriesOf(document.dependencies, 'dependencies'),
            devDependencies: entriesOf(document.devDependencies, 'devDependencies'),
        };
    } catch {
        return { dependencies: [], devDependencies: [] };
    }
}

function entriesOf(value: unknown, kind: DependencyKind): PackageEntry[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }
    return Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .map(([name, version]) => ({ name, version, kind }))
        .sort((left, right) => left.name.localeCompare(right.name));
}

async function readFavorites(): Promise<PackageEntry[]> {
    try {
        const source: unknown = JSON.parse(await fs.readFile(favoritesFile, 'utf8'));
        const items = Array.isArray(source) ? source : (source as { favorites?: unknown }).favorites;
        return Array.isArray(items)
            ? items
                  .filter((item): item is PackageEntry => Boolean(item) && typeof item.name === 'string')
                  .map(({ name, version }) => ({ name, version }))
                  .sort((left, right) => left.name.localeCompare(right.name))
            : [];
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw new Error(`Could not read ${favoritesFile}. Fix the JSON and refresh.`);
    }
}

async function saveFavorite(entry: PackageEntry): Promise<void> {
    const favorites = await readFavorites();
    if (favorites.some((favorite) => favorite.name === entry.name)) {
        return;
    }
    await fs.mkdir(path.dirname(favoritesFile), { recursive: true });
    const temporary = `${favoritesFile}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(
            temporary,
            `${JSON.stringify({ favorites: [...favorites, { name: entry.name, version: entry.version }] }, null, 2)}\n`,
            {
                encoding: 'utf8',
                flag: 'wx',
            },
        );
        await fs.rename(temporary, favoritesFile);
    } finally {
        await fs.unlink(temporary).catch(() => undefined);
    }
}

async function ensureFavoritesFile(): Promise<void> {
    await fs.mkdir(path.dirname(favoritesFile), { recursive: true });
    await fs.writeFile(favoritesFile, '{\n  "favorites": []\n}\n', { encoding: 'utf8', flag: 'wx' }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    });
}

async function removeFavorite(name: string): Promise<void> {
    const favorites = await readFavorites();
    if (!favorites.some((entry) => entry.name === name)) {
        return;
    }
    await fs.mkdir(path.dirname(favoritesFile), { recursive: true });
    const temporary = `${favoritesFile}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(
            temporary,
            `${JSON.stringify({ favorites: favorites.filter((entry) => entry.name !== name) }, null, 2)}\n`,
            { encoding: 'utf8', flag: 'wx' },
        );
        await fs.rename(temporary, favoritesFile);
    } finally {
        await fs.unlink(temporary).catch(() => undefined);
    }
}

async function isInstalled(name: string): Promise<boolean> {
    const installed = await readInstalled();
    return [...installed.dependencies, ...installed.devDependencies].some((entry) => entry.name === name);
}

async function chooseAndInstall(entry: PackageEntry): Promise<void> {
    const choice = await vscode.window.showQuickPick<{ label: string; target: DependencyKind }>(
        [
            { label: 'Dependencies', target: 'dependencies' as const },
            { label: 'Dev Dependencies', target: 'devDependencies' as const },
        ],
        { placeHolder: `Add ${entry.name} to` },
    );
    if (choice) {
        await updateDependencies(entry.name, choice.target, true, entry.version || 'latest');
    }
}

async function updateDependencies(name: string, kind: DependencyKind, add: boolean, version?: string): Promise<void> {
    const uri = workspacePackageUri();
    if (!uri) {
        throw new Error('Open exactly one workspace folder with a root package.json.');
    }
    ensurePackageJsonSaved(uri);
    const initial = await vscode.workspace.fs.readFile(uri);
    parsePackageJson(initial);
    if (add) {
        if (await isInstalled(name)) {
            throw new Error(`${name} is already installed.`);
        }
    }
    const source = new TextDecoder().decode(initial);
    const updated = new TextEncoder().encode(
        updatePackageJsonText(source, kind, name, add ? (version ?? 'latest') : undefined),
    );
    const temporary = vscode.Uri.joinPath(vscode.Uri.joinPath(uri, '..'), `.package.json.${randomUUID()}.tmp`);
    try {
        await vscode.workspace.fs.writeFile(temporary, updated);
        const latest = await vscode.workspace.fs.readFile(uri);
        ensureSourceUnchanged(initial, latest);
        ensurePackageJsonSaved(uri);
        await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
    } finally {
        await Promise.resolve(vscode.workspace.fs.delete(temporary)).catch(() => undefined);
    }
}

function updatePackageJsonText(
    source: string,
    kind: DependencyKind,
    name: string,
    version: string | undefined,
): string {
    const indentation = source.match(/\n(\s+)"/)?.[1] ?? '  ';
    return applyEdits(
        source,
        modify(source, [kind, name], version, {
            formattingOptions: {
                insertSpaces: !indentation.includes('\t'),
                tabSize: indentation.includes('\t') ? 4 : indentation.length,
                eol: source.includes('\r\n') ? '\r\n' : '\n',
            },
        }),
    );
}

function ensurePackageJsonSaved(uri: vscode.Uri): void {
    ensureDocumentSaved(
        vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString())?.isDirty ?? false,
    );
}

function parsePackageJson(bytes: Uint8Array): Record<string, unknown> {
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('package.json must contain an object.');
    }
    return data as Record<string, unknown>;
}

function openSearchPanel(provider: NpmPackagesTree): void {
    const panel = vscode.window.createWebviewPanel(
        'projectAtlas.npmPackagesSearch',
        'Search npm Packages',
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
            localResourceRoots: [],
        },
    );
    panel.webview.html = searchHtml();
    const listener = panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!message || typeof message !== 'object') {
            return;
        }
        const value = message as { action?: unknown; text?: unknown; from?: unknown; entry?: unknown };
        try {
            if (value.action === 'search' && typeof value.text === 'string') {
                await panel.webview.postMessage({
                    type: 'results',
                    ...(await searchNpm(value.text, Number(value.from) || 0)),
                });
            } else if ((value.action === 'favorite' || value.action === 'install') && isEntry(value.entry)) {
                if (value.action === 'favorite') {
                    await saveFavorite(value.entry);
                } else {
                    await chooseAndInstall(value.entry);
                }
                await provider.refresh();
                await panel.webview.postMessage({ type: 'done', action: value.action, name: value.entry.name });
            }
        } catch (error) {
            await panel.webview.postMessage({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
            });
        }
    });
    panel.onDidDispose(() => listener.dispose());
}

function isEntry(value: unknown): value is PackageEntry {
    return (
        Boolean(value) &&
        typeof value === 'object' &&
        typeof (value as PackageEntry).name === 'string' &&
        typeof (value as PackageEntry).version === 'string'
    );
}

async function searchNpm(
    text: string,
    from: number,
): Promise<{ results: NpmSearchResult[]; total: number; from: number }> {
    const query = text.trim();
    if (!query) {
        return { results: [], total: 0, from: 0 };
    }
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20&from=${Math.max(0, from)}`;
    const proxyUrl = await npmProxyUrl();
    try {
        return await requestNpmSearch(url, from, proxyUrl);
    } catch (error) {
        if (proxyUrl) {
            return requestNpmSearch(url, from);
        }
        throw error;
    }
}

function requestNpmSearch(
    url: string,
    from: number,
    proxyUrl?: string,
): Promise<{ results: NpmSearchResult[]; total: number; from: number }> {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            {
                ...(proxyUrl
                    ? {
                          agent: proxyUrl.toLowerCase().startsWith('socks')
                              ? new SocksProxyAgent(proxyUrl)
                              : new HttpsProxyAgent(proxyUrl),
                      }
                    : {}),
                headers: { Accept: 'application/json', 'User-Agent': 'project-atlas-vs' },
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk: string) => (body += chunk));
                response.on('end', () => {
                    if (response.statusCode !== 200) {
                        reject(new Error(`npm search failed with status ${response.statusCode ?? 'unknown'}.`));
                        return;
                    }
                    try {
                        const parsed = JSON.parse(body) as {
                            total?: unknown;
                            objects?: Array<{ package?: NpmSearchResult }>;
                        };
                        resolve({
                            results: (parsed.objects ?? [])
                                .map((item) => item.package)
                                .filter((item): item is NpmSearchResult => Boolean(item?.name && item.version)),
                            total: typeof parsed.total === 'number' ? parsed.total : 0,
                            from: Math.max(0, from),
                        });
                    } catch {
                        reject(new Error('npm returned an invalid search response.'));
                    }
                });
            },
        );
        request.on('error', () =>
            reject(
                new Error('Could not connect to the npm registry. Check your network connection and proxy settings.'),
            ),
        );
        request.setTimeout(30_000, () => request.destroy(new Error('npm search timed out.')));
    });
}

async function npmProxyUrl(): Promise<string | undefined> {
    const githubProxy = await proxyConfigurationStore.proxyConfiguration();
    if (githubProxy.enabled) {
        return githubProxy.url ?? githubProxy.socketUrl;
    }
    const vscodeProxy = vscode.workspace.getConfiguration('http').get<string>('proxy')?.trim();
    return (
        vscodeProxy ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy
    );
}

function searchHtml(): string {
    const nonce = randomUUID();
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src https://registry.npmjs.org; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
:root{color-scheme:var(--vscode-color-scheme)}*{box-sizing:border-box}body{max-width:920px;margin:0 auto;padding:18px 20px 32px;font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}.hero{position:relative;padding:18px 20px 16px;border:1px solid var(--vscode-panel-border);border-radius:10px;background:linear-gradient(115deg,var(--vscode-sideBar-background),var(--vscode-editorWidget-background));box-shadow:0 6px 20px rgba(0,0,0,.1)}.hero:before{position:absolute;top:0;left:0;width:4px;height:100%;border-radius:10px 0 0 10px;background:var(--vscode-textLink-foreground);content:''}.eyebrow{color:var(--vscode-textLink-foreground);font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}.hero h1{margin:4px 0 3px;font-size:20px;line-height:1.25}.hero p{margin:0 0 14px;color:var(--vscode-descriptionForeground)}form{display:flex;gap:8px}input{min-width:0;flex:1;height:34px;border:1px solid var(--vscode-input-border);border-radius:6px;padding:0 10px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);font:inherit}input:focus{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}button{height:32px;border:0;border-radius:6px;padding:0 11px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);font:inherit;font-size:12px;font-weight:600;cursor:pointer}button:hover{background:var(--vscode-button-hoverBackground)}.secondary{color:var(--vscode-foreground);background:var(--vscode-button-secondaryBackground)}.secondary:hover{background:var(--vscode-button-secondaryHoverBackground)}#status{min-height:18px;margin:14px 2px 8px;color:var(--vscode-descriptionForeground);font-size:12px}#results{display:grid;gap:7px}.card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:11px 13px;border:1px solid transparent;border-radius:8px;background:var(--vscode-sideBar-background);box-shadow:inset 0 0 0 1px var(--vscode-panel-border);transition:border-color .12s,background .12s}.card:hover{border-color:var(--vscode-focusBorder);background:var(--vscode-list-hoverBackground)}.name{overflow:hidden;font-size:14px;font-weight:700;text-overflow:ellipsis;white-space:nowrap}.version{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:4px;color:var(--vscode-textLink-foreground);background:var(--vscode-textCodeBlock-background);font-size:11px;font-weight:500}.description{display:-webkit-box;overflow:hidden;margin-top:4px;color:var(--vscode-descriptionForeground);line-height:1.35;-webkit-box-orient:vertical;-webkit-line-clamp:2}.actions{display:flex;gap:6px;white-space:nowrap}.actions button{height:28px;padding:0 9px}.actions .secondary{border:1px solid var(--vscode-panel-border)}nav{display:flex;justify-content:center;gap:8px;margin-top:14px}@media(max-width:560px){body{padding:12px}.hero{padding:15px}.card{grid-template-columns:1fr}.actions{justify-content:flex-start}form{flex-direction:column}form button{width:100%}}
</style></head><body><section class="hero"><div class="eyebrow">npm registry</div><h1>Discover packages</h1><p>Search the public npm registry, then add a package to Install or save it for later.</p><form id="search"><input id="query" autofocus placeholder="Search packages, for example react"><button id="search-button" type="button">Search npm</button></form></section><p id="status">Enter a package name and select Search npm.</p><main id="results"></main><nav id="pages"></nav><script nonce="${nonce}">
const vscode=acquireVsCodeApi(),q=document.getElementById('query'),status=document.getElementById('status'),results=document.getElementById('results'),pages=document.getElementById('pages');let query='',from=0,total=0;document.getElementById('search').addEventListener('submit',e=>e.preventDefault());document.getElementById('search-button').addEventListener('click',()=>{query=q.value;search(0)});async function search(page){query=query.trim();if(!query){status.textContent='Enter a package name first.';return}from=page;status.textContent='Searching npm…';try{const response=await fetch('https://registry.npmjs.org/-/v1/search?text='+encodeURIComponent(query)+'&size=20&from='+from);if(!response.ok)throw new Error('npm search failed with status '+response.status+'.');const data=await response.json();show({type:'results',results:(data.objects||[]).map(x=>x.package).filter(x=>x&&x.name&&x.version),total:typeof data.total==='number'?data.total:0,from})}catch(error){status.textContent=error instanceof Error?error.message:'Could not connect to the npm registry.'}}function button(label,action,secondary,entry){const b=document.createElement('button');b.textContent=label;if(secondary)b.className='secondary';b.onclick=()=>vscode.postMessage({action,entry});return b}function show(m){if(m.type==='error'){status.textContent=m.message;return}if(m.type==='done'){status.textContent=m.name+(m.action==='favorite'?' saved to Favorites.':' added to Install.');return}if(m.type!=='results')return;from=m.from;total=m.total;status.textContent=total?total+' packages found · showing '+(from+1)+'–'+Math.min(from+20,total):'No packages found.';results.replaceChildren(...m.results.map(x=>{const card=document.createElement('article');card.className='card';const detail=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=x.name;const version=document.createElement('span');version.className='version';version.textContent='v'+x.version;name.append(version);const description=document.createElement('div');description.className='description';description.textContent=x.description||'No description provided.';detail.append(name,description);const actions=document.createElement('div');actions.className='actions';actions.append(button('☆ Favorite','favorite',true,x),button('+ Install','install',false,x));card.append(detail,actions);return card}));pages.replaceChildren();if(from>0){const b=document.createElement('button');b.className='secondary';b.textContent='← Previous';b.onclick=()=>search(Math.max(0,from-20));pages.append(b)}if(from+20<total){const b=document.createElement('button');b.textContent='Next →';b.onclick=()=>search(from+20);pages.append(b)}}window.addEventListener('message',e=>show(e.data));
</script></body></html>`;
}
