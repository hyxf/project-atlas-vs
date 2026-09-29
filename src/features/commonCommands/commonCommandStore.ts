import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { changeTemplate, queueTemplateWrite, readTemplateSnapshot, TemplateSnapshot } from '../templates/templateStore';

export interface CommonCommand {
    command: string;
    description?: string;
    tags?: string[];
    variables?: CommonCommandVariable[];
}

export type CommonCommandVariableType = 'text' | 'select' | 'multiSelect' | 'path';

export interface CommonCommandVariable {
    name: string;
    label?: string;
    type: CommonCommandVariableType;
    required?: boolean;
    default?: string | string[];
    options?: string[];
    pathKind?: 'file' | 'folder' | 'any';
}

export interface CommonCommandsDocument {
    variables?: CommonCommandVariable[];
    commands: CommonCommand[];
}

export const commonCommandsFile = path.join(os.homedir(), '.project-atlas', 'commoncmd.json');

export function readCommonCommandSnapshot(file = commonCommandsFile): Promise<TemplateSnapshot<CommonCommand>> {
    return readTemplateSnapshot(file, parseCommonCommands);
}

export function updateCommonCommand(
    snapshot: TemplateSnapshot<CommonCommand>,
    index: number | null,
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
        const tags = normalizeCommonCommandTags(value.tags ?? []);
        if (tags.length) {
            entry.tags = tags;
        } else {
            delete entry.tags;
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
    return (await readCommonCommandsDocument(file)).commands;
}

export async function readCommonCommandsDocument(file = commonCommandsFile): Promise<CommonCommandsDocument> {
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
        const data = JSON.parse(contents);
        return { commands: parseCommonCommands(data), variables: readCommonCommandVariables(data) };
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
    tags: readonly string[] = [],
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
        const normalizedTags = normalizeCommonCommandTags(tags);
        document.commands.push({
            command: normalizedCommand,
            ...(normalizedDescription ? { description: normalizedDescription } : {}),
            ...(normalizedTags.length ? { tags: normalizedTags } : {}),
        });
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            if ((await fs.readFile(file, 'utf8')) !== contents) {
                throw new Error('The file has changed. Refresh the view and try again.');
            }
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
    readCommonCommandVariables(data);
    return (data as { commands: unknown[] }).commands.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`Common command ${index + 1} must be an object.`);
        }
        const { command, description, tags, variables } = entry as {
            command?: unknown;
            description?: unknown;
            tags?: unknown;
            variables?: unknown;
        };
        if (typeof command !== 'string' || !command.trim()) {
            throw new Error(`Common command ${index + 1} must have a non-empty command.`);
        }
        if (description !== undefined && typeof description !== 'string') {
            throw new Error(`Common command ${index + 1} has an invalid description.`);
        }
        if (tags !== undefined && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string'))) {
            throw new Error(`Common command ${index + 1} has invalid tags.`);
        }
        const normalizedDescription = description?.trim();
        return {
            command: command.trim(),
            ...(normalizedDescription ? { description: normalizedDescription } : {}),
            ...(tags ? { tags: normalizeCommonCommandTags(tags as string[]) } : {}),
            ...(variables ? { variables: parseCommonCommandVariables(variables, `Common command ${index + 1}`) } : {}),
        };
    });
}

export function parseCommonCommandVariables(data: unknown, owner = 'Variables'): CommonCommandVariable[] {
    if (!Array.isArray(data)) {
        throw new Error(`${owner} must be an array.`);
    }
    const names = new Set<string>();
    return data.map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`${owner} variable ${index + 1} must be an object.`);
        }
        const {
            name,
            label,
            type,
            required,
            default: defaultValue,
            options,
            pathKind,
        } = entry as Record<string, unknown>;
        if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
            throw new Error(`${owner} variable ${index + 1} must have a valid name.`);
        }
        if (names.has(name)) {
            throw new Error(`${owner} contains duplicate variable ${name}.`);
        }
        names.add(name);
        if (label !== undefined && typeof label !== 'string') {
            throw new Error(`${owner} variable ${name} has an invalid label.`);
        }
        if (type !== 'text' && type !== 'select' && type !== 'multiSelect' && type !== 'path') {
            throw new Error(`${owner} variable ${name} has an invalid type.`);
        }
        if (required !== undefined && typeof required !== 'boolean') {
            throw new Error(`${owner} variable ${name} has an invalid required value.`);
        }
        if (
            options !== undefined &&
            (!Array.isArray(options) || options.some((option) => typeof option !== 'string'))
        ) {
            throw new Error(`${owner} variable ${name} has invalid options.`);
        }
        if ((type === 'select' || type === 'multiSelect') && (!options || !options.length)) {
            throw new Error(`${owner} variable ${name} requires options.`);
        }
        if (pathKind !== undefined && pathKind !== 'file' && pathKind !== 'folder' && pathKind !== 'any') {
            throw new Error(`${owner} variable ${name} has an invalid pathKind.`);
        }
        if (type !== 'path' && pathKind !== undefined) {
            throw new Error(`${owner} variable ${name} can only use pathKind with path type.`);
        }
        if (type === 'multiSelect') {
            if (
                defaultValue !== undefined &&
                (!Array.isArray(defaultValue) || defaultValue.some((value) => typeof value !== 'string'))
            ) {
                throw new Error(`${owner} variable ${name} has an invalid default.`);
            }
        } else if (defaultValue !== undefined && typeof defaultValue !== 'string') {
            throw new Error(`${owner} variable ${name} has an invalid default.`);
        }
        if (
            type === 'select' &&
            typeof defaultValue === 'string' &&
            defaultValue !== '' &&
            !options?.includes(defaultValue)
        ) {
            throw new Error(`${owner} variable ${name} has a default that is not an option.`);
        }
        if (
            type === 'multiSelect' &&
            Array.isArray(defaultValue) &&
            defaultValue.some((value) => !options?.includes(value))
        ) {
            throw new Error(`${owner} variable ${name} has a default that is not an option.`);
        }
        return {
            name,
            ...(label?.trim() ? { label: label.trim() } : {}),
            type,
            ...(required !== undefined ? { required } : {}),
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
            ...(options ? { options: [...new Set(options as string[])] } : {}),
            ...(pathKind ? { pathKind } : {}),
        };
    });
}

export function readCommonCommandVariables(data: unknown): CommonCommandVariable[] {
    if (!data || typeof data !== 'object') {
        throw new Error('Common commands file must contain a commands array.');
    }
    const variables = (data as CommonCommandsDocument).variables;
    return variables === undefined ? [] : parseCommonCommandVariables(variables, 'Global variables');
}

export function normalizeCommonCommandTags(tags: readonly string[]): string[] {
    return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}
