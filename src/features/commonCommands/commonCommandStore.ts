import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { changeTemplate, queueTemplateWrite, readTemplateSnapshot, TemplateSnapshot } from '../templates/templateStore';

export interface CommonCommand {
    command: string;
    description?: string;
}

export const commonCommandsFile = path.join(os.homedir(), '.project-atlas', 'commoncmd.json');

export function readCommonCommandSnapshot(file = commonCommandsFile): Promise<TemplateSnapshot<CommonCommand>> {
    return readTemplateSnapshot(file, parseCommonCommands);
}

export function updateCommonCommand(
    snapshot: TemplateSnapshot<CommonCommand>,
    index: number,
    value: CommonCommand,
    file = commonCommandsFile,
): Promise<void> {
    return changeTemplate(file, 'commands', snapshot, index, parseCommonCommands, (entry, entries) => {
        const command = value.command.trim();
        if (entries.some((item, position) => position !== index && item.command === command)) {
            throw new Error('The selected command already exists in commoncmd.json.');
        }
        entry.command = command;
        if (value.description?.trim()) {
            entry.description = value.description.trim();
        } else {
            delete entry.description;
        }
    });
}

export function deleteCommonCommand(
    snapshot: TemplateSnapshot<CommonCommand>,
    index: number,
    file = commonCommandsFile,
): Promise<void> {
    return changeTemplate(file, 'commands', snapshot, index, parseCommonCommands);
}

export async function ensureCommonCommandsFile(file = commonCommandsFile): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const commands: CommonCommand[] = [
        { command: 'git status', description: 'Show working tree status' },
        { command: 'git diff', description: 'Show unstaged changes' },
        { command: 'git log --oneline -10', description: 'Show the latest 10 commits' },
    ];
    await fs
        .writeFile(file, `${JSON.stringify({ commands }, null, 2)}\n`, { flag: 'wx' })
        .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        });
}

export async function readCommonCommands(file = commonCommandsFile): Promise<CommonCommand[]> {
    let contents: string;
    try {
        contents = await fs.readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(`Common commands file does not exist: ${file}`);
        }
        throw new Error(`Could not read common commands file: ${file}`);
    }

    try {
        return parseCommonCommands(JSON.parse(contents));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`Common commands file contains invalid JSON: ${file}`);
        }
        throw error;
    }
}

export async function addCommonCommand(
    command: string,
    description?: string,
    file = commonCommandsFile,
): Promise<void> {
    const normalizedCommand = command.trim();
    if (!normalizedCommand) {
        throw new Error('Select terminal text before adding a common command.');
    }
    const normalizedDescription = description?.trim();
    await queueTemplateWrite(file, async () => {
        const contents = await fs.readFile(file, 'utf8');
        let data: unknown;
        try {
            data = JSON.parse(contents);
        } catch {
            throw new Error(`Common commands file contains invalid JSON: ${file}`);
        }
        const commands = parseCommonCommands(data);
        if (commands.some((item) => item.command === normalizedCommand)) {
            throw new Error('The selected command already exists in commoncmd.json.');
        }

        const document = data as { commands: unknown[] } & Record<string, unknown>;
        document.commands.push({
            command: normalizedCommand,
            ...(normalizedDescription ? { description: normalizedDescription } : {}),
        });
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            await fs.rename(temporary, file);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    });
}

function parseCommonCommands(data: unknown): CommonCommand[] {
    if (!data || typeof data !== 'object' || !Array.isArray((data as { commands?: unknown }).commands)) {
        throw new Error('Common commands file must contain a commands array.');
    }
    return (data as { commands: unknown[] }).commands.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`Common command ${index + 1} must be an object.`);
        }
        const { command, description } = entry as { command?: unknown; description?: unknown };
        if (typeof command !== 'string' || !command.trim()) {
            throw new Error(`Common command ${index + 1} must have a non-empty command.`);
        }
        if (description !== undefined && typeof description !== 'string') {
            throw new Error(`Common command ${index + 1} has an invalid description.`);
        }
        const normalizedDescription = description?.trim();
        return {
            command: command.trim(),
            ...(normalizedDescription ? { description: normalizedDescription } : {}),
        };
    });
}
