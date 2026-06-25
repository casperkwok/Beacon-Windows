// Minimal client for the codex `app-server` JSON-RPC protocol (stdio).
// Rust side is a dumb newline-framed pipe; all orchestration lives here.
//
// Verified wire facts (codex 0.140.0):
//   - newline-delimited JSON; `jsonrpc` field optional
//   - initialize -> initialized(notif) -> thread/start -> turn/start
//   - streaming assistant text: notification "item/agentMessage/delta"
//       params: { threadId, turnId, itemId, delta }
//   - turn lifecycle: "turn/started" / "turn/completed"
//   - approval requests (server->client): "item/commandExecution/requestApproval",
//       "item/fileChange/requestApproval", "item/permissions/requestApproval"
//       respond with result { decision: "approved" | "denied" | "approved_for_session" | "abort" }
//   - user input items: {type:"text",text,text_elements:[]} | {type:"image",url} |
//       {type:"localImage",path} | {type:"mention",name,path}

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type UserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "mention"; name: string; path: string };

type RpcResponse = { id: number; result?: any; error?: { code: number; message: string } };
type RpcMessage = RpcResponse & { method?: string; params?: any };

export type AppServerHandlers = {
  /** A new timeline item appeared (command / file change / agent message / …). */
  onItemStarted?: (item: any, turnId: string) => void;
  /** An item reached its final state (status, output, exit code, final text). */
  onItemUpdated?: (item: any) => void;
  /** Streaming assistant text for an agentMessage item. */
  onAgentDelta?: (itemId: string, delta: string) => void;
  /** Streaming stdout/stderr for a commandExecution item. */
  onCommandOutputDelta?: (itemId: string, delta: string) => void;
  onTurnStarted?: (turnId: string) => void;
  onTurnCompleted?: (turnId: string) => void;
  /** Plan/todo progress for the current turn (turn/plan/updated). */
  onPlanUpdated?: (plan: any[], explanation: string | null) => void;
  onApprovalRequest?: (method: string, id: number, params: any) => void;
  onError?: (message: string, willRetry: boolean) => void;
  onStderr?: (line: string) => void;
  onClosed?: () => void;
};

