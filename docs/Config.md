# 配置审计结果

我按扩展设置声明、配置文件读写代码、VS Code 状态存储、Schema、README 和仓库内开发配置做了只读审计。配置的定义入口主要在 [package.json](/Users/seven/ProjectAtlas/project-atlas-vs/package.json:2698)，实际存取分散在 `src/features/` 下各功能模块。

## 1. 扩展设置与 VS Code 用户设置

扩展设置由 `package.json` 的 `contributes.configuration` 声明。VS Code 会将用户设置存放在其用户配置中；若写入工作区范围，则通常落在工作区的 `.vscode/settings.json`。**本仓库没有提交任何 Project Atlas 扩展设置**到自己的 `.vscode/settings.json`，但扩展代码会主动写入部分全局设置。

| 设置键                              |                    默认值 | 用途与实际读写位置                                                                                                                 |
| ----------------------------------- | ------------------------: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `projectAtlas.update.enabled`       |                    `true` | 控制更新检查是否启用；[updateFeature.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/update/updateFeature.ts:55)读取。 |
| `projectAtlas.update.autoCheck`     |                    `true` | 控制是否在启动后自动检查更新；同上。两项只有被改成非默认值时才需要保存在用户设置中。                                               |
| `projectAtlas.github.httpProxy`     |   `http://127.0.0.1:1087` | GitHub HTTP/HTTPS 代理地址；由 GitHub 设置与 `github.json` 同步逻辑读写。                                                          |
| `projectAtlas.github.socketProxy`   | `socks5://127.0.0.1:1086` | GitHub SOCKS 代理地址；同上。                                                                                                      |
| `projectAtlas.github.proxyEnabled`  |                   `false` | 是否为 GitHub 请求及克隆操作启用代理。                                                                                             |
| `projectAtlas.github.token`         |                  空字符串 | GitHub PAT；存入 VS Code 设置，同时会同步进 `github.json`。                                                                        |
| `projectAtlas.github.user`          |                  空字符串 | 与 token 对应的 GitHub 用户名；也同步进 `github.json`。                                                                            |
| `projectAtlas.templateBackup.files` |              5 个文件路径 | Settings Sync 备份文件清单。默认含 `npmfav.json`、`repos.json`、`aiprompts.json`、`commoncmd.json`、`gitmessage.json`。            |

GitHub 设置有**双向同步**：修改设置时写入 `~/.project-atlas/github.json`，文件变化时又会把数据同步回设置；相关代码在 [githubRepositoriesFeature.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/githubRepositories/githubRepositoriesFeature.ts:101) 和 [config.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/githubRepositories/config.ts:31)。因此，token 可能同时存在于 VS Code 用户设置和 `github.json`。修改任一处，都可能触发另一处同步。

代理列表和当前活动代理是两种设置：

- `~/.project-atlas/proxy.json` 存可选代理列表。
- 当前代理通过 [proxyFeature.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/proxy/proxyFeature.ts:210) 写入 VS Code **全局** `http.proxy`。
- 所以实际代理值可从 VS Code 全局 `http.proxy` 查看；它不等同于代理列表。

## 2. 用户主目录下的共享配置和数据

这些文件通过 `os.homedir()` 定位到当前系统用户的 `~/.project-atlas/`。与 README 所述的共享目录一致；多个 IDE 或扩展可以共用部分文件。

