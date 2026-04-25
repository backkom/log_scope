# 项目上下文

最后更新：2026-04-25

本文档是 `log_scope` 的长期项目记忆。后续 AI agent 和开发者在做项目决策前应先阅读本文档；当需求、架构、取舍或实现细节发生变化时，必须同步更新本文档。

## 产品目标

构建一个面向 Windows 和 macOS 的高性能、只读 log 可视化桌面工具。

该工具不是通用文本编辑器，而是专注于大文件和实时数据流的 log viewer。它需要提供快速导航、查找、语义标记展示，以及右侧 minimap/micromap 风格的全局概览。

常规运行目标数据规模：50-100 MB 文本文档或实时 log 流。

## 数据来源

应用支持两类数据输入。

1. 文件 tail 模式
   - 打开用户选择的文件。
   - 像 `tail -f` 一样监控文件追加内容。
   - 增量展示新写入的行，避免每次重新加载整个文件。

2. Socket 模式
   - 连接目标 IP 和端口。
   - 使用本项目定义的协议接收数据。
   - 协议由本项目设计，不继承 CudaText 的模型。

应用需要记住历史数据来源：

- 最近打开的文件路径。
- 最近连接过的 IP/端口组合。
- 后续可按需要保存每个数据源的展示、搜索、过滤状态。

## 主界面要求

应用启动后，用户可以从历史记录中选择数据来源，或创建新的数据来源。选择后进入主视图。

主视图分为左右两侧。

左侧：

- 以只读文本编辑器风格展示 log。
- 显示行号。
- 支持查找、定位和跳转。
- 能在大文件和实时流场景下高效滚动。
- 不暴露编辑、保存等通用编辑器工作流。

右侧：

- 以 minimap/micromap 风格展示当前已知数据的全局概览。
- 不展示原始文本内容。
- 展示从 log 中提炼出的语义信息。
- 某些带特殊标记的行可以解析出 JSON 数据。
- 这些特殊行应以不同颜色的符号展示，例如小圆点。
- 在 minimap 上按住滑动可以影响左侧 viewer 的滚动位置。
- 点击语义小圆点后，以 JSON viewer 展示对应解析数据。

## 架构决策

当前采用：

- Tauri：桌面应用壳和跨平台打包。
- Rust core：数据接入、解析、索引、搜索和持久化。
- 自研虚拟化 viewer：负责 log 文本展示。
- Canvas/WebGL/轻量 DOM：用于 minimap/micromap 展示；当 marker 密度变高时优先考虑 Canvas 或 WebGL。

当前不采用 CudaText 作为产品基础。

CudaText 仍作为参考资料，用于参考：

- 大文件降级策略。
- micromap/minimap 设计思想。
- 查找和导航体验。
- 只读编辑器行为。
- 大文件处理中的边界问题。

## CudaText 可行性结论

仓库中包含 `CudaText/`，用于分析和参考。

从本地 CudaText 文档和代码中得到的有用事实：

- CudaText 是跨平台文本编辑器，使用 Free Pascal + Lazarus 编写。
- 它依赖 ATSynEdit 等编辑器组件。
- 其文档声称在 10-100 MB 文件场景下比 VS Code 更稳。
- 它内置 minimap/micromap 概念，并通过 Python API 暴露 marker 和 micromap column 相关能力。
- 它会在大文件场景下主动禁用高成本能力，例如普通 lexer、自动换行、折叠和动态高亮。

不把 CudaText 作为主实现的原因：

- 本项目核心需求是 append-only 实时流和 socket 数据，而 CudaText 主要是文档/编辑器模型。
- CudaText 插件 API 基于 Python 事件模型，不适合高吞吐、异步数据接入主链路。
- 深度定制需要 Free Pascal、Lazarus、ATSynEdit 经验，维护门槛较高。
- CudaText 的 minimap/micromap 偏编辑器 marker，而本项目需要面向 log 语义事件的概览图和可点击 JSON 事件。
- CudaText 常规文档加载的内存占用可能明显高于专用虚拟化 log viewer。

当前建议：

- 只把 CudaText 作为参考。
- 如果项目负责人要求，可以做短期 CudaText POC，但不应阻塞 Tauri + Rust 主路线。

## 核心实现模型

采用 append-only 数据模型。

Rust core 负责：

- 文件 tail。
- TCP socket 连接和重连。
- 协议 frame 解码。
- 文本解码和换行规范化。
- 行切分。
- 字节偏移和行号索引。
- 特殊 marker 检测。
- JSON payload 提取和校验。
- 搜索索引和搜索执行。
- 历史记录和用户状态持久化。
- 有界内存和背压策略。

前端负责：

- 数据源选择和历史记录 UI。
- 虚拟化只读文本 viewport。
- 行号 gutter。
- 搜索 UI 和搜索结果跳转。
- minimap/micromap 渲染。
- 解析事件的 JSON viewer。
- minimap 坐标与 log 偏移/行号之间的交互映射。

## 存储和索引建议

每个打开的数据源或 session 维护：

