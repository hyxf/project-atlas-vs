import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import net = require('net');
import { mock } from 'node:test';
import * as vscode from 'vscode';
import { GitHubConfigurationStore } from '../features/githubRepositories/config';
import { revealTopGithubRepositoryNode } from '../features/githubRepositories/githubRepositoriesFeature';
import { GitHubApiClient } from '../features/githubRepositories/githubApiClient';
import { DoubleClickTracker } from '../features/githubRepositories/doubleClick';
import { RepositoryStore } from '../features/repositoryManagement/store';
import {
    GitHubLanguageNode,
    GitHubRepositoriesTree,
    GitHubRepositoryDescriptionNode,
    GitHubRepositoryNode,
    GitHubVisibilityNode,
} from '../features/githubRepositories/tree';

suite('GitHub Repositories', () => {
    let temporary: string;
    let file: string;

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-github-test-'));
        file = path.join(temporary, '.project-atlas', 'github.json');
    });

    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('creates and reads GitHub configuration without replacing existing data', async () => {
        const store = new GitHubConfigurationStore(file);
        await store.ensureFile();
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            token: '',
            user: '',
            proxyEnabled: false,
            httpProxy: 'http://127.0.0.1:1087',
            socketProxy: 'socks5://127.0.0.1:1086',
            repositories: [],
        });

        await fs.writeFile(file, JSON.stringify({ token: ' secret ', user: ' octocat ', future: true }));
        assert.deepStrictEqual(await store.configuration(), {
            token: 'secret',
            user: 'octocat',
            proxy: { enabled: false },
        });
        await store.ensureFile();
        assert.strictEqual(JSON.parse(await fs.readFile(file, 'utf8')).future, true);
    });

    test('reads and preserves GitHub proxy configuration', async () => {
        const store = new GitHubConfigurationStore(file);
        await store.ensureFile();
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), {
            token: '',
            user: '',
            proxyEnabled: false,
            httpProxy: 'http://127.0.0.1:1087',
            socketProxy: 'socks5://127.0.0.1:1086',
            repositories: [],
        });

        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                proxyEnabled: true,
                httpProxy: ' http://127.0.0.1:1087 ',
                socketProxy: ' socks5://127.0.0.1:1086 ',
                future: true,
                repositories: [],
            }),
        );
        assert.deepStrictEqual(await store.configuration(), {
            token: 'secret',
            user: 'octocat',
            proxy: { enabled: true, url: 'http://127.0.0.1:1087', socketUrl: 'socks5://127.0.0.1:1086' },
        });
        assert.deepStrictEqual(await store.proxyConfiguration(), {
            enabled: true,
            url: 'http://127.0.0.1:1087',
            socketUrl: 'socks5://127.0.0.1:1086',
        });

        await store.replaceRepositories([]);
        const written = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(written.proxyEnabled, true);
        assert.strictEqual(written.httpProxy, ' http://127.0.0.1:1087 ');
        assert.strictEqual(written.future, true);

        await store.replaceProxyConfiguration({ enabled: false, url: 'http://127.0.0.1:1088' });
        const updated = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(updated.token, 'secret');
        assert.strictEqual(updated.user, 'octocat');
        assert.strictEqual(updated.proxyEnabled, false);
        assert.strictEqual(updated.httpProxy, 'http://127.0.0.1:1088');
        assert.strictEqual(updated.socketProxy, ' socks5://127.0.0.1:1086 ');
        assert.strictEqual(updated.future, true);
        assert.deepStrictEqual(updated.repositories, []);

        await store.replaceSettings({ token: 'updated-token', user: 'updated-user' });
        const accountUpdated = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(accountUpdated.token, 'updated-token');
        assert.strictEqual(accountUpdated.user, 'updated-user');
        assert.strictEqual(accountUpdated.future, true);
        assert.strictEqual(accountUpdated.proxyEnabled, false);
        assert.strictEqual(accountUpdated.httpProxy, 'http://127.0.0.1:1088');
    });

    test('migrates the legacy proxy field to httpProxy', async () => {
        const store = new GitHubConfigurationStore(file);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({ token: 'secret', user: 'octocat', proxyEnabled: true, proxy: 'http://127.0.0.1:1087' }),
        );

        await store.ensureFile();

        const migrated = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(migrated.httpProxy, 'http://127.0.0.1:1087');
        assert.strictEqual(Object.hasOwn(migrated, 'proxy'), false);
        assert.strictEqual(Object.hasOwn(migrated, 'socketProxy'), false);
        await store.ensureFile();
        assert.deepStrictEqual(await store.proxyConfiguration(), {
            enabled: true,
            url: 'http://127.0.0.1:1087',
        });
    });

    test('rejects missing and invalid GitHub configuration', async () => {
        const store = new GitHubConfigurationStore(file);
        await assert.rejects(() => store.configuration(), /does not exist/);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, '{');
        await assert.rejects(() => store.configuration(), /Could not parse/);
        await fs.writeFile(file, JSON.stringify({ token: '', user: 'octocat' }));
        await assert.rejects(() => store.configuration(), /non-empty "token"/);
    });

    test('rejects invalid GitHub proxy configuration', async () => {
        const store = new GitHubConfigurationStore(file);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({ token: 'secret', user: 'octocat', proxyEnabled: true, httpProxy: '' }),
        );
        await assert.rejects(() => store.configuration(), /non-empty "httpProxy"/);
        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                proxyEnabled: true,
                httpProxy: 'socks5://127.0.0.1:1087',
            }),
        );
        await assert.rejects(() => store.configuration(), /HTTP or HTTPS proxy URL/);
    });

    test('checks proxy default ports without exposing credentials on failure', async () => {
        const ports: number[] = [];
        const connection = mock.method(net, 'createConnection', (options: net.NetConnectOpts) => {
            assert.ok('port' in options);
            ports.push(Number(options.port));
            const socket = new net.Socket();
            process.nextTick(() => socket.emit('error', new Error('Connection refused')));
            return socket;
        });
        try {
            const client = new GitHubApiClient(async () => {
                assert.fail('An unavailable proxy must prevent the API request');
            });
            for (const [protocol, port] of [
                ['http', 80],
                ['https', 443],
                ['socks', 1080],
                ['socks4', 1080],
                ['socks4a', 1080],
                ['socks5', 1080],
                ['socks5h', 1080],
            ] as const) {
                for (const explicitPort of ['', ':12345']) {
                    const url = `${protocol}://audit-user:audit-password@127.0.0.1${explicitPort}`;
                    const expectedPort = explicitPort ? 12345 : port;
                    await assert.rejects(
                        () =>
                            client.repositories({
                                token: 'secret',
                                user: 'octocat',
                                proxy: {
                                    enabled: true,
                                    ...(protocol.startsWith('socks') ? { socketUrl: url } : { url }),
                                },
                            }),
                        (error: Error) => {
                            assert.strictEqual(
                                error.message,
                                `GitHub proxy is unavailable at ${protocol}://127.0.0.1:${expectedPort}.`,
                            );
                            assert.ok(!error.message.includes('audit-user'));
                            assert.ok(!error.message.includes('audit-password'));
                            return true;
                        },
                    );
                    assert.strictEqual(ports.at(-1), expectedPort);
                }
            }
        } finally {
            connection.mock.restore();
        }
    });

    test('loads every page using the authenticated users default repository listing', async () => {
        const requests: Array<{ url: string; token: string }> = [];
        const client = new GitHubApiClient(async (url, configuration) => {
            requests.push({ url, token: configuration.token });
            if (requests.length === 1) {
                return {
                    status: 200,
                    headers: {},
                    body: JSON.stringify({ login: 'Octocat' }),
                };
            }
            if (requests.length === 2) {
                return {
                    status: 200,
                    headers: { link: '<https://api.github.com/user/repos?page=2>; rel="next"' },
                    body: JSON.stringify([repository(1, 'Octocat', 'one'), repository(2, 'another-user', 'shared')]),
                };
            }
            return {
                status: 200,
                headers: {},
                body: JSON.stringify([repository(3, 'octocat', 'two', true)]),
            };
        });

        const repositories = await client.repositories({ token: 'secret', user: 'octocat', proxy: { enabled: false } });
        assert.deepStrictEqual(
            repositories.map(({ fullName }) => fullName),
            ['Octocat/one', 'another-user/shared', 'octocat/two'],
        );
        assert.strictEqual(requests.length, 3);
        assert.strictEqual(requests[0]?.url, 'https://api.github.com/user');
        assert.strictEqual(requests[1]?.url, 'https://api.github.com/user/repos?per_page=100');
        assert.ok(requests[1]?.url.includes('per_page=100'));
        assert.ok(!requests[1]?.url.includes('type='));
        assert.ok(!requests[1]?.url.includes('affiliation='));
        assert.ok(!requests[1]?.url.includes('visibility='));
        assert.ok(requests.every(({ token }) => token === 'secret'));
        assert.strictEqual(repositories[2]?.private, true);
    });

    test('reports an invalid token without including it in the error', async () => {
        const client = new GitHubApiClient(async () => ({
            status: 401,
            headers: {},
            body: JSON.stringify({ message: 'Bad credentials' }),
        }));
        await assert.rejects(
            () => client.repositories({ token: 'do-not-expose', user: 'octocat', proxy: { enabled: false } }),
            (error: Error) => error.message.includes('rejected the token') && !error.message.includes('do-not-expose'),
        );
    });

    test('rejects a token that belongs to another configured user', async () => {
        const client = new GitHubApiClient(async () => ({
            status: 200,
            headers: {},
            body: JSON.stringify({ login: 'another-user' }),
        }));
        await assert.rejects(
            () => client.repositories({ token: 'secret', user: 'octocat', proxy: { enabled: false } }),
            /token belongs to another-user.*configures user octocat/,
        );
    });

    test('groups repositories by visibility and then language', async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                repositories: [
                    storedRepository(1, 'octocat', 'public-typescript', false, 'TypeScript'),
                    storedRepository(2, 'octocat', 'private-python', true, 'Python'),
                    storedRepository(3, 'octocat', 'private-unknown', true),
                ],
            }),
        );
        let request = 0;
        const client = new GitHubApiClient(async () => {
            request += 1;
            throw new Error('The local tree must not request GitHub.');
        });
        const repositoryStore = new RepositoryStore(path.join(temporary, '.project-atlas', 'repos.json'));
        await repositoryStore.addIfMissing({
            group: 'octocat',
            name: 'private-python',
            url: 'git@github.com:octocat/private-python.git',
            tags: ['saved'],
        });
        const tree = new GitHubRepositoriesTree(new GitHubConfigurationStore(file), client, repositoryStore);

        const visibilityNodes = await tree.getChildren();
        assert.deepStrictEqual(
            visibilityNodes.map(({ label }) => label),
            ['Public', 'Private'],
        );
        assert.ok(visibilityNodes.every((node) => node instanceof GitHubVisibilityNode));
        assert.ok(visibilityNodes.every((node) => node.collapsibleState === vscode.TreeItemCollapsibleState.Expanded));

        const privateNode = visibilityNodes[1];
        assert.ok(privateNode instanceof GitHubVisibilityNode);
        const languageNodes = await tree.getChildren(privateNode);
        assert.deepStrictEqual(
            languageNodes.map(({ label }) => label),
            ['Python', 'Unknown'],
        );
        assert.ok(languageNodes.every((node) => node instanceof GitHubLanguageNode));
        assert.ok(languageNodes.every((node) => node.collapsibleState === vscode.TreeItemCollapsibleState.Expanded));

        const pythonNode = languageNodes[0];
        assert.ok(pythonNode instanceof GitHubLanguageNode);
        const repositoryNodes = await tree.getChildren(pythonNode);
        assert.strictEqual(repositoryNodes.length, 1);
        assert.ok(repositoryNodes[0] instanceof GitHubRepositoryNode);
        assert.strictEqual(repositoryNodes[0].label, 'octocat/private-python');
        assert.strictEqual(repositoryNodes[0].contextValue, 'githubRepositorySaved');
        assert.strictEqual(repositoryNodes[0].description, undefined);
        assert.strictEqual(repositoryNodes[0].collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.strictEqual((repositoryNodes[0].iconPath as { id: string }).id, 'repo');
        assert.ok(!String(repositoryNodes[0].tooltip).includes('Private'));
        assert.ok(!String(repositoryNodes[0].tooltip).includes('Python'));
        assert.strictEqual(await tree.getParent(privateNode), undefined);
        const languageParent = await tree.getParent(pythonNode);
        assert.ok(languageParent instanceof GitHubVisibilityNode);
        assert.strictEqual(languageParent.label, 'Private');
        assert.strictEqual(languageParent.description, '2');
        const repositoryParent = await tree.getParent(repositoryNodes[0]);
        assert.ok(repositoryParent instanceof GitHubLanguageNode);
        assert.strictEqual(repositoryParent.label, 'Python');
        const descriptionNodes = await tree.getChildren(repositoryNodes[0]);
        assert.strictEqual(descriptionNodes.length, 1);
        assert.ok(descriptionNodes[0] instanceof GitHubRepositoryDescriptionNode);
        assert.strictEqual(descriptionNodes[0].label, 'private-python description');
        assert.strictEqual(descriptionNodes[0].contextValue, 'githubRepositoryDescription');
        assert.strictEqual((descriptionNodes[0].iconPath as { id: string }).id, 'info');
        assert.strictEqual(await tree.getParent(descriptionNodes[0]), repositoryNodes[0]);

        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                repositories: [storedRepository(4, 'octocat', 'replacement', false, 'Go')],
            }),
        );
        const stableLanguageParent = await tree.getParent(pythonNode);
        assert.ok(stableLanguageParent instanceof GitHubVisibilityNode);
        assert.strictEqual(stableLanguageParent.label, 'Private');
        assert.strictEqual(stableLanguageParent.description, '2');
        const stableRepositoryParent = await tree.getParent(repositoryNodes[0]);
        assert.ok(stableRepositoryParent instanceof GitHubLanguageNode);
        assert.strictEqual(stableRepositoryParent.label, 'Python');
        assert.strictEqual(stableRepositoryParent.description, '1');
        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                repositories: [
                    storedRepository(1, 'octocat', 'public-typescript', false, 'TypeScript'),
                    storedRepository(2, 'octocat', 'private-python', true, 'Python'),
                    storedRepository(3, 'octocat', 'private-unknown', true),
                ],
            }),
        );
        assert.strictEqual(request, 0);

        tree.collapseAll();
        const collapsedVisibilityNodes = await tree.getChildren();
        assert.ok(
            collapsedVisibilityNodes.every(
                (node) => node.collapsibleState === vscode.TreeItemCollapsibleState.Expanded,
            ),
        );
        const collapsedPrivateNode = collapsedVisibilityNodes[1];
        assert.ok(collapsedPrivateNode instanceof GitHubVisibilityNode);
        const collapsedLanguageNodes = await tree.getChildren(collapsedPrivateNode);
        assert.ok(
            collapsedLanguageNodes.every((node) => node.collapsibleState === vscode.TreeItemCollapsibleState.Collapsed),
        );
        const collapsedRepositoryNode = (await tree.getChildren(collapsedLanguageNodes[0]!))[0];
        assert.ok(collapsedRepositoryNode instanceof GitHubRepositoryNode);
        assert.strictEqual(collapsedRepositoryNode.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);

        tree.expandAll();
        const expandedPrivateNode = (await tree.getChildren())[1];
        assert.ok(expandedPrivateNode instanceof GitHubVisibilityNode);
        const expandedLanguageNodes = await tree.getChildren(expandedPrivateNode);
        assert.ok(
            expandedLanguageNodes.every((node) => node.collapsibleState === vscode.TreeItemCollapsibleState.Expanded),
        );
        const expandedRepositoryNode = (await tree.getChildren(expandedLanguageNodes[0]!))[0];
        assert.ok(expandedRepositoryNode instanceof GitHubRepositoryNode);
        assert.strictEqual(expandedRepositoryNode.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
    });

    test('shows a description child only when a GitHub repository has one', async () => {
        const withoutDescription = storedRepository(1, 'octocat', 'without-description', false, 'TypeScript');
        delete withoutDescription.description;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({ token: 'secret', user: 'octocat', repositories: [withoutDescription] }),
        );
        const tree = new GitHubRepositoriesTree(
            new GitHubConfigurationStore(file),
            new GitHubApiClient(async () => {
                throw new Error('The local tree must not request GitHub.');
            }),
            new RepositoryStore(path.join(temporary, '.project-atlas', 'repos.json')),
        );

        const visibilityNode = (await tree.getChildren())[0];
        assert.ok(visibilityNode instanceof GitHubVisibilityNode);
        const languageNode = (await tree.getChildren(visibilityNode))[0];
        assert.ok(languageNode instanceof GitHubLanguageNode);
        const repositoryNode = (await tree.getChildren(languageNode))[0];
        assert.ok(repositoryNode instanceof GitHubRepositoryNode);
        assert.strictEqual(repositoryNode.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.deepStrictEqual(await tree.getChildren(repositoryNode), []);
    });

    test('reveals the latest expanded tree top after refresh settles', async () => {
        const revealed: string[] = [];
        const waited: string[] = [];
        const topNode = new GitHubVisibilityNode('Public', []);

        await revealTopGithubRepositoryNode({
            request: 1,
            currentRequest: () => 1,
            topNode: async () => topNode,
            reveal: async (node) => {
                revealed.push(String(node.label));
            },
            wait: async () => {
                waited.push('tick');
            },
        });

        assert.deepStrictEqual(waited, ['tick']);
        assert.deepStrictEqual(revealed, ['Public']);
    });

    test('does not reveal stale expanded tree requests', async () => {
        let requestedTopNode = false;
        let revealed = false;

        await revealTopGithubRepositoryNode({
            request: 1,
            currentRequest: () => 2,
            topNode: async () => {
                requestedTopNode = true;
                return new GitHubVisibilityNode('Public', []);
            },
            reveal: async () => {
                revealed = true;
            },
            wait: async () => undefined,
        });

        assert.strictEqual(requestedTopNode, false);
        assert.strictEqual(revealed, false);
    });

    test('retries current expanded tree reveal resolve races once', async () => {
        const revealed: string[] = [];
        let attempts = 0;

        await revealTopGithubRepositoryNode({
            request: 1,
            currentRequest: () => 1,
            topNode: async () => new GitHubVisibilityNode('Public', []),
            reveal: async (node) => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('Cannot resolve tree item for element 1/github-visibility:public');
                }
                revealed.push(String(node.label));
            },
            wait: async () => undefined,
        });

        assert.strictEqual(attempts, 2);
        assert.deepStrictEqual(revealed, ['Public']);
    });

    test('synchronizes the complete remote snapshot and removes locally cached deleted repositories', async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({
                token: 'secret',
                user: 'octocat',
                futureRoot: true,
                repositories: [
                    storedRepository(1, 'octocat', 'deleted-remotely'),
                    { ...storedRepository(2, 'octocat', 'existing'), futureRepository: true },
                ],
            }),
        );
        let request = 0;
        const client = new GitHubApiClient(async () => {
            request += 1;
            return request === 1
                ? { status: 200, headers: {}, body: JSON.stringify({ login: 'octocat' }) }
                : {
                      status: 200,
                      headers: {},
                      body: JSON.stringify([
                          repository(2, 'octocat', 'existing', true, 'TypeScript'),
                          repository(3, 'octocat', 'new-repository'),
                      ]),
                  };
        });
        const store = new GitHubConfigurationStore(file);
        const tree = new GitHubRepositoriesTree(
            store,
            client,
            new RepositoryStore(path.join(temporary, '.project-atlas', 'repos.json')),
        );

        assert.strictEqual(await tree.synchronize(), 2);

        assert.deepStrictEqual(
            (await store.repositories()).map(({ id, name, private: isPrivate }) => ({ id, name, isPrivate })),
            [
                { id: 2, name: 'existing', isPrivate: true },
                { id: 3, name: 'new-repository', isPrivate: false },
            ],
        );
        const source = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
        assert.strictEqual(source.futureRoot, true);
        assert.deepStrictEqual(
            (source.repositories as Array<Record<string, unknown>>).map(({ id }) => id),
            [2, 3],
        );
        assert.strictEqual((source.repositories as Array<Record<string, unknown>>)[0]?.futureRepository, true);
        assert.strictEqual(request, 2);
    });

    test('opens only after two clicks on the same repository', () => {
        const tracker = new DoubleClickTracker(500);
        assert.strictEqual(tracker.register('one', 1_000), false);
        assert.strictEqual(tracker.register('one', 1_400), true);
        assert.strictEqual(tracker.register('one', 2_000), false);
        assert.strictEqual(tracker.register('two', 2_100), false);
        assert.strictEqual(tracker.register('one', 2_200), false);
        assert.strictEqual(tracker.register('one', 2_800), false);
    });
});

function repository(
    id: number,
    owner: string,
    name: string,
    isPrivate = false,
    language?: string,
): Record<string, unknown> {
    return {
        id,
        name,
        full_name: `${owner}/${name}`,
        owner: { login: owner },
        description: `${name} description`,
        html_url: `https://github.com/${owner}/${name}`,
        ssh_url: `git@github.com:${owner}/${name}.git`,
        clone_url: `https://github.com/${owner}/${name}.git`,
        private: isPrivate,
        archived: false,
        fork: false,
        ...(language === undefined ? {} : { language }),
        updated_at: '2026-09-11T00:00:00Z',
    };
}

function storedRepository(
    id: number,
    owner: string,
    name: string,
    isPrivate = false,
    language?: string,
): Record<string, unknown> {
    return {
        id,
        name,
        fullName: `${owner}/${name}`,
        owner,
        description: `${name} description`,
        htmlUrl: `https://github.com/${owner}/${name}`,
        sshUrl: `git@github.com:${owner}/${name}.git`,
        cloneUrl: `https://github.com/${owner}/${name}.git`,
        private: isPrivate,
        archived: false,
        fork: false,
        ...(language === undefined ? {} : { language }),
        updatedAt: '2026-09-11T00:00:00Z',
    };
}
