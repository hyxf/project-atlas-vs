export type DependencyKind = 'dependencies' | 'devDependencies';

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
