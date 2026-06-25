import { useState } from "react";

// Right panel in the spirit of Claude Code's cowork: three collapsible cards —
// Progress (the agent's plan/todo), Workspace (files in the working dir), and
// Context (this session's uploads).

type Props = {
  plan: { step: string; status: string }[];
  workspaceName: string;
  files: { fileName: string; isDirectory: boolean }[];
  uploads: string[]; // image data URLs attached this session
};

function Section({
  title,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rp-card">
      <div className="rp-head" onClick={() => setOpen((o) => !o)}>
        <span className="rp-title">{title}</span>
        {right}
        <span className={`rp-chev ${open ? "open" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 6 15 12 9 18" />
          </svg>
        </span>
      </div>
      {open && <div className="rp-body">{children}</div>}
    </div>
  );
}

function PlanIcon({ status, index }: { status: string; index: number }) {
  if (status === "completed")
    return (
      <span className="plan-ic done">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  if (status === "inProgress") return <span className="plan-ic active">{index + 1}</span>;
  return <span className="plan-ic pending">{index + 1}</span>;
}

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const FolderIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" {...s}>
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
const DocIcon = (
  <svg width="15" height="15" viewBox="0 0 24 24" {...s}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
function fileIcon(_name: string, isDir: boolean) {
  return isDir ? FolderIcon : DocIcon;
}

export default function RightPanel({ plan, workspaceName, files, uploads }: Props) {
  const dirs = files.filter((f) => f.isDirectory).sort((a, b) => a.fileName.localeCompare(b.fileName));
  const regular = files.filter((f) => !f.isDirectory).sort((a, b) => a.fileName.localeCompare(b.fileName));
  const sorted = [...dirs, ...regular].filter((f) => !f.fileName.startsWith("."));

  return (
    <div className="right-panel">
      {plan.length > 0 && (
        <Section title="进度">
          <div className="plan-list">
            {plan.map((s, i) => (
              <div key={i} className={`plan-row ${s.status}`}>
                <PlanIcon status={s.status} index={i} />
                <span className="plan-text">{s.step}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={workspaceName || "工作区"} right={<span className="rp-folder">{FolderIcon}</span>}>
        {sorted.length === 0 ? (
          <div className="rp-empty">未选择项目文件夹</div>
        ) : (
          <div className="file-list">
            {sorted.map((f) => (
              <div key={f.fileName} className="file-row" title={f.fileName}>
                <span className="file-ic">{fileIcon(f.fileName, f.isDirectory)}</span>
                <span className="file-name">{f.fileName}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="上下文" defaultOpen={false}>
        <div className="ctx-label">本次上传</div>
        {uploads.length === 0 ? (
          <div className="rp-empty">暂无上传</div>
        ) : (
          <div className="upload-grid">
            {uploads.map((src, i) => (
              <img key={i} src={src} className="upload-thumb" />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
