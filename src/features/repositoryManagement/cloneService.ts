import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runGit, sanitizeGitOutput } from '../gitTagRelease/gitTagService';
import { GitHubProxyConfiguration } from '../githubRepositories/model';
import { RepositoryItem } from './model';

export interface CloneOptions {
    proxy?: GitHubProxyConfiguration;
    authorizationHeader?: string;
}

export class CloneCancellationError extends vscode.CancellationError {
    constructor(
        readonly target: string,
        readonly cleaned: boolean,
    ) {
        super();
    }
}

export async function ensureDefaultCloneParent(directory = path.join(os.homedir(), 'ProjectAtlas')): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) {
        throw new Error(`Default clone parent is not a directory: ${directory}`);
    }
    return directory;
}

export async function cloneRepository(
    repository: RepositoryItem,
    parent: string,
    token?: vscode.CancellationToken,
    options: CloneOptions = {},
): Promise<string> {
    const proxy = options.proxy ?? { enabled: false };
    const target = await resolveCloneTarget(parent, repository.name);
    const targetExisted = await exists(target);
    let result;
    try {
        const env = cloneGitEnvironment(proxy, options.authorizationHeader, repository.url);
        result = await runGit(
            parent,
            cloneArgs(repository.url, target, proxy),
            token,
            env === undefined ? {} : { env },
        );
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            const cleaned = await cleanupCancelledClone(target, targetExisted);
            throw new CloneCancellationError(target, cleaned);
        }
        throw error;
    }
    if (result.code !== 0) {
        const detail = sanitizeGitOutput(result.stderr || result.stdout);
        throw new Error(
            `Git clone failed${detail ? `: ${detail}` : ` with code ${result.code}`}. Partial clone data may remain at ${target}.`,
        );
    }
    return target;
}

export function cloneArgs(url: string, target: string, proxy: GitHubProxyConfiguration): string[] {
    if (proxy.enabled && proxy.socketUrl && isSshCloneUrl(url)) {
        return ['-c', `core.sshCommand=${sshCommandThroughSocksProxy(proxy.socketUrl)}`, 'clone', '--', url, target];
    }
    const proxyUrl = proxy.url ?? proxy.socketUrl;
    return proxy.enabled && proxyUrl && isHttpCloneUrl(url)
        ? ['-c', `http.proxy=${proxyUrl}`, 'clone', '--', url, target]
        : ['clone', '--', url, target];
}

export function cloneProxyEnvironment(proxy: GitHubProxyConfiguration): NodeJS.ProcessEnv | undefined {
    return cloneGitEnvironment(proxy);
}

function isHttpCloneUrl(value: string): boolean {
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
    } catch {
        return false;
    }
}

function isSshCloneUrl(value: string): boolean {
    return value.trim().startsWith('ssh://') || /^[^@/\s]+@[^/:\s]+:.+$/.test(value.trim());
}

function sshCommandThroughSocksProxy(proxy: string): string {
    const url = new URL(proxy);
    if (url.protocol !== 'socks5:' && url.protocol !== 'socks5h:') {
        throw new Error('SSH clone supports only socks5:// or socks5h:// socket proxies.');
    }
    const host = url.hostname.includes(':') ? `[${url.hostname}]` : url.hostname;
    const address = `${host}:${url.port || '1080'}`;
    return `ssh -o ProxyCommand="nc -x ${address} -X 5 %h %p"`;
}

export function cloneGitEnvironment(
    proxy: GitHubProxyConfiguration,
    authorizationHeader?: string,
    url?: string,
): NodeJS.ProcessEnv | undefined {
    const env: NodeJS.ProcessEnv = {};
    const proxyUrl = proxy.url ?? proxy.socketUrl;
    if (proxy.enabled && proxyUrl && (url === undefined || isHttpCloneUrl(url))) {
        env.HTTP_PROXY = proxyUrl;
        env.HTTPS_PROXY = proxyUrl;
        env.ALL_PROXY = proxyUrl;
        env.http_proxy = proxyUrl;
        env.https_proxy = proxyUrl;
        env.all_proxy = proxyUrl;
    }
    if (authorizationHeader) {
        env.GIT_CONFIG_COUNT = '1';
        env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
        env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: ${authorizationHeader}`;
    }
    return Object.keys(env).length ? env : undefined;
}

export async function cleanupCancelledClone(target: string, targetExisted: boolean): Promise<boolean> {
    try {
        if (!targetExisted) {
            await fs.rm(target, { recursive: true, force: true });
            return true;
        }
        const entries = await fs.readdir(target);
        await Promise.all(entries.map((entry) => fs.rm(path.join(target, entry), { recursive: true, force: true })));
        return true;
    } catch {
        return false;
    }
}

export async function resolveCloneTarget(parent: string, repositoryName: string): Promise<string> {
    const name = repositoryName.trim();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
        throw new Error(`Repository name cannot be used as a directory name: ${repositoryName}`);
    }
    const parentStat = await fs.stat(parent).catch(() => undefined);
    if (!parentStat?.isDirectory()) {
        throw new Error(`Clone parent is not a directory: ${parent}`);
    }
    const target = path.resolve(parent, name);
    if (target === path.parse(target).root) {
        throw new Error('The file system root cannot be used as a clone target.');
    }
    const targetStat = await fs.stat(target).catch(() => undefined);
    if (targetStat && (!targetStat.isDirectory() || (await fs.readdir(target)).length > 0)) {
        throw new Error(`Clone target already exists and is not empty: ${target}`);
    }
    return target;
}

async function exists(target: string): Promise<boolean> {
    return fs.stat(target).then(
        () => true,
        () => false,
    );
}
