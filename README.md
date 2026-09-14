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

## 设置与数据安全

Activity Bar 中的 **Project Atlas: Templates** 包含两个视图：**Common Commands** 展示 `commoncmd.json` 中的命令及描述，**Git Messages** 展示 `gitmessage.json` 中的提交消息（`type(scope): subject`）。两个视图均提供编辑文件和刷新按钮，文件保存或外部变更后自动刷新；读取失败时在视图中显示错误信息。

每条记录右侧提供 **Edit**、**Delete** 图标。编辑逐项填写，取消任一步不保存；描述和 scope 可清空。删除需确认，只移除对应 JSON 记录。编辑保持原位置并保留未知字段；文件已发生变化或编辑器中存在未保存修改时，操作会停止，请处理文件修改并刷新后重试。各平台均使用 VS Code 原生输入框和确认框，不涉及 Finder/Explorer 文件删除。

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
