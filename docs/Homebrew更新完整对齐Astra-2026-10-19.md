---
tags:
  - astragit
  - 排查记录
  - Homebrew
created: 2026-10-19
git_branch: main
---

# Homebrew 更新完整对齐 Astra

> **后续策略更新（2026-10-20）**：本文保留当时迁移与验收记录。用户随后要求仅使用已手工验证的 `brew upgrade --cask skylight-f/tap/astragit`；当前已移除显式预取、清单与 Cask 精确匹配及应用级下载重试，后台直接升级，重启只复验。现行设计和验收见 [Homebrew 终端同款升级命令修复](Homebrew终端同款升级命令修复-2026-10-20.md)。

## 问题与根因

此前只对齐了部分 brew 命令，保留了 AstraGit 自写的网页更新弹窗、下载器和退出后安装器，安装生命周期仍与 Astra 不同。2026-10-15 的记录明确保留了这项差异，不能据此宣称完整迁移完成。

本次直接读取 `/Users/skylight/MyCode/zeus` 当前工作树的实现。Astra 是 Zeus 项目当前的应用名称；不能只用仓库 HEAD `6ab59b15` 标识其中的工作区源码。2026-10-16 复制的五份参考文件在 2026-10-19 复核时均未变化。

## 采用的执行顺序

1. Main 创建唯一更新控制器，原生 AppKit 窗口承载检查、预取、进度、就绪和错误状态；Renderer 只提供入口和状态提示。
2. 按 Astra 的收据及应用位置规则判断 Homebrew 安装。Cask 与发布清单不匹配时执行 `brew update`，再查询并验证版本、URL、摘要。
3. 执行 `brew fetch --cask --retry skylight-f/tap/astragit`，复用 brew 缓存，以真实部分文件和命令输出驱动进度。网络恢复、低速重连和有限重试沿用源实现。
4. 用户点击重启，由 Main 进入退出确认。取消时保留已验证的准备结果。
5. 确认后，**旧 Main 仍在运行时**复验并执行：

   ```text
   brew upgrade --cask --no-quit --yes --require-sha skylight-f/tap/astragit
   ```

6. 升级成功后核对收据及磁盘应用，向原生辅助程序发送旧 PID、精确 App 路径、Bundle ID 和版本；随后关闭本地业务服务并退出 Main。辅助程序等待该 PID 退出，再次核对目标，用 NSWorkspace 打开该应用。

后台检查频率、首次延迟、状态持久化、下载失败恢复和下载完成提醒沿用 Astra 的调度器。开发态不自动执行正式升级。

## 迁移范围与差异

| 文件 | 处理 |
| --- | --- |
| `homebrewUpdateService.ts` | 完整复制执行服务，仅替换独立应用身份、Cask 配置导入和状态类型导入 |
| `automaticUpdateScheduler.ts` | 完整复制调度逻辑，仅替换应用身份 |
| `native/UpdateProgressPanel.swift` | 完整复制原生窗口及精确重启逻辑，仅替换应用身份 |
| `homebrewUpdateController.ts` | 复制控制器，适配共享类型；去掉 AstraGit 没有的独立执行宿主协议参数；增加测试窗口工厂入口和可选检查时间兼容 |
| `nativeUpdateProgress.ts` | 复制宿主桥接；Electron 主题导入移到工厂内部，允许 Node 测试导入控制器 |
| `main.ts`、preload、更新按钮 | 接入 Astra 的唯一控制器、后台调度和退出接力；替换应用身份与本地服务清理接口 |

删除 `homebrewDownload.ts`、`homebrewInstaller.ts` 及其生产调用，去掉 Renderer 自有定时检查和网页更新对话框。没有新增 `--appdir`、复制 brew 缓存、直接操作 Tap Git 或退出后执行 brew 的分支。DMG 直接安装通道保留既有签名、公证和替换规则。

原生辅助程序随 macOS 当前架构编译，放入 `app.asar.unpacked/dist/native/`。打包脚本验证其存在、架构和整个应用的签名完整性。AstraGit 保持独立源码、包和数据，不读取 Zeus 工作树作为运行依赖。

### 参考源码 SHA-256

| Astra 文件 | SHA-256 |
| --- | --- |
| `homebrewUpdateService.ts` | `27440d2d73f82ec18834444b313f1373dda4ac3948deb6c468735e60c919b1a0` |
| `homebrewUpdateController.ts` | `176ee9296d2d1a37cbfedf031fb26612ce10db0c98b3e7ab5248060dcf2e6156` |
| `nativeUpdateProgress.ts` | `9b60f37e57706b7da7496a2d755dcff047de540e441ab291b60ae7b89e9b634a` |
| `automaticUpdateScheduler.ts` | `8f12dfe23f43073a714f2a9aace60bcc20c169e9cc943db3ac7105bda7ec31ef` |
| `UpdateProgressPanel.swift` | `a0ae1bee0010827b73fe9a936cbaea076ebb7be2f12e96ee399b0a1c9c7a3ae1` |

## 验证与边界

- 完整 `pnpm verify:publish` 通过：锁文件、隔离、图标、lint、类型、33 项测试及构建。
- 干净临时源码的 `pnpm install --frozen-lockfile` 通过；未修改依赖和锁文件。
- 临时可执行 brew 替身验证真实子进程参数、旧 Main 在升级期间仍存活、过期 Cask 刷新、缓存被篡改、收据来源及安装位置校验；替身仅允许在测试模式的临时路径使用。
- 控制器测试覆盖取消保留准备结果、安装失败保持应用运行、失败不自动重试安装、重复打开不重复预取，以及“确认 → brew 升级 → 原生重启准备 → 退出”的顺序。
- 真实 Swift 辅助程序配合临时 AppKit 探针应用，通过旧 PID 存活期间不启动、退出后打开精确 Bundle ID / 版本的验证；不是对正式 AstraGit 的覆盖升级。
- 本地 `AstraGit.app` 构建、原生辅助程序架构和签名完整性通过；签名为 ad-hoc，未公证。
- `pnpm dev` 已编译并启动真实 Electron。点击更新后创建了原生辅助进程；界面工具无法绑定该无应用包身份的辅助进程，随后临时窗口验收的界面调用中断，因此**不把这部分记为完整界面验收通过**。
- 开发应用曾在本地业务服务关闭后等待 Electron 钥匙串退出清理；经进程采样和 API 关闭确认后清理该开发残留。没有处理系统钥匙串提示，也没有改动正式用户数据。

本轮未提交、推送、发布或覆盖 `/Applications/AstraGit.app`。本地测试和打包结果不能替代云端双架构发行及正式版真实 Homebrew 升级验收。

证据：`.tmp/acceptance/astra-update-parity-20261016.json`、`native-update-relaunch-20261016.json`、`update-clean-install-20261016.json`、`release/build-info.json`。

## 经验总结

参考迁移必须覆盖实际调用者、退出顺序、原生辅助程序和后台任务所有权。只复制命令或采用相同参数，不能说明更新策略相同。后续修改以这些源码及其调用链为依据，避免再保留第二套 Homebrew 安装策略。
