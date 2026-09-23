import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { readFavorites, saveFavorite, updateDependencies, updateFavoriteDescriptions } from './npmPackagesStore';
import { NpmPackagesTree } from './npmPackagesTree';
import { NpmSearchResult, PackageEntry } from './npmPackagesTypes';

export async function refreshFavoritePackageDescriptions(
    token?: vscode.CancellationToken,
    report?: vscode.Progress<{ message?: string; increment?: number }>,
): Promise<{ updated: number; cancelled: boolean }> {
    const favorites = await readFavorites();
    const metadata = new Map<string, { version: string; description?: string | undefined }>();
    for (const favorite of favorites) {
        if (token?.isCancellationRequested) {
            return { updated: 0, cancelled: true };
        }
        report?.report({
            message: `Fetching ${favorite.name}`,
            increment: favorites.length ? 100 / favorites.length : 100,
        });
        metadata.set(favorite.name, await requestNpmPackage(favorite.name));
    }
    await updateFavoriteDescriptions(metadata);
    return { updated: metadata.size, cancelled: false };
}

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
    const offset = Math.max(0, from);
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20&from=${offset}`;
    return requestNpmSearch(url, offset);
}

async function requestNpmSearch(
    url: string,
    from: number,
): Promise<{ results: NpmSearchResult[]; total: number; from: number }> {
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: 'application/json', 'User-Agent': 'project-atlas-vs' },
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        throw new Error('Could not connect to the npm registry. Check your network connection and proxy settings.', {
            cause: error,
        });
    }
    if (!response.ok) {
        throw new Error(`npm search failed with status ${response.status}.`);
    }
    try {
        const parsed = JSON.parse(await response.text()) as {
            total?: unknown;
            objects?: Array<{ package?: NpmSearchResult }>;
        };
        if (!Array.isArray(parsed.objects)) {
            throw new Error('Invalid response');
        }
        return {
            results: parsed.objects
                .map((item) => item.package)
                .filter((item): item is NpmSearchResult => Boolean(item?.name && item.version)),
            total: typeof parsed.total === 'number' ? parsed.total : 0,
            from,
        };
    } catch {
        throw new Error('npm returned an invalid search response.');
    }
}

async function requestNpmPackage(name: string): Promise<{ version: string; description?: string | undefined }> {
    const result = await searchNpm(name, 0);
    const packageMetadata = result.results.find((item) => item.name === name);
    if (!packageMetadata) {
        throw new Error(`npm did not return metadata for ${name}.`);
    }
    return { version: packageMetadata.version, description: packageMetadata.description };
}

function searchHtml(): string {
    const nonce = randomUUID();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>
    :root { color-scheme: var(--vscode-color-scheme); }
    * { box-sizing: border-box; }
    body { max-width: 980px; margin: 0 auto; padding: 32px 28px 48px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: 13px/1.45 var(--vscode-font-family); }
    .hero { padding: 24px; border: 1px solid var(--vscode-panel-border); border-radius: 12px; background: linear-gradient(135deg, var(--vscode-sideBar-background), var(--vscode-editorWidget-background)); }
    .eyebrow { margin: 0 0 4px; color: var(--vscode-textLink-foreground); font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
    h1 { margin: 0; font-size: 24px; line-height: 1.25; }
    .subtitle { margin: 6px 0 20px; color: var(--vscode-descriptionForeground); }
    form { display: flex; gap: 8px; }
    input { min-width: 0; flex: 1; height: 38px; padding: 0 12px; border: 1px solid var(--vscode-input-border); border-radius: 7px; outline: none; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; }
    input:focus { border-color: var(--vscode-focusBorder); box-shadow: 0 0 0 1px var(--vscode-focusBorder); }
    button { height: 34px; padding: 0 12px; border: 0; border-radius: 6px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: 600 12px var(--vscode-font-family); cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #status { min-height: 20px; margin: 20px 2px 10px; color: var(--vscode-descriptionForeground); }
    #results { display: grid; gap: 8px; }
    .card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 15px 16px; border: 1px solid var(--vscode-panel-border); border-radius: 9px; background: var(--vscode-sideBar-background); }
    .card:hover { border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground); }
    .name { overflow: hidden; font-size: 14px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .version { margin-left: 7px; color: var(--vscode-textLink-foreground); font-size: 12px; font-weight: 400; }
    .description { display: -webkit-box; overflow: hidden; margin-top: 3px; color: var(--vscode-descriptionForeground); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .actions, nav { display: flex; gap: 6px; }
    .actions button { height: 30px; padding: 0 9px; }
    nav { align-items: center; justify-content: center; margin-top: 16px; }
    nav button:disabled { opacity: .45; cursor: default; }
    .page-indicator { min-width: 76px; color: var(--vscode-descriptionForeground); font-size: 12px; text-align: center; }
    @media (max-width: 620px) { body { padding: 16px; } .hero { padding: 18px; } form, .card { grid-template-columns: 1fr; flex-direction: column; } form button { width: 100%; } .actions { justify-content: flex-start; } }
  </style>
</head>
<body>
  <section class="hero">
    <p class="eyebrow">npm registry</p>
    <h1>Discover packages</h1>
    <p class="subtitle">Search the public registry, then add a package or save it to Favorites.</p>
    <form id="search"><input id="query" autofocus placeholder="Search packages, for example react" aria-label="Search npm packages"><button>Search</button></form>
  </section>
  <p id="status">Enter a package name to start searching.</p>
  <main id="results" aria-live="polite"></main>
  <nav id="pages" aria-label="Search result pages"></nav>
  <script nonce="${nonce}">
    const vscode=acquireVsCodeApi(),queryInput=document.getElementById('query'),status=document.getElementById('status'),results=document.getElementById('results'),pages=document.getElementById('pages');let query='',from=0,total=0;
    document.getElementById('search').onsubmit=event=>{event.preventDefault();query=queryInput.value;search(0)};
    function search(page){query=query.trim();if(!query){status.textContent='Enter a package name first.';return}from=page;status.textContent='Searching npm…';vscode.postMessage({action:'search',text:query,from})}
    function button(label,action,entry,secondary=false){const element=document.createElement('button');element.textContent=label;element.className=secondary?'secondary':'';element.onclick=()=>vscode.postMessage({action,entry});return element}
    function pageButton(label,target,secondary){const element=button(label,'',null,secondary);element.disabled=target===from||target<0||target>=total;element.onclick=()=>search(target);return element}
    function show(message){if(message.type==='error'){status.textContent=message.message;return}if(message.type==='done'){status.textContent=message.name+' updated.';return}if(message.type!=='results')return;from=message.from;total=message.total;status.textContent=total?'Showing '+(from+1)+'–'+Math.min(from+20,total)+' of '+total+' packages.':'No packages found.';results.replaceChildren(...message.results.map(item=>{const card=document.createElement('article');card.className='card';const detail=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=item.name;const version=document.createElement('span');version.className='version';version.textContent='v'+item.version;name.append(version);const description=document.createElement('div');description.className='description';description.textContent=item.description||'No description provided.';detail.append(name,description);const actions=document.createElement('div');actions.className='actions';actions.append(button('Favorite','favorite',item,true),button('Add','install',item),button('Add dev','installDev',item));card.append(detail,actions);return card}));pages.replaceChildren();if(!total)return;const page=Math.floor(from/20)+1,pageCount=Math.ceil(total/20),indicator=document.createElement('span');indicator.className='page-indicator';indicator.textContent='Page '+page+' / '+pageCount;pages.append(pageButton('← Previous',from-20,true),indicator,pageButton('Next →',from+20,false))}
    window.addEventListener('message',event=>show(event.data));
  </script>
</body>
</html>`;
}
