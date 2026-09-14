import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { changeTemplate, readTemplateSnapshot, TemplateSnapshot } from '../templates/templateStore';

export interface GitMessage {
    type: string;
    scope?: string;
    subject: string;
}

export const gitMessagesFile = path.join(os.homedir(), '.project-atlas', 'gitmessage.json');

export function readGitMessageSnapshot(file = gitMessagesFile): Promise<TemplateSnapshot<GitMessage>> {
    return readTemplateSnapshot(file, parseGitMessages);
}

export function updateGitMessage(
    snapshot: TemplateSnapshot<GitMessage>,
    index: number,
    value: GitMessage,
    file = gitMessagesFile,
): Promise<void> {
    return changeTemplate(file, 'messages', snapshot, index, parseGitMessages, (entry) => {
        entry.type = value.type.trim();
        entry.subject = value.subject.trim();
        if (value.scope?.trim()) {
            entry.scope = value.scope.trim();
        } else {
            delete entry.scope;
        }
    });
}

export function deleteGitMessage(
    snapshot: TemplateSnapshot<GitMessage>,
    index: number,
    file = gitMessagesFile,
): Promise<void> {
    return changeTemplate(file, 'messages', snapshot, index, parseGitMessages);
}

export async function ensureGitMessagesFile(file = gitMessagesFile): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const messages: GitMessage[] = [
        { type: 'feat', subject: 'Add new feature' },
        { type: 'fix', subject: 'Fix bug' },
        { type: 'docs', subject: 'Update documentation' },
        { type: 'refactor', subject: 'Refactor code' },
        { type: 'test', subject: 'Add tests' },
        { type: 'chore', subject: 'Update dependencies' },
    ];
    await fs
        .writeFile(file, `${JSON.stringify({ messages }, null, 2)}\n`, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        });
}

export async function readGitMessages(file = gitMessagesFile): Promise<GitMessage[]> {
    let contents: string;
    try {
        contents = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`Git messages file does not exist: ${file}`);
        }
        throw new Error(`Could not read Git messages file: ${file}`);
    }
    let data: unknown;
    try {
        data = JSON.parse(contents);
    } catch {
        throw new Error(`Git messages file contains invalid JSON: ${file}`);
    }
    return parseGitMessages(data);
}

function parseGitMessages(data: unknown): GitMessage[] {
    if (!data || typeof data !== 'object' || !Array.isArray((data as { messages?: unknown }).messages)) {
        throw new Error('Git messages file must contain a messages array.');
    }
    return (data as { messages: unknown[] }).messages.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`Git message ${index + 1} must be an object.`);
        }
        const { type, scope, subject } = entry as { type?: unknown; scope?: unknown; subject?: unknown };
        if (typeof type !== 'string' || !type.trim() || typeof subject !== 'string' || !subject.trim()) {
            throw new Error(`Git message ${index + 1} must have a non-empty type and subject.`);
        }
        if (scope !== undefined && typeof scope !== 'string') {
            throw new Error(`Git message ${index + 1} has an invalid scope.`);
        }
        const normalizedScope = scope?.trim();
        return {
            type: type.trim(),
            subject: subject.trim(),
            ...(normalizedScope ? { scope: normalizedScope } : {}),
        };
    });
}

export function formatGitMessage(message: GitMessage): string {
    return `${message.type}${message.scope ? `(${message.scope})` : ''}: ${message.subject}`;
}
