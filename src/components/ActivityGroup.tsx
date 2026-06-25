import { useState } from "react";
import ActivityCard from "./ActivityCard";

// Groups a run of consecutive agent actions into one collapsible summary, the
// way Claude Code's cowork does ("Ran 2 commands", "Edited 4 files, read 4
// files"). Expanding reveals each action. Prose messages break groups apart.

type Props = { items: any[] };

const s = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
const ICONS = {
  terminal: (
    <svg viewBox="0 0 24 24" {...s}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  tool: (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.1-.6-.6-2.1z" />
    </svg>
  ),
};
const ChevIcon = (
  <svg viewBox="0 0 24 24" {...s} strokeWidth="2.2">
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

function groupIcon(items: any[]) {
  const types = new Set(items.map((it) => it.type));
  if (types.size === 1) {
    const t = items[0].type;
    if (t === "commandExecution") return ICONS.terminal;
    if (t === "fileChange") return ICONS.edit;
    if (t === "webSearch") return ICONS.search;
  }
  return ICONS.tool;
}

function summarize(items: any[]): string {
  let cmd = 0, file = 0, search = 0, tool = 0;
  for (const it of items) {
    if (it.type === "commandExecution") cmd++;
    else if (it.type === "fileChange") file += it.changes?.length || 1;
    else if (it.type === "webSearch") search++;
    else tool++;
  }
  const parts: string[] = [];
  if (cmd) parts.push(`运行 ${cmd} 个命令`);
  if (file) parts.push(`编辑 ${file} 个文件`);
  if (search) parts.push(`搜索 ${search} 次`);
  if (tool) parts.push(`调用 ${tool} 个工具`);
  return parts.join("，");
}

export default function ActivityGroup({ items }: Props) {
  const [open, setOpen] = useState(false);
  const running = items.some(
    (it) => it.status === "inProgress" || it.status?.type === "inProgress",
  );

  return (
    <div className={`act group ${open ? "open" : ""}`}>
      <div className="act-head" onClick={() => setOpen((o) => !o)}>
        <span className="act-icon">{running ? <span className="spin" /> : groupIcon(items)}</span>
        <span className="act-label">{summarize(items)}</span>
        <span className="act-chev">{ChevIcon}</span>
      </div>
      {open && (
        <div className="grp-body">
          {items.map((it) => (
            <ActivityCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </div>
  );
}
