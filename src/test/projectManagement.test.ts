import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { editProjectForm } from '../features/projectManagement/projectForm';
import { containsPath, duplicateDirectory, ProjectService } from '../features/projectManagement/service';
import { ProjectStore } from '../features/projectManagement/store';
import { parseUriList, ProjectsTree } from '../features/projectManagement/tree';

suite('Project Management', () => {
    let temporary: string;
    let store: ProjectStore;
    let service: ProjectService;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-project-management-test-'));
        store = new ProjectStore(path.join(temporary, 'data', 'project.json'));
        service = new ProjectService(store);
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    test('edits project details through the shared HTML form and preserves project metadata', async () => {
        const project = await service.save('Atlas', temporary, ['tools'], true);
        project.lastOpenedAt = 123;
        await service.update(project);
        await editProjectForm(
            project,
            async (values) => service.updateDetails(project.id, values),
            async (options) => {
                assert.strictEqual(options.title, 'Edit Project');
                assert.strictEqual(options.fields.find((field) => field.name === 'favorite')?.value, 'true');
                await options.save({ name: '  Renamed  ', tags: ' work, tools\nwork\n ', favorite: 'false' });
            },
        );
        const updated = (await service.projects(true))[0]!;
        assert.strictEqual(updated.name, 'Renamed');
        assert.deepStrictEqual(updated.tags, ['tools', 'work']);
        assert.strictEqual(updated.favorite, false);
        assert.strictEqual(updated.path, project.path);
        assert.strictEqual(updated.id, project.id);
        assert.strictEqual(updated.lastOpenedAt, 123);
    });

    test('cancelling the add form does not save a project', async () => {
        await editProjectForm(
            { id: '', name: 'Atlas', path: temporary, tags: [], favorite: false },
            async () => assert.fail('Cancel must not save'),
            async (options) => {
                assert.strictEqual(options.title, 'Add Project');
            },
        );
    });

    test('saves, normalizes, updates, searches, and sorts projects', async () => {
        const folder = path.join(temporary, 'project');
        await fs.mkdir(folder);
        const added = await service.save('  Atlas  ', path.join(folder, '..', 'project'), [' tools ', 'tools'], true);
        assert.strictEqual(added.name, 'Atlas');
        assert.deepStrictEqual(added.tags, ['tools']);
        const updated = await service.save('Atlas 2', folder, ['vscode'], false);
        assert.strictEqual(updated.id, added.id);
        assert.strictEqual((await service.projects()).length, 1);
        assert.strictEqual(service.search(await service.projects(), 'atlas vscode').length, 1);
    });

    test('preserves unknown JSON fields when writing', async () => {
        await fs.mkdir(path.dirname(store.file), { recursive: true });
        await fs.writeFile(store.file, JSON.stringify({ custom: 42, settings: { future: true }, projects: [] }));
        await service.save('One', temporary, [], false);
        const written = JSON.parse(await fs.readFile(store.file, 'utf8'));
        assert.strictEqual(written.custom, 42);
        assert.strictEqual(written.settings.future, true);
        assert.strictEqual(written.schemaVersion, 4);
    });

    test('persists the default project open mode in project.json', async () => {
        const settings = await store.settings();
        settings.defaultOpenMode = 'NEW_WINDOW';
        await store.replaceSettings(settings);
        assert.strictEqual(JSON.parse(await fs.readFile(store.file, 'utf8')).settings.defaultOpenMode, 'NEW_WINDOW');
        assert.strictEqual((await store.settings()).defaultOpenMode, 'NEW_WINDOW');
    });

    test('serializes concurrent project saves without losing projects', async () => {
        await Promise.all([
            service.save('One', path.join(temporary, 'one'), [], false),
            service.save('Two', path.join(temporary, 'two'), [], false),
            service.save('Three', path.join(temporary, 'three'), [], false),
        ]);
        assert.deepStrictEqual(
            (await service.projects()).map(({ name }) => name),
            ['One', 'Two', 'Three'],
        );
    });

    test('does not overwrite projects when file creation overlaps a save', async () => {
        await Promise.all([store.ensureFile(), service.save('One', path.join(temporary, 'one'), [], false)]);
        assert.deepStrictEqual(
            (await service.projects(true)).map(({ name }) => name),
            ['One'],
        );
    });

    test('rejects an empty project name during updates', async () => {
        const project = await service.save('One', temporary, [], false);
        await assert.rejects(() => service.update({ ...project, name: '   ' }), /must not be empty/);
    });

    test('removes persisted tag filter selections when settings are saved', async () => {
        await fs.mkdir(path.dirname(store.file), { recursive: true });
        await fs.writeFile(
            store.file,
            JSON.stringify({ settings: { selectedTagFilter: 'tools', selectedTagFilters: ['legacy'] }, projects: [] }),
        );
        assert.strictEqual('selectedTagFilters' in (await store.settings()), false);
        await store.replaceSettings(await store.settings());
        const written = JSON.parse(await fs.readFile(store.file, 'utf8'));
        assert.strictEqual(written.settings.selectedTagFilters, undefined);
        assert.strictEqual(written.settings.selectedTagFilter, undefined);
    });

    test('refuses to overwrite malformed JSON', async () => {
        await fs.mkdir(path.dirname(store.file), { recursive: true });
        await fs.writeFile(store.file, '{ broken');
        await assert.rejects(() => service.projects(), /Could not read/);
        await assert.rejects(() => service.save('Unsafe', temporary, [], false), /Could not read|could not be read/);
        assert.strictEqual(await fs.readFile(store.file, 'utf8'), '{ broken');
    });

    test('detects path containment without prefix false positives', () => {
        const parent = path.join(temporary, 'project');
        assert.strictEqual(containsPath(parent, parent), true);
        assert.strictEqual(containsPath(parent, path.join(parent, 'app')), true);
        assert.strictEqual(containsPath(parent, path.join(temporary, 'other')), false);
        assert.strictEqual(containsPath(parent, path.join(temporary, 'project-copy')), false);
    });

    test('duplicates a directory into the next available sibling', async () => {
        const source = path.join(temporary, 'project');
        await fs.mkdir(source);
        await fs.writeFile(path.join(source, 'README.md'), 'atlas');
        await fs.mkdir(`${source}-1`);
        const duplicate = await duplicateDirectory(source);
        assert.strictEqual(duplicate, `${source}-2`);
        assert.strictEqual(await fs.readFile(path.join(duplicate, 'README.md'), 'utf8'), 'atlas');
    });

    test('uses unique node ids and separates Untagged from a real tag', async () => {
        const first = await service.save('Multi', path.join(temporary, 'multi'), ['alpha', 'beta'], false);
        await service.save('Named Untagged', path.join(temporary, 'named'), ['Untagged'], false);
        await service.save('No Tags', path.join(temporary, 'none'), [], false);
        const settings = await store.settings();
        settings.selectedView = 'TAGS';
        await store.replaceSettings(settings);
        const tree = new ProjectsTree(service);
        const groups = await tree.getChildren();
        const untaggedGroups = groups.filter((group) => tree.getTreeItem(group).label === 'Untagged');
        assert.strictEqual(untaggedGroups.length, 2);
        const alpha = groups.find((group) => tree.getTreeItem(group).label === 'alpha');
        const beta = groups.find((group) => tree.getTreeItem(group).label === 'beta');
        assert.ok(alpha);
        assert.ok(beta);
        const alphaProject = (await tree.getChildren(alpha))[0];
        const betaProject = (await tree.getChildren(beta))[0];
        assert.ok(alphaProject);
        assert.ok(betaProject);
        assert.notStrictEqual(tree.getTreeItem(alphaProject).id, tree.getTreeItem(betaProject).id);
        assert.ok(String(tree.getTreeItem(alphaProject).id).endsWith(first.id));
        const untaggedChildren = await Promise.all(untaggedGroups.map((group) => tree.getChildren(group)));
        assert.deepStrictEqual(
            untaggedChildren.map((children) => children.map((child) => String(tree.getTreeItem(child).label))),
            [['Named Untagged'], ['No Tags']],
        );
    });

    test('keeps tag filter selections only in the current tree instance', async () => {
        await service.save('Alpha', path.join(temporary, 'alpha'), ['alpha'], false);
        await service.save('Beta', path.join(temporary, 'beta'), ['beta'], false);
        const settings = await store.settings();
        settings.selectedView = 'TAGS';
        await store.replaceSettings(settings);

        const filteredTree = new ProjectsTree(service);
        filteredTree.setTagFilters(['alpha']);
        assert.deepStrictEqual(
            (await filteredTree.getChildren()).map((node) => filteredTree.getTreeItem(node).label),
            ['alpha'],
        );
        const newTree = new ProjectsTree(service);
        assert.deepStrictEqual(
            (await newTree.getChildren()).map((node) => newTree.getTreeItem(node).label),
            ['alpha', 'beta'],
        );
        assert.strictEqual(
            (JSON.parse(await fs.readFile(store.file, 'utf8')).settings as Record<string, unknown>).selectedTagFilters,
            undefined,
        );
    });

    test('returns missing project nodes with a warning icon', async () => {
        await service.save('Missing', path.join(temporary, 'missing'), [], false);
        const tree = new ProjectsTree(service);
        const node = (await tree.getChildren())[0];
        assert.ok(node);
        assert.strictEqual((tree.getTreeItem(node).iconPath as { id?: string }).id, 'warning');
    });

    test('parses dropped URI lists and ignores comments, blank lines, and malformed URIs', () => {
        const first = path.join(temporary, 'first folder');
        const second = path.join(temporary, 'second');
        const uris = parseUriList(
            `# dragged folders\r\n${vscode.Uri.file(first)}\r\nnot a uri\r\n\r\n${vscode.Uri.file(second)}`,
        );
        assert.deepStrictEqual(
            uris.map((uri) => uri.fsPath),
            [first, second],
        );
    });

    test('treats a real directory and its symbolic link as the same project', async () => {
        const folder = path.join(temporary, 'real-project');
        const link = path.join(temporary, 'linked-project');
        await fs.mkdir(folder);
        await fs.symlink(folder, link, process.platform === 'win32' ? 'junction' : 'dir');

        const saved = await service.save('Real', folder, [], false);
        assert.strictEqual((await service.findByPath(link))?.id, saved.id);

        const updated = await service.save('Linked', link, ['linked'], true);
        assert.strictEqual(updated.id, saved.id);
        assert.strictEqual((await service.projects()).length, 1);
    });
});
