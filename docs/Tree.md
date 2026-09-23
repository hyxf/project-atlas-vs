# Project Atlas VS — VS Code UI 完整层级

```text
VS Code
│
├── Activity Bar
│   │
│   ├── Project Atlas: Templates
│   │   │
│   │   ├── Common Commands
│   │   │   │
│   │   │   ├── Tree
│   │   │   │   │
│   │   │   │   └── Common Command Tree Item
│   │   │   │       │
│   │   │   │       └── Tree Item Context Menu
│   │   │   │           │
│   │   │   │           ├── Insert Common Command
│   │   │   │           │   [group: inline@0]
│   │   │   │           │
│   │   │   │           ├── Edit Common Command
│   │   │   │           │   [group: edit@1]
│   │   │   │           │
│   │   │   │           └── Delete Common Command
│   │   │   │               [group: danger@1]
│   │   │   │
│   │   │   └── View Title Toolbar
│   │   │       │
│   │   │       ├── Add Common Command
│   │   │       │   [group: navigation@1]
│   │   │       │
│   │   │       ├── Edit Common Commands
│   │   │       │   [group: navigation@2]
│   │   │       │
│   │   │       ├── Collapse All
│   │   │       │   [when: !projectAtlas.commonCommandsCollapsed]
│   │   │       │   [group: navigation@3]
│   │   │       │
│   │   │       ├── Expand All
│   │   │       │   [when: projectAtlas.commonCommandsCollapsed]
│   │   │       │   [group: navigation@3]
│   │   │       │
│   │   │       └── Refresh Common Commands
│   │   │           [group: navigation@4]
│   │   │
│   │   ├── Git Messages
│   │   │   │
│   │   │   ├── Tree
│   │   │   │   │
│   │   │   │   └── Git Message Tree Item
│   │   │   │       │
│   │   │   │       └── Tree Item Context Menu
│   │   │   │           │
│   │   │   │           ├── Copy Git Message
│   │   │   │           │   [group: inline@0]
│   │   │   │           │
│   │   │   │           ├── Edit Git Message
│   │   │   │           │   [group: edit@1]
│   │   │   │           │
│   │   │   │           └── Delete Git Message
│   │   │   │               [group: danger@1]
│   │   │   │
│   │   │   └── View Title Toolbar
│   │   │       │
│   │   │       ├── Add Git Message
│   │   │       │   [group: navigation@1]
│   │   │       │
│   │   │       ├── Edit Git Messages
│   │   │       │   [group: navigation@2]
│   │   │       │
│   │   │       ├── Collapse All
│   │   │       │   [when: !projectAtlas.gitMessagesCollapsed]
│   │   │       │   [group: navigation@3]
│   │   │       │
│   │   │       ├── Expand All
│   │   │       │   [when: projectAtlas.gitMessagesCollapsed]
│   │   │       │   [group: navigation@3]
│   │   │       │
│   │   │       ├── Refresh Git Messages
│   │   │       │   [group: navigation@4]
│   │   │       │
│   │   │       └── Show Git Messages as List
│   │   │           [when: projectAtlas.gitMessageViewMode != LIST]
│   │   │           [group: navigation@1]
│   │   │
│   │   └── AI Prompts
│   │       │
│   │       ├── Tree
│   │       │   │
│   │       │   └── AI Prompt Tree Item
│   │       │       │
│   │       │       └── Tree Item Context Menu
│   │       │           │
│   │       │           ├── Copy AI Prompt
│   │       │           │   [group: inline@0]
│   │       │           │
│   │       │           ├── Edit AI Prompt
│   │       │           │   [group: aiPrompts@1]
│   │       │           │
│   │       │           ├── Edit Tags
│   │       │           │   [group: inline@1]
│   │       │           │
│   │       │           ├── Edit Tags
│   │       │           │   [group: aiPrompts@2]
│   │       │           │
│   │       │           ├── Duplicate AI Prompt
│   │       │           │   [group: aiPrompts@3]
│   │       │           │
│   │       │           └── Delete AI Prompt
│   │       │               [group: aiPrompts@4]
│   │       │
│   │       └── View Title Toolbar
│   │           │
│   │           ├── Add AI Prompt
│   │           │   [group: navigation@0]
│   │           │
│   │           ├── Show as List
│   │           │   [when: projectAtlas.aiPromptsMode != LIST]
│   │           │   [group: navigation@1]
│   │           │
│   │           ├── Group by Tags
│   │           │   [when: projectAtlas.aiPromptsMode == LIST]
│   │           │   [group: navigation@1]
│   │           │
│   │           ├── Edit AI Prompts JSON
│   │           │   [group: navigation@2]
│   │           │
│   │           ├── Search AI Prompts
│   │           │   [group: navigation@3]
│   │           │
│   │           ├── Refresh AI Prompts
│   │           │   [group: navigation@4]
│   │           │
│   │           ├── Collapse All
│   │           │   [when: !projectAtlas.aiPromptsCollapsed]
│   │           │   [group: navigation@4]
│   │           │
│   │           └── Expand All
│   │               [when: projectAtlas.aiPromptsCollapsed]
│   │               [group: navigation@4]
│   │
│   ├── Project Atlas: AICode
│   │   │
│   │   ├── Context Files
│   │   │   │
│   │   │   ├── Tree
│   │   │   │   │
│   │   │   │   └── Context Tree Item
│   │   │   │       │
│   │   │   │       └── Tree Item Context Menu
│   │   │   │           │
│   │   │   │           ├── Group Tree Item
│   │   │   │           │   ├── Create Context Group
│   │   │   │           │   │   [group: inline@1]
│   │   │   │           │   │
│   │   │   │           │   ├── Rename Current Context Group
│   │   │   │           │   │   [group: navigation@2]
│   │   │   │           │   │   [enablement: viewItem != aicode.group.default]
│   │   │   │           │   │
│   │   │   │           │   ├── Duplicate Current Context Group
│   │   │   │           │   │   [group: navigation@3]
│   │   │   │           │   │
│   │   │   │           │   └── Delete Current Context Group
│   │   │   │           │       [group: navigation@4]
│   │   │   │           │       [enablement: viewItem != aicode.group.default]
│   │   │   │           │
│   │   │   │           ├── Directory with Missing Files
│   │   │   │           │   └── Add Missing Files
│   │   │   │           │       [group: aicode@1]
│   │   │   │           │
│   │   │   │           ├── File Tree Item
│   │   │   │           │   ├── Remove File from Context
│   │   │   │           │   │   [group: aicode@2]
│   │   │   │           │   │
│   │   │   │           │   └── Copy Relative Path
│   │   │   │           │       [group: aicode@3]
│   │   │   │           │
│   │   │   │           └── Directory Tree Item
│   │   │   │               └── Remove Directory from Context
│   │   │   │                   [group: aicode@2]
│   │   │   │
│   │   │   └── View Title Toolbar
│   │   │       │
│   │   │       ├── Select Context Group
│   │   │       │   [group: navigation@1]
│   │   │       │
│   │   │       ├── Open Configuration
│   │   │       │   [group: navigation@2]
│   │   │       │
│   │   │       ├── Copy as Markdown
│   │   │       │   [group: navigation@3]
│   │   │       │
│   │   │       ├── Copy File List
│   │   │       │   [group: navigation@4]
│   │   │       │
│   │   │       ├── Expand All
│   │   │       │   [group: navigation@5]
│   │   │       │
│   │   │       ├── Collapse All
│   │   │       │   [group: navigation@6]
│   │   │       │
│   │   │       ├── Refresh Context
│   │   │       │   [group: navigation@7]
│   │   │       │
│   │   │       └── Editor Indicator
│   │   │           │
│   │   │           ├── Show
│   │   │           │   [toggled: aicode.editorIndicatorVisible]
│   │   │           │
│   │   │           └── Hidden
│   │   │               [toggled: !aicode.editorIndicatorVisible]
│   │   │
│   │   └── Compare Results
│   │       │
│   │       ├── Tree
│   │       │   │
│   │       │   └── Compare Result Tree Item
│   │       │       │
│   │       │       └── Tree Item Context Menu
│   │       │           └── [package.json 未配置 view/item/context Action]
│   │       │
│   │       ├── View Title Toolbar
│   │       │   │
│   │       │   ├── Refresh Compare Results
│   │       │   │   [when: aicode.compareResultsAvailable]
│   │       │   │   [group: navigation@1]
│   │       │   │
│   │       │   ├── Compare Context Branches
│   │       │   │   [group: navigation@2]
│   │       │   │
│   │       │   └── Clear Compare Results
│   │       │       [group: navigation@3]
│   │       │
│   │       └── Empty State / Welcome
│   │           ├── No comparison results.
│   │           ├── Compare Context Branches
│   │           │   [command: aicode.compareBranches]
│   │           └── Compare Without Fetch
│   │               [command: aicode.compareBranchesWithoutFetch]
│   │
│   └── Project Atlas: Projects
│       │
│       ├── Projects
│       │   │
│       │   ├── Tree
│       │   │   │
│       │   │   └── Project Tree Item
│       │   │       │
│       │   │       └── Tree Item Context Menu
│       │   │           │
│       │   │           ├── Open in Current Window
│       │   │           │   [group: navigation@1]
│       │   │           │
│       │   │           ├── Open in New Window
│       │   │           │   [group: navigation@2]
│       │   │           │
│       │   │           ├── Edit Project...
│       │   │           │   [group: edit@1]
│       │   │           │
│       │   │           ├── Toggle Favorite
│       │   │           │   [group: edit@2]
│       │   │           │
│       │   │           ├── Edit Tags...
│       │   │           │   [group: edit@3]
│       │   │           │
│       │   │           ├── Duplicate Project...
│       │   │           │   [group: files@1]
│       │   │           │
│       │   │           ├── Copy Path
│       │   │           │   [group: files@2]
│       │   │           │
│       │   │           ├── Open in Finder / Explorer
│       │   │           │   [group: files@3]
│       │   │           │
│       │   │           ├── Open in Terminal
│       │   │           │   [group: files@4]
│       │   │           │
│       │   │           ├── Remove from Project Atlas...
│       │   │           │   [group: danger@1]
│       │   │           │
│       │   │           └── Delete Project...
│       │   │               [group: danger@2]
│       │   │
│       │   └── View Title Toolbar
│       │       │
│       │       ├── Save Current Project...
│       │       │   [group: navigation@1]
│       │       │
│       │       ├── Search Projects
│       │       │   [group: navigation@3]
│       │       │
│       │       ├── Switch List / Tags View
│       │       │   [group: navigation@4]
│       │       │
│       │       ├── Open Data File
│       │       │   [group: navigation@5]
│       │       │
│       │       ├── Filter by Tag...
│       │       │   [group: navigation@6]
│       │       │
│       │       ├── Refresh Projects
│       │       │   [group: navigation@7]
│       │       │
│       │       ├── Refresh Saved Project Repositories
│       │       │   [group: navigation@8]
│       │       │
│       │       ├── Add Folder...
│       │       │   [group: project@1]
│       │       │
│       │       ├── Filter
│       │       │   │
│       │       │   ├── All
│       │       │   │   [when: projectAtlas.filter != ALL]
│       │       │   │
│       │       │   ├── All [selected]
│       │       │   │   [when: projectAtlas.filter == ALL]
│       │       │   │
│       │       │   ├── Recent
│       │       │   │   [when: projectAtlas.filter != RECENT]
│       │       │   │
│       │       │   ├── Recent [selected]
│       │       │   │   [when: projectAtlas.filter == RECENT]
│       │       │   │
│       │       │   ├── Favorite
│       │       │   │   [when: projectAtlas.filter != FAVORITES]
│       │       │   │
│       │       │   └── Favorite [selected]
│       │       │       [when: projectAtlas.filter == FAVORITES]
│       │       │
│       │       └── Sort
│       │           │
│       │           ├── Name
│       │           │   [when: projectAtlas.sort != NAME]
│       │           │
│       │           ├── Name [selected]
│       │           │   [when: projectAtlas.sort == NAME]
│       │           │
│       │           ├── Path
│       │           │   [when: projectAtlas.sort != PATH]
│       │           │
│       │           ├── Path [selected]
│       │           │   [when: projectAtlas.sort == PATH]
│       │           │
│       │           ├── Recently
│       │           │   [when: projectAtlas.sort != RECENT]
│       │           │
│       │           └── Recently [selected]
│       │               [when: projectAtlas.sort == RECENT]
│       │
│       ├── Git Repositories
│       │   │
│       │   ├── Tree
│       │   │   │
│       │   │   └── Repository Tree Item
│       │   │       │
│       │   │       └── Tree Item Context Menu
│       │   │           │
│       │   │           ├── Delete Repository...
│       │   │           │   [group: danger@1]
│       │   │           │
│       │   │           ├── Edit Git Repository
│       │   │           │   [group: edit@1]
│       │   │           │
│       │   │           ├── Edit Repository Tags...
│       │   │           │   [group: edit@2]
│       │   │           │
│       │   │           └── Clone Repository...
│       │   │               [group: inline@3]
│       │   │
│       │   └── View Title Toolbar
│       │       │
│       │       ├── Add Git Repository
│       │       │   [group: navigation@1]
│       │       │
│       │       ├── Open Repository Data File
│       │       │   [group: navigation@2]
│       │       │
│       │       ├── Collapse All
│       │       │   [group: navigation@3]
│       │       │
│       │       ├── Refresh Repositories
│       │       │   [group: navigation@4]
│       │       │
│       │       └── Group By
│       │           │
│       │           ├── Tag
│       │           │   [toggled: projectAtlas.repositoryViewMode == TAGS]
│       │           │   [enablement: projectAtlas.repositoryViewMode != TAGS]
│       │           │
│       │           ├── Group
│       │           │   [toggled: projectAtlas.repositoryViewMode == GROUPS]
│       │           │   [enablement: projectAtlas.repositoryViewMode != GROUPS]
│       │           │
│       │           └── Domain
│       │               [toggled: projectAtlas.repositoryViewMode == HOSTS]
│       │               [enablement: projectAtlas.repositoryViewMode != HOSTS]
│       │
│       └── GitHub Repositories
│           │
│           ├── Tree
│           │   │
│           │   └── GitHub Repository Tree Item
│           │       │
│           │       └── Tree Item Context Menu
│           │           │
│           │           ├── Add to Git Repositories
│           │           │   [when: viewItem == githubRepositoryAddable]
│           │           │   [group: inline@1]
│           │           │
│           │           ├── Copy SSH URL
│           │           │   [group: navigation@1]
│           │           │
│           │           ├── Open on GitHub
│           │           │   [group: navigation@2]
│           │           │
│           │           └── Clone Repository...
│           │               [group: inline@3]
│           │
│           └── View Title Toolbar
│               │
│               ├── Search GitHub Repositories
│               │   [group: navigation@1]
│               │
│               ├── Open GitHub Configuration
│               │   [group: navigation@2]
│               │
│               ├── Expand All
│               │   [group: navigation@3]
│               │
│               ├── Collapse All
│               │   [group: navigation@4]
│               │
│               ├── Refresh GitHub Repositories
│               │   [when: !projectAtlas.githubRepositoriesRefreshing]
│               │   [group: navigation@5]
│               │
│               └── Open Project Atlas Settings
│                   [group: navigation@6]
```

