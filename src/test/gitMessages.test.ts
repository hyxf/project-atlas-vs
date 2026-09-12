import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatGitMessage, readGitMessages } from '../features/gitMessages/gitMessageStore';

suite('Git Messages', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-git-messages-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

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
