import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AppServerClient } from "./lib/appserver";
import ActivityCard from "./components/ActivityCard";
import ActivityGroup from "./components/ActivityGroup";
import ApprovalDialog from "./components/ApprovalDialog";
import SessionSidebar, { PanelIcon } from "./components/SessionSidebar";
import SettingsPanel from "./components/SettingsPanel";
import BeaconLogo from "./components/BeaconLogo";
import { type Settings, loadSettings, saveSettings } from "./lib/settings";
import {
  type Provider,
  loadProviders,
  saveProviders,
  loadActiveId,
  saveActiveId,
  activateProvider,
  loadTitle,
  saveTitle,
  generateTitle,
} from "./lib/providers";
import "./App.css";

type Item = any & { id: string; type: string };
type Approval = { id: number; method: string; params: any };

// userMessage items come in two shapes: locally-added {text, images} and
// history {content: UserInput[]}. Normalize for rendering.
const userText = (it: any): string =>
  it.text !== undefined
    ? it.text
    : (it.content ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n");
const userImages = (it: any): string[] =>
  it.images ?? (it.content ?? []).filter((x: any) => x.type === "image").map((x: any) => x.url);

const ACTION_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "webSearch",
  "mcpToolCall",
  "dynamicToolCall",
]);

type Block = { kind: "group"; id: string; items: Item[] } | { kind: "item"; id: string; item: Item };

// Per-thread timeline cache. codex's thread/read returns only messages (not the
// tool/command executions, though they exist on disk), so we persist the full
// live timeline ourselves and prefer it when reopening a session.
const tlKey = (id: string) => `beacon.tl.${id}`;
function saveTimeline(id: string | null, items: Item[]) {
  if (!id || items.length === 0) return;
  try {
    localStorage.setItem(tlKey(id), JSON.stringify(items));
  } catch {
    /* quota — fall back to thread/read on resume */
  }
}
function loadTimeline(id: string): Item[] | null {
  try {
    return JSON.parse(localStorage.getItem(tlKey(id)) || "null");
  } catch {
    return null;
  }
}

// Group consecutive agent actions; prose/system/user messages break a group.
function buildBlocks(items: Item[]): Block[] {
  const blocks: Block[] = [];
  for (const it of items) {
    if (it.type === "reasoning") continue;
    if (ACTION_TYPES.has(it.type)) {
      const last = blocks[blocks.length - 1];
      if (last && last.kind === "group") last.items.push(it);
      else blocks.push({ kind: "group", id: it.id, items: [it] });
    } else {
      blocks.push({ kind: "item", id: it.id, item: it });
    }
  }
  return blocks;
}

