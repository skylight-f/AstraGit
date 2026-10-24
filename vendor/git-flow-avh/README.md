# AstraGit 内置 Git Flow AVH

- 上游：petervanderdoes/gitflow-avh，固定标签 1.12.3。
- `manifest.json` 记录下载源、原始压缩包 SHA-256、各原始文件与实际交付文件的 SHA-256。
- 此目录交付可阅读、可替换的完整脚本源。保留各脚本版权声明与上游完整 `LICENSE`；包含 BSD 许可与 gitflow-shFlags 的 LGPL-2.1 许可。
- 唯一适配：`git-flow-feature` 的 feature finish → rebase 递归改为直接执行本目录的 `git-flow`，确保同一版本；分支、合并、标签和钩子行为沿用上游。
- `git-flow` 为入口（755），其他源文件及许可证为 644。应用仍调用用户已有 Git；不会更改全局 Git 配置或安装系统工具。
- 更新资源时须重新核对上游、补丁、许可证和清单，通过 `pnpm check:git-flow`、干净 frozen 安装、完整门禁和正式包资源验收。
