# 仓库指南

## 项目结构与模块组织

Project Atlas 是一个使用 TypeScript 开发的 VS Code 扩展。运行时代码位于 `src/`：`extension.ts` 注册命令，`tree.ts` 渲染项目树，`service.ts` 实现项目操作，`store.ts` 读写共享 JSON，`model.ts` 定义数据类型。测试位于 `src/test/`，Activity Bar 图标位于 `resources/`。命令、菜单、快捷键和设置统一声明在 `package.json`。`out/` 是自动生成的编译产物，请勿直接修改。

## 构建、测试与本地开发

- `yarn install`：按照锁文件安装开发依赖。
- `yarn clean`：删除 `out/` 中的编译产物。
- `yarn compile`：以严格模式将 TypeScript 编译到 `out/`。
- `yarn watch`：持续编译，配合 VS Code 调试配置运行扩展。
- `yarn format`：使用 Prettier 格式化工程文件。
- `yarn format:check`：检查格式，但不修改文件。
- `yarn lint`：使用 ESLint 检查 `src/`。
- `yarn test`：依次执行 Prettier 检查、编译、lint 和 VS Code 扩展测试。
- `yarn vscode:prepublish`：执行发布或打包前的编译。
- `yarn package:extension`：在本地生成 VSIX 安装包。
- `yarn deploy`：使用 `VSCE_PAT` 发布到 VS Code Marketplace，仅用于授权的发布流程。

提交代码前运行 `yarn format && yarn test`。

## Prettier 格式化要求

所有新增或修改的 TypeScript、JavaScript、JSON、JSONC 和 Markdown 文件必须通过 Prettier。生成代码后必须运行 `yarn format`，再用 `yarn format:check` 确认无差异。不要手工对齐、不要为单个文件绕过格式化，也不要修改 `.prettierignore` 来隐藏格式问题。必须以 `.prettierrc.json` 为唯一格式标准：TypeScript 使用四空格、单引号、120 列宽和尾随逗号；JSON/JSONC 使用两空格。

## 编码风格与命名约定

模块边界应提供明确类型。函数与变量使用 `camelCase`，类与接口使用 `PascalCase`，持久化的枚举式字符串使用大写形式，如 `LIST`、`FAVORITES`。命令 ID 必须使用 `project-atlas.*` 命名空间。新增或删除对外命令时同步修改 `package.json`。文件系统和 VS Code API 使用 `async`/`await`。为兼容 IntelliJ 插件，写入数据时必须保留未知 JSON 字段。

## 测试规范

测试使用 Mocha 和 Node `assert`，文件名遵循 `*.test.ts`。存储迁移、数据安全、排序及服务逻辑应在 `src/test/extension.test.ts` 中添加针对性测试。测试使用临时目录，并在 teardown 中清理。目前没有覆盖率阈值，但持久化逻辑或删除操作的变更必须包含回归测试。

## 提交与 Pull Request 规范

现有 Git 历史较少，尚无稳定约定。提交标题使用简短的祈使句，例如 `Add multi-tag filtering`，且每个提交只处理一个主题。Pull Request 应说明用户可见的变化、数据格式影响并关联相关 issue。涉及项目树或菜单的改动应提供截图或短录屏，同时列出验证命令和 Finder/Explorer 的平台差异。

## 安全与数据保护

扩展与另一 IDE 共用 `~/.project-atlas/project.json`。必须保持原子写入，不得覆盖损坏的数据，并严格区分“移除记录”与“删除文件”。新增删除路径时，必须拒绝文件系统根目录和当前打开的工作区。
