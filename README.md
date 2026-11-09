<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" alt="LogScope 图标" />
</p>

<h1 align="center">LogScope</h1>

<p align="center">
  面向 Windows / macOS 的高性能、只读日志查看器<br/>
  50–100 MB 大文件不卡顿，实时流边收边看，协议消息一眼可见。
</p>

<p align="center">
  <a href="https://github.com/backkom/log_scope/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/backkom/log_scope/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/backkom/log_scope/actions/workflows/release.yml"><img alt="Release" src="https://github.com/backkom/log_scope/actions/workflows/release.yml/badge.svg" /></a>
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-2f6feb" />
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green" /></a>
</p>

---

## 背景：为什么需要另一个日志工具

这个项目来自真实的工作场景：调试一个 Unity 客户端 + 服务端联调的游戏，手上有几类日志——

- Unity 编辑器 / 打包客户端写出的纯文本日志，单文件经常 **50–100 MB**、几十万到上百万行；
- 客户端与服务端之间的协议消息，形如
  `13:05:42	========= Receive Message ([342] S_GET_CSVFILE_RESULT) =========`，
  后面跟一大段 pretty-printed JSON；
- 穿插在日志里的单行 JSON 埋点事件、`ChangeState ... { ... }` 状态块、Lua `stack traceback:` 堆栈；
- 服务端还在持续写、或者通过 socket 实时推过来的**流式**日志。

用现成工具看这些日志，每一种都差一口气：

| 工具 | 卡在哪里 |
| --- | --- |
| VS Code / Sublime / Notepad++ | 把整份文件装进编辑器文档模型。100 MB 打开就要等，滚动掉帧，内存翻几倍；文件还在追加时无法优雅跟随 |
| `grep` / `less` / `tail -f` | 能搜能追，但只有文本，看不出哪几行是一条完整的协议消息，也没有全局分布概览 |
| Unity Console / 游戏内控制台 | 只保留最近若干行，历史回看无从谈起 |
| 通用日志平台（ELK 等） | 需要先把日志送上去，本地离线文件、内网 socket 直连的场景反而更麻烦 |

结论很直接：需要一个**只读的、为「大文件 + 实时流 + 结构化事件」专门设计**的查看器，而不是再给通用编辑器加插件。

## LogScope 解决什么问题

1. **大文件不卡。** 原始日志始终留在磁盘：Rust 侧只建立 `行号 → 字节偏移` 索引，前端只按可见范围请求文本，永不把完整文件塞进 DOM 或编辑器文档。
2. **实时流不打断阅读。** 文件以 `tail -f` 语义增量刷新，socket 数据边收边追加；只有打开「跟随 Tail」时才自动滚到末尾，否则只提示新增行数、保持你当前的阅读位置。
3. **语义可见。** 协议消息块、JSON 事件、错误堆栈、关键字被提取成 **marker**：左侧可浏览和过滤，右侧 minimap 用颜色和小圆点展示整份日志的分布，点一下就能跳到对应位置并展开 JSON。
4. **定位够快。** 编辑器级查找（Regex / 大小写 / 全字 / 循环 / 查找所有）、行号跳转、marker 列表与收藏，都在同一条热路径上。
5. **跨平台一致。** Windows 和 macOS 共用同一套 Rust 核心与前端实现，而不是两套壳。

## 核心功能

