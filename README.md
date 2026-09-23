# Project Atlas for VS Code

Project Atlas 是一款用于管理本地项目、Git 仓库和开发素材的 VS Code 扩展。它与 IntelliJ IDEA 版共享项目数据，并提供 AICode 上下文和 Git 发布工具。

## 目录

- [快速开始](#快速开始)
- [项目与仓库](#项目与仓库)
- [AICode 上下文](#aicode-上下文)
- [模板与提示词](#模板与提示词)
- [Git 与发布工具](#git-与发布工具)
- [数据、安全与更新](#数据安全与更新)
- [本地开发与发布](#本地开发与发布)

## 快速开始

安装后，在 Activity Bar 中打开所需容器：

| 容器                         | 视图                                                          | 用途                            |
| ---------------------------- | ------------------------------------------------------------- | ------------------------------- |
| **Project Atlas: Projects**  | Projects、Git Repositories、GitHub Repositories、npm packages | 本地项目、远端仓库与 npm 依赖。 |
| **Project Atlas: AICode**    | Context Files、Compare Results                                | 准备 AI 上下文并比较分支。      |
| **Project Atlas: Templates** | Common Commands、Git Messages、AI Prompts、Backup & Restore   | 管理可复用内容。                |

项目管理的默认快捷键：

| 操作                | Windows / Linux | macOS         |
| ------------------- | --------------- | ------------- |
| 搜索项目            | `Ctrl+Shift+L`  | `Cmd+Shift+L` |
| 切换列表 / Tag 视图 | `Ctrl+Shift+T`  | `Cmd+Shift+T` |
| 显示 Project Atlas  | `Ctrl+Shift+,`  | `Cmd+Shift+,` |

快捷键可在 VS Code 的 **Keyboard Shortcuts** 中修改。

## 项目与仓库

### 本地项目

在 **Projects** 视图中保存当前工作区，或选择任意目录添加项目。支持列表或 Tag 视图、全部/最近/收藏/多 Tag（含 `Untagged`）筛选、按名称/路径/最近打开时间排序，以及按名称、路径和 Tag 搜索。

可编辑名称、Tag 和收藏状态，复制项目或路径，在 Finder / Explorer 显示目录，或在该目录启动终端。单击项目会选中它；双击按默认打开方式打开，当前工作区的项目显示 `✓`。标题栏和右键菜单提供保存、搜索、筛选、排序、编辑、打开、移除和删除操作。

### Git Repositories

**Git Repositories** 将常用远端地址保存在 `~/.project-atlas/repos.json`。可保存当前仓库、手动添加或编辑记录，按 Tag、组织/分组或托管平台浏览，并可复制 URL、编辑 Tag 和克隆仓库。

### GitHub Repositories

**GitHub Repositories** 从 GitHub API 同步指定账户拥有的仓库，缓存保存在 `~/.project-atlas/github.json`。在扩展设置或配置文件中填写 GitHub 用户名和 personal access token 后刷新；支持搜索、在浏览器打开、复制 SSH URL、克隆，以及加入 Git Repositories。

私有仓库需要令牌具有相应权限：经典 token 通常需要 `repo` scope，fine-grained token 需获授权访问目标仓库。网络需要代理时，可在扩展设置配置 HTTP/HTTPS 代理、SOCKS 代理和启用状态；代理同时用于 GitHub 刷新与克隆。

### npm packages

当打开的单一工作区根目录包含 `package.json` 时，**npm packages** 视图会显示 `dependencies`、`devDependencies`、收藏和回收站。移除已安装依赖后，原有版本和依赖类别会保存在当前工作区的回收站，可从条目操作中恢复，或直接永久删除该回收站记录。收藏仅在尚未安装时可加入任一依赖类别。标题栏的搜索或新增操作会打开 npm Registry 搜索页，每页 20 条结果，可将结果收藏或添加到安装列表。收藏保存于 `~/.project-atlas/npmfav.json`，回收站保存于 `~/.project-atlas/npmtrash.json`。

标题栏按钮从左到右依次为新增、刷新。Favorites 节点提供编辑和刷新元数据按钮；Trash 节点提供编辑 `npmtrash.json` 和刷新按钮。命令面板提供 `Project Atlas: Refresh npm Packages`、`Search npm Packages`、`Add npm Package` 和 `Edit npm Favorites`。移除、恢复、永久删除依赖、打开包主页和单个包的收藏操作需从树节点操作触发。

## AICode 上下文

**Project Atlas: AICode** 管理当前工作区要提供给 AI 的文件清单。每个工作区根目录使用自己的 `.aicode.json`；首次使用时会创建 `Default` 分组，多根工作区可独立维护。

- 从资源管理器右键 **Add to AICode**，或在上下文视图添加、移除文件和目录。
- 创建、选择、重命名、复制或删除分组；每组保存相对路径列表。
- 打开上下文文件、复制相对路径或文件列表、将路径插入终端，或将当前分组复制为 Markdown。
- 展开、折叠、刷新、补齐缺失文件，或显示编辑器装饰标记。
- 比较上下文文件在两个 Git 分支之间的差异；默认会获取远端，也可选择不获取。

`.aicode.json` 可随项目提交并与团队共享，编辑时有 VS Code Schema 补全和校验。

## 模板与提示词

| 视图                 | 数据文件                           | 功能                                                           |
| -------------------- | ---------------------------------- | -------------------------------------------------------------- |
| **Common Commands**  | `~/.project-atlas/commoncmd.json`  | 保存带说明的常用命令，并插入终端。                             |
| **Git Messages**     | `~/.project-atlas/gitmessage.json` | 保存 `type(scope): subject` 提交消息，支持复制和按 type 分组。 |
| **AI Prompts**       | `~/.project-atlas/aiprompts.json`  | 保存带标题、正文、说明和标签的本地提示词。                     |
| **Backup & Restore** | VS Code globalState                | 备份并恢复以上三个模板文件。                                   |

三类模板均支持新增、编辑、删除、编辑原始 JSON 和刷新。保存会保留未知字段，并检查文件冲突和编辑器未保存修改。拖动项目可直接调整 JSON 数组顺序：Git Messages 仅列表模式可排序；AI Prompts 仅“显示全部”的列表模式可排序。

AI Prompts 默认按标签分组，支持全文搜索、只读预览、复制正文、标签编辑和创建副本；首次加载且文件不存在时会创建六条默认提示词。Backup & Restore 依托 VS Code Settings Sync：登录 GitHub 或 Microsoft 并启用同步后，备份可由 VS Code 原生跨设备同步；恢复和删除均需确认。

## Git 与发布工具

- **Copy/Open Remote URL**：识别当前 Git remote，并生成 GitHub、GitLab 等托管平台的 Web URL。
- **Create Release Tag**：根据仓库状态创建发布标签，并在执行前显示警告和确认。
- **Create or Update CHANGELOG.md**：从 Git 历史生成预览，确认后才写入 `CHANGELOG.md`。
- **Update Package Version**：选择 Major、Minor 或 Patch，修改 `package.json` 版本；可选择只修改版本，或提交当前仓库所有已保存改动。

Update Package Version 的提交信息固定为 `chore: bump version to <新版本>`。没有 Git 仓库时只修改版本；有仓库但无远端时创建本地提交，配置远端时提交后推送。执行前会显示仓库、分支、文件清单和推送目标；取消不会修改文件。推送失败会保留本地提交，可使用 **Retry Push** 重试。该工具不创建版本标签、不自动合并、不强制推送，也不更新锁文件版本。

## 数据、安全与更新

| 文件                                                                   | 内容                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `~/.project-atlas/project.json`                                        | 项目、Tag、收藏、最近打开时间和项目视图设置；与 IntelliJ IDEA 版共享。 |
| `~/.project-atlas/repos.json`                                          | 已保存 Git 仓库及其分组、Tag 和视图偏好。                              |
| `~/.project-atlas/github.json`                                         | GitHub 用户、token、代理设置和仓库缓存。                               |
| `~/.project-atlas/commoncmd.json`、`gitmessage.json`、`aiprompts.json` | 个人模板与提示词。                                                     |
| 工作区 `.aicode.json`                                                  | AICode 分组与相对路径。                                                |

双击项目与搜索后打开项目时，`project.json` 的 `settings.defaultOpenMode` 决定默认方式：`CURRENT_WINDOW` 或 `NEW_WINDOW`；未配置时使用当前窗口。上述 JSON 文件均提供 VS Code Schema 补全和校验。

写入共享数据时，扩展会保留未知字段并使用临时文件原子替换。JSON 损坏时不会覆盖原文件，修复后执行刷新。模板保存使用同目录 `<文件名>.lock` 排他锁来降低跨进程覆盖风险；请避免与不遵守该协议的程序同时保存。

**Remove from Project Atlas** 只删除项目记录，不影响磁盘内容；**Delete Project** 才会删除目录，且扩展拒绝删除文件系统根目录和当前打开的工作区。GitHub token 是敏感信息，只应保存在本机，切勿提交或分享。

在命令面板执行 `Project Atlas: Check for Updates` 可立即查询稳定版；扩展启动后也会每天最多后台查询一次。可通过 `projectAtlas.update.enabled` 和 `projectAtlas.update.autoCheck` 设置关闭检查或自动检查。选择 **Upgrade Now** 后，扩展会下载、校验 SHA-256 并交由 VS Code 安装 VSIX。

## 本地开发与发布

需要 Node.js 22 和 Yarn Classic：

```bash
yarn install --frozen-lockfile
yarn format:check
yarn compile
yarn lint
yarn test
```

在 VS Code 按 `F5` 启动 Extension Development Host。执行 `yarn package:extension` 生成 VSIX；`yarn install:extension` 会生成 `project-atlas-vs.vsix` 并通过 VS Code CLI 覆盖安装，使用前请确保 `code` 已加入 `PATH`。

推送与 `package.json` 版本对应的 `v*` 标签（例如 `0.5.0` 对应 `v0.5.0`）会触发 GitHub Actions：安装依赖、运行检查、构建 VSIX、创建 GitHub Release，并生成稳定更新元数据。首次配置升级服务时，请在仓库 **Settings → Pages** 将发布源设置为 **GitHub Actions**。

Marketplace 发布需要仓库 Actions secret `VSCE_PAT`，并应仅在授权发布流程中使用。若要强制旧版本升级，可设置 Actions variable `PROJECT_ATLAS_MINIMUM_SUPPORTED_VERSION` 为最低受支持扩展版本。

## 许可证

[MIT](LICENSE)
