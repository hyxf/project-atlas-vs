export interface GitHubConfiguration {
    token: string;
    user: string;
    proxy: GitHubProxyConfiguration;
}

export interface GitHubProxyConfiguration {
    enabled: boolean;
    url?: string;
    socketUrl?: string;
}

export interface GitHubRepository {
    id: number;
    name: string;
    fullName: string;
    owner: string;
    description?: string;
    htmlUrl: string;
    sshUrl: string;
    cloneUrl: string;
    private: boolean;
    archived: boolean;
    fork: boolean;
    language?: string;
    updatedAt: string;
}

export interface GitHubCredentials {
    token?: string;
    user?: string;
}

export interface GitHubSettingsUpdate {
    token?: string;
    user?: string;
    proxyEnabled?: boolean;
    httpProxy?: string;
    socketProxy?: string;
}

export interface GitHubProxyUpdate {
    enabled?: boolean;
    url?: string;
    socketUrl?: string;
}

export interface GitHubResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export type GitHubRequest = (url: string, configuration: GitHubConfiguration) => Promise<GitHubResponse>;
