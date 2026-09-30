/** Immutable asset information used to download and verify a release VSIX. */
export interface UpdateDownload {
    url: string;
    fileName: string;
    sha256: string;
}

export interface UpdateCompatibility {
    vscode: string;
}

/** Signed update metadata accepted from the stable update manifest. */
export interface UpdateManifest {
    schemaVersion: 1;
    channel: 'stable';
    latestVersion: string;
    minimumSupportedVersion?: string;
    publishedAt: string;
    releaseNotes: string;
    download: UpdateDownload;
    compatibility: UpdateCompatibility;
}

export interface AvailableUpdate {
    manifest: UpdateManifest;
    currentVersion: string;
    mandatory: boolean;
}

export interface UpToDateResult {
    kind: 'upToDate';
    currentVersion: string;
}

export interface UpdateAvailableResult {
    kind: 'available';
    update: AvailableUpdate;
}

/** Discriminated outcome of checking the currently installed version. */
export type UpdateCheckResult = UpToDateResult | UpdateAvailableResult;

export interface UpdateHttpResponse {
    status: number;
    body: string;
}

/** Injectable metadata HTTP transport used by the update service and tests. */
export type UpdateRequest = (url: string) => Promise<UpdateHttpResponse>;
