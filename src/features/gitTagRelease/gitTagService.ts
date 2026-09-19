import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as vscode from 'vscode';
import { GitRemoteInfo, PublishResult, ReleaseState, VersionCandidates } from './types';
import { calculateCandidates, parseRemoteTags } from './versionService';

interface GitResult {
    stdout: string;
    stderr: string;
    code: number;
}

interface GitRunOptions {
    env?: NodeJS.ProcessEnv;
}

export class GitCommandError extends Error {
    constructor(
        readonly args: readonly string[],
        readonly result: GitResult,
    ) {
        super(sanitizeGitOutput(result.stderr || result.stdout) || `Git exited with code ${result.code}.`);
    }
}

export async function runGit(
    repositoryRoot: string,
    args: readonly string[],
    token?: vscode.CancellationToken,
    options: GitRunOptions = {},
): Promise<GitResult> {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
    return new Promise((resolve, reject) => {
        const child = spawn('git', [...args], {
            cwd: repositoryRoot,
            windowsHide: true,
            env: options.env === undefined ? process.env : { ...process.env, ...options.env },
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let cancelled = false;
        const cancellation = token?.onCancellationRequested(() => {
            cancelled = true;
            child.kill();
        });
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
        child.on('error', (error) => {
            cancellation?.dispose();
            reject(error);
        });
        child.on('close', (code) => {
            cancellation?.dispose();
            if (cancelled) {
                return reject(new vscode.CancellationError());
            }
            resolve({
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                code: code ?? 1,
            });
        });
    });
}

async function requiredGit(root: string, args: readonly string[], token?: vscode.CancellationToken): Promise<string> {
    const result = await runGit(root, args, token);
    if (result.code !== 0) {
        throw new GitCommandError(args, result);
    }
    return result.stdout.trim();
}

export class GitTagService {
    async listRemotes(root: string, token?: vscode.CancellationToken): Promise<GitRemoteInfo[]> {
        const names = (await requiredGit(root, ['remote'], token)).split(/\r?\n/).filter(Boolean);
        const remotes: GitRemoteInfo[] = [];
        for (const name of names) {
            const result = await runGit(root, ['remote', 'get-url', '--push', '--all', name], token);
            const pushUrls = result.code === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
            if (pushUrls.length) {
                remotes.push({ name, pushUrls, displayUrl: pushUrls[0]! });
            }
        }
        return remotes.sort((left, right) => left.name.localeCompare(right.name));
    }

    async calculateCandidates(
        root: string,
        remote: GitRemoteInfo,
        token?: vscode.CancellationToken,
    ): Promise<VersionCandidates> {
        const tags = new Set((await requiredGit(root, ['tag', '--list'], token)).split(/\r?\n/).filter(Boolean));
        for (const url of remote.pushUrls) {
            const output = await requiredGit(root, ['ls-remote', '--tags', url], token);
            for (const tag of parseRemoteTags(output)) {
                tags.add(tag);
            }
        }
        return calculateCandidates(tags);
    }

    async inspectReleaseState(
        root: string,
        remote: GitRemoteInfo,
        token?: vscode.CancellationToken,
    ): Promise<ReleaseState> {
        const reference = await requiredGit(root, ['rev-parse', '--verify', 'HEAD'], token);
        const branchResult = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], token);
        const branch = branchResult.code === 0 ? branchResult.stdout.trim() : undefined;
        const status = await requiredGit(root, ['status', '--porcelain', '--untracked-files=normal'], token);
        let trackedBranch: string | undefined;
        let trackingRemote: string | undefined;
        let ahead = 0;
        let behind = 0;
        if (branch) {
            const upstream = await runGit(
                root,
                ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
                token,
            );
            if (upstream.code === 0) {
                trackedBranch = upstream.stdout.trim();
            }
            const configuredRemote = await runGit(root, ['config', '--get', `branch.${branch}.remote`], token);
            if (configuredRemote.code === 0) {
                trackingRemote = configuredRemote.stdout.trim();
            }
            if (trackedBranch && trackingRemote === remote.name) {
                const counts = await requiredGit(
                    root,
                    ['rev-list', '--left-right', '--count', `HEAD...${trackedBranch}`],
                    token,
                );
                const match = /^(\d+)\s+(\d+)$/.exec(counts);
                if (!match) {
                    throw new Error('Git returned an invalid ahead/behind result.');
                }
                ahead = Number(match[1]);
                behind = Number(match[2]);
            }
        }
        return {
            reference,
            ...(branch ? { branch } : {}),
            hasUncommittedChanges: status.length > 0,
            ...(trackedBranch ? { trackedBranch } : {}),
            ...(trackingRemote ? { trackingRemote } : {}),
            ahead,
            behind,
        };
    }

    async publishTag(
        root: string,
        remote: GitRemoteInfo,
        tagName: string,
        confirmedHead: string,
        token?: vscode.CancellationToken,
    ): Promise<PublishResult> {
        try {
            if (!(await fs.stat(root)).isDirectory()) {
                throw new Error('The repository directory no longer exists.');
            }
            const isWorkingTree = await requiredGit(root, ['rev-parse', '--is-inside-work-tree'], token);
            if (isWorkingTree !== 'true') {
                throw new Error('The repository is no longer a Git working tree.');
            }
            const remotes = await this.listRemotes(root, token);
            const currentRemote = remotes.find((candidate) => candidate.name === remote.name);
            if (!currentRemote?.pushUrls.length) {
                throw new Error(`Remote ${remote.name} no longer exists or has no push URL.`);
            }
            if (!sameValues(currentRemote.pushUrls, remote.pushUrls)) {
                throw new Error(`Remote ${remote.name} push URL changed after confirmation.`);
            }
            const currentHead = await requiredGit(root, ['rev-parse', '--verify', 'HEAD'], token);
            if (currentHead !== confirmedHead) {
                return {
                    status: 'targetChanged',
                    message: `Release stopped: HEAD changed from ${confirmedHead.slice(0, 12)} to ${currentHead.slice(0, 12)} after confirmation.`,
                };
            }
            const localTag = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/tags/${tagName}`], token);
            if (localTag.code === 0) {
                return {
                    status: 'localTagExists',
                    message: `Tag ${tagName} already exists locally. Existing tags will not be overwritten.`,
                };
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            return { status: 'checkFailed', message: `Release checks failed: ${errorMessage(error)}` };
        }

        try {
            const push = await runGit(root, ['push', remote.name, `${confirmedHead}:refs/tags/${tagName}`], token);
            if (push.code !== 0) {
                return {
                    status: 'pushFailed',
                    message: `Could not push Git tag ${tagName}: ${sanitizeGitOutput(push.stderr)} Remote state may be uncertain.`,
                };
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return {
                    status: 'pushCancelled',
                    message: `Push of ${tagName} was cancelled; remote state may be uncertain.`,
                };
            }
            return {
                status: 'pushFailed',
                message: `Could not push Git tag ${tagName}: ${errorMessage(error)} Remote state may be uncertain.`,
            };
        }

        try {
            await requiredGit(root, ['tag', tagName, confirmedHead]);
            return { status: 'success', message: `Created and pushed Git tag ${tagName} to ${remote.name}.` };
        } catch (error) {
            return {
                status: 'localTagCreateFailed',
                message: `Remote tag ${tagName} was pushed successfully, but the local tag could not be created: ${errorMessage(error)}`,
            };
        }
    }
}

function sameValues(left: string[], right: string[]): boolean {
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

export function sanitizeGitOutput(value: string): string {
    return value
        .trim()
        .replace(/\b(https?:\/\/)[^/\s]+@/gi, '$1')
        .replace(/([?&](?:access_token|auth|key|password|passwd|secret|token)=)[^&\s'\"]+/gi, '$1***')
        .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***');
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
