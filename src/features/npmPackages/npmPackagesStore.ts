import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyEdits, modify } from 'jsonc-parser';
import * as vscode from 'vscode';
import { ensureDocumentSaved, ensureSourceUnchanged } from '../packageVersion/packageVersionService';
import { DependencyKind, PackageEntry, TrashedPackageEntry } from './npmPackagesTypes';

const favoritesFile = path.join(os.homedir(), '.project-atlas', 'npmfav.json');
const trashFile = path.join(os.homedir(), '.project-atlas', 'npmtrash.json');

export function workspacePackageUri(): vscode.Uri | undefined {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.length === 1 ? vscode.Uri.joinPath(folders[0]!.uri, 'package.json') : undefined;
}

export async function readInstalled(): Promise<Record<DependencyKind, PackageEntry[]>> {
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

export async function readFavorites(): Promise<PackageEntry[]> {
    try {
        return parseFavoritesDocument(JSON.parse(await fs.readFile(favoritesFile, 'utf8'))).items.sort((left, right) =>
            left.name.localeCompare(right.name),
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw new Error(`Could not read ${favoritesFile}. Fix the JSON and refresh.`);
    }
}

export async function ensureFavoritesFile(): Promise<void> {
    await fs.mkdir(path.dirname(favoritesFile), { recursive: true });
    await fs.writeFile(favoritesFile, '{\n  "favorites": []\n}\n', { encoding: 'utf8', flag: 'wx' }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    });
}

export async function openFavoritesFile(): Promise<void> {
    await ensureFavoritesFile();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(favoritesFile)));
}

export async function saveFavorite(entry: PackageEntry): Promise<void> {
    const document = await readFavoritesDocument();
    if (document.items.some((favorite) => favorite.name === entry.name)) {
        return;
    }
    await writeFavorites(document.root, [
        ...document.items,
        { name: entry.name, version: entry.version, description: entry.description },
    ]);
}

export async function removeFavorite(name: string): Promise<void> {
    const document = await readFavoritesDocument();
    if (document.items.some((entry) => entry.name === name)) {
        await writeFavorites(
            document.root,
            document.items.filter((entry) => entry.name !== name),
        );
    }
}

