import * as path from 'path';
import * as vscode from 'vscode';
import { runGit } from '../gitTagRelease/gitTagService';

interface GitApi {
    readonly repositories: readonly GitRepository[];
    readonly onDidOpenRepository?: vscode.Event<GitRepository>;
    readonly onDidCloseRepository?: vscode.Event<GitRepository>;
}

interface GitRepository {
    readonly rootUri: vscode.Uri;
}

export class GitRepositoryService implements vscode.Disposable {
    private readonly subscriptions: vscode.Disposable[] = [];
    private api: GitApi | undefined;
    private apiAttempted = false;
    private readonly repositoryRoots = new Map<string, vscode.Uri>();

    async select(argument?: unknown): Promise<vscode.Uri | undefined> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) {
            await vscode.window.showErrorMessage('Open a workspace folder before generating CHANGELOG.md.');
            return undefined;
        }
        await this.activateGitApi();
        const roots = new Map<string, vscode.Uri>();
        for (const repository of this.repositoryRoots.values()) {
            if (
                folders.some(
                    (folder) =>
                        contains(folder.uri.fsPath, repository.fsPath) ||
                        contains(repository.fsPath, folder.uri.fsPath),
                )
            ) {
                roots.set(normalize(repository.fsPath), repository);
            }
        }
        if (!this.api) {
            let gitUnavailable = false;
            for (const folder of folders) {
                try {
                    const result = await runGit(folder.uri.fsPath, ['rev-parse', '--show-toplevel']);
                    if (result.code === 0 && result.stdout.trim()) {
                        const uri = vscode.Uri.file(result.stdout.trim());
                        roots.set(normalize(uri.fsPath), uri);
                    }
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                        gitUnavailable = true;
                    }
                    // One unavailable folder must not hide repositories found in other workspace folders.
                }
            }
            if (gitUnavailable && !roots.size) {
                await vscode.window.showErrorMessage(
                    'Git could not be executed. Install Git and make sure it is available on PATH.',
                );
                return undefined;
            }
        }
        const candidates = [...roots.values()].sort((left, right) => left.fsPath.localeCompare(right.fsPath));
        if (!candidates.length) {
            await vscode.window.showWarningMessage('No Git repository was detected for this workspace.');
            return undefined;
        }
        const preferred =
            argument instanceof vscode.Uri && argument.scheme === 'file'
                ? argument
                : vscode.window.activeTextEditor?.document.uri;
        if (preferred?.scheme === 'file') {
            const matches = candidates.filter((candidate) => contains(candidate.fsPath, preferred.fsPath));
            if (matches.length) {
                return matches.sort((left, right) => right.fsPath.length - left.fsPath.length)[0];
            }
        }
        if (candidates.length === 1) {
            return candidates[0];
        }
        const picked = await vscode.window.showQuickPick(
            candidates.map((uri) => ({ label: path.basename(uri.fsPath), description: uri.fsPath, uri })),
            { placeHolder: 'Select the repository whose history will be used.', matchOnDescription: true },
        );
        return picked?.uri;
    }

    dispose(): void {
        this.subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    }

    private async activateGitApi(): Promise<void> {
        if (this.apiAttempted) {
            return;
        }
        this.apiAttempted = true;
        const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
        if (!extension) {
            return;
        }
        try {
            this.api = (extension.isActive ? extension.exports : await extension.activate()).getAPI(1);
            for (const repository of this.api.repositories) {
                this.repositoryRoots.set(normalize(repository.rootUri.fsPath), repository.rootUri);
            }
            if (this.api.onDidOpenRepository) {
                this.subscriptions.push(
                    this.api.onDidOpenRepository((repository) =>
                        this.repositoryRoots.set(normalize(repository.rootUri.fsPath), repository.rootUri),
                    ),
                );
            }
            if (this.api.onDidCloseRepository) {
                this.subscriptions.push(
                    this.api.onDidCloseRepository((repository) =>
                        this.repositoryRoots.delete(normalize(repository.rootUri.fsPath)),
                    ),
                );
            }
        } catch {
            this.api = undefined;
        }
    }
}

function normalize(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function contains(parent: string, child: string): boolean {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
