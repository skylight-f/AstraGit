# AstraGit 界面设计与样式指南

本指南适用于 AstraGit 新增和修改的界面，包括主窗口、设置、Git 面板、菜单、弹窗和原生辅助窗口。设计、实现和界面验收都以本指南为准。涉及全局视觉规则变更时，在同一变更中更新指南和对应样式。

## 视觉基线

- 保持桌面 Git 工作台的紧凑布局。使用浅灰画布、近白工作面、深色正文和次级灰色辅助信息。工具栏、侧栏和内容区用对齐、留白及细分隔线建立层级。
- 品牌蓝用于主要动作、当前选中项和需要突出显示的交互。列表选中时延续浅蓝底与强调色，普通悬停使用较弱的背景变化。焦点使用独立、清晰的轮廓，悬停、选中和焦点可以同时辨认。
- 阴影集中用于菜单、下拉浮层和弹窗。工作台的相邻面板优先用细边框和窄间距分隔。保留传达目标、操作、状态和下一步所需的文案。
- 主工作台与设置当前使用 `theme-light`。继承所在区域的外观。已有外观参数的组件按调用方传入的主题渲染，弹窗通过 `ModalPortal` 继承主题。涉及深色或跟随系统时，按该组件实际支持的入口验证。[应用外壳](../apps/desktop/src/renderer/app/App.tsx) · [主题映射](../apps/desktop/src/renderer/styles/agentdesk-theme.css)

## 样式落点与设计变量

先复用同类界面的组件和语义变量。业务样式随组件放在功能目录，由组件引用本地 CSS，选择器限定在本功能的根节点内。共用控件变体和状态由 `ui/` 管理，应用外壳的布局和密度由 `app/` 管理。

同一场景在项目内必须保持一致。新增或修改交互前，先查找其他入口并复用现有组件；修改共用行为时，同时核对同类入口的状态、文案、按钮位置、键盘操作和错误反馈。

| 用途 | 使用方式 |
| --- | --- |
| 品牌色 | `--zeus-brand-primary` 由品牌样式定义，当前为 `#2d64ce`。业务层使用对应的强调色或选中色变量。[brand.css](../apps/desktop/src/renderer/styles/brand.css) |
| Git 工作面 | 背景使用 `--zeus-product-canvas`、`--zeus-product-panel` 或 `--zeus-product-panel-muted`。主次文字使用 `--zeus-product-text` 和 `--zeus-product-muted`，选中背景使用 `--zeus-product-selected`。[主题映射](../apps/desktop/src/renderer/styles/agentdesk-theme.css) |
| 分隔与控件 | 面板分隔使用 `--zeus-workspace-divider`，控件使用 `--zeus-control-bg`、`--zeus-control-border` 和 `--zeus-control-radius`。跟随共用控件的焦点、禁用和错误样式。[primitives.css](../apps/desktop/src/renderer/ui/primitives.css) |
| 外壳与紧凑布局 | 标题栏、项目页签、搜索和工作台局部容器沿用 `--ag-*`。工具尺寸、局部控件圆角、外壳面板圆角分别使用 `--ag-tool-size`、`--ag-control-radius` 和 `--ag-card-radius`。[app.css](../apps/desktop/src/renderer/app/app.css) |
| 字体与字阶 | 界面使用系统字体栈 `--zeus-font-family-ui`，代码与命令内容使用等宽字体栈 `--zeus-font-family-mono`。新界面通过 `--zeus-type-size-*` 和 `--zeus-type-weight-*` 延续同类界面的字阶。[primitives.css](../apps/desktop/src/renderer/ui/primitives.css) |
| 间距与弹窗 | 普通内容间距优先使用 `--zeus-space-1` 至 `--zeus-space-8`，由 4px 递增。表单弹窗沿用 `--zeus-dialog-*`。紧凑工具栏和数据行沿用各自布局的尺寸。[primitives.css](../apps/desktop/src/renderer/ui/primitives.css) · [gitWorkspace.css](../apps/desktop/src/renderer/features/git/workbench/gitWorkspace.css) |
| Git 差异 | 新增用 `--git-addition`，删除用 `--git-deletion`，同时保留正负号、行号或状态文字。继续用较浅的整行底色区分变更，局部替换用更深的高亮。[全局样式](../apps/desktop/src/renderer/styles/styles.css) · [差异样式](../apps/desktop/src/renderer/features/git/diff/gitTextDiff.css) |

