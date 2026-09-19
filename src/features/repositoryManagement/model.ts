export interface RepositoryItem {
    group: string;
    name: string;
    url: string;
    tags: string[];
    description?: string;
}

export interface RepositoryData {
    version: 1;
    repos: RepositoryItem[];
    settings?: RepositorySettings;
}

export interface RepositorySettings {
    viewMode: 'TAGS' | 'GROUPS' | 'HOSTS';
}
