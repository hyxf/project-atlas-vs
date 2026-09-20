import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectItem } from '../features/projectManagement/model';
import {
    cleanupCancelledClone,
    cloneArgs,
    cloneGitEnvironment,
    cloneProxyEnvironment,
    ensureDefaultCloneParent,
    resolveCloneTarget,
} from '../features/repositoryManagement/cloneService';
import { syncProjectRepositories } from '../features/repositoryManagement/repositorySyncService';
import {
    parseRepositoryHost,
    parseRepositoryIdentity,
    repositoryIdentityKey,
} from '../features/repositoryManagement/repositoryUrl';
import { RepositoryStore } from '../features/repositoryManagement/store';
import { cleanRepositoryTags } from '../features/repositoryManagement/tagPicker';
import {
    RepositoriesTree,
    RepositoryDescriptionNode,
    RepositoryGroupNode,
    RepositoryHostNode,
    RepositoryTagNode,
} from '../features/repositoryManagement/tree';

suite('Repository Management', () => {
    let temporary: string;
    let file: string;
    let store: RepositoryStore;

    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-repositories-test-'));
        file = path.join(temporary, '.project-atlas', 'repos.json');
        store = new RepositoryStore(file);
    });

    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('parses SSH repository identities and rejects other protocols', () => {
        assert.deepStrictEqual(parseRepositoryIdentity('git@github.com:userA/my-frontend.git'), {
            group: 'userA',
            name: 'my-frontend',
        });
        assert.deepStrictEqual(parseRepositoryIdentity('ssh://git@gitlab.com:2222/team/subgroup/service.git'), {
            group: 'team/subgroup',
            name: 'service',
        });
        assert.strictEqual(parseRepositoryHost('git@GitLab.com:team/service.git'), 'gitlab.com');
        assert.strictEqual(
            repositoryIdentityKey('git@GITHUB.com:userA/my-frontend.git'),
            repositoryIdentityKey('ssh://git@github.com/userA/my-frontend'),
        );
        assert.notStrictEqual(
            repositoryIdentityKey('git@github.com:userA/my-frontend.git'),
            repositoryIdentityKey('ssh://git@github.com:2222/userA/my-frontend.git'),
        );
        for (const unsupported of [
            'https://github.com/userA/my-frontend.git',
            'git://github.com/userA/my-frontend.git',
            'file:///tmp/userA/my-frontend.git',
            'ftp://github.com/userA/my-frontend.git',
            '/tmp/userA/my-frontend.git',
            'git@[2001:db8::1]:userA/my-frontend.git',
            'ssh://git@[2001:db8::1]/userA/my-frontend.git',
        ]) {
            assert.strictEqual(parseRepositoryIdentity(unsupported), undefined);
            assert.strictEqual(parseRepositoryHost(unsupported), undefined);
        }
    });

    test('cleans, deduplicates, and sorts selected and newly created tags', () => {
        assert.deepStrictEqual(cleanRepositoryTags([' work ', 'Vue', 'vue', '', 'frontend']), [
            'frontend',
            'Vue',
            'work',
        ]);
    });

    test('creates version 1 storage and does not modify an existing URL', async () => {
        const url = 'git@github.com:userA/my-frontend.git';
        assert.strictEqual(await store.addIfMissing({ group: 'userA', name: 'my-frontend', url, tags: [] }), 'added');
        const created = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(created.version, 1);
        created.repos[0].tags = ['frontend', 'vue'];
        created.repos[0].description = 'Main UI';
        created.repos[0].future = true;
        created.futureRoot = true;
        await fs.writeFile(file, JSON.stringify(created));
        const before = await fs.readFile(file, 'utf8');

        assert.strictEqual(await store.addIfMissing({ group: 'renamed', name: 'ui', url, tags: [] }), 'existing');
        assert.strictEqual(await fs.readFile(file, 'utf8'), before);
        const updated = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(updated.version, 1);
        assert.deepStrictEqual(updated.repos[0].tags, ['frontend', 'vue']);
        assert.strictEqual(updated.repos[0].description, 'Main UI');
        assert.strictEqual(updated.repos[0].future, true);
        assert.strictEqual(updated.futureRoot, true);
        assert.strictEqual(updated.repos[0].group, 'userA');
        assert.strictEqual(updated.repos[0].name, 'my-frontend');
        assert.strictEqual(updated.repos.length, 1);
    });

    test('does not add the same SSH repository under an equivalent URL', async () => {
        await store.addIfMissing({
            group: 'userA',
            name: 'my-frontend',
            url: 'git@github.com:userA/my-frontend.git',
            tags: ['keep'],
        });
        assert.strictEqual(
            await store.addIfMissing({
                group: 'userA',
                name: 'my-frontend',
                url: 'ssh://git@GITHUB.com/userA/my-frontend',
                tags: ['replace'],
            }),
            'existing',
        );
        const repositories = await store.repositories();
        assert.strictEqual(repositories.length, 1);
        assert.deepStrictEqual(repositories[0]?.tags, ['keep']);
    });

    test('refuses to overwrite malformed JSON', async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, '{ broken');
        await assert.rejects(
            () => store.addIfMissing({ group: 'userA', name: 'repo', url: 'git@example.com:userA/repo.git', tags: [] }),
            /Could not read/,
        );
        assert.strictEqual(await fs.readFile(file, 'utf8'), '{ broken');
    });

    test('creates an editable version 1 data file when missing', async () => {
        assert.strictEqual(await store.ensureFile(), file);
        assert.deepStrictEqual(JSON.parse(await fs.readFile(file, 'utf8')), { version: 1, repos: [] });
    });

    test('persists the selected repository view mode in repos.json', async () => {
        await store.ensureFile();
        assert.strictEqual(await store.viewMode(), 'TAGS');
        await store.replaceViewMode('HOSTS');
        assert.strictEqual(await store.viewMode(), 'HOSTS');
        const written = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.strictEqual(written.version, 1);
        assert.deepStrictEqual(written.settings, { viewMode: 'HOSTS' });

        const reloaded = new RepositoryStore(file);
        assert.strictEqual(await reloaded.viewMode(), 'HOSTS');
    });

    test('accepts missing or empty clone targets and rejects unsafe or non-empty targets', async () => {
        assert.strictEqual(await resolveCloneTarget(temporary, 'new-repo'), path.join(temporary, 'new-repo'));
        const empty = path.join(temporary, 'empty');
        await fs.mkdir(empty);
        assert.strictEqual(await resolveCloneTarget(temporary, 'empty'), empty);
        const occupied = path.join(temporary, 'occupied');
        await fs.mkdir(occupied);
        await fs.writeFile(path.join(occupied, 'README.md'), 'occupied');
        await assert.rejects(() => resolveCloneTarget(temporary, 'occupied'), /not empty/);
        await assert.rejects(() => resolveCloneTarget(temporary, '../outside'), /cannot be used/);
    });

    test('creates and returns the default clone parent directory', async () => {
        const directory = path.join(temporary, 'ProjectAtlas');
        assert.strictEqual(await ensureDefaultCloneParent(directory), directory);
        assert.strictEqual((await fs.stat(directory)).isDirectory(), true);
        assert.strictEqual(await ensureDefaultCloneParent(directory), directory);
    });

    test('adds Git proxy configuration to clone arguments and environment', () => {
        const proxy = { enabled: true, url: 'http://127.0.0.1:1087', socketUrl: 'socks5://127.0.0.1:1086' };
        assert.deepStrictEqual(cloneArgs('https://github.com/user/repo.git', '/tmp/repo', proxy), [
            '-c',
            'http.proxy=http://127.0.0.1:1087',
            'clone',
            '--',
            'https://github.com/user/repo.git',
            '/tmp/repo',
        ]);
        assert.deepStrictEqual(
            cloneArgs('https://github.com/user/repo.git', '/tmp/repo', {
                enabled: true,
                socketUrl: 'socks5://127.0.0.1:1086',
            }),
            [
                '-c',
                'http.proxy=socks5://127.0.0.1:1086',
                'clone',
                '--',
                'https://github.com/user/repo.git',
                '/tmp/repo',
            ],
        );
        assert.deepStrictEqual(cloneProxyEnvironment(proxy), {
            HTTP_PROXY: 'http://127.0.0.1:1087',
            HTTPS_PROXY: 'http://127.0.0.1:1087',
            ALL_PROXY: 'http://127.0.0.1:1087',
            http_proxy: 'http://127.0.0.1:1087',
            https_proxy: 'http://127.0.0.1:1087',
            all_proxy: 'http://127.0.0.1:1087',
        });
        assert.deepStrictEqual(cloneArgs('git@github.com:user/repo.git', '/tmp/repo', { enabled: false }), [
            'clone',
            '--',
            'git@github.com:user/repo.git',
            '/tmp/repo',
        ]);
        assert.deepStrictEqual(cloneArgs('git@github.com:user/repo.git', '/tmp/repo', proxy), [
            '-c',
            'core.sshCommand=ssh -o ProxyCommand="nc -x 127.0.0.1:1086 -X 5 %h %p"',
            'clone',
            '--',
            'git@github.com:user/repo.git',
            '/tmp/repo',
        ]);
        assert.deepStrictEqual(cloneArgs('ssh://git@github.com/user/repo.git', '/tmp/repo', proxy), [
            '-c',
            'core.sshCommand=ssh -o ProxyCommand="nc -x 127.0.0.1:1086 -X 5 %h %p"',
            'clone',
            '--',
            'ssh://git@github.com/user/repo.git',
            '/tmp/repo',
        ]);
        assert.strictEqual(cloneProxyEnvironment({ enabled: false }), undefined);
        assert.deepStrictEqual(cloneGitEnvironment({ enabled: false }, 'basic secret'), {
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
            GIT_CONFIG_VALUE_0: 'AUTHORIZATION: basic secret',
        });
    });

    test('cleans partial clone data after cancellation and preserves a pre-existing target directory', async () => {
        const createdByClone = path.join(temporary, 'created-by-clone');
        await fs.mkdir(path.join(createdByClone, '.git'), { recursive: true });
        await fs.writeFile(path.join(createdByClone, 'partial.txt'), 'partial');
        assert.strictEqual(await cleanupCancelledClone(createdByClone, false), true);
        await assert.rejects(() => fs.stat(createdByClone), { code: 'ENOENT' });

        const existingEmptyTarget = path.join(temporary, 'existing-empty-target');
        await fs.mkdir(path.join(existingEmptyTarget, '.git'), { recursive: true });
        await fs.writeFile(path.join(existingEmptyTarget, 'partial.txt'), 'partial');
        assert.strictEqual(await cleanupCancelledClone(existingEmptyTarget, true), true);
        assert.deepStrictEqual(await fs.readdir(existingEmptyTarget), []);
    });

    test('removes only the repository matching the requested URL', async () => {
        const first = 'git@github.com:userA/first.git';
        const second = 'git@github.com:userB/second.git';
        await store.addIfMissing({ group: 'userA', name: 'first', url: first, tags: ['work'] });
        await store.addIfMissing({ group: 'userB', name: 'second', url: second, tags: [] });

        assert.strictEqual(await store.remove(first), true);
        assert.deepStrictEqual(
            (await store.repositories()).map(({ url }) => url),
            [second],
        );
        assert.strictEqual(await store.remove(first), false);
    });

    test('updates only repository tags and preserves unknown fields', async () => {
        const url = 'git@github.com:userA/repo.git';
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(
            file,
            JSON.stringify({
                version: 1,
                repos: [{ group: 'userA', name: 'repo', url, tags: ['old'], description: 'Keep', future: 42 }],
            }),
        );

        assert.strictEqual(await store.updateTags(url, ['new', 'work']), true);
        const written = JSON.parse(await fs.readFile(file, 'utf8'));
        assert.deepStrictEqual(written.repos[0].tags, ['new', 'work']);
        assert.strictEqual(written.repos[0].description, 'Keep');
        assert.strictEqual(written.repos[0].future, 42);
        assert.strictEqual(await store.updateTags('missing', []), false);
    });

    test('refreshes every project and reports added, existing, and failed counts', async () => {
        const existingUrl = 'git@github.com:userA/existing.git';
        await store.addIfMissing({ group: 'userA', name: 'existing', url: existingUrl, tags: ['keep'] });
        const projects = ['existing', 'new', 'missing', 'broken'].map(project);
        const result = await syncProjectRepositories(projects, store, async (item) => {
            if (item.name === 'existing') {
                return existingUrl;
            }
            if (item.name === 'new') {
                return 'git@github.com:userB/new.git';
            }
            if (item.name === 'broken') {
                throw new Error('Git failed');
            }
            return undefined;
        });
        assert.deepStrictEqual(result, { added: 1, existing: 1, failed: 2 });
        assert.strictEqual((await store.repositories()).length, 2);
        assert.deepStrictEqual((await store.repositories()).find(({ url }) => url === existingUrl)?.tags, ['keep']);
    });

    test('groups repositories under every tag and an expanded untagged node', async () => {
        await store.addIfMissing({
            group: 'userA',
            name: 'frontend',
            url: 'git@github.com:userA/frontend.git',
            tags: ['frontend', 'vue'],
        });
        await store.addIfMissing({
            group: 'userB',
            name: 'legacy',
            url: 'git@github.com:userB/legacy.git',
            tags: [],
        });
        const tree = new RepositoriesTree(store);
        const groups = (await tree.getChildren()) as RepositoryTagNode[];
        assert.deepStrictEqual(
            groups.map((group) => group.label),
            ['frontend', 'vue', 'untagged'],
        );
        assert.ok(groups.every((group) => group.collapsibleState === 2));
        assert.strictEqual((await tree.getChildren(groups[0])).length, 1);
        assert.strictEqual((await tree.getChildren(groups[1])).length, 1);
        assert.strictEqual((await tree.getChildren(groups[2])).length, 1);
    });

    test('shows a repository description as a child only when it has text', async () => {
        await store.addIfMissing({
            group: 'userA',
            name: 'documented',
            url: 'git@github.com:userA/documented.git',
            tags: ['work'],
            description: '  Main application repository  ',
        });
        await store.addIfMissing({
            group: 'userB',
            name: 'undocumented',
            url: 'git@github.com:userB/undocumented.git',
            tags: ['work'],
            description: '   ',
        });
        const tree = new RepositoriesTree(store);
        const tag = (await tree.getChildren())[0] as RepositoryTagNode;
        const repositories = await tree.getChildren(tag);
        const documented = repositories.find((node) => node.label === 'userA/documented')!;
        const undocumented = repositories.find((node) => node.label === 'userB/undocumented')!;

        assert.strictEqual(documented.description, undefined);
        assert.strictEqual(documented.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        const descriptionNodes = await tree.getChildren(documented);
        assert.strictEqual(descriptionNodes.length, 1);
        assert.ok(descriptionNodes[0] instanceof RepositoryDescriptionNode);
        assert.strictEqual(descriptionNodes[0].label, 'Main application repository');
        assert.strictEqual(await tree.getParent(descriptionNodes[0]), documented);
        assert.strictEqual(undocumented.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.deepStrictEqual(await tree.getChildren(undocumented), []);

        tree.expandAll();
        const expandedDocumented = (await tree.getChildren(tag)).find((node) => node.label === 'userA/documented')!;
        assert.strictEqual(expandedDocumented.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
        tree.collapseAll();
        const collapsedDocumented = (await tree.getChildren(tag)).find((node) => node.label === 'userA/documented')!;
        assert.strictEqual(collapsedDocumented.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
    });

    test('switches between tag, group, and domain trees with expanded group nodes', async () => {
        await store.addIfMissing({
            group: 'teamB',
            name: 'api',
            url: 'git@gitlab.com:teamB/api.git',
            tags: ['backend'],
        });
        await store.addIfMissing({
            group: 'teamA',
            name: 'web',
            url: 'git@github.com:teamA/web.git',
            tags: ['frontend'],
        });
        const tree = new RepositoriesTree(store);
        tree.setMode('GROUPS');
        const groups = (await tree.getChildren()) as RepositoryGroupNode[];
        assert.deepStrictEqual(
            groups.map(({ label }) => label),
            ['teamA', 'teamB'],
        );
        assert.ok(groups.every(({ collapsibleState }) => collapsibleState === 2));
        assert.strictEqual((await tree.getChildren(groups[0]))[0]?.label, 'web');
        tree.setMode('TAGS');
        assert.deepStrictEqual(
            (await tree.getChildren()).map(({ label }) => label),
            ['backend', 'frontend'],
        );
        tree.setMode('HOSTS');
        const hosts = (await tree.getChildren()) as RepositoryHostNode[];
        assert.deepStrictEqual(
            hosts.map(({ label }) => label),
            ['github.com', 'gitlab.com'],
        );
        assert.strictEqual((await tree.getChildren(hosts[0]))[0]?.label, 'teamA/web');
    });
});

function project(name: string): ProjectItem {
    return { id: name, name, path: `/projects/${name}`, tags: [], favorite: false, lastOpenedAt: null };
}