---

# 二、Explorer

```text
VS Code
│
└── Explorer
    │
    └── File / Folder
        │
        └── Explorer Context Menu
            │
            ├── Copy as Markdown
            │   [when: resourceFilename == .aicode.json]
            │   [group: aicode@5]
            │
            ├── Git Tools
            │   │
            │   ├── Open Repository Home
            │   │   │   [group: 1_remote@1]
            │   │   │
            │   ├── Open Current Branch
            │   │   │   [group: 1_remote@2]
            │   │   │
            │   ├── Open Selected Directory on Remote
            │   │   │   [group: 2_path@1]
            │   │   │
            │   ├── Open Selected File on Remote
            │   │   │   [group: 2_path@2]
            │   │   │
            │   └── Copy Remote URL
            │       [group: 3_clipboard]
            │
            └── AICode
                │
                ├── Add to AICode
                │   [when: resource not in aicode.contextResources]
                │   [group: aicode@1]
                │
                ├── Remove from AICode
                │   [when: resource in aicode.contextResources]
                │   [group: aicode@1]
                │
                ├── Copy Relative Path
                │   [group: aicode@2]
                │
                └── Add to Terminal
                    [group: aicode@3]
```

这里的 `Git Tools` 和 `AICode` 都是 `submenu`，所以必须继续展开到 Action。

