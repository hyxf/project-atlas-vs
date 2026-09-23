import * as vscode from 'vscode';
import { pickRepositoryTags } from '../repositoryManagement/tagPicker';
import {
    favoriteTags,
    isInstalled,
    openFavoritesFile,
    openTrashFile,
    readFavorites,
    removeFromTrash,
    removeFavorite,
    saveFavorite,
    saveToTrash,
    updateDependencies,
    updateFavoriteTags,
    workspacePackageUri,
} from './npmPackagesStore';
import { openSearchPanel, refreshFavoritePackageDescriptions } from './npmPackagesSearch';
import { NpmPackageNode, NpmPackagesTree } from './npmPackagesTree';

export {
    npmPackageTooltip,
    parseFavoritesDocument,
    parseTrashDocument,
    serializeFavoritesDocument,
    serializeTrashDocument,
} from './npmPackagesStore';

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
    register('editWorkspacePackageJson', async () => {
        const uri = workspacePackageUri();
        if (uri) {
            await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        }
    });
    register('searchNpmPackages', async () => openSearchPanel(provider));
    register('addNpmPackage', async () => openSearchPanel(provider));
    register('editNpmFavoritesFile', openFavoritesFile);
    register('editNpmTrashFile', openTrashFile);
    register('refreshNpmTrash', refresh);
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
        await saveToTrash({ ...item.entry, kind: item.entry.kind });
        try {
            await updateDependencies(item.entry.name, item.entry.kind, false);
        } catch (error) {
            await removeFromTrash(item.entry.name);
            throw error;
        }
        await refresh();
    });
    register('restoreNpmPackage', async (item: NpmPackageNode) => {
        if (!item || item.parent.contextValue !== 'npmTrashPackageGroup' || !item.entry.kind) {
            return;
        }
        await updateDependencies(item.entry.name, item.entry.kind, true, item.entry.version || 'latest');
        await removeFromTrash(item.entry.name);
        await refresh();
    });
    register('deleteNpmPackageFromTrash', async (item: NpmPackageNode) => {
        if (!item || item.parent.contextValue !== 'npmTrashPackageGroup') {
            return;
        }
        if (
            (await vscode.window.showWarningMessage(
                `Delete ${item.entry.name} permanently from the npm package trash?`,
                { modal: true },
                'Delete',
            )) !== 'Delete'
        ) {
            return;
        }
        await removeFromTrash(item.entry.name);
        await refresh();
    });
    register('editNpmFavoriteTag', async (item: NpmPackageNode) => {
        if (!item || item.parent.contextValue !== 'npmFavoriteTagGroup') {
            return;
        }
        const tags = await pickRepositoryTags(
            (await readFavorites()).flatMap(favoriteTags),
            favoriteTags(item.entry),
            `Edit Favorite Tags: ${item.entry.name}`,
        );
        if (tags !== undefined) {
            await updateFavoriteTags(item.entry.name, tags);
            await refresh();
        }
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
    register('refreshNpmFavoriteDescriptions', async () => {
        void vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Refreshing npm Favorites',
                cancellable: true,
            },
            async (progress, token) => {
                try {
                    const result = await refreshFavoritePackageDescriptions(token, progress);
                    if (result.cancelled) {
                        void vscode.window.showInformationMessage('Refreshing npm Favorites was cancelled.');
                        return;
                    }
                    await refresh();
                    void vscode.window.showInformationMessage(
                        `Refreshed metadata for ${result.updated} npm favorite${result.updated === 1 ? '' : 's'}.`,
                    );
                } catch (error) {
                    void vscode.window.showErrorMessage(
                        `Could not refresh npm Favorites: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            },
        );
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
