import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    addCommonCommand,
    ensureCommonCommandsFile,
    readCommonCommands,
    readCommonCommandSnapshot,
    updateCommonCommand,
} from '../features/commonCommands/commonCommandStore';

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
