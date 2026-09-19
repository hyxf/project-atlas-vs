import * as vscode from 'vscode';
import { buildManagedSection, buildNewChangelog, replaceManagedSection } from './changelogBuilder';
import { GitChangelogService, NonLinearReleaseHistoryError } from './gitChangelogService';
import { GitRepositoryService } from './gitRepositoryService';
import { sanitizeGitOutput } from '../gitTagRelease/gitTagService';

interface DiskSnapshot {
    readonly exists: boolean;
    readonly bytes?: Uint8Array;
    readonly mtime?: number;
    readonly size?: number;
}

interface TargetSnapshot {
    readonly disk: DiskSnapshot;
    readonly document?: vscode.TextDocument;
    readonly version?: number;
    readonly dirty?: boolean;
    readonly text?: string;
}

interface PreviewSession {
    readonly id: string;
    readonly preview: vscode.TextDocument;
    resolve(value: boolean): void;
}

const previewSessions = new Map<string, PreviewSession>();

export function registerChangelogCommands(context: vscode.ExtensionContext): void {
    const repositories = new GitRepositoryService();
    const output = vscode.window.createOutputChannel('Project Atlas Changelog');
    const previewRoot = vscode.Uri.joinPath(context.globalStorageUri, 'changelog-previews');
    const previewHost = vscode.Uri.joinPath(previewRoot, `host-${process.pid}-${uniqueId()}`);
    const previewsReady = cleanupStalePreviews(previewRoot, output);
    context.subscriptions.push(repositories, output);
    context.subscriptions.push(
        vscode.commands.registerCommand('aicode.createOrUpdateChangelog', (argument?: unknown) =>
            execute(previewHost, repositories, output, previewsReady, argument),
        ),
        vscode.commands.registerCommand('aicode.confirmChangelogPreview', () => resolveActivePreview(true)),
        vscode.commands.registerCommand('aicode.cancelChangelogPreview', () => resolveActivePreview(false)),
        vscode.window.onDidChangeActiveTextEditor(() => updatePreviewContext()),
    );
    void updatePreviewContext();
}

async function execute(
    previewHost: vscode.Uri,
    repositories: GitRepositoryService,
    output: vscode.OutputChannel,
    previewsReady: Promise<void>,
    argument?: unknown,
): Promise<void> {
    const root = await repositories.select(argument);
    if (!root) {
        return;
    }
    let data;
    try {
        data = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Reading Git History', cancellable: true },
            (_progress, token) => new GitChangelogService().read(root.fsPath, token),
        );
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            return;
        }
        output.appendLine(`Git history failed: ${safeMessage(error)}`);
        await vscode.window.showErrorMessage(
            error instanceof NonLinearReleaseHistoryError
                ? error.message
                : `Failed to read Git history: ${safeMessage(error)}`,
        );
        return;
    }
    const target = vscode.Uri.joinPath(root, 'CHANGELOG.md');
    let snapshot: TargetSnapshot;
    let previewText: string;
    let replaceWholeFile = false;
    try {
        snapshot = await captureTarget(target);
        const managed = buildManagedSection(data);
        if (!snapshot.disk.exists) {
            previewText = buildNewChangelog(data);
        } else {
            const original = snapshot.document!.getText();
            const updated = replaceManagedSection(original, managed);
            replaceWholeFile = updated === undefined;
            previewText = updated ?? buildNewChangelog(data);
        }
    } catch (error) {
        const message = safeMessage(error);
        await vscode.window.showErrorMessage(
            message.startsWith('CHANGELOG.md must') ? message : 'CHANGELOG.md could not be opened as a text document.',
        );
        return;
    }
    await previewsReady;
    let confirmedText: string | undefined;
    try {
        confirmedText = await showPreview(previewHost, previewText, replaceWholeFile, output);
    } catch (error) {
        output.appendLine(`Preview failed: ${safeMessage(error)}`);
        await vscode.window.showErrorMessage(`Failed to open CHANGELOG.md preview: ${safeMessage(error)}`);
        return;
    }
    if (confirmedText === undefined) {
        return;
    }
    const conflict = await targetConflict(target, snapshot);
    if (conflict) {
        await vscode.window.showErrorMessage(conflict);
        return;
    }
    try {
        const edit = new vscode.WorkspaceEdit();
        if (snapshot.disk.exists) {
            const document = snapshot.document!;
            edit.replace(
                target,
                new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
                confirmedText,
            );
        } else {
            edit.createFile(target, { overwrite: false, ignoreIfExists: false });
            edit.insert(target, new vscode.Position(0, 0), confirmedText);
        }
        if (!(await vscode.workspace.applyEdit(edit))) {
            throw new Error('The workspace edit was rejected.');
        }
        const document = snapshot.document ?? (await vscode.workspace.openTextDocument(target));
        if (!(await document.save())) {
            throw new Error('The document could not be saved.');
        }
        await vscode.window.showTextDocument(document, { preview: false });
        await vscode.window.showInformationMessage(
            snapshot.disk.exists ? 'Updated CHANGELOG.md.' : 'Created CHANGELOG.md.',
        );
    } catch (error) {
        output.appendLine(`Write failed: ${safeMessage(error)}`);
        await vscode.window.showErrorMessage(`Failed to write CHANGELOG.md: ${safeMessage(error)}`);
    }
}