---

# 三、Editor

```text
VS Code
│
└── Editor
    │
    └── Editor Title
        │
        ├── Write CHANGELOG.md Preview
        │   [when: aicode.changelogPreviewActive && resourceFilename == CHANGELOG.md]
        │   [group: navigation@100]
        │
        └── Cancel CHANGELOG.md Preview
            [when: aicode.changelogPreviewActive && resourceFilename == CHANGELOG.md]
            [group: navigation@101]
```

这里没有配置 `editor/title` Submenu，因此不存在需要继续递归的 Editor Title Submenu。

---

# 四、Source Control

```text
VS Code
│
└── Source Control
    │
    └── Git
        │
        └── SCM Title
            │
            └── Select Git Message
                [when: scmProvider == git]
                [group: navigation@100]
```

---

# 五、Terminal

```text
VS Code
│
└── Terminal
    │
    └── Terminal Selection
        │
        └── Context Menu
            │
            └── Add Terminal Selection to Common Command
                [when: terminalTextSelected]
                [group: 9_cutcopypaste]
```

---

# 六、Command Palette

这里需要特别区分：

- `when: false` → 明确隐藏
- 没有 `when` → 正常暴露
- 其他 `when` → 根据条件决定是否可见

完整配置如下：

```text
VS Code
│
└── Command Palette
    │
    ├── Add Common Command [hidden]
    ├── Add Git Message [hidden]
    ├── Edit Common Command [hidden]
    ├── Delete Common Command [hidden]
    ├── Edit Git Message [hidden]
    ├── Delete Git Message [hidden]
    ├── Refresh Common Commands [hidden]
    ├── Refresh Git Messages [hidden]
    │
    ├── Create or Update CHANGELOG.md...
    ├── Add to AICode [hidden]
    ├── Remove from AICode [hidden]
    ├── Open Context File [hidden]
    ├── Copy Relative Path [hidden]
    ├── Add to Terminal [hidden]
    ├── Show [hidden]
    ├── Hidden [hidden]
    ├── Clear Compare Results [hidden]
    ├── Compare Context Branches Without Fetch [hidden]
    ├── Refresh Compare Results [hidden]
    ├── Open Context Comparison [hidden]
    ├── Remove File from Context [hidden]
    ├── Remove Directory from Context [hidden]
    ├── Rename Current Context Group [hidden]
    ├── Duplicate Current Context Group [hidden]
    ├── Delete Current Context Group [hidden]
    ├── Add Missing Files [hidden]
    ├── Refresh Context [hidden]
    ├── Expand All [hidden]
    ├── Collapse All [hidden]
    ├── Remove All Files [hidden]
    │
    ├── Update Package Version
    │   [when: workspaceFolderCount == 1]
    │
    ├── Write CHANGELOG.md Preview [hidden]
    ├── Cancel CHANGELOG.md Preview [hidden]
    │
    ├── Edit Git Messages
    ├── Select Git Message [hidden]
    ├── Add Terminal Selection to Common Command [hidden]
    ├── Edit Common Commands
    ├── Insert Common Command...
    │
    ├── Create Release Tag...
    │   [when: workspaceFolderCount > 0]
    │
    ├── Open Repository Home
    ├── Open Current Branch
    ├── Open Selected Directory on Remote [hidden]
    ├── Open Selected File on Remote [hidden]
    ├── Copy Remote URL
    │
    ├── Search Projects
    ├── Open Project... [hidden]
    ├── Open Project in New Window... [hidden]
    ├── Save Current Project...
    ├── Add Folder...
    ├── Refresh Projects [hidden]
    ├── Collapse All [hidden]
    ├── Refresh Repositories [hidden]
    ├── Open Repository Data File [hidden]
    ├── Add Git Repository [hidden]
    ├── Delete Repository... [hidden]
    ├── Tag [hidden]
    ├── Group [hidden]
    ├── Domain [hidden]
    ├── Edit Git Repository [hidden]
    ├── Edit Repository Tags... [hidden]
    ├── Clone Repository... [hidden]
    ├── Refresh GitHub Repositories [hidden]
    ├── Open Project Atlas Settings [hidden]
    ├── Open GitHub Configuration [hidden]
    ├── Search GitHub Repositories [hidden]
    ├── Expand All [hidden]
    ├── Collapse All [hidden]
    ├── Open on GitHub [hidden]
    ├── Copy SSH URL [hidden]
    ├── Add to Git Repositories [hidden]
    ├── Clone Repository... [hidden]
    ├── Switch List / Tags View [hidden]
    │
    ├── All [hidden]
    ├── Recent [hidden]
    ├── Favorite [hidden]
    ├── All [hidden]
    ├── Recent [hidden]
    ├── Favorite [hidden]
    │
    ├── Name [hidden]
    ├── Path [hidden]
    ├── Recently [hidden]
    ├── Name [hidden]
    ├── Path [hidden]
    ├── Recently [hidden]
    │
    ├── Show as List [hidden]
    ├── Group by Tags [hidden]
    │
    ├── Add AI Prompt
    ├── Refresh AI Prompts
    ├── Edit AI Prompts JSON
    ├── Search AI Prompts
    ├── Preview AI Prompt [hidden]
    ├── Copy AI Prompt [hidden]
    ├── Edit AI Prompt [hidden]
    ├── Delete AI Prompt [hidden]
    ├── Duplicate AI Prompt [hidden]
    ├── Show as List
    ├── Group by Tags
    └── Edit Tags [hidden]
```

