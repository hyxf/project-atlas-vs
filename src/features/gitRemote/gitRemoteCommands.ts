import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseRemoteUrl } from './remoteUrlParser';
import { contains, resolveRepository } from './repositoryResolver';
import { HostingPlatform, OpenTarget } from './types';
import { buildWebUrl, detectHostingPlatform } from './webUrlBuilder';

const platforms: Array<{ label: string; value: HostingPlatform }> = [
    { label: 'GitHub', value: 'github' },
    { label: 'GitLab', value: 'gitlab' },
    { label: 'Bitbucket', value: 'bitbucket' },
    { label: 'Gitee', value: 'gitee' },
    { label: 'Codeup', value: 'codeup' },
];

export function registerGitRemoteCommands(context: vscode.ExtensionContext): void {
    const targets: Array<[string, OpenTarget]> = [
        ['openRepositoryHome', 'repository'],
        ['openCurrentBranch', 'branch'],
        ['openSelectedDirectory', 'directory'],
        ['openSelectedFile', 'file'],
    ];
    for (const [command, target] of targets) {
        context.subscriptions.push(
            vscode.commands.registerCommand(`project-atlas.${command}`, (resource?: vscode.Uri) =>
                executeRemoteCommand(context, target, resource),
            ),
        );
    }
    context.subscriptions.push(
        vscode.commands.registerCommand('project-atlas.copyRemoteUrl', (resource?: vscode.Uri) =>
            copyRemoteUrl(resource),
        ),
    );
}

export async function executeRemoteCommand(
    context: vscode.ExtensionContext,
    target: OpenTarget,
    resource?: vscode.Uri,
): Promise<void> {
    try {
        const selected = resource ?? vscode.window.activeTextEditor?.document.uri;
        const repository = await resolveRepository(selected);
        if (!repository) {
            await vscode.window.showWarningMessage('No origin remote was found for this Git repository.');
            return;
        }
        if (target !== 'repository' && !repository.currentBranch) {
            await vscode.window.showWarningMessage('HEAD is detached; opening the repository home instead.');
            await openUrl(buildWebUrl(repository.originUrl));
            return;
        }
        let relativePath: string | undefined;
        if (target === 'directory' || target === 'file') {
            if (!selected || !contains(repository.root.fsPath, selected.fsPath)) {
                await vscode.window.showWarningMessage('Select a file or directory inside the Git repository.');
                return;
            }
            const stat = await fs.stat(selected.fsPath);
            if (target === 'file' && !stat.isFile()) {
                await vscode.window.showWarningMessage('Select a file to open its remote URL.');
                return;
            }
            relativePath = relativePathForTarget(repository.root.fsPath, selected.fsPath, target, stat.isFile());
        }
        let platform: HostingPlatform | undefined;
        if (target !== 'repository') {
            platform = await resolvePlatform(context, repository.originUrl);
            if (!platform) {
                return;
            }
        }
        await openUrl(
            buildWebUrl(
                repository.originUrl,
                target === 'repository' ? undefined : repository.currentBranch,
                relativePath,
                platform,
                target === 'file' ? 'file' : 'directory',
            ),
        );
    } catch (error) {
        await vscode.window.showErrorMessage(`Failed to open Git remote URL: ${message(error)}`);
    }
}

export function relativePathForTarget(
    repositoryRoot: string,
    resourcePath: string,
    target: 'directory' | 'file',
    resourceIsFile: boolean,
): string {
    const targetPath = target === 'directory' && resourceIsFile ? path.dirname(resourcePath) : resourcePath;
    return path.relative(repositoryRoot, targetPath).replace(/\\/g, '/');
}

async function copyRemoteUrl(resource?: vscode.Uri): Promise<void> {
    try {
        const repository = await resolveRepository(resource ?? vscode.window.activeTextEditor?.document.uri);
        if (!repository) {
            await vscode.window.showWarningMessage('No origin remote was found for this Git repository.');
            return;
        }
        await vscode.env.clipboard.writeText(repository.originUrl);
        await vscode.window.showInformationMessage(`Copied Git remote URL: ${repository.originUrl}`);
    } catch (error) {
        console.error('Failed to copy Git remote URL', error);
        await vscode.window.showErrorMessage(`Failed to copy Git remote URL: ${message(error)}`);
    }
}

async function resolvePlatform(
    context: vscode.ExtensionContext,
    originUrl: string,
): Promise<HostingPlatform | undefined> {
    const remote = parseRemoteUrl(originUrl);
    if (!remote) {
        await vscode.window.showWarningMessage('The origin remote URL is not supported.');
        return undefined;
    }
    const detected = detectHostingPlatform(remote.host);
    if (detected) {
        return detected;
    }
    const key = `aicode.gitRemote.hostingPlatform.${remote.host}`;
    const cached = context.workspaceState.get<HostingPlatform>(key);
    if (cached && platforms.some(({ value }) => value === cached)) {
        return cached;
    }
    const picked = await vscode.window.showQuickPick(platforms, {
        title: 'Select Git Hosting Platform',
        placeHolder: `Choose the URL format for ${remote.host}`,
    });
    if (picked) {
        await context.workspaceState.update(key, picked.value);
    }
    return picked?.value;
}

async function openUrl(url: string | undefined): Promise<void> {
    if (!url) {
        await vscode.window.showWarningMessage('The origin remote URL is not supported.');
        return;
    }
    if (!(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
        throw new Error('VS Code could not open the URL in a browser.');
    }
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
