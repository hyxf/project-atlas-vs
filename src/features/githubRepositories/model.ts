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
