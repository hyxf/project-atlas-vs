# Project Atlas for VS Code

Project Atlas 用于集中保存、分类、搜索和快速打开本地项目。它与 IntelliJ IDEA 版共用 `~/.project-atlas/project.json`，项目、Tag、收藏状态及最近打开时间可在两个 IDE 之间同步。

## 主要功能

- 保存当前工作区，或选择任意目录添加项目。
- 使用列表视图浏览项目，或切换到按 Tag 分组的视图。
- 显示全部、最近或收藏项目，并支持多选 Tag 与 `Untagged` 筛选。
- 按名称、路径或最近打开时间排序。
- 按名称、路径和 Tag 搜索，在当前窗口或新窗口打开项目。
- 编辑项目名称、Tag 和收藏状态；复制项目、复制路径或移除记录。
- 在 Finder / Explorer 中直接打开项目目录，或在该目录启动终端。
- 对不存在的目录显示警告；支持将项目目录移到废纸篓或永久删除。

## 使用方法

安装扩展后，点击 Activity Bar 中的 **Project Atlas** 图标。

- 单击项目可选中，双击项目会在当前窗口打开。
- 当前已打开的工作区项目会在列表右侧显示 `✓`。
- 使用标题栏按钮保存项目、搜索、切换视图、编辑数据文件、按 Tag 筛选或刷新。
- 使用标题栏的更多操作菜单筛选和排序项目。
- 右键项目可在当前窗口或新窗口打开、编辑、收藏、复制、显示目录、启动终端、移除或删除。
- Tag 筛选支持复选；不选择任何 Tag 表示显示所有项目。
- 搜索后选择项目会在当前窗口打开；如需新窗口，请使用 `Open Project in New Window...`。

命令面板提供 `Project Atlas: Search Projects`，其他操作可从 Project Atlas 视图的标题栏或项目右键菜单运行。

默认快捷键：

| 操作                | Windows / Linux | macOS         |
| ------------------- | --------------- | ------------- |
| 搜索项目            | `Ctrl+Shift+L`  | `Cmd+Shift+L` |
| 切换列表 / Tag 视图 | `Ctrl+Shift+T`  | `Cmd+Shift+T` |
| 显示 Project Atlas  | `Ctrl+Shift+,`  | `Cmd+Shift+,` |

如有快捷键冲突，请在 VS Code 的 Keyboard Shortcuts 中修改。

## 更新版本并提交代码

运行 **Update Package Version** 后选择 Major、Minor 或 Patch，再选择仅修改版本，或提交当前仓库全部已保存的改动（包含已暂存、未暂存、新增和删除的文件，遵守 `.gitignore`）。没有 Git 仓库时仅提供修改版本；有仓库但没有远端时提交到本地，配置了远端时提交后推送。

提交信息自动使用 `chore: bump version to <新版本>`，无需额外输入。执行前会显示仓库、分支、文件清单和推送目标；此前取消不会修改文件。推送优先使用当前分支的上游；没有上游且有多个远端时需选择远端，首次推送使用同名分支并建立跟踪关系。推送包含当前分支之前尚未推送的提交。

提交前需保存仓库中的编辑器文件，并处理冲突或未完成的 Git 操作。提交失败保留修改；推送失败保留本地提交，点击 **Retry Push** 仅重试推送。该功能不创建版本标签，不自动合并或强制推送，也不更新锁文件中的版本号。

## 设置与数据安全

**Common Commands** 和 **Git Messages** 标题栏在刷新按钮前提供 **Add**（`+`）。新增复用编辑表单，以空白字段打开；保存后追加到列表末尾，取消不写入。常用命令会检查重复，新增同样保留未知字段并检查文件冲突。

Activity Bar 中的 **Project Atlas: Templates** 包含三个视图：**Common Commands** 展示 `commoncmd.json` 中的命令及描述，**Git Messages** 展示 `gitmessage.json` 中的提交消息（`type(scope): subject`）。**AI Prompts** 管理 `aiprompts.json` 中的本地提示词。三个视图均提供编辑文件和刷新按钮，文件保存或外部变更后自动刷新；读取失败时在视图中显示错误信息。

Templates 列表支持原生拖动排序：将记录拖到另一条记录上，会插入到目标记录之前；拖到列表空白处会移至末尾。Git Messages 标题栏提供列表／按 type 分组切换，默认分组显示，并记住所选模式。只有列表模式支持拖动排序，可跨 type 调整记录顺序；分组模式完全禁用排序。切换模式不修改数据。描述行和分组标题不能拖动。顺序直接保存到原 JSON 数组，保留未知字段。所有模板增删改和排序在读取至提交期间持有同目录的 `<文件名>.lock` 排他锁，避免遵守该协议的扩展进程互相覆盖；检测到文件冲突时拒绝保存。手动编辑、旧版扩展或其他 IDE 若不遵守此锁协议，仍无法保证并发写入安全，应避免同时保存。锁不会因超时被强制抢占；若进程崩溃遗留锁，请确认写入进程已退出后再删除锁文件。

