import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitHubRepository } from './types';

interface StoredStars extends Record<string, unknown> {
    repositories?: unknown;
}

export class GitHubStarsStore {
    readonly file: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(file = path.join(os.homedir(), '.project-atlas', 'github-stars.json')) {
        this.file = file;
    }

    async repositories(): Promise<GitHubRepository[]> {
        const source = await this.read(true);
        return Array.isArray(source.repositories)
            ? source.repositories
                  .map(parseRepository)
                  .filter((repository): repository is GitHubRepository => repository !== undefined)
            : [];
    }

    async replaceRepositories(repositories: readonly GitHubRepository[]): Promise<void> {
        const snapshot = repositories.map((repository) => ({ ...repository }));
        const write = this.writeQueue.then(async () => {
            const source = await this.read(true);
            const existing = new Map<number, Record<string, unknown>>();
            if (Array.isArray(source.repositories)) {
                for (const value of source.repositories) {
                    if (isRecord(value) && typeof value.id === 'number') {
                        existing.set(value.id, value);
                    }
                }
            }
            const stored = snapshot.map((repository) => serializeRepository(repository, existing.get(repository.id)));
            await this.save({ ...source, repositories: stored });
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    async removeRepository(repositoryId: number): Promise<void> {
        const write = this.writeQueue.then(async () => {
            const source = await this.read(true);
            if (!Array.isArray(source.repositories)) {
                return;
            }
            const repositories = source.repositories.filter(
                (repository) => !isRecord(repository) || repository.id !== repositoryId,
            );
            if (repositories.length !== source.repositories.length) {
                await this.save({ ...source, repositories });
            }
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    private async read(missingAsEmpty: boolean): Promise<StoredStars> {
        try {
            const source = JSON.parse(await fs.readFile(this.file, 'utf8')) as unknown;
            if (!isRecord(source)) {
                throw new Error('the root value must be an object');
            }
            return source;
        } catch (error) {
            if (missingAsEmpty && isNotFound(error)) {
                return { repositories: [] };
            }
            throw new Error(`Could not read ${this.file}; fix the JSON before refreshing GitHub Stars.`, {
                cause: error,
            });
        }
    }

    private async save(source: StoredStars): Promise<void> {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(source, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
            await fs.rename(temporary, this.file);
        } finally {
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    }
}

function parseRepository(value: unknown): GitHubRepository | undefined {
    if (
        !isRecord(value) ||
        typeof value.id !== 'number' ||
        typeof value.name !== 'string' ||
        typeof value.fullName !== 'string' ||
        typeof value.owner !== 'string' ||
        typeof value.htmlUrl !== 'string' ||
        typeof value.sshUrl !== 'string' ||
        typeof value.cloneUrl !== 'string' ||
        typeof value.private !== 'boolean' ||
        typeof value.archived !== 'boolean' ||
        typeof value.fork !== 'boolean' ||
        typeof value.updatedAt !== 'string'
    ) {
        return undefined;
    }
    return {
        id: value.id,
        name: value.name,
        fullName: value.fullName,
        owner: value.owner,
        htmlUrl: value.htmlUrl,
        sshUrl: value.sshUrl,
        cloneUrl: value.cloneUrl,
        private: value.private,
        archived: value.archived,
        fork: value.fork,
        updatedAt: value.updatedAt,
        ...(typeof value.description === 'string' ? { description: value.description } : {}),
        ...(typeof value.language === 'string' ? { language: value.language } : {}),
    };
}

function serializeRepository(
    repository: GitHubRepository,
    existing: Record<string, unknown> = {},
): Record<string, unknown> {
    const stored: Record<string, unknown> = {
        ...existing,
        id: repository.id,
        name: repository.name,
        fullName: repository.fullName,
        owner: repository.owner,
        htmlUrl: repository.htmlUrl,
        sshUrl: repository.sshUrl,
        cloneUrl: repository.cloneUrl,
        private: repository.private,
        archived: repository.archived,
        fork: repository.fork,
        updatedAt: repository.updatedAt,
    };
    delete stored.description;
    delete stored.language;
    if (repository.description !== undefined) {
        stored.description = repository.description;
    }
    if (repository.language !== undefined) {
        stored.language = repository.language;
    }
    return stored;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
    return isRecord(error) && error.code === 'ENOENT';
}
