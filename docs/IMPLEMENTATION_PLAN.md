# log_scope 实现计划

本文档用于把 `log_scope` 拆成可逐步交付的阶段。每个阶段都应保持应用可运行、接口可测试、性能假设可验证。

## 总体原则

- 先建立 Tauri + Rust + 前端的最小闭环，再扩展大文件、tail、socket、搜索和 minimap。
- Rust core 负责数据接入、解析、索引、搜索、持久化和背压；前端只请求可见范围和摘要数据。
- viewer 第一版使用固定行高和虚拟列表，避免完整 log 进入 DOM。
- CudaText 只作为参考资料，不引入其实现栈。
- 性能基准和 fixture 生成器尽早进入仓库，避免后期凭感觉调优。

## 阶段 0：工程骨架

目标：建立可运行、可测试、可打包的最小桌面应用。

任务：

- 初始化 Tauri 项目，选择 TypeScript 前端框架。
- 建立 Rust workspace 或 Tauri 标准 `src-tauri` 结构。
- 增加基础命令接口：应用版本、健康检查、打开文件占位命令。
- 建立前端主布局：数据源选择页、主 viewer 页、右侧 minimap 占位。
- 建立 lint、format、单元测试和基础 CI 脚本。
- 明确目录约定：Rust core、前端组件、测试 fixture、文档。

验收：

- 本地可以启动桌面应用。
- 前端能调用 Rust command 并展示返回结果。
- README 中有开发启动命令。

## 阶段 1：只读文件查看 MVP

目标：打开普通 log 文件并以虚拟化方式查看。

状态：已完成第一版编码。当前支持手动输入本机文件路径、后台线程池建立行偏移索引、按可见范围读取行、固定行高虚拟列表、行号 gutter、`^+G` 居中覆盖式行号跳转，打开时默认填入当前视口中心行且不改变视口位置，输入行号后实时滚动并临时高亮目标行，关闭浮层后取消行级高亮，回车后焦点回到 viewer 并选中目标行文本但不抢 DOM 焦点到行元素、滚动到顶部/底部、50 MB fixture 一键生成并打开、展示 fixture 生成耗时和索引耗时。仍需补充真实文件选择器、50 MB fixture 手工性能记录和索引进度/取消体验。

任务：

- Rust 实现文件打开、元数据读取、编码默认按 UTF-8 处理。
- 建立 append-only segment 抽象，支持从文件读取指定字节范围。
- 建立行索引：`line_number -> byte_offset`。
- 前端实现固定行高虚拟列表和行号 gutter。
- 前端通过 Rust command 请求可见行范围，不缓存完整文件。
- 实现跳转到行号、滚动到顶部/底部。

验收：

- 可打开至少 50 MB 文本文件并滚动查看。
- DOM 中只存在可见行和少量 overscan。
- 打开文件期间 UI 不应长时间冻结。

## 阶段 2：tail 与追加数据

目标：支持文件追加并保持阅读位置稳定。

状态：已完成第一版编码。当前通过前端定时调用 Rust command `refresh_log_file(sessionId)` 轮询文件 size；文件追加时 Rust 只读取新增字节并增量更新行偏移索引；前端提供状态栏尾部的 follow tail/阅读锁定按钮，开启时自动跟随末尾，关闭时保留当前阅读位置并显示新增行提示；底部覆盖式状态栏显示文件大小、总行数、索引耗时、查找耗时、marker 数量和 follow tail/阅读锁定状态，不参与 viewer 高度计算，当前路径仅显示在桌面窗口标题；检测到文件截断或轮转时重新建立当前文件索引并提示用户。仍需补充高频追加压力测试、真实轮转场景验证和更细粒度的错误/状态展示。

任务：

