// App-level settings persisted locally. Sandbox + approval govern how much the
// agent can do and when it asks first; applied when starting a thread.

export type Sandbox = "danger-full-access" | "workspace-write" | "read-only";
export type Approval = "on-request" | "untrusted" | "never";

export type Settings = {
  sandbox: Sandbox;
  approval: Approval;
};

const KEY = "beacon.settings";
const DEFAULTS: Settings = { sandbox: "danger-full-access", approval: "on-request" };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const SANDBOX_LABELS: Record<Sandbox, { name: string; desc: string }> = {
  "danger-full-access": { name: "完全访问", desc: "可读写整台电脑、联网、访问钥匙串。能力最强（推荐，安全靠审批把关）" },
  "workspace-write": { name: "仅项目目录", desc: "只能在所选项目文件夹内读写，更安全但能力受限" },
  "read-only": { name: "只读", desc: "只能查看，不能修改任何文件" },
};

export const APPROVAL_LABELS: Record<Approval, { name: string; desc: string }> = {
  "on-request": { name: "需要时询问", desc: "危险操作前弹窗确认，安全读操作自动放行（推荐）" },
  untrusted: { name: "每步都问", desc: "几乎所有命令都先征求同意，最谨慎" },
  never: { name: "从不询问", desc: "全自动执行，不打扰但风险最高" },
};