| 能力 | 说明 |
| --- | --- |
| 打开大文件 | UTF-8 / UTF-8 lossy 文本，按需 seek 读取，索引在后台线程构建并回报耗时 |
| Tail 跟随 | 轮询检测文件增长，只读取新增字节并增量更新行索引；截断 / 轮转后自动重建 |
| Socket 实时流 | 主动连接 TCP 服务端，按 `logscope-frame-v1` 解码，写入临时 session 文件后复用同一套查看链路 |
| 局域网自动发现 | 监听 `logscope-discovery-v1` UDP 广播，连接弹窗直接列出可用服务端 |
| 虚拟化 Viewer | 固定行高、可见行 + 少量 overscan、有界行缓存，快速滚动时先渲染占位行再回填 |
| 查找 | `Ctrl+F` 浮层、`F3` / `Shift+F3` 遍历、`Ctrl+G` 行号跳转；匹配高亮只作用于渲染窗口 |
| Marker 提取 | `Send/Receive Message` 消息块、单行 JSON 事件、`ChangeState` 块、Lua `stack traceback`、关键字（error/warn/…） |
| Marker 侧栏 | 按标题 / 消息名 / 类型搜索，按 kind 多选过滤，点击跳转并展开 JSON Tree |
| Minimap | 顶部全局 marker 条（整份日志分布）+ 右侧 8 视口局部 minimap（Canvas 绘制，可拖拽） |
| 日志着色 | 三态：完整着色 / 仅 severity / 关闭；单行最多处理前 4 KB，纯装饰、不影响主链路 |
| 规则配置 | 五类 extractor 可启停、可配色；区分「即时生效」与「需重新扫描」两类配置 |
| 本地持久化 | `state-v1.json` 保存最近文件 / 最近 socket / 收藏夹 / 低风险 UI 状态 |
| 收藏夹 | 文件 / socket 可收藏到原生应用菜单，支持自定义名称与 8 色颜色标签，跨会话保留 |
| 应用内更新 | 启动时静默检查 GitHub Releases，有新版本时在菜单栏显示红点；用户点击 **Help → Check for Updates...** 后才下载、覆盖安装并自动重启，不弹窗打扰、不强制更新 |
| 性能观测 | 状态栏展示虚拟化 DOM 行数、缓存行数，以及顶部 marker 条与右侧 minimap 的 Canvas 绘制耗时 |
| 大文件降级 | ≥100 MB 自动降为仅 severity 着色，≥300 MB 默认隐藏右侧 minimap，均可手动恢复 |

## 界面结构

```text
┌───────────────────────────────────────────────────────────────────┐
│ 工具栏   暂停/恢复 · 数据源 · 收藏 · 规则设置 · 着色 · 跟随 Tail   │
├───────────────┬───────────────────────────────────┬───────────────┤
│               │ ▏▏▏ 顶部全局 marker 条（整份日志） │               │
│  Marker 侧栏  ├───────────────────────────────────┤   右侧        │
│  搜索 / 过滤  │  行号 │ log 文本（虚拟化只读）     │   minimap     │
│  列表 / 详情  │       │                            │  （8 视口）   │
├───────────────┴───────────────────────────────────┴───────────────┤
│ 状态栏  文件大小 · 总行数 · 索引耗时 · 查找耗时 · marker 总数     │
└───────────────────────────────────────────────────────────────────┘
```

## 架构

```mermaid
flowchart LR
  F[日志文件] -->|tail 轮询 / 增量读取| C[Rust Core]
  S[Socket 服务端] -->|logscope-frame-v1| C
  D[UDP 广播] -->|logscope-discovery-v1| C

  C --> I[行索引<br/>行号 → 字节偏移]
  C --> M[Marker 提取器]
  C --> P[持久化 state-v1.json]

  I --> T[Tauri Command 层]
  M --> T
  T -->|get_log_lines 可见行| V[虚拟化 Viewer]
  T -->|get_log_markers / payload| W[Minimap + 侧栏]
  V --> U[React 前端]
  W --> U
```

**职责划分**

- **Rust core**：文件 tail、TCP socket、frame 解码、文本与换行规范化、行索引、marker 提取、搜索、持久化、有界内存与背压。
- **前端（React + TypeScript）**：虚拟化只读文本视口、行号 gutter、可见行着色、查找 UI、Canvas minimap、JSON viewer 与全部交互映射。
- **不跨层**：前端不持有完整日志，不做解析决策；解析永远发生在 Rust 侧。

**关键决策**

- 采用 **append-only** 数据模型，行索引是主数据，结构化事件只是旁路索引——任何解析失败的内容都继续作为普通行展示，不丢行、不阻塞 viewer。
- 不做通用文本编辑器：没有编辑、保存、语法高亮系统，只有日志需要的读取、查找、跳转和标记。
- 不把 Monaco / CodeMirror 当作大文件主文档承载方案。
- CudaText 只作参考（大文件降级、minimap 概念、查找体验），不作为产品基础。

更多设计取舍见 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) 与 [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)。

## 数据来源

### 1. 文件 tail

打开本地文件后，应用按固定间隔调用 `refresh_log_file` 检查大小；文件增长时只读取新增字节并增量更新行索引，文件变小时按截断 / 轮转处理。

### 2. Socket 流

使用本项目定义的 length-prefixed 协议 `logscope-frame-v1`：

```text
┌────────────────┬──────────────────────────────┐
│ 4 字节 BE 长度  │ UTF-8 JSON payload           │
└────────────────┴──────────────────────────────┘
```

payload 必须包含 `version: 1` 与 `recordType`：

| `recordType` | 字段 | 说明 |
| --- | --- | --- |
| `log.batch` | `records: [{ "text": "..." }]` | 一批可追加文本，末尾缺换行会自动补齐 |
| `log.text` | `payload: "..."` | 简单文本 frame |

