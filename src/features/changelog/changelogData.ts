export interface ChangelogData {
    readonly releases: readonly Release[];
}

export interface Release {
    readonly version: string;
    readonly date: string;
    readonly commits: readonly Commit[];
    readonly unreleased: boolean;
}

export interface Commit {
    readonly hash: string;
    readonly subject: string;
}

export interface SemVer {
    readonly major: bigint;
    readonly minor: bigint;
    readonly patch: bigint;
}
