export type ProjectOpenMode = 'CURRENT_WINDOW' | 'NEW_WINDOW';
export type SortBy = 'NAME' | 'PATH' | 'RECENT';
export type ViewMode = 'LIST' | 'TAGS';
export type ListFilter = 'ALL' | 'RECENT' | 'FAVORITES';

export interface ProjectItem {
    id: string;
    name: string;
    path: string;
    tags: string[];
    favorite: boolean;
    lastOpenedAt?: number | null;
}

export interface AtlasSettings {
    defaultOpenMode: ProjectOpenMode;
    sortBy: SortBy;
    selectedFilter: ListFilter;
    selectedView: ViewMode;
    selectedListFilter: ListFilter;
    tagProjectSpacing: number;
    listProjectSpacing: number;
}

export interface ProjectClickState {
    id: string;
    at: number;
}

export interface ProjectImportResult {
    added: number;
    updated: number;
    skipped: number;
    failed: number;
}

export type CreateProject = Omit<ProjectItem, 'id' | 'lastOpenedAt'>;
export type ProjectFormValues = Pick<ProjectItem, 'name' | 'tags' | 'favorite'>;
