# 项目上下文

最后更新：2026-04-26

本文档是 `log_scope` 的长期项目记忆。后续 AI agent 和开发者在做项目决策前应先阅读本文档；当需求、架构、取舍或实现细节发生变化时，必须同步更新本文档。

分阶段实现计划见 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。后续实现应优先按该计划拆分小步交付，并在实际约束变化时同步更新计划和本文档。

## 产品目标

构建一个面向 Windows 和 macOS 的高性能、只读 log 可视化桌面工具。

该工具不是通用文本编辑器，而是专注于大文件和实时数据流的 log viewer。它需要提供快速导航、查找、语义标记展示，以及右侧 minimap/micromap 风格的全局概览。

常规运行目标数据规模：50-100 MB 文本文档或实时 log 流。

应用图标应保持简洁，体现 log viewer 的工具属性：核心视觉元素为 log 文档/日志行和放大镜；图标背景使用透明底，避免做成不透明纯色块。

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
- 当前打开的数据源路径显示在桌面窗口标题中，不占用 viewer 顶部正文信息区。
- 行号跳转通过 `^+G`（Control+G）触发居中覆盖浮层；该浮层不改变 viewer 高度，打开后必须保持输入框焦点，默认行号为当前视口中心行。打开浮层时只预填行号，不改变当前视口位置；用户修改输入框文本后，才实时把目标行尽量滚动到视口中心并临时高亮。浮层关闭并把焦点交还给 viewer 后必须取消行级高亮。回车只结束输入、把焦点交还给 viewer，并选中目标行文本，不把 DOM 焦点放到目标行。
- 查找浮层中按回车执行查找后，应把 DOM 焦点交还给 viewer，使后续 `F3` 可继续触发查找下一个。
- 能在大文件和实时流场景下高效滚动。
- 不暴露编辑、保存等通用编辑器工作流。
- 底部状态栏以覆盖层固定在底部，不参与 viewer 高度计算，集中展示文件大小、总行数、索引耗时、查找耗时和 marker 总数；当前路径只显示在桌面窗口标题中。
- 跟随 Tail/阅读锁定应作为状态栏尾部的可点击按钮切换，不放在左侧操作栏；状态栏尾部同时提供日志着色三态图标按钮（完整着色、仅 severity、关闭）以及顶部全局 marker 条和右侧 minimap 的图标按钮，用于快速切换显示模式。

右侧：

- minimap/micromap 分为两层：log 上方的置顶全局 marker 条横向展示整个 log 的 marker 分布；右侧 minimap 类似代码编辑器 minimap，纵向展示当前 8 个视口范围内的 marker 分布并承载视口滑块交互。
- 不展示原始文本内容。
- 展示从 log 中提炼出的语义信息。
- 某些带特殊标记的行可以解析出 JSON 数据。
- 这些特殊行应以不同颜色的符号展示，例如小圆点。
- minimap 不显示网格底纹；顶部全局 marker 条和右侧 minimap 与其它视图之间保留清晰分隔线。
- 顶部全局 marker 条和右侧 minimap 都需要显示当前视口对应的半透明矩形。顶部矩形需要红色线框以增强可见性，宽度由当前视口行数决定，视口越高则覆盖的 log 行数越多、矩形越宽；右侧矩形保持无边线。
- 右侧 minimap 的视口矩形高度固定为 minimap 可见高度的 1/8，因此右侧 minimap 当前展示范围为 8 个当前视口高度的 log 区间。矩形贴边绘制、无外边距；矩形在该区间顶部时其上边与滑动轨道上边对齐，在该区间底部时其下边与滑动轨道下边对齐。
- 按住右侧 minimap 视口矩形拖动时，行为必须等同于拖动全文件滚动条滑块：矩形 top 在整个轨道中的比例映射到整个 log 的可滚动范围；手动滚动 viewer 时，矩形位置必须按同一比例同步更新。
- 在右侧 minimap 视口矩形内点击不改变视口；点击矩形上方让 viewer 向上移动一个当前视口范围，点击矩形下方让 viewer 向下移动一个当前视口范围。
- 右侧 minimap 内 marker 的纵向位置必须按该 8 个视口的当前展示范围连续计算，而不是按整个 log 或固定块计算；拖动滑块时 marker 位置要随视口变化同步更新。顶部全局 marker 条继续负责展示整个 log 的全局 marker 分布。
- 点击顶部全局 marker 条或右侧 minimap 中的 marker 时，统一选中 marker、加载 payload，并将该 marker 起始行居中到 viewer；此时右侧 minimap 不再额外执行翻页或拖动响应。
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
- 可见行轻量日志着色。
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
- 消息 marker 的颜色由 `message_id` 通过稳定 hash 计算得到，同一个消息 ID 在多次运行中应得到同一个颜色。
- 消息 marker 在 minimap 横向位置由 `message_id / max_message_id` 决定，`max_message_id` 使用当前 session 已识别消息中的最大 ID；同一个消息 ID 在同一个 session 中应保持同一横向位置。
- 前端 minimap 使用两张 Canvas：顶部全局 marker 条横向映射整个 log 的行号范围，并绘制当前视口对应的红色线框矩形；右侧 minimap 按当前 8 个视口高度的连续局部范围纵向映射 marker，并绘制贴边、无边线的视口矩形。消息 marker 使用三角形，`Receive` 和 `Send` 使用不同朝向；其他 marker 使用圆点。点击任一 minimap 中的 marker 后，viewer 将 marker 起始行居中并加载 payload；可见行中的 marker 起始行会做轻量背景标记。
- 右侧 minimap 同时维护两个坐标系：
  - 滑块坐标系：矩形高度固定为 Canvas 高度的 1/8；矩形 top 在整个轨道中的比例映射为全文件 viewer 可滚动范围。拖动矩形只使用全文件范围，不受右侧当前 marker 展示范围限制。
  - Marker 坐标系：右侧 Canvas 展示一个连续的 8 视口窗口。该窗口由当前 `firstVisibleLine` 和全文件滚动比例共同计算，使当前视口范围映射到矩形框内部；marker 只在落入该窗口时绘制，并按窗口内相对行号映射到纵向位置。
