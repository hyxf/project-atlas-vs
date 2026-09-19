import * as assert from 'assert';
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { buildManagedSection, buildNewChangelog, replaceManagedSection } from '../features/changelog/changelogBuilder';
import { GitChangelogService, parseTags } from '../features/changelog/gitChangelogService';

const execute = promisify(execFile);

suite('Create or Update CHANGELOG.md', () => {
    test('builds categories in fixed order and keeps commit order', () => {
        const markdown = buildNewChangelog({
            releases: [
                {
                    version: 'Unreleased',
                    date: '',
                    unreleased: true,
                    commits: [
                        { hash: '1', subject: 'fix(ui): second' },
                        { hash: '2', subject: 'feat: first' },
                        { hash: '3', subject: 'REFactor!: third' },
                        { hash: '4', subject: 'plain change' },
                    ],
                },
            ],
        });
        assert.ok(markdown.endsWith('\n'));
        assert.ok(markdown.indexOf('### Added') < markdown.indexOf('### Fixed'));
        assert.ok(markdown.indexOf('### Fixed') < markdown.indexOf('### Changed'));
        assert.match(markdown, /- \*\*ui:\*\* second/);
        assert.match(markdown, /### Other Changes\n\n- plain change/);
    });

    test('preserves every character outside a valid managed section', () => {
        const original = 'prefix\r\n<!-- aicode-changelog:start -->old<!-- aicode-changelog:end -->\r\nsuffix';
        const managed = buildManagedSection({ releases: [] });
        assert.strictEqual(replaceManagedSection(original, managed), `prefix\r\n${managed}\r\nsuffix`);
        assert.strictEqual(replaceManagedSection('no markers', managed), undefined);
        assert.throws(
            () => replaceManagedSection('<!-- aicode-changelog:start -->', managed),
            /exactly one ordered pair/,
        );
    });

    test('escapes managed markers contained in subjects', () => {
        const markdown = buildManagedSection({
            releases: [
                {
                    version: '1.0.0',
                    date: '2026-09-04',
                    unreleased: false,
                    commits: [{ hash: '1', subject: 'feat: <!-- aicode-changelog:end -->' }],
                },
            ],
        });
        assert.match(markdown, /&lt;!-- aicode-changelog:end --&gt;/);
        assert.strictEqual(markdown.split('<!-- aicode-changelog:end -->').length - 1, 1);
    });

    test('accepts only full stable v-tags and keeps bigint precision', () => {
        const tags = parseTags('v01.2.3\t2026-01-01\nv999999999999999999999.0.0\t\n1.2.3\tdate\nv1.0.0-beta\tdate\n');
        assert.strictEqual(tags.length, 2);
        assert.strictEqual(tags[0]!.major, 1n);
        assert.strictEqual(tags[1]!.major, 999999999999999999999n);
    });

    test('reads release ranges in descending order and excludes merge commits', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-test-'));
        const cancellation = new vscode.CancellationTokenSource();
        try {
            await git(temporary, ['init', '--initial-branch=main']);
            await git(temporary, ['config', 'user.email', 'test@example.com']);
            await git(temporary, ['config', 'user.name', 'Test']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'feat: initial']);
            await git(temporary, ['tag', 'v01.0.0']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'fix(core): released']);
            await git(temporary, ['tag', 'v1.2.0']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'docs: pending']);
            const data = await new GitChangelogService().read(temporary, cancellation.token);
            assert.deepStrictEqual(
                data.releases.map(({ version, commits }) => [version, commits.map(({ subject }) => subject)]),
                [
                    ['Unreleased', ['docs: pending']],
                    ['1.2.0', ['fix(core): released']],
                    ['01.0.0', ['feat: initial']],
                ],
            );
        } finally {
            cancellation.dispose();
            await fs.rm(temporary, { recursive: true, force: true });
        }
    });

    test('rejects semantic-version tags that do not form an ancestry chain', async () => {
        const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'changelog-linear-test-'));
        const cancellation = new vscode.CancellationTokenSource();
        try {
            await git(temporary, ['init', '--initial-branch=main']);
            await git(temporary, ['config', 'user.email', 'test@example.com']);
            await git(temporary, ['config', 'user.name', 'Test']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'base']);
            await git(temporary, ['checkout', '-b', 'release']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'release one']);
            await git(temporary, ['tag', 'v1.0.0']);
            await git(temporary, ['checkout', 'main']);
            await git(temporary, ['commit', '--allow-empty', '-m', 'release two']);
            await git(temporary, ['tag', 'v2.0.0']);
            await git(temporary, ['merge', '--no-ff', 'release', '-m', 'merge release histories']);
            await assert.rejects(
                () => new GitChangelogService().read(temporary, cancellation.token),
                /v1\.0\.0 is not an ancestor of v2\.0\.0/,
            );
        } finally {
            cancellation.dispose();
            await fs.rm(temporary, { recursive: true, force: true });
        }
    });
});

async function git(cwd: string, args: string[]): Promise<string> {
    return (await execute('git', args, { cwd })).stdout.trim();
}
