export interface UpdateDownload {
    url: string;
    fileName: string;
    sha256: string;
}

export interface UpdateCompatibility {
    vscode: string;
}

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

export type UpdateCheckResult = UpToDateResult | UpdateAvailableResult;

export interface UpdateHttpResponse {
    status: number;
    body: string;
}

export type UpdateRequest = (url: string) => Promise<UpdateHttpResponse>;
