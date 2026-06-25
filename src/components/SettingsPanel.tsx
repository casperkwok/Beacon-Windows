import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Provider } from "../lib/providers";
import {
  type Settings,
  type Sandbox,
  type Approval,
  SANDBOX_LABELS,
  APPROVAL_LABELS,
} from "../lib/settings";
import ProviderManager from "./ProviderManager";
import BeaconLogo from "./BeaconLogo";

type Tab = "providers" | "engine" | "permissions" | "about";

type Props = {
  initialTab?: Tab;
  providers: Provider[];
  activeId: string | null;
  settings: Settings;
  onClose: () => void;
  onActivate: (p: Provider) => void;
  onSaveProviders: (list: Provider[]) => void;
  onSaveSettings: (s: Settings) => void;
};

const I = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: "providers",
    label: "模型供应商",
    icon: (
      <svg viewBox="0 0 24 24" {...I}>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      </svg>
    ),
  },
  {
    id: "engine",
    label: "Codex 引擎",
    icon: (
      <svg viewBox="0 0 24 24" {...I}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
      </svg>
    ),
  },
  {
    id: "permissions",
    label: "运行权限",
    icon: (
      <svg viewBox="0 0 24 24" {...I}>
        <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "关于",
    icon: (
      <svg viewBox="0 0 24 24" {...I}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </svg>
    ),
  },
];

export default function SettingsPanel({
  initialTab = "providers",
  providers,
  activeId,
  settings,
  onClose,
  onActivate,
  onSaveProviders,
  onSaveSettings,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          <div className="settings-nav-title">设置</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              <span className="settings-tab-ico">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-content">
          <button className="icon-btn settings-close" onClick={onClose}>
            ✕
          </button>
          {tab === "providers" && (
            <ProviderManager
              embedded
              providers={providers}
              activeId={activeId}
              onActivate={onActivate}
              onSave={onSaveProviders}
            />
          )}
          {tab === "engine" && <EngineTab />}
          {tab === "permissions" && <PermissionsTab settings={settings} onSave={onSaveSettings} />}
          {tab === "about" && <AboutTab />}
        </div>
      </div>
    </div>
  );
}

function EngineTab() {
  const [status, setStatus] = useState<{ found: boolean; version: string; path: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");

  async function refresh() {
    setStatus(await invoke("codex_detect"));
  }
  useEffect(() => {
    refresh();
  }, []);

  async function reinstall() {
    setBusy(true);
    setErr("");
    const un = await listen<{ downloaded: number; total: number }>("codex://install-progress", (e) => {
      const p = e.payload;
      setPct(p.total ? Math.round((p.downloaded / p.total) * 100) : 0);
    });
    try {
      await invoke("codex_install");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      un();
    }
  }

  const found = status?.found;
  return (
    <div className="settings-section">
      <h3 className="set-h">Codex 引擎</h3>
      <p className="set-desc">Beacon 通过本地 Codex 引擎驱动模型。它由 Beacon 自动管理，无需你手动安装。</p>

      <div className="engine-card">
        <div className={`engine-status ${found ? "ok" : "missing"}`}>
          <span className="engine-dot" />
          {found ? "运行正常" : "未安装"}
        </div>
        <div className="engine-meta">
          <div>
            <span className="em-k">版本</span>
            <span className="em-v">{status?.version || "—"}</span>
          </div>
          <div>
            <span className="em-k">来源</span>
            <span className="em-v">
              {status?.source === "managed" ? "Beacon 自管" : status?.source === "path" ? "系统 PATH" : "—"}
            </span>
          </div>
          {status?.path && (
            <div className="em-path">
              <span className="em-k">路径</span>
              <span className="em-v mono">{status.path}</span>
            </div>
          )}
        </div>
      </div>

      {busy ? (
        <div className="setup-progress">
          <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
          <div className="setup-hint">下载中 {pct}%</div>
        </div>
      ) : (
        <button className="btn ghost" onClick={reinstall} style={{ marginTop: 14 }}>
          {found ? "检查更新 / 重新下载" : "立即安装"}
        </button>
      )}
      {err && <div className="setup-err">{err}</div>}
    </div>
  );
}

function PermissionsTab({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => void }) {
  return (
    <div className="settings-section">
      <h3 className="set-h">运行权限</h3>
      <p className="set-desc">控制 Codex 能在你电脑上做多少事，以及何时征求同意。改动对新对话生效。</p>

      <div className="set-group-label">访问范围</div>
      {(Object.keys(SANDBOX_LABELS) as Sandbox[]).map((k) => (
        <label key={k} className={`opt ${settings.sandbox === k ? "on" : ""}`}>
          <input type="radio" checked={settings.sandbox === k} onChange={() => onSave({ ...settings, sandbox: k })} />
          <span>
            <span className="opt-name">{SANDBOX_LABELS[k].name}</span>
            <span className="opt-desc">{SANDBOX_LABELS[k].desc}</span>
          </span>
        </label>
      ))}

      <div className="set-group-label" style={{ marginTop: 18 }}>审批方式</div>
      {(Object.keys(APPROVAL_LABELS) as Approval[]).map((k) => (
        <label key={k} className={`opt ${settings.approval === k ? "on" : ""}`}>
          <input type="radio" checked={settings.approval === k} onChange={() => onSave({ ...settings, approval: k })} />
          <span>
            <span className="opt-name">{APPROVAL_LABELS[k].name}</span>
            <span className="opt-desc">{APPROVAL_LABELS[k].desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function AboutTab() {
  const providers = ["DeepSeek", "智谱 GLM", "Kimi", "通义千问", "MiniMax"];
  return (
    <div className="about">
      <span className="about-logo">
        <BeaconLogo size={76} />
      </span>
      <div className="about-name">Beacon</div>
      <div className="about-tag">让 Codex 用上国产大模型</div>
      <div className="about-ver">版本 0.1.0</div>

      <p className="about-desc">
        零门槛在桌面用国产大模型对话、读写文件、自动跑命令 —— 全程不碰命令行。
        Beacon 在本地把 Codex 的接口翻译成各家模型可用的格式，你的 API Key 只留在本机。
      </p>

      <div className="about-chips">
        {providers.map((p) => (
          <span key={p} className="about-chip">{p}</span>
        ))}
      </div>

      <div className="about-links">
        <button className="about-link" onClick={() => openUrl("https://github.com/openai/codex")}>
          Codex 项目 ↗
        </button>
        <button className="about-link" onClick={() => openUrl("https://github.com/casperkwok/Beacon")}>
          Beacon 仓库 ↗
        </button>
      </div>

      <div className="about-foot">Powered by OpenAI Codex · 由 Beacon 桥接国产模型</div>
    </div>
  );
}
