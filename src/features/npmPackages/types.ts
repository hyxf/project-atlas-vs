export type DependencyKind = 'dependencies' | 'devDependencies';
export type PackageManager = 'yarn' | 'npm' | 'pnpm';

export interface PackageEntry {
    name: string;
    version?: string | undefined;
    kind?: DependencyKind | undefined;
    description?: string | undefined;
    tag?: string | undefined;
    tags?: string[] | undefined;
}

export interface TrashedPackageEntry extends PackageEntry {
    kind: DependencyKind;
}

export interface NpmSearchResult {
    name: string;
    version: string;
    description?: string | undefined;
}

export interface PackageMetadata {
    version: string;
    description?: string | undefined;
}

export interface NpmSearchPage {
    results: NpmSearchResult[];
    total: number;
    from: number;
}

export interface FavoritesDocument {
    root: Record<string, unknown>;
    items: PackageEntry[];
}

export interface TrashDocument {
    root: Record<string, unknown>;
    items: Record<string, TrashedPackageEntry[]>;
}

export interface NpmSearchResponse {
    total?: unknown;
    objects?: NpmSearchResponseItem[];
}

export interface NpmSearchResponseItem {
    package?: NpmSearchResult;
}

export interface NpmSearchProgress {
    message?: string;
    increment?: number;
}

export interface FavoriteRefreshResult {
    updated: number;
    cancelled: boolean;
}

export interface NpmSearchMessage {
    action?: unknown;
    text?: unknown;
    from?: unknown;
    entry?: unknown;
}
