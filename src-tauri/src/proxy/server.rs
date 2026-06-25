// Localhost HTTP server that bridges Codex's Responses API to a Chat Completions
// upstream. Codex talks to http://127.0.0.1:<port>/v1/responses; this proxy
// translates each request, streams it to the provider's /chat/completions, and
// translates the SSE response back. Ported from macOS Beacon's TranslationProxy.

use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::State,
    http::header,
    response::Response,
    routing::post,
    Router,
};
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use super::translator::{chat_request_from_responses, new_response_id, StreamEncoder};

struct UpstreamCfg {
    base: String,
    key: String,
    model: String,
}

/// Tauri-managed proxy handle: the running port + a shutdown trigger.
#[derive(Default)]
pub struct ProxyState(pub Mutex<Option<(u16, oneshot::Sender<()>)>>);

#[tauri::command]
pub async fn proxy_start(
    state: tauri::State<'_, ProxyState>,
    upstream: String,
    api_key: String,
    model: String,
) -> Result<u16, String> {
    // Replace any existing proxy.
    if let Some((_, tx)) = state.0.lock().unwrap().take() {
        let _ = tx.send(());
    }
    let (port, tx) = spawn_proxy(upstream, api_key, model).await?;
    *state.0.lock().unwrap() = Some((port, tx));
    Ok(port)
}

#[tauri::command]
pub fn proxy_stop(state: tauri::State<'_, ProxyState>) -> Result<(), String> {
    if let Some((_, tx)) = state.0.lock().unwrap().take() {
        let _ = tx.send(());
    }
    Ok(())
}

pub async fn spawn_proxy(
    upstream: String,
    key: String,
    model: String,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let base = upstream.trim_end_matches('/').to_string();
    let cfg = Arc::new(UpstreamCfg { base, key, model });

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let app = Router::new()
        .route("/v1/responses", post(handler))
        .route("/responses", post(handler))
        .with_state(cfg);

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });
    Ok((port, tx))
}

/// One-shot, non-streaming chat completion — used to auto-title a conversation.
/// Calls the provider's real upstream directly (not the proxy).
#[tauri::command]
pub async fn summarize_title(
    base_url: String,
    api_key: String,
    model: String,
    content: String,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": "你是会话标题助手。根据对话内容用不超过12个汉字概括主题，直接返回标题本身，不要引号、标点或解释。" },
            { "role": "user", "content": content }
        ],
        "stream": false,
        "max_tokens": 40,
        "temperature": 0.3
    });
    let client = reqwest::Client::new();
    let mut rb = client.post(&url).json(&body);
    if !api_key.is_empty() {
        rb = rb.bearer_auth(&api_key);
    }
    let resp = rb.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let title = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .trim_matches(|c| c == '"' || c == '「' || c == '」' || c == '。')
        .to_string();
    Ok(title)
}

async fn handler(State(cfg): State<Arc<UpstreamCfg>>, body: Bytes) -> Response {
    let req: Value = serde_json::from_slice(&body).unwrap_or(json!({}));

    let model_str = if cfg.model.is_empty() {
        req.get("model").and_then(Value::as_str).unwrap_or("").to_string()
    } else {
        cfg.model.clone()
    };
    let override_model = if cfg.model.is_empty() {
        None
    } else {
        Some(cfg.model.clone())
    };
    let chat = chat_request_from_responses(&req, override_model.as_deref());
    let url = format!("{}/chat/completions", cfg.base);
    let key = cfg.key.clone();

    let stream = async_stream::stream! {
        let mut enc = StreamEncoder::new(new_response_id(), model_str);
        yield Ok::<Bytes, std::io::Error>(Bytes::from(enc.created()));

        let client = reqwest::Client::new();
        let mut rb = client
            .post(&url)
            .header("content-type", "application/json")
            .header("accept", "text/event-stream")
            .json(&chat);
        if !key.is_empty() {
            rb = rb.bearer_auth(&key);
        }

        match rb.send().await {
            Ok(resp) if resp.status().is_success() => {
                let mut bytes_stream = resp.bytes_stream();
                let mut buf: Vec<u8> = Vec::new();
                let mut done = false;
                'outer: while let Some(chunk) = bytes_stream.next().await {
                    let Ok(b) = chunk else { break };
                    buf.extend_from_slice(&b);
                    while let Some(pos) = buf.iter().position(|&c| c == b'\n') {
                        let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
                        let line = String::from_utf8_lossy(&line_bytes);
                        let line = line.trim();
                        let Some(rest) = line.strip_prefix("data:") else { continue };
                        let payload = rest.trim();
                        if payload == "[DONE]" {
                            done = true;
                            break 'outer;
                        }
                        if payload.is_empty() {
                            continue;
                        }
                        if let Ok(json) = serde_json::from_str::<Value>(payload) {
                            for frame in enc.consume(&json) {
                                yield Ok(Bytes::from(frame));
                            }
                        }
                    }
                }
                if done {
                    for frame in enc.finish() {
                        yield Ok(Bytes::from(frame));
                    }
                } else {
                    yield Ok(Bytes::from(
                        enc.failed("stream_incomplete", "stream disconnected before completion"),
                    ));
                }
            }
            Ok(resp) => {
                let code = resp.status().as_u16().to_string();
                let text = resp.text().await.unwrap_or_default();
                yield Ok(Bytes::from(enc.failed(&code, &text)));
            }
            Err(e) => {
                yield Ok(Bytes::from(enc.failed("connection_error", &e.to_string())));
            }
        }
    };

    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from_stream(stream))
        .unwrap()
}
