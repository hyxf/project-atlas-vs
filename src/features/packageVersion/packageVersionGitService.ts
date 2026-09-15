import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { GitCommandError, runGit } from '../gitTagRelease/gitTagService';

export interface VersionPushTarget {
    remote: string;
    branch: string;
    url: string;
    setUpstream: boolean;
}

export interface VersionRepositoryState {
    root: string;
    branch: string;
    head: string;
    changes: string;
    fingerprint: string;
    remotes: string[];
}

async function git(root: string, args: string[]): Promise<string> {
    const result = await runGit(root, args);
    if (result.code !== 0) {
        throw new GitCommandError(args, result);
    }
    return result.stdout.trimEnd();
}

export async function findVersionRepository(directory: string): Promise<string | undefined> {
    try {
        const result = await runGit(directory, ['rev-parse', '--show-toplevel']);
        return result.code === 0 ? result.stdout.trim() : undefined;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}

export async function readVersionRemoteNames(root: string): Promise<string[]> {
    return (await git(root, ['remote'])).split(/\r?\n/).filter(Boolean);
}

export async function inspectVersionRepository(root: string): Promise<VersionRepositoryState> {
    const branchResult = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (branchResult.code !== 0) {
        throw new Error('Check out a branch before committing the package version (detached HEAD).');
    }
    for (const marker of [
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'rebase-merge',
        'rebase-apply',
        'sequencer',
    ]) {
        const location = await git(root, ['rev-parse', '--git-path', marker]);
        try {
            await fs.stat(path.resolve(root, location));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        throw new Error('Finish or abort the current Git operation before committing the package version.');
    }
    if (await git(root, ['ls-files', '--unmerged'])) {
        throw new Error('Resolve Git conflicts before committing the package version.');
    }
    const headResult = await runGit(root, ['rev-parse', '--verify', 'HEAD']);
    const changes = await git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
    const hash = createHash('sha256');
    hash.update(changes);
    hash.update(await git(root, ['diff', '--binary', '--no-ext-diff']));
    hash.update(await git(root, ['diff', '--cached', '--binary', '--no-ext-diff']));
    const untracked = await git(root, ['ls-files', '--others', '--exclude-standard', '-z']);
    for (const file of untracked.split('\0').filter(Boolean)) {
        const fullPath = path.join(root, file);
        const stat = await fs.lstat(fullPath);
        hash.update(file);
        hash.update(stat.isSymbolicLink() ? await fs.readlink(fullPath) : await fs.readFile(fullPath));
    }
    return {
        root,
        branch: branchResult.stdout.trim(),
        head: headResult.code === 0 ? headResult.stdout.trim() : '',
        changes,
        fingerprint: hash.digest('hex'),
        remotes: await readVersionRemoteNames(root),
    };
}

export async function preferredVersionRemote(state: VersionRepositoryState): Promise<string | undefined> {
    const result = await runGit(state.root, ['config', '--get', `branch.${state.branch}.remote`]);
    const remote = result.stdout.trim();
    return state.remotes.includes(remote) ? remote : state.remotes.length === 1 ? state.remotes[0] : undefined;
}

export async function resolveVersionPushTarget(
    state: VersionRepositoryState,
    remote: string,
): Promise<VersionPushTarget> {
    const urls = (await git(state.root, ['remote', 'get-url', '--push', '--all', remote]))
        .split(/\r?\n/)
        .filter(Boolean);
    if (urls.length !== 1) {
        throw new Error('Configure exactly one push URL for the selected remote before pushing.');
    }
    const configuredRemote = await runGit(state.root, ['config', '--get', `branch.${state.branch}.remote`]);
    const merge = await runGit(state.root, ['config', '--get', `branch.${state.branch}.merge`]);
    const upstream = configuredRemote.stdout.trim() === remote && merge.stdout.trim().startsWith('refs/heads/');
    return {
        remote,
        branch: upstream ? merge.stdout.trim().slice('refs/heads/'.length) : state.branch,
        url: urls[0]!,
        setUpstream: !upstream,
    };
}

export async function ensureVersionRepositoryUnchanged(
    expected: VersionRepositoryState,
    target?: VersionPushTarget,
): Promise<void> {
    const current = await inspectVersionRepository(expected.root);
    if (
        current.head !== expected.head ||
        current.branch !== expected.branch ||
        current.fingerprint !== expected.fingerprint ||
        JSON.stringify(current.remotes) !== JSON.stringify(expected.remotes)
    ) {
        throw new Error('Repository changed during confirmation. Review the changes and try again.');
    }
    if (target && JSON.stringify(await resolveVersionPushTarget(current, target.remote)) !== JSON.stringify(target)) {
        throw new Error('Push target changed during confirmation. Review the remote configuration and try again.');
    }
}

export async function commitVersionChanges(root: string, message: string): Promise<string> {
    await git(root, ['add', '--all', '--', '.']);
    await git(root, ['commit', '-m', message]);
    return git(root, ['rev-parse', 'HEAD']);
}

export async function pushVersionCommit(
    root: string,
    branch: string,
    commit: string,
    target: VersionPushTarget,
): Promise<void> {
    const currentBranch = await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    const head = await git(root, ['rev-parse', 'HEAD']);
    if (currentBranch !== branch || head !== commit) {
        throw new Error('Branch or HEAD changed after the commit. Push the recorded commit manually.');
    }
    const urls = (await git(root, ['remote', 'get-url', '--push', '--all', target.remote])).split(/\r?\n/);
    if (urls.length !== 1 || urls[0] !== target.url) {
        throw new Error('Remote push URL changed. Review the remote configuration before pushing manually.');
    }
    await git(root, ['push', target.remote, `${commit}:refs/heads/${target.branch}`]);
    if (target.setUpstream) {
        await git(root, ['config', `branch.${branch}.remote`, target.remote]);
        await git(root, ['config', `branch.${branch}.merge`, `refs/heads/${target.branch}`]);
    }
}
