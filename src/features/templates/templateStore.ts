import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

export interface TemplateSnapshot<T> {
    contents: string;
    entries: T[];
}

const queues = new Map<string, Promise<void>>();

export async function queueTemplateWrite(file: string, action: () => Promise<void>): Promise<void> {
    file = path.resolve(file);
    const write = (queues.get(file) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
            // All extension processes must acquire this lock before reading data for a write.
            // Never expire a lock by age: a paused writer may still own it.
            const lockPath = `${file}.lock`;
            const lock = await fs.open(lockPath, 'wx', 0o600).catch((error: NodeJS.ErrnoException) => {
                if (error.code === 'EEXIST') {
                    throw new Error(
                        `Another writer owns ${lockPath}. Retry after it finishes. If a writer crashed, remove the lock only after confirming it has stopped.`,
                    );
                }
                throw error;
            });
            try {
                await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
                await action();
            } finally {
                try {
                    await lock.close();
                } finally {
                    await fs.unlink(lockPath);
                }
            }
        });
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
    await mutateTemplate(file, snapshot, (document) => {
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
    });
}

/** Reorders raw records so unknown fields and normalized display values remain untouched. */
export async function reorderTemplates<T>(
    file: string,
    key: string,
    snapshot: TemplateSnapshot<T>,
    order: readonly number[],
): Promise<void> {
    await mutateTemplate(file, snapshot, (document) => {
        const records = document[key];
        if (
            !Array.isArray(records) ||
            records.length !== snapshot.entries.length ||
            order.length !== records.length ||
            new Set(order).size !== records.length ||
            order.some((index) => !Number.isInteger(index) || index < 0 || index >= records.length)
        ) {
            throw new Error('Invalid template order. Refresh the view and try again.');
        }
        document[key] = order.map((index) => records[index]);
    });
}

async function mutateTemplate<T>(
    file: string,
    snapshot: TemplateSnapshot<T>,
    mutate: (document: Record<string, unknown>) => void,
): Promise<void> {
    await queueTemplateWrite(file, async () => {
        const contents = await fs.readFile(file, 'utf8');
        if (contents !== snapshot.contents) {
            throw new Error('The file has changed. Refresh the view and try again.');
        }
        const document = JSON.parse(contents) as Record<string, unknown>;
        mutate(document);
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
