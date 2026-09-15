import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    commitVersionChanges,
    ensureVersionRepositoryUnchanged,
    findVersionRepository,
    inspectVersionRepository,
    preferredVersionRemote,
    pushVersionCommit,
    resolveVersionPushTarget,
    readVersionRemoteNames,
    VersionPushTarget,
    VersionRepositoryState,
} from './packageVersionGitService';
import {
    applyVersionIncrement,
    ensureDocumentSaved,
    ensureSourceUnchanged,
    VersionIncrement,
} from './packageVersionService';

const updatePackageVersionCommand = 'project-atlas.updatePackageVersion';
let updating = false;

interface VersionQuickPickItem extends vscode.QuickPickItem {
    increment: VersionIncrement;
}

/** Registers the package.json version update command. */
export function registerPackageVersionCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand(updatePackageVersionCommand, updatePackageVersion));
}

/**
 * Updates the root package.json version using a SemVer major, minor, or patch increment.
 * Cancelling before execution leaves the version and repository untouched.
 */
export async function updatePackageVersion(): Promise<void> {
    if (updating) {
        void vscode.window.showInformationMessage('A package version update is already in progress.');
        return;
    }
    updating = true;
    let versionWritten = false;
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders?.length !== 1) {
            throw new Error('Open exactly one workspace folder before updating its package version.');
        }

        const packageJsonUri = vscode.Uri.joinPath(workspaceFolders[0]!.uri, 'package.json');
        await ensurePackageJsonExists(packageJsonUri);
        ensureOpenPackageJsonSaved(packageJsonUri);

        const fileContents = await readPackageJson(packageJsonUri, 'read');
        const source = new TextDecoder().decode(fileContents);
        const versions = {
            major: applyVersionIncrement(source, 'major'),
            minor: applyVersionIncrement(source, 'minor'),
            patch: applyVersionIncrement(source, 'patch'),
        };

        const selection = await vscode.window.showQuickPick<VersionQuickPickItem>(
            [
                { label: 'Major (x.0.0)', description: versions.major.newVersion, increment: 'major' },
                { label: 'Minor (0.x.0)', description: versions.minor.newVersion, increment: 'minor' },
                { label: 'Patch (0.0.x)', description: versions.patch.newVersion, increment: 'patch' },
            ],
            { placeHolder: `Current version: ${versions.patch.oldVersion}` },
        );
        if (!selection) {
            return;
        }

        const update = versions[selection.increment];
        const root =
            packageJsonUri.scheme === 'file' ? await findVersionRepository(workspaceFolders[0]!.uri.fsPath) : undefined;
        const remotes = root ? await readVersionRemoteNames(root) : [];
        const action = await vscode.window.showQuickPick(
            [
                { label: 'Update version only', commit: false },
                ...(root
                    ? [
                          {
                              label: remotes.length ? 'Update, commit and push' : 'Update and commit locally',
                              description: 'Include all saved repository changes',
                              commit: true,
                          },
                      ]
                    : []),
            ],
            {
                title: `Package version: ${update.oldVersion} → ${update.newVersion}`,
                placeHolder: 'Choose whether to commit code',
            },
        );
        if (!action) {
            return;
        }

        let state: VersionRepositoryState | undefined;
        let target: VersionPushTarget | undefined;
        const message = `chore: bump version to ${update.newVersion}`;
        if (action.commit && root) {
            ensureRepositoryDocumentsSaved(root);
            state = await inspectVersionRepository(root);
            if (state.remotes.length) {
                const remote =
                    (await preferredVersionRemote(state)) ??
                    (await vscode.window.showQuickPick(state.remotes, {
                        title: 'Select push remote',
                    }));
                if (!remote) {
                    return;
                }
                target = await resolveVersionPushTarget(state, remote);
            }
            const confirmed = await vscode.window.showWarningMessage(
                target
                    ? 'Update version, commit all changes and push?'
                    : 'Update version and commit all changes locally?',
                {
                    modal: true,
                    detail: [
                        `Repository: ${root}`,
                        `Branch: ${state.branch}`,
                        `Version: ${update.oldVersion} → ${update.newVersion}`,
                        `Commit: ${message}`,
                        target ? `Push target: ${target.remote}/${target.branch}` : 'Local commit only',
                        ...(target ? ['Push includes any earlier unpushed commits on this branch.'] : []),
                        '',
                        'All saved changes, including new and deleted files, will be committed:',
                        state.changes || '(No existing changes)',
                        `Version update: ${path.relative(root, packageJsonUri.fsPath)}`,
                    ].join('\n'),
                },
                target ? 'Commit and Push' : 'Commit Locally',
            );
            if (!confirmed) {
                return;
            }
            ensureRepositoryDocumentsSaved(root);
            await ensureVersionRepositoryUnchanged(state, target);
        }
        ensureOpenPackageJsonSaved(packageJsonUri);
        await writePackageJsonAtomically(packageJsonUri, fileContents, new TextEncoder().encode(update.source));
        versionWritten = true;
        if (!state) {
            void vscode.window.showInformationMessage(
                `Package version updated: ${update.oldVersion} → ${update.newVersion}`,
            );
            return;
        }
        const commit = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Committing package version and repository changes…',
            },
            () => commitVersionChanges(state.root, message),
        );
        if (!target) {
            void vscode.window.showInformationMessage(
                `Package version ${update.newVersion} committed locally (${commit.slice(0, 8)}).`,
            );
            return;
        }
        await pushWithRetry(state, commit, target, update.newVersion);
    } catch (error) {
        void vscode.window.showErrorMessage(
            `${versionWritten ? 'Package version was updated, but the commit workflow failed. Changes have been kept' : 'Failed to update package version'}: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        updating = false;
    }
}

function ensureRepositoryDocumentsSaved(root: string): void {
    const dirty = vscode.workspace.textDocuments.some((document) => {
        const relative = path.relative(root, document.uri.fsPath);
        return (
            document.isDirty &&
            document.uri.scheme === 'file' &&
            relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
        );
    });
    if (dirty) {
        throw new Error('Save all repository files before committing the package version.');
    }
}

async function pushWithRetry(
    state: VersionRepositoryState,
    commit: string,
    target: VersionPushTarget,
    version: string,
): Promise<void> {
    for (;;) {
        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Pushing to ${target.remote}/${target.branch}…`,
                },
                () => pushVersionCommit(state.root, state.branch, commit, target),
            );
            void vscode.window.showInformationMessage(
                `Package version ${version} committed (${commit.slice(0, 8)}) and pushed to ${target.remote}/${target.branch}.`,
            );
            return;
        } catch (error) {
            const retry = await vscode.window.showErrorMessage(
                `Committed locally (${commit.slice(0, 8)}), but push did not complete: ${error instanceof Error ? error.message : String(error)}`,
                'Retry Push',
            );
            if (retry !== 'Retry Push') {
                return;
            }
        }
    }
}