export default function App() {
  const client = useRef<AppServerClient | null>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "thinking" | "error">("connecting");
  const [items, setItems] = useState<Item[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string[]>([]); // pasted/dropped images (data URLs)
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]); // picked files (paths)
  const [approval, setApproval] = useState<Approval | null>(null);
  const [cwd, setCwd] = useState("");
  const [providers, setProviders] = useState<Provider[]>(loadProviders());
  const [activeProviderId, setActiveProviderId] = useState<string | null>(loadActiveId());
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"providers" | "engine" | "permissions" | "about">("providers");
  const [settings, setSettings] = useState<Settings>(loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  function openSettings(tab: "providers" | "engine" | "permissions" | "about" = "providers") {
    setSettingsTab(tab);
    setShowSettings(true);
  }
  const [sidebarOpen, setSidebarOpen] = useState(localStorage.getItem("beacon.sidebar") !== "0");
  const [codexReady, setCodexReady] = useState<boolean | null>(null); // null = checking
  const [installing, setInstalling] = useState(false);
  const [installPct, setInstallPct] = useState(0);
  const [installPhase, setInstallPhase] = useState("");
  const [codexErr, setCodexErr] = useState("");
  function toggleSidebar(open: boolean) {
    setSidebarOpen(open);
    localStorage.setItem("beacon.sidebar", open ? "1" : "0");
  }
  const scroller = useRef<HTMLDivElement>(null);
  const cwdRef = useRef("");
  cwdRef.current = cwd;

  const activeProvider = providers.find((p) => p.id === activeProviderId) || null;
  const provRef = useRef<Provider | null>(activeProvider);
  provRef.current = activeProvider;

  // Refs so the long-lived client handlers see current values.
  const itemsRef = useRef<Item[]>(items);
  itemsRef.current = items;
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [items, approval]);

  // Open any link in the system browser — never let the webview navigate away.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.("a") as HTMLAnchorElement | null;
      if (a && a.href && /^https?:/i.test(a.href)) {
        e.preventDefault();
        openUrl(a.href).catch(() => {});
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // ---- timeline mutation helpers ----
  const pushItem = (it: Item) => setItems((xs) => [...xs, it]);
  function upsertItem(it: Item) {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === it.id);
      if (i < 0) return [...xs, it];
      const c = [...xs];
      c[i] = { ...c[i], ...it };
      return c;
    });
  }
  function patchItem(id: string, fn: (it: Item) => Item) {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === id);
      if (i < 0) return xs;
      const c = [...xs];
      c[i] = fn(c[i]);
      return c;
    });
  }
  function appendText(id: string, delta: string) {
    setItems((xs) => {
      const i = xs.findIndex((x) => x.id === id);
      if (i >= 0) {
        const c = [...xs];
        c[i] = { ...c[i], text: (c[i].text ?? "") + delta };
        return c;
      }
      return [...xs, { id, type: "agentMessage", text: delta }];
    });
  }
  const note = (text: string) => pushItem({ id: `sys-${performance.now()}`, type: "system", text });

  async function refreshThreads() {
    try {
      setThreads(await client.current!.listThreads());
    } catch {
      /* ignore */
    }
  }

  // After the first exchange, auto-generate a short conversation title.
  async function maybeTitle() {
    const id = activeIdRef.current;
    const p = provRef.current;
    if (!id || !p || loadTitle(id)) return;
    const its = itemsRef.current;
    const firstUser = its.find((x) => x.type === "userMessage");
    const firstAgent = its.find((x) => x.type === "agentMessage" && x.text);
    if (!firstUser) return;
    const uText = userText(firstUser);
    const aText = firstAgent?.text ?? "";
    const content = `用户：${uText}\n助手：${aText}`;
    try {
      const title = await generateTitle(p, content);
      if (title) {
        saveTitle(id, title);
        refreshThreads();
      }
    } catch {
      /* keep first-message preview as fallback */
    }
  }

  // Spawn app-server with the resolved codex path, then connect.
  async function connectWith(program: string) {
    const c = new AppServerClient({
      onTurnStarted: () => setStatus("thinking"),
      onTurnCompleted: () => {
        setStatus("ready");
        saveTimeline(activeIdRef.current, itemsRef.current);
        maybeTitle();
        refreshThreads();
      },
      onItemStarted: (item) => {
        if (!item || item.type === "userMessage") return;
        upsertItem(item);
      },
      onItemUpdated: (item) => {
        if (!item || item.type === "userMessage") return;
        upsertItem(item);
      },
      onAgentDelta: (itemId, delta) => appendText(itemId, delta),
      onCommandOutputDelta: (itemId, delta) =>
        patchItem(itemId, (it) => ({ ...it, aggregatedOutput: (it.aggregatedOutput ?? "") + delta })),
      onApprovalRequest: (method, id, params) => setApproval({ method, id, params }),
      onError: (msg, willRetry) => {
        if (!willRetry) {
          note(msg);
          setStatus("ready");
        }
      },
      onStderr: (line) => console.debug("[codex]", line),
      onClosed: () => setStatus("error"),
    });
    try {
      await c.start(program, "");
      await c.initialize();
      client.current = c;
      await refreshThreads();
      if (provRef.current) {
        await activateProvider(provRef.current);
        await newChat();
      } else {
        setStatus("ready");
        openSettings("providers");
        note("先添加一个模型供应商（如 DeepSeek）并贴入 API Key，即可开始。");
      }
    } catch (e) {
      setStatus("error");
      note(`连接失败：${e}`);
    }
  }

  // ---- bootstrap: ensure codex exists, then connect ----
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const st = await invoke<{ found: boolean; path: string }>("codex_detect");
        if (disposed) return;
        if (st.found) {
          setCodexReady(true);
          connectWith(st.path);
        } else {
          setCodexReady(false); // show install screen
        }
      } catch {
        if (!disposed) setCodexReady(false);
      }
    })();
    return () => {
      disposed = true;
      client.current?.dispose();
    };
  }, []);

  async function installCodex() {
    setInstalling(true);
    setCodexErr("");
    const un = await listen<{ phase: string; downloaded: number; total: number }>(
      "codex://install-progress",
      (e) => {
        const p = e.payload;
        setInstallPhase(p.phase);
        setInstallPct(p.total ? Math.round((p.downloaded / p.total) * 100) : 0);
      },
    );
    try {
      const path = await invoke<string>("codex_install");
      setCodexReady(true);
      await connectWith(path);
    } catch (e) {
      setCodexErr(String(e));
    } finally {
      setInstalling(false);
      un();
    }
  }

  async function newChat() {
    if (!client.current) return;
    saveTimeline(activeIdRef.current, itemsRef.current);
    setItems([]);
    setApproval(null);
    const id = await client.current.startThread({
      cwd: cwdRef.current,
      sandbox: settingsRef.current.sandbox,
      approvalPolicy: settingsRef.current.approval,
    });
    setActiveId(id);
    setStatus("ready");
  }

  async function selectThread(id: string) {
    if (!client.current || id === activeId) return;
    // Persist the timeline we're leaving (so its tool calls survive).
    saveTimeline(activeIdRef.current, itemsRef.current);
    setStatus("connecting");
    setApproval(null);
    try {
      await client.current.resumeThread(id, cwdRef.current, {
        sandbox: settingsRef.current.sandbox,
        approvalPolicy: settingsRef.current.approval,
      });
      // Prefer our cached full timeline (incl. tool calls); else fall back to
      // thread/read, which returns conversation messages only.
      const cached = loadTimeline(id);
      if (cached && cached.length) {
        setItems(cached);
      } else {
        const history = await client.current.readThreadItems(id);
        setItems(history.filter((it) => it.type !== "reasoning"));
      }
      setActiveId(id);
    } catch (e) {
      note(`打开会话失败：${e}`);
    } finally {
      setStatus("ready");
    }
  }

  function handleSaveProviders(list: Provider[]) {
    setProviders(list);
    saveProviders(list);
  }

  async function handleActivateProvider(p: Provider) {
    setActiveProviderId(p.id);
    saveActiveId(p.id);
    setShowSettings(false);
    if (!client.current) return;
    setStatus("connecting");
    try {
      await activateProvider(p);
      await newChat();
      note(`已切换到 ${p.name}`);
    } catch (e) {
      note(`激活失败：${e}`);
      setStatus("ready");
    }
  }

  // basename across both POSIX "/" and Windows "\" separators
  const baseName = (p: string) => p.split(/[/\\]/).filter(Boolean).pop() ?? "";

  async function pickFolder() {
    const dir = await open({ directory: true, title: "选择项目文件夹" });
    if (typeof dir !== "string") return;
    setCwd(dir);
    cwdRef.current = dir;
    note(`已切换工作目录：${baseName(dir)}（对后续对话生效）`);
  }
  const folderName = cwd ? baseName(cwd) : "";

  const isImageName = (n: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n);

  async function pickFile() {
    const sel = await open({ multiple: true, title: "选择文件" });
    if (!sel) return;
    const paths = Array.isArray(sel) ? sel : [sel];
    setFiles((f) => [...f, ...paths.map((p) => ({ path: p, name: baseName(p) }))]);
  }

  async function send() {
    const text = input.trim();
    if ((!text && pending.length === 0 && files.length === 0) || !client.current || status !== "ready")
      return;
    const images = pending;
    const atts = files;
    pushItem({
      id: `user-${performance.now()}`,
      type: "userMessage",
      text,
      images,
      files: atts.map((f) => f.name),
    });
    setInput("");
    setPending([]);
    setFiles([]);

    // Non-image files: embed the absolute path in the text so codex reads them
    // with its file tools (most reliable across models). Images go as image input.
    const docFiles = atts.filter((f) => !isImageName(f.name));
    const imgFiles = atts.filter((f) => isImageName(f.name));
    let finalText = text;
    if (docFiles.length) {
      finalText +=
        (finalText ? "\n\n" : "") +
        "我上传了以下文件，请先读取其内容再回答（用合适的工具解析，如 xlsx/csv 用 python）：\n" +
        docFiles.map((f) => f.path).join("\n");
    }

    const inputArr: any[] = [];
    if (finalText) inputArr.push({ type: "text", text: finalText, text_elements: [] });
    for (const url of images) inputArr.push({ type: "image", url });
    for (const f of imgFiles) inputArr.push({ type: "localImage", path: f.path });
    try {
      await client.current.sendTurn(inputArr, cwdRef.current);
    } catch (e) {
      note(`发送失败：${e}`);
    }
  }

  async function stop() {
    await client.current?.interrupt().catch(() => {});
    setStatus("ready");
  }

  function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }
  async function onPaste(e: React.ClipboardEvent) {
    const imgs = Array.from(e.clipboardData.items).filter((i) => i.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    for (const it of imgs) {
      const f = it.getAsFile();
      if (f) {
        const url = await fileToDataUrl(f);
        setPending((p) => [...p, url]);
      }
    }
  }
  async function onDrop(e: React.DragEvent) {
    const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    e.preventDefault();
    for (const f of imgs) {
      const url = await fileToDataUrl(f);
      setPending((p) => [...p, url]);
    }
  }

  function decide(decision: "approved" | "denied" | "approved_for_session") {
    if (!approval || !client.current) return;
    client.current.approve(approval.id, decision);
    // No system note — the dialog dismissing + the action running is the feedback.
    setApproval(null);
  }

  // First-run: codex engine missing → install screen.
  if (codexReady === false) {
    return (
      <div className="app setup">
        <div className="titlebar-drag" data-tauri-drag-region />
        <div className="setup-card">
          <span className="beacon-glow">
            <BeaconLogo size={64} />
          </span>
          <div className="setup-title">欢迎使用 Beacon</div>
          <div className="setup-sub">
            首次使用需要下载 Codex 引擎（约 30MB），之后即可用国产模型开始对话。
          </div>
          {installing ? (
            <div className="setup-progress">
              <div className="bar">
                <div className="bar-fill" style={{ width: `${installPct}%` }} />
              </div>
              <div className="setup-hint">
                {installPhase === "extract" ? "正在解压…" : installPhase === "done" ? "完成" : `下载中 ${installPct}%`}
              </div>
            </div>
          ) : (
            <button className="setup-btn" onClick={installCodex}>
              一键安装 Codex
            </button>
          )}
          {codexErr && <div className="setup-err">安装失败：{codexErr}</div>}
        </div>
      </div>
    );
  }

  if (codexReady === null) {
    return (
      <div className="app setup">
        <div className="titlebar-drag" data-tauri-drag-region />
        <div className="setup-card">
          <span className="beacon-glow">
            <BeaconLogo size={64} />
          </span>
          <div className="setup-hint">正在检查环境…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="body">
        {sidebarOpen && (
          <SessionSidebar
            threads={threads.map((t) => ({ ...t, preview: loadTitle(t.id) || t.preview }))}
            activeId={activeId}
            status={status}
            providerName={activeProvider?.name || ""}
            onNew={newChat}
            onSelect={selectThread}
            onOpenSettings={() => openSettings()}
            onToggle={() => toggleSidebar(false)}
          />
        )}
        {!sidebarOpen && (
          <button className="float-toggle" onClick={() => toggleSidebar(true)} title="展开侧边栏">
            {PanelIcon}
          </button>
        )}

        <div className="center">
          <div className="titlebar-drag" data-tauri-drag-region />
          <div className="chat" ref={scroller} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
            {items.length === 0 && status === "ready" && (
              <div className="hint">
                <span className="beacon-glow">
                  <BeaconLogo size={56} />
                </span>
                <span className="hint-title">开始和 Codex 对话</span>
                <span>选好模型供应商和项目文件夹，让它读代码、跑命令、改文件 —— 全程不用敲命令。</span>
              </div>
            )}

            {buildBlocks(items).map((b) => {
              if (b.kind === "group") {
                return (
                  <div key={b.id} className="row assistant">
                    {b.items.length === 1 ? (
                      <ActivityCard item={b.items[0]} />
                    ) : (
                      <ActivityGroup items={b.items} />
                    )}
                  </div>
                );
              }
              const it = b.item;
              if (it.type === "system")
                return (
                  <div key={it.id} className="row system">
                    <div className="bubble system">{it.text}</div>
                  </div>
                );
              if (it.type === "userMessage") {
                const imgs = userImages(it);
                return (
                  <div key={it.id} className="row user">
                    <div className="bubble user">
                      {imgs.length > 0 && (
                        <div className="imgs">
                          {imgs.map((src: string, i: number) => (
                            <img key={i} src={src} className="thumb" />
                          ))}
                        </div>
                      )}
                      {it.files?.length > 0 && (
                        <div className="file-chips">
                          {it.files.map((n: string, i: number) => (
                            <span key={i} className="file-chip">📄 {n}</span>
                          ))}
                        </div>
                      )}
                      {userText(it)}
                    </div>
                  </div>
                );
              }
              if (it.type === "agentMessage")
                return (
                  <div key={it.id} className="row assistant">
                    <div className="bubble assistant">
                      {it.text ? (
                        <div className="md">
                          <Markdown remarkPlugins={[remarkGfm]}>{it.text}</Markdown>
                        </div>
                      ) : (
                        <span className="typing">…</span>
                      )}
                    </div>
                  </div>
                );
              return null; // reasoning, etc.
            })}
          </div>

          {approval && (
            <div className="approval-dock">
              <ApprovalDialog method={approval.method} params={approval.params} items={items} onDecide={decide} />
            </div>
          )}

          <div className="composer">
            <div className="composer-box">
              {(pending.length > 0 || files.length > 0) && (
                <div className="pending">
                  {pending.map((src, i) => (
                    <div key={`img${i}`} className="pending-item">
                      <img src={src} className="thumb" />
                      <button className="x" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </div>
                  ))}
                  {files.map((f, i) => (
                    <div key={`file${i}`} className="pending-file">
                      <span className="pf-name">📄 {f.name}</span>
                      <button className="x" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={input}
                placeholder={status === "ready" ? "给 Codex 发消息，可粘贴或拖入图片…" : "连接中…"}
                disabled={status === "connecting" || status === "error"}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <div className="composer-tools">
                <button className="ws-chip" title="上传文件" onClick={pickFile}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.4 11.05 12.5 19.95a5 5 0 0 1-7.07-7.07l8.49-8.49a3 3 0 0 1 4.24 4.24l-8.49 8.49a1 1 0 0 1-1.41-1.41l7.78-7.78" />
                  </svg>
                  <span className="ws-name">文件</span>
                </button>
                <button className="ws-chip" title={cwd || "选择项目文件夹（对后续对话生效）"} onClick={pickFolder}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  <span className="ws-name">{folderName || "项目文件夹"}</span>
                </button>
                <span className="composer-spacer" />
                {status === "thinking" ? (
                  <button className="send-btn stop" onClick={stop} title="停止生成">
                    <span className="stop-glyph" />
                  </button>
                ) : (
                  <button
                    className="send-btn"
                    onClick={send}
                    title="发送"
                    disabled={status !== "ready" || (!input.trim() && pending.length === 0 && files.length === 0)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="6 11 12 5 18 11" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {showSettings && (
        <SettingsPanel
          initialTab={settingsTab}
          providers={providers}
          activeId={activeProviderId}
          settings={settings}
          onClose={() => setShowSettings(false)}
          onActivate={handleActivateProvider}
          onSaveProviders={handleSaveProviders}
          onSaveSettings={(s) => {
            setSettings(s);
            saveSettings(s);
          }}
        />
      )}
    </div>
  );
}
