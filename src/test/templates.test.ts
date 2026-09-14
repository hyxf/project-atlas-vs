import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemplateItem } from '../features/templates/templatesFeature';
import { CommonCommand, readCommonCommandSnapshot } from '../features/commonCommands/commonCommandStore';
import { GitMessage, readGitMessageSnapshot } from '../features/gitMessages/gitMessageStore';
import {
    addCommonCommandItem,
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

suite('Template views', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-templates-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

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
                ['command', 'description'],
            );
            await save({ command: 'git status', description: '' });
        });
        await addGitMessageItem(messageFile, async ({ fields, save }) => {
            assert.deepStrictEqual(
                fields.map(({ name }) => name),
                ['type', 'scope', 'subject'],
            );
            await save({ type: 'feat', scope: 'ui', subject: 'Add form' });
        });
        assert.deepStrictEqual((await readCommonCommandSnapshot(commandFile)).entries, [{ command: 'git status' }]);
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
                    ['git status', ''],
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
                await assert.rejects(save({ command: 'git diff', description: 'New' }), /already exists/);
                assert.strictEqual(await fs.readFile(file, 'utf8'), snapshot.contents);
                await save({ command: 'git log\ngit status', description: '' });
            },
        );
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')).commands[0], {
            command: 'git log\ngit status',
            extra: true,
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

    test('displays commands with descriptions and scoped Git messages in file order', async () => {
        const commandsFile = path.join(temporary, 'commoncmd.json');
        const messagesFile = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(
            commandsFile,
            JSON.stringify({
                commands: [{ command: 'git status', description: 'Working tree' }, { command: 'git diff' }],
            }),
        );
        await fs.writeFile(
            messagesFile,
            JSON.stringify({
                messages: [
                    { type: 'fix', scope: 'ui', subject: 'Refresh tree' },
                    { type: 'docs', subject: 'Update README' },
                ],
            }),
        );
        const commands = await loadCommonCommandItems(commandsFile);
        assert.deepStrictEqual(
            commands.map((item) => item.label),
            ['git status', 'git diff'],
        );
        assert.strictEqual(commands[0]?.description, 'Working tree');
        assert.deepStrictEqual(
            (await loadGitMessageItems(messagesFile)).map((item) => item.label),
            ['fix(ui): Refresh tree', 'docs: Update README'],
        );
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
            assert.strictEqual((await provider.getChildren())[0]?.label, 'git status');
        } finally {
            listener.dispose();
            provider.dispose();
        }
    });
});
