# AI / Agent 工作说明

本仓库用于构建 `log_scope`：一个面向 Windows 和 macOS 的高性能、只读 log
可视化查看器。

在做架构或实现变更前，必须先阅读并维护：

- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)

请把该文档视为项目的“长期记忆”。当架构决策变化、出现新需求、实现细节变得更明确、性能测试暴露约束，或聊天中出现了后续开发需要记住的信息时，必须在同一次变更中更新
`docs/PROJECT_CONTEXT.md`。

更新要求：

- 内容使用中文。
- 保持简洁、事实化、可执行。
- 优先记录长期有效的决策、约束、接口和取舍。
- 不要把聊天逐字转录进文档。

当前战略方向：

- 使用 Tauri 作为桌面壳和打包方案。
- 使用 Rust 处理文件 tail、socket 接入、协议解析、索引、搜索和持久化。
- 构建自研虚拟化只读 viewer，不要把完整 50-100 MB log 加载进普通 DOM 或通用编辑器文档。
- CudaText 仅作为参考资料，参考其大文件降级策略、micromap/minimap 概念和查找体验；除非项目负责人明确改变决策，否则不要把 CudaText 作为产品基础。
