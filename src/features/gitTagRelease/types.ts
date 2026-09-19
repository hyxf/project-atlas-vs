export interface SemVer {
    major: bigint;
    minor: bigint;
    patch: bigint;
}

export interface VersionCandidates {
    current: SemVer;
    major: SemVer;
    minor: SemVer;
    patch: SemVer;
}

export interface GitRemoteInfo {
    name: string;
    pushUrls: string[];
    displayUrl?: string;
}

export interface ReleaseState {
    reference: string;
    branch?: string;
    hasUncommittedChanges: boolean;
    trackedBranch?: string;
    trackingRemote?: string;
    ahead: number;
    behind: number;
}

export type PublishStatus =
    | 'success'
    | 'localTagExists'
    | 'targetChanged'
    | 'checkFailed'
    | 'localTagCreateFailed'
    | 'pushCancelled'
    | 'pushFailed';

export interface PublishResult {
    status: PublishStatus;
    message: string;
}
