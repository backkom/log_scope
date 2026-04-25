# log_scope

log查看器

面向 Windows 和 macOS 的高性能、只读 log 可视化查看器。

当前规划采用 Tauri 桌面壳、Rust 数据处理核心，以及自研虚拟化 log
viewer。仓库中的 CudaText 仅作为参考资料，用于参考大文件降级策略、
micromap/minimap 概念和查找/导航体验。

项目记忆和后续 AI 工作入口：

- [项目上下文](docs/PROJECT_CONTEXT.md)
- [实现计划](docs/IMPLEMENTATION_PLAN.md)
- [AI / Agent 工作说明](AGENTS.md)

## 开发

阶段 0 使用 Tauri 2 + Vite + React + TypeScript。

```bash
yarn install
yarn tauri:dev
```

常用检查：

```bash
yarn run check
cargo check --manifest-path src-tauri/Cargo.toml
```

VS Code 调试：

- 打开 Run and Debug，选择 `Tauri Dev: log_scope`。
- 该配置会在工作区根目录执行 `yarn tauri:dev`。
