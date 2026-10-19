---
tags:
  - astragit
  - 排查记录
  - Homebrew
created: 2026-10-15
git_branch: main
---

# Homebrew 更新对齐 Zeus

> **2026-10-19 更正**：本文是部分命令链对齐的历史记录，当时保留的“退出后安装”和自写进度流程仍不符合 Astra 当前实现。现已完整迁移原生窗口、控制器、调度器及“旧 Main 完成 brew 升级后退出”的顺序，详见 [Homebrew 更新完整对齐 Astra](Homebrew更新完整对齐Astra-2026-10-19.md)。参考版本应以实际工作区文件摘要为准，不能只标记 HEAD `6ab59b15`。

## 用户反馈与现场事实

截图显示运行版本 `0.1.6`、最新版本 `0.1.7`，点击下载后仍报「Homebrew Cask 尚未同步或与发布清单不一致」，并残留「正在同步 Homebrew」。该泛化错误文字对应 `v0.1.6` 的 `assertHomebrewRelease`；当时下载前就要求 Cask 版本、URL 和摘要全部匹配。

本轮检查时，本机 `brew info --cask --json=v2 skylight-f/tap/astragit` 的 Cask、安装收据、App 的两个版本字段均为 `0.1.7`，官方发布清单及 Cask 摘要一致。通过 `/Applications/AstraGit.app` 的真实界面打开更新页，也显示「当前版本 0.1.7 · 最新版本 0.1.7」「已是最新版本」。因此不能把旧截图当作当前 0.1.7 再次下载失败的证据，也不能把发布及 Cask 同步成功等同于旧版本完成应用内升级。

此前 Release 在 16:26 公开，Tap 到 16:29 才同步，确有发行先于 Cask 的空档。旧错误没有区分具体版本滞后、URL 漂移与摘要不符，增加了排查困难。

## 对照的真实源码

读取本机 Zeus 仓库当前提交 `6ab59b15`（2026-10-15），没有读取旧截图推测实现：

- `apps/desktop/src/main/homebrewUpdateService.ts`：查询收据、`brew update`、`brew fetch --cask --retry`、缓存摘要复验、`brew upgrade --cask --no-quit --yes --require-sha`，网络错误分类和部分下载进度。
- `apps/desktop/src/main/homebrewUpdateController.ts`：唯一更新操作、下载就绪、取消后保留、确认后安装及重启交接。
- `apps/desktop/src/main/releaseUpdateService.ts`、`automaticUpdateScheduler.ts`：核对直接安装与检查调度的边界。

| 环节 | AstraGit 先前实现 | 本次对齐 |
| --- | --- | --- |
| 同步信息 | 自行 fetch / merge 单个 Tap | `brew update`，有限重试，再查询 Cask |
| Homebrew 下载 | v0.1.6 校验 Cask 后由 Electron 下载；v0.1.7 先独立下载，安装前复制 brew 缓存 | 由 `brew fetch --cask --retry` 管理下载、续传及缓存 |
| 下载进度 | Electron 响应字节 | brew `.incomplete` 的实际文件大小 |
| 下载中断 | 用户重试 | 仅识别的网络中断有限重试；结构或摘要错误保持失败 |
| 准备完成 | v0.1.7 独立文件完成，不等于 brew 安装已准备 | Cask 与 brew 缓存完整匹配才就绪 |
| 取消 / 安装 | 已有独立安装器交接 | 保留交接；取消复用预取，安装前及辅助进程内双重复验 |

没有将 Zeus 的工作树、产物或包变成运行依赖。AstraGit 的独立安装器保留退出后安装方式；本次对齐 Homebrew 命令、缓存及验证流程，没有迁移 Zeus 的原生进度窗口与全部后台调度 UI。

## 修改

- `homebrewUpdateService.ts` 移除自行操作 Tap Git 的分支，增加 brew 更新、查询重试和 `validatePrepared`。
- `homebrewDownload.ts` 执行真实 brew fetch，500ms 查询部分文件大小，保留下载缓存，网络中断最多重试两次；超时只终止该下载进程组，错误信息脱敏。
- `releaseUpdateService.ts` 按安装渠道准备：Homebrew 直接保留预取收据与真实缓存，DMG 保留直接下载；安装前复验成功才请求退出确认。
- Renderer 显示重新连接，失败清除旧进度，保留此前 IPC 错误前缀清理；不再把直接安装进度统一写成 Homebrew。
- 删除不再使用的独立下载到 brew 缓存复制函数及其专用测试，补充对真实命令链的回归。

## 验证结果

- 完整 `pnpm verify:publish` 成功：锁文件、隔离、lint、类型、31/31 测试及全部构建。
- 干净快照 `.tmp/homebrew-zeus-alignment-20261015` 不含旧 node_modules，`pnpm install --frozen-lockfile` 成功安装 413 个包。
- 新回归覆盖：旧 Cask 经 brew update 刷新，更新网络错误重试、缓存复用、安装前缓存被改写、版本 / 摘要 / 来源错误阻止下载和升级；真实子进程部分文件进度、网络中断续用与结构错误不重试。
- 真实 Homebrew、官方 0.1.7 安装包和缓存复验成功：120,190,468 字节，SHA256 `9de076f4b50bbbf51da6349711fd9ef1c9e4183819c6e9671082decc70d3a609`。生产 `brew fetch` 执行成功并命中官方缓存。
- 本地生产服务以 **模拟运行版本 0.1.6** 接入真实 Homebrew，检查 0.1.7 → 预取 → 缓存复验 → 取消确认成功，确认次数 1、退出次数 0。磁盘及收据实际上已是 0.1.7，这不是一次真实 0.1.6 → 0.1.7 覆盖升级。
- 热更新编译及新进程 `66386` / API 就绪。中途一次临时开发进程原生退出等待：采样未见钥匙串调用，API 已关闭且无 Git 子进程，确认仅涉及临时验收数据后清理残留 `22323`，由监督器重编译启动；不把该过程记为完整退出链路通过。

证据保存在 `.tmp/acceptance/homebrew-zeus-alignment-result.json` 与 `.tmp/acceptance/formal-v017-update-status.png`。本次未提交、推送或发布，也没有覆盖正式安装、修改钥匙串或迁移用户数据。完整正式升级及发布仍需后续按实际版本验收。
