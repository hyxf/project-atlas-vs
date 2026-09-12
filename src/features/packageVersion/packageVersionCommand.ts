import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import {
    applyVersionIncrement,
    ensureDocumentSaved,
    ensureSourceUnchanged,
    VersionIncrement,
} from './packageVersionService';

const updatePackageVersionCommand = 'project-atlas.updatePackageVersion';

interface VersionQuickPickItem extends vscode.QuickPickItem {
    increment: VersionIncrement;
}

/** Registers the package.json version update command. */
export function registerPackageVersionCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.commands.registerCommand(updatePackageVersionCommand, updatePackageVersion));
}

/**
 * Updates the root package.json version using a SemVer major, minor, or patch increment.
 * User cancellation exits without changing the file or displaying a message.
 */
export async function updatePackageVersion(): Promise<void> {
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
        ensureOpenPackageJsonSaved(packageJsonUri);
        await writePackageJsonAtomically(packageJsonUri, fileContents, new TextEncoder().encode(update.source));
        await vscode.window.showInformationMessage(
            `Package version updated: ${update.oldVersion} → ${update.newVersion}`,
        );
    } catch (error) {
        await vscode.window.showErrorMessage(
            `Failed to update package version: ${error instanceof Error ? error.message : String(error)}`,
        );
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
