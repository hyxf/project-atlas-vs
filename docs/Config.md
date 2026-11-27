# 配置在哪里、如何编辑

Project Atlas 的配置分成三类：VS Code 设置、用户主目录中的共享 JSON 文件、当前项目目录中的配置文件。下面按“配置项 → 保存位置 → 编辑方式”列出。扩展设置的完整定义以 [package.json](../package.json) 为准。

## 快速入口

- **VS Code 设置**：打开命令面板，运行 **Preferences: Open Settings (UI)**，搜索 `Project Atlas`；或运行 **Preferences: Open User Settings (JSON)** 直接编辑 JSON。需要特定项目生效时，在该项目的 `.vscode/settings.json` 中编辑工作区设置。
- **Project Atlas 文件**：通常在用户主目录的 `.project-atlas/` 下。Finder/文件管理器中打开主目录并显示隐藏文件，或在终端打开 `~/.project-atlas/`。也可从扩展对应视图中的编辑/管理命令进入，详见下表。
- **项目配置**：在 VS Code 打开的项目根目录中编辑对应文件；扩展通常提供可视化操作，直接编辑 JSON 适合批量修改。

## VS Code 设置

| 设置 | 默认值 | 保存位置 | 在哪里编辑 |
|---|---|---|---|
| `projectAtlas.update.enabled` | `true` | VS Code 用户或工作区设置 | 设置 UI 搜索 Project Atlas，或 Settings JSON |
| `projectAtlas.update.autoCheck` | `true` | VS Code 用户或工作区设置 | 同上 |
| `projectAtlas.github.httpProxy` | `http://127.0.0.1:1087` | VS Code 用户设置，并同步到 `~/.project-atlas/github.json` | 设置 UI；GitHub 文件变更也会同步回来 |
| `projectAtlas.github.socketProxy` | `socks5://127.0.0.1:1086` | VS Code 用户设置，并同步到 `github.json` | 同上 |
| `projectAtlas.github.proxyEnabled` | `false` | VS Code 用户设置，并同步到 `github.json` | 同上 |
| `projectAtlas.github.token` | 空 | VS Code 用户设置，并同步到 `github.json` | 设置 UI 或 GitHub 配置命令；属于敏感凭据 |
| `projectAtlas.github.user` | 空 | VS Code 用户设置，并同步到 `github.json` | 同上 |
| `projectAtlas.templateBackup.files` | 5 个 `~/.project-atlas/` 文件 | VS Code 用户/工作区设置 | Settings UI 或 JSON；这些文件备份内容另存于 VS Code `globalState`，并加入 Settings Sync |
| `http.proxy` | VS Code 自身默认值 | VS Code 设置，代理功能启用/切换时写入**全局用户设置** | VS Code Settings UI 搜索 `http.proxy`，或使用 Project Atlas 代理视图切换 |

GitHub 配置文件里的 token 是明文 JSON，且与 VS Code 设置双向同步。不要把 token 发给他人或提交到仓库。

## `~/.project-atlas/` 共享文件

这些文件由当前操作系统用户的主目录决定；`~` 表示主目录。扩展提供的编辑命令通常比手工编辑更安全，也更容易找到。

| 文件 | 内容 | 在哪里编辑 |
|---|---|---|
| `project.json` | 本地项目记录、标签、收藏、排序和项目列表偏好 | Project Atlas 项目视图；记录不是 VS Code 设置 |
| `repos.json` | 保存的 Git 仓库、分组、标签、视图偏好 | Repository Management 视图及其编辑命令 |
| `github.json` | GitHub token、用户名、代理与仓库数据 | GitHub Repositories 视图的配置/编辑命令；不要手改 token，除非清楚同步行为 |
| `github-stars.json` | GitHub Stars 缓存 | 扩展自动维护，一般无需编辑 |
| `proxy.json` | 可选代理列表 | Project Atlas 代理视图中的管理代理命令 |
| `npmfav.json` | npm 包收藏及收藏包管理器偏好 | npm Packages 视图的收藏管理命令 |
| `npmtrash.json` | 移入回收站的依赖记录 | npm Packages 回收站视图 |
| `commoncmd.json` | 常用命令及变量 | Common Commands 视图的 **Edit commoncmd.json** 命令 |
| `gitmessage.json` | Git 提交消息模板 | Git Messages 视图的 **Edit gitmessage.json** 命令 |
| `aiprompts.json` | AI 提示词模板 | AI Prompts 视图的 **Edit aiprompts.json** 命令 |

可在扩展视图标题栏或命令面板搜索对应的命令名称。文件也可用 VS Code **File: Open File...** 打开 `~/.project-atlas/<文件名>` 直接编辑。除缓存文件外，JSON 格式可参考 `schemas/` 下同名 schema；编辑前建议备份。

## 当前项目目录中的文件

| 文件 | 内容 | 在哪里编辑 |
|---|---|---|
| `.aicode.json` | 当前工作区的 AICode 上下文组、活动组和相对路径 | AICode 视图中增删分组/路径；也可在项目根目录打开文件编辑 |
| `package.json` | 项目依赖、开发依赖及版本 | npm Packages 视图管理依赖；项目版本命令或直接编辑文件 |
| `.git/config` | Git remote、分支关联等 Git 仓库设置 | 使用 Git 命令或 Git 扩展管理；Project Atlas 读取其中的 remote 等信息 |
| `.vscode/settings.json` | 仅对当前项目生效的 VS Code 设置 | Preferences: Open Workspace Settings (JSON) |

`.aicode.json` 是每个项目独立的文件；打开另一个项目会使用另一个文件。`package.json` 和 `.git/config` 属于项目自身数据，不是扩展全局设置。

## 自动保存的 VS Code 状态

更新检查时间、忽略版本、视图折叠状态等保存在 VS Code 托管的 `globalState` / `workspaceState` 中，不适合手工编辑。模板备份数据保存在 `globalState` 并同步；其备份清单由 `projectAtlas.templateBackup.files` 设置控制。

## 开发仓库配置

仓库中的 `.vscode/settings.json`、`.prettierrc.json`、`eslint.config.mjs`、`tsconfig.json` 和 `package.json` 主要控制扩展开发、格式、编译与打包，不是扩展用户的 Project Atlas 配置。不要为了修改个人扩展行为而编辑这些文件。
