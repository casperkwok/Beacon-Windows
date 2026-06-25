# Beacon for Windows — 技术规划

> 状态:规划定稿,待开工
> 关联:macOS 版仓库 `casperkwok/Beacon`(独立仓库,本项目不依赖其代码,仅对齐 provider 预设)

## 0. 定位

Beacon for Windows 是面向**国内非技术用户**的桌面应用,让小白零门槛地用 OpenAI Codex 接入
**国产模型**(DeepSeek / GLM / Kimi / Qwen / MiniMax …)。

核心差异化:OpenAI 官方已有 Codex 桌面 App(Microsoft Store / `winget install Codex`),
但它绑定 OpenAI 登录、不支持自定义 provider / base_url。Beacon 填的就是这个坑 ——
**让国内用户用便宜的国产 provider 跑 Codex,且全程不碰命令行。**

形态:**内嵌终端的桌面应用**。底层跑真实的 Codex 二进制(条件与 CLI 完全一致),
但用户看到的是一个 GUI:选 provider → 贴 key → 选项目文件夹 → 在窗口内的终端里跑 Codex。

## 1. 技术栈

### 后端(Rust / Tauri 2)

| 用途 | 选型 |
|------|------|
| 应用框架 | Tauri 2(`@tauri-apps/cli` 2.11.x) |
| 异步运行时 | Tokio |
| 内嵌 HTTP 代理 | axum + hyper(进程内 localhost 服务) |
| 上游中继 | reqwest(streaming / SSE) |
| JSON 转换 | serde / serde_json |
| TOML 读写 | toml_edit(保留用户 config.toml 注释与格式) |
| 伪终端 | portable-pty(wezterm,走 Windows ConPTY) |
| 二进制下载解压 | reqwest + flate2 + tar / zip |
| 状态持久化 | tauri-plugin-store |
| 原生对话框 | tauri-plugin-dialog |
| 自动更新 | tauri-plugin-updater |

翻译代理在 Tauri 里是**进程内的 Rust async 任务**,比 macOS 版(NWListener + 单独逻辑)更简洁。

### 前端(展现层)— 全部用当前最新稳定版

| 用途 | 选型 | 版本(2026-06) |
|------|------|----------------|
| 框架 | React + TypeScript | React 19.2 / TS 6.0 |
| 构建 | Vite | 8.x(需 Node 20+) |
| 样式 | Tailwind CSS v4 | 4.3.x |
| 组件 | shadcn/ui 风格(Radix 底座) | — |
| 终端渲染 | @xterm/xterm + addon | 6.0 |
| 动效 | Framer Motion | 12.x |
| 状态 | Zustand | 5.x |
| 图标 | lucide-react | — |
| 语言 | 默认中文,结构预留 i18n | — |

**Tailwind v4 注意(与 v3 不同):**
- 不再用 `tailwind.config.ts`,改 CSS-first 配置。
- 装 `@tailwindcss/vite` 插件(不走 PostCSS)。
- 在 `index.css` 里 `@import "tailwindcss";` + `@theme {}` 写设计 token:

```css
@import "tailwindcss";
@theme {
  --color-accent: #E39A3C;   /* 对齐 macOS 版金色 accent */
  --radius-card: 12px;
}
```

**xterm 注意:** 包名已改为 scoped —— `@xterm/xterm`、`@xterm/addon-fit`、
`@xterm/addon-web-links`、`@xterm/addon-webgl`。旧的 `xterm` / `xterm-addon-*` 已废弃。

## 2. 应用形态与界面

主窗口(桌面端核心)三个视图 + 系统托盘:

- **Onboarding**(首次启动):检测 / 自动安装 codex → 选 provider → 贴 API key
- **Workspace**:选项目文件夹 + 内嵌终端跑 codex(= "和 CLI 一样的条件")
- **Providers**:provider 增删改 / 一键切换(移植 macOS 版主功能)
- **托盘图标**:显示/隐藏窗口、快速切 provider、当前状态、退出

## 3. 小白 Onboarding 流程

```
启动
 └─ 检测 codex?
     ├─ 有 → 跳过
     └─ 无 → "正在为你准备 Codex…"(进度条,下载二进制到 %LOCALAPPDATA%)
 └─ 选模型供应商(默认 DeepSeek,列 GLM/Kimi/Qwen/MiniMax…)
 └─ 贴 API Key(配"如何获取 Key"的图文引导 + 跳转链接)
 └─ Beacon 自动写 config.toml + 启动翻译代理
 └─ "选择你的项目文件夹" → 内嵌终端启动 codex
完成 —— 用户全程没敲过一条命令
```

## 4. Codex 二进制管理(自动安装)

Codex CLI 现已是**独立 Rust 二进制,零 Node 依赖**(GitHub Releases 提供
`codex-x86_64-pc-windows-*`)。方案:**Beacon 自管二进制**

- 下载到 `%LOCALAPPDATA%\Beacon\bin\codex.exe`
- **全路径调用,不碰系统 PATH、不要管理员权限**
- 版本由 Beacon 掌控,可随应用更新一起升级
- 校验下载完整性(checksum)

> 国内网络:GitHub 下载慢,需准备**国内 CDN / OSS 镜像**存 codex 二进制及应用更新包。

## 5. 数据流

```
内嵌终端(@xterm/xterm)
   └─ portable-pty 跑 codex.exe(cwd = 用户项目)
        └─ codex 读 config.toml,base_url 指向 →
             localhost:动态端口(Beacon 进程内 axum 代理)
                └─ Responses → Chat 转换
                     └─ reqwest 转发到 DeepSeek/GLM/…(SSE 流式)
                          └─ Chat → Responses 转换回 codex
```

