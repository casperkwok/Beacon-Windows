# Beacon for Windows

面向国内非技术用户的桌面应用 —— 让小白零门槛地用 OpenAI Codex 接入国产模型
(DeepSeek / GLM / Kimi / Qwen / MiniMax …),全程不碰命令行。

> macOS 版见独立仓库 [`casperkwok/Beacon`](https://github.com/casperkwok/Beacon)。

## 技术栈

- **Tauri 2** + Rust(后端 / 翻译代理 / 终端 / codex 管理)
- **React 19 + Vite 8 + Tailwind v4 + TypeScript 6**(前端)
- **@xterm/xterm 6**(内嵌终端)

详细规划见 [`docs/windows-plan.md`](docs/windows-plan.md)。

## 状态

🚧 规划定稿,待开工(M0: Tauri + 内嵌终端跑通 codex)。
