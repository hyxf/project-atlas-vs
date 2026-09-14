import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';

export interface TemplateSnapshot<T> {
    contents: string;
    entries: T[];
}

const queues = new Map<string, Promise<void>>();

export async function queueTemplateWrite(file: string, action: () => Promise<void>): Promise<void> {
    const write = (queues.get(file) ?? Promise.resolve()).catch(() => undefined).then(action);
    queues.set(file, write);
    try {
        await write;
    } finally {
        if (queues.get(file) === write) {
            queues.delete(file);
        }
    }
}

export async function readTemplateSnapshot<T>(
    file: string,
    parse: (data: unknown) => T[],
): Promise<TemplateSnapshot<T>> {
    const contents = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
            throw new Error(`Template file does not exist: ${file}`);
        }
        throw error;
    });
    let data: unknown;
    try {
        data = JSON.parse(contents);
    } catch {
        throw new Error(`Template file contains invalid JSON: ${file}`);
    }
    return { contents, entries: parse(data) };
}

export async function changeTemplate<T>(
    file: string,
    key: string,
    snapshot: TemplateSnapshot<T>,
    index: number | null,
    parse: (data: unknown) => T[],
    update?: (entry: Record<string, unknown>, entries: T[]) => void,
): Promise<void> {
    await queueTemplateWrite(file, async () => {
        const contents = await fs.readFile(file, 'utf8');
        if (contents !== snapshot.contents) {
            throw new Error('The file has changed. Refresh the view and try again.');
        }
        const document = JSON.parse(contents) as Record<string, unknown>;
        const entries = parse(document);
        if (index !== null && (!Number.isInteger(index) || index < 0 || index >= entries.length)) {
            throw new Error('The selected record no longer exists. Refresh the view and try again.');
        }
        const records = document[key] as Record<string, unknown>[];
        if (index === null) {
            if (!update) {
                throw new Error('New records require values.');
            }
            const entry: Record<string, unknown> = {};
            update(entry, entries);
            records.push(entry);
        } else if (update) {
            update(records[index]!, entries);
        } else {
            records.splice(index, 1);
        }
        parse(document);
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx' });
            if ((await fs.readFile(file, 'utf8')) !== contents) {
                throw new Error('The file has changed. Refresh the view and try again.');
            }
            await fs.rename(temporary, file);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    });
}