单 frame 上限 8 MB。

仓库自带本地测试服务端，会持续发送随机日志并定期伪造 JSON marker 与 `Send/Receive Message` 块：

```bash
python3 scripts/logscope_socket_server.py --host 127.0.0.1
```

Unity 侧发送端参考实现见 [scripts/LogSender.cs](scripts/LogSender.cs)。

### 3. 局域网自动发现

服务端每 3 秒向 UDP `9876` 广播 `logscope-discovery-v1`（`protocol` / `host` / `port` / `hostname`），客户端在连接弹窗打开期间监听并列出可用服务端。

## 快速开始

### 环境要求

- **Node.js** 18+（推荐 20）与 **Yarn 1.22**
- **Rust** stable（建议 1.77+）
- **Tauri 2 平台依赖**
  - Windows：Microsoft C++ Build Tools + WebView2 Runtime
  - macOS：Xcode Command Line Tools（`xcode-select --install`）

### 开发

```bash
yarn install
yarn tauri:dev
```

VS Code 用户可直接使用 `.vscode/launch.json` 中的 `Tauri Dev: log_scope` 配置。

### 常用检查

```bash
yarn checktsc                                   # 前端类型检查
cargo check --manifest-path src-tauri/Cargo.toml # Rust 编译检查
```

### 本地打包

```bash
# macOS：生成 .app 与 .dmg（未签名）
yarn run package:macos

# macOS 通用二进制（Apple Silicon + Intel）
yarn run package:macos -- --universal

# Windows：生成 NSIS + MSI 安装包（必须在 Windows 主机执行）
yarn run package:windows
```

产物位于 `src-tauri/target/release/bundle/`。需要 Apple 签名 / 公证时，先配置 Tauri 所需证书环境变量，再执行 `LOGSCOPE_SIGN=1 yarn run package:macos`。

打包会同时生成自动更新所需的 `.sig` 签名与 `.app.tar.gz`（macOS）产物。Tauri bundler 从 `TAURI_SIGNING_PRIVATE_KEY` 读取密钥内容；脚本也接受 `TAURI_SIGNING_PRIVATE_KEY_PATH`（自动读取文件内容），未设置时使用 `~/.tauri/logscope.key` 及同目录 `.password` 文件。缺少密钥时脚本会直接报错。密钥配置方式见下方「应用内自动更新」。

## GitHub Actions：跨平台自动构建与发布

仓库内置两个工作流，推送后即可在 GitHub 上编译各平台产物。

### `ci.yml` — 提交检查

在 `push` / `pull_request` 时对 **Windows + macOS** 双平台执行：

1. 安装依赖（Yarn 1.22，`--frozen-lockfile`）
2. `yarn checktsc` 前端类型检查
3. `yarn build` 前端产物构建
4. `cargo check --locked` Rust 编译检查

### `release.yml` — 打标签即发布

推送 `v*` 标签（或手动触发工作流）后，自动：

- macOS 上构建 **universal**（`aarch64` + `x86_64`）的 `.app`、`.dmg` 和 updater 用的 `.app.tar.gz`
- Windows 上构建 `NSIS` `.exe` 与 `.msi` 安装包
- 为 updater 产物生成 `.sig` 签名与 `latest.json`，并连同安装包一起上传到对应的 GitHub Release

### 启用步骤

1. 在 GitHub 新建空仓库（不要勾选初始化 README），然后推送：

   ```bash
   git remote add github git@github.com:OWNER/log_scope.git
   git push -u github master    # 本地分支是 main 时改为 git push -u github main
   ```

2. 打开 **Settings → Actions → General → Workflow permissions**，选择 **Read and write permissions**（发布 Release 需要）。
3. 配置自动更新签名 Secrets（发布工作流必需，否则构建会因缺少签名密钥失败）：
   - `TAURI_SIGNING_PRIVATE_KEY`：`~/.tauri/logscope.key` 文件的完整内容；
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成该密钥时设置的密码。

   这两个值与 `src-tauri/tauri.conf.json` 中的 updater 公钥一一对应；更换密钥后必须同步更新公钥，否则客户端会拒绝更新包。
4. 打标签并推送，触发发布（标签版本应与三处版本号一致）：

   ```bash
   git tag v0.1.1
   git push github v0.1.1
   ```

5. 在 **Actions** 页面观察构建，完成后在 **Releases** 下载各平台安装包；`latest.json` 会作为 Release 资产自动上传，供应用内更新读取。

