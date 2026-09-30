/** The grouping strategy currently selected for the saved-repositories tree. */
export type RepositoryViewMode = 'TAGS' | 'GROUPS' | 'HOSTS';

/** A saved remote repository entry persisted in `repos.json`. */
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

/** Parsed owner/group and repository name from a supported SSH remote URL. */
export interface RepositoryIdentity {
    group: string;
    name: string;
}

/** Normalized structural parts of an SSH remote URL used for identity comparisons. */
export interface RepositorySshUrl {
    user: string;
    host: string;
    port: string;
    path: string;
}

/** Aggregate result of synchronizing project remotes into the repository store. */
export interface RepositorySyncResult {
    added: number;
    existing: number;
    failed: number;
}

export type CreateRepository = Omit<RepositoryItem, 'description'> & Partial<Pick<RepositoryItem, 'description'>>;
export type UpdateRepository = Partial<Pick<RepositoryItem, 'group' | 'name' | 'url' | 'tags' | 'description'>>;
