export interface ProjectItem {
    id: string;
    name: string;
    path: string;
    tags: string[];
    favorite: boolean;
    lastOpenedAt?: number | null;
}

export type SortBy = 'NAME' | 'PATH' | 'RECENT';
export type ViewMode = 'LIST' | 'TAGS';
export type ListFilter = 'ALL' | 'RECENT' | 'FAVORITES';
export const untaggedFilter = '__PROJECT_ATLAS_UNTAGGED__';

export interface AtlasSettings {
    defaultOpenMode: 'CURRENT_WINDOW' | 'NEW_WINDOW';
    sortBy: SortBy;
    selectedFilter: ListFilter;
    selectedView: ViewMode;
    selectedListFilter: ListFilter;
    tagProjectSpacing: number;
    listProjectSpacing: number;
}

export const defaultSettings: AtlasSettings = {
    defaultOpenMode: 'CURRENT_WINDOW',
    sortBy: 'NAME',
    selectedFilter: 'ALL',
    selectedView: 'LIST',
    selectedListFilter: 'ALL',
    tagProjectSpacing: 4,
    listProjectSpacing: 4,
};

export function cleanTags(tags: Iterable<string>): string[] {
    return [...new Set([...tags].map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
}
