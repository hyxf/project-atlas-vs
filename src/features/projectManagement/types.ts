export type ProjectOpenMode = 'CURRENT_WINDOW' | 'NEW_WINDOW';
export type SortBy = 'NAME' | 'PATH' | 'RECENT';
export type ViewMode = 'LIST' | 'TAGS';
export type ListFilter = 'ALL' | 'RECENT' | 'FAVORITES';

/** A locally saved workspace entry persisted in `project.json`. */
export interface ProjectItem {
    id: string;
    name: string;
    path: string;
    tags: string[];
    favorite: boolean;
    lastOpenedAt?: number | null;
}

/** User-configurable presentation and opening preferences for the project view. */
export interface AtlasSettings {
    defaultOpenMode: ProjectOpenMode;
    sortBy: SortBy;
    selectedFilter: ListFilter;
    selectedView: ViewMode;
    selectedListFilter: ListFilter;
    tagProjectSpacing: number;
    listProjectSpacing: number;
}

/** Records the last node click so the UI can distinguish a double click. */
export interface ProjectClickState {
    id: string;
    at: number;
}

/** Counts the outcome of a batch project import without exposing individual failures. */
export interface ProjectImportResult {
    added: number;
    updated: number;
    skipped: number;
    failed: number;
}

/** Input required to create an item; the service generates identity and open time. */
export type CreateProject = Omit<ProjectItem, 'id' | 'lastOpenedAt'>;
/** Editable fields accepted by the project edit form. */
export type ProjectFormValues = Pick<ProjectItem, 'name' | 'tags' | 'favorite'>;