- 右侧 minimap 的滑块位置、marker 窗口和 viewer 可见行都必须由同一个当前视口状态派生；拖动滑块时需要立即同步 viewer scrollTop/firstVisibleLine，使 marker 位置和矩形位置一起更新。矩形内点击不改变视口，矩形上/下方点击分别按一个当前视口高度向上/向下翻动。
- 当前已补充轻量 extractor：单行 JSON 事件（优先用 `event_name` 作为标题）、`ChangeState ... { ... }` 块、Lua `stack traceback:` 块、基础关键字 marker（error/failed/not found/exception/warn/corrupt/currupted）。
- 当前 marker 索引在打开文件后构建；文件追加或截断刷新后会重建 marker 索引。该方案先保证正确性，后续高频 tail 压测如暴露成本，再改为增量 marker 扫描。

## Socket 协议

Socket 模式第一版使用 `logscope-frame-v1`，这是面向测试和早期集成的 length-prefixed framed protocol，而不是无边界裸文本流。

Frame 格式：

- 4 字节 big-endian unsigned length，表示后续 JSON payload 的字节数。
- JSON payload 使用 UTF-8 编码。
- payload 必须包含 `version: 1` 和 `recordType`。
- 当前支持 `recordType = "log.batch"`，字段为 `records: [{ "text": "..." }]`；每个 record 的 `text` 表示一条或多条可追加文本，Rust 写入 append-only 临时 log 时会补齐末尾换行。
- 当前支持 `recordType = "log.text"`，字段为 `payload: "..."`，用于简单文本 frame。
- 单个 frame 当前限制为 8 MB，避免异常长度导致无限内存增长。

阶段 5 第一版实现：

- Rust command `connect_log_socket(host, port)` 主动 TCP 连接服务端，连接成功后创建一个临时 socket session 文件。
- socket reader 后台读取 `logscope-frame-v1` frame，将 record 文本追加到临时文件。
- 前端继续通过既有 `refresh_log_file`、`get_log_lines`、`get_log_markers` 路径读取 socket session，因此 socket 流复用现有虚拟化 viewer、follow tail、搜索和 marker/minimap 能力。
- 仓库提供 `scripts/logscope_socket_server.py` 作为本地测试服务端，默认监听 `127.0.0.1:8765`，持续发送随机 log，并定期伪造单行 JSON marker 和 `Send/Receive Message` marker 块。

当前限制：

- socket session 第一版没有显式取消、重连和连接状态事件；连接断开时后台 reader 停止，前端仍可查看已接收内容。
- marker 仍通过刷新时重建索引获得，后续高频流压测如暴露成本，应改为增量 marker 扫描。

## 持久化与历史记录

阶段 6 第一版使用轻量 JSON 结构化存储，不引入 SQLite。存储文件位于 Tauri app data 目录的 `state-v1.json`，包含 `schemaVersion = 1`。

当前持久化内容：