export async function readTrash(): Promise<TrashedPackageEntry[]> {
    const workspace = workspacePackageUri()?.toString();
    if (!workspace) {
        return [];
    }
    const document = await readTrashDocument();
    return (document.items[workspace] ?? []).sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveToTrash(entry: TrashedPackageEntry): Promise<void> {
    const workspace = workspacePackageUri()?.toString();
    if (!workspace) {
        throw new Error('Open exactly one workspace folder with a root package.json.');
    }
    const document = await readTrashDocument();
    const existing = document.items[workspace] ?? [];
    const items = existing.filter((item) => item.name !== entry.name);
    await writeTrash(document.root, {
        ...document.items,
        [workspace]: [...items, entry],
    });
}

export async function removeFromTrash(name: string): Promise<void> {
    const workspace = workspacePackageUri()?.toString();
    if (!workspace) {
        return;
    }
    const document = await readTrashDocument();
    const existing = document.items[workspace] ?? [];
    if (!existing.some((item) => item.name === name)) {
        return;
    }
    const items = existing.filter((item) => item.name !== name);
    const updated = { ...document.items };
    if (items.length) {
        updated[workspace] = items;
    } else {
        delete updated[workspace];
    }
    await writeTrash(document.root, updated);
}

export async function updateFavoriteDescriptions(
    descriptions: ReadonlyMap<string, { version: string; description?: string | undefined }>,
): Promise<void> {
    const document = await readFavoritesDocument();
    await writeFavorites(
        document.root,
        document.items.map((entry) => {
            const metadata = descriptions.get(entry.name);
            if (!metadata) {
                return entry;
            }
            const { description: _previousDescription, ...rest } = entry;
            return metadata.description
                ? { ...rest, version: metadata.version, description: metadata.description }
                : { ...rest, version: metadata.version };
        }),
    );
}

export async function isInstalled(name: string): Promise<boolean> {
    const installed = await readInstalled();
    return [...installed.dependencies, ...installed.devDependencies].some((entry) => entry.name === name);
}

export async function updateDependencies(
    name: string,
    kind: DependencyKind,
    add: boolean,
    version?: string,
): Promise<void> {
    const uri = workspacePackageUri();
    if (!uri) {
        throw new Error('Open exactly one workspace folder with a root package.json.');
    }
    ensurePackageJsonSaved(uri);
    const initial = await vscode.workspace.fs.readFile(uri);
    parsePackageJson(initial);
    if (add && (await isInstalled(name))) {
        throw new Error(`${name} is already installed.`);
    }
    const source = new TextDecoder().decode(initial);
    const updated = new TextEncoder().encode(
        updatePackageJsonText(source, kind, name, add ? (version ?? 'latest') : undefined),
    );
    const temporary = vscode.Uri.joinPath(vscode.Uri.joinPath(uri, '..'), `.package.json.${randomUUID()}.tmp`);
    try {
        await vscode.workspace.fs.writeFile(temporary, updated);
        ensureSourceUnchanged(initial, await vscode.workspace.fs.readFile(uri));
        ensurePackageJsonSaved(uri);
        await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
    } finally {
        await Promise.resolve(vscode.workspace.fs.delete(temporary)).catch(() => undefined);
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

export function parseFavoritesDocument(source: unknown): { root: Record<string, unknown>; items: PackageEntry[] } {
    const root = Array.isArray(source) ? { favorites: source } : source;
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
        return { root: { favorites: [] }, items: [] };
    }
    const document = root as Record<string, unknown>;
    return {
        root: document,
        items: (Array.isArray(document.favorites) ? document.favorites : []).filter(
            (item): item is PackageEntry => Boolean(item) && typeof item === 'object' && typeof item.name === 'string',
        ),
    };
}

export function serializeFavoritesDocument(document: { root: Record<string, unknown>; items: PackageEntry[] }): string {
    return `${JSON.stringify({ ...document.root, favorites: document.items }, null, 2)}\n`;
}

export function npmPackageTooltip(name: string, version?: string, description?: string): string {
    const packageName = version ? `${name}@${version}` : name;
    return description ? `${packageName}\n\n${description}` : packageName;
}

async function readFavoritesDocument(): Promise<{ root: Record<string, unknown>; items: PackageEntry[] }> {
    try {
        return parseFavoritesDocument(JSON.parse(await fs.readFile(favoritesFile, 'utf8')));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { root: { favorites: [] }, items: [] };
        }
        throw new Error(`Could not read ${favoritesFile}. Fix the JSON and refresh.`);
    }
}

async function writeFavorites(root: Record<string, unknown>, favorites: PackageEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(favoritesFile), { recursive: true });
    const temporary = `${favoritesFile}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, serializeFavoritesDocument({ root, items: favorites }), {
            encoding: 'utf8',
            flag: 'wx',
        });
        await fs.rename(temporary, favoritesFile);
    } finally {
        await fs.unlink(temporary).catch(() => undefined);
    }
}

export function parseTrashDocument(source: unknown): {
    root: Record<string, unknown>;
    items: Record<string, TrashedPackageEntry[]>;
} {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return { root: { trash: {} }, items: {} };
    }
    const root = source as Record<string, unknown>;
    const trash = root.trash;
    if (!trash || typeof trash !== 'object' || Array.isArray(trash)) {
        return { root, items: {} };
    }
    return {
        root,
        items: Object.fromEntries(
            Object.entries(trash).map(([workspace, entries]) => [
                workspace,
                (Array.isArray(entries) ? entries : []).filter(
                    (entry): entry is TrashedPackageEntry =>
                        Boolean(entry) &&
                        typeof entry === 'object' &&
                        typeof entry.name === 'string' &&
                        (entry.kind === 'dependencies' || entry.kind === 'devDependencies'),
                ),
            ]),
        ),
    };
}

async function readTrashDocument(): Promise<{
    root: Record<string, unknown>;
    items: Record<string, TrashedPackageEntry[]>;
}> {
    try {
        return parseTrashDocument(JSON.parse(await fs.readFile(trashFile, 'utf8')));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { root: { trash: {} }, items: {} };
        }
        throw new Error(`Could not read ${trashFile}. Fix the JSON and refresh.`);
    }
}

async function writeTrash(root: Record<string, unknown>, trash: Record<string, TrashedPackageEntry[]>): Promise<void> {
    await fs.mkdir(path.dirname(trashFile), { recursive: true });
    const temporary = `${trashFile}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, serializeTrashDocument({ root, items: trash }), {
            encoding: 'utf8',
            flag: 'wx',
        });
        await fs.rename(temporary, trashFile);
    } finally {
        await fs.unlink(temporary).catch(() => undefined);
    }
}

export function serializeTrashDocument(document: {
    root: Record<string, unknown>;
    items: Record<string, TrashedPackageEntry[]>;
}): string {
    return `${JSON.stringify({ ...document.root, trash: document.items }, null, 2)}\n`;
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
