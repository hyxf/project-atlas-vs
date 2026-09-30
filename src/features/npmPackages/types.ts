/** Dependency sections that Project Atlas can modify in a workspace package.json. */
export type DependencyKind = 'dependencies' | 'devDependencies';
export type PackageManager = 'yarn' | 'npm' | 'pnpm';

/** Package data used by installed, favorite, and search result views. */
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

/** A favorite-document parse result that preserves unknown root properties. */
export interface FavoritesDocument {
    root: Record<string, unknown>;
    items: PackageEntry[];
}

/** A trash-document parse result keyed by the workspace package.json URI. */
export interface TrashDocument {
    root: Record<string, unknown>;
    items: Record<string, TrashedPackageEntry[]>;
}

/** Untrusted response shape from the npm search endpoint before runtime validation. */
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