### 一个值得注意的点

`commands` 中的命令，即使没有出现在 `commandPalette` 中，VS Code 默认也可能出现在 Command Palette；你的配置通过：

```json
{
    "command": "...",
    "when": "false"
}
```

主动把大量内部/Tree 专用命令隐藏掉。

因此上面的 `[hidden]` 是基于你**明确声明的 `commandPalette` 配置**。

---

# 七、Keyboard Shortcuts

```text
VS Code
│
└── Keyboard Shortcuts
    │
    ├── Cmd/Ctrl + Shift + Z
    │   └── Add to AICode
    │       command: aicode.addToContext
    │
    ├── Cmd/Ctrl + Shift + X
    │   └── Remove from AICode
    │       command: aicode.removeFromContext
    │
    ├── Shift + Cmd/Ctrl + H
    │   └── Open Repository Home
    │       command: project-atlas.openRepositoryHome
    │
    ├── Shift + Cmd/Ctrl + B
    │   └── Open Current Branch
    │       command: project-atlas.openCurrentBranch
    │
    ├── Cmd/Ctrl + Shift + L
    │   └── Search Projects
    │       command: project-atlas.search
    │
    ├── Cmd/Ctrl + Shift + T
    │   └── Switch List / Tags View
    │       command: project-atlas.toggleView
    │
    └── Cmd/Ctrl + Shift + ,
        └── Open Project Atlas Projects View
            command: workbench.view.extension.projectAtlas
```

