# AstraGit

独立的本地 Git 桌面工作台，提供项目列表、变更与历史、Git 操作和 AI 提交说明。部分代码源自 Zeus；源码、依赖、构建和用户数据均由 AstraGit 自己管理。

## 当前状态

- 六个本地包：`desktop`、`git-server`、`git-core`、`ai-runtime`、`shared`、`storage`，统一使用 `@astragit/*`。
- 不需要 Zeus 工作树、构建产物或已安装应用；`zeus/` 本地链接已移除。
- Electron 经带随机令牌的本机 HTTP API 访问服务，Git 操作和 AI 文本生成已接通。
- 顶部 **仓库管理 / 项目提交** 切换；项目提交汇总当前项目内的多个仓库，支持勾选范围、AI 填写和逐仓库提交。
- 右上角 **设置 → 通用 → 界面语言** 支持跟随系统、简体中文和 English，立即生效并记住选择；模型配置位于 **设置 → AI 模型**。
- `pnpm build:app` 构建独立的 macOS `AstraGit.app`；`main` 推送触发自动发行，应用内提供更新检查、下载与安装。

## 开发

需要 Node.js 24、pnpm 10，以及本机 Git。使用 Codex 订阅模型时，需要另行安装可用的 Codex CLI。

```bash
pnpm install --frozen-lockfile
pnpm setup:desktop
pnpm check:isolation
pnpm dev
```

日常开发和界面验证优先使用 `pnpm dev`。`setup:desktop` 准备本项目使用的 Electron 二进制（未缓存时需要下载）。开发启动只编译 Main、preload 和本地服务依赖，Renderer 直接加载 Vite 页面，无需先打包应用。

macOS 首次启动会在 `.tmp/development-runtime` 准备独立的 **AstraGit Development.app**（后续复用缓存），使用本仓库图标和独立开发身份，方便区分正在运行的正式应用。它仍直接运行源码与 Vite，不生成正式发行包，也不覆盖 `/Applications`。

| 保存的代码 | 开发行为 |
| --- | --- |
| Renderer TSX / CSS | Vite / React Fast Refresh，通常保留组件状态 |
| Main / preload | 编译成功后自动退出旧 Electron、启动新进程 |
| shared / git-core / storage / ai-runtime / git-server | 按依赖顺序编译并同步本地包，成功后重启 Electron；shared 同时由 Vite 读取源码 |
| TypeScript、工作区包配置 | 自动重新编译并重启；依赖变化仍需先执行 `pnpm install` |

编译失败时保留正在运行的应用，终端显示错误；修复保存后自动重试。后端重启会重新建立 API 连接，已保存项目、草稿和设置从同一个开发数据目录恢复；尚未持久化的临时状态可能重置。退出开发应用或按 `Ctrl+C` 会关闭监听和 Vite，并等待当前 API/Git 操作结束、SQLite 和 AI 服务正常关闭。

默认 Vite 地址为 `http://127.0.0.1:5179`，开发数据为 `.tmp/electron-development-data`。就绪时终端显示 Main PID、页面地址和 API 地址；`.tmp/dev-session.json` 记录同样的开发状态，不含令牌。修改启动脚本本身后重新执行 `pnpm dev`。

系统钥匙串可能要求本人授权；应用已关闭本机服务后仍可能等待原生钥匙串返回。该系统授权不属于热更新完成的保证，验收边界见下方记录。

按变更风险运行 `pnpm lint`、`pnpm typecheck`、`pnpm test`。`typecheck` 和 `test` 会先构建本地服务依赖，干净目录无需预先准备声明文件。正式构建用于打包、签名、安装或明确要求的正式验收。

## macOS 应用构建

```bash
pnpm build:app
```

Apple Silicon 产物为 `release/mac-arm64/AstraGit.app`；Intel 为 `release/mac/AstraGit.app`。应用标识为 `com.astragit.desktop`，使用自己的图标、名称与数据目录。打包会创建独立的生产依赖目录并检查外部链接，最终封装为 `app.asar`，校验代码签名后清理临时目录。运行应用不需要 Node、pnpm、Vite 或源码工作树；Git 与可选的 Codex CLI 由本机提供。正式包始终加载包内页面，不使用 `VITE_DEV_SERVER_URL`。

这是可在本机直接运行的生产构建，尚未做 Developer ID 签名或 Apple 发行公证。构建命令不会生成 DMG、发布或安装到 `/Applications`。

## 同一项目的两种视图

打开项目后，顶部可以切换 **仓库管理** 和 **项目提交**。工作台保留原有暂存、分支、历史和逐块操作；项目提交只列出该项目目录内发现的仓库，不跨项目提交。

在项目提交中勾选仓库、目录或文件；点击文件查看实际提交差异。**全部工作区更改** 提交勾选文件的完整工作区版本，**仅已暂存内容** 只提交勾选文件的暂存版本，两者都保留未勾选文件的暂存内容。可以共用提交说明，也可以逐仓库填写。AI 根据勾选范围填写可编辑草稿。

从 Finder 启动时，应用会读取用户登录 shell 的工具路径，供 Git hooks 查找 `pnpm`、Node 等命令；不会关闭 hooks。若工具确实未安装，需先安装并重启应用。新分支名支持中文，并在输入时提示空格等非法字符。切换分支可能覆盖本地修改时保留 Git 保护，可从错误弹窗打开贮藏后再操作。

提交按钮先打开逐仓库确认页。批次记录每个仓库的提交结果与 SHA；推送失败后 **重试失败的推送** 只执行 push。需要更新子模块引用时勾选对应选项，预览会列出父仓库引用，执行顺序为子模块、父仓库。普通嵌套仓库没有这种依赖。

## 自动发行与应用更新

