# AstraGit 开发约定

@/Users/skylight/.codex/RTK.md

- 新增或修改界面、组件、样式和交互前，必须阅读并遵守 [AstraGit 界面设计与样式指南](docs/DESIGN.md)，交付前按其中的界面验收要求检查受影响的入口。
- 日常开发和界面验证优先使用 `pnpm dev` 的真实 Electron 应用与热更新。
- 不要直接打开 `.tmp/development-runtime` 下的 Electron 运行壳；它缺少 AstraGit 的项目入口，会显示 Electron 默认欢迎页。
- Renderer 使用 Vite / React Fast Refresh；Main、preload 和 `packages/*` 修改编译成功后自动重启开发应用。编译失败时保留正在运行的应用，修复保存后重试。
- 开发数据默认使用 `.tmp/electron-development-data`，不自动使用正式用户数据。
- 只有需要验证打包、签名、安装或明确进行正式构建验收时，才使用 `pnpm build:app`；发行构建使用 `pnpm build:release`。
- AstraGit 独立维护源码、包与用户数据，不引入 Zeus 工作树、构建产物或运行依赖。
- 代码修改交付前运行 `pnpm check:lockfile`，确保所有包清单与锁文件一致；添加依赖后改用其他方案时，同步清理锁文件中的废弃依赖。
- 依赖、构建资源、更新或发布链路的修改须通过完整 `pnpm verify:publish`，并在干净临时目录验证 `pnpm install --frozen-lockfile`。保留 CI 的 frozen-lockfile 校验，发布结论以对应提交的云端工作流结果为准。