## 6. 项目目录结构

```
beacon-windows/
├─ src-tauri/                 Rust 后端
│  ├─ Cargo.toml
│  ├─ tauri.conf.json
│  ├─ build.rs
│  ├─ icons/
│  ├─ capabilities/
│  │  └─ default.json         Tauri 2 权限声明
│  └─ src/
│     ├─ lib.rs               run(): Builder + tray + 插件
│     ├─ main.rs
│     ├─ commands/            #[tauri::command] IPC 入口
│     │  ├─ mod.rs
│     │  ├─ codex.rs          检测/安装/更新 codex
│     │  ├─ providers.rs      config.toml CRUD + 切换
│     │  ├─ pty.rs            终端 spawn/写入/resize
│     │  └─ proxy.rs          代理状态/控制
│     ├─ codex/
│     │  ├─ detect.rs
│     │  └─ installer.rs      下载+解压+校验
│     ├─ config/
│     │  └─ codex_config.rs   toml_edit 读写 config.toml
│     ├─ proxy/               ★ 核心价值
│     │  ├─ server.rs         axum localhost 服务
│     │  └─ translator.rs     Responses↔Chat
│     ├─ pty/
│     │  └─ mod.rs            portable-pty 封装
│     ├─ models.rs            Provider/Template
│     ├─ store.rs
│     └─ error.rs
├─ src/                       前端 React + TS
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ index.css               Tailwind v4 入口(@import + @theme)
│  ├─ lib/
│  │  ├─ ipc.ts               invoke() 类型化封装
│  │  └─ theme.ts
│  ├─ store/                  Zustand
│  │  ├─ providers.ts
│  │  └─ session.ts
│  ├─ components/
│  │  ├─ ui/                  基础组件
│  │  ├─ Terminal.tsx         @xterm/xterm 封装
│  │  ├─ ProviderList.tsx
│  │  ├─ ProviderForm.tsx
│  │  ├─ RouteHero.tsx
│  │  └─ LogoMark.tsx
│  └─ views/
│     ├─ Onboarding.tsx
│     ├─ Workspace.tsx        文件夹选择 + 终端
│     └─ Providers.tsx
├─ docs/
│  └─ windows-plan.md         本文档
├─ package.json
├─ vite.config.ts
├─ tsconfig.json
└─ README.md
```

## 7. 仓库与协作

- **macOS 版与 Windows 版是两个独立 git 仓库**,Windows 版不依赖 macOS 版代码。
- **provider 预设**(base_url / 模型列表)两端**各存一份手动同步**(约 11 条,极少变动;
  用 submodule 属过度工程)。Windows 侧放在 `src-tauri/src/models.rs` 或单独的
  `providers.json`,需与 macOS 版 `Models.swift` 的预设保持一致。

## 7.5 Windows 兼容清单(本项目主要面向 Windows)

> 当前在 macOS 上开发,以下为已处理/待处理的 Windows 适配项。

已处理:
- **TLS**:reqwest 用 `rustls-tls`(非 OpenSSL/native-tls),Windows 零依赖。
- **config 路径**:`CODEX_HOME` → 否则 `USERPROFILE\.codex`(`config.rs` 已处理)。
- **路径取名**:前端用 `split(/[/\\]/)` 同时兼容 `/` 与 `\`。
- **中文字体**:CSS 含 Microsoft YaHei;等宽含 Consolas。
- **代理**:bind `127.0.0.1:0`,`tokio::spawn`,跨平台。

待处理(标注后续里程碑):
- **codex 调用**:npm 装的是 `codex.cmd`/`.ps1` 而非 `.exe`;**M2 改用自管的 `codex.exe` 全路径**调用(`appserver_spawn` 已支持传 `program`)。
- **窗口标题栏**:`titleBarStyle:Transparent` + `hiddenTitle` + 侧栏 22px 拖拽条均为 macOS 专属;Windows 需做平台适配(自定义 decorations 或保留原生标题栏 + 调整侧栏顶部留白)。
- **运行时验证**:代理/config/app-server 链路目前仅在 macOS 实测,需在真实 Windows 上回归。

## 8. 关键技术风险点(尽早验证)

1. **codex 在 ConPTY 原生跑通** —— portable-pty 走 ConPTY(Win10 1809+)。
   codex 已支持原生 PowerShell(非 WSL),理论 OK,但这是**头号 spike 验证项**。
2. **国内网络** —— codex 二进制下载 + Tauri updater 拉更新都需国内 CDN / 镜像。
3. **代码签名 / SmartScreen** —— 未签名会被 SmartScreen 拦,对小白是劝退点;
   需 Windows 代码签名证书(OV/EV)。
4. **翻译正确性** —— translator.rs 需对照 macOS 版做回归测试,SSE 流式分片最易错。

## 9. 分阶段里程碑

| 阶段 | 目标 | 验收 |
|------|------|------|
| M0 Spike | Tauri 起壳 + portable-pty 在内嵌 xterm 里跑通 `codex` | 终端里能交互一次 codex 会话 |
| M1 核心链路 | 移植 proxy + config 管理,DeepSeek 跑通 | codex 经 Beacon 代理对话 DeepSeek 成功 |
| M2 自动安装 | 检测 + 下载 codex 二进制(走国内 CDN) | 干净机器零依赖一键就绪 |
| M3 Onboarding | 引导式 UI:选 provider + 贴 key + 选文件夹 | 小白全程不敲命令完成首跑 |
| M4 打磨发布 | 还原设计、托盘、签名、updater | 签名安装包 + 自动更新可用 |

**建议先冲 M0** —— 它是整个方案唯一"没验证过会不会成"的点,其余皆为工程量。
