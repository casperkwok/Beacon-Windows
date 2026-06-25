# Beacon for Windows

让小白零门槛地用 OpenAI Codex 接入**国产大模型**(DeepSeek / 智谱 GLM / Kimi / 通义千问 / MiniMax …)——
在桌面对话、读写文件、自动跑命令,全程不碰命令行。

> macOS 版见独立仓库 [`casperkwok/Beacon`](https://github.com/casperkwok/Beacon)。

## 下载安装

1. 到 [**Releases**](https://github.com/casperkwok/Beacon-Windows/releases/latest) 下载 `Beacon_*_x64-setup.exe`,双击安装。
2. 若弹出蓝色 **SmartScreen** 警告(因为安装包暂未做代码签名,属正常):
   点 **「更多信息」→「仍要运行」** 即可。
3. 首次启动会**自动下载 Codex 引擎**(约 90MB,只需一次)。
4. 在「设置 → 模型供应商」里选一个(如 DeepSeek),**贴入你的 API Key**,即可开始对话。

> 安装包仅 ~3MB(Tauri,远小于 Electron 应用),Codex 引擎按需下载。

## 它做什么

OpenAI 官方的 Codex 桌面端只支持 OpenAI 登录,不能接国产模型。Beacon 在你本机起一个翻译代理,
把 Codex 的 Responses API 实时转换成各家国产模型可用的 Chat Completions 格式 ——
**你的 API Key 只留在本机,不经任何第三方**。

- 对话式使用,支持图片、文件(Excel/PDF 等)上传交给模型处理
- 会话历史 + 自动标题;运行命令/改文件前可审批
- 可配置运行权限(完全访问 / 仅项目目录 / 只读)

## 技术栈

- **Tauri 2 + Rust** —— 翻译代理(axum)、config 管理(toml_edit)、codex 引擎检测与自动安装
- **React 19 + Vite + TypeScript** —— 通过 codex `app-server` 协议驱动真实 Codex

## 开发

```bash
pnpm install
pnpm tauri dev
```

每次 push 到 `main`,GitHub Actions 自动在 Windows 上编译、打包并发布到 `latest` Release。
