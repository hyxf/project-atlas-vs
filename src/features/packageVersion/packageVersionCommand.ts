import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    commitVersionChanges,
    createVersionTag,
    ensureVersionTagAvailable,
    ensureVersionRepositoryUnchanged,
    findVersionRepository,
    inspectVersionRepository,
    preferredVersionRemote,
    pushVersionCommit,
    pushVersionTag,
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
const createPackageVersionTagCommand = 'project-atlas.createPackageVersionTag';
const packageVersionAvailableContext = 'projectAtlas.packageVersionAvailable';
let updating = false;

interface VersionQuickPickItem extends vscode.QuickPickItem {
    increment: VersionIncrement;
}

/** Registers the package.json version update command. */
export function registerPackageVersionCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(updatePackageVersionCommand, (resource?: vscode.Uri) =>
            updatePackageVersion(resource),
        ),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(createPackageVersionTagCommand, () => createPackageVersionTag()),
    );
    const updateAvailability = () => void setPackageVersionAvailability();
    const watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
    context.subscriptions.push(
        watcher,
        watcher.onDidCreate(updateAvailability),
        watcher.onDidChange(updateAvailability),
        watcher.onDidDelete(updateAvailability),
        vscode.workspace.onDidChangeWorkspaceFolders(updateAvailability),
    );
    updateAvailability();
}

async function setPackageVersionAvailability(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    let available = false;
    if (folders?.length === 1) {
        try {
            const uri = vscode.Uri.joinPath(folders[0]!.uri, 'package.json');
            const source = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
            const version = (JSON.parse(source) as { version?: unknown }).version;
            available = typeof version === 'string' && version.trim().length > 0;
        } catch {
            available = false;
        }
    }
    await vscode.commands.executeCommand('setContext', packageVersionAvailableContext, available);
}

async function createPackageVersionTag(): Promise<void> {
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (folders?.length !== 1 || folders[0]!.uri.scheme !== 'file') {
            throw new Error('Open exactly one local workspace folder to create a package version tag.');
        }
        const root = await findVersionRepository(folders[0]!.uri.fsPath);
        if (!root) {
            throw new Error('The workspace is not inside a Git repository.');
        }
        const packageJsonUri = vscode.Uri.joinPath(folders[0]!.uri, 'package.json');
        await ensurePackageJsonExists(packageJsonUri);
        const source = new TextDecoder().decode(await readPackageJson(packageJsonUri, 'read'));
        const version = (JSON.parse(source) as { version?: unknown }).version;
        if (typeof version !== 'string' || !version.trim()) {
            throw new Error('package.json does not contain a version field.');
        }
        const tag = `v${version.trim().replace(/^v/i, '')}`;
        await ensureVersionTagAvailable(root, tag);
        ensureOpenPackageJsonSaved(packageJsonUri);
        ensureRepositoryDocumentsSaved(root);
        const state = await inspectVersionRepository(root);
        const message = `chore: release ${tag}`;
        const confirmed = await vscode.window.showWarningMessage(
            'Commit all saved repository changes and create a local version tag?',
            {
                modal: true,
                detail: `Repository: ${root}\nBranch: ${state.branch}\nCommit: ${message}\nTag: ${tag}\n\n${state.changes || '(No existing changes)'}`,
            },
            'Commit and Tag',
        );
        if (!confirmed) return;
        ensureRepositoryDocumentsSaved(root);
        await ensureVersionRepositoryUnchanged(state);
        const commit = await commitVersionChanges(root, message);
        await createVersionTag(root, commit, tag);
        void vscode.window.showInformationMessage(`Committed (${commit.slice(0, 8)}) and created tag ${tag}.`);
    } catch (error) {
        void vscode.window.showErrorMessage(
            `Create Package Version Tag: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * Updates the root package.json version using a SemVer major, minor, or patch increment.
 * Cancelling before execution leaves the version and repository untouched.
 */
export async function updatePackageVersion(resource?: vscode.Uri): Promise<void> {
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
        if (resource !== undefined && resource.toString() !== packageJsonUri.toString()) {
            throw new Error('Update Package Version is available only for the workspace root package.json.');
        }
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
                          ...(remotes.length
                              ? [
                                    {
                                        label: 'Update, commit, push and tag',
                                        description: `Create and push tag v${update.newVersion}`,
                                        commit: true,
                                        tag: true,
                                    },
                                ]
                              : []),
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
                        ...(action.tag ? [`Tag: v${update.newVersion}`] : []),
                        ...(target ? ['Push includes any earlier unpushed commits on this branch.'] : []),
                        '',
                        'All saved changes, including new and deleted files, will be committed:',
                        state.changes || '(No existing changes)',
                        `Version update: ${path.relative(root, packageJsonUri.fsPath)}`,
                    ].join('\n'),
                },
                action.tag ? 'Commit, Push and Tag' : target ? 'Commit and Push' : 'Commit Locally',
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
        await pushWithRetry(state, commit, target, update.newVersion, action.tag === true);
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
    createTag: boolean,
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
            if (createTag) {
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: `Creating and pushing tag v${version}…`,
                    },
                    () => pushVersionTag(state.root, state.branch, commit, target, `v${version}`),
                );
            }
            showPushedPackageVersionMessage(
                createTag
                    ? `Package version ${version} committed (${commit.slice(0, 8)}), pushed to ${target.remote}/${target.branch}, and tagged v${version}.`
                    : `Package version ${version} committed (${commit.slice(0, 8)}) and pushed to ${target.remote}/${target.branch}.`,
                state.root,
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

function showPushedPackageVersionMessage(message: string, repositoryRoot: string): void {
    void (async () => {
        const selected = await vscode.window.showInformationMessage(message, 'Open Repository Home');
        if (selected === 'Open Repository Home') {
            await vscode.commands.executeCommand('project-atlas.openRepositoryHome', vscode.Uri.file(repositoryRoot));
        }
    })().catch((error: unknown) => console.error('Failed to open repository home', error));
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
