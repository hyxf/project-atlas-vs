/** Credentials and proxy settings needed to read the authenticated user's repositories. */
export interface GitHubConfiguration {
    token: string;
    user: string;
    proxy: GitHubProxyConfiguration;
}

/** Proxy settings persisted alongside GitHub credentials. */
export interface GitHubProxyConfiguration {
    enabled: boolean;
    url?: string;
    socketUrl?: string;
}

/** Normalized GitHub repository data retained in the local cache. */
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

/** Injectable HTTP transport used by the GitHub client and its tests. */
export type GitHubRequest = (url: string, configuration: GitHubConfiguration) => Promise<GitHubResponse>;
