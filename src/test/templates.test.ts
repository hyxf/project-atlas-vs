import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
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
