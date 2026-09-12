import * as net from 'net';
import * as https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { GitHubConfiguration, GitHubRepository } from './model';

interface GitHubResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

type GitHubRequest = (url: string, configuration: GitHubConfiguration) => Promise<GitHubResponse>;

export class GitHubApiClient {
    constructor(private readonly request: GitHubRequest = requestGitHub) {}

    async repositories(configuration: GitHubConfiguration): Promise<GitHubRepository[]> {
        const proxyUrl = configuration.proxy.url ?? configuration.proxy.socketUrl;
        if (configuration.proxy.enabled && proxyUrl) {
            await verifyProxy(proxyUrl);
        }
        const userResponse = await this.request('https://api.github.com/user', configuration);
        if (userResponse.status !== 200) {
            throw apiError(userResponse.status, userResponse.body);
        }
        const authenticatedUser = parseAuthenticatedUser(userResponse.body);
        if (authenticatedUser.localeCompare(configuration.user, undefined, { sensitivity: 'accent' }) !== 0) {
            throw new Error(
                `GitHub token belongs to ${authenticatedUser}, but github.json configures user ${configuration.user}.`,
            );
        }
        const repositories: GitHubRepository[] = [];
        let url: string | undefined = 'https://api.github.com/user/repos?per_page=100';
        while (url) {
            const response = await this.request(url, configuration);
            if (response.status !== 200) {
                throw apiError(response.status, response.body);
            }
            const page = parseRepositories(response.body);
            repositories.push(...page);
            url = nextPage(response.headers.link);
        }
        return repositories;
    }
}

function verifyProxy(proxy: string): Promise<void> {
    const url = new URL(proxy);
    const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: url.hostname, port });
        const fail = (error: Error) => {
            socket.destroy();
            reject(new Error(`GitHub proxy is unavailable at ${proxy}.`, { cause: error }));
        };
        socket.once('connect', () => {
            socket.end();
            resolve();
        });
        socket.once('error', fail);
        socket.setTimeout(5_000, () => fail(new Error('Proxy connection timed out.')));
    });
}

function parseAuthenticatedUser(body: string): string {
    let source: unknown;
    try {
        source = JSON.parse(body);
    } catch (error) {
        throw new Error('GitHub returned invalid user JSON.', { cause: error });
    }
    if (!isRecord(source) || typeof source.login !== 'string') {
        throw new Error('GitHub returned an unexpected user response.');
    }
    return source.login;
}

function requestGitHub(url: string, configuration: GitHubConfiguration): Promise<GitHubResponse> {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            {
                ...(configuration.proxy.enabled && configuration.proxy.url
                    ? { agent: new HttpsProxyAgent(configuration.proxy.url) }
                    : configuration.proxy.enabled && configuration.proxy.socketUrl
                      ? { agent: new SocksProxyAgent(configuration.proxy.socketUrl) }
                      : {}),
                headers: {
                    Accept: 'application/vnd.github+json',
                    Authorization: `token ${configuration.token}`,
                    'User-Agent': 'project-atlas-vs',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode ?? 0,
                        headers: response.headers,
                        body: Buffer.concat(chunks).toString('utf8'),
                    }),
                );
            },
        );
        request.on('error', reject);
        request.setTimeout(30_000, () => request.destroy(new Error('GitHub request timed out.')));
    });
}

function parseRepositories(body: string): GitHubRepository[] {
    let source: unknown;
    try {
        source = JSON.parse(body);
    } catch (error) {
        throw new Error('GitHub returned invalid JSON.', { cause: error });
    }
    if (!Array.isArray(source)) {
        throw new Error('GitHub returned an unexpected repository response.');
    }
    return source.map(parseRepository).filter((repository): repository is GitHubRepository => repository !== undefined);
}

function parseRepository(value: unknown): GitHubRepository | undefined {
    if (
        !isRecord(value) ||
        typeof value.id !== 'number' ||
        typeof value.name !== 'string' ||
        typeof value.full_name !== 'string' ||
        !isRecord(value.owner) ||
        typeof value.owner.login !== 'string' ||
        typeof value.html_url !== 'string' ||
        typeof value.ssh_url !== 'string' ||
        typeof value.clone_url !== 'string' ||
        typeof value.private !== 'boolean' ||
        typeof value.archived !== 'boolean' ||
        typeof value.fork !== 'boolean' ||
        typeof value.updated_at !== 'string'
    ) {
        return undefined;
    }
    const repository: GitHubRepository = {
        id: value.id,
        name: value.name,
        fullName: value.full_name,
        owner: value.owner.login,
        htmlUrl: value.html_url,
        sshUrl: value.ssh_url,
        cloneUrl: value.clone_url,
        private: value.private,
        archived: value.archived,
        fork: value.fork,
        updatedAt: value.updated_at,
    };
    if (typeof value.description === 'string') {
        repository.description = value.description;
    }
    if (typeof value.language === 'string') {
        repository.language = value.language;
    }
    return repository;
}

function nextPage(link: string | string[] | undefined): string | undefined {
    const value = Array.isArray(link) ? link.join(',') : link;
    if (!value) {
        return undefined;
    }
    for (const part of value.split(',')) {
        const match = part.match(/^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/);
        if (match?.[2] === 'next') {
            return match[1];
        }
    }
    return undefined;
}

function apiError(status: number, body: string): Error {
    let message: string | undefined;
    try {
        const source = JSON.parse(body) as unknown;
        if (isRecord(source) && typeof source.message === 'string') {
            message = source.message;
        }
    } catch {
        // Ignore an invalid error body and use the status below.
    }
    if (status === 401) {
        return new Error('GitHub rejected the token. Check token in github.json.');
    }
    if (status === 403) {
        return new Error(`GitHub denied the request${message ? `: ${message}` : '.'}`);
    }
    return new Error(`GitHub request failed with status ${status}${message ? `: ${message}` : '.'}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