async function captureTarget(uri: vscode.Uri): Promise<TargetSnapshot> {
    const open = findDocument(uri);
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if ((stat.type & vscode.FileType.File) === 0) {
            throw new Error('Not a regular file');
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (!open) {
            if (bytes.includes(0)) {
                throw new Error('NUL byte');
            }
            new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        }
        const document = open ?? (await vscode.workspace.openTextDocument(uri));
        return {
            disk: { exists: true, bytes, mtime: stat.mtime, size: stat.size },
            document,
            version: document.version,
            dirty: document.isDirty,
            text: document.getText(),
        };
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            return {
                disk: { exists: false },
                ...(open ? { document: open, version: open.version, dirty: open.isDirty, text: open.getText() } : {}),
            };
        }
        throw error;
    }
}

async function targetConflict(uri: vscode.Uri, snapshot: TargetSnapshot): Promise<string | undefined> {
    const created = 'CHANGELOG.md was created while the preview was open. Generate it again.';
    const changed = 'CHANGELOG.md changed while the preview was open. Generate it again.';
    let currentDisk: DiskSnapshot;
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if ((stat.type & vscode.FileType.File) === 0) {
            return snapshot.disk.exists ? changed : created;
        }
        currentDisk = {
            exists: true,
            bytes: await vscode.workspace.fs.readFile(uri),
            mtime: stat.mtime,
            size: stat.size,
        };
    } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
            return snapshot.disk.exists ? changed : created;
        }
        currentDisk = { exists: false };
    }
    if (!snapshot.disk.exists) {
        if (currentDisk.exists) {
            return created;
        }
        return documentChanged(uri, snapshot) ? changed : undefined;
    }
    if (
        !currentDisk.exists ||
        currentDisk.mtime !== snapshot.disk.mtime ||
        currentDisk.size !== snapshot.disk.size ||
        !equalBytes(currentDisk.bytes!, snapshot.disk.bytes!)
    ) {
        return changed;
    }
    if (documentChanged(uri, snapshot)) {
        return changed;
    }
    return undefined;
}

