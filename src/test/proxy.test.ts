import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { normalizeProxyUrl, ProxyConfigurationStore } from '../features/proxy/proxyFeature';

suite('Global proxy configuration', () => {
    let temporary: string;
    let file: string;

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-proxy-'));
        file = path.join(temporary, '.project-atlas', 'proxy.json');
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('reads named configured proxies and supports the legacy single-proxy format', async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({
                future: { keep: true },
                proxies: [
                    { name: 'First', url: 'http://first.example:8080' },
                    { name: 'Second', url: 'https://second.example/' },
                ],
            }),
        );

        const store = new ProxyConfigurationStore(file);
        assert.deepStrictEqual(await store.proxies(), [
            { name: 'First', url: 'http://first.example:8080' },
            { name: 'Second', url: 'https://second.example' },
        ]);
        await fs.writeFile(file, JSON.stringify({ proxies: ['http://string-list.example:8080'] }));
        assert.deepStrictEqual(await store.proxies(), [
            { name: 'http://string-list.example:8080', url: 'http://string-list.example:8080' },
        ]);
        await fs.writeFile(file, JSON.stringify({ proxy: 'http://legacy.example:8080' }));
        assert.deepStrictEqual(await store.proxies(), [
            { name: 'http://legacy.example:8080', url: 'http://legacy.example:8080' },
        ]);
    });

    test('rejects proxy protocols unsupported by the VS Code HTTP proxy setting', () => {
        assert.throws(() => normalizeProxyUrl('socks5://127.0.0.1:1080'), /HTTP or HTTPS proxy URL/);
    });

    test('creates the default proxy list only when the file is absent', async () => {
        const store = new ProxyConfigurationStore(file);
        await store.ensureFile();
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            proxies: [{ name: 'Local', url: 'http://127.0.0.1:1087' }],
        });
    });
});
