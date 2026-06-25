// Provider model + storage. A provider points Codex at a model: for chat-only
// 国产 providers we "bridge" (wire_api=responses via Beacon's local proxy, which
// translates to Chat Completions). Stored locally; keys never leave the machine.

import { invoke } from "@tauri-apps/api/core";

export type Provider = {
  id: string;
  name: string;
  slug: string; // [model_providers.<slug>] in config.toml
  baseURL: string;
  apiKey: string;
  model: string;
  reasoningEffort: string; // "" | low | medium | high
  bridged: boolean; // true → route through local translation proxy
};

export type Template = {
  name: string;
  baseURL: string;
  model: string;
  helpUrl: string; // where to get an API key
};

// Pre-configured 国产 providers. base_url 与默认模型可在表单里改。
export const TEMPLATES: Template[] = [
  { name: "DeepSeek", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", helpUrl: "https://platform.deepseek.com/api_keys" },
  { name: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus", helpUrl: "https://open.bigmodel.cn/usercenter/apikeys" },
  { name: "Kimi", baseURL: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", helpUrl: "https://platform.moonshot.cn/console/api-keys" },
  { name: "通义千问", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", helpUrl: "https://bailian.console.aliyun.com/?apiKey=1" },
  { name: "MiniMax", baseURL: "https://api.minimaxi.com/v1", model: "MiniMax-Text-01", helpUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" },
];

const RESERVED = new Set(["openai", "ollama", "lmstudio"]);

export function slugify(name: string): string {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s) s = "provider";
  if (RESERVED.has(s)) s = `${s}_x`;
  return s;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const KEY_LIST = "beacon.providers";
const KEY_ACTIVE = "beacon.activeProviderId";

export function loadProviders(): Provider[] {
  try {
    return JSON.parse(localStorage.getItem(KEY_LIST) || "[]");
  } catch {
    return [];
  }
}

export function saveProviders(list: Provider[]) {
  localStorage.setItem(KEY_LIST, JSON.stringify(list));
}

export function loadActiveId(): string | null {
  return localStorage.getItem(KEY_ACTIVE);
}

export function saveActiveId(id: string | null) {
  if (id) localStorage.setItem(KEY_ACTIVE, id);
  else localStorage.removeItem(KEY_ACTIVE);
}

// ---- Auto-generated conversation titles (ChatGPT-style) ----
const titleKey = (id: string) => `beacon.title.${id}`;
export const loadTitle = (id: string): string | null => localStorage.getItem(titleKey(id));
export const saveTitle = (id: string, t: string) => localStorage.setItem(titleKey(id), t);

/** Ask the provider's model for a short title summarizing the conversation. */
export async function generateTitle(p: Provider, content: string): Promise<string> {
  const title = await invoke<string>("summarize_title", {
    baseUrl: p.baseURL,
    apiKey: p.apiKey,
    model: p.model,
    content: content.slice(0, 1200),
  });
  return (title || "").replace(/\s+/g, " ").trim().slice(0, 24);
}

// Start the bridge proxy (if needed) and write the provider into ~/.codex/config.toml
// so the next Codex thread routes through it. Call before starting a new thread.
export async function activateProvider(p: Provider): Promise<void> {
  let baseURL = p.baseURL;
  let bearer = p.apiKey;
  if (p.bridged) {
    const port = await invoke<number>("proxy_start", {
      upstream: p.baseURL,
      apiKey: p.apiKey,
      model: p.model,
    });
    baseURL = `http://127.0.0.1:${port}/v1`;
    bearer = "beacon-bridge";
  } else {
    await invoke("proxy_stop").catch(() => {});
  }
  await invoke("config_write_provider", {
    slug: p.slug,
    name: p.name,
    baseUrl: baseURL,
    bearerToken: bearer,
    model: p.model,
    reasoningEffort: p.reasoningEffort,
  });
}