| 文件                                 | 用途                                                 | 定义/主要代码                                                                                                            | Schema                           |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `~/.project-atlas/project.json`      | 本地项目记录、标签、收藏、最近打开时间和项目视图设置 | [store.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/projectManagement/store.ts:40)                        | `schemas/project.schema.json`    |
| `~/.project-atlas/repos.json`        | 保存的 Git 仓库、分组、标签及视图偏好                | [store.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/repositoryManagement/store.ts:18)                     | `schemas/repos.schema.json`      |
| `~/.project-atlas/github.json`       | GitHub 用户、token、代理配置及仓库缓存               | [config.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/githubRepositories/config.ts:31)                     | `schemas/github.schema.json`     |
| `~/.project-atlas/github-stars.json` | GitHub Stars 仓库缓存                                | [starsStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/githubRepositories/starsStore.ts:15)             | **没有注册 JSON Schema**         |
| `~/.project-atlas/proxy.json`        | 可供选择的代理列表                                   | [proxyFeature.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/proxy/proxyFeature.ts:9)                       | `schemas/proxy.schema.json`      |
| `~/.project-atlas/npmfav.json`       | npm 包收藏                                           | [npmPackagesStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/npmPackages/npmPackagesStore.ts:18)        | `schemas/npmfav.schema.json`     |
| `~/.project-atlas/npmtrash.json`     | npm 依赖回收站记录                                   | 同上                                                                                                                     | **没有注册 JSON Schema**         |
| `~/.project-atlas/commoncmd.json`    | 常用命令及变量定义                                   | [commonCommandStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/commonCommands/commonCommandStore.ts:37) | `schemas/commoncmd.schema.json`  |
| `~/.project-atlas/gitmessage.json`   | Git 提交消息模板                                     | [gitMessageStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/gitMessages/gitMessageStore.ts:12)          | `schemas/gitmessage.schema.json` |
| `~/.project-atlas/aiprompts.json`    | AI 提示词模板                                        | [aiPromptStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/aiPrompts/aiPromptStore.ts:10)                | `schemas/aiprompts.schema.json`  |

这些 Schema 与关联规则在 `package.json` 的 `contributes.jsonValidation` 中配置。Schema 是编辑器辅助校验，不是所有文件都一定在创建时或运行时被强制校验。

**数据兼容性值得留意：**`github.json` 包含 token；代码会以 `0600` 权限写该文件，但 token 仍然是明文 JSON 内容。设置与文件双向同步意味着两处都需要保护。`github-stars.json` 和 `npmtrash.json` 有实际读写代码，但缺少 JSON Schema 关联；若期望它们也能获得编辑器校验，目前没有对应规则。

## 3. 工作区内配置

