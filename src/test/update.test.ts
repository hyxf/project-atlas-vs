import * as assert from 'assert';
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
        const result = await service.check('0.3.0');
        assert.strictEqual(result.kind, 'available');
        if (result.kind === 'available') {
            assert.strictEqual(result.update.manifest.latestVersion, '0.6.0');
            assert.strictEqual(result.update.mandatory, true);
        }
    });

    test('does not report equal or older remote versions as updates', async () => {
        const service = new UpdateService(async () => ({ status: 200, body: manifest('0.5.0') }));
        const result = await service.check('0.5.0');
        assert.deepStrictEqual(result, { kind: 'upToDate', currentVersion: '0.5.0' });
    });

    test('rejects untrusted download URLs and malformed data', () => {
        assert.throws(
            () => parseUpdateManifest(manifest().replace('https://github.com/', 'https://example.com/')),
            /untrusted/,
        );
        assert.throws(() => parseUpdateManifest('{'), /invalid JSON/);
        assert.throws(() => parseUpdateManifest(manifest().replace('0.6.0', 'next')), /semantic version/);
    });
});
