import type { AtlasSettings } from './types';

export type {
    AtlasSettings,
    CreateProject,
    ListFilter,
    ProjectClickState,
    ProjectFormValues,
    ProjectImportResult,
    ProjectItem,
    ProjectOpenMode,
    SortBy,
    ViewMode,
} from './types';

export const untaggedFilter = '__PROJECT_ATLAS_UNTAGGED__';

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
