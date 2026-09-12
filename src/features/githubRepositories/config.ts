import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitHubConfiguration, GitHubProxyConfiguration, GitHubRepository } from './model';

export const defaultProxy = 'http://127.0.0.1:1087';
export const defaultSocketProxy = 'socks5://127.0.0.1:1086';

interface StoredGitHubData extends Record<string, unknown> {
    token?: unknown;
    user?: unknown;
    proxyEnabled?: unknown;
    httpProxy?: unknown;
    proxy?: unknown;
    socketProxy?: unknown;
    repositories?: unknown;
}

export class GitHubConfigurationStore {
    readonly file: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(file = path.join(os.homedir(), '.project-atlas', 'github.json')) {
        this.file = file;
    }

    async configuration(): Promise<GitHubConfiguration> {
        const source = await this.read();
        if (typeof source.token !== 'string' || !source.token.trim()) {
            throw new Error(`Set a non-empty "token" in ${this.file}.`);
        }
        if (typeof source.user !== 'string' || !source.user.trim()) {
            throw new Error(`Set a non-empty "user" in ${this.file}.`);
        }
        return {
            token: source.token.trim(),
            user: source.user.trim(),
            proxy: parseProxyConfiguration(source, this.file),
        };
    }

    async proxyConfiguration(): Promise<GitHubProxyConfiguration> {
        const source = await this.read(true);
        return parseProxyConfiguration(source, this.file);
    }

    async credentials(): Promise<{ token?: string; user?: string }> {
        const source = await this.read(true);
        return {
            ...(typeof source.token === 'string' ? { token: source.token } : {}),
            ...(typeof source.user === 'string' ? { user: source.user } : {}),
        };
    }

    async replaceSettings(settings: {
        token?: string;
        user?: string;
        proxyEnabled?: boolean;
        httpProxy?: string;
        socketProxy?: string;
    }): Promise<void> {
        const write = this.writeQueue.then(async () => {
            const source = await this.read(true);
            const next = {
                ...source,
                token: typeof source.token === 'string' ? source.token : '',
                user: typeof source.user === 'string' ? source.user : '',
                repositories: Array.isArray(source.repositories) ? source.repositories : [],
                ...(settings.token === undefined ? {} : { token: settings.token }),
                ...(settings.user === undefined ? {} : { user: settings.user }),
                ...(settings.proxyEnabled === undefined ? {} : { proxyEnabled: settings.proxyEnabled }),
                ...(settings.httpProxy === undefined ? {} : { httpProxy: settings.httpProxy }),
                ...(settings.socketProxy === undefined ? {} : { socketProxy: settings.socketProxy }),
            };
            if (settings.httpProxy !== undefined) {
                delete next.proxy;
            }
            await this.save(next);
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    async replaceProxyConfiguration(proxy: { enabled?: boolean; url?: string; socketUrl?: string }): Promise<void> {
        await this.replaceSettings({
            ...(proxy.enabled === undefined ? {} : { proxyEnabled: proxy.enabled }),
            ...(proxy.url === undefined ? {} : { httpProxy: proxy.url }),
            ...(proxy.socketUrl === undefined ? {} : { socketProxy: proxy.socketUrl }),
        });
    }

    async repositories(): Promise<GitHubRepository[]> {
        const source = await this.read(true);
        return Array.isArray(source.repositories)
            ? source.repositories
                  .map(parseStoredRepository)
                  .filter((repository): repository is GitHubRepository => repository !== undefined)
            : [];
    }

    async replaceRepositories(repositories: readonly GitHubRepository[]): Promise<void> {
        const snapshot = repositories.map((repository) => ({ ...repository }));
        const write = this.writeQueue.then(async () => {
            const source = await this.read();
            const existing = new Map<number, Record<string, unknown>>();
            if (Array.isArray(source.repositories)) {
                for (const value of source.repositories) {
                    if (isRecord(value) && typeof value.id === 'number') {
                        existing.set(value.id, value);
                    }
                }
            }
            const storedRepositories = snapshot.map((repository) =>
                serializeRepository(repository, existing.get(repository.id)),
            );
            await this.save({ ...source, repositories: storedRepositories });
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
    }

    async ensureFile(): Promise<string> {
        const write = this.writeQueue.then(async () => {
            await fs.mkdir(path.dirname(this.file), { recursive: true });
            try {
                await fs.writeFile(
                    this.file,
                    `{\n  "token": "",\n  "user": "",\n  "httpProxy": "${defaultProxy}",\n  "socketProxy": "${defaultSocketProxy}",\n  "proxyEnabled": false,\n  "repositories": []\n}\n`,
                    {
                        encoding: 'utf8',
                        flag: 'wx',
                        mode: 0o600,
                    },
                );
                return;
            } catch (error) {
                if (!isAlreadyExists(error)) {
                    throw error;
                }
            }
            const source = await this.read();
            const next = { ...source };
            let changed = false;
            if (next.proxyEnabled === undefined) {
                next.proxyEnabled = false;
                changed = true;
            }
            if (next.httpProxy === undefined) {
                next.httpProxy = typeof next.proxy === 'string' ? next.proxy : defaultProxy;
                delete next.proxy;
                changed = true;
            }
            if (next.socketProxy === undefined) {
                next.socketProxy = defaultSocketProxy;
                changed = true;
            }
            if (next.repositories === undefined) {
                next.repositories = [];
                changed = true;
            }
            if (changed) {
                await this.save(next);
            }
        });
        this.writeQueue = write.catch(() => undefined);
        await write;
        return this.file;
    }

    private async read(missingAsEmpty = false): Promise<StoredGitHubData> {
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
            if (isNotFound(error)) {
                throw new Error(`GitHub configuration does not exist: ${this.file}`);
            }
            throw new Error(`Could not parse ${this.file}; fix the JSON before refreshing.`, { cause: error });
        }
    }

    private async save(source: StoredGitHubData): Promise<void> {
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

function parseProxyConfiguration(source: StoredGitHubData, file: string): GitHubProxyConfiguration {
    const enabled = source.proxyEnabled === true;
    const proxy =
        typeof source.httpProxy === 'string'
            ? source.httpProxy.trim()
            : typeof source.proxy === 'string'
              ? source.proxy.trim()
              : undefined;
    const socketProxy = typeof source.socketProxy === 'string' ? source.socketProxy.trim() : undefined;
    if (enabled && !proxy && !socketProxy) {
        throw new Error(`Set a non-empty "httpProxy" or "socketProxy" in ${file}, or set "proxyEnabled" to false.`);
    }
    return {
        enabled,
        ...(proxy ? { url: normalizeProxyUrl(proxy, file) } : {}),
        ...(socketProxy ? { socketUrl: normalizeSocketProxyUrl(socketProxy, file) } : {}),
    };
}

export function normalizeProxyUrl(value: string, source = 'the proxy setting'): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`Set ${source} to a valid HTTP or HTTPS proxy URL.`, { cause: error });
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Set ${source} to an HTTP or HTTPS proxy URL.`);
    }
    return url.toString();
}

export function normalizeSocketProxyUrl(value: string, source = 'the socket proxy setting'): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch (error) {
        throw new Error(`Set ${source} to a valid SOCKS proxy URL.`, { cause: error });
    }
    if (!['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(url.protocol)) {
        throw new Error(`Set ${source} to a SOCKS proxy URL.`);
    }
    return url.toString();
}

function parseStoredRepository(value: unknown): GitHubRepository | undefined {
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

function isAlreadyExists(error: unknown): boolean {
    return isRecord(error) && error.code === 'EEXIST';
}
