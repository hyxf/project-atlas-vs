import * as assert from 'assert';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { relativePathForTarget } from '../features/gitRemote/gitRemoteCommands';
import { parseRemoteUrl } from '../features/gitRemote/remoteUrlParser';
import { contains, firstNonEmptyLine, resolveRepository } from '../features/gitRemote/repositoryResolver';
import { buildWebUrl, detectHostingPlatform } from '../features/gitRemote/webUrlBuilder';

const execute = promisify(execFile);

suite('Git Remote', () => {
    test('parses HTTP, HTTPS, SSH, and SCP-like remotes', () => {
        assert.deepStrictEqual(parseRemoteUrl('git@github.com:team/repo.git'), {
            repositoryUrl: 'https://github.com/team/repo',
            host: 'github.com',
        });
        assert.deepStrictEqual(parseRemoteUrl('ssh://git@gitlab.example.com:2222/team/repo.git/'), {
            repositoryUrl: 'https://gitlab.example.com/team/repo',
            host: 'gitlab.example.com',
        });
        assert.deepStrictEqual(parseRemoteUrl('http://example.com:8080/team/repo.git/'), {
            repositoryUrl: 'http://example.com:8080/team/repo',
            host: 'example.com',
        });
        assert.strictEqual(parseRemoteUrl('/local/repo.git'), undefined);
        assert.strictEqual(parseRemoteUrl('https://example.com/'), undefined);
    });

    test('selects the first non-empty origin value', () => {
        assert.strictEqual(
            firstNonEmptyLine('\n git@github.com:team/first.git\nhttps://example.com/second.git\n'),
            'git@github.com:team/first.git',
        );
        assert.strictEqual(firstNonEmptyLine('\n  \n'), undefined);
    });

    test('checks repository containment without prefix false positives', () => {
        assert.strictEqual(contains('/work/repo', '/work/repo/src/App.ts'), true);
        assert.strictEqual(contains('/work/repo', '/work/repository/App.ts'), false);
        assert.strictEqual(contains('/work/repo', '/work/repo'), true);
    });

    test('detects all supported hosting platforms', () => {
        for (const platform of ['github', 'gitlab', 'bitbucket', 'gitee', 'codeup'] as const) {
            assert.strictEqual(detectHostingPlatform(`${platform}.example.com`), platform);
        }
        assert.strictEqual(detectHostingPlatform('git.example.com'), undefined);
    });

    test('builds platform-specific branch, directory, and file URLs', () => {
        const origin = 'git@github.com:team/repo.git';
        assert.strictEqual(buildWebUrl(origin), 'https://github.com/team/repo');
        assert.strictEqual(
            buildWebUrl(origin, 'feature/login flow', undefined, 'github'),
            'https://github.com/team/repo/tree/feature/login%20flow',
        );
        assert.strictEqual(
            buildWebUrl(origin, 'main', 'src/a file.ts', 'github', 'file'),
            'https://github.com/team/repo/blob/main/src/a%20file.ts',
        );
        assert.strictEqual(
            buildWebUrl('https://gitlab.example.com/team/repo.git', 'main', 'src', 'gitlab', 'directory'),
            'https://gitlab.example.com/team/repo/-/tree/main/src',
        );
        assert.strictEqual(
            buildWebUrl('https://bitbucket.org/team/repo.git', 'main', 'src/a.ts', 'bitbucket', 'file'),
            'https://bitbucket.org/team/repo/src/main/src/a.ts',
        );
    });

    test('normalizes backslashes while preserving path separators', () => {
        assert.strictEqual(
            buildWebUrl('https://gitee.com/team/repo.git', 'feature\\login', 'src\\App.kt', 'gitee', 'file'),
            'https://gitee.com/team/repo/blob/feature/login/src/App.kt',
        );
    });

    test('uses a selected file parent for directories and the file itself for files', () => {
        const root = path.join(path.parse(process.cwd()).root, 'work', 'repo');
        const file = path.join(root, 'src', 'App.kt');
        assert.strictEqual(relativePathForTarget(root, file, 'directory', true), 'src');
        assert.strictEqual(relativePathForTarget(root, file, 'file', true), 'src/App.kt');
        assert.strictEqual(relativePathForTarget(root, root, 'directory', false), '');
    });

    test('uses blob routes for Gitee and Codeup', () => {
        for (const platform of ['gitee', 'codeup'] as const) {
            assert.strictEqual(
                buildWebUrl(
                    `https://${platform}.example.com/team/repo.git`,
                    'release/#1',
                    'a b/file#.ts',
                    platform,
                    'file',
                ),
                `https://${platform}.example.com/team/repo/blob/release/%231/a%20b/file%23.ts`,
            );
        }
    });
});

