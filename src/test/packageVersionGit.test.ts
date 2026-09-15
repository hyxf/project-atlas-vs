import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createRequire } from 'module';
import { runInNewContext } from 'vm';
import { runGit } from '../features/gitTagRelease/gitTagService';
import {
    commitVersionChanges,
    ensureVersionRepositoryUnchanged,
    findVersionRepository,
    inspectVersionRepository,
    preferredVersionRemote,
    pushVersionCommit,
    resolveVersionPushTarget,
} from '../features/packageVersion/packageVersionGitService';

suite('Package Version Git', () => {
    let temporary: string;
    let root: string;
    let remote: string;

    async function git(directory: string, args: string[]): Promise<string> {
        const result = await runGit(directory, args);
        assert.strictEqual(result.code, 0, result.stderr);
        return result.stdout.trim();
    }

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-version-git-'));
        root = path.join(temporary, 'work');
        remote = path.join(temporary, 'remote.git');
        await fs.mkdir(root);
        await git(root, ['init', '-b', 'main']);
        await git(root, ['config', 'user.name', 'Atlas Test']);
        await git(root, ['config', 'user.email', 'atlas@example.test']);
        await git(root, ['config', 'commit.gpgsign', 'false']);
        await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.0.0"}\n');
    });

    teardown(async () => {
        await fs.rm(temporary, { recursive: true, force: true });
    });

    async function addRemote(): Promise<void> {
        await git(temporary, ['init', '--bare', remote]);
        await git(root, ['remote', 'add', 'origin', remote]);
    }

    async function runWorkflow(cancelAt: string, commit = true, keepNotificationsOpen = false): Promise<string[]> {
        const commandFile = path.join(__dirname, '../features/packageVersion/packageVersionCommand.js');
        const localRequire = createRequire(commandFile);
        const messages: string[] = [];
        let step = 0;
        const exports: { updatePackageVersion?: () => Promise<void> } = {};
        runInNewContext(await fs.readFile(commandFile, 'utf8'), {
            exports,
            TextEncoder,
            TextDecoder,
            console,
            require: (id: string) =>
                id === 'vscode'
                    ? {
                          ...vscode,
                          workspace: {
                              fs: vscode.workspace.fs,
                              workspaceFolders: [{ uri: vscode.Uri.file(root) }],
                              textDocuments: [],
                          },
                          window: {
                              showQuickPick: async () => {
                                  if (cancelAt === 'error') {
                                      throw new Error('Simulated operation failure');
                                  }
                                  step++;
                                  if ((step === 1 && cancelAt === 'version') || (step === 2 && cancelAt === 'action')) {
                                      return undefined;
                                  }
                                  return step === 1 ? { increment: 'patch' } : { commit };
                              },
                              showWarningMessage: async () =>
                                  cancelAt === 'confirmation' ? undefined : 'Commit Locally',
                              showInformationMessage: async (message: string) => {
                                  messages.push(message);
                                  if (keepNotificationsOpen) {
                                      await new Promise<void>(() => {});
                                  }
                              },
                              showErrorMessage: async (message: string) => {
                                  if (keepNotificationsOpen) {
                                      messages.push(message);
                                      await new Promise<void>(() => {});
                                      return;
                                  }
                                  throw new Error(message);
                              },
                              withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
                          },
                      }
                    : localRequire(id),
        });
        await exports.updatePackageVersion!();
        if (keepNotificationsOpen) {
            step = 0;
            await exports.updatePackageVersion!();
        }
        return messages;
    }

    for (const step of ['version', 'action', 'confirmation']) {
        test(`cancelling at ${step} leaves the package file and index untouched`, async () => {
            const before = await git(root, ['status', '--porcelain']);
            assert.deepStrictEqual(await runWorkflow(step), []);
            assert.strictEqual(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"version":"1.0.0"}\n');
            assert.strictEqual(await git(root, ['status', '--porcelain']), before);
            assert.strictEqual((await inspectVersionRepository(root)).head, '');
        });
    }

    test('the command can update only or update and commit all saved changes', async () => {
        const messages = await runWorkflow('', false);
        assert.ok(messages[0]?.includes('1.0.0 → 1.0.1'));
        assert.strictEqual((await inspectVersionRepository(root)).head, '');
        await runWorkflow('');
        assert.strictEqual(await git(root, ['log', '-1', '--format=%s']), 'chore: bump version to 1.0.2');
        assert.strictEqual(await git(root, ['show', 'HEAD:package.json']), '{"version":"1.0.2"}');
        assert.strictEqual(await git(root, ['status', '--porcelain']), '');
    });

    for (const mode of ['version only', 'local commit', 'push', 'error']) {
        test(`releases the operation lock while the ${mode} notification stays open`, async () => {
            if (mode === 'push') {
                await addRemote();
            }
            const messages = await runWorkflow(mode === 'error' ? 'error' : '', mode !== 'version only', true);
            assert.strictEqual(messages.length, 2);
            assert.ok(messages.every((message) => !message.includes('already in progress')));
            if (mode === 'error') {
                assert.ok(messages.every((message) => message.includes('Simulated operation failure')));
            } else {
                assert.strictEqual(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"version":"1.0.2"}\n');
                if (mode === 'push') {
                    assert.strictEqual(
                        await git(remote, ['rev-parse', 'main']),
                        await git(root, ['rev-parse', 'HEAD']),
                    );
                }
            }
        }).timeout(10000);
    }

    test('detects non-Git directories and supports a first local commit', async () => {
        assert.strictEqual(await findVersionRepository(temporary), undefined);
        assert.strictEqual(await findVersionRepository(root), await fs.realpath(root));
        const state = await inspectVersionRepository(root);
        assert.strictEqual(state.head, '');
        assert.deepStrictEqual(state.remotes, []);
        await ensureVersionRepositoryUnchanged(state);
        const commit = await commitVersionChanges(root, 'chore: bump version to 1.0.0');
        assert.strictEqual(await git(root, ['rev-parse', 'HEAD']), commit);
        assert.strictEqual(await git(root, ['status', '--porcelain']), '');
    });

    test('commits staged, unstaged, new and deleted files while respecting ignores', async () => {
        await fs.writeFile(path.join(root, 'removed.txt'), 'old');
        await commitVersionChanges(root, 'initial');
        await fs.writeFile(path.join(root, 'staged.txt'), 'staged');
        await git(root, ['add', 'staged.txt']);
        await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.0.1"}\n');
        await fs.writeFile(path.join(root, 'new.txt'), 'new');
        await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
        await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored');
        await fs.unlink(path.join(root, 'removed.txt'));
        await commitVersionChanges(root, 'chore: bump version to 1.0.1');
        const files = await git(root, ['ls-tree', '-r', '--name-only', 'HEAD']);
        assert.ok(files.includes('staged.txt'));
        assert.ok(files.includes('new.txt'));
        assert.ok(!files.includes('removed.txt'));
        assert.ok(!files.includes('ignored.txt'));
        assert.strictEqual(await git(root, ['show', 'HEAD:package.json']), '{"version":"1.0.1"}');
    });

    test('pushes to a new remote branch and establishes tracking', async () => {
        await addRemote();
        const state = await inspectVersionRepository(root);
        assert.strictEqual(await preferredVersionRemote(state), 'origin');
        const target = await resolveVersionPushTarget(state, 'origin');
        assert.strictEqual(target.setUpstream, true);
        const commit = await commitVersionChanges(root, 'version');
        await pushVersionCommit(root, state.branch, commit, target);
        assert.strictEqual(await git(remote, ['rev-parse', 'refs/heads/main']), commit);
        assert.strictEqual(await git(root, ['config', 'branch.main.remote']), 'origin');
        assert.strictEqual(await git(root, ['config', 'branch.main.merge']), 'refs/heads/main');
    });

    test('uses the configured upstream branch even when its name differs', async () => {
        await addRemote();
        await git(root, ['config', 'branch.main.remote', 'origin']);
        await git(root, ['config', 'branch.main.merge', 'refs/heads/releases']);
        const state = await inspectVersionRepository(root);
        const target = await resolveVersionPushTarget(state, 'origin');
        assert.strictEqual(target.branch, 'releases');
        const commit = await commitVersionChanges(root, 'version');
        await pushVersionCommit(root, state.branch, commit, target);
        assert.strictEqual(await git(remote, ['rev-parse', 'refs/heads/releases']), commit);
    });

    test('leaves multiple remotes without an upstream for user selection', async () => {
        await addRemote();
        await git(root, ['remote', 'add', 'backup', path.join(temporary, 'backup.git')]);
        assert.strictEqual(await preferredVersionRemote(await inspectVersionRepository(root)), undefined);
    });

    test('detects content changes while confirmation is open', async () => {
        const state = await inspectVersionRepository(root);
        await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.0.1"}\n');
        await assert.rejects(ensureVersionRepositoryUnchanged(state), /Repository changed/);
        await commitVersionChanges(root, 'initial');
        await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.0.2"}\n');
        const trackedState = await inspectVersionRepository(root);
        await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.0.3"}\n');
        await assert.rejects(ensureVersionRepositoryUnchanged(trackedState), /Repository changed/);
    });

    test('blocks detached HEAD and an unfinished merge', async () => {
        await commitVersionChanges(root, 'initial');
        await git(root, ['checkout', '--detach']);
        await assert.rejects(inspectVersionRepository(root), /detached HEAD/);
        await git(root, ['checkout', 'main']);
        await fs.writeFile(path.join(root, '.git', 'MERGE_HEAD'), `${await git(root, ['rev-parse', 'HEAD'])}\n`);
        await assert.rejects(inspectVersionRepository(root), /current Git operation/);
    });

    test('retains a local commit after push rejection and retries without another commit', async () => {
        await addRemote();
        const hook = path.join(remote, 'hooks', 'pre-receive');
        await fs.writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        const state = await inspectVersionRepository(root);
        const target = await resolveVersionPushTarget(state, 'origin');
        const commit = await commitVersionChanges(root, 'version');
        await assert.rejects(pushVersionCommit(root, state.branch, commit, target));
        assert.strictEqual(await git(root, ['rev-parse', 'HEAD']), commit);
        await fs.unlink(hook);
        await pushVersionCommit(root, state.branch, commit, target);
        assert.strictEqual(await git(root, ['rev-list', '--count', 'HEAD']), '1');
        assert.strictEqual(await git(remote, ['rev-parse', 'main']), commit);
    });

    test('blocks changed push URLs and HEAD during retry', async () => {
        await addRemote();
        const state = await inspectVersionRepository(root);
        const target = await resolveVersionPushTarget(state, 'origin');
        const commit = await commitVersionChanges(root, 'initial');
        await git(root, ['remote', 'set-url', 'origin', path.join(temporary, 'elsewhere.git')]);
        await assert.rejects(pushVersionCommit(root, state.branch, commit, target), /push URL changed/);
        await git(root, ['commit', '--allow-empty', '-m', 'another commit']);
        await assert.rejects(pushVersionCommit(root, state.branch, commit, target), /HEAD changed/);
    });

    test('preserves working files when a commit hook fails', async () => {
        await fs.writeFile(path.join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
        await assert.rejects(commitVersionChanges(root, 'version'));
        assert.strictEqual(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"version":"1.0.0"}\n');
        assert.ok((await git(root, ['diff', '--cached', '--name-only'])).includes('package.json'));
    });
});
