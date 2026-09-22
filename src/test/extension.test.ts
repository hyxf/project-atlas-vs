import {
    ensureAiPromptsFile,
    readAiPromptSnapshot,
    changeAiPrompt,
    parseAiPrompts,
} from '../features/aiPrompts/aiPromptStore';
import {
    buildPromptItems,
    PromptTagGroup,
    matchesPrompt,
    renderPromptPreview,
    editAiPrompt,
    editAiPromptTags,
} from '../features/aiPrompts/aiPromptsFeature';
import { validateFormValues } from '../features/templates/templateForm';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { queueTemplateWrite, reorderTemplates } from '../features/templates/templateStore';
import {
    TemplateItem,
    TemplateDragAndDropController,
    TemplateViewRegistration,
    TemplatesTreeProvider,
    loadCommonCommandItems,
    loadGitMessageItems,
    GitMessageTypeGroup,
} from '../features/templates/templatesFeature';
import { editRepositoryForm } from '../features/repositoryManagement/repositoryForm';
import { RepositoryStore } from '../features/repositoryManagement/store';
import * as assert from 'assert';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureCommonCommandsFile } from '../features/commonCommands/commonCommandStore';
import { ensureGitMessagesFile } from '../features/gitMessages/gitMessageStore';
import {
    addCommonCommand,
    readCommonCommandSnapshot,
    updateCommonCommand,
    deleteCommonCommand,
} from '../features/commonCommands/commonCommandStore';
import { readGitMessageSnapshot, updateGitMessage, deleteGitMessage } from '../features/gitMessages/gitMessageStore';
import { ProjectService } from '../features/projectManagement/service';
import { ProjectStore } from '../features/projectManagement/store';
import { editProjectForm } from '../features/projectManagement/projectForm';

suite('Project form data safety', () => {
    let temporary: string;
    let service: ProjectService;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-project-form-'));
        service = new ProjectService(new ProjectStore(path.join(temporary, 'project.json')));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('preserves metadata updated while the project form is open', async () => {
        const project = await service.save('Atlas', temporary, [], false);
        let openedAt: number | null | undefined;
        await editProjectForm(
            project,
            (values) => service.updateDetails(project.id, values),
            async ({ save }) => {
                const otherService = new ProjectService(new ProjectStore(service.store.file));
                await otherService.markOpened(project);
                openedAt = (await otherService.findById(project.id))!.lastOpenedAt;
                const data = JSON.parse(await fs.readFile(service.store.file, 'utf8'));
                data.projects[0].future = { keep: true };
                await fs.writeFile(service.store.file, JSON.stringify(data));
                await save({ name: 'Renamed', tags: 'work', favorite: 'true' });
            },
        );
        assert.ok(openedAt);
        const updated = (await service.projects(true))[0]!;
        assert.strictEqual(updated.lastOpenedAt, openedAt);
        assert.strictEqual(updated.name, 'Renamed');
        assert.strictEqual(updated.path, project.path);
        assert.deepStrictEqual(updated.tags, ['work']);
        assert.strictEqual(updated.favorite, true);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(service.store.file, 'utf8')).projects[0].future, {
            keep: true,
        });
    });

    test('applies detail updates after queued mutations and does not recreate removed projects', async () => {
        const project = await service.save('Atlas', temporary, [], false);
        const values = { name: 'Renamed', tags: ['work'], favorite: true };
        await Promise.all([
            service.update({ ...project, lastOpenedAt: 123 }),
            service.updateDetails(project.id, values),
        ]);
        assert.strictEqual((await service.findById(project.id))!.lastOpenedAt, 123);
        const removal = service.remove(project.id);
        await assert.rejects(service.updateDetails(project.id, values), /Unknown project/);
        await removal;
        assert.deepStrictEqual(await service.projects(true), []);
    });
});