- Rust 监听文件变化或轮询文件 size，检测 append。
- 增量读取新增字节，处理半行缓存和换行规范化。
- 增量更新行索引。
- 前端增加 follow tail 开关。
- 用户不在底部或未开启 follow tail 时，新数据不强制滚动。
- 增加截断/轮转检测策略，第一版可提示并重新打开。

验收：

- 外部持续写入文件时，viewer 增量显示新行。
- follow tail 开启时自动跟随末尾，关闭时保持当前阅读位置。
- 大量追加时 UI 仍可响应。

## 阶段 3：marker 与 JSON 事件

目标：从 log 行提取语义事件，并在 minimap 与 JSON viewer 中展示。

状态：已完成第一版编码。当前支持 `Send Message` / `Receive Message` 消息块提取、marker 摘要 API、按需 payload API、严格 JSON 尝试解析与 raw fallback、Canvas minimap marker 绘制、点击 marker 居中跳转并查看 payload。minimap 已拆为顶部全局 marker 条和右侧编辑器式 minimap：顶部横向展示整个 log 的 marker 分布，并显示当前视口对应的红色线框矩形；右侧提供高度为 minimap 1/8、无边线且无外边距的视口滑块，并展示 8 个当前视口高度的连续局部 marker 窗口。状态栏提供两个图标按钮，可隐藏/显示顶部全局 marker 条和右侧 minimap，隐藏时布局收缩。minimap 不显示网格底纹，但与其它视图之间保留分隔线。右侧滑块拖动按全文件滚动条语义同步 viewer 滚动，不受右侧 marker 窗口限制；右侧 marker 位置按当前 8 视口窗口内相对行号映射，并在拖动滑块或手动滚动 viewer 时同步更新。点击滑块上/下方分别按一个当前视口范围翻页；点击滑块内部不改变视口；点击顶部或右侧 marker 时统一将 marker 起始行居中，右侧 minimap 不再额外响应翻页或拖动。消息 marker 颜色由消息 ID 稳定计算，横向位置按 `message_id / max_message_id` 计算，收/发使用不同朝向三角形。已补充单行 JSON 事件、Lua stack traceback、ChangeState、基础关键字 extractor。已使用 `com.sevenpirates.monster.gameLog.log` 做可选回归测试。仍需补充用户自定义关键字/正则规则，并在高频 tail 场景下验证是否需要把 marker 重建改为增量扫描。

任务：

- 定义第一版 marker 语法，例如行内 prefix：
  - `@logscope { "type": "error", "payload": {...} }`
- Rust 增量扫描新增行，提取 marker type、颜色、行号、字节偏移和 JSON payload。
- JSON payload 与原始文本分开存储。
- 前端 minimap 第一版使用 Canvas 渲染 marker 点。
- 点击 marker 后展示对应 JSON viewer。
- JSON 解析失败时记录 parse error marker 或诊断信息。

验收：

- marker 行能在右侧概览中显示。
- 点击 marker 能定位到行并查看 JSON。
- 高密度 marker 场景下 minimap 不依赖大量 DOM 节点。

## 阶段 4：搜索、定位与轻量日志着色

目标：提供接近编辑器的基础查找体验，并让可见文本具备轻量日志着色能力。

状态：已完成第一版编码。当前支持 Rust command `search_log_text` 执行 find next / previous，支持 Regex、大小写开关、全字匹配、绕回扫描、查找所有、全文件匹配总数、当前匹配序号、耗时和扫描行数反馈；搜索扫描基于 session 快照执行，不长时间占用 session 锁。前端提供查找面板、上下跳转、当前匹配项可见性判断、`当前/总数` 显示和可见范围匹配高亮；查找所有默认开启并缓存当前匹配集，文件追加、截断、重新打开或查找条件变化后缓存失效。命中项已在视口内时查找跳转不改变 scrollTop，命中项不在视口内时再居中滚动；查找输入框回车后焦点回到 viewer，便于继续用 `F3` 查找下一个。前端已加入轻量日志着色，支持完整着色、仅 severity、关闭三种模式，入口位于底部状态栏尾部的图标按钮组；完整着色只处理当前渲染窗口内每行前 4 KB 文本，并识别 severity 行背景、括号片段、数字/时间戳和简单 identifier。viewer 内选中单个词时，当前可见范围内其它完全匹配词会显示边框，被选中的词本身只保留原生选择效果；Ctrl+F 仍以当前选区文本作为查找词。仍需补真正的搜索任务取消、分批/渐进式结果返回、跨 append 的增量更新，以及 50-100 MB 真实文件搜索耗时记录。

