import * as https from 'https';
import { randomUUID } from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as vscode from 'vscode';
import { GitHubConfigurationStore } from '../githubRepositories/config';
import { saveFavorite, updateDependencies } from './npmPackagesStore';
import { NpmPackagesTree } from './npmPackagesTree';
import { NpmSearchResult, PackageEntry } from './npmPackagesTypes';

const proxyConfigurationStore = new GitHubConfigurationStore();

export function openSearchPanel(provider: NpmPackagesTree): void {
    const panel = vscode.window.createWebviewPanel(
        'projectAtlas.npmPackagesSearch',
        'Search npm Packages',
        vscode.ViewColumn.Active,
        { enableScripts: true, localResourceRoots: [] },
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
            } else if (
                (value.action === 'favorite' || value.action === 'install' || value.action === 'installDev') &&
                isEntry(value.entry)
            ) {
                if (value.action === 'favorite') {
                    await saveFavorite(value.entry);
                } else {
                    await updateDependencies(
                        value.entry.name,
                        value.action === 'installDev' ? 'devDependencies' : 'dependencies',
                        true,
                        value.entry.version,
                    );
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
                        return reject(new Error(`npm search failed with status ${response.statusCode ?? 'unknown'}.`));
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
    return (
        vscode.workspace.getConfiguration('http').get<string>('proxy')?.trim() ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy
    );
}

function searchHtml(): string {
    const nonce = randomUUID();
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src https://registry.npmjs.org; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'"><style>body{max-width:920px;margin:auto;padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}form,.actions,nav{display:flex;gap:8px}input{flex:1}.card{display:flex;justify-content:space-between;gap:12px;margin:8px 0;padding:12px;border:1px solid var(--vscode-panel-border)}.description,#status{color:var(--vscode-descriptionForeground)}button,input{padding:7px;font:inherit}</style></head><body><h1>Search npm Packages</h1><form id="search"><input id="query" autofocus placeholder="Search packages, for example react"><button>Search</button></form><p id="status">Enter a package name and select Search.</p><main id="results"></main><nav id="pages"></nav><script nonce="${nonce}">const vscode=acquireVsCodeApi(),q=document.getElementById('query'),status=document.getElementById('status'),results=document.getElementById('results'),pages=document.getElementById('pages');let query='',from=0,total=0;document.getElementById('search').onsubmit=e=>{e.preventDefault();query=q.value;search(0)};function search(page){query=query.trim();if(!query){status.textContent='Enter a package name first.';return}from=page;status.textContent='Searching npm…';vscode.postMessage({action:'search',text:query,from})}function button(label,action,entry){const b=document.createElement('button');b.textContent=label;b.onclick=()=>vscode.postMessage({action,entry});return b}function show(m){if(m.type==='error'){status.textContent=m.message;return}if(m.type==='done'){status.textContent=m.name+' updated.';return}if(m.type!=='results')return;from=m.from;total=m.total;status.textContent=total?total+' packages found.':'No packages found.';results.replaceChildren(...m.results.map(x=>{const c=document.createElement('article');c.className='card';const d=document.createElement('div');d.innerHTML='<strong></strong><div class="description"></div>';d.children[0].textContent=x.name+'@'+x.version;d.children[1].textContent=x.description||'No description provided.';const a=document.createElement('div');a.className='actions';a.append(button('Favorite','favorite',x),button('Add','install',x),button('Add dev','installDev',x));c.append(d,a);return c}));pages.replaceChildren();if(from>0)pages.append(button('Previous','page',{page:from-20}));if(from+20<total)pages.append(button('Next','page',{page:from+20}));pages.querySelectorAll('button').forEach(b=>{if(b.textContent==='Previous')b.onclick=()=>search(Math.max(0,from-20));if(b.textContent==='Next')b.onclick=()=>search(from+20)})}window.addEventListener('message',e=>show(e.data));</script></body></html>`;
}
