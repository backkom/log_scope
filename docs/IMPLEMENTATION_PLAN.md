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

状态：已完成第一版编码。当前支持手动输入本机文件路径、后台线程池建立行偏移索引、按可见范围读取行、固定行高虚拟列表、行号 gutter、跳转到行号、滚动到顶部/底部、50 MB fixture 一键生成并打开、展示 fixture 生成耗时和索引耗时。仍需补充真实文件选择器、50 MB fixture 手工性能记录和索引进度/取消体验。

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

状态：已完成第一版编码。当前通过前端定时调用 Rust command `refresh_log_file(sessionId)` 轮询文件 size；文件追加时 Rust 只读取新增字节并增量更新行偏移索引；前端提供 follow tail 开关，开启时自动跟随末尾，关闭时保留当前阅读位置并显示新增行提示；检测到文件截断或轮转时重新建立当前文件索引并提示用户。仍需补充高频追加压力测试、真实轮转场景验证和更细粒度的错误/状态展示。

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

状态：已完成第一版编码。当前支持 `Send Message` / `Receive Message` 消息块提取、marker 摘要 API、按需 payload API、严格 JSON 尝试解析与 raw fallback、Canvas minimap marker 点绘制、点击 marker 跳转并查看 payload。已使用 `com.sevenpirates.monster.gameLog.log` 做可选回归测试。仍需补充更多 extractor，例如单行 JSON 事件、Lua stack traceback、ChangeState、用户自定义关键字/正则规则，并在高频 tail 场景下验证是否需要把 marker 重建改为增量扫描。

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

## 阶段 4：搜索与定位

目标：提供接近编辑器的基础查找体验。

任务：

- Rust 实现普通文本搜索，支持取消和渐进式结果。
- 前端实现 find next、find previous、当前匹配项、可见范围高亮。
- 新增行追加后，搜索状态保持稳定，并可继续扫描新增内容。
- 增加跳转到 byte offset 的内部能力，作为行号跳转补充。
- 暂缓 regex，等普通搜索性能和交互稳定后再加入。

验收：

- 50-100 MB 文件上可以搜索普通文本，期间应用可继续操作。
- 可见匹配项高亮不要求全量 DOM decoration。
- 搜索结果未完成时有明确状态。

## 阶段 5：socket 数据源

目标：支持连接 IP/端口并接收本项目协议数据。

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