也可以不建 Release、只验证编译：在 **Actions** 里手动运行 `release.yml`，构建产物会以 artifact 形式保留。

> **关于签名**：默认产物未签名，安装时的系统拦截与绕过方法见下方「安装与首次运行」。
> 如需正式签名，在仓库 Secrets 中配置 Apple 证书（`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` /
> `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`），并取消 `release.yml` 中签名相关注释。

## 安装与首次运行

发布产物均为**未签名**构建，操作系统会主动拦截，这是预期行为，不是文件损坏。下面按平台说明。

### 下载哪个文件

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| macOS（Apple Silicon / Intel 通用） | `LogScope_<版本>_universal.dmg` | 双击挂载，把 `LogScope.app` 拖进「应用程序」 |
| Windows | `LogScope_<版本>_x64_en-US.msi` | 推荐，标准安装流程 |
| Windows | `LogScope_<版本>_x64-setup.exe` | NSIS 安装包，与 MSI 二选一即可 |

> Release 页面里的 `Source code (zip)` / `Source code (tar.gz)` 是 GitHub 为每个 Release 自动附带的源码归档，**不是可执行程序**，无需下载。

### macOS

首次打开会提示「无法打开，因为 Apple 无法检查其是否包含恶意软件」。任选一种方式放行：

1. **右键打开**（推荐，只需一次）：在 Finder 里右键点 `LogScope.app` →「打开」→ 弹窗中再点一次「打开」。
2. **命令行移除隔离属性**：

   ```bash
   xattr -dr com.apple.quarantine /Applications/LogScope.app
   ```

3. **系统设置**：「系统设置 → 隐私与安全性」，滚到底部点「仍要打开」。

若提示「已损坏，无法打开」，通常是 App 被移动或解压过程破坏了签名缓存：重新挂载 DMG 再把 `LogScope.app` 拖进「应用程序」，必要时先执行 `xattr -cr /Applications/LogScope.app`。Apple Silicon 机器运行的是 universal 二进制，无需 Rosetta。

### Windows

首次运行会出现「Windows 已保护你的电脑」（SmartScreen），点击「更多信息」→「仍要运行」。若被 Defender 隔离，需要在「Windows 安全中心 → 病毒和威胁防护 → 保护历史记录」中还原并允许。

### 运行环境

- **不需要**安装 Node.js、Rust 或任何运行时：Rust 核心已静态编译进应用，前端产物已内嵌。
- 需要系统具备 WebView2（Windows 10/11 通常已预装；缺失时系统会提示下载）。
- 应用会在 Tauri app data 目录写入 `state-v1.json` 保存最近文件、最近 socket、收藏夹和 UI 偏好。
  - macOS：`~/Library/Application Support/com.logscope.viewer/state-v1.json`
  - Windows：`%APPDATA%\com.logscope.viewer\state-v1.json`
- Socket 局域网自动发现会监听 UDP `9876`；若系统防火墙首次弹窗询问，需允许才能列出可用服务端。
- 应用为**只读**查看器，不会修改被打开的日志文件；socket 会话会写入系统临时目录下的 `log_scope/socket`。

### 卸载

macOS 把 `LogScope.app` 拖进废纸篓；Windows 在「应用和功能」中卸载。需要彻底清理时一并删除上面的 app data 目录。

## 应用内自动更新

应用启动时会静默检查一次版本，但不会下载或安装任何东西，也不会弹窗：

- 发现新版本：菜单栏显示 `Help 🔴`，菜单项变为 **Check for Updates (vX.Y.Z)** 并带红色圆点图标；不打扰当前使用。
- 没有新版本或检查失败：不显示红点，也不提示。

只有用户点击该菜单项后才会进入安装流程：

1. 重新请求 `https://github.com/backkom/log_scope/releases/latest/download/latest.json`，比较其中的版本与当前应用版本。
2. 没有新版本：弹窗提示「当前已是最新版本」，并清除菜单红点。
3. 有新版本：显示下载进度，下载完成后自动覆盖安装并重启。
   - Windows：以 passive 模式运行 NSIS 或 MSI 安装器；若安装目录需要管理员权限，会出现 UAC 提示。
   - macOS：原地替换 `/Applications` 中的 `LogScope.app`；无写权限时会弹出管理员授权。
4. 失败时弹窗展示原因，并提示从 GitHub Releases 手动下载；此时保留已有红点。

说明与限制：

