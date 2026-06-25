// Smoke test for the M1 translation proxy: starts the real proxy, sends a
// Responses-API request like Codex would, prints the translated SSE stream.
// Run: DS_KEY=sk-... cargo run --example proxy_smoke

use futures_util::StreamExt;

#[tokio::main]
async fn main() {
    let key = std::env::var("DS_KEY").expect("set DS_KEY");
    let upstream = std::env::var("DS_URL").unwrap_or_else(|_| "https://api.deepseek.com/v1".into());
    let model = std::env::var("DS_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".into());

    let (port, _tx) = beacon_lib::proxy::server::spawn_proxy(upstream, key, model)
        .await
        .expect("spawn proxy");
    eprintln!("[proxy] listening on 127.0.0.1:{port}");

    let body = serde_json::json!({
        "model": "ignored",
        "instructions": "You are a concise assistant. Answer in one short sentence.",
        "input": [
            { "type": "message", "role": "user",
              "content": [{ "type": "input_text", "text": "用一句中文介绍你自己。" }] }
        ],
        "stream": true
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{port}/v1/responses"))
        .json(&body)
        .send()
        .await
        .expect("send");
    eprintln!("[proxy] status {}", resp.status());

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(b) => print!("{}", String::from_utf8_lossy(&b)),
            Err(e) => {
                eprintln!("[stream error] {e}");
                break;
            }
        }
    }
    println!();
}
