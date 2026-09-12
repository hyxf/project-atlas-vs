# 更新日志

本文件记录 Project Atlas 的重要变更。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 新增列表视图与按 Tag 分组视图。
- 支持全部、最近、收藏及多选 Tag 筛选，包含 `Untagged` 项目。
- 支持保存当前工作区、添加目录、搜索项目及双击打开项目。
- 支持编辑项目名称、Tag 和收藏状态。
- 支持复制项目、复制路径、在 Finder / Explorer 中打开目录及启动终端。
- 支持在当前窗口或新窗口打开项目。
- 新增 GitHub Actions，可通过版本标签自动发布到 VS Code Marketplace。

### Changed

- 项目列表仅显示名称和状态图标；路径与 Tag 保留在悬停提示中。
- 双击项目或从搜索结果选择项目时，默认在当前窗口打开。
- 收藏项目使用单个收藏图标替代目录图标。
- 当前已打开的工作区项目会在列表右侧显示 `✓`。
- Tag 筛选状态、视图模式、排序和最近打开时间会持久保存。
- Tag 筛选启用时，新增项目的 Tag 会自动勾选，确保项目立即可见。
- 与 IntelliJ IDEA 版共用 `~/.project-atlas/project.json`。
- Tag 分组中的项目节点使用分组级唯一 ID，避免多 Tag 项目的选中与刷新状态冲突。

### Security

- 数据文件使用临时文件原子替换，解析失败时不会覆盖原数据。
- “移除记录”不会删除磁盘文件；删除目录前需要明确确认。
- 禁止删除文件系统根目录和当前打开的工作区。
- 禁止删除包含当前工作区的任何父目录，并通过真实路径防止符号链接绕过。
- Yarn 使用 `resolutions` 固定已修复的开发依赖版本。