suite('Template record data safety', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-record-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('holds a cross-process lock until commit and releases it on failed writes', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'a' }, { command: 'b' }] }));
        const snapshot = await readCommonCommandSnapshot(file);
        await queueTemplateWrite(file, async () => {
            const script = `
                const { reorderTemplates } = require(process.argv[1]);
                reorderTemplates(process.argv[2], 'commands', JSON.parse(process.argv[3]), [1, 0])
                    .then(() => { process.exitCode = 1; })
                    .catch(error => {
                        if (!error.message.includes('Another writer owns')) { throw error; }
                        console.log('locked');
                    });
            `;
            const { stdout } = await promisify(execFile)(
                process.execPath,
                ['-e', script, require.resolve('../features/templates/templateStore'), file, JSON.stringify(snapshot)],
                { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000 },
            );
            assert.strictEqual(stdout.trim(), 'locked');
            assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
            assert.ok((await fs.stat(`${file}.lock`)).isFile());
        });
        await assert.rejects(
            queueTemplateWrite(file, async () => {
                throw new Error('write failed');
            }),
            /write failed/,
        );
        await reorderTemplates(file, 'commands', snapshot, [1, 0]);
        assert.deepStrictEqual(
            (await readCommonCommandSnapshot(file)).entries.map((item) => item.command),
            ['b', 'a'],
        );
        await assert.rejects(reorderTemplates(file, 'commands', snapshot, [1, 0]), /file has changed/);
        assert.deepStrictEqual(await fs.readdir(temporary), ['commoncmd.json']);
    });

    test('does not remove a lock owned by another writer for any template mutation', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'a' }] }));
        const snapshot = await readCommonCommandSnapshot(file);
        const lock = `${file}.lock`;
        await fs.writeFile(lock, 'another owner');
        await assert.rejects(reorderTemplates(file, 'commands', snapshot, [0]), /Another writer owns/);
        await assert.rejects(updateCommonCommand(snapshot, 0, { command: 'b' }, file), /Another writer owns/);
        await assert.rejects(deleteCommonCommand(snapshot, 0, file), /Another writer owns/);
        await assert.rejects(addCommonCommand('b', undefined, file), /Another writer owns/);
        assert.strictEqual(await fs.readFile(lock, 'utf8'), 'another owner');
        assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
    });

    test('recreates Git message views without native drag capabilities in group mode', async () => {
        let listMode = false;
        const options: vscode.TreeViewOptions<vscode.TreeItem>[] = [];
        let disposedViews = 0;
        let disposedListeners = 0;
        const createView = ((_id: string, value: vscode.TreeViewOptions<vscode.TreeItem>) => {
            options.push(value);
            return {
                dispose: () => {
                    disposedViews++;
                },
                onDidChangeVisibility: () => ({
                    dispose: () => {
                        disposedListeners++;
                    },
                }),
            };
        }) as unknown as typeof vscode.window.createTreeView;
        const provider = new TemplatesTreeProvider(async () => []);
        const registration = new TemplateViewRegistration(
            'test.messages',
            'gitmessage.json',
            provider,
            () => listMode,
            createView,
        );
        try {
            assert.ok(!('dragAndDropController' in options[0]!));
            listMode = true;
            await registration.recreate();
            assert.ok(options[1]!.dragAndDropController instanceof TemplateDragAndDropController);
            listMode = false;
            await registration.recreate();
            assert.ok(!('dragAndDropController' in options[2]!));
            assert.strictEqual(disposedViews, 2);
            assert.strictEqual(disposedListeners, 2);
            const pending = registration.recreate();
            registration.dispose();
            await pending;
            assert.strictEqual(options.length, 3);
        } finally {
            registration.dispose();
            provider.dispose();
        }
    });

    test('reorders raw records and rejects invalid permutations, stale snapshots, and corrupt files', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        const first = { command: ' git status ', extra: { keep: true } };
        const second = { command: 'git diff', future: 2 };
        await fs.writeFile(file, JSON.stringify({ future: true, commands: [first, second] }));
        const snapshot = await readCommonCommandSnapshot(file);
        for (const order of [[0, 0], [0], [0, 2], [0, 0.5]]) {
            await assert.rejects(reorderTemplates(file, 'commands', snapshot, order), /Invalid template order/);
            assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
        }
        await reorderTemplates(file, 'commands', snapshot, [1, 0]);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            future: true,
            commands: [second, first],
        });
        await assert.rejects(reorderTemplates(file, 'commands', snapshot, [0, 1]), /file has changed/);
        await fs.writeFile(file, '{broken');
        await assert.rejects(reorderTemplates(file, 'commands', snapshot, [1, 0]), /file has changed/);
        assert.strictEqual(await fs.readFile(file, 'utf8'), '{broken');
        assert.deepStrictEqual(await fs.readdir(temporary), ['commoncmd.json']);
    });

    test('native command drops insert before targets, append at root, and ignore invalid or cancelled drops', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                commands: [{ command: 'a', description: 'details' }, { command: 'b' }, { command: 'c' }],
            }),
        );
        let refreshed = 0;
        const controller = new TemplateDragAndDropController('test.commands', file, () => {
            refreshed++;
        });
        const token = new vscode.CancellationTokenSource();
        try {
            let items = await loadCommonCommandItems(file);
            const transfer = new vscode.DataTransfer();
            controller.handleDrag([items[2]!], transfer, token.token);
            await controller.handleDrop(items[0], transfer, token.token);
            assert.deepStrictEqual(
                (await readCommonCommandSnapshot(file)).entries.map((item) => item.command),
                ['c', 'a', 'b'],
            );
            items = await loadCommonCommandItems(file);
            controller.handleDrag([items[0]!], transfer, token.token);
            await controller.handleDrop(undefined, transfer, token.token);
            assert.deepStrictEqual(
                (await readCommonCommandSnapshot(file)).entries.map((item) => item.command),
                ['a', 'b', 'c'],
            );
            items = await loadCommonCommandItems(file);
            controller.handleDrag([items[0]!], transfer, token.token);
            await controller.handleDrop(new vscode.TreeItem('description'), transfer, token.token);
            await controller.handleDrop(items[0], transfer, token.token);
            token.cancel();
            await controller.handleDrop(undefined, transfer, token.token);
            assert.strictEqual(refreshed, 2);
        } finally {
            token.dispose();
        }
    });

    test('Git messages support flat ordering across types and disable all sorting in grouped mode', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        const messages = [
            { type: 'fix', subject: 'A', future: 1 },
            { type: 'feat', subject: 'B' },
            { type: 'fix', subject: 'C', extra: true },
        ];
        const contents = JSON.stringify({ future: true, messages });
        await fs.writeFile(file, contents);
        let listMode = false;
        let refreshed = 0;
        const controller = new TemplateDragAndDropController(
            'test.messages',
            file,
            () => {
                refreshed++;
            },
            () => listMode,
        );
        const token = new vscode.CancellationTokenSource();
        try {
            const groups = (await loadGitMessageItems(file, 'GROUP')) as GitMessageTypeGroup[];
            assert.deepStrictEqual(
                groups.map((item) => item.label),
                ['fix', 'feat'],
            );
            const transfer = new vscode.DataTransfer();
            controller.handleDrag([groups[0]!.children[0]!], transfer, token.token);
            assert.strictEqual([...transfer].length, 0);
            let items = await loadGitMessageItems(file, 'LIST');
            assert.deepStrictEqual(
                items.map((item) => item.label),
                ['fix: A', 'feat: B', 'fix: C'],
            );
            assert.ok(items.every((item) => item.contextValue === 'gitMessage'));
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
            listMode = true;
            controller.handleDrag([items[2]!], transfer, token.token);
            // A drop started in list mode must not write after switching to grouped mode.
            listMode = false;
            await controller.handleDrop(groups[0]!.children[0], transfer, token.token);
            await controller.handleDrop(groups[0], transfer, token.token);
            await controller.handleDrop(undefined, transfer, token.token);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
            assert.strictEqual(refreshed, 0);
            listMode = true;
            await controller.handleDrop(groups[0], transfer, token.token);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
            controller.handleDrag([items[2]!], transfer, token.token);
            await controller.handleDrop(items[1], transfer, token.token);
            assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
                future: true,
                messages: [messages[0], messages[2], messages[1]],
            });
            items = await loadGitMessageItems(file, 'LIST');
            controller.handleDrag([items[0]!], transfer, token.token);
            await controller.handleDrop(undefined, transfer, token.token);
            assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
                future: true,
                messages: [messages[2], messages[1], messages[0]],
            });
            assert.strictEqual(refreshed, 2);
            const saved = await fs.readFile(file, 'utf8');
            const regrouped = (await loadGitMessageItems(file, 'GROUP')) as GitMessageTypeGroup[];
            assert.deepStrictEqual(
                regrouped[0]!.children.map((item) => item.label),
                ['fix: C', 'fix: A'],
            );
            assert.strictEqual(await fs.readFile(file, 'utf8'), saved);
        } finally {
            token.dispose();
        }
    });

    test('appends commands without replacing records and rejects duplicate or stale additions', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ future: true, commands: [{ command: 'git status', extra: 1 }] }));
        const snapshot = await readCommonCommandSnapshot(file);
        await assert.rejects(updateCommonCommand(snapshot, null, { command: ' git status ' }, file), /already exists/);
        await assert.rejects(updateCommonCommand(snapshot, null, { command: '' }, file), /non-empty/);
        await updateCommonCommand(snapshot, null, { command: ' git diff ', description: ' Changes ' }, file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            future: true,
            commands: [
                { command: 'git status', extra: 1 },
                { command: 'git diff', description: 'Changes' },
            ],
        });
        await assert.rejects(updateCommonCommand(snapshot, null, { command: 'git log' }, file), /file has changed/);
    });

    test('appends Git messages to empty arrays, preserves fields, and refuses corrupt data', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(file, JSON.stringify({ future: true, messages: [] }));
        const snapshot = await readGitMessageSnapshot(file);
        await assert.rejects(updateGitMessage(snapshot, null, { type: '', subject: 'New' }, file), /non-empty/);
        await updateGitMessage(snapshot, null, { type: ' feat ', scope: '', subject: ' New ' }, file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            future: true,
            messages: [{ type: 'feat', subject: 'New' }],
        });
        await fs.writeFile(file, '{broken');
        await assert.rejects(
            updateGitMessage(snapshot, null, { type: 'fix', subject: 'New' }, file),
            /file has changed/,
        );
        assert.strictEqual(await fs.readFile(file, 'utf8'), '{broken');
        assert.deepStrictEqual(await fs.readdir(temporary), ['gitmessage.json']);
    });

    test('edits command in place, clears description and preserves unknown fields', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                future: { version: 2 },
                commands: [
                    { command: 'git status', description: 'old', extra: 123 },
                    { command: 'git diff', other: true },
                ],
            }),
        );
        await updateCommonCommand(
            await readCommonCommandSnapshot(file),
            0,
            { command: ' git log ', description: '' },
            file,
        );
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            future: { version: 2 },
            commands: [
                { command: 'git log', extra: 123 },
                { command: 'git diff', other: true },
            ],
        });
        const snapshot = await readCommonCommandSnapshot(file);
        await assert.rejects(updateCommonCommand(snapshot, 0, { command: 'git diff' }, file), /already exists/);
        await assert.rejects(updateCommonCommand(snapshot, 0, { command: '  ' }, file), /non-empty/);
        assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
        await deleteCommonCommand(snapshot, 0, file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')).commands, [
            { command: 'git diff', other: true },
        ]);
    });

    test('edits Git message in place and deletes only the selected duplicate', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        const message = { type: 'fix', scope: 'ui', subject: 'Old', extra: true };
        await fs.writeFile(file, JSON.stringify({ future: 7, messages: [message, message] }));
        await deleteGitMessage(await readGitMessageSnapshot(file), 1, file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), { future: 7, messages: [message] });
        await updateGitMessage(
            await readGitMessageSnapshot(file),
            0,
            { type: ' feat ', scope: '', subject: ' New ' },
            file,
        );
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            future: 7,
            messages: [{ type: 'feat', subject: 'New', extra: true }],
        });
        const snapshot = await readGitMessageSnapshot(file);
        await assert.rejects(updateGitMessage(snapshot, 0, { type: '', subject: 'New' }, file), /non-empty/);
        await assert.rejects(updateGitMessage(snapshot, 0, { type: 'fix', subject: '' }, file), /non-empty/);
        await assert.rejects(deleteGitMessage(snapshot, 1, file), /no longer exists/);
        assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
    });

    test('rejects stale edits and deletions after external changes or corruption', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(file, JSON.stringify({ messages: [{ type: 'fix', subject: 'Original' }] }));
        const snapshot = await readGitMessageSnapshot(file);
        for (const contents of ['{broken', JSON.stringify({ messages: [] }), snapshot.contents + '\n']) {
            await fs.writeFile(file, contents);
            await assert.rejects(
                updateGitMessage(snapshot, 0, { type: 'fix', subject: 'Changed' }, file),
                /file has changed/,
            );
            await assert.rejects(deleteGitMessage(snapshot, 0, file), /file has changed/);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
        }
    });

    test('serializes additions and edits and recovers after rejected writes', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'git status' }] }));
        const snapshot = await readCommonCommandSnapshot(file);
        const results = await Promise.allSettled([
            addCommonCommand('git diff', undefined, file),
            deleteCommonCommand(snapshot, 0, file),
        ]);
        assert.strictEqual(results[0]?.status, 'fulfilled');
        assert.strictEqual(results[1]?.status, 'rejected');
        await deleteCommonCommand(await readCommonCommandSnapshot(file), 0, file);
        assert.deepStrictEqual((await readCommonCommandSnapshot(file)).entries, [{ command: 'git diff' }]);
        assert.deepStrictEqual(await fs.readdir(temporary), ['commoncmd.json']);
    });
});