- 原始 append-only segment，可根据大小和生命周期放在内存、临时文件或 mmap 文件中。
- `line_number -> byte_offset` 索引。
- `marker_id -> line_number, byte_offset, marker_type, color, json_range` 索引。
- 如果 marker 协议包含等级信息，可维护 `line_number -> severity/type` 元数据。
- 第一版功能稳定后，再考虑搜索索引。

前端不应该持有完整 log 文本。前端应向 Rust 请求可见行范围和 marker 摘要。

## Socket 协议方向

Socket 协议尚未最终确定，但优先使用 framed protocol，而不是无边界的裸文本流。

建议起点：

- 使用 length-prefixed frame。
- 每个 frame 包含一条或多条 log record。
- payload 第一版可以使用 UTF-8 文本或 JSON Lines。
- 尽早预留协议版本和 record type 字段。

应避免设计成必须在无限 buffer 边界上扫描任意半截 JSON 的协议。

## 虚拟化 Viewer 要求

不要把 50-100 MB log 加载进普通 DOM 节点或通用编辑器文档。

viewer 应该：

- 只渲染可见行和少量 overscan。
- 初期使用固定行高，便于性能优化和位置映射。
- 大文件默认关闭自动换行，参考 CudaText 的降级思想。
- 支持行号 gutter，并避免布局抖动。
- 搜索高亮和语义行标记只作用在可见范围或摘要数据上。
- 追加新数据时，不应打断用户当前阅读位置；只有用户处于 follow tail 模式时才自动跟随末尾。

可选前端实现：

- 自研 React/Solid/Svelte 虚拟列表 + Canvas minimap。
- 如果 DOM 行渲染性能不足，可改为 Canvas 文本渲染。
- 不建议把 Monaco/CodeMirror 作为大文件主文档承载方案，除非经过强约束和基准测试。

## 大文件降级策略

参考 CudaText 的思想，而不是复制其实现。

大文件或高行数场景下：

- 关闭自动换行。
- 避免全量语法高亮。
- 避免全量 JSON 解析。
- 避免全量 DOM 渲染。
- 避免对每一行做昂贵 decoration，除非该行可见或被摘要索引需要。
- 使用后台任务进行扫描和索引。
- 索引尚未完成时，minimap 可以先展示近似/渐进式数据。

加载和流式接收数据时，应用必须保持响应。

## 查找体验

查找体验应接近编辑器：

- 支持 find next / find previous。
- 高亮可见范围内的匹配项。
- 如果全量计数成本高，可以渐进统计匹配数量。
- 支持跳转到行号或偏移。
- 第一版优先支持普通文本查找。
- Regex 在基础查找路径稳定且足够快之后再加入。

大文件和实时数据场景下：

- 搜索可以是渐进式。
- 如果全量扫描尚未完成，应明确表现为“部分结果”。
- 新数据追加后，尽量保持当前搜索结果位置稳定。

## JSON Marker 处理

某些 log 行包含特殊标记，可以从中解析 JSON 数据。

尚未确定的设计点：

- 特殊 marker 的精确语法。
- JSON payload 是嵌在文本行中，还是通过 frame metadata 传递。
- marker type 到颜色/形状的映射规则。
- JSON 解析失败时是否生成 warning marker。

第一版应做到：

- 检测本项目定义的 marker prefix。
- 增量解析 JSON payload。
- 将解析出的事件元数据与原始文本分开存储。
- 按行号或偏移在 minimap 上渲染圆点。
- 选中圆点后打开 JSON viewer。

## 持久化

建议使用 SQLite 或轻量结构化本地存储保存：

- 最近文件路径。
- 最近 socket endpoint。
- 数据源显示名。
- 最近打开的数据源。
- 窗口布局和状态。
- 如有必要，保存搜索历史。

核心 log 数据保留策略不应与 UI 框架强绑定。

## 性能目标

初始目标：

- 打开并索引 100 MB 文本文档时不冻结 UI。
- 在 50-100 MB log 上保持顺滑滚动。
- 内存占用有界，并明显低于朴素 full DOM / 通用编辑器加载方式。
- 能持续 tail 追加内容。
- minimap 摘要渲染与左侧可见文本渲染相互独立。

后续基准测试应覆盖：

- 50 MB、100 MB、300 MB 静态文件。
- 大量短行。
- 超长行。
- 高密度 marker 行。
- 持续 append 流。
- socket burst 输入。

## 开发注意事项

开始实现后：

- 尽早加入 benchmark fixture 生成器。
- 尽早加入可重复的性能测试路径。
- Rust core 与前端之间的 API 要清晰、显式、可版本化。
- 解析事件 metadata 应独立于视觉组件。
- 从一开始就设计取消任务和背压机制。

## 文档持续更新规则

以下情况必须更新本文档：

- 架构决策变化。
- 出现新的重要需求。
- Socket 协议被定义或修改。
- 文件、索引、搜索、minimap 的实现细节被确定。
- 基准测试暴露重要约束。
- 对 CudaText 的参考结论变得更具体。
- 后续 AI 需要的信息目前只存在于聊天记录中。

更新时保持简洁。优先写入长期有效的决策和约束，而不是逐字转录对话。