具体平台：

```text
Cmd = macOS
Ctrl = Windows / Linux
```

---

# 八、Views Welcome / Empty State

```text
VS Code
│
└── Activity Bar
    │
    ├── Project Atlas: Templates
    │   │
    │   ├── Common Commands
    │   │   └── Empty State
    │   │       │
    │   │       ├── No common commands configured.
    │   │       │
    │   │       └── Edit commoncmd.json
    │   │           command: project-atlas.editCommonCommands
    │   │
    │   └── Git Messages
    │       └── Empty State
    │           │
    │           ├── No Git messages configured.
    │           │
    │           └── Edit gitmessage.json
    │               command: project-atlas.editGitMessages
    │
    ├── Project Atlas: AICode
    │   │
    │   └── Compare Results
    │       └── Empty State
    │           [when: !aicode.compareResultsAvailable]
    │           │
    │           ├── No comparison results.
    │           ├── Compare Context Branches
    │           │   command: aicode.compareBranches
    │           └── Compare Without Fetch
    │               command: aicode.compareBranchesWithoutFetch
    │
    └── Project Atlas: Projects
        │
        ├── Projects
        │   └── Empty State
        │       │
        │       ├── No saved projects yet.
        │       ├── Save Current Project
        │       │   command: project-atlas.saveCurrent
        │       └── Add Folder
        │           command: project-atlas.add
        │
        └── AI Prompts
            └── Empty State
                │
                ├── No AI prompts configured.
                └── Edit aiprompts.json
                    command: project-atlas.editAiPromptsFile
```