suite('Git Remote repository integration', () => {
    let temporary: string;

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-git-remote-test-'));
    });

    teardown(async () => {
        await fs.rm(temporary, { recursive: true, force: true });
    });

    test('resolves the repository, first origin URL, and current local branch from a resource', async () => {
        const root = path.join(temporary, 'repository');
        const file = path.join(root, 'src', 'App.ts');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, 'export {};');
        await git(root, ['init', '-b', 'feature/login']);
        await git(root, ['remote', 'add', 'origin', 'git@github.com:team/first.git']);
        await git(root, ['config', '--add', 'remote.origin.url', 'https://example.com/team/second.git']);

        const repository = await resolveRepository(vscode.Uri.file(file));

        assert.strictEqual(await fs.realpath(repository!.root.fsPath), await fs.realpath(root));
        assert.strictEqual(repository?.originUrl, 'git@github.com:team/first.git');
        assert.strictEqual(repository?.currentBranch, 'feature/login');
    });

    test('prefers the nested repository containing the selected resource', async () => {
        const outer = path.join(temporary, 'outer');
        const nested = path.join(outer, 'packages', 'nested');
        const file = path.join(nested, 'README.md');
        await fs.mkdir(nested, { recursive: true });
        await git(outer, ['init', '-b', 'main']);
        await git(outer, ['remote', 'add', 'origin', 'https://github.com/team/outer.git']);
        await git(nested, ['init', '-b', 'nested-branch']);
        await git(nested, ['remote', 'add', 'origin', 'https://gitlab.com/team/nested.git']);
        await fs.writeFile(file, 'nested');

        const repository = await resolveRepository(vscode.Uri.file(file));

        assert.strictEqual(await fs.realpath(repository!.root.fsPath), await fs.realpath(nested));
        assert.strictEqual(repository?.originUrl, 'https://gitlab.com/team/nested.git');
        assert.strictEqual(repository?.currentBranch, 'nested-branch');
    });

    test('returns no branch for detached HEAD and rejects a repository without origin', async () => {
        const detached = path.join(temporary, 'detached');
        await fs.mkdir(detached);
        await git(detached, ['init', '-b', 'main']);
        await git(detached, ['config', 'user.email', 'test@example.com']);
        await git(detached, ['config', 'user.name', 'Test']);
        await fs.writeFile(path.join(detached, 'README.md'), 'test');
        await git(detached, ['add', 'README.md']);
        await git(detached, ['commit', '-m', 'initial']);
        await git(detached, ['remote', 'add', 'origin', 'https://github.com/team/repo.git']);
        await git(detached, ['checkout', '--detach']);
        const repository = await resolveRepository(vscode.Uri.file(detached));
        assert.strictEqual(repository?.currentBranch, undefined);

        const noOrigin = path.join(temporary, 'no-origin');
        await fs.mkdir(noOrigin);
        await git(noOrigin, ['init', '-b', 'main']);
        assert.strictEqual(await resolveRepository(vscode.Uri.file(noOrigin)), undefined);
    });
});

async function git(cwd: string, args: string[]): Promise<void> {
    await execute('git', args, { cwd });
}
