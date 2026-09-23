import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runInNewContext } from 'vm';
import { TemplateItem } from '../features/templates/templatesFeature';
import { CommonCommand, readCommonCommandSnapshot } from '../features/commonCommands/commonCommandStore';
import { GitMessage, readGitMessageSnapshot } from '../features/gitMessages/gitMessageStore';
import {
    addCommonCommandItem,
    editCommonCommandTags,
    addGitMessageItem,
    editCommonCommandItem,
    editGitMessageItem,
} from '../features/templates/templateCommands';
import { renderTemplateForm, validateFormValues } from '../features/templates/templateForm';
import {
    loadCommonCommandItems,
    loadGitMessageItems,
    TemplatesTreeProvider,
} from '../features/templates/templatesFeature';
import {
    TemplateBackupService,
    TemplateBackupStorage,
    templateBackupKey,
} from '../features/templateBackup/templateBackupFeature';

class TestBackupStorage implements TemplateBackupStorage {
    value: unknown;
    syncedKeys: readonly string[] = [];

    get<T>(section: string): T | undefined {
        return section === templateBackupKey ? (this.value as T | undefined) : undefined;
    }

    update(section: string, value: unknown): Thenable<void> {
        if (section === templateBackupKey) {
            this.value = value;
        }
        return Promise.resolve();
    }

    setKeysForSync(keys: readonly string[]): void {
        this.syncedKeys = keys;
    }
}

