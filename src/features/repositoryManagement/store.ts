import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RepositoryItem, RepositorySettings } from './model';
import { repositoryIdentityKey } from './repositoryUrl';

interface StoredRepositoryData extends Record<string, unknown> {
    version?: unknown;
    repos?: unknown;
    settings?: unknown;
}

export class RepositoryStore {
    readonly file: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(file = path.join(os.homedir(), '.project-atlas', 'repos.json')) {
        this.file = file;
    }

    async repositories(): Promise<RepositoryItem[]> {
        const source = await this.read();
        return Array.isArray(source.repos)
            ? source.repos.map(parseRepository).filter((repo): repo is RepositoryItem => repo !== undefined)
            : [];
    }

    async viewMode(): Promise<RepositorySettings['viewMode']> {
        const source = await this.read();
        const settings = isRecord(source.settings) ? source.settings : {};
        return settings.viewMode === 'GROUPS' || settings.viewMode === 'HOSTS' ? settings.viewMode : 'TAGS';
    }

    async replaceViewMode(viewMode: RepositorySettings['viewMode']): Promise<void> {
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const settings = isRecord(source.settings) ? source.settings : {};
            await this.save({ ...source, version: 1, settings: { ...settings, viewMode } });
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    async ensureFile(): Promise<string> {
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            if (!(await exists(this.file))) {
                await this.save({ ...source, version: 1, repos: [] });
            }
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return this.file;
    }

    async addIfMissing(repository: RepositoryItem): Promise<'added' | 'existing'> {
        let result: 'added' | 'existing' = 'added';
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const repos = Array.isArray(source.repos) ? [...source.repos] : [];
            const repositoryKey = repositoryIdentityKey(repository.url);
            const index = repos.findIndex((value) => {
                const existing = parseRepository(value);
                return (
                    existing?.url === repository.url ||
                    (repositoryKey !== undefined && repositoryIdentityKey(existing?.url ?? '') === repositoryKey)
                );
            });
            if (index >= 0) {
                result = 'existing';
                return;
            }
            repos.push({ ...repository, tags: [...repository.tags] });
            await this.save({ ...source, version: 1, repos });
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return result;
    }

    async remove(url: string): Promise<boolean> {
        let removed = false;
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const repos = Array.isArray(source.repos) ? source.repos : [];
            const remaining = repos.filter((value) => parseRepository(value)?.url !== url);
            removed = remaining.length !== repos.length;
            if (removed) {
                await this.save({ ...source, version: 1, repos: remaining });
            }
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return removed;
    }

    async updateTags(url: string, tags: readonly string[]): Promise<boolean> {
        let updated = false;
        const snapshot = [...tags];
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const repos = Array.isArray(source.repos) ? [...source.repos] : [];
            const index = repos.findIndex((value) => parseRepository(value)?.url === url);
            if (index < 0 || !isRecord(repos[index])) {
                return;
            }
            repos[index] = { ...repos[index], tags: snapshot };
            await this.save({ ...source, version: 1, repos });
            updated = true;
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return updated;
    }

    async updateRepository(url: string, repository: RepositoryItem): Promise<'updated' | 'missing' | 'existing'> {
        let result: 'updated' | 'missing' | 'existing' = 'missing';
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const repos = Array.isArray(source.repos) ? [...source.repos] : [];
            const index = repos.findIndex((value) => parseRepository(value)?.url === url);
            if (index < 0 || !isRecord(repos[index])) {
                return;
            }
            const key = repositoryIdentityKey(repository.url);
            const duplicate = repos.some((value, candidate) => {
                if (candidate === index) {
                    return false;
                }
                const existing = parseRepository(value);
                return (
                    existing?.url === repository.url ||
                    (key !== undefined && repositoryIdentityKey(existing?.url ?? '') === key)
                );
            });
            if (duplicate) {
                result = 'existing';
                return;
            }
            const next = { ...repos[index], ...repository, tags: [...repository.tags] };
            if (!('description' in repository)) {
                delete next.description;
            }
            repos[index] = next;
            await this.save({ ...source, version: 1, repos });
            result = 'updated';
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return result;
    }

    private async read(): Promise<StoredRepositoryData> {
        try {
            const text = await fs.readFile(this.file, 'utf8');
            const source = JSON.parse(text) as unknown;
            if (!isRecord(source)) {
                throw new Error('the root value must be an object');
            }
            return source;
        } catch (error) {
            if (isNotFound(error)) {
                return { version: 1, repos: [] };
            }
            throw new Error(`Could not read ${this.file}; fix the JSON before making changes.`, { cause: error });
        }
    }

    private async save(data: StoredRepositoryData): Promise<void> {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
            await fs.rename(temporary, this.file);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    }
}

function parseRepository(value: unknown): RepositoryItem | undefined {
    if (
        !isRecord(value) ||
        typeof value.group !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.url !== 'string' ||
        !Array.isArray(value.tags)
    ) {
        return undefined;
    }
    const repository: RepositoryItem = {
        group: value.group,
        name: value.name,
        url: value.url,
        tags: value.tags.filter((tag): tag is string => typeof tag === 'string'),
    };
    return typeof value.description === 'string' ? { ...repository, description: value.description } : repository;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
    return isRecord(error) && error.code === 'ENOENT';
}

async function exists(file: string): Promise<boolean> {
    return fs.stat(file).then(
        () => true,
        () => false,
    );
}