async function ensurePackageJsonExists(packageJsonUri: vscode.Uri): Promise<void> {
    let stat: vscode.FileStat;
    try {
        stat = await vscode.workspace.fs.stat(packageJsonUri);
    } catch (error) {
        if (isFileSystemError(error, 'FileNotFound')) {
            throw new Error('No package.json was found in the workspace root.');
        }
        throw describeFileSystemError('access', error);
    }
    if ((stat.type & vscode.FileType.File) === 0) {
        throw new Error('The package.json path is not a file.');
    }
}

async function readPackageJson(packageJsonUri: vscode.Uri, operation: 'read' | 're-read'): Promise<Uint8Array> {
    try {
        return await vscode.workspace.fs.readFile(packageJsonUri);
    } catch (error) {
        if (isFileSystemError(error, 'FileNotFound')) {
            throw new Error(
                operation === 'read'
                    ? 'No package.json was found in the workspace root.'
                    : 'package.json was removed while selecting a version.',
            );
        }
        throw describeFileSystemError(operation, error);
    }
}

async function writePackageJsonAtomically(
    packageJsonUri: vscode.Uri,
    initialContents: Uint8Array,
    updatedContents: Uint8Array,
): Promise<void> {
    const temporaryUri = vscode.Uri.joinPath(
        vscode.Uri.joinPath(packageJsonUri, '..'),
        `.package.json.${randomUUID()}.tmp`,
    );
    try {
        try {
            await vscode.workspace.fs.writeFile(temporaryUri, updatedContents);
        } catch (error) {
            throw describeFileSystemError('write a temporary', error);
        }

        const latestContents = await readPackageJson(packageJsonUri, 're-read');
        ensureSourceUnchanged(initialContents, latestContents);
        ensureOpenPackageJsonSaved(packageJsonUri);

        try {
            await vscode.workspace.fs.rename(temporaryUri, packageJsonUri, { overwrite: true });
        } catch (error) {
            throw describeFileSystemError('replace', error);
        }
    } finally {
        await Promise.resolve(vscode.workspace.fs.delete(temporaryUri)).catch((error: unknown) => {
            if (!isFileSystemError(error, 'FileNotFound')) {
                console.warn(`Failed to clean up temporary package.json: ${String(error)}`);
            }
        });
    }
}

function ensureOpenPackageJsonSaved(packageJsonUri: vscode.Uri): void {
    const packageJsonDocument = vscode.workspace.textDocuments.find(
        (document) => document.uri.toString() === packageJsonUri.toString(),
    );
    ensureDocumentSaved(packageJsonDocument?.isDirty ?? false);
}

function isFileSystemError(error: unknown, code: string): error is vscode.FileSystemError {
    return error instanceof vscode.FileSystemError && error.code === code;
}

function describeFileSystemError(operation: string, error: unknown): Error {
    if (error instanceof vscode.FileSystemError) {
        const reason =
            error.code === 'NoPermissions'
                ? 'permission was denied'
                : error.code === 'Unavailable'
                  ? 'the file system is unavailable'
                  : `${error.code}: ${error.message}`;
        return new Error(`Could not ${operation} package.json because ${reason}.`);
    }
    return new Error(`Could not ${operation} package.json: ${error instanceof Error ? error.message : String(error)}`);
}
