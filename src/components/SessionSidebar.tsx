import BeaconLogo from "./BeaconLogo";

// Left sidebar: the Beacon brand lockup, new chat, real history (thread/list),
// and the active provider + workspace folder at the bottom.

type Props = {
  threads: any[];
  activeId: string | null;
  status: string;
  providerName: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onToggle: () => void;
};

export const PanelIcon = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2.5" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Icon = {
  plus: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  gear: (
    <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

function relTime(sec: number): string {
  if (!sec) return "";
  const diff = Date.now() / 1000 - sec;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export default function SessionSidebar({
  threads,
  activeId,
  status,
  providerName,
  onNew,
  onSelect,
  onOpenSettings,
  onToggle,
}: Props) {
  return (
    <div className="sidebar">
      <div className="side-head">
        <div className="brand-lockup" data-tauri-drag-region>
          <BeaconLogo size={26} />
          <span className="brand">Beacon</span>
          {status !== "ready" && <span className={`dot ${status}`} title={status} />}
        </div>
        <button className="sb-toggle" onClick={onToggle} title="收起侧边栏">
          {PanelIcon}
        </button>
      </div>

      <button className="new-chat" onClick={onNew}>
        {Icon.plus}
        新对话
      </button>

      <div className="thread-list">
        {threads.length === 0 && <div className="empty-list">还没有对话</div>}
        {threads.map((t) => (
          <div
            key={t.id}
            className={`thread-item ${t.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(t.id)}
            title={t.preview || t.id}
          >
            <div className="thread-preview">{t.preview?.trim() || "新对话"}</div>
            <div className="thread-meta">{relTime(t.updatedAt ?? t.createdAt)}</div>
          </div>
        ))}
      </div>

      <div className="side-foot">
        <button className="foot-row" onClick={onOpenSettings} title="设置">
          <span className="foot-ico">{Icon.gear}</span>
          <span className="foot-text">设置</span>
          {providerName && <span className="foot-model">{providerName}</span>}
        </button>
      </div>
    </div>
  );
}
