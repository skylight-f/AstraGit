# AstraGit 开发约定

@/Users/skylight/.codex/RTK.md

- 日常开发和界面验证优先使用 `pnpm dev` 的真实 Electron 应用与热更新。
- Renderer 使用 Vite / React Fast Refresh；Main、preload 和 `packages/*` 修改编译成功后自动重启开发应用。编译失败时保留正在运行的应用，修复保存后重试。
- 开发数据默认使用 `.tmp/electron-development-data`，不自动使用正式用户数据。
- 只有需要验证打包、签名、安装或明确进行正式构建验收时，才使用 `pnpm build:app`；发行构建使用 `pnpm build:release`。
- AstraGit 独立维护源码、包与用户数据，不引入 Zeus 工作树、构建产物或运行依赖。