| 文件           | 位置/用途                                                                                                                          | 定义与 Schema                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.aicode.json` | 每个工作区根目录独立保存 AICode 分组、当前分组和相对路径；新配置默认 `Default` 空分组。                                            | [model.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/aicodeContext/model.ts:3)、[configRepository.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/aicodeContext/configRepository.ts:9)、`schemas/aicode.schema.json`    |
| `package.json` | 扩展运行时会把当前工作区 `package.json` 当作 npm 依赖来源，读写 dependencies / devDependencies；版本功能也读取或修改其 `version`。 | [npmPackagesStore.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/npmPackages/npmPackagesStore.ts:23)、[packageVersionCommand.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/packageVersion/packageVersionCommand.ts:62) |
| `.git/config`  | Git remote、分支等由 Git 仓库本身维护；扩展读取 remote URL 来构造在线仓库链接及发布目标。                                          | [repositoryResolver.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/gitRemote/repositoryResolver.ts)、[gitTagService.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/gitTagRelease/gitTagService.ts)                      |

本仓库的 `.aicode.json` 是**用户打开项目之后，在该项目根目录中使用的配置格式**，不是本扩展仓库当前列出的文件之一。`package.json` 和 `.git/config` 属于目标项目自己的配置，不是扩展用户设置。

## 4. VS Code 托管的状态

以下内容通过 VS Code `ExtensionContext` API 保存，不在仓库中作为独立 JSON 配置文件维护。VS Code 管理其具体存储位置；实际文件会随 VS Code 安装、用户数据目录和工作区不同而变。`globalStorageUri` 只被用于 changelog 预览文件，没有发现这里保存配置数据。

| VS Code 存储     | 键/内容                              | 持久化位置及行为                                                                                                                                                                                                   |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `globalState`    | `projectAtlas.update.lastCheckAt`    | 更新检查的上次时间；用于避免频繁自动检查。                                                                                                                                                                         |
| `globalState`    | `projectAtlas.update.ignoredVersion` | 用户忽略的更新版本。                                                                                                                                                                                               |
| `globalState`    | `projectAtlas.aiPromptsCollapsed`    | AI Prompts 视图中折叠的分组。                                                                                                                                                                                      |
| `globalState`    | `projectAtlas.templateBackup.v1`     | 配置文件备份内容、备份时间；[templateBackupService.ts](/Users/seven/ProjectAtlas/project-atlas-vs/src/features/templateBackup/templateBackupService.ts:35)通过 `setKeysForSync` 将此键加入 VS Code Settings Sync。 |
| `workspaceState` | `aicode.indicator.<workspace URI>`   | AICode 指示器是否显示，按工作区和上下文分组区分。                                                                                                                                                                  |
| `workspaceState` | `gitRemote.platform.<…>`             | 为远程仓库记录用户选择的托管平台，避免后续重复选择。                                                                                                                                                               |

`globalState` 中只有模板备份键显式加入 Settings Sync；不能据此认为其他 `globalState` 内容也会同步到其他设备。对于 VS Code 用户设置存储位置，建议在 VS Code 里用 **Preferences: Open User Settings (JSON)** 查看；**该仓库无法据代码确定当前机器上的用户设置文件路径或某项设置的用户覆盖值**。

## 5. 本仓库的开发与构建配置

这些配置会影响仓库开发、编译或发布，不是 Project Atlas 用户功能设置：

- [`.vscode/settings.json`](/Users/seven/ProjectAtlas/project-atlas-vs/.vscode/settings.json)：格式化、保存时格式化、搜索/文件排除和 TypeScript 自动任务设置。
- [`.vscode/launch.json`](/Users/seven/ProjectAtlas/project-atlas-vs/.vscode/launch.json)、[`.vscode/tasks.json`](/Users/seven/ProjectAtlas/project-atlas-vs/.vscode/tasks.json)：扩展调试入口及 `watch` 构建任务。
- [`.vscode/extensions.json`](/Users/seven/ProjectAtlas/project-atlas-vs/.vscode/extensions.json)：开发扩展推荐。
- [`.prettierrc.json`](/Users/seven/ProjectAtlas/project-atlas-vs/.prettierrc.json)、[`eslint.config.mjs`](/Users/seven/ProjectAtlas/project-atlas-vs/eslint.config.mjs)、[`tsconfig.json`](/Users/seven/ProjectAtlas/project-atlas-vs/tsconfig.json)：格式、lint 和 TypeScript 编译配置。
- [`.yarnrc`](/Users/seven/ProjectAtlas/project-atlas-vs/.yarnrc)、[`pnpm-workspace.yaml`](/Users/seven/ProjectAtlas/project-atlas-vs/pnpm-workspace.yaml)、`pnpm-lock.yaml`、`package.json`：包管理器/工作区及依赖配置。仓库指南要求 Yarn Classic，但当前可见仓库文件同时存在 pnpm workspace 与锁文件；**这是工具链配置不一致，值得核实实际维护和 CI 所用包管理器**。
- `package.json` 还定义扩展命令、菜单、快捷键、视图、文件关联和 Schema 注册。这些属于扩展清单与贡献点，不是用户设置存储。

## 审计中确认的边界与疑点

1. 主要用户配置的定义、实际读写和 Schema 大体可以对应；`github-stars.json` 与 `npmtrash.json` 是发现的两项缺少 Schema 的持久化文件。
2. `projectAtlas.github.*` 可同时落在 VS Code 设置与 `github.json`；GitHub token 尤其需要留意这两个存储副本。
3. 代理配置由代理列表文件和 VS Code `http.proxy` 组成，查看其中一处不足以确定当前活动代理。
4. README 提到 `custom.json` 可加入 VS Code 设置文件关联示例，但当前 `package.json` 的 JSON Schema 注册中没有该文件的 Schema，也没有找到对应的扩展读写实现；不应将它视为当前已由扩展管理的配置。
5. 这次审计没有读取用户主目录实际内容或 VS Code 当前用户设置，因此无法确认机器上哪些文件存在、当前设置覆盖值、用户是否配置了同步，或 GitHub token 是否已保存到两处。