新增要求：

- 文本显示需要着色，但只能采用轻量逐行规则，不引入完整 lexer、AST 或全文件 token 存储。
- 着色参考 CudaText `Log files ^` lite lexer：只处理可见行和少量 overscan，规则大小写不敏感，每行只处理有限长度，建议默认最多前 4 KB。
- 第一版规则覆盖 success、error/exception/fail/fatal/crash、warning/critical/conflict/invalid/not found/out of date、括号/方括号/花括号片段、数字/时间戳、简单 identifier。
- 搜索匹配高亮和 marker 行背景的视觉优先级高于基础日志着色。
- 如果大文件或高频 tail 暴露渲染成本，必须可降级为仅 severity 行级着色或关闭着色。

任务：

- Rust 实现普通文本搜索，支持取消和渐进式结果。
- 前端实现 find next、find previous、当前匹配项、可见范围高亮。
- 前端实现可见行轻量 tokenizer，将原始文本拆成稳定 span，避免全量 DOM decoration。
- 定义日志着色样式 token：severity 行级状态、bracket、number/time、identifier、plain。
- 对超长行设置 tokenization 上限；超过上限的尾部按 plain 文本渲染。
- 确保搜索高亮可以切分并覆盖已有 token span，不破坏行号、横向滚动和虚拟列表布局。
- 新增行追加后，搜索状态保持稳定，并可继续扫描新增内容。
- 增加跳转到 byte offset 的内部能力，作为行号跳转补充。
- Regex 第一版已接入查找栏；后续需继续补复杂正则性能约束、取消和错误提示细化。

验收：

- 50-100 MB 文件上可以搜索普通文本，期间应用可继续操作。
- 可见匹配项高亮不要求全量 DOM decoration。
- 可见行具备日志着色，滚动时只为当前渲染窗口计算 token。
- 超长行和高频追加场景下着色不会造成明显卡顿，并可手动关闭或降级。
- 搜索匹配项、当前匹配项、marker 行背景与日志基础着色可以同时显示且层级清晰。
- 搜索结果未完成时有明确状态。

## 阶段 5：socket 数据源

目标：支持连接 IP/端口并接收本项目协议数据。

状态：已完成第一版编码。当前定义 `logscope-frame-v1`：4 字节 big-endian length + UTF-8 JSON payload，payload 包含 `version`、`recordType`，当前支持 `log.batch` records 和 `log.text` payload。Rust command `connect_log_socket(host, port)` 会连接 TCP 服务端，创建临时 socket session 文件，后台读取 frame 并追加文本；前端可输入 host/port 建立连接，socket session 复用既有 `refresh_log_file`、虚拟化 viewer、follow tail、搜索和 marker/minimap 路径。仓库新增 `scripts/logscope_socket_server.py`，VS Code launch 中新增 `LogScope Socket Server`，默认监听 `127.0.0.1:8765` 并持续产生随机 log、单行 JSON marker 和 Send/Receive Message marker 块。仍需补充显式取消、连接状态事件、断线重连、背压策略和高频 socket burst 压测。

任务：

- 定义 length-prefixed frame v1 协议，包含 version、record type、payload。
- Rust 实现 TCP 连接、读取、重连、取消和背压。
- 支持 payload 为 UTF-8 文本或 JSON Lines。
- socket 数据进入同一 append-only segment 和行索引模型。
- 前端实现 socket endpoint 表单和连接状态展示。

