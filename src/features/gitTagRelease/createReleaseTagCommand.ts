import * as vscode from 'vscode';
import { GitTagService } from './gitTagService';
import { confirmRelease } from './releaseConfirmation';
import { repositoryWebUrl } from './remoteUrlResolver';
import { selectPushRemote, selectRepository } from './repositorySelector';
import { PublishResult, VersionCandidates } from './types';
import { formatVersion } from './versionService';

const activeRepositories = new Set<string>();

export async function createReleaseTagCommand(): Promise<void> {
    const root = await selectRepository();
    if (!root) {
        return;
    }
    if (activeRepositories.has(root)) {
        await vscode.window.showWarningMessage('A release tag operation is already running for this repository.');
        return;
    }
    activeRepositories.add(root);
    try {
        const service = new GitTagService();
        const remote = await selectPushRemote(await service.listRemotes(root));
        if (!remote) {
            return;
        }
        const candidates = await progress('Reading Git Tags', (token) =>
            service.calculateCandidates(root, remote, token),
        );
        const tagName = await pickVersion(candidates);
        if (!tagName) {
            return;
        }
        const state = await progress('Checking Release State', (token) =>
            service.inspectReleaseState(root, remote, token),
        );
        if (!(await confirmRelease(root, remote, tagName, state))) {
            return;
        }
        const result = await progress(`Publishing Git Tag ${tagName}`, (token) =>
            service.publishTag(root, remote, tagName, state.reference, token),
        );
        await showPublishResult(result, remote.displayUrl);
        if (result.status === 'success') {
            void vscode.commands.executeCommand('git.refresh');
        }
    } catch (error) {
        if (!(error instanceof vscode.CancellationError)) {
            await vscode.window.showErrorMessage(`Create Release Tag: ${message(error)}`);
        }
    } finally {
        activeRepositories.delete(root);
    }
}

export async function pickVersion(candidates: VersionCandidates): Promise<string | undefined> {
    const picked = await vscode.window.showQuickPick(
        [
            { label: formatVersion(candidates.patch), description: 'Patch (bug fixes)' },
            { label: formatVersion(candidates.minor), description: 'Minor (new functionality)' },
            { label: formatVersion(candidates.major), description: 'Major (breaking changes)' },
        ],
        { title: 'Create Release Tag', placeHolder: `Current version: ${formatVersion(candidates.current)}` },
    );
    return picked?.label;
}

async function showPublishResult(result: PublishResult, remoteUrl?: string): Promise<void> {
    if (result.status === 'success') {
        const webUrl = remoteUrl && repositoryWebUrl(remoteUrl);
        const choice = await vscode.window.showInformationMessage(
            result.message,
            ...(webUrl ? ['Open Repository'] : []),
        );
        if (choice === 'Open Repository' && webUrl) {
            await vscode.env.openExternal(vscode.Uri.parse(webUrl));
        }
    } else if (
        result.status === 'localTagExists' ||
        result.status === 'targetChanged' ||
        result.status === 'pushCancelled'
    ) {
        await vscode.window.showWarningMessage(result.message);
    } else {
        await vscode.window.showErrorMessage(result.message);
    }
}

function progress<T>(title: string, task: (token: vscode.CancellationToken) => Thenable<T>): Thenable<T> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: true },
        (_progress, token) => task(token),
    );
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
