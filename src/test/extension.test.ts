import * as assert from 'assert';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureCommonCommandsFile } from '../features/commonCommands/commonCommandStore';
import { ensureGitMessagesFile } from '../features/gitMessages/gitMessageStore';

suite('Default configuration data safety', () => {
    let temporary: string;
    setup(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'project-atlas-default-config-test-'));
    });
    teardown(async () => fs.rm(temporary, { recursive: true, force: true }));

    for (const [name, initialize, key] of [
        ['commoncmd.json', ensureCommonCommandsFile, 'commands'],
        ['gitmessage.json', ensureGitMessagesFile, 'messages'],
    ] as const) {
        test(`${name} preserves existing content, including empty or corrupt files`, async () => {
            const file = path.join(temporary, name);
            for (const contents of ['', '{invalid json', JSON.stringify({ [key]: [], future: true })]) {
                await fs.writeFile(file, contents);
                await initialize(file);
                assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
            }
        });

        test(`${name} supports repeated and concurrent initialization`, async () => {
            const file = path.join(temporary, name);
            await Promise.all([initialize(file), initialize(file)]);
            const contents = await fs.readFile(file, 'utf8');
            assert.ok(JSON.parse(contents)[key].length > 0);
            await initialize(file);
            assert.strictEqual(await fs.readFile(file, 'utf8'), contents);
        });
    }
});

