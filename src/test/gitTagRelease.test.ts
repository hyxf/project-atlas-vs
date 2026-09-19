import * as assert from 'assert';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { GitTagService, sanitizeGitOutput } from '../features/gitTagRelease/gitTagService';
import { releaseWarnings } from '../features/gitTagRelease/releaseWarnings';
import { repositoryWebUrl } from '../features/gitTagRelease/remoteUrlResolver';
import { GitRemoteInfo, ReleaseState } from '../features/gitTagRelease/types';
import {
    calculateCandidates,
    compareVersions,
    formatVersion,
    parseRemoteTags,
    parseVersion,
} from '../features/gitTagRelease/versionService';

const execute = promisify(execFile);

suite('Create Release Tag', () => {
    test('parses, normalizes, compares, and increments semantic versions with bigint', () => {
        assert.deepStrictEqual(parseVersion('v01.002.0003'), { major: 1n, minor: 2n, patch: 3n });
        for (const invalid of ['1.2.3', 'v1.2', 'v1.2.3-beta', 'v-1.2.3', 'v1.2.3x']) {
            assert.strictEqual(parseVersion(invalid), undefined);
        }
        assert.ok(compareVersions(parseVersion('v1.10.0')!, parseVersion('v1.9.9')!) > 0);
        const candidates = calculateCandidates(['v1.9.9', 'v1.10.0', 'v999999999999999999999.0.0']);
        assert.strictEqual(formatVersion(candidates.major), 'v1000000000000000000000.0.0');
        assert.strictEqual(formatVersion(candidates.minor), 'v999999999999999999999.1.0');
        assert.strictEqual(formatVersion(candidates.patch), 'v999999999999999999999.0.1');
    });

    test('extracts only direct remote tag refs', () => {
        assert.deepStrictEqual(
            parseRemoteTags(
                'abc refs/tags/v1.0.0\nabc refs/tags/v1.0.0^{}\ndef refs/heads/main\nbroken\ndef refs/tags/v2.0.0\n',
            ),
            ['v1.0.0', 'v2.0.0'],
        );
    });

    test('generates release warnings in the specified stable order', () => {
        const state: ReleaseState = {
            reference: 'abc',
            hasUncommittedChanges: true,
            trackedBranch: 'other/main',
            trackingRemote: 'other',
            ahead: 2,
            behind: 1,
        };
        assert.deepStrictEqual(releaseWarnings(state, 'origin'), [
            'HEAD is detached; the tag is not associated with a local branch.',
            'The working tree contains uncommitted or untracked changes.',
            'The tracking branch belongs to a different remote: other/main.',
            'The current branch is 2 commit(s) ahead of other/main; those commits may not be pushed.',
            'The current branch is 1 commit(s) behind other/main.',
        ]);
    });

    test('converts common remotes to sanitized repository URLs', () => {
        assert.strictEqual(repositoryWebUrl('git@example.com:owner/repo.git'), 'https://example.com/owner/repo');
        assert.strictEqual(repositoryWebUrl('ssh://git@example.com/owner/repo.git'), 'https://example.com/owner/repo');
        assert.strictEqual(
            repositoryWebUrl('https://user:token@example.com/owner/repo.git'),
            'https://example.com/owner/repo',
        );
    });

    test('removes username-only and username/password credentials from Git output', () => {
        assert.strictEqual(
            sanitizeGitOutput("fatal: unable to access 'https://token@example.com/owner/repo.git'"),
            "fatal: unable to access 'https://example.com/owner/repo.git'",
        );
        assert.strictEqual(
            sanitizeGitOutput('remote https://user:p%40ss@example.com/owner/repo.git failed'),
            'remote https://example.com/owner/repo.git failed',
        );
        assert.strictEqual(
            sanitizeGitOutput(
                'fatal https://example.com/repo?access_token=secret&key=other Authorization: Bearer abc.def',
            ),
            'fatal https://example.com/repo?access_token=***&key=*** Authorization: Bearer ***',
        );
    });
});

