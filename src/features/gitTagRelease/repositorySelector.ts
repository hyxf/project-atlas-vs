import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from './gitTagService';
import { GitRemoteInfo } from './types';

interface GitApi {
    repositories: Array<{ rootUri: vscode.Uri }>;
}

export async function selectRepository(): Promise<string | undefined> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        await vscode.window.showWarningMessage('No Git repository was detected for this workspace.');
        return undefined;
    }
    const roots = new Map<string, string>();
    const gitExtension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
    try {
        const api =
            gitExtension && (gitExtension.isActive ? gitExtension.exports : await gitExtension.activate()).getAPI(1);
        for (const repository of api?.repositories ?? []) {
            if (folders.some((folder) => contains(folder.uri.fsPath, repository.rootUri.fsPath))) {
                roots.set(normalize(repository.rootUri.fsPath), repository.rootUri.fsPath);
            }
        }
    } catch {
        // The command-line fallback below handles an unavailable or incompatible Git API.
    }
    if (!roots.size) {
        for (const folder of folders) {
            const result = await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
            if (result.code === 0) {
                const root = result.stdout.trim();
                roots.set(normalize(root), root);
            }
        }
    }
    const repositories = [...roots.values()].sort((left, right) => left.localeCompare(right));
    if (!repositories.length) {
        await vscode.window.showWarningMessage('No Git repository was detected for this workspace.');
        return undefined;
    }
    if (repositories.length === 1) {
        return repositories[0];
    }
    const picked = await vscode.window.showQuickPick(
        repositories.map((root) => ({ label: path.basename(root), description: root, root })),
        { title: 'Create Release Tag', placeHolder: 'Choose a Git repository', matchOnDescription: true },
    );
    return picked?.root;
}

export async function selectPushRemote(remotes: GitRemoteInfo[]): Promise<GitRemoteInfo | undefined> {
    if (!remotes.length) {
        await vscode.window.showWarningMessage('The selected Git repository has no remote with a push URL.');
        return undefined;
    }
    const origin = remotes.find(({ name }) => name === 'origin');
    if (origin) {
        return origin;
    }
    if (remotes.length === 1) {
        return remotes[0];
    }
    const picked = await vscode.window.showQuickPick(
        remotes.map((remote) => ({ label: remote.name, remote })),
        { title: 'Create Release Tag', placeHolder: 'Choose a push remote' },
    );
    return picked?.remote;
}

function normalize(value: string): string {
    return path.normalize(value).toLocaleLowerCase();
}

function contains(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function repositoryStillExists(root: string): Promise<boolean> {
    return fs.stat(root).then(
        (stat) => stat.isDirectory(),
        () => false,
    );
}
