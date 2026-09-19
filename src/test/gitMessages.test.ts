import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureGitMessagesFile, formatGitMessage, readGitMessages } from '../features/gitMessages/gitMessageStore';

suite('Git Messages', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-git-messages-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('initializes a missing messages file with default templates', async () => {
        const file = path.join(temporary, 'nested', 'gitmessage.json');
        await ensureGitMessagesFile(file);
        assert.deepStrictEqual((await readGitMessages(file)).map(formatGitMessage), [
            'feat: Add new feature',
            'fix: Fix bug',
            'docs: Update documentation',
            'refactor: Refactor code',
            'test: Add tests',
            'chore: Update dependencies',
        ]);
    });

    test('reads and formats templates', async () => {
        const file = path.join(temporary, 'gitmessage.json');
        await fs.writeFile(
            file,
            JSON.stringify({ messages: [{ type: ' docs ', scope: ' readme ', subject: ' Update docs ' }] }),
        );
        const messages = await readGitMessages(file);
        assert.deepStrictEqual(messages, [{ type: 'docs', scope: 'readme', subject: 'Update docs' }]);
        assert.strictEqual(formatGitMessage(messages[0]!), 'docs(readme): Update docs');
    });
});
