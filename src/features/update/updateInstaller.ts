import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import { UpdateManifest } from './model';

export type DownloadUpdate = (
    url: string,
    onProgress?: (downloadedBytes: number, totalBytes: number | undefined) => void,
) => Promise<Buffer>;

export async function downloadAndInstallUpdate(
    manifest: UpdateManifest,
    temporaryFile: string,
    download: DownloadUpdate,
    install: (file: string) => Promise<void>,
    onProgress?: (downloadedBytes: number, totalBytes: number | undefined) => void,
): Promise<void> {
    try {
        const contents = await download(manifest.download.url, onProgress);
        const checksum = createHash('sha256').update(contents).digest('hex');
        if (checksum !== manifest.download.sha256) {
            throw new Error('The downloaded update failed SHA-256 verification.');
        }
        await fs.writeFile(temporaryFile, contents, { flag: 'wx' });
        await install(temporaryFile);
    } finally {
        await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
    }
}
