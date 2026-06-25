// Friendly approval prompt. codex asks before running a command or writing
// files (approvalPolicy: on-request). For file changes the diff lives in the
// already-rendered fileChange item, looked up by itemId.

type Decision = "approved" | "denied" | "approved_for_session";

type Props = {
  method: string;
  params: any;
  items: any[];
  onDecide: (d: Decision) => void;
};

function unwrapCommand(raw: string): string {
  const m = raw.match(/-l?c\s+(['"])([\s\S]*)\1\s*$/);
  return (m ? m[2] : raw).trim();
}

export default function ApprovalDialog({ method, params, items, onDecide }: Props) {
  const isCommand = method.includes("commandExecution");
  const isFile = method.includes("fileChange");

  const title = isCommand ? "运行命令" : isFile ? "修改文件" : "授予权限";

  let body = null;
  if (isCommand) {
    body = <pre className="approval-cmd">{unwrapCommand(params?.command ?? "")}</pre>;
  } else if (isFile) {
    const item = items.find((x) => x.id === params?.itemId);
    const changes: any[] = item?.changes ?? [];
    body = changes.length ? (
      <div className="approval-files">
        {changes.map((c, i) => (
          <div key={i} className="file-change">
            <div className="file-path">
              <span className={`kind ${c.kind?.type}`}>{c.kind?.type ?? "edit"}</span>
              {c.path}
            </div>
            {c.diff && (
              <pre className="diff">
                {c.diff.split("\n").slice(0, 120).map((line: string, j: number) => (
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
    ) : (
      <div className="approval-reason">即将修改文件</div>
    );
  } else {
    body = <pre className="approval-cmd">{JSON.stringify(params, null, 2).slice(0, 400)}</pre>;
  }

  return (
    <div className="approval">
      <div className="approval-title">
        Codex 想要「{title}」
        {params?.cwd && <span className="approval-cwd">{params.cwd}</span>}
      </div>
      {params?.reason && <div className="approval-reason">{params.reason}</div>}
      {body}
      <div className="approval-actions">
        <button className="btn" onClick={() => onDecide("approved")}>
          允许
        </button>
        <button className="btn ghost" onClick={() => onDecide("approved_for_session")}>
          本次会话都允许
        </button>
        <button className="btn ghost danger" onClick={() => onDecide("denied")}>
          拒绝
        </button>
      </div>
    </div>
  );
}
