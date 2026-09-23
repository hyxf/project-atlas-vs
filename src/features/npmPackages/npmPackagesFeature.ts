import * as vscode from 'vscode';
import {
    isInstalled,
    openFavoritesFile,
    removeFavorite,
    saveFavorite,
    updateDependencies,
    workspacePackageUri,
} from './npmPackagesStore';
import { openSearchPanel } from './npmPackagesSearch';
import { NpmPackageNode, NpmPackagesTree } from './npmPackagesTree';

export { npmPackageTooltip, parseFavoritesDocument, serializeFavoritesDocument } from './npmPackagesStore';

/** Registers npm package commands and connects the tree view to workspace changes. */
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
                /* package.json is absent */
            }
        }
        await vscode.commands.executeCommand('setContext', 'projectAtlas.npmPackagesAvailable', available);
    };
    const register = (name: string, action: (...args: never[]) => Promise<void>) =>
        context.subscriptions.push(vscode.commands.registerCommand(`project-atlas.${name}`, action));

    register('refreshNpmPackages', refresh);
    register('searchNpmPackages', async () => openSearchPanel(provider));
    register('addNpmPackage', async () => openSearchPanel(provider));
    register('editNpmFavoritesFile', openFavoritesFile);
    register('openNpmPackageHomepage', async (item: NpmPackageNode) => {
        if (item) {
            await vscode.env.openExternal(
                vscode.Uri.parse(`https://www.npmjs.com/package/${encodeURIComponent(item.entry.name)}`),
            );
        }
    });
    register('removeNpmPackage', async (item: NpmPackageNode) => {
        if (!item?.entry.kind) {
            return;
        }
        const group = item.entry.kind === 'dependencies' ? 'Dependencies' : 'Dev Dependencies';
        if (
            (await vscode.window.showWarningMessage(
                `Remove ${item.entry.name} from ${group}?`,
                { modal: true },
                'Remove',
            )) !== 'Remove'
        ) {
            return;
        }
        await updateDependencies(item.entry.name, item.entry.kind, false);
        await refresh();
    });
    register('addFavoriteNpmPackageToDependencies', async (item: NpmPackageNode) =>
        addFavoriteDependency(item, 'dependencies', refresh),
    );
    register('addFavoriteNpmPackageToDevDependencies', async (item: NpmPackageNode) =>
        addFavoriteDependency(item, 'devDependencies', refresh),
    );
    register('addNpmPackageFavorite', async (item: NpmPackageNode) => {
        if (item) {
            await saveFavorite(item.entry);
            await refresh();
        }
    });
    register('removeNpmPackageFavorite', async (item: NpmPackageNode) => {
        if (item) {
            await removeFavorite(item.entry.name);
            await refresh();
        }
    });

    context.subscriptions.push(vscode.window.registerTreeDataProvider('projectAtlas.npmPackages', provider));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void refresh()));
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(() => void refresh()),
        watcher.onDidChange(() => void refresh()),
        watcher.onDidDelete(() => void refresh()),
    );
    void refresh();
}

async function addFavoriteDependency(
    item: NpmPackageNode,
    kind: 'dependencies' | 'devDependencies',
    refresh: () => Promise<void>,
): Promise<void> {
    if (!item || item.entry.kind || (await isInstalled(item.entry.name))) {
        return;
    }
    await updateDependencies(item.entry.name, kind, true, item.entry.version || 'latest');
    await refresh();
}