验收：

- 可连接本地测试 server 并持续展示流式 log。
- burst 输入不会导致前端积压失控。
- socket 断开、重连、取消行为可预测。

## 阶段 6：持久化与历史记录

目标：保存常用数据源和基础 UI 状态。

状态：已完成第一版编码。当前使用 Tauri app data 目录下的 `state-v1.json` 作为轻量结构化存储，包含 `schemaVersion = 1`；成功打开文件后自动保存最近文件和最近数据源，成功连接 socket 后自动保存最近 endpoint 和最近数据源；前端启动后恢复 follow tail、顶部全局 marker 条、右侧 minimap、日志着色模式、最近搜索词和查找选项，并把最近数据源回填到输入框。数据源面板会展示最近文件和最近 socket，可一键重新打开/连接。状态文件不存在或 JSON 损坏时回退安全默认值。仍需补充删除/清空历史记录、显式迁移测试和跨平台 app data 目录验证。

任务：

- 选择 SQLite 或轻量结构化存储。
- 保存最近文件路径、socket endpoint、显示名、最近打开数据源。
- 保存窗口布局、follow tail、最近搜索词等低风险状态。
- 建立迁移或 schema version。

验收：

- 重启应用后可从历史记录重新打开文件或 socket endpoint。
- 状态损坏时应用能回退到安全默认值。

## 阶段 7：性能基准与降级策略

目标：用可重复测试约束性能优化。

状态：已完成第一版编码。当前 `generate_log_fixture(sizeMb, profile?)` 支持 mixed、短行、超长行、高密度 marker、append stream 五类 fixture，前端可选择 profile 生成 50 MB 样本；新增 `run_core_benchmark(sizeMb, profile?)`，会生成 fixture 后测量打开/索引与 marker 扫描、搜索 `error`、读取前 240 行的耗时和结果规模。前端状态栏展示虚拟化 DOM 行数/缓存行数，以及 minimap Canvas 最近绘制耗时；打开 100 MB+ 文件自动降级为仅 severity 着色，打开 300 MB+ 文件同时默认隐藏右侧 minimap。仍需补充独立 benchmark harness、峰值内存记录、真实 100/300 MB 文件数据表、socket burst 压测、搜索取消和渐进式索引。

任务：

- 增加 fixture 生成器：50 MB、100 MB、300 MB、大量短行、超长行、高密度 marker、持续 append、socket burst。
- 增加 Rust core benchmark：索引速度、marker 扫描、搜索吞吐、内存峰值。
- 增加前端性能检查：滚动流畅度、DOM 行数、minimap 渲染耗时。
- 实现大文件降级策略：关闭自动换行、限制高成本高亮、渐进式索引和摘要。

验收：

- 每次关键优化都有可复现实测数据。
- 100 MB 文件打开、滚动、搜索、marker 渲染均有明确性能记录。

## 阶段 8：打包与跨平台收尾

目标：提供 Windows 和 macOS 可试用构建。

任务：

- 配置 Tauri 打包、应用图标、应用名和权限。
- 验证 macOS 与 Windows 文件选择、路径、换行、tail 行为差异。
- 验证 socket 权限、防火墙提示和错误展示。
- 增加崩溃日志和诊断导出入口。
- 梳理最小用户文档。

验收：

- macOS 和 Windows 均可安装/运行基础功能。
- 常见错误路径有清晰提示。

## 建议的首个开发切片

首个实际实现切片建议控制在阶段 0 + 阶段 1 的最小闭环：

1. 初始化 Tauri + TypeScript 前端。
2. Rust command 支持打开文件并返回指定行范围。
3. 前端显示虚拟化只读文本和行号。
4. 使用 fixture 生成器制造 50 MB log 做手工性能验证。

该切片完成后，再进入 tail、marker 和 minimap 的真实交互。