- 最近打开文件：路径、显示名、最近打开时间，最多保留 12 条。
- 最近连接 socket：host、port、显示名、最近打开时间，最多保留 12 条。
- 最近数据源：用于启动后回填文件路径或 socket host/port 输入框，不自动打开。
- 低风险 UI 状态：follow tail、顶部全局 marker 条显示状态、右侧 minimap 显示状态、日志着色模式、最近搜索词和查找选项。

Rust command：

- `get_persisted_state()`：读取持久化状态；文件不存在或 JSON 损坏时回退安全默认值。
- `save_ui_state(uiState)`：保存低风险 UI 状态，并保持历史数据源不变。
- `open_log_file(path)` 成功后自动记录最近文件和最近数据源。
- `connect_log_socket(host, port)` 成功后自动记录最近 socket endpoint 和最近数据源。

前端启动后会加载持久化状态并恢复 UI 偏好；最近文件和最近 socket 会显示在数据源面板，可一键重新打开/连接。状态损坏不阻塞应用启动。

当前限制：

- 暂未提供删除单条历史记录、清空历史记录和迁移 UI。
- 最近数据源启动后只回填输入框，不自动重连 socket 或打开文件，避免意外读取大文件或连接网络。

## 性能基准与降级策略

阶段 7 第一版已实现可重复的本地性能样本与轻量观测入口：

- Rust command `generate_log_fixture(sizeMb, profile?)` 支持 `mixed`、`short-lines`、`long-lines`、`dense-markers`、`append-stream` 五类 fixture；`sizeMb` 当前限制在 1-512 MB。
- Rust command `run_core_benchmark(sizeMb, profile?)` 会生成 fixture，执行打开/索引与 marker 扫描、搜索 `error`、读取前 240 行，并返回索引耗时、marker 数、搜索耗时、匹配数和可见行读取耗时。
- 前端数据源面板可选择 fixture profile，生成 50 MB fixture 或运行 50 MB core benchmark；benchmark 生成的文件会保留在临时目录，便于后续手工打开复查。
- 状态栏展示当前虚拟化 DOM 行数/缓存行数，以及顶部全局 marker 条和右侧 minimap 最近一次 Canvas 绘制总耗时。
- 打开 100 MB 及以上文件时，前端自动降级为仅 severity 着色；打开 300 MB 及以上文件时，还会默认隐藏右侧 minimap。用户仍可通过状态栏手动恢复显示模式。

当前限制：

- core benchmark 是应用内 smoke benchmark，不替代后续独立 Criterion/系统级峰值内存基准。
- 暂未记录跨平台 app data、真实 100 MB/300 MB 样本和 socket burst 的长期数据表。
- Rust 索引仍是一次性构建；阶段 7 只实现了显示侧降级，渐进式索引和搜索取消仍留待后续切片。

## 虚拟化 Viewer 要求

不要把 50-100 MB log 加载进普通 DOM 节点或通用编辑器文档。

viewer 应该：

