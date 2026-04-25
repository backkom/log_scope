# 项目上下文

最后更新：2026-04-25

本文档是 `log_scope` 的长期项目记忆。后续 AI agent 和开发者在做项目决策前应先阅读本文档；当需求、架构、取舍或实现细节发生变化时，必须同步更新本文档。

分阶段实现计划见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。后续实现应优先按该计划拆分小步交付，并在实际约束变化时同步更新计划和本文档。

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

阶段 1/2 当前实现：

- Rust command `open_log_file(path)` 打开 UTF-8/UTF-8 lossy 文本文件，建立当前文件 session，并返回 `sessionId`、路径、文件大小和行数。
- Rust command `get_log_lines(sessionId, startLine, lineCount)` 只读取指定行范围，返回 1-based 行号和文本。
- Rust command `refresh_log_file(sessionId)` 检查当前文件大小；文件变大时只读取新增字节并增量更新行偏移索引，文件变小时按截断/轮转处理并重新建立当前文件索引。
- Rust command `generate_log_fixture(sizeMb)` 可在系统临时目录生成指定大小的合成 log fixture；前端提供 50MB fixture 一键生成并打开入口，用于阶段 1 手工性能验证。
- 当前行索引只保存 `line_number -> byte_offset`，原始文件内容仍保留在磁盘；读取可见行时通过 seek + byte range 读取；追加刷新同样不把完整文件读入内存。
- 当前文件索引在 Tauri async blocking 线程池中构建，并返回索引耗时；后续 100 MB 以上体验优化应继续补充进度状态和取消。
- 阶段 2 第一版使用前端定时调用 `refresh_log_file` 的轮询模型，而不是直接引入平台文件 watcher；该方案优先保证 Windows/macOS 行为一致，后续如轮询成本或延迟不可接受再替换为 watcher。

阶段 3 第一版当前实现：

- Rust command `get_log_markers(sessionId, startLine?, endLine?)` 返回当前 session 的 marker 摘要，可按行范围过滤。
- Rust command `get_marker_payload(sessionId, markerId)` 按需返回 marker body；前端不在 marker 摘要中持有完整 payload。
- 当前已实现 `Send Message` / `Receive Message` 网络消息块提取，字段包括 `direction`、`message_id`、`message_name`、起止行号、起止字节偏移、颜色和 JSON 解析状态。
- 消息块结束规则：优先遇到 `============================================` 分隔线结束；若缺少分隔线，则遇到下一条消息 header 前结束；文件结尾仍会关闭当前块。
- 消息 body 尝试按严格 JSON 解析；解析失败时保留 raw text 并标记 `parse_status = raw`，不影响 marker 生成。
- 前端右侧 minimap 第一版使用 Canvas 绘制 marker 点，点击 marker 后跳转到对应行并加载 payload；可见行中的 marker 起始行会做轻量背景标记。
- 当前 marker 索引在打开文件后构建；文件追加或截断刷新后会重建 marker 索引。该方案先保证正确性，后续高频 tail 压测如暴露成本，再改为增量 marker 扫描。

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
- 阶段 1 前端固定行高为 24px，滚动时按可见区高度和 overscan 计算 `get_log_lines` 请求范围。
- 阶段 1 前端维护有界行缓存，快速滚动时先渲染目标行号和占位行，待 Rust 返回后逐行填充；不缓存完整文件内容。
- 应用根布局固定在 100vh 内，左侧操作栏和右侧 viewer 分别滚动，避免滚动 log 时带动操作栏；右侧 viewer 外层只负责纵向滚动，滚动条位于 minimap 右侧；log 文本列内部独立负责横向滚动，minimap 不参与横向滚动上下文。
- 快速滚动时，viewer 外层滚动空间、sticky viewport、可见行容器、行号 gutter 和占位行都必须铺固定深色背景，避免数据尚未刷新时露出默认白底；占位行不显示横向 skeleton 条，以免加载延迟被放大成闪屏。
- viewer 滚动空间必须至少覆盖当前 viewport，并在文本总高度后保留一行底部余量，避免短文件或滚动到底时最后一行被 sticky/overflow 边界裁剪。
- 大文件默认关闭自动换行，参考 CudaText 的降级思想。
- 支持行号 gutter，并避免布局抖动。
- 搜索高亮和语义行标记只作用在可见范围或摘要数据上。
- 追加新数据时，不应打断用户当前阅读位置；只有用户处于 follow tail 模式时才自动跟随末尾。
- 阶段 2 前端已加入 follow tail 开关。开启时追加行会滚动到末尾；关闭时只更新总行数并显示新增行提示，不强制改变当前阅读位置。

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

