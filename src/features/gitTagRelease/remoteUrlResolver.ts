export function repositoryWebUrl(remoteUrl: string): string | undefined {
    let result: string;
    if (/^https?:\/\//.test(remoteUrl)) {
        try {
            const url = new URL(remoteUrl);
            url.username = '';
            url.password = '';
            result = url.toString();
        } catch {
            return undefined;
        }
    } else {
        const scp = /^(?:[^@]+@)?([^:]+):(.+)$/.exec(remoteUrl);
        const ssh = /^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(remoteUrl);
        const match = ssh ?? scp;
        if (!match) {
            return undefined;
        }
        result = `https://${match[1]}/${match[2]}`;
    }
    return result.replace(/\.git\/?$/, '').replace(/\/$/, '');
}
