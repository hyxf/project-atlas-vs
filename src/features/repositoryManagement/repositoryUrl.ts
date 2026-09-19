export interface RepositoryIdentity {
    group: string;
    name: string;
}

export function repositoryIdentityKey(remoteUrl: string): string | undefined {
    const parsed = parseSshUrl(remoteUrl);
    const identity = parseRepositoryIdentity(remoteUrl);
    return parsed && identity
        ? `${parsed.user}@${parsed.host.toLocaleLowerCase()}:${parsed.port}/${identity.group}/${identity.name}`
        : undefined;
}

export function parseRepositoryIdentity(remoteUrl: string): RepositoryIdentity | undefined {
    const repositoryPath = parseSshUrl(remoteUrl)?.path;
    const parts = repositoryPath
        ?.replace(/^\/+|\/+$/g, '')
        .replace(/\.git$/i, '')
        .split('/')
        .filter(Boolean);
    if (!parts || parts.length < 2) {
        return undefined;
    }
    return { group: parts.slice(0, -1).join('/'), name: parts[parts.length - 1]! };
}

export function parseRepositoryHost(remoteUrl: string): string | undefined {
    return parseSshUrl(remoteUrl)?.host.toLocaleLowerCase();
}

function parseSshUrl(remoteUrl: string): { user: string; host: string; port: string; path: string } | undefined {
    const value = remoteUrl.trim();
    const scpLike = /^([^@/:\s]+)@(\[[^\]]+\]|[^/:\s]+):(.+)$/.exec(value);
    if (scpLike) {
        if (scpLike[2]!.startsWith('[')) {
            return undefined;
        }
        return { user: scpLike[1]!, host: scpLike[2]!, port: '22', path: scpLike[3]! };
    }
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'ssh:' &&
            parsed.hostname &&
            !parsed.hostname.includes(':') &&
            !parsed.password &&
            !parsed.search &&
            !parsed.hash
            ? { user: parsed.username, host: parsed.hostname, port: parsed.port || '22', path: parsed.pathname }
            : undefined;
    } catch {
        return undefined;
    }
}