新增颜色、圆角、阴影或交互状态前，先查共用变量与相邻组件。跨界面共用的新视觉值由对应的主题或原语层维护。局部尺寸仅作用于该功能，动态的分栏尺寸和位置可通过局部 CSS 自定义属性传递。保留共用组件的选择器优先级，避免在业务样式中叠加 `!important` 覆盖基础状态。

## 组件与交互

基础组件的可用变体、原生属性和调用示例见 [AstraGit 桌面组件库](../apps/desktop/src/renderer/ui/README.md)。

| 场景 | 实现约定 |
| --- | --- |
| 按钮 | 常规操作使用 `Button`。确认区通常只强调一个主动作，提交或保存用 `primary`，取消或关闭用 `secondary`，丢弃、删除等危险动作用 `danger`。工具栏和分类导航等无边框按钮使用 `ghost`。异步提交通过 `busy` 防止重复触发，并显示当前操作状态。[Button](../apps/desktop/src/renderer/ui/Button.tsx) |
| 表单与弹窗 | 标准表单复用 `FormDialog`，文本框和带标签的复选框使用 `TextInput` 与 `CheckboxField`。复杂 Git 操作使用基于 `ModalPortal` 的 `GitOperationDialog`。弹窗提供可访问名称，主体内容可滚动，底部操作保持可达。危险确认说明操作对象和后果，处理期间按业务语义锁定表单或提供明确的中止入口。[FormDialog](../apps/desktop/src/renderer/ui/FormDialog.tsx) · [FormControls](../apps/desktop/src/renderer/ui/FormControls.tsx) · [GitOperationDialog](../apps/desktop/src/renderer/features/git/components/GitOperationDialog.tsx) |
| 选项与菜单 | 表单单选使用 `Select`，模型和图标类入口可直接使用 `ZeusSelect`。两者共用自绘圆角浮层、细边框和柔和阴影。普通悬停使用中性底色，选中使用整行浅蓝底及勾选，焦点使用独立轮廓。长列表在视口内滚动，可按名称搜索。动作菜单用 `MenuSurface`，Git 右键操作沿用 `GitContextMenu`。[ZeusSelect](../apps/desktop/src/renderer/ui/ZeusSelect.tsx) · [MenuSurface](../apps/desktop/src/renderer/ui/MenuSurface.tsx) · [GitContextMenu](../apps/desktop/src/renderer/features/git/components/GitContextMenu.tsx) |
| 工具栏筛选与搜索 | 同排的下拉 `Select` 和搜索框 `SearchInput` 使用 `density="compact"`，通过同一个 26px 尺寸变量对齐。工具栏负责分配宽度与换行。[FormControls](../apps/desktop/src/renderer/ui/FormControls.tsx) |
| 文件、历史与差异 | Git 状态图标沿用 `GitFileStatusIcon`，提交历史沿用 `GitHistoryTable`，文件差异沿用 `SideBySideDiff`。保留现有选择、定位、复制和滚动方式，并在支持的场景提供左右两栏与统一视图。[文件状态图标](../apps/desktop/src/renderer/features/git/components/GitFileStatusIcon.tsx) · [历史表格](../apps/desktop/src/renderer/features/git/history/GitHistoryTable.tsx) · [差异查看器](../apps/desktop/src/renderer/features/git/diff/ProjectGitDiffViewer.tsx) |
| 文件列表选中态 | 贮藏、提交历史和本地变更的文件行统一使用 `SelectableRow`。选中仅使用整行浅蓝色圆角底，禁止附加左侧竖线。键盘焦点保留独立轮廓，选中时悬停保持选中底色。[SelectableRow](../apps/desktop/src/renderer/ui/SelectableRow.tsx) |
| 分栏与错误 | Git 工作区的可调面板使用 `GitPaneSeparator`，提供拖动、方向键和恢复默认入口。失败反馈沿用应用错误组件，提示失败的操作及适用的恢复入口。合理区分加载中、空结果、已完成和失败。[分栏控件](../apps/desktop/src/renderer/features/git/components/GitPaneSeparator.tsx) · [错误组件](../apps/desktop/src/renderer/ui/ApplicationErrorDialog.tsx) |