suite('Default configuration data safety', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-default-config-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    for (const [name, initialize, key] of [
        ['commoncmd.json', ensureCommonCommandsFile, 'commands'],
        ['gitmessage.json', ensureGitMessagesFile, 'messages'],
    ] as const) {
        test(`${name} preserves existing content, including empty or corrupt files`, async () => {
            const file = path.join(temporary, name);
            for (const contents of ['', '{invalid json', JSON.stringify({ [key]: [], future: true })]) {
                await fs.writeFile(file, contents);
                await initialize(file);
                assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
            }
        });

        test(`${name} supports repeated and concurrent initialization`, async () => {
            const file = path.join(temporary, name);
            await Promise.all([initialize(file), initialize(file)]);
            const contents = await fs.readFile(file, 'utf8');
            assert.ok(JSON.parse(contents)[key].length > 0);
            await initialize(file);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
        });
    }
});

suite('Extension', () => {
    test('registers contributed commands', async () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        await extension.activate();
        const commands = new Set(await vscode.commands.getCommands(true));
        for (const command of [
            'project-atlas.checkForUpdates',
            'aicode.selectGroup',
            'aicode.createGroup',
            'aicode.renameGroup',
            'aicode.duplicateGroup',
            'aicode.deleteGroup',
            'aicode.openConfig',
            'aicode.addToContext',
            'aicode.removeFromContext',
            'aicode.addMissingFiles',
            'aicode.copyMarkdown',
            'aicode.copyFileList',
            'aicode.copyRelativePath',
            'aicode.addToTerminal',
            'aicode.refresh',
            'aicode.expandAll',
            'aicode.collapseAll',
            'aicode.showEditorIndicator',
            'aicode.hideEditorIndicator',
            'aicode.compareBranches',
            'aicode.compareBranchesWithoutFetch',
            'aicode.refreshCompareResults',
            'aicode.clearCompareResults',
            'aicode.openCompareResult',
            'project-atlas.updatePackageVersion',
            'aicode.createOrUpdateChangelog',
            'project-atlas.add',
            'project-atlas.saveCurrent',
            'project-atlas.search',
            'project-atlas.filterByTag',
            'project-atlas.openCurrentWindow',
            'project-atlas.openNewWindow',
            'project-atlas.delete',
            'project-atlas.createReleaseTag',
            'project-atlas.openRepositoryHome',
            'project-atlas.openCurrentBranch',
            'project-atlas.openSelectedDirectory',
            'project-atlas.openSelectedFile',
            'project-atlas.copyRemoteUrl',
            'project-atlas.insertCommonCommand',
            'project-atlas.editCommonCommands',
            'project-atlas.collapseCommonCommands',
            'project-atlas.expandCommonCommands',
            'project-atlas.addTerminalSelectionToCommonCommand',
            'project-atlas.selectGitMessage',
            'project-atlas.editGitMessages',
            'project-atlas.collapseGitMessages',
            'project-atlas.expandGitMessages',
            'project-atlas.collapseAiPrompts',
            'project-atlas.expandAiPrompts',
            'project-atlas.deleteRepository',
            'project-atlas.repositoryViewTAGS',
            'project-atlas.repositoryViewGROUPS',
            'project-atlas.repositoryViewHOSTS',
            'project-atlas.editRepositoryTags',
            'project-atlas.cloneRepository',
            'project-atlas.copyGithubRepositorySshUrl',
            'project-atlas.addGithubRepositoryToRepos',
            'project-atlas.searchGithubRepositories',
            'project-atlas.expandGithubRepositories',
            'project-atlas.collapseGithubRepositories',
            'project-atlas.openSettings',
        ]) {
            assert.ok(commands.has(command), `Expected command to be registered: ${command}`);
        }
    });

    test('contributes only interactive commands to the Command Palette', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const manifest = extension.packageJSON as {
            contributes: {
                commands: Array<{ command: string; category?: string; enablement?: string }>;
                menus: { commandPalette: Array<{ command: string; when?: string }> };
            };
        };
        const hiddenCommands = new Set(
            manifest.contributes.menus.commandPalette
                .filter(({ when }) => when === 'false')
                .map(({ command }) => command),
        );
        const paletteCommands = manifest.contributes.commands.filter(({ command }) => !hiddenCommands.has(command));
        assert.deepStrictEqual(
            paletteCommands.map(({ command }) => command),
            [
                'project-atlas.checkForUpdates',
                'aicode.selectGroup',
                'aicode.createGroup',
                'aicode.openConfig',
                'aicode.copyMarkdown',
                'aicode.copyFileList',
                'aicode.compareBranches',
                'project-atlas.updatePackageVersion',
                'project-atlas.editGitMessages',
                'project-atlas.editCommonCommands',
                'project-atlas.insertCommonCommand',
                'project-atlas.createReleaseTag',
                'project-atlas.openRepositoryHome',
                'project-atlas.openCurrentBranch',
                'project-atlas.copyRemoteUrl',
                'project-atlas.search',
                'project-atlas.saveCurrent',
                'project-atlas.add',
                'project-atlas.saveCurrentRepository',
                'project-atlas.addAiPrompt',
                'project-atlas.refreshAiPrompts',
                'project-atlas.editAiPromptsFile',
                'project-atlas.searchAiPrompts',
                'project-atlas.aiPromptsListView',
                'project-atlas.aiPromptsGroupView',
                'project-atlas.backupTemplateData',
                'project-atlas.restoreTemplateData',
                'project-atlas.refreshTemplateBackup',
                'project-atlas.deleteTemplateBackup',
                'project-atlas.signInForTemplateBackup',
            ],
        );
        assert.strictEqual(paletteCommands[0]?.category, 'Project Atlas');
        assert.strictEqual(paletteCommands[1]?.category, 'AICode');
        assert.strictEqual(paletteCommands[2]?.category, 'AICode');
        assert.strictEqual(paletteCommands[3]?.category, 'AICode');
        for (const [command, enablement] of [
            [
                'project-atlas.backupTemplateData',
                'projectAtlas.templateBackupSignedIn && !projectAtlas.templateBackupBusy',
            ],
            [
                'project-atlas.restoreTemplateData',
                'projectAtlas.templateBackupSignedIn && projectAtlas.templateBackupAvailable && !projectAtlas.templateBackupBusy',
            ],
            [
                'project-atlas.refreshTemplateBackup',
                'projectAtlas.templateBackupSignedIn && !projectAtlas.templateBackupBusy',
            ],
            [
                'project-atlas.deleteTemplateBackup',
                'projectAtlas.templateBackupSignedIn && projectAtlas.templateBackupAvailable && !projectAtlas.templateBackupBusy',
            ],
        ] as const) {
            assert.strictEqual(
                manifest.contributes.commands.find((candidate) => candidate.command === command)?.enablement,
                enablement,
            );
        }
    });

    test('shows the package version command for a single workspace folder', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commandPalette = extension.packageJSON.contributes.menus.commandPalette as Array<{
            command: string;
            when?: string;
        }>;
        assert.deepStrictEqual(
            commandPalette.find(({ command }) => command === 'project-atlas.updatePackageVersion'),
            {
                command: 'project-atlas.updatePackageVersion',
                when: 'workspaceFolderCount == 1',
            },
        );
    });

    test('contributes a standard extension icon', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.strictEqual(extension.packageJSON.icon, 'resources/project-atlas.png');
    });

    test('contributes Project Atlas settings', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.deepStrictEqual(extension.packageJSON.contributes.configuration, {
            title: 'Project Atlas',
            properties: {
                'projectAtlas.update.enabled': {
                    type: 'boolean',
                    default: true,
                    description: 'Enable Project Atlas update checks.',
                    order: 1,
                },
                'projectAtlas.update.autoCheck': {
                    type: 'boolean',
                    default: true,
                    description: 'Check for Project Atlas updates after startup at most once every 24 hours.',
                    order: 2,
                },
                'projectAtlas.github.httpProxy': {
                    type: 'string',
                    default: 'http://127.0.0.1:1087',
                    description: 'HTTP or HTTPS proxy URL used when GitHub proxy is enabled.',
                    order: 3,
                },
                'projectAtlas.github.socketProxy': {
                    type: 'string',
                    default: 'socks5://127.0.0.1:1086',
                    description: 'SOCKS proxy URL used for socket-based requests and SSH clone connections.',
                    order: 4,
                },
                'projectAtlas.github.proxyEnabled': {
                    type: 'boolean',
                    default: false,
                    description: 'Use the configured proxy for GitHub repository refreshes and clone operations.',
                    order: 5,
                },
                'projectAtlas.github.token': {
                    type: 'string',
                    default: '',
                    description: 'GitHub personal access token used for repository refreshes and private clones.',
                    order: 6,
                },
                'projectAtlas.github.user': {
                    type: 'string',
                    default: '',
                    description: 'GitHub username that owns the configured personal access token.',
                    order: 7,
                },
            },
        });
    });

    test('associates configuration JSON schemas by file name', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.deepStrictEqual(extension.packageJSON.contributes.jsonValidation, [
            {
                fileMatch: '**/.project-atlas/project.json',
                url: './schemas/project.schema.json',
            },
            {
                fileMatch: '**/gitmessage.json',
                url: './schemas/gitmessage.schema.json',
            },
            {
                fileMatch: '**/commoncmd.json',
                url: './schemas/commoncmd.schema.json',
            },
            {
                fileMatch: '**/.aicode.json',
                url: './schemas/aicode.schema.json',
            },
            {
                fileMatch: '**/.project-atlas/repos.json',
                url: './schemas/repos.schema.json',
            },
            {
                fileMatch: '**/.project-atlas/github.json',
                url: './schemas/github.schema.json',
            },
            { fileMatch: '**/aiprompts.json', url: './schemas/aiprompts.schema.json' },
        ]);
    });

    test('groups AICode views separately from Projects', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const contributes = extension.packageJSON.contributes as {
            viewsContainers: { activitybar: Array<{ id: string; title: string; icon: string }> };
            views: Record<string, Array<{ id: string; name: string; icon?: string; when?: string }>>;
            viewsWelcome: Array<{ view: string; contents: string; when?: string }>;
        };
        assert.deepStrictEqual(contributes.viewsContainers.activitybar, [
            { id: 'projectAtlasTemplates', title: 'Project Atlas: Templates', icon: 'resources/templates.svg' },
            { id: 'aicode', title: 'Project Atlas: AICode', icon: 'resources/aicode-context.svg' },
            { id: 'projectAtlas', title: 'Project Atlas: Projects', icon: 'resources/project-atlas.svg' },
        ]);
        assert.deepStrictEqual(contributes.views.aicode, [
            { id: 'aicode.contextFiles', name: 'Context Files' },
            { id: 'aicode.compareResults', name: 'Compare Results' },
        ]);
        assert.deepStrictEqual(contributes.views.projectAtlasTemplates, [
            { id: 'projectAtlas.commonCommands', name: 'Common Commands' },
            { id: 'projectAtlas.gitMessages', name: 'Git Messages' },
            { id: 'projectAtlas.aiPrompts', name: 'AI Prompts' },
            { id: 'projectAtlas.templateBackup', name: 'Backup & Restore' },
        ]);
        assert.deepStrictEqual(contributes.views.projectAtlas, [
            { id: 'projectAtlas.projects', name: 'Projects', icon: 'resources/project-atlas.svg' },
            { id: 'projectAtlas.repos', name: 'Git Repositories' },
            { id: 'projectAtlas.githubRepos', name: 'GitHub Repositories' },
            { id: 'projectAtlas.npmPackages', name: 'npm packages', when: 'projectAtlas.npmPackagesAvailable' },
        ]);
        assert.deepStrictEqual(
            contributes.viewsWelcome.find(({ view }) => view === 'aicode.compareResults'),
            {
                view: 'aicode.compareResults',
                contents:
                    'No comparison results.\n[Compare Context Branches](command:aicode.compareBranches)\n[Compare Without Fetch](command:aicode.compareBranchesWithoutFetch)',
                when: '!aicode.compareResultsAvailable',
            },
        );
    });

    test('shows comparison actions only in Compare Results', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            submenu?: string;
            when?: string;
        }>;
        const entries = titleMenu.filter(({ command }) => command === 'aicode.compareBranches');
        assert.deepStrictEqual(entries, [
            {
                command: 'aicode.compareBranches',
                when: 'view == aicode.compareResults',
                group: 'navigation@2',
            },
        ]);
        assert.deepStrictEqual(
            titleMenu.find(({ command }) => command === 'aicode.refreshCompareResults'),
            {
                command: 'aicode.refreshCompareResults',
                when: 'view == aicode.compareResults && aicode.compareResultsAvailable',
                group: 'navigation@1',
            },
        );
    });

    test('shows Save Current Git Repository immediately after the Projects refresh action', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        const projectActions = titleMenu
            .filter(({ when, group }) => when === 'view == projectAtlas.projects' && group?.startsWith('navigation@'))
            .sort((left, right) => left.group!.localeCompare(right.group!, undefined, { numeric: true }));
        const refreshIndex = projectActions.findIndex(({ command }) => command === 'project-atlas.refresh');
        assert.strictEqual(projectActions[refreshIndex]?.group, 'navigation@7');
        assert.strictEqual(projectActions[refreshIndex + 1]?.command, 'project-atlas.saveCurrentRepository');
        assert.strictEqual(projectActions[refreshIndex + 1]?.group, 'navigation@8');
        assert.strictEqual(
            titleMenu.some(
                ({ command, when }) =>
                    command === 'project-atlas.saveCurrentRepository' && when === 'view == aicode.contextFiles',
            ),
            false,
        );
        const commands = extension.packageJSON.contributes.commands as Array<{ command: string; icon?: string }>;
        assert.strictEqual(
            commands.find(({ command }) => command === 'project-atlas.saveCurrentRepository')?.icon,
            '$(repo-push)',
        );
    });

    test('shows repository refresh and data file actions in Git Repositories', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            titleMenu.filter(({ when }) => when?.startsWith('view == projectAtlas.repos')),
            [
                {
                    command: 'project-atlas.collapseRepositories',
                    when: 'view == projectAtlas.repos && !projectAtlas.repositoriesCollapsed',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.expandRepositories',
                    when: 'view == projectAtlas.repos && projectAtlas.repositoriesCollapsed',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.refreshRepositories',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@4',
                },
                {
                    command: 'project-atlas.openRepositoryDataFile',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@2',
                },
                {
                    command: 'project-atlas.addRepository',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@1',
                },
                {
                    submenu: 'projectAtlas.repositoryViewMenu',
                    when: 'view == projectAtlas.repos',
                    group: 'view@1',
                },
            ],
        );
        const repositoryCommands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            icon?: string;
        }>;
        assert.strictEqual(
            repositoryCommands.find(({ command }) => command === 'project-atlas.collapseRepositories')?.icon,
            '$(collapse-all)',
        );
        assert.strictEqual(
            repositoryCommands.find(({ command }) => command === 'project-atlas.expandRepositories')?.icon,
            '$(expand-all)',
        );
        assert.deepStrictEqual(extension.packageJSON.contributes.menus['projectAtlas.repositoryViewMenu'], [
            {
                command: 'project-atlas.repositoryViewTAGS',
                toggled: 'projectAtlas.repositoryViewMode == TAGS',
                group: 'mode@1',
            },
            {
                command: 'project-atlas.repositoryViewGROUPS',
                toggled: 'projectAtlas.repositoryViewMode == GROUPS',
                group: 'mode@2',
            },
            {
                command: 'project-atlas.repositoryViewHOSTS',
                toggled: 'projectAtlas.repositoryViewMode == HOSTS',
                group: 'mode@3',
            },
        ]);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            enablement?: string;
        }>;
        assert.deepStrictEqual(
            commands
                .filter(({ command }) => command.startsWith('project-atlas.repositoryView'))
                .map(({ command, enablement }) => ({ command, enablement })),
            [
                {
                    command: 'project-atlas.repositoryViewTAGS',
                    enablement: 'projectAtlas.repositoryViewMode != TAGS',
                },
                {
                    command: 'project-atlas.repositoryViewGROUPS',
                    enablement: 'projectAtlas.repositoryViewMode != GROUPS',
                },
                {
                    command: 'project-atlas.repositoryViewHOSTS',
                    enablement: 'projectAtlas.repositoryViewMode != HOSTS',
                },
            ],
        );
    });

    test('shows template item actions in the right-click menu instead of inline buttons', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.editCommonCommand'),
            {
                command: 'project-atlas.editCommonCommand',
                when: 'view == projectAtlas.commonCommands && viewItem == commonCommand',
                group: 'edit@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.deleteCommonCommand'),
            {
                command: 'project-atlas.deleteCommonCommand',
                when: 'view == projectAtlas.commonCommands && viewItem == commonCommand',
                group: 'danger@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.editGitMessage'),
            {
                command: 'project-atlas.editGitMessage',
                when: 'view == projectAtlas.gitMessages && viewItem == gitMessage',
                group: 'edit@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.deleteGitMessage'),
            {
                command: 'project-atlas.deleteGitMessage',
                when: 'view == projectAtlas.gitMessages && viewItem == gitMessage',
                group: 'danger@1',
            },
        );
        assert.ok(
            !itemMenu.some(
                ({ command, group }) =>
                    command &&
                    [
                        'project-atlas.editCommonCommand',
                        'project-atlas.deleteCommonCommand',
                        'project-atlas.editGitMessage',
                        'project-atlas.deleteGitMessage',
                    ].includes(command) &&
                    group?.startsWith('inline@'),
            ),
        );
    });

    test('shows repository actions in the right-click menu instead of inline buttons', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.deleteRepository'),
            {
                command: 'project-atlas.deleteRepository',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'danger@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.editRepository'),
            {
                command: 'project-atlas.editRepository',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'edit@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.editRepositoryTags'),
            {
                command: 'project-atlas.editRepositoryTags',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'edit@2',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.cloneRepository'),
            {
                command: 'project-atlas.cloneRepository',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'inline@3',
            },
        );
        assert.ok(
            !itemMenu.some(
                ({ command, group }) =>
                    command &&
                    [
                        'project-atlas.deleteRepository',
                        'project-atlas.editRepository',
                        'project-atlas.editRepositoryTags',
                    ].includes(command) &&
                    group?.startsWith('inline@'),
            ),
        );
    });

    test('moves only the requested GitHub repository actions to the right-click menu', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            enablement?: string;
        }>;
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.refreshGithubRepositories'),
            {
                command: 'project-atlas.refreshGithubRepositories',
                title: 'Refresh GitHub Repositories',
                category: 'Project Atlas',
                icon: '$(refresh)',
                enablement: '!projectAtlas.githubRepositoriesRefreshing',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.openSettings'),
            {
                command: 'project-atlas.openSettings',
                title: 'Open Project Atlas Settings',
                category: 'Project Atlas',
                icon: '$(settings-gear)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.searchGithubRepositories'),
            {
                command: 'project-atlas.searchGithubRepositories',
                title: 'Search GitHub Repositories',
                category: 'Project Atlas',
                icon: '$(search)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.collapseGithubRepositories'),
            {
                command: 'project-atlas.collapseGithubRepositories',
                title: 'Collapse All',
                category: 'Project Atlas',
                icon: '$(collapse-all)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.expandGithubRepositories'),
            {
                command: 'project-atlas.expandGithubRepositories',
                title: 'Expand All',
                category: 'Project Atlas',
                icon: '$(expand-all)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.addGithubRepositoryToRepos'),
            {
                command: 'project-atlas.addGithubRepositoryToRepos',
                title: 'Add to Git Repositories',
                category: 'Project Atlas',
                icon: '$(add)',
                enablement: 'viewItem == githubRepositoryAddable',
            },
        );
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            titleMenu.filter(({ when }) => when?.startsWith('view == projectAtlas.githubRepos')),
            [
                {
                    command: 'project-atlas.searchGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@1',
                },
                {
                    command: 'project-atlas.openGithubConfig',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@2',
                },
                {
                    command: 'project-atlas.expandGithubRepositories',
                    when: 'view == projectAtlas.githubRepos && projectAtlas.githubRepositoriesCollapsed',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.collapseGithubRepositories',
                    when: 'view == projectAtlas.githubRepos && !projectAtlas.githubRepositoriesCollapsed',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.refreshGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@5',
                },
                {
                    command: 'project-atlas.openSettings',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@6',
                },
            ],
        );
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.cloneGithubRepository'),
            {
                command: 'project-atlas.cloneGithubRepository',
                when: 'view == projectAtlas.githubRepos && (viewItem == githubRepositoryAddable || viewItem == githubRepositorySaved)',
                group: 'inline@3',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.copyGithubRepositorySshUrl'),
            {
                command: 'project-atlas.copyGithubRepositorySshUrl',
                when: 'view == projectAtlas.githubRepos && (viewItem == githubRepositoryAddable || viewItem == githubRepositorySaved)',
                group: 'navigation@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.addGithubRepositoryToRepos'),
            {
                command: 'project-atlas.addGithubRepositoryToRepos',
                when: 'view == projectAtlas.githubRepos && (viewItem == githubRepositoryAddable || viewItem == githubRepositorySaved)',
                group: 'inline@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.openGithubRepository'),
            {
                command: 'project-atlas.openGithubRepository',
                when: 'view == projectAtlas.githubRepos && (viewItem == githubRepositoryAddable || viewItem == githubRepositorySaved)',
                group: 'navigation@2',
            },
        );
        assert.ok(
            itemMenu.some(
                ({ command, group }) =>
                    command === 'project-atlas.copyGithubRepositorySshUrl' && group === 'navigation@1',
            ),
        );
        assert.ok(
            itemMenu.some(
                ({ command, group }) => command === 'project-atlas.openGithubRepository' && group === 'navigation@2',
            ),
        );
        assert.ok(
            itemMenu.some(
                ({ command, group }) => command === 'project-atlas.addGithubRepositoryToRepos' && group === 'inline@1',
            ),
        );
        assert.ok(
            itemMenu.some(
                ({ command, group }) => command === 'project-atlas.cloneGithubRepository' && group === 'inline@3',
            ),
        );
    });

    test('uses clear icons for changelog preview actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            icon?: string;
            enablement?: string;
        }>;
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.confirmChangelogPreview')?.icon,
            '$(check)',
        );
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.cancelChangelogPreview')?.icon,
            '$(close)',
        );
    });

    test('keeps createGroup inline and moves the other AICode group actions to the right-click menu', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            icon?: string;
            enablement?: string;
        }>;
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command: string;
            when?: string;
            group?: string;
        }>;
        const groupWhen =
            'view == aicode.contextFiles && (viewItem == aicode.group || viewItem == aicode.group.default)';
        assert.strictEqual(commands.find((entry) => entry.command === 'aicode.createGroup')?.icon, '$(add)');
        assert.strictEqual(commands.find((entry) => entry.command === 'aicode.renameGroup')?.icon, '$(edit)');
        assert.strictEqual(commands.find((entry) => entry.command === 'aicode.duplicateGroup')?.icon, '$(files)');
        assert.strictEqual(commands.find((entry) => entry.command === 'aicode.deleteGroup')?.icon, '$(trash)');
        assert.deepStrictEqual(
            itemMenu.find((entry) => entry.command === 'aicode.createGroup'),
            {
                command: 'aicode.createGroup',
                when: groupWhen,
                group: 'inline@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find((entry) => entry.command === 'aicode.renameGroup'),
            {
                command: 'aicode.renameGroup',
                when: groupWhen,
                group: 'navigation@2',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find((entry) => entry.command === 'aicode.duplicateGroup'),
            {
                command: 'aicode.duplicateGroup',
                when: groupWhen,
                group: 'navigation@3',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find((entry) => entry.command === 'aicode.deleteGroup'),
            {
                command: 'aicode.deleteGroup',
                when: groupWhen,
                group: 'navigation@4',
            },
        );
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.renameGroup')?.enablement,
            'viewItem != aicode.group.default',
        );
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.deleteGroup')?.enablement,
            'viewItem != aicode.group.default',
        );
    });

    test('contributes mutually exclusive editor indicator submenu actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const contributes = extension.packageJSON.contributes as {
            commands: Array<{ command: string; enablement?: string }>;
            submenus: Array<{ id: string; label: string }>;
            menus: Record<string, Array<{ command?: string; submenu?: string; when?: string; toggled?: string }>>;
        };
        assert.deepStrictEqual(
            contributes.submenus.find(({ id }) => id === 'aicode.editorIndicator'),
            { id: 'aicode.editorIndicator', label: 'Editor Indicator' },
        );
        assert.deepStrictEqual(
            contributes.menus['view/title']!.find(({ submenu }) => submenu === 'aicode.editorIndicator'),
            {
                submenu: 'aicode.editorIndicator',
                when: 'view == aicode.contextFiles',
                group: 'aicode@8',
            },
        );
        assert.deepStrictEqual(contributes.menus['aicode.editorIndicator'], [
            { command: 'aicode.showEditorIndicator', toggled: 'aicode.editorIndicatorVisible' },
            { command: 'aicode.hideEditorIndicator', toggled: '!aicode.editorIndicatorVisible' },
        ]);
        assert.strictEqual(
            contributes.commands.find(({ command }) => command === 'aicode.showEditorIndicator')?.enablement,
            '!aicode.editorIndicatorVisible',
        );
        assert.strictEqual(
            contributes.commands.find(({ command }) => command === 'aicode.hideEditorIndicator')?.enablement,
            'aicode.editorIndicatorVisible',
        );
    });

    test('contributes mutually exclusive primary Explorer AICode actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const explorerActions = extension.packageJSON.contributes.menus['aicode.explorerActions'] as Array<{
            command: string;
            when?: string;
            group?: string;
        }>;

        assert.deepStrictEqual(
            explorerActions.filter(({ command }) =>
                ['aicode.addToContext', 'aicode.removeFromContext'].includes(command),
            ),
            [
                {
                    command: 'aicode.addToContext',
                    when: 'resource not in aicode.contextResources',
                    group: 'aicode@1',
                },
                {
                    command: 'aicode.removeFromContext',
                    when: 'resource in aicode.contextResources',
                    group: 'aicode@1',
                },
            ],
        );
    });

    test('disables Save Current Project when the current project is already saved', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const command = (
            extension.packageJSON.contributes.commands as Array<{
                command: string;
                enablement?: string;
            }>
        ).find(({ command }) => command === 'project-atlas.saveCurrent');
        assert.strictEqual(command?.enablement, '!projectAtlas.currentProjectSaved');
    });

    test('contributes Close Current Project only for the current project tree item', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{ command: string; title?: string }>;
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.closeCurrent'),
            {
                command: 'project-atlas.closeCurrent',
                title: 'Close Current Project',
                category: 'Project Atlas',
                icon: '$(close)',
            },
        );
        const menu = (
            extension.packageJSON.contributes.menus['view/item/context'] as Array<{
                command: string;
                when?: string;
            }>
        ).find(({ command }) => command === 'project-atlas.closeCurrent');
        assert.strictEqual(menu?.when, 'viewItem == currentProject');
        const commandPalette = extension.packageJSON.contributes.menus.commandPalette as Array<{
            command: string;
            when?: string;
        }>;
        assert.deepStrictEqual(
            commandPalette.find(({ command }) => command === 'project-atlas.closeCurrent'),
            {
                command: 'project-atlas.closeCurrent',
                when: 'false',
            },
        );
    });
});

