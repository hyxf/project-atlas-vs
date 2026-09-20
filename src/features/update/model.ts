export interface UpdateManifest {
    schemaVersion: 1;
    channel: 'stable';
    latestVersion: string;
    minimumSupportedVersion?: string;
    publishedAt: string;
    releaseNotes: string;
    download: {
        url: string;
        fileName: string;
        sha256: string;
    };
    compatibility: {
        vscode: string;
    };
}

export interface AvailableUpdate {
    manifest: UpdateManifest;
    currentVersion: string;
    mandatory: boolean;
}

export type UpdateCheckResult =
    { kind: 'upToDate'; currentVersion: string } | { kind: 'available'; update: AvailableUpdate };
