import * as assert from 'assert';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { updateActions } from '../features/update/updateFeature';
import { downloadAndInstallUpdate } from '../features/update/updateInstaller';
import { parseUpdateManifest, UpdateService } from '../features/update/updateService';

function manifest(version = '0.6.0'): string {
    return JSON.stringify({
        schemaVersion: 1,
        channel: 'stable',
        latestVersion: version,
        minimumSupportedVersion: '0.4.0',
        publishedAt: '2026-09-20T10:00:00.000Z',
        releaseNotes: `https://github.com/hyxf/project-atlas-vs/releases/tag/v${version}`,
        download: {
            url: `https://github.com/hyxf/project-atlas-vs/releases/download/v${version}/project-atlas-vs-${version}.vsix`,
            fileName: `project-atlas-vs-${version}.vsix`,
            sha256: 'a'.repeat(64),
        },
        compatibility: { vscode: '>=1.134.0' },
    });
}

suite('Update service', () => {
    test('identifies an available update and an unsupported installed version', async () => {
        const service = new UpdateService(async () => ({ status: 200, body: manifest() }));
        const result = await service.check('0.3.0', '1.138.0');
        assert.strictEqual(result.kind, 'available');
        if (result.kind === 'available') {
            assert.strictEqual(result.update.manifest.latestVersion, '0.6.0');
            assert.strictEqual(result.update.mandatory, true);
        }
    });

    test('does not report equal or older remote versions as updates', async () => {
        const service = new UpdateService(async () => ({ status: 200, body: manifest('0.5.0') }));
        const result = await service.check('0.5.0', '1.138.0');
        assert.deepStrictEqual(result, { kind: 'upToDate', currentVersion: '0.5.0' });
    });

    test('rejects untrusted download URLs and malformed data', () => {
        assert.throws(
            () => parseUpdateManifest(manifest().replace('https://github.com/', 'https://example.com/')),
            /untrusted/,
        );
        assert.throws(() => parseUpdateManifest('{'), /invalid JSON/);
        assert.throws(() => parseUpdateManifest(manifest().replace('0.6.0', 'next')), /semantic version/);
        assert.throws(() => parseUpdateManifest(manifest().replace('>=1.134.0', 'not-a-range')), /compatibility/);
    });

    test('rejects an update that is incompatible with the installed VS Code version', async () => {
        const service = new UpdateService(async () => ({
            status: 200,
            body: manifest().replace('>=1.134.0', '>=2.0.0'),
        }));
        await assert.rejects(() => service.check('0.5.0', '1.138.0'), /requires VS Code >=2.0.0/);
    });

    test('offers no skip actions for mandatory updates', () => {
        assert.deepStrictEqual(updateActions(true), ['Upgrade Now', 'View Release Notes']);
        assert.deepStrictEqual(updateActions(false), [
            'Upgrade Now',
            'View Release Notes',
            'Later',
            'Ignore This Version',
        ]);
    });

    test('downloads, verifies, installs, and removes the temporary VSIX', async () => {
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-update-test-'));
        const temporaryFile = path.join(temporaryDirectory, 'project-atlas.vsix');
        const contents = Buffer.from('valid VSIX contents');
        const update = parseUpdateManifest(manifest());
        update.download.sha256 = createHash('sha256').update(contents).digest('hex');
        const progress: Array<[number, number | undefined]> = [];
        let installedContents: Buffer | undefined;
        try {
            await downloadAndInstallUpdate(
                update,
                temporaryFile,
                async (_url, onProgress) => {
                    onProgress?.(contents.length, contents.length);
                    return contents;
                },
                async (file) => {
                    installedContents = await fs.readFile(file);
                },
                (downloadedBytes, totalBytes) => progress.push([downloadedBytes, totalBytes]),
            );
            assert.deepStrictEqual(installedContents, contents);
            assert.deepStrictEqual(progress, [[contents.length, contents.length]]);
            await assert.rejects(fs.access(temporaryFile));
        } finally {
            await fs.rm(temporaryDirectory, { recursive: true, force: true });
        }
    });

    test('does not install an update with an invalid checksum and removes its temporary file', async () => {
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-update-test-'));
        const temporaryFile = path.join(temporaryDirectory, 'project-atlas.vsix');
        let installCalled = false;
        try {
            await assert.rejects(
                () =>
                    downloadAndInstallUpdate(
                        parseUpdateManifest(manifest()),
                        temporaryFile,
                        async () => Buffer.from('tampered VSIX contents'),
                        async () => {
                            installCalled = true;
                        },
                    ),
                /SHA-256 verification/,
            );
            assert.strictEqual(installCalled, false);
            await assert.rejects(fs.access(temporaryFile));
        } finally {
            await fs.rm(temporaryDirectory, { recursive: true, force: true });
        }
    });

    test('removes the temporary VSIX when installation fails', async () => {
        const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-update-test-'));
        const temporaryFile = path.join(temporaryDirectory, 'project-atlas.vsix');
        const contents = Buffer.from('valid VSIX contents');
        const update = parseUpdateManifest(manifest());
        update.download.sha256 = createHash('sha256').update(contents).digest('hex');
        try {
            await assert.rejects(
                () =>
                    downloadAndInstallUpdate(
                        update,
                        temporaryFile,
                        async () => contents,
                        async () => {
                            throw new Error('installation failed');
                        },
                    ),
                /installation failed/,
            );
            await assert.rejects(fs.access(temporaryFile));
        } finally {
            await fs.rm(temporaryDirectory, { recursive: true, force: true });
        }
    });
});