每条记录右侧提供 **Edit**、**Delete** 图标。编辑在一个表单面板中展示全部字段，点击 **Save**（或 `Ctrl/Cmd+Enter`）统一保存；点击 **Cancel**、按 `Esc` 或保存前关闭面板均不保存。描述和 scope 可清空，保存失败时在表单中显示原因并保留输入。删除需确认，只移除对应 JSON 记录。编辑保持原位置并保留未知字段；文件已发生变化或编辑器中存在未保存修改时，操作会停止，请处理文件修改并刷新后重新打开表单。各平台均不涉及 Finder/Explorer 文件删除。

扩展启动时会在 `~/.project-atlas/` 下自动创建缺失的 `commoncmd.json` 和 `gitmessage.json`，分别包含常用 Git 查询命令和 Git 提交消息模板。已有文件保持原样，包括空文件或损坏的 JSON。可通过命令面板中的 **Project Atlas: Edit Common Commands** 和 **Project Atlas: Edit Git Messages** 编辑默认数据。

双击项目和搜索后打开项目时，打开方式由 `~/.project-atlas/project.json` 中的 `settings.defaultOpenMode` 控制，请手动配置：`CURRENT_WINDOW` 为当前窗口，`NEW_WINDOW` 为新窗口。未配置时使用当前窗口。

在 VS Code 中编辑 `.project-atlas/project.json` 时，自动提供项目字段、设置项的补全、悬停说明及枚举值提示，无需添加 `$schema`。保留原有的 `defaultOpenMode` 提示，并兼容旧版设置值及未知字段；智能提示不会修改已有数据。

数据采用临时文件原子替换写入，并保留未知的顶层、设置及项目字段。JSON 损坏时不会覆盖原文件；修复后执行 **Refresh Projects**。**Remove from Project Atlas** 只删除记录，不影响磁盘内容；**Delete Project** 才会删除目录，并且拒绝删除文件系统根目录和当前打开的工作区。

## 本地开发

需要 Node.js 22 和 Yarn Classic：

```bash
yarn install --frozen-lockfile
yarn format:check
yarn compile
yarn lint
yarn test
```

在 VS Code 中按 `F5` 可启动 Extension Development Host。执行 `yarn package:extension` 可生成 VSIX 安装包；执行
`yarn install:extension` 会生成 `project-atlas-vs.vsix`，并通过 VS Code 命令行工具立即覆盖安装。使用后者前请确保
`code` 命令已加入 `PATH`。

## 自动发布

推送与 `package.json` 版本一致的 `v*` 标签（例如版本 `0.2.0` 对应 `v0.2.0`）后，GitHub Actions 会运行完整检查并发布到 VS Code Marketplace。发布前需要在仓库的 Actions secrets 中配置 `VSCE_PAT`。也可在 Actions 页面手动运行 **Publish Extension** 工作流。

## 许可证

[MIT](LICENSE)

### AI Prompts

提示词存放在 `~/.project-atlas/aiprompts.json`，首次加载且文件不存在时，自动创建 6 条默认提示词：代码审查、排查问题、编写单元测试、重构代码、润色文案和总结提炼。已有文件保持原样，包括空列表、空文件或损坏的 JSON。结构包含 `schemaVersion: 1` 和 `prompts` 数组；每条记录必须有唯一 UUID `id`、`title` 和 `content`，可选 `description`、`tags`（字符串数组）。支持 JSON Schema 编辑提示，写入时保留未知字段。

**Backup & Restore** 视图可将 `aiprompts.json`、`commoncmd.json` 和 `gitmessage.json` 备份至 VS Code `globalState`。未登录 GitHub 或 Microsoft 时，视图仅显示登录引导，不会显示备份信息。该备份会在用户登录并启用 VS Code Settings Sync 后由 VS Code 原生跨设备同步；备份、恢复、刷新和删除操作均在后台异步执行。恢复和删除会先要求确认；删除会通过原生同步移除服务端备份，恢复会拒绝覆盖尚未保存的 JSON 编辑内容。

默认按标签分组，多标签提示词会出现在每个对应标签下；未设置标签的记录显示在“无标签”下。列表模式每条提示词只显示一次。标题栏依次提供新增、列表／标签切换、编辑 JSON、全文搜索和刷新。空列表显示原生欢迎页，可直接编辑 `aiprompts.json`。显示模式和标签展开状态会被记住。只有显示全部记录的列表模式支持拖动排序，顺序保存到原数组。

单击提示词打开只读预览，行内按钮复制完整正文并提示成功；标签按钮或右键“Edit Tags”打开原生多选框，支持勾选已有标签、输入新增和清空标签。右键还支持编辑、创建副本和删除记录。标签右键可以预填标签新增。编辑表单支持多个标签（每行一个，自动去空白和去重；逗号作为标签内容保留）、多行正文和 Tab 缩进；取消时确认未保存的修改，通过标签页关闭后选择保留修改会重新打开表单。保存冲突时保留输入，需刷新数据后重新编辑。正文复制不附加标题、不裁剪空白。

AI Prompts 的操作在 macOS、Windows 和 Linux 上相同，不调用 Finder/Explorer，也不会删除提示词以外的本地文件。
