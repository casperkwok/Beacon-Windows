import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type Provider, type Template, TEMPLATES, slugify, uid } from "../lib/providers";

type Props = {
  providers: Provider[];
  activeId: string | null;
  onClose?: () => void;
  onActivate: (p: Provider) => void;
  onSave: (list: Provider[]) => void;
  embedded?: boolean; // render inside the Settings panel (no modal chrome)
};

type Editing = Partial<Provider> & { helpUrl?: string };

export default function ProviderManager({ providers, activeId, onClose, onActivate, onSave, embedded }: Props) {
  const [editing, setEditing] = useState<Editing | null>(null);

  function startNew() {
    setEditing({ name: "", baseURL: "", apiKey: "", model: "", reasoningEffort: "medium", bridged: true });
  }
  function fromTemplate(t: Template) {
    setEditing({ name: t.name, baseURL: t.baseURL, model: t.model, apiKey: "", reasoningEffort: "medium", bridged: true, helpUrl: t.helpUrl });
  }
  function editExisting(p: Provider) {
    setEditing({ ...p });
  }

  function save() {
    if (!editing || !editing.name?.trim() || !editing.apiKey?.trim()) return;
    const p: Provider = {
      id: editing.id || uid(),
      name: editing.name.trim(),
      slug: editing.slug || slugify(editing.name),
      baseURL: (editing.baseURL || "").trim(),
      apiKey: editing.apiKey.trim(),
      model: (editing.model || "").trim(),
      reasoningEffort: editing.reasoningEffort || "",
      bridged: editing.bridged ?? true,
    };
    const exists = providers.some((x) => x.id === p.id);
    const list = exists ? providers.map((x) => (x.id === p.id ? p : x)) : [...providers, p];
    onSave(list);
    setEditing(null);
    onActivate(p); // save = use it right away
  }

  function remove(id: string) {
    onSave(providers.filter((x) => x.id !== id));
  }

  const body = (
    <>
        {!editing ? (
          <div className="modal-body">
            {providers.length > 0 && (
              <div className="prov-list">
                {providers.map((p) => (
                  <div key={p.id} className={`prov-item ${p.id === activeId ? "active" : ""}`}>
                    <div className="prov-info" onClick={() => onActivate(p)}>
                      <div className="prov-name">
                        {p.name}
                        {p.id === activeId && <span className="prov-badge">使用中</span>}
                      </div>
                      <div className="prov-sub">{p.model || "默认模型"} · {p.baseURL}</div>
                    </div>
                    <button className="icon-btn" onClick={() => editExisting(p)} title="编辑">✎</button>
                    <button className="icon-btn" onClick={() => remove(p.id)} title="删除">🗑</button>
                  </div>
                ))}
              </div>
            )}

            <div className="tpl-label">从模板快速添加</div>
            <div className="tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.name} className="tpl-chip" onClick={() => fromTemplate(t)}>
                  {t.name}
                </button>
              ))}
              <button className="tpl-chip custom" onClick={startNew}>+ 自定义</button>
            </div>
          </div>
        ) : (
          <div className="modal-body">
            <label className="field">
              <span>名称</span>
              <input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="DeepSeek" />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input value={editing.baseURL || ""} onChange={(e) => setEditing({ ...editing, baseURL: e.target.value })} placeholder="https://api.deepseek.com/v1" />
            </label>
            <label className="field">
              <span>模型</span>
              <input value={editing.model || ""} onChange={(e) => setEditing({ ...editing, model: e.target.value })} placeholder="deepseek-chat" />
            </label>
            <label className="field">
              <span>API Key</span>
              <input type="password" value={editing.apiKey || ""} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} placeholder="sk-..." />
            </label>
            {editing.helpUrl && (
              <button className="link-btn" onClick={() => openUrl(editing.helpUrl!)}>
                如何获取 {editing.name} 的 API Key →
              </button>
            )}
            <label className="field">
              <span>推理强度</span>
              <select value={editing.reasoningEffort || ""} onChange={(e) => setEditing({ ...editing, reasoningEffort: e.target.value })}>
                <option value="">默认</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>

            <div className="modal-actions">
              <button className="btn" onClick={save} disabled={!editing.name?.trim() || !editing.apiKey?.trim()}>
                保存
              </button>
              <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>
        )}
    </>
  );

  if (embedded) return body;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">模型供应商</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}