公开仓库：[skylight-f/AstraGit](https://github.com/skylight-f/AstraGit)。`main` 推送经过 `verify:publish` 后，Actions 自动准备版本提交、构建 arm64/x64 DMG、校验摘要并发布 GitHub Release 与 `astragit-release-manifest.json`。失败重跑复用版本候选，不强推分支、不覆盖已公开的 Release。可手动重跑 Release 工作流；仓库变量 `ASTRAGIT_AUTO_RELEASE=false` 可暂停自动发行。

应用启动时及每四小时检查更新，也可点击右上角 **应用更新**。下载按照架构匹配，校验大小和 SHA-256，并识别当前应用的安装渠道。

### Homebrew 安装与升级

```bash
brew install --cask skylight-f/tap/astragit
brew upgrade --cask skylight-f/tap/astragit
```

Apple Silicon 与 Intel 使用各自的 DMG 和摘要。应用核对 Homebrew 安装收据、当前 App 路径和身份后，显示 **Homebrew** 渠道。应用内下载使用系统网络栈写入 brew 的真实缓存并校验；点击 **通过 Homebrew 升级并重启** 后，辅助进程等待当前应用退出，执行仅针对 AstraGit 的 `brew upgrade --cask --require-sha`，复核版本收据、应用身份和新版页面/API 就绪。Homebrew 管理安装记录，这条渠道不要求 DMG 自替换所需的 Developer ID 条件；macOS 安全检查保留。

卸载可用 `brew uninstall --cask skylight-f/tap/astragit`；只有主动增加 `--zap` 才清理 Cask 声明的本地配置。更新流程保留项目、模型配置与草稿。

发行同时上传与清单一致的 `astragit.rb`。`skylight-f/homebrew-tap` 的独立工作流每 15 分钟核对公开发行并同步 Cask，也支持手动触发；定时任务实际执行时间由 GitHub 调度决定。它使用 Tap 自己的 `GITHUB_TOKEN`，无需跨仓库凭据。若在 AstraGit 设置 `HOMEBREW_TAP_TOKEN`，发布后还会立即同步 Tap。工作流模板位于 `scripts/templates/astragit-homebrew-sync.yml`，只更新 `Casks/astragit.rb`。

### DMG 安装与升级

手动 DMG 安装的应用继续使用 DMG 更新渠道。满足当前应用与新版同一 Developer ID 签发团队、新版通过公证、安装目录可写时，可选择重启安装；辅助进程等待退出、替换应用并验证新版启动，失败时恢复旧应用。条件不足时提供已校验 DMG 的手动安装入口。

默认 CI 可以发布 ad-hoc 包。启用正式签名、公证时配置仓库 Secrets：`MACOS_CERTIFICATE`（P12 的 base64）、`MACOS_CERTIFICATE_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。设 `REQUIRE_APPLE_DISTRIBUTION=true` 可要求签名和公证缺一即阻止发布。当前本地验收包没有 Developer ID 凭据，无法证明 Apple 公证或 DMG 渠道自动替换已安装签名应用的完整生产链路。

显式本地安装包构建：`pnpm build:release`。该入口读取 Apple 发行凭据并生成 DMG；正式身份验收使用 `pnpm build:app`，日常开发验证使用 `pnpm dev`。

## 独立数据

- macOS 默认数据目录：`~/Library/Application Support/AstraGit`。
- 开发模式默认：本项目的 `.tmp/electron-development-data`。
- `ASTRAGIT_USER_DATA_DIR` 可指定本应用的数据目录；Electron 的浏览器缓存、localStorage 与服务数据使用同一独立目录。
- `projects.json` 保存项目记录；`git-operation-history.json` 保存最近 2,000 条操作；`git-app.db` 保存模型设置、命令回执和文件缓存元数据。
- API Key 使用 macOS 钥匙串的独立 `AstraGit` service；钥匙串不可用时保存为本应用目录中的 `secrets.json`（0600）。
- Codex 默认启用，登录和配置放在 `{userData}/codex`，始终向 CLI 显式传入 `CODEX_HOME`。不自动读取 Zeus 或全局 Codex 登录目录。
- 可设置 `ASTRAGIT_CODEX_HOME`、`ASTRAGIT_CODEX_COMMAND`；`ASTRAGIT_CODEX_ENABLED=0` 可关闭 Codex。显式覆盖路径由使用者自行选择。

## AI 提交说明

在右上角 **设置 → AI 模型** 中添加模型连接和 API Key，手动添加模型，或刷新目录后勾选启用所需模型。已有连接支持编辑名称、API 地址与模型目录路径，保留原密钥和模型选择。连接和模型都可以单独启用/停用。也可在 AstraGit 内单独登录 Codex。

暂存改动或勾选提交范围后，选择模型并生成说明。应用读取实际 diff 与近期提交风格，将生成结果填入可编辑草稿；提交由用户操作。普通模型使用 HTTP，Codex 使用本应用管理的独立 App Server。

本地自动回归覆盖模拟模型生成、勾选提交与索引保护、多仓库发现、数据库事务、命令重放、重启恢复，以及独立目录中的 Codex 子进程握手。真实模型供应商、Codex 账号登录和 Apple 签名公证需使用对应真实账户验收；模拟服务结果不代表这些外部服务已通过。

架构与验收范围见 [设计书](docs/设计书.md)，本轮修复见 [设置与 Git 验收记录](docs/设置与Git修复验收-2026-10-15.md)，开发链路见 [热更新验收记录](docs/开发热更新验收-2026-10-14.md)，历史正式包结果见 [正式构建验收记录](docs/正式构建验收-2026-10-14.md)。代码来源与静态模型目录许可见 [第三方说明](THIRD_PARTY_NOTICES.md)。
