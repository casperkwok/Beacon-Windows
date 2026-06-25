import { useState } from "react";

// Renders a codex agent action (ThreadItem) in the spirit of Claude Code's
// cowork UI: a subtle, collapsed one-line summary by default ("运行了命令 ›"),
// expandable to a syntax-highlighted command block + output. The assistant's
// prose is the star; actions are quiet supporting detail.

type Props = { item: any };

// Inline lucide-style icons (zero-dep, 16px stroke).
const I = {
  terminal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  edit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  tool: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.1-.6-.6-2.1z" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  ),
};

function unwrapCommand(raw: string): string {
  const m = raw.match(/-l?c\s+(['"])([\s\S]*)\1\s*$/);
  return (m ? m[2] : raw).trim();
}

const SHELL_CMDS = new Set([
  "cd", "ls", "echo", "cat", "find", "grep", "mkdir", "rm", "mv", "cp", "touch",
  "git", "npm", "pnpm", "yarn", "node", "python", "python3", "pip", "curl", "wget",
  "sed", "awk", "head", "tail", "sort", "uniq", "wc", "chmod", "export", "set",
]);

// Best-effort shell highlighter → colored React spans.
function highlight(cmd: string) {
  const tokens = cmd.match(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|&&|\|\||[|;<>]|\s+|[^\s"';|&<>]+)/g) ?? [cmd];
  let expectCmd = true;
  return tokens.map((t, i) => {
    if (/^\s+$/.test(t)) return <span key={i}>{t}</span>;
    if (/^["']/.test(t)) {
      expectCmd = false;
      return <span key={i} className="t-str">{t}</span>;
    }
    if (t === "&&" || t === "||" || t === "|" || t === ";" || t === "<" || t === ">") {
      expectCmd = true;
      return <span key={i} className="t-op">{t}</span>;
    }
    let cls = "";
    if (expectCmd && SHELL_CMDS.has(t)) cls = "t-cmd";
    else if (/^-{1,2}\w/.test(t)) cls = "t-flag";
    else if (/^\d+$/.test(t)) cls = "t-num";
    expectCmd = false;
    return <span key={i} className={cls}>{t}</span>;
  });
}

function Lifecycle({ status }: { status?: string }) {
  if (status === "inProgress") return <span className="life run"><span className="spin" />运行中</span>;
  if (status === "failed" || status === "declined") return <span className="life fail">✗ 失败</span>;
  return <span className="life done">✓ 完成</span>;
}

export default function ActivityCard({ item }: Props) {
  const [open, setOpen] = useState(false);
  const running = (item.status === "inProgress") || (item.status?.type === "inProgress");

  // ---- icon + generic summary label (cowork never exposes the raw command here;
  //      details show only when expanded) ----
  let icon = I.tool;
  let label = "";
  if (item.type === "commandExecution") {
    icon = I.terminal;
    label = running ? "运行命令" : "运行了命令";
  } else if (item.type === "fileChange") {
    icon = I.edit;
    const n = (item.changes ?? []).length || 1;
    label = running ? "修改文件" : `修改了 ${n} 个文件`;
  } else if (item.type === "webSearch") {
    icon = I.search;
    label = "联网搜索";
  } else if (item.type === "mcpToolCall" || item.type === "dynamicToolCall") {
    label = running ? "调用工具" : "调用了工具";
  } else return null;

  return (
    <div className={`act ${open ? "open" : ""}`}>
      <div className="act-head" onClick={() => setOpen((o) => !o)}>
        <span className="act-icon">{running ? <span className="spin" /> : icon}</span>
        <span className="act-label">{label}</span>
        <span className="act-chev">{I.chevron}</span>
      </div>

      {open && (
        <div className="act-body">
          {item.type === "commandExecution" && (
            <>
              <div className="code-block">
                <span className="code-tag">bash</span>
                <pre className="code">{highlight(unwrapCommand(item.command ?? ""))}</pre>
              </div>
              {item.aggregatedOutput && (
                <pre className="act-output">{item.aggregatedOutput.slice(0, 4000)}</pre>
              )}
              <div className="act-foot">
                <Lifecycle status={item.status} />
                {typeof item.exitCode === "number" && <span className="muted">exit {item.exitCode}</span>}
              </div>
            </>
          )}

          {item.type === "fileChange" &&
            (item.changes ?? []).map((c: any, i: number) => (
              <div key={i} className="file-change">
                <div className="file-path">
                  <span className={`kind ${c.kind?.type}`}>{c.kind?.type ?? "edit"}</span>
                  {c.path}
                </div>
                {c.diff && (
                  <pre className="diff">
                    {c.diff.split("\n").slice(0, 200).map((line: string, j: number) => (
                      <span
                        key={j}
                        className={`dl ${line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : line.startsWith("@@") ? "hunk" : ""}`}
                      >
                        {line}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
