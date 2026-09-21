# 仓库指南

## 项目结构与模块组织

Project Atlas 是使用 TypeScript 开发的 VS Code 扩展。入口在 `src/extension.ts`，负责激活和注册功能模块；功能代码按领域存放在 `src/features/`：

- `projectManagement/`：本地项目、标签、筛选和共享的 `project.json`。
- `repositoryManagement/`、`githubRepositories/`：保存的 Git 仓库、GitHub 同步和克隆。
- `aicodeContext/`：工作区 `.aicode.json`、上下文分组和分支比较。
- `templates/`、`commonCommands/`、`gitMessages/`、`aiPrompts/`、`templateBackup/`：模板和备份。
- `gitRemote/`、`gitTagRelease/`、`packageVersion/`、`changelog/`、`update/`：Git 辅助、发布与更新。

功能目录通常以 `*Feature.ts` 作为 VS Code 注册入口，以 `model.ts` 定义领域类型，以 `*Store.ts` 或 `*Service.ts` 处理持久化与业务逻辑。测试位于 `src/test/`，按功能命名为 `*.test.ts`。JSON Schema 位于 `schemas/`，图标位于 `resources/`，命令、菜单、快捷键、设置和 Schema 关联均在 `package.json` 声明。`out/` 是编译产物，请勿直接修改。

新增功能时保持领域边界；对外命令、菜单项、快捷键、配置或数据格式变更必须同步更新 `package.json`、相应 Schema、测试和 README。

## 构建、测试与本地开发

需要 Node.js 22 与 Yarn Classic（`packageManager` 固定为 Yarn 1.22.22）。

- `yarn install --frozen-lockfile`：按锁文件安装依赖。
- `yarn clean`：删除 `out/` 编译产物。
- `yarn compile`：以严格模式编译 TypeScript 到 `out/`。
- `yarn watch`：持续编译；在 VS Code 按 `F5` 启动 Extension Development Host。
- `yarn format` / `yarn format:check`：格式化或检查整个仓库。
- `yarn lint`：检查 `src/`。
- `yarn test`：先运行格式检查、编译和 lint，再运行 VS Code 扩展测试。
- `yarn package:extension`：生成 VSIX；`yarn install:extension` 会打包并用 `code` CLI 覆盖安装本地扩展。

提交前运行 `yarn format && yarn test`。只改文档时至少运行 `yarn format:check`；涉及 TypeScript、清单或 Schema 时，还应运行 `yarn compile` 与相关测试，或完整 `yarn test`。

## 格式与编码约定

以 `.prettierrc.json` 为唯一格式标准：TypeScript 使用四空格、单引号、120 列宽和尾随逗号；JSON、JSONC 与 Markdown 使用两空格。所有新增或修改的 TypeScript、JavaScript、JSON、JSONC 和 Markdown 必须经 `yarn format`，并以 `yarn format:check` 确认无差异。不要手工对齐、为单个文件绕过格式化，或修改 `.prettierignore` 来隐藏问题。

函数和变量使用 `camelCase`，类、接口与类型使用 `PascalCase`，持久化枚举字符串使用大写值，如 `LIST`、`FAVORITES`。模块边界提供明确类型；异步文件系统和 VS Code API 使用 `async`/`await`。命令 ID 使用 `project-atlas.*` 或既有的 `aicode.*` 命名空间。

## 数据兼容性与安全

扩展与其他 IDE 或旧版扩展共享 `~/.project-atlas/project.json`、`repos.json`、`github.json`、`commoncmd.json`、`gitmessage.json` 和 `aiprompts.json`；工作区根目录 `.aicode.json` 保存 AICode 上下文分组。

写入共享 JSON 时必须保留未知的顶层、设置和记录字段，以保持跨 IDE 兼容。采用临时文件原子替换；解析失败、文件冲突或未保存的编辑器修改时不得覆盖源文件。模板写入使用同目录 `<文件名>.lock` 排他锁，修改锁策略前须补充并发回归测试。

严格区分“移除记录”和“删除磁盘文件”。新增删除路径时，必须拒绝文件系统根目录和当前打开的工作区，并有明确确认步骤。GitHub token 属于敏感数据：不得写入日志、测试快照、README 示例或提交记录。

## 测试规范

测试使用 Mocha 与 Node `assert`，文件名遵循 `*.test.ts`。将测试放在对应功能的测试文件中，例如 AICode 改动放入 `branchComparison.test.ts`，仓库功能放入 `repositoryManagement.test.ts`，GitHub 功能放入 `githubRepositories.test.ts`；跨项目存储和扩展激活行为放入 `extension.test.ts`。测试使用临时目录并在 teardown 中清理。

持久化、迁移、排序、并发控制、Git 操作或删除逻辑的改动必须包含回归测试。外部命令、网络与 VS Code UI 应通过依赖注入或 mock 保持测试可重复，避免依赖用户的真实主目录、凭据或仓库。

## 提交与 Pull Request

提交标题使用简短祈使句，例如 `Add multi-tag filtering`，每个提交只处理一个主题。PR 应说明用户可见的变化、数据格式与兼容性影响、验证命令及关联 issue。涉及项目树、菜单或表单时附截图或短录屏；涉及 Finder/Explorer、终端或 Git 行为时说明 macOS、Windows、Linux 的差异。

发布由 `.github/workflows/release.yml` 在推送 `v*` 标签时完成。不要在普通开发分支运行 `yarn deploy`；它需要已授权的 `VSCE_PAT`，只用于明确授权的 Marketplace 发布流程。
