import * as https from 'https';
import * as semver from 'semver';
import { UpdateCheckResult, UpdateManifest } from './model';

const REPOSITORY = 'hyxf/project-atlas-vs';
export const UPDATE_METADATA_URL = 'https://hyxf.github.io/project-atlas-vs/update/stable.json';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

type Request = (url: string) => Promise<{ status: number; body: string }>;

export class UpdateService {
    constructor(private readonly request: Request = requestUpdateManifest) {}

    async check(currentVersion: string): Promise<UpdateCheckResult> {
        const normalizedCurrentVersion = requireVersion(currentVersion, 'The installed extension version');
        const response = await this.request(`${UPDATE_METADATA_URL}?t=${Date.now()}`);
        if (response.status !== 200) {
            throw new Error(`Update service returned HTTP ${response.status}.`);
        }
        const manifest = parseUpdateManifest(response.body);
        if (!semver.gt(manifest.latestVersion, normalizedCurrentVersion)) {
            return { kind: 'upToDate', currentVersion: normalizedCurrentVersion };
        }
        return {
            kind: 'available',
            update: {
                manifest,
                currentVersion: normalizedCurrentVersion,
                mandatory:
                    manifest.minimumSupportedVersion !== undefined &&
                    semver.lt(normalizedCurrentVersion, manifest.minimumSupportedVersion),
            },
        };
    }
}

export async function downloadUpdate(
    url: string,
    onProgress?: (downloadedBytes: number, totalBytes: number | undefined) => void,
): Promise<Buffer> {
    return requestUpdateFile(new URL(url), onProgress, 0);
}

export function parseUpdateManifest(body: string): UpdateManifest {
    let value: unknown;
    try {
        value = JSON.parse(body);
    } catch (error) {
        throw new Error('Update service returned invalid JSON.', { cause: error });
    }
    if (!isRecord(value) || value.schemaVersion !== 1 || value.channel !== 'stable') {
        throw new Error('Update service returned an unsupported manifest.');
    }
    const latestVersion = requireVersion(value.latestVersion, 'Update manifest latestVersion');
    const minimumSupportedVersion = optionalVersion(
        value.minimumSupportedVersion,
        'Update manifest minimumSupportedVersion',
    );
    if (typeof value.publishedAt !== 'string' || Number.isNaN(Date.parse(value.publishedAt))) {
        throw new Error('Update manifest publishedAt must be an ISO date.');
    }
    if (!isRecord(value.download) || !isRecord(value.compatibility)) {
        throw new Error('Update manifest is missing download or compatibility information.');
    }
    const fileName = `project-atlas-vs-${latestVersion}.vsix`;
    const expectedDownload = `https://github.com/${REPOSITORY}/releases/download/v${latestVersion}/${fileName}`;
    const expectedReleaseNotes = `https://github.com/${REPOSITORY}/releases/tag/v${latestVersion}`;
    if (
        value.releaseNotes !== expectedReleaseNotes ||
        value.download.url !== expectedDownload ||
        value.download.fileName !== fileName
    ) {
        throw new Error('Update manifest contains an untrusted release URL.');
    }
    if (typeof value.download.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(value.download.sha256)) {
        throw new Error('Update manifest contains an invalid SHA-256 checksum.');
    }
    if (typeof value.compatibility.vscode !== 'string' || !value.compatibility.vscode.trim()) {
        throw new Error('Update manifest contains an invalid VS Code compatibility range.');
    }
    const manifest: UpdateManifest = {
        schemaVersion: 1,
        channel: 'stable',
        latestVersion,
        publishedAt: value.publishedAt,
        releaseNotes: value.releaseNotes,
        download: {
            url: value.download.url,
            fileName,
            sha256: value.download.sha256.toLowerCase(),
        },
        compatibility: { vscode: value.compatibility.vscode },
    };
    if (minimumSupportedVersion !== undefined) {
        manifest.minimumSupportedVersion = minimumSupportedVersion;
    }
    return manifest;
}

function requestUpdateManifest(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            { headers: { Accept: 'application/json', 'User-Agent': 'project-atlas-vs' } },
            (response) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk: Buffer) => chunks.push(chunk));
                response.on('end', () =>
                    resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
                );
            },
        );
        request.on('error', reject);
        request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Update check timed out.')));
    });
}

function requestUpdateFile(
    url: URL,
    onProgress: ((downloadedBytes: number, totalBytes: number | undefined) => void) | undefined,
    redirectCount: number,
): Promise<Buffer> {
    if (url.protocol !== 'https:') {
        return Promise.reject(new Error('Update download must use HTTPS.'));
    }
    if (redirectCount > 5) {
        return Promise.reject(new Error('Update download redirected too many times.'));
    }
    return new Promise((resolve, reject) => {
        const request = https.get(
            url,
            { headers: { Accept: 'application/octet-stream', 'User-Agent': 'project-atlas-vs' } },
            (response) => {
                const status = response.statusCode ?? 0;
                const location = response.headers.location;
                if (status >= 300 && status < 400 && location !== undefined) {
                    response.resume();
                    void requestUpdateFile(new URL(location, url), onProgress, redirectCount + 1).then(resolve, reject);
                    return;
                }
                if (status !== 200) {
                    response.resume();
                    reject(new Error(`Update download returned HTTP ${status}.`));
                    return;
                }
                const totalBytes = response.headers['content-length']
                    ? Number(response.headers['content-length'])
                    : undefined;
                if (
                    totalBytes !== undefined &&
                    (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_DOWNLOAD_BYTES)
                ) {
                    response.resume();
                    reject(new Error('Update download is too large.'));
                    return;
                }
                const chunks: Buffer[] = [];
                let downloadedBytes = 0;
                response.on('data', (chunk: Buffer) => {
                    downloadedBytes += chunk.length;
                    if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
                        response.destroy(new Error('Update download is too large.'));
                        return;
                    }
                    chunks.push(chunk);
                    onProgress?.(downloadedBytes, totalBytes);
                });
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            },
        );
        request.on('error', reject);
        request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('Update download timed out.')));
    });
}

function requireVersion(value: unknown, label: string): string {
    if (typeof value !== 'string' || !semver.valid(value)) {
        throw new Error(`${label} must be a valid semantic version.`);
    }
    return semver.clean(value) ?? value;
}

function optionalVersion(value: unknown, label: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }
    return requireVersion(value, label);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
