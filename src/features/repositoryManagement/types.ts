export type RepositoryViewMode = 'TAGS' | 'GROUPS' | 'HOSTS';

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
    viewMode: RepositoryViewMode;
}

export interface RepositoryIdentity {
    group: string;
    name: string;
}

export interface RepositorySshUrl {
    user: string;
    host: string;
    port: string;
    path: string;
}

export interface RepositorySyncResult {
    added: number;
    existing: number;
    failed: number;
}

export type CreateRepository = Omit<RepositoryItem, 'description'> & Partial<Pick<RepositoryItem, 'description'>>;
export type UpdateRepository = Partial<Pick<RepositoryItem, 'group' | 'name' | 'url' | 'tags' | 'description'>>;