suite('Extension', () => {
    test('registers contributed commands', async () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        await extension.activate();
        const commands = new Set(await vscode.commands.getCommands(true));
        for (const command of [
            'aicode.selectGroup',
            'aicode.createGroup',
            'aicode.renameGroup',
            'aicode.duplicateGroup',
            'aicode.deleteGroup',
            'aicode.openConfig',
            'aicode.addToContext',
            'aicode.removeFromContext',
            'aicode.addMissingFiles',
            'aicode.copyMarkdown',
            'aicode.copyFileList',
            'aicode.copyRelativePath',
            'aicode.addToTerminal',
            'aicode.refresh',
            'aicode.expandAll',
            'aicode.collapseAll',
            'aicode.showEditorIndicator',
            'aicode.hideEditorIndicator',
            'aicode.compareBranches',
            'aicode.compareBranchesWithoutFetch',
            'aicode.refreshCompareResults',
            'aicode.clearCompareResults',
            'aicode.openCompareResult',
            'project-atlas.updatePackageVersion',
            'aicode.createOrUpdateChangelog',
            'project-atlas.add',
            'project-atlas.saveCurrent',
            'project-atlas.search',
            'project-atlas.filterByTag',
            'project-atlas.openCurrentWindow',
            'project-atlas.openNewWindow',
            'project-atlas.delete',
            'project-atlas.createReleaseTag',
            'project-atlas.openRepositoryHome',
            'project-atlas.openCurrentBranch',
            'project-atlas.openSelectedDirectory',
            'project-atlas.openSelectedFile',
            'project-atlas.copyRemoteUrl',
            'project-atlas.insertCommonCommand',
            'project-atlas.editCommonCommands',
            'project-atlas.addTerminalSelectionToCommonCommand',
            'project-atlas.selectGitMessage',
            'project-atlas.editGitMessages',
            'project-atlas.deleteRepository',
            'project-atlas.repositoryViewTAGS',
            'project-atlas.repositoryViewGROUPS',
            'project-atlas.repositoryViewHOSTS',
            'project-atlas.editRepositoryTags',
            'project-atlas.cloneRepository',
            'project-atlas.copyGithubRepositorySshUrl',
            'project-atlas.addGithubRepositoryToRepos',
            'project-atlas.searchGithubRepositories',
            'project-atlas.expandGithubRepositories',
            'project-atlas.collapseGithubRepositories',
            'project-atlas.openSettings',
        ]) {
            assert.ok(commands.has(command), `Expected command to be registered: ${command}`);
        }
    });

    test('contributes only interactive commands to the Command Palette', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const manifest = extension.packageJSON as {
            contributes: {
                commands: Array<{ command: string; category?: string }>;
                menus: { commandPalette: Array<{ command: string; when?: string }> };
            };
        };
        const hiddenCommands = new Set(
            manifest.contributes.menus.commandPalette
                .filter(({ when }) => when === 'false')
                .map(({ command }) => command),
        );
        const paletteCommands = manifest.contributes.commands.filter(({ command }) => !hiddenCommands.has(command));
        assert.deepStrictEqual(
            paletteCommands.map(({ command }) => command),
            [
                'aicode.selectGroup',
                'aicode.createGroup',
                'aicode.openConfig',
                'aicode.copyMarkdown',
                'aicode.copyFileList',
                'aicode.compareBranches',
                'project-atlas.updatePackageVersion',
                'project-atlas.editGitMessages',
                'project-atlas.editCommonCommands',
                'project-atlas.insertCommonCommand',
                'project-atlas.createReleaseTag',
                'project-atlas.openRepositoryHome',
                'project-atlas.openCurrentBranch',
                'project-atlas.copyRemoteUrl',
                'project-atlas.search',
                'project-atlas.saveCurrent',
                'project-atlas.add',
                'project-atlas.saveCurrentRepository',
            ],
        );
        assert.strictEqual(paletteCommands[0]?.category, 'AICode');
        assert.strictEqual(paletteCommands[1]?.category, 'AICode');
        assert.strictEqual(paletteCommands[2]?.category, 'AICode');
    });

    test('shows the package version command for a single workspace folder', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commandPalette = extension.packageJSON.contributes.menus.commandPalette as Array<{
            command: string;
            when?: string;
        }>;
        assert.deepStrictEqual(
            commandPalette.find(({ command }) => command === 'project-atlas.updatePackageVersion'),
            {
                command: 'project-atlas.updatePackageVersion',
                when: 'workspaceFolderCount == 1',
            },
        );
    });

    test('contributes a standard extension icon', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.strictEqual(extension.packageJSON.icon, 'resources/project-atlas.png');
    });

    test('contributes Project Atlas settings', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.deepStrictEqual(extension.packageJSON.contributes.configuration, {
            title: 'Project Atlas',
            properties: {
                'projectAtlas.github.httpProxy': {
                    type: 'string',
                    default: 'http://127.0.0.1:1087',
                    description: 'HTTP or HTTPS proxy URL used when GitHub proxy is enabled.',
                    order: 2,
                },
                'projectAtlas.github.socketProxy': {
                    type: 'string',
                    default: 'socks5://127.0.0.1:1086',
                    description: 'SOCKS proxy URL used for socket-based requests and SSH clone connections.',
                    order: 3,
                },
                'projectAtlas.github.proxyEnabled': {
                    type: 'boolean',
                    default: false,
                    description: 'Use the configured proxy for GitHub repository refreshes and clone operations.',
                    order: 4,
                },
                'projectAtlas.github.token': {
                    type: 'string',
                    default: '',
                    description: 'GitHub personal access token used for repository refreshes and private clones.',
                    order: 5,
                },
                'projectAtlas.github.user': {
                    type: 'string',
                    default: '',
                    description: 'GitHub username that owns the configured personal access token.',
                    order: 6,
                },
            },
        });
    });

    test('associates configuration JSON schemas by file name', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        assert.deepStrictEqual(extension.packageJSON.contributes.jsonValidation, [
            {
                fileMatch: '**/.project-atlas/project.json',
                url: './schemas/project.schema.json',
            },
            {
                fileMatch: '**/gitmessage.json',
                url: './schemas/gitmessage.schema.json',
            },
            {
                fileMatch: '**/commoncmd.json',
                url: './schemas/commoncmd.schema.json',
            },
            {
                fileMatch: '**/.aicode.json',
                url: './schemas/aicode.schema.json',
            },
            {
                fileMatch: '**/.project-atlas/repos.json',
                url: './schemas/repos.schema.json',
            },
            {
                fileMatch: '**/.project-atlas/github.json',
                url: './schemas/github.schema.json',
            },
        ]);
    });

    test('groups AICode views separately from Projects', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const contributes = extension.packageJSON.contributes as {
            viewsContainers: { activitybar: Array<{ id: string; title: string; icon: string }> };
            views: Record<string, Array<{ id: string; name: string; icon?: string; when?: string }>>;
            viewsWelcome: Array<{ view: string; contents: string; when?: string }>;
        };
        assert.deepStrictEqual(contributes.viewsContainers.activitybar, [
            { id: 'projectAtlasTemplates', title: 'Project Atlas: Templates', icon: 'resources/templates.svg' },
            { id: 'aicode', title: 'Project Atlas: AICode', icon: 'resources/aicode-context.svg' },
            { id: 'projectAtlas', title: 'Project Atlas', icon: 'resources/project-atlas.svg' },
        ]);
        assert.deepStrictEqual(contributes.views.aicode, [
            { id: 'aicode.contextFiles', name: 'Context Files' },
            { id: 'aicode.compareResults', name: 'Compare Results' },
        ]);
        assert.deepStrictEqual(contributes.views.projectAtlasTemplates, [
            { id: 'projectAtlas.commonCommands', name: 'Common Commands' },
            { id: 'projectAtlas.gitMessages', name: 'Git Messages' },
        ]);
        assert.deepStrictEqual(contributes.views.projectAtlas, [
            { id: 'projectAtlas.projects', name: 'Projects', icon: 'resources/project-atlas.svg' },
            { id: 'projectAtlas.repos', name: 'Git Repositories' },
            { id: 'projectAtlas.githubRepos', name: 'GitHub Repositories' },
        ]);
        assert.deepStrictEqual(
            contributes.viewsWelcome.find(({ view }) => view === 'aicode.compareResults'),
            {
                view: 'aicode.compareResults',
                contents:
                    'No comparison results.\n[Compare Context Branches](command:aicode.compareBranches)\n[Compare Without Fetch](command:aicode.compareBranchesWithoutFetch)',
                when: '!aicode.compareResultsAvailable',
            },
        );
    });

    test('shows comparison actions only in Compare Results', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            submenu?: string;
            when?: string;
        }>;
        const entries = titleMenu.filter(({ command }) => command === 'aicode.compareBranches');
        assert.deepStrictEqual(entries, [
            {
                command: 'aicode.compareBranches',
                when: 'view == aicode.compareResults',
                group: 'navigation@2',
            },
        ]);
        assert.deepStrictEqual(
            titleMenu.find(({ command }) => command === 'aicode.refreshCompareResults'),
            {
                command: 'aicode.refreshCompareResults',
                when: 'view == aicode.compareResults && aicode.compareResultsAvailable',
                group: 'navigation@1',
            },
        );
    });

    test('shows Save Current Git Repository immediately after the Projects refresh action', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        const projectActions = titleMenu
            .filter(({ when, group }) => when === 'view == projectAtlas.projects' && group?.startsWith('navigation@'))
            .sort((left, right) => left.group!.localeCompare(right.group!, undefined, { numeric: true }));
        const refreshIndex = projectActions.findIndex(({ command }) => command === 'project-atlas.refresh');
        assert.strictEqual(projectActions[refreshIndex]?.group, 'navigation@7');
        assert.strictEqual(projectActions[refreshIndex + 1]?.command, 'project-atlas.saveCurrentRepository');
        assert.strictEqual(projectActions[refreshIndex + 1]?.group, 'navigation@8');
        assert.strictEqual(
            titleMenu.some(
                ({ command, when }) =>
                    command === 'project-atlas.saveCurrentRepository' && when === 'view == aicode.contextFiles',
            ),
            false,
        );
        const commands = extension.packageJSON.contributes.commands as Array<{ command: string; icon?: string }>;
        assert.strictEqual(
            commands.find(({ command }) => command === 'project-atlas.saveCurrentRepository')?.icon,
            '$(repo-push)',
        );
    });

    test('shows repository refresh and data file actions in Git Repositories', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            titleMenu.filter(({ when }) => when === 'view == projectAtlas.repos'),
            [
                {
                    command: 'project-atlas.refreshRepositories',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.openRepositoryDataFile',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@2',
                },
                {
                    command: 'project-atlas.addRepository',
                    when: 'view == projectAtlas.repos',
                    group: 'navigation@1',
                },
                {
                    submenu: 'projectAtlas.repositoryViewMenu',
                    when: 'view == projectAtlas.repos',
                    group: 'view@1',
                },
            ],
        );
        assert.deepStrictEqual(extension.packageJSON.contributes.menus['projectAtlas.repositoryViewMenu'], [
            {
                command: 'project-atlas.repositoryViewTAGS',
                toggled: 'projectAtlas.repositoryViewMode == TAGS',
                group: 'mode@1',
            },
            {
                command: 'project-atlas.repositoryViewGROUPS',
                toggled: 'projectAtlas.repositoryViewMode == GROUPS',
                group: 'mode@2',
            },
            {
                command: 'project-atlas.repositoryViewHOSTS',
                toggled: 'projectAtlas.repositoryViewMode == HOSTS',
                group: 'mode@3',
            },
        ]);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            enablement?: string;
        }>;
        assert.deepStrictEqual(
            commands
                .filter(({ command }) => command.startsWith('project-atlas.repositoryView'))
                .map(({ command, enablement }) => ({ command, enablement })),
            [
                {
                    command: 'project-atlas.repositoryViewTAGS',
                    enablement: 'projectAtlas.repositoryViewMode != TAGS',
                },
                {
                    command: 'project-atlas.repositoryViewGROUPS',
                    enablement: 'projectAtlas.repositoryViewMode != GROUPS',
                },
                {
                    command: 'project-atlas.repositoryViewHOSTS',
                    enablement: 'projectAtlas.repositoryViewMode != HOSTS',
                },
            ],
        );
    });

    test('shows repository actions as inline icon buttons', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.deleteRepository'),
            {
                command: 'project-atlas.deleteRepository',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'inline@3',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.editRepositoryTags'),
            {
                command: 'project-atlas.editRepositoryTags',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'inline@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.cloneRepository'),
            {
                command: 'project-atlas.cloneRepository',
                when: 'view == projectAtlas.repos && viewItem == repository',
                group: 'inline@2',
            },
        );
    });

    test('shows GitHub refresh, configuration, and clone actions in GitHub Repositories', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            enablement?: string;
        }>;
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.refreshGithubRepositories'),
            {
                command: 'project-atlas.refreshGithubRepositories',
                title: 'Refresh GitHub Repositories',
                category: 'Project Atlas',
                icon: '$(refresh)',
                enablement: '!projectAtlas.githubRepositoriesRefreshing',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.openSettings'),
            {
                command: 'project-atlas.openSettings',
                title: 'Open Project Atlas Settings',
                category: 'Project Atlas',
                icon: '$(settings-gear)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.searchGithubRepositories'),
            {
                command: 'project-atlas.searchGithubRepositories',
                title: 'Search GitHub Repositories',
                category: 'Project Atlas',
                icon: '$(search)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.collapseGithubRepositories'),
            {
                command: 'project-atlas.collapseGithubRepositories',
                title: 'Collapse All',
                category: 'Project Atlas',
                icon: '$(collapse-all)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.expandGithubRepositories'),
            {
                command: 'project-atlas.expandGithubRepositories',
                title: 'Expand All',
                category: 'Project Atlas',
                icon: '$(expand-all)',
            },
        );
        assert.deepStrictEqual(
            commands.find(({ command }) => command === 'project-atlas.addGithubRepositoryToRepos'),
            {
                command: 'project-atlas.addGithubRepositoryToRepos',
                title: 'Add to Git Repositories',
                category: 'Project Atlas',
                icon: '$(add)',
                enablement: 'viewItem == githubRepositoryAddable',
            },
        );
        const titleMenu = extension.packageJSON.contributes.menus['view/title'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            titleMenu.filter(({ when }) => when === 'view == projectAtlas.githubRepos'),
            [
                {
                    command: 'project-atlas.searchGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@1',
                },
                {
                    command: 'project-atlas.openGithubConfig',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@2',
                },
                {
                    command: 'project-atlas.expandGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@3',
                },
                {
                    command: 'project-atlas.collapseGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@4',
                },
                {
                    command: 'project-atlas.refreshGithubRepositories',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@5',
                },
                {
                    command: 'project-atlas.openSettings',
                    when: 'view == projectAtlas.githubRepos',
                    group: 'navigation@6',
                },
            ],
        );
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command?: string;
            when?: string;
            group?: string;
        }>;
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.cloneGithubRepository'),
            {
                command: 'project-atlas.cloneGithubRepository',
                when: 'view == projectAtlas.githubRepos && viewItem =~ /^githubRepository/',
                group: 'inline@3',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.copyGithubRepositorySshUrl'),
            {
                command: 'project-atlas.copyGithubRepositorySshUrl',
                when: 'view == projectAtlas.githubRepos && viewItem =~ /^githubRepository/',
                group: 'inline@2',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.addGithubRepositoryToRepos'),
            {
                command: 'project-atlas.addGithubRepositoryToRepos',
                when: 'view == projectAtlas.githubRepos && viewItem =~ /^githubRepository/',
                group: 'inline@1',
            },
        );
        assert.deepStrictEqual(
            itemMenu.find(({ command }) => command === 'project-atlas.openGithubRepository'),
            {
                command: 'project-atlas.openGithubRepository',
                when: 'view == projectAtlas.githubRepos && viewItem =~ /^githubRepository/',
                group: 'inline@4',
            },
        );
    });

    test('uses clear icons for changelog preview actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            icon?: string;
            enablement?: string;
        }>;
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.confirmChangelogPreview')?.icon,
            '$(check)',
        );
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.cancelChangelogPreview')?.icon,
            '$(close)',
        );
    });

    test('shows context group actions inline instead of in the context menu', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const commands = extension.packageJSON.contributes.commands as Array<{
            command: string;
            icon?: string;
            enablement?: string;
        }>;
        const itemMenu = extension.packageJSON.contributes.menus['view/item/context'] as Array<{
            command: string;
            when?: string;
            group?: string;
        }>;
        const expected = [
            ['aicode.createGroup', '$(add)', 'inline@1'],
            ['aicode.renameGroup', '$(edit)', 'inline@2'],
            ['aicode.duplicateGroup', '$(files)', 'inline@3'],
            ['aicode.deleteGroup', '$(trash)', 'inline@4'],
        ];
        const groupWhen =
            'view == aicode.contextFiles && (viewItem == aicode.group || viewItem == aicode.group.default)';
        for (const [command, icon, group] of expected) {
            assert.strictEqual(commands.find((entry) => entry.command === command)?.icon, icon);
            assert.deepStrictEqual(
                itemMenu.find((entry) => entry.command === command),
                {
                    command,
                    when: groupWhen,
                    group,
                },
            );
        }
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.renameGroup')?.enablement,
            'viewItem != aicode.group.default',
        );
        assert.strictEqual(
            commands.find(({ command }) => command === 'aicode.deleteGroup')?.enablement,
            'viewItem != aicode.group.default',
        );
    });

    test('contributes mutually exclusive editor indicator submenu actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const contributes = extension.packageJSON.contributes as {
            commands: Array<{ command: string; enablement?: string }>;
            submenus: Array<{ id: string; label: string }>;
            menus: Record<string, Array<{ command?: string; submenu?: string; when?: string; toggled?: string }>>;
        };
        assert.deepStrictEqual(
            contributes.submenus.find(({ id }) => id === 'aicode.editorIndicator'),
            { id: 'aicode.editorIndicator', label: 'Editor Indicator' },
        );
        assert.deepStrictEqual(
            contributes.menus['view/title']!.find(({ submenu }) => submenu === 'aicode.editorIndicator'),
            {
                submenu: 'aicode.editorIndicator',
                when: 'view == aicode.contextFiles',
                group: 'aicode@8',
            },
        );
        assert.deepStrictEqual(contributes.menus['aicode.editorIndicator'], [
            { command: 'aicode.showEditorIndicator', toggled: 'aicode.editorIndicatorVisible' },
            { command: 'aicode.hideEditorIndicator', toggled: '!aicode.editorIndicatorVisible' },
        ]);
        assert.strictEqual(
            contributes.commands.find(({ command }) => command === 'aicode.showEditorIndicator')?.enablement,
            '!aicode.editorIndicatorVisible',
        );
        assert.strictEqual(
            contributes.commands.find(({ command }) => command === 'aicode.hideEditorIndicator')?.enablement,
            'aicode.editorIndicatorVisible',
        );
    });

    test('contributes mutually exclusive primary Explorer AICode actions', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const explorerActions = extension.packageJSON.contributes.menus['aicode.explorerActions'] as Array<{
            command: string;
            when?: string;
            group?: string;
        }>;

        assert.deepStrictEqual(
            explorerActions.filter(({ command }) =>
                ['aicode.addToContext', 'aicode.removeFromContext'].includes(command),
            ),
            [
                {
                    command: 'aicode.addToContext',
                    when: 'resource not in aicode.contextResources',
                    group: 'aicode@1',
                },
                {
                    command: 'aicode.removeFromContext',
                    when: 'resource in aicode.contextResources',
                    group: 'aicode@1',
                },
            ],
        );
    });

    test('disables Save Current Project when the current project is already saved', () => {
        const extension = vscode.extensions.getExtension('billchiu.project-atlas-vs');
        assert.ok(extension);
        const command = (
            extension.packageJSON.contributes.commands as Array<{
                command: string;
                enablement?: string;
            }>
        ).find(({ command }) => command === 'project-atlas.saveCurrent');
        assert.strictEqual(command?.enablement, '!projectAtlas.currentProjectSaved');
    });
});
