import * as vscode from 'vscode';
import { releaseWarnings } from './releaseWarnings';
import { GitRemoteInfo, ReleaseState } from './types';

export async function confirmRelease(
    repositoryRoot: string,
    remote: GitRemoteInfo,
    tagName: string,
    state: ReleaseState,
): Promise<boolean> {
    const warnings = releaseWarnings(state, remote.name);
    const summary = `Create and push ${tagName} to ${remote.name}?`;
    const detail = [
        `Repository: ${repositoryRoot}`,
        `Branch: ${state.branch ?? 'Detached HEAD'}`,
        `Tracking branch: ${state.trackedBranch ?? 'None'}`,
        `Remote: ${remote.name}`,
        `Tag: ${tagName}`,
        `Commit: ${state.reference.slice(0, 12)}`,
        '',
        ...(warnings.length
            ? ['Warnings:', ...warnings.map((warning) => `• ${warning}`)]
            : ['Pre-release checks: Passed']),
    ].join('\n');
    const options: vscode.MessageOptions = { modal: true, detail };
    const answer = warnings.length
        ? await vscode.window.showWarningMessage(summary, options, 'Confirm Release')
        : await vscode.window.showInformationMessage(summary, options, 'Confirm Release');
    return answer === 'Confirm Release';
}