- 只渲染可见行和少量 overscan。
- 初期使用固定行高，便于性能优化和位置映射。
- 阶段 1 前端固定行高为 24px，滚动时按可见区高度和 overscan 计算 `get_log_lines` 请求范围。
- 阶段 1 前端维护有界行缓存，快速滚动时先渲染目标行号和占位行，待 Rust 返回后逐行填充；不缓存完整文件内容。
- 应用根布局固定在 100vh 内，左侧操作栏和右侧 viewer 分别滚动，避免滚动 log 时带动操作栏；右侧 viewer 外层只负责纵向滚动，滚动条位于 minimap 右侧；log 文本列内部独立负责横向滚动，minimap 不参与横向滚动上下文。
- 顶部全局 marker 条和右侧 minimap 可从底部状态栏隐藏/显示；隐藏时对应布局区域应收缩，不保留空白占位。
- viewer 纵向滚动条和 log 文本横向滚动条的轨道背景必须与 log 文本背景色一致，避免在深色文本区右侧或底部露出平台默认浅色滚动槽。
- 快速滚动时，viewer 外层滚动空间、sticky viewport、可见行容器、行号 gutter 和占位行都必须铺固定深色背景，避免数据尚未刷新时露出默认白底；占位行不显示横向 skeleton 条，以免加载延迟被放大成闪屏。
- viewer 滚动空间必须至少覆盖当前 viewport，并在文本总高度后保留一行底部余量，避免短文件或滚动到底时最后一行被 sticky/overflow 边界裁剪。
- 大文件默认关闭自动换行，参考 CudaText 的降级思想。
- 文本显示需要轻量着色，参考 CudaText `Log files ^` lite lexer 的思路：只对可见行和少量 overscan 做逐行规则匹配，不保存全量 token，不运行完整语法 lexer。
- 第一版日志着色优先识别整行 severity 背景/前景和少量行内 token：success、error/exception/fail/fatal/crash、warning/critical/conflict/invalid/not found/out of date、括号/方括号/花括号片段、数字/时间戳、简单 identifier。
- 着色规则必须有明确成本上限：大小写不敏感；每行只处理有限长度，建议默认最多前 4 KB；超长行超过阈值部分按普通文本显示；规则数量保持小且固定。
- 日志着色不得影响索引、tail、搜索和滚动主链路；如果渲染耗时在大文件或高频 tail 场景下变高，必须支持关闭或降级为仅 severity 行级着色。着色模式入口放在底部状态栏尾部的图标按钮组，不放在左侧操作栏。
- 支持行号 gutter，并避免布局抖动。
- 搜索高亮和语义行标记只作用在可见范围或摘要数据上。
- 搜索匹配高亮与 marker 行背景应覆盖或叠加在日志着色之上，避免被基础 token 颜色吞掉。
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
- 日志文本着色只允许采用 lite lexer 风格的可见行规则匹配；不得引入需要全文件 token 状态或完整 AST 的语法系统。
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
- Ctrl+F 首次查找、find next 和 find previous 命中后，只有当目标匹配项不在当前视口内时才滚动并居中；如果匹配项已经在视口内，不应改变当前视口位置。
- 用户在 viewer 内选中一个完整词时，当前视口内所有与该词完全匹配的其它词都需要显示边框；被选中的词本身只保留原生选择效果，不额外显示边框。该效果只针对可见行计算，不为全文件创建 decoration。
- 搜索高亮需要与日志着色共存；匹配项视觉优先级高于基础日志 token 颜色。
- 如果全量计数成本高，可以渐进统计匹配数量。
- 支持跳转到行号或偏移。
- 第一版优先支持普通文本查找。
- Regex 在基础查找路径稳定且足够快之后再加入。

大文件和实时数据场景下：

- 搜索可以是渐进式。
- 如果全量扫描尚未完成，应明确表现为“部分结果”。
- 新数据追加后，尽量保持当前搜索结果位置稳定。

阶段 4 第一版当前实现：

- Rust command `search_log_text(sessionId, query, startLine?, startColumn?, direction, caseSensitive, useRegex?, wholeWord?, wrapAround?, findAll?)` 支持 `next` / `previous`、Regex、大小写开关、全字匹配、绕回扫描和“查找所有”模式。
- 搜索 command 只在锁内复制当前 session 的只读快照（路径、文件大小、行偏移），实际文件扫描在 blocking 线程中基于快照执行，避免长时间占用 session 锁阻塞可见行读取和 tail refresh。
- 查找栏包含 Regex、大小写、全字匹配、循环查找、查找所有 5 个开关；查找所有默认开启。
- 查找所有开启时，后端顺序扫描完整文件快照并返回全部匹配、全文件匹配总数、当前命中序号、当前匹配行号、列范围、行预览、扫描行数、耗时、是否截断、是否绕回；前端显示类似 `4/54` 的当前位置、缓存当前匹配集，并把匹配行居中到 viewer。
- 查找所有关闭时，后端只按当前方向返回下一个或上一个匹配，前端不缓存全量匹配集。
- 前端查找缓存必须绑定 session、文件大小、行数、query 和查找开关；文件追加、截断、重新打开文件或查找条件变化后缓存失效，下次查找重新扫描。
- 前端搜索高亮只在当前虚拟化渲染窗口内切分 span，不为全文件创建 DOM decoration；高亮规则与 Regex、大小写和全字匹配开关保持一致。
- 前端查找跳转使用视口可见性判断：命中行已在 viewer 可见范围内时保留 scrollTop，命中行不可见时再居中滚动到该行。
- 前端监听 viewer 内文本选区；当选区是单个非空、无空白的词时，只在当前渲染窗口中对完全匹配该词的其它可见片段绘制边框，选区本身不叠加该边框。Ctrl+F 仍以当前选区文本作为查找词。
- 当前搜索仍是单次 command，不是真正流式增量返回；后续如 100 MB 以上体验不够，应继续补搜索任务 ID、取消 command、分批事件/轮询结果和可复用计数缓存。
- 前端已实现日志着色模式：完整着色、仅 severity 行级着色、关闭，入口位于底部状态栏。完整着色只对可见行做最多前 4 KB 的逐行 tokenization，识别括号片段、数字/时间戳和简单 identifier；超出上限的尾部按普通文本显示。

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