注意：`viewsWelcome` 中没有 `Git Repositories` 和 `GitHub Repositories` 配置，所以**不能自行添加 Empty State**。

---

# 九、Settings

```text
VS Code
│
└── Settings
    │
    └── Project Atlas
        │
        └── GitHub
            │
            ├── HTTP Proxy
            │   key:
            │   projectAtlas.github.httpProxy
            │   type: string
            │   default: "http://127.0.0.1:1087"
            │   order: 2
            │
            ├── Socket Proxy
            │   key:
            │   projectAtlas.github.socketProxy
            │   type: string
            │   default: "socks5://127.0.0.1:1086"
            │   order: 3
            │
            ├── Proxy Enabled
            │   key:
            │   projectAtlas.github.proxyEnabled
            │   type: boolean
            │   default: false
            │   order: 4
            │
            ├── Token
            │   key:
            │   projectAtlas.github.token
            │   type: string
            │   default: ""
            │   order: 5
            │
            └── User
                key:
                projectAtlas.github.user
                type: string
                default: ""
                order: 6
```

---

# 十、JSON Validation

```text
VS Code
│
└── JSON Validation
    │
    ├── .project-atlas/project.json
    │   └── project.schema.json
    │       url: ./schemas/project.schema.json
    │
    ├── gitmessage.json
    │   └── gitmessage.schema.json
    │       url: ./schemas/gitmessage.schema.json
    │
    ├── commoncmd.json
    │   └── commoncmd.schema.json
    │       url: ./schemas/commoncmd.schema.json
    │
    ├── .aicode.json
    │   └── aicode.schema.json
    │       url: ./schemas/aicode.schema.json
    │
    ├── .project-atlas/repos.json
    │   └── repos.schema.json
    │       url: ./schemas/repos.schema.json
    │
    ├── .project-atlas/github.json
    │   └── github.schema.json
    │       url: ./schemas/github.schema.json
    │
    └── aiprompts.json
        └── aiprompts.schema.json
            url: ./schemas/aiprompts.schema.json
```

---

# 十一、补充：Explorer 中的 AICode 菜单完整递归关系

这个关系对后续迁移到 IDEA Plugin 很重要：

```text
Explorer
└── File / Folder
    └── Context Menu
        │
        ├── Git Tools
        │   │
        │   ├── Open Repository Home
        │   ├── Open Current Branch
        │   ├── Open Selected Directory on Remote
        │   ├── Open Selected File on Remote
        │   └── Copy Remote URL
        │
        └── AICode
            │
            ├── Add to AICode
            ├── Remove from AICode
            ├── Copy Relative Path
            └── Add to Terminal
```