阶段 3 需要优先支持“多行消息事件”提取，典型格式如下：

- header 行包含时间、方向、消息 ID 和消息名，例如 `13:05:42	========= Receive Message ([342] S_GET_CSVFILE_RESULT) ... =========`。
- 消息体从 header 后一行开始，到下一条 header 前结束。
- header 中至少提取 `direction`、`message_id`、`message_name`、起始行号和字节偏移；消息体优先按 JSON 解析，解析失败时仍保留原始文本并生成诊断状态。

marker 规则应设计成可配置的“分层事件提取器”，而不是只内置单一语法：

- `start_pattern`：用户可配置的 header 正则，使用命名捕获组提取字段。
- `body_strategy`：第一版支持 `until_next_start`，即消息体延续到下一条 header 前。
- `body_parser`：第一版支持 `json` 和 `text`；JSON 可以是 pretty-printed 多行对象。
- `field_mapping`：把正则捕获组映射到标准字段，例如 `message_id`、`message_name`、`direction`、`timestamp`。
- `marker_type/color`：可根据方向、消息名、ID 范围或用户规则映射。

内置默认规则建议覆盖 `Send Message` / `Receive Message` 格式：

```text
^(?<line_time>\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s+=+\s*(?<direction>Receive|Send)\s+Message\s*\(\[(?<message_id>\d+)\]\s*(?<message_name>[^)\]]+?)\)\s*(?<meta>\[[^\]]*\])?\s*=+\s*$
```

真实游戏日志中消息块会和普通日志混排。已确认的形态包括：

- 时间戳普通单行日志，例如初始化、网络状态、UI 打开、错误提示。
- 单行 JSON 事件，例如包含 `event_name` 的埋点日志。
- 以时间戳行开头、后续不带时间戳的多行块，例如 `ChangeState ... { ... }`、`_CheckProducts [`、`DataPatch: ...`。
- Lua `stack traceback:` 多行错误堆栈。
- 很长的 HTML/文本响应，可能跨多行且不适合作为 JSON 解析。
- Unity 富文本包裹的 JSON，例如 `<color=red>{ ... }</color>`。
- `Send Message` / `Receive Message` 消息块通常以一行 `============================================` 分隔，但解析不应只依赖该分隔线；下一条 header 仍应作为可靠结束边界。

因此阶段 3 的解析必须保持“原始行索引是主数据，结构化事件是旁路索引”的模型：任何规则无法识别或解析失败的内容都继续作为普通 log 行展示，不丢弃、不阻塞 viewer。第一版只对高价值结构生成 marker：网络消息、可解析 JSON 行/块、错误堆栈和可配置关键字；普通日志只用于文本展示和搜索。

尚未确定的设计点：

- 规则配置文件格式和 UI 编辑方式。
- marker type 到颜色/形状的完整映射规则。
- JSON 解析失败时诊断 marker 的展示细节。

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

- 首个开发切片建议优先完成 Tauri + TypeScript 前端 + Rust command 的最小闭环，再进入 tail、marker、搜索和 socket。
- 阶段 0 已采用 Tauri 2 + Vite + React + TypeScript 骨架；前端通过 `@tauri-apps/api/core` 调用 Rust command。
- 前端包管理器使用 Yarn 1.x；Tauri dev/build 前置命令使用 `yarn dev` 和 `yarn build`。
- VS Code 调试入口为 `.vscode/launch.json` 中的 `Tauri Dev: log_scope`，本质是在工作区根目录执行 `yarn tauri:dev`。
- 当前 Rust command 包含 `health_check`、`open_file_placeholder`、`open_log_file`、`get_log_lines`；文件查看主链路应优先使用后两个接口。
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