suite('Create Release Tag Git integration', () => {
    let temporary: string;
    let working: string;
    let remotePath: string;
    let remote: GitRemoteInfo;
    const service = new GitTagService();

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'release-tag-test-'));
        working = path.join(temporary, 'working repo');
        remotePath = path.join(temporary, 'remote.git');
        await git(temporary, ['init', '--bare', remotePath]);
        await git(temporary, ['init', working]);
        await git(working, ['config', 'user.email', 'test@example.com']);
        await git(working, ['config', 'user.name', 'Test']);
        await fs.writeFile(path.join(working, 'README.md'), 'initial');
        await git(working, ['add', 'README.md']);
        await git(working, ['commit', '-m', 'initial']);
        await git(working, ['remote', 'add', 'origin', remotePath]);
        remote = { name: 'origin', pushUrls: [remotePath], displayUrl: remotePath };
    });

    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('merges local and remote tags and publishes a lightweight tag at confirmed HEAD', async () => {
        await git(working, ['tag', 'v1.9.9']);
        await git(working, ['tag', 'v1.10.0']);
        await git(working, ['push', 'origin', 'v1.10.0']);
        await git(working, ['tag', '-d', 'v1.10.0']);
        const candidates = await service.calculateCandidates(working, remote);
        assert.strictEqual(formatVersion(candidates.patch), 'v1.10.1');
        const state = await service.inspectReleaseState(working, remote);
        const result = await service.publishTag(working, remote, 'v1.10.1', state.reference);
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(await git(working, ['rev-parse', 'v1.10.1']), state.reference);
        assert.strictEqual(await git(temporary, ['--git-dir', remotePath, 'rev-parse', 'v1.10.1']), state.reference);
        assert.strictEqual(await git(working, ['cat-file', '-t', 'v1.10.1']), 'commit');
    });

    test('does not create a local tag when the remote rejects an existing tag', async () => {
        const state = await service.inspectReleaseState(working, remote);
        await git(working, ['commit', '--allow-empty', '-m', 'competing release']);
        await git(working, ['push', 'origin', 'HEAD:refs/tags/v1.0.0']);
        await git(working, ['reset', '--hard', state.reference]);
        const result = await service.publishTag(working, remote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'pushFailed');
        await assert.rejects(() => git(working, ['show-ref', '--verify', 'refs/tags/v1.0.0']));
    });

    test('stops when HEAD changes after confirmation', async () => {
        const state = await service.inspectReleaseState(working, remote);
        await fs.writeFile(path.join(working, 'README.md'), 'changed');
        await git(working, ['commit', '-am', 'changed']);
        const result = await service.publishTag(working, remote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'targetChanged');
        await assert.rejects(() =>
            git(temporary, ['--git-dir', remotePath, 'show-ref', '--verify', 'refs/tags/v1.0.0']),
        );
    });

    test('stops when a local tag appears after confirmation', async () => {
        const state = await service.inspectReleaseState(working, remote);
        await git(working, ['tag', 'v1.0.0']);
        const result = await service.publishTag(working, remote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'localTagExists');
    });

    test('reports dirty and detached states as warnings without rejecting them', async () => {
        await fs.writeFile(path.join(working, 'untracked file.txt'), 'dirty');
        await git(working, ['checkout', '--detach']);
        const state = await service.inspectReleaseState(working, remote);
        assert.strictEqual(state.branch, undefined);
        assert.strictEqual(state.hasUncommittedChanges, true);
        assert.deepStrictEqual(releaseWarnings(state, 'origin').slice(0, 2), [
            'HEAD is detached; the tag is not associated with a local branch.',
            'The working tree contains uncommitted or untracked changes.',
        ]);
    });

    test('fails the final check when the selected remote was removed', async () => {
        const state = await service.inspectReleaseState(working, remote);
        await git(working, ['remote', 'remove', 'origin']);
        const result = await service.publishTag(working, remote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'checkFailed');
        assert.match(result.message, /no longer exists or has no push URL/);
    });

    test('stops when the remote push URL changes after confirmation', async () => {
        const state = await service.inspectReleaseState(working, remote);
        await git(working, ['remote', 'set-url', '--push', 'origin', path.join(temporary, 'changed.git')]);
        const result = await service.publishTag(working, remote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'checkFailed');
        assert.match(result.message, /push URL changed after confirmation/);
    });

    test('rejects a Git directory that is not a working tree', async () => {
        const result = await service.publishTag(remotePath, remote, 'v1.0.0', 'deadbeef');
        assert.strictEqual(result.status, 'checkFailed');
        assert.match(result.message, /no longer a Git working tree/);
    });

    test('propagates cancellation before push so the command can end silently', async () => {
        const state = await service.inspectReleaseState(working, remote);
        const cancellation = new vscode.CancellationTokenSource();
        cancellation.cancel();
        await assert.rejects(
            () => service.publishTag(working, remote, 'v1.0.0', state.reference, cancellation.token),
            vscode.CancellationError,
        );
        cancellation.dispose();
    });

    test('does not create a local tag when the configured push URL is invalid', async () => {
        await git(working, ['remote', 'set-url', '--push', 'origin', path.join(temporary, 'missing.git')]);
        const selectedRemote = (await service.listRemotes(working))[0]!;
        const state = await service.inspectReleaseState(working, selectedRemote);
        const result = await service.publishTag(working, selectedRemote, 'v1.0.0', state.reference);
        assert.strictEqual(result.status, 'pushFailed');
        await assert.rejects(() => git(working, ['show-ref', '--verify', 'refs/tags/v1.0.0']));
    });
});

async function git(cwd: string, args: string[]): Promise<string> {
    const result = await execute('git', args, { cwd });
    return result.stdout.trim();
}
