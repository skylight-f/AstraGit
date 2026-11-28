# AstraGit 桌面组件库

桌面渲染层的通用组件集中在本目录，按组件文件直接导入。组件外观和交互由设计指南约定，颜色、字阶、圆角及动效使用项目已有变量。[界面设计与样式指南](../../../../../docs/DESIGN.md)

| 需求 | 组件与用法 |
| --- | --- |
| 按钮与切换项 | `Button` 支持 `primary`、`secondary`、`danger`、`ghost`。工具栏、分类导航等使用 `ghost`，通过 `aria-current`、`aria-pressed` 或 `aria-expanded` 表达状态。异步操作传入 `busy`。[Button](./Button.tsx) |
| 文件列表选中行 | `SelectableRow` 接收 `selected`，统一绘制浅蓝色圆角底色。行内按钮继续通过 `aria-pressed` 表达选中状态，并保留键盘焦点。贮藏、提交历史和本地变更共用此组件。[SelectableRow](./SelectableRow.tsx) |
| 原生表单控件 | `TextInput` 和 `CheckboxField` 透传相应原生控件属性。文本控件配合 `label` 或可访问名称，校验错误通过 `aria-invalid` 和 `aria-describedby` 关联提示。`CheckboxField` 的子内容是复选框标签。[FormControls](./FormControls.tsx) |
| 工具栏筛选与搜索 | `Select` 和 `SearchInput` 使用 `density="compact"`，通过 `--base-control-compact-height` 对齐到 28 px，并共用边框、圆角和焦点样式。搜索控件提供可访问名称。[FormControls](./FormControls.tsx) |
| 下拉选择 | `Select` 接收 `ariaLabel`、`value`、`options` 和 `onChange(value)`，共享 `ZeusSelect` 的视觉、键盘和定位行为。使用 `ZeusSelect` 提供图标触发器、分组、置顶等功能。[FormControls](./FormControls.tsx) · [ZeusSelect](./ZeusSelect.tsx) |
| 表单弹窗 | `FormDialog` 提供标题、可滚动字段区、取消与提交按钮。提交回调处理 `preventDefault()`，通过 `submitDisabled` 和 `busy` 表达可用状态。[FormDialog](./FormDialog.tsx) |
| 自定义弹窗 | `ModalPortal` 处理主题、遮罩、焦点隔离和关闭。为弹窗提供可访问名称，给需要优先聚焦的可操作控件添加 `data-modal-initial-focus`。[ModalPortal](./ModalPortal.tsx) |
| 菜单与动效 | `MenuSurface` 处理菜单定位、方向键和焦点，`MotionPresence` 保留退出动效所需的表面。[MenuSurface](./MenuSurface.tsx) · [MotionPresence](./MotionPresence.tsx) |
| 错误与折叠 | 使用 `VisibleApplicationError` 表示可见的失败信息，使用 `Collapsible` 展开或收起次级内容。[ApplicationErrorDialog](./ApplicationErrorDialog.tsx) · [Collapsible](./Collapsible.tsx) |

新增基础组件时，将布局和业务状态留给调用方。已有组件可以通过变体、原生属性和局部布局适配。Git 业务共用的弹窗外壳、文件状态和分栏在 `features/git/components/` 维护。[Git 操作弹窗](../features/git/components/GitOperationDialog.tsx)

实际复用入口包括通用设置的语言与复选框、AI 设置的连接表单、工作台工具栏和新建分支表单。[通用设置](../features/settings/Settings.tsx) · [AI 设置](../features/models/ModelSettings.tsx) · [工作台](../features/git/workbench/ProjectGitWorkbench.tsx) · [分支表单](../features/git/repository/GitRepositoryControls.tsx)