suite('Template views', () => {
    test('keeps Close and Escape available during saving and restores controls after an error', () => {
        const html = renderTemplateForm({
            title: 'Add Project',
            fields: [{ name: 'name', label: 'Name', value: 'Atlas' }],
            save: async () => {},
        });
        const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)![1]!;
        const listeners = new Map<string, (event: Record<string, unknown>) => void>();
        const messages: unknown[] = [];
        const control = (id: string) => ({
            id,
            disabled: false,
            textContent: '',
            hidden: true,
            focus: () => {},
            addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
                listeners.set(`${id}:${type}`, handler),
        });
        const name = control('name');
        const save = control('save');
        const cancel = control('cancel');
        const error = control('error');
        const form = {
            ...control('editor'),
            elements: [name, save, cancel],
            querySelector: () => name,
            querySelectorAll: () => [],
        };
        const elements = { editor: form, save, cancel, error };
        runInNewContext(script, {
            acquireVsCodeApi: () => ({ postMessage: (message: unknown) => messages.push(message) }),
            document: {
                getElementById: (id: keyof typeof elements) => elements[id],
                addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
                    listeners.set(type, handler),
            },
            window: {
                addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
                    listeners.set(type, handler),
            },
            FormData: class {
                *[Symbol.iterator]() {
                    yield ['name', 'Atlas'];
                }
            },
        });
        const event = { preventDefault: () => {} };
        listeners.get('editor:submit')!(event);
        assert.strictEqual(save.disabled, true);
        assert.strictEqual(name.disabled, true);
        assert.strictEqual(cancel.disabled, false);
        assert.strictEqual(cancel.textContent, 'Close');
        listeners.get('editor:submit')!(event);
        assert.strictEqual(messages.length, 1);
        listeners.get('cancel:click')!(event);
        listeners.get('keydown')!({ ...event, key: 'Escape' });
        assert.strictEqual(JSON.stringify(messages.slice(1)), '[{"type":"cancel"},{"type":"cancel"}]');
        listeners.get('message')!({ data: { type: 'error', message: 'Save failed' } });
        assert.strictEqual(save.disabled, false);
        assert.strictEqual(name.disabled, false);
        assert.strictEqual(cancel.textContent, 'Cancel');
        assert.strictEqual(error.hidden, false);
        assert.strictEqual(error.textContent, 'Save failed');
    });

    test('validates checked and unchecked checkbox values', () => {
        const fields = [{ name: 'favorite', label: 'Favorites', value: 'true', checkbox: true }];
        for (const favorite of ['true', 'false']) {
            assert.deepStrictEqual(validateFormValues(fields, { favorite }), { favorite });
        }
        assert.throws(() => validateFormValues(fields, { favorite: 'Yes' }), /Invalid Favorites/);
        assert.throws(() => validateFormValues(fields, {}), /Invalid Favorites/);
        const html = renderTemplateForm({ title: 'Add Project', fields, save: async () => {} });
        assert.match(html, /type="checkbox"[^>]* checked/);
        const unchecked = renderTemplateForm({
            title: 'Add Project',
            fields: [{ ...fields[0]!, value: 'false' }],
            save: async () => {},
        });
        assert.doesNotMatch(unchecked, /type="checkbox"[^>]* checked/);
    });

    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-templates-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('backs up and restores all template files through one synced global state key', async () => {
        const files = [
            { name: 'aiprompts.json' as const, file: path.join(temporary, 'aiprompts.json') },
            { name: 'commoncmd.json' as const, file: path.join(temporary, 'commoncmd.json') },
            { name: 'gitmessage.json' as const, file: path.join(temporary, 'gitmessage.json') },
        ];
        const originals = ['{\n  "prompts": []\n}\n', '{"commands":[]}\n', '{"messages":[]}\n'];
        await Promise.all(files.map(({ file }, index) => fs.writeFile(file, originals[index]!)));
        const storage = new TestBackupStorage();
        const service = new TemplateBackupService(storage, files, async () => {});

        service.enableSync();
        const backup = await service.backup();
        assert.deepStrictEqual(storage.syncedKeys, [templateBackupKey]);
        assert.strictEqual(backup.documents['aiprompts.json'].contents, originals[0]);
        assert.strictEqual(backup.documents['commoncmd.json'].contents, originals[1]);
        assert.strictEqual(backup.documents['gitmessage.json'].contents, originals[2]);

        await Promise.all(files.map(({ file }) => fs.writeFile(file, '{"changed":true}\n')));
        await service.restore();
        assert.deepStrictEqual(await Promise.all(files.map(({ file }) => fs.readFile(file, 'utf8'))), originals);
        await service.deleteBackup();
        assert.strictEqual(service.getBackup(), undefined);
    });

    test('adding uses blank edit forms and only persists on Save', async () => {
        const commandFile = path.join(temporary, 'commoncmd.json');
        const messageFile = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(commandFile, JSON.stringify({ commands: [] }));
        await fs.writeFile(messageFile, JSON.stringify({ messages: [] }));
        for (const [file, add] of [
            [commandFile, addCommonCommandItem],
            [messageFile, addGitMessageItem],
        ] as const) {
            const original = await fs.readFile(file, 'utf8');
            await add(file, async ({ fields }) => {
                assert.ok(fields.every(({ value }) => value === ''));
            });
            assert.strictEqual(await fs.readFile(file, 'utf8'), original);
        }
        await addCommonCommandItem(commandFile, async ({ fields, save }) => {
            assert.deepStrictEqual(
                fields.map(({ name }) => name),
                ['command', 'description', 'tags'],
            );
            await save({ command: 'git status', description: '', tags: 'Git\nReview' });
        });
        await addGitMessageItem(messageFile, async ({ fields, save }) => {
            assert.deepStrictEqual(
                fields.map(({ name }) => name),
                ['type', 'scope', 'subject'],
            );
            await save({ type: 'feat', scope: 'ui', subject: 'Add form' });
        });
        assert.deepStrictEqual((await readCommonCommandSnapshot(commandFile)).entries, [
            { command: 'git status', tags: ['Git', 'Review'] },
        ]);
        assert.deepStrictEqual((await readGitMessageSnapshot(messageFile)).entries, [
            { type: 'feat', scope: 'ui', subject: 'Add form' },
        ]);
    });

    test('closing the form without saving leaves the file unchanged', async () => {
        const commandFile = path.join(temporary, 'commoncmd.json');
        const messageFile = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(commandFile, JSON.stringify({ commands: [{ command: 'git status' }] }));
        await fs.writeFile(messageFile, JSON.stringify({ messages: [{ type: 'fix', subject: 'Original' }] }));
        const commands = await readCommonCommandSnapshot(commandFile);
        const messages = await readGitMessageSnapshot(messageFile);
        await editCommonCommandItem(
            new TemplateItem<CommonCommand>('git status', commands, 0, commandFile, 'commonCommand'),
            async ({ fields }) => {
                assert.deepStrictEqual(
                    fields.map(({ value }) => value),
                    ['git status', '', ''],
                );
            },
        );
        assert.strictEqual(await fs.readFile(commandFile, 'utf8'), commands.contents);
        await editGitMessageItem(
            new TemplateItem<GitMessage>('fix: Original', messages, 0, messageFile, 'gitMessage'),
            async ({ fields }) => {
                assert.deepStrictEqual(
                    fields.map(({ value }) => value),
                    ['fix', '', 'Original'],
                );
            },
        );
        assert.strictEqual(await fs.readFile(messageFile, 'utf8'), messages.contents);
    });

    test('saves all command form fields together and permits retry after validation failure', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                commands: [{ command: 'git status', description: 'Old', extra: true }, { command: 'git diff' }],
            }),
        );
        const snapshot = await readCommonCommandSnapshot(file);
        await editCommonCommandItem(
            new TemplateItem('git status', snapshot, 0, file, 'commonCommand'),
            async ({ save }) => {
                await assert.rejects(save({ command: 'git diff', description: 'New', tags: '' }), /already exists/);
                assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
                await save({ command: 'git log\ngit status', description: '', tags: 'Git\nReview' });
            },
        );
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')).commands[0], {
            command: 'git log\ngit status',
            extra: true,
            tags: ['Git', 'Review'],
        });
    });

    test('edits command tags with the shared tag picker', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                commands: [
                    { command: 'git status', tags: ['Git'] },
                    { command: 'git diff', tags: ['Review'] },
                ],
            }),
        );
        const snapshot = await readCommonCommandSnapshot(file);
        await editCommonCommandTags(
            new TemplateItem('git status', snapshot, 0, file, 'commonCommand'),
            async (existing, selected, title) => {
                assert.deepStrictEqual(existing, ['Git', 'Review']);
                assert.deepStrictEqual(selected, ['Git']);
                assert.strictEqual(title, 'Edit Tags: git status');
                return ['Git', 'Review'];
            },
        );
        assert.deepStrictEqual((await readCommonCommandSnapshot(file)).entries[0], {
            command: 'git status',
            tags: ['Git', 'Review'],
        });
    });

    test('saves Git form fields together and rejects a file changed while the form is open', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(file, JSON.stringify({ messages: [{ type: 'fix', scope: 'old', subject: 'Old' }] }));
        const snapshot = await readGitMessageSnapshot(file);
        const item = new TemplateItem('fix(old): Old', snapshot, 0, file, 'gitMessage');
        await editGitMessageItem(item, async ({ save }) => {
            await save({ type: 'feat', scope: '', subject: 'New' });
        });
        const saved = await fs.readFile(file, 'utf8');
        assert.deepStrictEqual(JSON.parse(saved).messages, [{ type: 'feat', subject: 'New' }]);
        await editGitMessageItem(item, async ({ save }) => {
            await assert.rejects(save({ type: 'fix', scope: 'ui', subject: 'Stale' }), /file has changed/);
        });
        assert.strictEqual(await fs.readFile(file, 'utf8'), saved);
    });

    test('escapes stored text in form HTML and validates webview messages', () => {
        const fields = [
            {
                name: 'command',
                label: 'Command',
                value: '</textarea><script>alert(1)</script>',
                required: true,
                multiline: true,
            },
        ];
        const html = renderTemplateForm({ title: '<Edit>', fields, save: async () => {} });
        assert.ok(!html.includes(fields[0]!.value));
        assert.ok(html.includes('&lt;/textarea&gt;&lt;script&gt;'));
        assert.ok(html.includes("default-src 'none'"));
        assert.throws(() => validateFormValues(fields, { command: '  ' }), /required/);
        assert.throws(() => validateFormValues(fields, { command: 42 }), /Invalid Command/);
        assert.deepStrictEqual(validateFormValues(fields, { command: 'git status', unexpected: 'ignored' }), {
            command: 'git status',
        });
    });

    test('displays commands grouped by tags and Git messages grouped by type in file order', async () => {
        const commandsFile = path.join(temporary, 'commoncmd.json');
        const messagesFile = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(
            commandsFile,
            JSON.stringify({
                commands: [
                    { command: 'git status', description: 'Working tree', tags: ['Git', 'Review'] },
                    { command: 'git diff' },
                ],
            }),
        );
        await fs.writeFile(
            messagesFile,
            JSON.stringify({
                messages: [
                    { type: 'fix', scope: 'ui', subject: 'Refresh tree' },
                    { type: 'docs', subject: 'Update README' },
                    { type: 'fix', subject: 'Fix another bug' },
                    { type: 'custom', subject: 'Custom message' },
                ],
            }),
        );
        const commands = await loadCommonCommandItems(commandsFile);
        assert.deepStrictEqual(
            commands.map((item) => item.label),
            ['Git', 'Review', 'Untagged'],
        );
        const provider = new TemplatesTreeProvider(() => loadCommonCommandItems(commandsFile));
        try {
            const gitCommands = await provider.getChildren(commands[0]);
            assert.deepStrictEqual(
                gitCommands.map((item) => item.label),
                ['git status'],
            );
            assert.strictEqual(gitCommands[0]?.description, '· Working tree');
            assert.deepStrictEqual(await provider.getChildren(gitCommands[0]), []);
            assert.deepStrictEqual(
                (await provider.getChildren(commands[1])).map((item) => item.label),
                ['git status'],
            );
            assert.deepStrictEqual(
                (await provider.getChildren(commands[2])).map((item) => item.label),
                ['git diff'],
            );
        } finally {
            provider.dispose();
        }
        const messagesProvider = new TemplatesTreeProvider(() => loadGitMessageItems(messagesFile));
        try {
            const groups = await messagesProvider.getChildren();
            assert.deepStrictEqual(
                groups.map((item) => item.label),
                ['fix', 'docs', 'custom'],
            );
            assert.deepStrictEqual(
                groups.map((item) => item.description),
                [undefined, undefined, undefined],
            );
            assert.ok(groups.every((item) => item.contextValue === 'gitMessageType'));
            assert.strictEqual(new Set(groups.map((item) => item.id)).size, 3);
            const fixes = await messagesProvider.getChildren(groups[0]);
            assert.deepStrictEqual(
                fixes.map((item) => item.label),
                ['fix(ui): Refresh tree', 'fix: Fix another bug'],
            );
            assert.ok(fixes.every((item) => item.contextValue === 'gitMessage'));
            const second = fixes[1] as TemplateItem<GitMessage>;
            assert.strictEqual(second.index, 2);
            assert.deepStrictEqual(await messagesProvider.getChildren(second), []);
            await editGitMessageItem(second, async ({ save }) => {
                await save({ type: 'docs', scope: '', subject: 'Moved message' });
            });
            const updated = await messagesProvider.getChildren();
            assert.deepStrictEqual(
                updated.map((item) => item.id),
                groups.map((item) => item.id),
            );
            assert.deepStrictEqual(
                (await messagesProvider.getChildren(updated[1])).map((item) => item.label),
                ['docs: Update README', 'docs: Moved message'],
            );
            assert.strictEqual((await readGitMessageSnapshot(messagesFile)).entries[1]?.subject, 'Update README');
        } finally {
            messagesProvider.dispose();
        }
    });

    test('reports missing and invalid files without modifying them and recovers on refresh', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        const provider = new TemplatesTreeProvider(() => loadCommonCommandItems(file));
        let refreshes = 0;
        const listener = provider.onDidChangeTreeData(() => refreshes++);
        try {
            assert.match(String((await provider.getChildren())[0]?.description), /does not exist/);
            await assert.rejects(fs.access(file));
            await fs.writeFile(file, '{broken');
            assert.match(String((await provider.getChildren())[0]?.description), /invalid JSON/);
            assert.strictEqual(await fs.readFile(file, 'utf8'), '{broken');
            await fs.writeFile(file, JSON.stringify({ commands: [] }));
            provider.refresh();
            assert.strictEqual(refreshes, 1);
            assert.deepStrictEqual(await provider.getChildren(), []);
            await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'git status' }] }));
            provider.refresh();
            const groups = await provider.getChildren();
            assert.strictEqual(groups[0]?.label, 'Untagged');
            assert.strictEqual((await provider.getChildren(groups[0]))[0]?.label, 'git status');
        } finally {
            listener.dispose();
            provider.dispose();
        }
    });
});