- Windows 会使用与当前安装方式匹配的更新包：NSIS 安装的用 `-setup.exe`，MSI 安装的用 `.msi`。
- 更新包必须通过 minisign 公钥校验（公钥位于 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`），且签名内版本必须与 `latest.json` 一致（`requireSignedVersion`）；任何校验失败都会拒绝安装。
- 本功能从 **0.1.1** 开始提供；0.1.0 及更早版本需要手动安装一次 0.1.1，之后才能自动升级。
- 暂不支持 beta 通道、增量更新和版本回滚。

### 维护者：签名密钥与发布

自动更新依赖一对 minisign 密钥。私钥不能提交仓库，公钥写在配置里。

1. 生成密钥（已有密钥时跳过）：

   ```bash
   yarn tauri signer generate -w ~/.tauri/logscope.key
   ```

   如果设置了密码，把密码保存在 `~/.tauri/logscope.key.password`，本地打包脚本会自动读取。

2. 把输出中的公钥填入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。
3. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：
   - `TAURI_SIGNING_PRIVATE_KEY`：`~/.tauri/logscope.key` 文件全文；
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：密钥密码（无密码时留空）。
4. 同步提升 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的版本号，再推送 `v*` 标签。发布工作流会生成带签名的更新包和 `latest.json`。

> 密钥丢失或更换后，旧版本客户端将无法验证新的更新包，只能手动安装一次新版本。请妥善备份私钥与密码。

## 性能与降级

| 场景 | 行为 |
| --- | --- |
| 打开 100 MB 文件 | 后台构建行索引，UI 不冻结；状态栏展示索引耗时 |
| ≥ 100 MB | 自动降为仅 severity 行级着色 |
| ≥ 300 MB | 默认隐藏右侧 minimap，可在状态栏手动恢复 |
| 快速滚动 | 先渲染行号与占位行，Rust 返回后逐行回填，不缓存完整文件 |
| 持续 append | 未开启跟随 Tail 时只更新总行数并提示新增行，不改变阅读位置 |

性能验证方式：应用内不再提供 fixture 生成与 benchmark 命令（早期 Debug 菜单已移除）。需要基准数据时，自行准备 log 样本直接打开，在状态栏观察索引耗时与渲染耗时；需要可重复的基准时在开发环境临时添加测试代码。

## 项目结构

```text
log_scope/
├── src/                       # React + TypeScript 前端
│   ├── main.tsx               # 应用主体：viewer、minimap、查找、侧栏、设置
│   └── styles.css
├── src-tauri/                 # Tauri 2 应用外壳与 Rust core
│   ├── src/lib.rs             # 全部 Tauri command 与日志处理核心
│   ├── src/update.rs          # 应用内自动更新（GitHub Releases + minisign）
│   ├── tauri.conf.json
│   └── icons/
├── scripts/
│   ├── logscope_socket_server.py   # 本地 socket 测试服务端（含 UDP 广播）
│   ├── LogSender.cs                # Unity 侧发送端参考实现
│   ├── package-macos.sh
│   └── package-windows.ps1
├── docs/
│   ├── PROJECT_CONTEXT.md     # 长期项目记忆（架构 / 约束 / 取舍）
│   └── IMPLEMENTATION_PLAN.md # 分阶段实现计划
├── .github/workflows/         # CI 与跨平台发布
└── AGENTS.md                  # AI / Agent 协作说明
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) | 长期项目记忆：需求、架构决策、协议、实现约束 |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | 分阶段实现计划与交付切片 |
| [AGENTS.md](AGENTS.md) | AI agent 协作与文档维护规则 |

> 修改架构或行为时，请同步更新 `docs/PROJECT_CONTEXT.md`。

## 路线图

- [x] 应用内自动更新：菜单主动检查 GitHub Releases，带签名校验、覆盖安装与自动重启
- [ ] Marker 索引增量扫描（高频 tail 场景不再全量重建）
- [ ] 搜索任务取消与流式分批返回，替代单次 command
- [ ] 渐进式索引与进度 / 取消 UI，覆盖 300 MB 以上文件
- [ ] Socket 连接状态事件、显式断开与自动重连
- [ ] 更完整的规则系统：正则起始模式、多级 severity、规则导入导出
- [ ] 签名与公证的正式发布流水线

## 贡献

1. Fork 并创建特性分支。
2. 提交前跑通 `yarn checktsc` 与 `cargo check --manifest-path src-tauri/Cargo.toml`。
3. 涉及架构或行为变化的改动，同步更新 `docs/PROJECT_CONTEXT.md`。
4. 提交 PR，描述动机、改动范围与验证方式。

## 许可证

[MIT](LICENSE)