async function showPreview(
    previewHost: vscode.Uri,
    text: string,
    replace: boolean,
    output: vscode.OutputChannel,
): Promise<string | undefined> {
    const id = uniqueId();
    const directory = vscode.Uri.joinPath(previewHost, id);
    const uri = vscode.Uri.joinPath(directory, 'CHANGELOG.md');
    await vscode.workspace.fs.createDirectory(directory);
    let document: vscode.TextDocument;
    try {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
        document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
        try {
            await vscode.workspace.fs.delete(directory, { recursive: true });
        } catch (cleanupError) {
            output.appendLine(`Preview cleanup failed: ${safeMessage(cleanupError)}`);
        }
        throw error;
    }
    const accepted = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
            if (settled) {
                return;
            }
            settled = true;
            close.dispose();
            resolve(value);
        };
        const session: PreviewSession = { id, preview: document, resolve: finish };
        previewSessions.set(id, session);
        void updatePreviewContext();
        const close = vscode.workspace.onDidCloseTextDocument((closed) => {
            if (closed === document) {
                finish(false);
            }
        });
        const prompt = replace
            ? 'This existing file has no Project Atlas markers. Writing will replace its entire content.'
            : 'Review the CHANGELOG.md preview, then write it to the repository?';
        void vscode.window
            .showInformationMessage(prompt, { modal: false }, replace ? 'Replace File' : 'Write File', 'Cancel')
            .then((choice) => {
                if (choice === (replace ? 'Replace File' : 'Write File')) {
                    finish(true);
                } else if (choice === 'Cancel') {
                    finish(false);
                }
            });
    });
    const result = accepted ? document.getText() : undefined;
    previewSessions.delete(id);
    await updatePreviewContext();
    const closed = await closePreview(document);
    if (!closed) {
        output.appendLine('Preview cleanup failed: the preview editor could not be saved and closed.');
        return result;
    }
    try {
        await vscode.workspace.fs.delete(directory, { recursive: true });
    } catch (error) {
        output.appendLine(`Preview cleanup failed: ${safeMessage(error)}`);
    }
    return result;
}

async function cleanupStalePreviews(previewRoot: vscode.Uri, output: vscode.OutputChannel): Promise<void> {
    try {
        const entries = await vscode.workspace.fs.readDirectory(previewRoot);
        for (const [name, type] of entries) {
            if ((type & vscode.FileType.Directory) === 0 || hostIsAlive(name)) {
                continue;
            }
            try {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(previewRoot, name), { recursive: true });
            } catch (error) {
                output.appendLine(`Preview cleanup failed: ${safeMessage(error)}`);
            }
        }
    } catch (error) {
        if (!(error instanceof vscode.FileSystemError) || error.code !== 'FileNotFound') {
            output.appendLine(`Preview cleanup failed: ${safeMessage(error)}`);
        }
    }
}

function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
}
function documentChanged(uri: vscode.Uri, snapshot: TargetSnapshot): boolean {
    const document = findDocument(uri);
    return (
        document !== snapshot.document ||
        document?.version !== snapshot.version ||
        document?.isDirty !== snapshot.dirty ||
        document?.getText() !== snapshot.text
    );
}
function resolveActivePreview(value: boolean): void {
    const activeDocument = vscode.window.activeTextEditor?.document;
    for (const session of previewSessions.values()) {
        if (activeDocument === session.preview) {
            session.resolve(value);
            return;
        }
    }
}
async function closePreview(document: vscode.TextDocument): Promise<boolean> {
    if (document.isDirty && !(await document.save())) {
        return false;
    }
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
        group.tabs.filter(
            (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString(),
        ),
    );
    if (tabs.length) {
        return vscode.window.tabGroups.close(tabs, true);
    }
    return true;
}
async function updatePreviewContext(): Promise<void> {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const active = [...previewSessions.values()].some((session) => session.preview === activeDocument);
    await vscode.commands.executeCommand('setContext', 'aicode.changelogPreviewActive', active);
}
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
function safeMessage(error: unknown): string {
    const value = error instanceof Error ? error.message : String(error);
    return sanitizeGitOutput(value).trim() || 'Unexpected error';
}
function uniqueId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function hostIsAlive(name: string): boolean {
    const match = /^host-(\d+)-/.exec(name);
    if (!match) {
        return false;
    }
    try {
        process.kill(Number(match[1]), 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}