export class AppServerClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private unlisteners: UnlistenFn[] = [];
  private handlers: AppServerHandlers;
  threadId: string | null = null;
  currentTurnId: string | null = null;
  resolvedCwd: string = "";

  constructor(handlers: AppServerHandlers) {
    this.handlers = handlers;
  }

  async start(program = "codex", cwd = "") {
    this.unlisteners.push(
      await listen<string>("appserver://message", (e) => this.onLine(e.payload)),
    );
    this.unlisteners.push(
      await listen<string>("appserver://stderr", (e) => this.handlers.onStderr?.(e.payload)),
    );
    this.unlisteners.push(
      await listen("appserver://closed", () => this.handlers.onClosed?.()),
    );
    await invoke("appserver_spawn", { program, cwd });
  }

  async dispose() {
    await invoke("appserver_kill").catch(() => {});
    this.unlisteners.forEach((u) => u());
    this.unlisteners = [];
  }

  private send(obj: any) {
    return invoke("appserver_send", { json: JSON.stringify(obj) });
  }

  private request<T = any>(method: string, params: any): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params }).catch(reject);
    });
  }

  private notify(method: string, params?: any) {
    return this.send({ method, params });
  }

  private respond(id: number, result: any) {
    return this.send({ id, result });
  }

  private onLine(line: string) {
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    // Response to one of our requests.
    if (typeof msg.id === "number" && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
      }
    }

    // Server-initiated request or notification.
    switch (msg.method) {
      case "item/started":
        this.handlers.onItemStarted?.(msg.params?.item, msg.params?.turnId ?? "");
        break;
      case "item/completed":
        this.handlers.onItemUpdated?.(msg.params?.item);
        break;
      case "item/agentMessage/delta":
        this.handlers.onAgentDelta?.(msg.params?.itemId ?? "", msg.params?.delta ?? "");
        break;
      case "item/commandExecution/outputDelta":
        this.handlers.onCommandOutputDelta?.(msg.params?.itemId ?? "", msg.params?.delta ?? "");
        break;
      case "turn/started":
        this.currentTurnId = msg.params?.turnId ?? null;
        this.handlers.onTurnStarted?.(msg.params?.turnId ?? "");
        break;
      case "turn/completed":
        this.currentTurnId = null;
        this.handlers.onTurnCompleted?.(msg.params?.turnId ?? "");
        break;
      case "turn/plan/updated":
        this.handlers.onPlanUpdated?.(msg.params?.plan ?? [], msg.params?.explanation ?? null);
        break;
      case "error":
        this.handlers.onError?.(
          msg.params?.error?.message ?? msg.params?.message ?? "unknown error",
          msg.params?.willRetry ?? false,
        );
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
      case "item/permissions/requestApproval":
        if (typeof msg.id === "number") {
          this.handlers.onApprovalRequest?.(msg.method, msg.id, msg.params);
        }
        break;
      default:
        // Other notifications (item/started, item/completed, token usage, …) ignored in spike.
        break;
    }
  }

  // ---- High-level flow ----

  async initialize() {
    await this.request("initialize", {
      clientInfo: { name: "beacon", title: "Beacon", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    await this.notify("initialized");
  }

  async startThread(
    opts: { modelProvider?: string; model?: string; cwd?: string; sandbox?: string; approvalPolicy?: string } = {},
  ) {
    const params: any = {
      approvalPolicy: opts.approvalPolicy ?? "on-request",
      sandbox: opts.sandbox ?? "danger-full-access",
      ...opts,
    };
    if (!params.cwd) delete params.cwd; // omit empty cwd → codex default
    const res = await this.request("thread/start", params);
    this.threadId = res?.thread?.id ?? null;
    this.resolvedCwd = res?.cwd ?? params.cwd ?? "";
    return this.threadId;
  }

  /** List direct children of a directory (codex fs/readDirectory). */
  async readDirectory(path: string): Promise<any[]> {
    if (!path) return [];
    const res = await this.request("fs/readDirectory", { path });
    return res?.entries ?? [];
  }

  /** List past threads (newest first). */
  async listThreads(limit = 50): Promise<any[]> {
    const res = await this.request("thread/list", { limit });
    return res?.data ?? [];
  }

  /** Read a thread's full history as a flat list of items. */
  async readThreadItems(threadId: string): Promise<any[]> {
    const res = await this.request("thread/read", { threadId, includeTurns: true });
    const turns = res?.thread?.turns ?? [];
    return turns.flatMap((t: any) => t.items ?? []);
  }

  /** Resume an existing thread; subsequent turns attach to it. */
  async resumeThread(
    threadId: string,
    cwd = "",
    opts: { sandbox?: string; approvalPolicy?: string } = {},
  ): Promise<string | null> {
    const params: any = {
      threadId,
      approvalPolicy: opts.approvalPolicy ?? "on-request",
      sandbox: opts.sandbox ?? "danger-full-access",
    };
    if (cwd) params.cwd = cwd;
    const res = await this.request("thread/resume", params);
    this.threadId = res?.thread?.id ?? threadId;
    this.resolvedCwd = res?.cwd ?? cwd ?? "";
    return this.threadId;
  }

  async sendTurn(input: UserInput[], cwd?: string) {
    if (!this.threadId) throw new Error("no thread");
    const params: any = { threadId: this.threadId, input };
    // cwd override applies to this turn and subsequent turns.
    if (cwd && cwd !== this.resolvedCwd) {
      params.cwd = cwd;
      this.resolvedCwd = cwd;
    }
    return this.request("turn/start", params);
  }

  sendText(text: string, cwd?: string) {
    return this.sendTurn([{ type: "text", text, text_elements: [] }], cwd);
  }

  /** Send text plus any number of images (data URLs or http URLs). */
  sendMessage(text: string, imageUrls: string[] = [], cwd?: string) {
    const input: UserInput[] = [];
    if (text) input.push({ type: "text", text, text_elements: [] });
    for (const url of imageUrls) input.push({ type: "image", url });
    return this.sendTurn(input, cwd);
  }

  approve(id: number, decision: "approved" | "denied" | "approved_for_session" | "abort") {
    return this.respond(id, { decision });
  }

  /** Interrupt the in-flight turn. */
  interrupt() {
    if (!this.threadId || !this.currentTurnId) return Promise.resolve();
    return this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.currentTurnId,
    });
  }
}
