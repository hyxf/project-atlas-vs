import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from '../gitTagRelease/gitTagService';
import { RepositoryInfo } from './types';

interface GitRepository {
    rootUri: vscode.Uri;
}

interface GitApi {
    repositories: GitRepository[];
}

export async function resolveRepository(resource?: vscode.Uri): Promise<RepositoryInfo | undefined> {
    const repositories = await discoverRepositories(resource);
    const resourceRepository = resource && deepestContaining(repositories, resource.fsPath);
    const workspaceRepository = vscode.workspace.workspaceFolders
        ?.map((folder) => deepestContaining(repositories, folder.uri.fsPath))
        .find((repository): repository is GitRepository => repository !== undefined);
    const repository = resourceRepository ?? workspaceRepository ?? repositories[0];
    if (!repository) {
        return undefined;
    }
    const root = repository.rootUri.fsPath;
    const [origin, branch] = await Promise.all([
        runGit(root, ['config', '--get-all', 'remote.origin.url']),
        runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    ]);
    const originUrl = origin.code === 0 ? firstNonEmptyLine(origin.stdout) : undefined;
    if (!originUrl) {
        return undefined;
    }
    const currentBranch = branch.code === 0 ? branch.stdout.trim() || undefined : undefined;
    return currentBranch
        ? { root: repository.rootUri, originUrl, currentBranch }
        : { root: repository.rootUri, originUrl };
}

async function discoverRepositories(resource?: vscode.Uri): Promise<GitRepository[]> {
    const discovered = new Map<string, GitRepository>();
    try {
        const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
        const exports = extension && (extension.isActive ? extension.exports : await extension.activate());
        for (const repository of exports?.getAPI(1).repositories ?? []) {
            discovered.set(normalize(repository.rootUri.fsPath), repository);
        }
    } catch {
        // Fall back to git below when the built-in Git extension is unavailable.
    }
    if (resource?.scheme === 'file') {
        const resourceRoot = await repositoryRootForResource(resource.fsPath);
        if (resourceRoot) {
            discovered.set(normalize(resourceRoot.fsPath), { rootUri: resourceRoot });
        }
    }
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const result = await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
        if (result.code === 0 && result.stdout.trim()) {
            const root = vscode.Uri.file(result.stdout.trim());
            discovered.set(normalize(root.fsPath), { rootUri: root });
        }
    }
    return [...discovered.values()];
}

async function repositoryRootForResource(resourcePath: string): Promise<vscode.Uri | undefined> {
    const directory = await fs.stat(resourcePath).then(
        (stat) => (stat.isDirectory() ? resourcePath : path.dirname(resourcePath)),
        () => path.dirname(resourcePath),
    );
    const result = await runGit(directory, ['rev-parse', '--show-toplevel']);
    return result.code === 0 && result.stdout.trim() ? vscode.Uri.file(result.stdout.trim()) : undefined;
}

export function firstNonEmptyLine(value: string): string | undefined {
    return value
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim();
}

function deepestContaining(repositories: GitRepository[], candidate: string): GitRepository | undefined {
    return repositories
        .filter(({ rootUri }) => contains(rootUri.fsPath, candidate))
        .sort((left, right) => right.rootUri.fsPath.length - left.rootUri.fsPath.length)[0];
}

export function contains(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalize(value: string): string {
    return path.normalize(value).toLocaleLowerCase();
}
