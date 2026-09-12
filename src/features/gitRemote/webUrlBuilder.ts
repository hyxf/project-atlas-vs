import { HostingPlatform } from './types';
import { parseRemoteUrl } from './remoteUrlParser';

export function detectHostingPlatform(host: string): HostingPlatform | undefined {
    return (['gitlab', 'bitbucket', 'github', 'gitee', 'codeup'] as const).find((platform) => host.includes(platform));
}

export function buildWebUrl(
    origin: string,
    branch?: string,
    relativePath?: string,
    platform?: HostingPlatform,
    pathType?: 'directory' | 'file',
): string | undefined {
    const remote = parseRemoteUrl(origin);
    if (!remote) {
        return undefined;
    }
    if (!branch) {
        return remote.repositoryUrl;
    }
    const selectedPlatform = platform ?? detectHostingPlatform(remote.host);
    if (!selectedPlatform) {
        return undefined;
    }
    const encodedBranch = encodeSegments(branch);
    const encodedPath = relativePath ? `/${encodeSegments(relativePath)}` : '';
    const route = routeFor(selectedPlatform, pathType ?? 'directory');
    return `${remote.repositoryUrl}/${route}/${encodedBranch}${encodedPath}`;
}

function routeFor(platform: HostingPlatform, pathType: 'directory' | 'file'): string {
    if (platform === 'gitlab') {
        return pathType === 'file' ? '-/blob' : '-/tree';
    }
    if (platform === 'bitbucket') {
        return 'src';
    }
    return pathType === 'file' ? 'blob' : 'tree';
}

function encodeSegments(value: string): string {
    return value.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}