这里两个 Submenu 都已经递归到底。

---

# 十二、完整 Submenu 关系

你当前 `package.json` 一共定义了 **6 个 Submenu**：

```text
Submenus
│
├── AICode
│   └── Explorer Actions
│       ├── Add to AICode
│       ├── Remove from AICode
│       ├── Copy Relative Path
│       └── Add to Terminal
│
├── Editor Indicator
│   ├── Show
│   └── Hidden
│
├── Filter
│   ├── All
│   ├── All [selected]
│   ├── Recent
│   ├── Recent [selected]
│   ├── Favorite
│   └── Favorite [selected]
│
├── Sort
│   ├── Name
│   ├── Name [selected]
│   ├── Path
│   ├── Path [selected]
│   ├── Recently
│   └── Recently [selected]
│
├── Git Tools
│   ├── Open Repository Home
│   ├── Open Current Branch
│   ├── Open Selected Directory on Remote
│   ├── Open Selected File on Remote
│   └── Copy Remote URL
│
└── Group By
    ├── Tag
    ├── Group
    └── Domain
```

---

# 十三、最终 UI 总架构

把上面的内容压缩成**真正用于后续 IDEA Plugin 迁移的 UI 架构模型**，就是：

```text
VS Code
│
├── Activity Bar
│   │
│   ├── Project Atlas: Templates
│   │   │
│   │   ├── Common Commands
│   │   │   ├── Tree
│   │   │   │   └── Common Command Tree Item
│   │   │   │       └── Context Menu
│   │   │   │           ├── Insert Common Command
│   │   │   │           ├── Edit Common Command
│   │   │   │           └── Delete Common Command
│   │   │   └── View Title Toolbar
│   │   │       ├── Add
│   │   │       ├── Edit
│   │   │       ├── Collapse / Expand
│   │   │       └── Refresh
│   │   │
│   │   ├── Git Messages
│   │   │   ├── Tree
│   │   │   │   └── Git Message Tree Item
│   │   │   │       └── Context Menu
│   │   │   │           ├── Copy
│   │   │   │           ├── Edit
│   │   │   │           └── Delete
│   │   │   └── View Title Toolbar
│   │   │       ├── Add
│   │   │       ├── Edit
│   │   │       ├── Collapse / Expand
│   │   │       ├── Refresh
│   │   │       └── List / Group
│   │   │
│   │   └── AI Prompts
│   │       ├── Tree
│   │       │   └── AI Prompt Tree Item
│   │       │       └── Context Menu
│   │       │           ├── Copy
│   │       │           ├── Edit
│   │       │           ├── Edit Tags
│   │       │           ├── Duplicate
│   │       │           └── Delete
│   │       └── View Title Toolbar
│   │           ├── Add
│   │           ├── List / Group
│   │           ├── Edit JSON
│   │           ├── Search
│   │           ├── Refresh
│   │           └── Collapse / Expand
│   │
│   ├── Project Atlas: AICode
│   │   │
│   │   ├── Context Files
│   │   │   ├── Tree
│   │   │   │   └── Context Tree Item
│   │   │   │       └── Context Menu
│   │   │   │           ├── Group Actions
│   │   │   │           │   ├── Create
│   │   │   │           │   ├── Rename
│   │   │   │           │   ├── Duplicate
│   │   │   │           │   └── Delete
│   │   │   │           ├── Add Missing Files
│   │   │   │           ├── Remove File
│   │   │   │           ├── Copy Relative Path
│   │   │   │           └── Remove Directory
│   │   │   └── View Title Toolbar
│   │   │       ├── Select Group
│   │   │       ├── Open Configuration
│   │   │       ├── Copy Markdown
│   │   │       ├── Copy File List
│   │   │       ├── Expand
│   │   │       ├── Collapse
│   │   │       ├── Refresh
│   │   │       └── Editor Indicator
│   │   │           ├── Show
│   │   │           └── Hidden
│   │   │
│   │   └── Compare Results
│   │       ├── Tree
│   │       │   └── Compare Result Tree Item
│   │       │       └── No configured Context Menu
│   │       └── View Title Toolbar
│   │           ├── Refresh
│   │           ├── Compare Branches
│   │           └── Clear
│   │
│   └── Project Atlas: Projects
│       │
│       ├── Projects
│       │   ├── Tree
│       │   │   └── Project Tree Item
│       │   │       └── Context Menu
│       │   │           ├── Open Current Window
│       │   │           ├── Open New Window
│       │   │           ├── Edit
│       │   │           ├── Favorite
│       │   │           ├── Edit Tags
│       │   │           ├── Duplicate
│       │   │           ├── Copy Path
│       │   │           ├── Reveal
│       │   │           ├── Terminal
│       │   │           ├── Remove
│       │   │           └── Delete
│       │   └── View Title Toolbar
│       │       ├── Save Current
│       │       ├── Search
│       │       ├── List / Tags
│       │       ├── Open Data
│       │       ├── Filter
│       │       │   ├── All
│       │       │   ├── Recent
│       │       │   └── Favorite
│       │       ├── Refresh
│       │       ├── Refresh Saved Repositories
│       │       ├── Add Folder
│       │       └── Sort
│       │           ├── Name
│       │           ├── Path
│       │           └── Recently
│       │
│       ├── Git Repositories
│       │   ├── Tree
│       │   │   └── Repository Tree Item
│       │   │       └── Context Menu
│       │   │           ├── Delete
│       │   │           ├── Edit
│       │   │           ├── Edit Tags
│       │   │           └── Clone
│       │   └── View Title Toolbar
│       │       ├── Add Repository
│       │       ├── Open Data
│       │       ├── Collapse
│       │       ├── Refresh
│       │       └── Group By
│       │           ├── Tag
│       │           ├── Group
│       │           └── Domain
│       │
│       └── GitHub Repositories
│           ├── Tree
│           │   └── GitHub Repository Tree Item
│           │       └── Context Menu
│           │           ├── Add to Git Repositories
│           │           ├── Copy SSH URL
│           │           ├── Open on GitHub
│           │           └── Clone
│           └── View Title Toolbar
│               ├── Search
│               ├── Open Configuration
│               ├── Expand
│               ├── Collapse
│               ├── Refresh
│               └── Open Settings
│
├── Explorer
│   └── File / Folder
│       └── Context Menu
│           ├── Copy as Markdown
│           ├── Git Tools
│           │   ├── Open Repository Home
│           │   ├── Open Current Branch
│           │   ├── Open Selected Directory
│           │   ├── Open Selected File
│           │   └── Copy Remote URL
│           └── AICode
│               ├── Add to AICode
│               ├── Remove from AICode
│               ├── Copy Relative Path
│               └── Add to Terminal
│
├── Editor
│   └── Editor Title
│       ├── Write CHANGELOG.md Preview
│       └── Cancel CHANGELOG.md Preview
│
├── Source Control
│   └── Git
│       └── SCM Title
│           └── Select Git Message
│
├── Terminal
│   └── Terminal Selection
│       └── Context Menu
│           └── Add Terminal Selection to Common Command
│
├── Command Palette
│   ├── Visible Commands
│   └── Hidden Commands
│
├── Keyboard Shortcuts
│   ├── Cmd/Ctrl + Shift + Z → Add to AICode
│   ├── Cmd/Ctrl + Shift + X → Remove from AICode
│   ├── Shift + Cmd/Ctrl + H → Open Repository Home
│   ├── Shift + Cmd/Ctrl + B → Open Current Branch
│   ├── Cmd/Ctrl + Shift + L → Search Projects
│   ├── Cmd/Ctrl + Shift + T → Switch List / Tags View
│   └── Cmd/Ctrl + Shift + , → Open Project Atlas Projects View
│
├── Settings
│   └── Project Atlas
│       └── GitHub
│           ├── HTTP Proxy
│           ├── Socket Proxy
│           ├── Proxy Enabled
│           ├── Token
│           └── User
│
└── JSON Validation
    ├── project.json → project.schema.json
    ├── gitmessage.json → gitmessage.schema.json
    ├── commoncmd.json → commoncmd.schema.json
    ├── .aicode.json → aicode.schema.json
    ├── repos.json → repos.schema.json
    ├── github.json → github.schema.json
    └── aiprompts.json → aiprompts.schema.json
```

## 最关键的迁移模型

因此，这个插件后续如果作为 **VS Code → IntelliJ IDEA Plugin** 的功能迁移基准，应该按照下面的映射关系拆，而不是按照 `commands / menus / views` 平铺：

```text
VS Code UI
│
├── Activity Bar
│   └── Container
│       └── View
│           ├── Tree
│           │   └── Tree Item
│           │       └── Tree Item Context Menu
│           │           └── Actions
│           │
│           └── View Title Toolbar
│               └── Actions / Submenus
│
├── Explorer
│   └── Context Menu
│       └── Actions / Submenus
│
├── Editor
│   └── Editor Title
│       └── Actions
│
├── Source Control
│   └── SCM Title
│       └── Actions
│
├── Terminal
│   └── Context Menu
│       └── Actions
│
├── Command Palette
│   └── Commands
│
├── Keyboard Shortcuts
│   └── Command Bindings
│
├── Settings
│   └── Configuration
│
└── JSON Validation
    └── Schema Associations
```
