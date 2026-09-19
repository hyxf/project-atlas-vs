export interface ParsedRemoteUrl {
    repositoryUrl: string;
    host: string;
}

export function parseRemoteUrl(remoteUrl: string): ParsedRemoteUrl | undefined {
    const value = remoteUrl.trim();
    if (!value) {
        return undefined;
    }
    if (/^https?:\/\//i.test(value)) {
        try {
            const url = new URL(value);
            url.username = '';
            url.password = '';
            url.hash = '';
            url.search = '';
            const repositoryPath = cleanPath(url.pathname);
            if (!repositoryPath) {
                return undefined;
            }
            url.pathname = repositoryPath;
            return { repositoryUrl: url.toString().replace(/\/$/, ''), host: url.hostname.toLowerCase() };
        } catch {
            return undefined;
        }
    }
    const ssh = /^ssh:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^/:]+)(?::\d+)?\/(.+)$/i.exec(value);
    const scp = /^(?:[^@/:]+@)?([^/:]+):(.+)$/.exec(value);
    const match = ssh ?? scp;
    if (!match?.[1] || !match[2]) {
        return undefined;
    }
    const host = match[1].replace(/^\[|\]$/g, '').toLowerCase();
    const repositoryPath = cleanPath(match[2]);
    return repositoryPath ? { repositoryUrl: `https://${host}/${repositoryPath}`, host } : undefined;
}

function cleanPath(value: string): string {
    return value.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}
