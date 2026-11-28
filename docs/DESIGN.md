# AstraGit 界面设计与样式指南

本指南适用于 AstraGit 的主窗口、设置、Git 面板、菜单、弹窗和原生辅助窗口。全局视觉规则以 MasterGo《Web 端组件应用指南》的「Global Style 全局样式」为最新来源。本页记录这些规则在桌面端的取值与实现。涉及全局规则变更时，同步更新对应样式。[MasterGo 全局样式](https://mastergo.com/file/154565845141502?page_id=17%3A331310&devMode=true)

## 视觉基线

- 标题栏和活动栏使用浅灰背景和深灰文字。项目页签与 Git 操作共用一个工具栏卡片，仓库、分支与引用、文件状态各用独立的白色卡片。项目提交的仓库列表与详情也各用独立卡片。使用细边框、圆角和窄间距区分相邻卡片，提交区使用浅灰底。
- 品牌蓝用于主要动作、当前选中项和需要突出显示的交互。列表选中时使用浅蓝底与强调色，普通悬停使用较弱的背景变化。活动栏选中项使用蓝底白色图标。焦点使用独立、清晰的轮廓。
- 阴影集中用于菜单、下拉浮层和弹窗。工作台的相邻面板优先用细边框和窄间距分隔。保留传达目标、操作、状态和下一步所需的文案。
- 主工作台与设置当前使用 `theme-light`。继承所在区域的外观。已有外观参数的组件按调用方传入的主题渲染，弹窗通过 `ModalPortal` 继承主题。涉及深色或跟随系统时，按该组件实际支持的入口验证。[应用外壳](../apps/desktop/src/renderer/app/App.tsx) · [主题映射](../apps/desktop/src/renderer/styles/theme.css)

## 样式落点与设计变量

先复用同类界面的组件和语义变量。业务样式随组件放在功能目录，由组件引用本地 CSS，选择器限定在本功能的根节点内。共用控件变体和状态由 `ui/` 管理，应用外壳的布局和密度由 `app/` 管理。

项目维护的 CSS 自定义属性统一以 `--base-` 开头。全局变量由 `base.css` 定义，`theme.css` 负责外观映射，`ui/` 负责共用组件。固定尺寸、内外边距、布局水槽和图标优先使用 4 px 网格。字阶、圆角、细线和投影使用各自的规范值。分栏比例、内容测量和自适应布局按实际可用空间计算。

同一场景在项目内必须保持一致。选用变量前阅读设计稿的「描述」「应用场景」和组件实例。先判断元素是正文、工具栏动作、表单控件还是主要操作，再决定字阶、尺寸和留白。新增或修改交互前，先查找其他入口并复用现有组件。修改共用行为时，同时核对同类入口的状态、文案、按钮位置、键盘操作和错误反馈。

| MasterGo 章节 | AstraGit 实现 |
| --- | --- |
| 色彩 | P6 `#3370FF` 用于品牌强调、勾选和焦点。浅色悬停和选中分别取 P1 `#F0F7FF` 与 P2 `#D6E8FF`。带白字的主按钮用 P7 `#2152D9`，确保小字号文本对比度。成功、错误、警告使用对应 6 级色阶，浅色背景使用对应 1 级色阶。状态字用同色系深色，Git 差异同时保留符号和行号。[色板](https://mastergo.com/file/154565845141502?page_id=17%3A331310&layer_id=21%3A057808&devMode=true) |
| 字体 | 系统 UI 字体优先，代码、命令和分支引用等需要对齐的内容使用等宽字体。正文 14/22 px，小字 12/20 px，小标题 16/24 px，弹窗标题 20/28 px。常规与强调字重为 400 和 600。主次文字和弱提示沿用 90%、60%、40% 黑色，禁用保留 AstraGit 的 22%。[字体](https://mastergo.com/file/154565845141502?page_id=85%3A052743&devMode=true) |
| 圆角 | 基础值为 0、2、4、8、12、16 px 和 50%。侧面抽屉用 0 px，极小控件用 2 px，按钮和输入用 4 px，卡片、表单弹窗与下拉面板用 8 px。几何比例要求完全圆形或胶囊的组件使用相应的形状。[圆角](https://mastergo.com/file/154565845141502?page_id=17%3A331311&devMode=true) |
| 投影 | 按指南变量表，面板、非模态浮层取 `0 2px 6px rgb(0 0 0 / 10%)`，模态取 `0 4px 12px rgb(0 0 0 / 10%)`。桌面工作台相邻卡片用边框和间距分组。投影主要用于悬浮面板、菜单和弹窗。[投影](https://mastergo.com/file/154565845141502?page_id=85%3A056976&devMode=true) |
| 边框 | 输入框、次按钮和工作台卡片以 1 px 边框标示边界。模态和下拉面板外缘使用 0 px。焦点环与错误状态描边独立设置。[边框](https://mastergo.com/file/154565845141502?page_id=85%3A057244&devMode=true) |
| 间距 | 组件间距使用 `--base-space-0` 至 `--base-space-8`，按 4 px 递增。图标与文字通常相隔 8 px，紧凑区可用 4 px。[间距](https://mastergo.com/file/154565845141502?page_id=233%3A771696&devMode=true) |
| 边距 | 从同一 4 px 尺度取值。12 px 是边距页给出的常规组件场景，标准弹窗左右采用 24 px。紧凑工具与搜索使用 8 px，带箭头的无边框按钮实例使用 4 px。页面安全边距与组件内部边距独立计算。[边距](https://mastergo.com/file/154565845141502?page_id=233%3A771695&devMode=true) · [按钮实例](https://mastergo.com/file/154565845141502?page_id=233%3A783447&layer_id=233%3A804330&devMode=true) |
| 分割线 | 内容区分割线使用 `--base-divider-width` 与 `--base-divider-color`。浅色线为 1 px、6% 黑色。[分割线](https://mastergo.com/file/154565845141502?page_id=233%3A895504&devMode=true) |
| 布局 | 网页栅格示例以 1200 px 和固定侧栏为基线。AstraGit 设置页采用 12 px 外边距，紧凑工作台采用 8 px，页签和 Git 命令行共用外层卡片内边距。工作台支持最小 960 × 640、窄宽换位和分栏独立滚动，拖拽热区使用原有尺寸。[栅格与布局](https://mastergo.com/file/154565845141502?page_id=1%3A823940&layer_id=5%3A056805&devMode=true) |

实现入口见 [base.css](../apps/desktop/src/renderer/styles/base.css)、[theme.css](../apps/desktop/src/renderer/styles/theme.css) 和 [应用外壳](../apps/desktop/src/renderer/app/app.css)。主题感知的业务样式使用角色变量，包括 `--base-text-*`、`--base-product-*`、`--base-status-*` 和 `--base-control-*`。

新增颜色、圆角、阴影或交互状态前，先查共用变量与相邻组件。跨界面共用的新视觉值由对应的主题或原语层维护。局部尺寸仅作用于该功能，动态的分栏尺寸和位置可通过局部 CSS 自定义属性传递。保留共用组件的选择器优先级，避免在业务样式中叠加 `!important` 覆盖基础状态。

## 组件与交互

基础组件的可用变体、原生属性和调用示例见 [AstraGit 桌面组件库](../apps/desktop/src/renderer/ui/README.md)。

| 场景 | 实现约定 |
| --- | --- |
| 按钮 | 常规操作使用 `Button`。设计稿 Default 用于常规场景，Small 用于紧凑场景。确认区只突出一个主动作，提交或保存用 `primary`，取消或关闭用 `secondary`，丢弃、删除等危险动作用 `danger`。工具栏和分类导航等低优先级入口使用无边框样式。异步提交通过 `busy` 防止重复触发，并显示当前操作状态。[按钮设计](https://mastergo.com/file/154565845141502?page_id=233%3A783447&layer_id=233%3A804330&devMode=true) · [Button](../apps/desktop/src/renderer/ui/Button.tsx) |
| 表单与弹窗 | 标准表单复用 `FormDialog`，文本框和带标签的复选框使用 `TextInput` 与 `CheckboxField`。复杂 Git 操作使用基于 `ModalPortal` 的 `GitOperationDialog`。弹窗提供可访问名称，主体内容可滚动，底部操作保持可达。危险确认说明操作对象和后果，处理期间按业务语义锁定表单或提供明确的中止入口。[FormDialog](../apps/desktop/src/renderer/ui/FormDialog.tsx) · [FormControls](../apps/desktop/src/renderer/ui/FormControls.tsx) · [GitOperationDialog](../apps/desktop/src/renderer/features/git/components/GitOperationDialog.tsx) |
| 选项与菜单 | 表单单选使用 `Select`，模型和图标类入口可直接使用 `ZeusSelect`。两者共用圆角浮层与非模态投影。普通悬停使用中性底色，选中使用整行浅色强调面及勾选，焦点使用独立轮廓。长列表在视口内滚动，可按名称搜索。动作菜单用 `MenuSurface`，Git 右键操作沿用 `GitContextMenu`。[ZeusSelect](../apps/desktop/src/renderer/ui/ZeusSelect.tsx) · [MenuSurface](../apps/desktop/src/renderer/ui/MenuSurface.tsx) · [GitContextMenu](../apps/desktop/src/renderer/features/git/components/GitContextMenu.tsx) |
| 工具栏筛选与搜索 | 同排的下拉 `Select` 和搜索框 `SearchInput` 使用 `density="compact"`，通过同一个 28 px 尺寸变量对齐。工具栏负责分配宽度与换行。[FormControls](../apps/desktop/src/renderer/ui/FormControls.tsx) |
| 文件、历史与差异 | Git 状态图标沿用 `GitFileStatusIcon`，提交历史沿用 `GitHistoryTable`，文件差异沿用 `SideBySideDiff`。保留现有选择、定位、复制和滚动方式，并在支持的场景提供左右两栏与统一视图。[文件状态图标](../apps/desktop/src/renderer/features/git/components/GitFileStatusIcon.tsx) · [历史表格](../apps/desktop/src/renderer/features/git/history/GitHistoryTable.tsx) · [差异查看器](../apps/desktop/src/renderer/features/git/diff/ProjectGitDiffViewer.tsx) |
| 文件列表选中态 | 贮藏、提交历史和本地变更的文件行统一使用 `SelectableRow`。选中仅使用整行浅蓝色圆角底，禁止附加左侧竖线。键盘焦点保留独立轮廓，选中时悬停保持选中底色。[SelectableRow](../apps/desktop/src/renderer/ui/SelectableRow.tsx) |
| 分栏与错误 | 可调面板使用 `GitPaneSeparator`，分隔条中央的三点拖拽柄沿分隔条方向排列。提供拖动、方向键和恢复默认入口。失败反馈沿用应用错误组件，提示失败的操作及适用的恢复入口。合理区分加载中、空结果、已完成和失败。[分栏控件](../apps/desktop/src/renderer/features/git/components/GitPaneSeparator.tsx) · [错误组件](../apps/desktop/src/renderer/ui/ApplicationErrorDialog.tsx) |

- 通用操作图标使用现有 Phosphor 图标。带文字按钮的装饰图标标为 `aria-hidden`，纯图标按钮提供本地化的可访问名称。文件状态、冲突和危险操作同时用文字、符号或带名称的图标表达。
- 保留键盘焦点可见性。选择控件用与行为匹配的 ARIA 状态，菜单和弹窗检查 `Tab`、方向键及 `Esc` 的相应行为。关闭弹窗后将焦点归还给合适的触发位置。
- 加载、刷新与提交使用就地状态，保留用户当前的工作上下文。浮层入场和退场复用 `MotionPresence`，动效时长沿用 `--base-motion-*`，遵循 `prefers-reduced-motion`。关闭中的界面立即停止接收交互。[MotionPresence](../apps/desktop/src/renderer/ui/MotionPresence.tsx) · [交互样式](../apps/desktop/src/renderer/ui/primitives.css)
- 可终止的 Git 操作开始后，原执行按钮切换为「终止」，统一使用 `GitOperationStopButton`。发出请求后显示「正在终止…」并防止重复请求，任务结束后按结果恢复执行、重试或关闭入口。批次保留已执行结果和未执行项的状态。独立的进度提示显示当前仓库和操作。[操作进度与终止按钮](../apps/desktop/src/renderer/features/git/components/GitOperationProgress.tsx)
- 检测到新版本时，左下角活动栏在设置按钮上方显示「应用更新」，更新就绪时以品牌色标示。手动检查和版本说明从设置进入。更新弹窗在活动栏右侧靠下打开，顶部居中显示应用图标和版本，长发布说明在正文内滚动，底部保留当前状态和操作。只有就绪状态提供重启确认。[应用更新弹窗](../apps/desktop/src/renderer/features/updates/ApplicationUpdateDialog.tsx)
- macOS 原生辅助窗口沿用系统控件、系统字体和语义色，状态文本和操作名称与主界面保持一致。[原生更新进度窗口](../apps/desktop/native/UpdateProgressPanel.swift)

## 布局与文案

- 应用级入口放在现有外壳。仓库级操作归入工作台工具栏，文件或提交操作放在对应列表行、右键菜单或详情区。工具栏按动作分组，低频入口沿用「操作」菜单。当前分支选择器固定在仓库列表上方，仓库树可以独立滚动。
- 平铺文件列表和差异标题优先显示文件名，目录作为次级文字，悬停或使用无障碍接口可获得完整路径。并排差异标出变更前后，新增、删除或重命名时保留各侧路径信息。增删计数靠近视图切换。选行提示、计数与动作保持在同一操作区，在窄栏内按需要换行。暂存或取消暂存是该区域的主要动作，放弃继续使用确认流程。
- 本地变更内容区宽度达到 860 px 时，文件列表占满左列，提交区停靠在右侧差异下方。较窄时提交区横跨两个面板，给表单和操作保留完整宽度。保留文件分栏、提交区高度调整和展开收起入口。
- 暂存视图的提交区用一行显示当前仓库、暂存状态和提交选项。提交选项使用无边框下拉触发器，标题区的辅助控件采用桌面小字 12/20 px。模型框随内容收缩，长名称截断并可悬停查看。说明正文使用 14/22 px，生成反馈显示在编辑框底部。底部多仓库提交用无边框样式靠左，取消和主提交动作成组靠右，推送选项和远程分支在两组按钮之间，空间不足时移到按钮行上方。提交区可操作控件统一为 24 px，底部按钮使用 Small 的 14/22 px、常规字重和 8 px 左右内边距。[按钮场景和尺寸](https://mastergo.com/file/154565845141502?page_id=233%3A783447&layer_id=233%3A804330&devMode=true)
- 拉取和推送共用 840 px 宽度、带方向图标的标题区和固定底部按钮区。主体可独立滚动。推送分支表统一普通行底色，用选中底色表达勾选状态。当前仓库全选和跨仓库选中计数放在表格下方。
- macOS 菜单随应用语言显示项目、视图、仓库、窗口和帮助入口。仓库菜单复用当前工作台工具栏的操作和可用状态。开发者工具与界面重载入口在开发版提供。
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

### 全局样式核对记录

1. **工作台与提交区。** 实际开发版检查项目页签、仓库与分支卡片、文件差异、暂存空态和提交区。卡片边缘到首个页签的距离实测从 21 px 减为 9 px。中英文 960 × 640 视口下，底部三个按钮均为 24 px，多仓库提交在左，取消与提交在右。提交选项、模型下拉和多仓库提交弹窗均验证了关闭后的焦点回退。
2. **拉取、推送与选择器。** 中英文开发版检查空闲状态、长分支名、选中行与固定操作区。960 × 640 时拉取与推送实测均为 840 px，底部可达。推送外缘实测圆角 8 px、边框 0 px、模态投影 0/4/12 px。键盘打开仓库选择器后，Esc 依次回到选择器和工具栏按钮。
3. **设置。** 检查导航选中、语言下拉、输入区域边界与组分割线。通过现有语言入口验证中英文布局。

桌面端采用独立的可调分栏布局，旧的局部样式仍存在自定义字阶、菜单定位和控件变体。上述记录覆盖实际验收的入口，深色、原生窗口、运行中和异常状态，以及逐控件无障碍对比度仍需按入口核对。MasterGo 模态投影示例和变量表的纵向偏移有差异，项目按变量表使用 4 px。
