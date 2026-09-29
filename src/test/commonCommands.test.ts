import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    addCommonCommand,
    ensureCommonCommandsFile,
    readCommonCommands,
    readCommonCommandsDocument,
    readCommonCommandSnapshot,
    updateCommonCommand,
} from '../features/commonCommands/commonCommandStore';
import { runCommonCommand } from '../features/commonCommands/commonCommandCommands';
import { quoteForShell, resolveCommonCommand } from '../features/commonCommands/commonCommandVariables';

suite('Common Commands', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-common-commands-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('reads and validates commands', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                commands: [{ command: ' git status ', description: ' Show ', tags: [' Git ', 'Git', ''] }],
            }),
        );
        assert.deepStrictEqual(await readCommonCommands(file), [
            { command: 'git status', description: 'Show', tags: ['Git'] },
        ]);
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: '' }] }));
        await assert.rejects(() => readCommonCommands(file), /non-empty command/);
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'git status', tags: 'Git' }] }));
        await assert.rejects(() => readCommonCommands(file), /invalid tags/);
    });

    test('reads global and command variables while retaining the existing command format', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(
            file,
            JSON.stringify({
                variables: [{ name: 'project_name', type: 'text', required: true }],
                commands: [
                    {
                        command: 'npx create ${project_name} ${kind}',
                        variables: [{ name: 'kind', type: 'select', options: ['classic', 'blog'] }],
                    },
                ],
            }),
        );
        assert.deepStrictEqual(await readCommonCommandsDocument(file), {
            variables: [{ name: 'project_name', type: 'text', required: true }],
            commands: [
                {
                    command: 'npx create ${project_name} ${kind}',
                    variables: [{ name: 'kind', type: 'select', options: ['classic', 'blog'] }],
                },
            ],
        });

        await fs.writeFile(file, JSON.stringify({ commands: [], variables: [{ name: 'bad-name', type: 'text' }] }));
        await assert.rejects(() => readCommonCommands(file), /valid name/);

        await fs.writeFile(
            file,
            JSON.stringify({
                commands: [],
                variables: [{ name: 'kind', type: 'select', options: ['classic'], default: 'blog' }],
            }),
        );
        await assert.rejects(() => readCommonCommands(file), /default that is not an option/);
    });

    test('quotes variable values for supported shells', () => {
        assert.strictEqual(quoteForShell("my site's docs", '/bin/zsh'), "'my site'\\''s docs'");
        assert.strictEqual(quoteForShell("my site's docs", 'pwsh'), "'my site''s docs'");
        assert.throws(() => quoteForShell('first\nsecond', '/bin/zsh'), /line breaks/);
    });

    test('leaves undeclared shell variables unchanged', async () => {
        assert.strictEqual(await resolveCommonCommand({ command: 'echo ${HOME}' }, [], '/bin/zsh'), 'echo ${HOME}');
    });

    test('selects and runs a command when invoked without a tree item', async () => {
        let pickerCalls = 0;
        let executed: string | undefined;
        await runCommonCommand(
            undefined,
            async () => {
                pickerCalls += 1;
                return 'git status';
            },
            async (command) => {
                executed = command;
            },
        );

        assert.strictEqual(pickerCalls, 1);
        assert.strictEqual(executed, 'git status');
    });

    test('initializes a missing commands file', async () => {
        const file = path.join(temporary, 'nested', 'commoncmd.json');
        await ensureCommonCommandsFile(file);
        assert.deepStrictEqual(await readCommonCommands(file), [
            { command: 'git status', description: 'Show working tree status' },
            { command: 'git diff', description: 'Show unstaged changes' },
            { command: 'git log --oneline -10', description: 'Show the latest 10 commits' },
        ]);
    });

    test('atomically adds a command and preserves unknown fields', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ future: true, commands: [{ command: 'git status' }] }));
        await addCommonCommand(' git pull ', ' Update ', file);
        const written = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(written.future, true);
        assert.deepStrictEqual(written.commands[1], { command: 'git pull', description: 'Update' });
        await assert.rejects(() => addCommonCommand('git pull', undefined, file), /already exists/);
    });

    test('serializes concurrent additions', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ commands: [] }));
        await Promise.all([
            addCommonCommand('git status', undefined, file),
            addCommonCommand('git pull', undefined, file),
            addCommonCommand('git push', undefined, file),
        ]);
        assert.deepStrictEqual(
            (await readCommonCommands(file)).map(({ command }) => command),
            ['git status', 'git pull', 'git push'],
        );
    });

    test('saves normalized tags while preserving unknown command fields', async () => {
        const file = path.join(temporary, 'commoncmd.json');
        await fs.writeFile(file, JSON.stringify({ commands: [{ command: 'git status', future: true }] }));
        const snapshot = await readCommonCommandSnapshot(file);
        await updateCommonCommand(snapshot, 0, { command: 'git status', tags: [' Git ', 'Git', 'Review'] }, file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')).commands[0], {
            command: 'git status',
            future: true,
            tags: ['Git', 'Review'],
        });
    });
});