suite('Repository HTML forms', () => {
    let temporary: string;
    let store: RepositoryStore;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-repository-form-'));
        store = new RepositoryStore(path.join(temporary, 'repos.json'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('cancels without writing and retries invalid or duplicate URLs before saving all fields', async () => {
        let refreshes = 0;
        const refreshed = (): void => {
            refreshes++;
        };
        await editRepositoryForm(store, undefined, refreshed, async ({ fields }) => {
            assert.ok(fields.every((field) => field.value === ''));
        });
        await assert.rejects(fs.access(store.file));
        await editRepositoryForm(store, undefined, refreshed, async ({ save }) => {
            await assert.rejects(save({ url: 'invalid', description: '', tags: '' }), /valid SSH/);
            await save({
                url: ' git@github.com:owner/repo.git ',
                description: ' Description ',
                tags: 'Work, work\r\n frontend, \n',
            });
        });
        assert.strictEqual(refreshes, 1);
        assert.deepStrictEqual(await store.repositories(), [
            {
                group: 'owner',
                name: 'repo',
                url: 'git@github.com:owner/repo.git',
                description: 'Description',
                tags: ['frontend', 'Work'],
            },
        ]);
        const original = await fs.readFile(store.file, 'utf8');
        await editRepositoryForm(store, undefined, refreshed, async ({ save }) => {
            await assert.rejects(
                save({ url: 'git@github.com:owner/repo.git', description: '', tags: '' }),
                /Another saved/,
            );
        });
        assert.strictEqual(await fs.readFile(store.file, 'utf8'), original);
        assert.strictEqual(refreshes, 1);
    });

    test('prefills edits, preserves unknown data and clears optional fields', async () => {
        const repository = {
            group: 'owner',
            name: 'repo',
            url: 'git@github.com:owner/repo.git',
            description: 'Old',
            tags: ['a,b', 'work'],
        };
        await fs.writeFile(store.file, JSON.stringify({ future: true, repos: [{ ...repository, extra: 42 }] }));
        const original = await fs.readFile(store.file, 'utf8');
        await editRepositoryForm(store, repository, undefined, async ({ fields }) => {
            assert.deepStrictEqual(
                fields.map((field) => field.value),
                [repository.url, 'Old', 'a\\,b\nwork'],
            );
        });
        assert.strictEqual(await fs.readFile(store.file, 'utf8'), original);
        await editRepositoryForm(store, repository, undefined, async ({ save }) => {
            await save({ url: 'git@github.com:owner/new.git', description: '', tags: '' });
        });
        assert.deepStrictEqual(JSON.parse(await fs.readFile(store.file, 'utf8')), {
            future: true,
            version: 1,
            repos: [{ group: 'owner', name: 'new', url: 'git@github.com:owner/new.git', tags: [], extra: 42 }],
        });
        await editRepositoryForm(store, repository, undefined, async ({ save }) => {
            await assert.rejects(save({ url: repository.url, description: '', tags: '' }), /was removed/);
        });
    });

    test('preserves comma and backslash tags when saving edits and accepts new separated tags', async () => {
        const repository = {
            group: 'owner',
            name: 'repo',
            url: 'git@github.com:owner/repo.git',
            tags: ['design,ux', 'team\\name', 'line\nbreak', 'work'],
        };
        await fs.writeFile(store.file, JSON.stringify({ repos: [{ ...repository, extra: 42 }] }));
        await editRepositoryForm(store, repository, undefined, async ({ fields, save }) => {
            const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
            await save({ ...values, description: 'Updated' });
        });
        const updated = (await store.repositories())[0]!;
        assert.deepStrictEqual(new Set(updated.tags), new Set(repository.tags));
        assert.strictEqual(updated.description, 'Updated');
        assert.strictEqual(JSON.parse(await fs.readFile(store.file, 'utf8')).repos[0].extra, 42);
        await editRepositoryForm(store, updated, undefined, async ({ fields, save }) => {
            const values = Object.fromEntries(fields.map((field) => [field.name, field.value]));
            await save({ ...values, tags: `${values.tags}, frontend\r\nbackend, design\\,ux` });
        });
        assert.deepStrictEqual(
            new Set((await store.repositories())[0]!.tags),
            new Set([...repository.tags, 'frontend', 'backend']),
        );
    });
});

suite('AI Prompts data safety', () => {
    let temporary: string;
    let file: string;
    const first = 'b762f475-5e32-460d-bac0-f35657db6d10';
    const second = '139b28d2-9e81-4a15-b513-f88cde93b243';
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-prompts-'));
        file = path.join(temporary, 'aiprompts.json');
    });
    teardown(async () => {
        await fs.rm(temporary, { recursive: true, force: true });
    });

    test('initializes six defaults once and preserves existing, empty and damaged files', async () => {
        await ensureAiPromptsFile(file);
        const snapshot = await readAiPromptSnapshot(file);
        assert.deepStrictEqual(
            snapshot.entries.map((entry) => entry.title),
            [
                'Code Review',
                'Troubleshoot an Issue',
                'Write Unit Tests',
                'Refactor Code',
                'Polish Writing',
                'Summarize Content',
            ],
        );
        assert.strictEqual(new Set(snapshot.entries.map((entry) => entry.id)).size, 6);
        assert.ok(snapshot.entries.every((entry) => entry.content.trim() && entry.description && entry.tags?.length));
        await ensureAiPromptsFile(file);
        assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
        for (const contents of ['{"schemaVersion":1,"prompts":[],"custom":true}', '', '{broken']) {
            await fs.writeFile(file, contents);
            await ensureAiPromptsFile(file);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
        }
        await assert.rejects(readAiPromptSnapshot(file), /invalid JSON/);
    });

    test('preserves whitespace, IDs and unknown fields across edit, duplicate, reorder and delete', async () => {
        const content = '\n    code\r\n\tline  \n';
        await fs.writeFile(
            file,
            JSON.stringify({
                schemaVersion: 1,
                future: { enabled: true },
                prompts: [
                    { id: first, title: 'Original', content, tags: ['开发'], favorite: true, custom: { value: 42 } },
                    { id: second, title: 'Other', content: 'Second', custom: 'keep' },
                ],
            }),
        );
        let snapshot = await readAiPromptSnapshot(file);
        await changeAiPrompt(
            snapshot,
            { type: 'save', id: first, value: { title: ' Renamed ', content, tags: [' 开发 ', '审查', '开发'] } },
            file,
        );
        snapshot = await readAiPromptSnapshot(file);
        assert.strictEqual(snapshot.entries[0]!.content, content);
        assert.strictEqual(snapshot.entries[0]!.id, first);
        assert.ok(!('favorite' in snapshot.entries[0]!));
        await changeAiPrompt(snapshot, { type: 'duplicate', id: first }, file);
        snapshot = await readAiPromptSnapshot(file);
        assert.strictEqual(snapshot.entries[1]!.title, 'Renamed Copy');
        assert.notStrictEqual(snapshot.entries[1]!.id, first);
        assert.strictEqual(snapshot.entries[1]!.content, content);
        await changeAiPrompt(snapshot, { type: 'reorder', order: [2, 1, 0] }, file);
        snapshot = await readAiPromptSnapshot(file);
        assert.strictEqual(snapshot.entries[0]!.id, second);
        await changeAiPrompt(snapshot, { type: 'delete', id: first }, file);
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.deepStrictEqual(data.future, { enabled: true });
        assert.strictEqual(data.prompts.length, 2);
        assert.strictEqual(data.prompts[0].custom, 'keep');
        assert.deepStrictEqual(data.prompts[1].custom, { value: 42 });
        assert.strictEqual(data.prompts[1].favorite, true);
        assert.deepStrictEqual(data.prompts[1].tags, ['开发', '审查']);
        assert.strictEqual(data.prompts[1].content, content);
    });

    test('rejects stale mutations, held locks and invalid orders without changing bytes', async () => {
        await ensureAiPromptsFile(file);
        const snapshot = await readAiPromptSnapshot(file);
        await changeAiPrompt(snapshot, { type: 'save', value: { title: 'New', content: ' text ' } }, file);
        const contents = await fs.readFile(file, 'utf8');
        await assert.rejects(
            changeAiPrompt(snapshot, { type: 'save', value: { title: 'Lost', content: 'no' } }, file),
            /file has changed/,
        );
        const latest = await readAiPromptSnapshot(file);
        await assert.rejects(changeAiPrompt(latest, { type: 'reorder', order: [1] }, file), /Invalid prompt order/);
        await fs.writeFile(`${file}.lock`, 'another writer');
        await assert.rejects(
            changeAiPrompt(latest, { type: 'delete', id: latest.entries[0]!.id }, file),
            /Another writer owns/,
        );
        assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
        assert.strictEqual(await fs.readFile(`${file}.lock`, 'utf8'), 'another writer');
    });

    test('rejects unsupported versions, duplicate IDs and invalid optional fields', () => {
        const prompt = { id: first, title: 'Title', content: 'Text' };
        assert.throws(() => parseAiPrompts({ schemaVersion: 2, prompts: [] }), /Unsupported/);
        assert.throws(
            () => parseAiPrompts({ schemaVersion: 1, prompts: [prompt, { ...prompt, id: first.toUpperCase() }] }),
            /duplicate id/,
        );
        for (const value of [{ content: '  ' }, { tags: '开发' }, { tags: [42] }, { id: 'bad' }]) {
            assert.throws(() => parseAiPrompts({ schemaVersion: 1, prompts: [{ ...prompt, ...value }] }));
        }
    });

    test('groups tags, ignores legacy favorites and searches full content', () => {
        const snapshot = {
            contents: '',
            entries: [
                { id: first, title: 'A', content: 'hidden search term' },
                { id: second, title: 'B', content: 'text', tags: ['开发', '审查'], favorite: true },
            ],
        };
        const grouped = buildPromptItems(snapshot, 'GROUP', file) as PromptTagGroup[];
        assert.deepStrictEqual(
            grouped.map((group) => group.tag),
            ['开发', '审查', ''],
        );
        assert.strictEqual(grouped[0]!.description, '1');
        assert.notStrictEqual(grouped[0]!.children[0]!.id, grouped[1]!.children[0]!.id);
        assert.strictEqual(grouped[0]!.children[0]!.snapshot.entries[grouped[0]!.children[0]!.index]!.id, second);
        assert.ok(matchesPrompt(snapshot.entries[1]!, '审查'));
        const items = buildPromptItems(snapshot, 'LIST', file);
        assert.deepStrictEqual(
            items.map((item) => item.id),
            [first, second],
        );
        assert.ok(items.every((item) => (item.iconPath as vscode.ThemeIcon).id === 'note'));
        assert.strictEqual(matchesPrompt(snapshot.entries[0]!, 'HIDDEN term'), true);
        assert.strictEqual(matchesPrompt(snapshot.entries[1]!, 'hidden'), false);
        const html = renderPromptPreview({
            id: first,
            title: '<script>bad</script>',
            content: '</pre><script>bad</script>',
        });
        assert.ok(!html.includes('<script>bad</script>'));
        assert.ok(html.includes('&lt;/pre&gt;'));
    });

    test('drag sorting persists order only when the active mode allows it', async () => {
        await fs.writeFile(
            file,
            JSON.stringify({
                schemaVersion: 1,
                prompts: [
                    { id: first, title: 'First', content: 'one' },
                    { id: second, title: 'Second', content: 'two' },
                ],
            }),
        );
        const snapshot = await readAiPromptSnapshot(file);
        const items = buildPromptItems(snapshot, 'LIST', file) as TemplateItem<unknown>[];
        let allowed = true;
        const controller = new TemplateDragAndDropController(
            'test.aiPrompts',
            file,
            () => {},
            () => allowed,
        );
        const transfer = new vscode.DataTransfer();
        controller.handleDrag([items[0]!], transfer, new vscode.CancellationTokenSource().token);
        allowed = false;
        await controller.handleDrop(undefined, transfer, new vscode.CancellationTokenSource().token);
        assert.deepStrictEqual(
            (await readAiPromptSnapshot(file)).entries.map((entry) => entry.id),
            [first, second],
        );
        allowed = true;
        await controller.handleDrop(undefined, transfer, new vscode.CancellationTokenSource().token);
        assert.deepStrictEqual(
            (await readAiPromptSnapshot(file)).entries.map((entry) => entry.id),
            [second, first],
        );
    });

    test('edits only prompt tags, supports cancel and clear, and rejects stale selections', async () => {
        const original = {
            schemaVersion: 1,
            extra: true,
            prompts: [
                {
                    id: first,
                    title: ' Title ',
                    content: '  body\r\n',
                    description: ' note ',
                    tags: ['开发'],
                    custom: 42,
                },
                { id: second, title: 'Other', content: 'text', tags: ['审查'] },
            ],
        };
        await fs.writeFile(file, JSON.stringify(original));
        let snapshot = await readAiPromptSnapshot(file);
        await editAiPromptTags(snapshot, first, file, async (existing, selected) => {
            assert.deepStrictEqual(existing, ['开发', '审查']);
            assert.deepStrictEqual(selected, ['开发']);
            return undefined;
        });
        assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
        await editAiPromptTags(snapshot, first, file, async () => ['审查', '新增']);
        const saved = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.deepStrictEqual(saved, {
            ...original,
            prompts: [{ ...original.prompts[0], tags: ['审查', '新增'] }, original.prompts[1]],
        });
        await assert.rejects(
            editAiPromptTags(snapshot, first, file, async () => ['stale']),
            /file has changed/,
        );
        snapshot = await readAiPromptSnapshot(file);
        await editAiPromptTags(snapshot, first, file, async () => []);
        assert.deepStrictEqual((await readAiPromptSnapshot(file)).entries[0]!.tags, []);
    });

    test('form preserves unchanged CRLF content and accepts multiple tags', async () => {
        const content = '  first\r\nsecond\r\n';
        await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, prompts: [] }));
        await changeAiPrompt(
            await readAiPromptSnapshot(file),
            { type: 'save', value: { title: 'Test', content } },
            file,
        );
        const snapshot = await readAiPromptSnapshot(file);
        await editAiPrompt(snapshot, snapshot.entries[0]!.id, [], file, async (options) => {
            const input = Object.fromEntries(options.fields.map((field) => [field.name, field.value]));
            input.content = content.replace(/\r\n/g, '\n');
            input.tags = '开发,审查\n开发\r\n开发\nC:\\tools';
            await options.save(validateFormValues(options.fields, input));
        });
        const result = (await readAiPromptSnapshot(file)).entries[0]!;
        assert.strictEqual(result.content, content);
        assert.deepStrictEqual(result.tags, ['开发,审查', '开发', 'C:\\tools']);
    });
});