- 通用操作图标使用现有 Phosphor 图标。带文字按钮的装饰图标标为 `aria-hidden`，纯图标按钮提供本地化的可访问名称。文件状态、冲突和危险操作同时用文字、符号或带名称的图标表达。
- 保留键盘焦点可见性。选择控件用与行为匹配的 ARIA 状态，菜单和弹窗检查 `Tab`、方向键及 `Esc` 的相应行为。关闭弹窗后将焦点归还给合适的触发位置。
- 加载、刷新与提交使用就地状态，保留用户当前的工作上下文。浮层入场和退场复用 `MotionPresence`，动效时长沿用 `--zeus-motion-*`，遵循 `prefers-reduced-motion`。关闭中的界面立即停止接收交互。[MotionPresence](../apps/desktop/src/renderer/ui/MotionPresence.tsx) · [交互样式](../apps/desktop/src/renderer/ui/primitives.css)
- 可终止的 Git 操作开始后，原执行按钮切换为「终止」，统一使用 `GitOperationStopButton`。发出请求后显示「正在终止…」并防止重复请求，任务结束后按结果恢复执行、重试或关闭入口。批次保留已执行结果和未执行项的状态。独立的进度提示显示当前仓库和操作。[操作进度与终止按钮](../apps/desktop/src/renderer/features/git/components/GitOperationProgress.tsx)
- 左下角活动栏的「应用更新」在设置按钮上方，更新就绪时以品牌蓝标示。更新弹窗在活动栏右侧靠下打开，顶部居中显示应用图标和版本，长发布说明在正文内滚动，底部保留当前状态和操作。只有就绪状态提供重启确认。[应用更新弹窗](../apps/desktop/src/renderer/features/updates/ApplicationUpdateDialog.tsx)
- macOS 原生辅助窗口沿用系统控件、系统字体和语义色，状态文本和操作名称与主界面保持一致。[原生更新进度窗口](../apps/desktop/native/UpdateProgressPanel.swift)

## 布局与文案

- 应用级入口放在现有外壳。仓库级操作归入工作台工具栏，文件或提交操作放在对应列表行、右键菜单或详情区。工具栏按动作分组，低频入口沿用「操作」菜单。
- 保持仓库导航、记录列表和详情区的边界。网格与弹性布局允许子面板收缩，长路径和分支名按控件需要截断或换行，并保留查看完整值的方式。代码差异在内容区滚动，面板标题、主要操作和弹窗底部保持可达。
- 自定义标题栏使用现有拖拽区域。加入搜索、按钮或菜单触发器时给可交互区域设置 `-webkit-app-region: no-drag`。[标题栏样式](../apps/desktop/src/renderer/app/app.css)
- 界面新增文案同时提供简体中文和英文，沿用「暂存」「贮藏」「推送」等现有术语。按钮优先用能描述结果的动词，如「导出补丁」「删除分支」。错误提示说明正在处理的对象、失败原因及可行的下一步。

## 界面验收

使用 `pnpm dev` 的实际 Electron 窗口和现有项目数据，通过正常入口验收受影响的界面。

- 对照相邻现有界面，核对画布、面板、文字、间距、按钮层级和选中状态。检查普通窗口和主窗口允许的最小尺寸，目前为 960 × 640。[窗口配置](../apps/desktop/src/main/main.ts)
- 用中英文界面检查标题、动作和长名称的显示。涉及下拉、弹窗和分栏时，检查边缘位置、滚动范围、鼠标与键盘操作，以及关闭后的焦点。
- 验证变更涉及的加载、空数据、失败、禁用、选中和处理中状态。涉及 Git 写操作时，通过现有测试入口或用户明确指定的验证仓库核对结果。
- 修改共用组件、全局 token 或主题时，至少验证变更入口和另一个现有调用场景。同类交互还要逐一核对受影响入口的实现，确认共用状态和行为一致。涉及主题与动效时，同时验证受影响的外观和减少动态效果设置。

验收记录写明在哪个真实入口验证了哪些状态，以及哪些场景受条件限制。
