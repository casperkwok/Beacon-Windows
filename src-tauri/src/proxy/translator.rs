// Translates between OpenAI Codex's Responses API and the Chat Completions API,
// so chat-only providers (DeepSeek, GLM, Kimi, …) work behind Codex's Responses
// client. Ported from the macOS Beacon's ResponsesTranslator.swift.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

fn uuid_simple() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

// ---- Request: Responses → Chat ----

pub fn chat_request_from_responses(body: &Value, override_model: Option<&str>) -> Value {
    let mut messages: Vec<Value> = Vec::new();

    let system_text = body
        .get("instructions")
        .and_then(Value::as_str)
        .or_else(|| body.get("system").and_then(Value::as_str));
    if let Some(sys) = system_text {
        if !sys.is_empty() {
            messages.push(json!({ "role": "system", "content": sys }));
        }
    }

    match body.get("input") {
        Some(Value::String(text)) => messages.push(json!({ "role": "user", "content": text })),
        Some(Value::Array(items)) => append_input_items(items, &mut messages),
        _ => {}
    }

    let model = override_model
        .map(str::to_string)
        .or_else(|| body.get("model").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_default();

    let mut chat = Map::new();
    chat.insert("model".into(), json!(model));
    chat.insert("messages".into(), json!(messages));

    let stream = body.get("stream").and_then(Value::as_bool).unwrap_or(true);
    chat.insert("stream".into(), json!(stream));
    if stream {
        chat.insert("stream_options".into(), json!({ "include_usage": true }));
    }
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let converted = convert_tools(tools);
        if !converted.is_empty() {
            chat.insert("tools".into(), json!(converted));
        }
    }
    if let Some(t) = body.get("temperature") {
        chat.insert("temperature".into(), t.clone());
    }
    if let Some(m) = body.get("max_output_tokens") {
        chat.insert("max_tokens".into(), m.clone());
    }
    Value::Object(chat)
}

fn append_input_items(items: &[Value], messages: &mut Vec<Value>) {
    let mut i = 0;
    while i < items.len() {
        let item = &items[i];
        let kind = item.get("type").and_then(Value::as_str).unwrap_or("");

        if kind == "function_call" {
            let mut tool_calls: Vec<Value> = Vec::new();
            while i < items.len()
                && items[i].get("type").and_then(Value::as_str) == Some("function_call")
            {
                let cur = &items[i];
                tool_calls.push(json!({
                    "id": cur.get("call_id").and_then(Value::as_str).unwrap_or(""),
                    "type": "function",
                    "function": {
                        "name": cur.get("name").and_then(Value::as_str).unwrap_or(""),
                        "arguments": cur.get("arguments").and_then(Value::as_str).unwrap_or("{}"),
                    },
                }));
                i += 1;
            }
            messages.push(json!({ "role": "assistant", "tool_calls": tool_calls }));
            continue;
        }

        match kind {
            "function_call_output" => messages.push(json!({
                "role": "tool",
                "tool_call_id": item.get("call_id").and_then(Value::as_str).unwrap_or(""),
                "content": item.get("output").and_then(Value::as_str).unwrap_or(""),
            })),
            "reasoning" => {}
            _ => {
                let mut role = item.get("role").and_then(Value::as_str).unwrap_or("user");
                if role == "developer" {
                    role = "system";
                }
                let mut msg = Map::new();
                msg.insert("role".into(), json!(role));
                if let Some(content) = flatten_content(item.get("content")) {
                    msg.insert("content".into(), content);
                }
                let msg = Value::Object(msg);
                if role == "system" {
                    if messages
                        .first()
                        .and_then(|m| m.get("role"))
                        .and_then(Value::as_str)
                        == Some("system")
                    {
                        messages[0] = msg;
                    } else {
                        messages.insert(0, msg);
                    }
                } else {
                    messages.push(msg);
                }
            }
        }
        i += 1;
    }
}

fn flatten_content(value: Option<&Value>) -> Option<Value> {
    match value {
        Some(Value::String(s)) => Some(json!(s)),
        Some(Value::Array(parts)) => {
            let text_kinds = ["input_text", "text", "output_text"];
            let all_text = parts.iter().all(|p| {
                let t = p.get("type").and_then(Value::as_str).unwrap_or("");
                text_kinds.contains(&t)
            });
            if all_text {
                let joined: String = parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(Value::as_str))
                    .collect();
                return Some(json!(joined));
            }
            let mapped: Vec<Value> = parts
                .iter()
                .map(|part| {
                    if part.get("type").and_then(Value::as_str) == Some("input_image") {
                        json!({
                            "type": "image_url",
                            "image_url": { "url": part.get("image_url").and_then(Value::as_str).unwrap_or("") },
                        })
                    } else {
                        json!({ "type": "text", "text": part.get("text").and_then(Value::as_str).unwrap_or("") })
                    }
                })
                .collect();
            Some(json!(mapped))
        }
        Some(other) => Some(other.clone()),
        None => None,
    }
}

fn convert_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter_map(|tool| {
            if tool.get("type").and_then(Value::as_str) != Some("function") {
                return None;
            }
            if tool.get("function").map(Value::is_object).unwrap_or(false) {
                return Some(tool.clone());
            }
            let mut function = Map::new();
            function.insert("name".into(), json!(tool.get("name").and_then(Value::as_str).unwrap_or("")));
            if let Some(desc) = tool.get("description") {
                function.insert("description".into(), desc.clone());
            }
            if let Some(params) = tool.get("parameters") {
                function.insert("parameters".into(), params.clone());
            }
            Some(json!({ "type": "function", "function": Value::Object(function) }))
        })
        .collect()
}

// ---- Response: Chat SSE → Responses SSE ----

#[derive(Default, Clone)]
struct ToolAccum {
    id: String,
    name: String,
    arguments: String,
}

pub struct StreamEncoder {
    response_id: String,
    model: String,
    accumulated_text: String,
    emitted_message_item: bool,
    msg_item_id: String,
    tool_calls: BTreeMap<i64, ToolAccum>,
    usage: Option<Value>,
}

impl StreamEncoder {
    pub fn new(response_id: String, model: String) -> Self {
        Self {
            response_id,
            model,
            accumulated_text: String::new(),
            emitted_message_item: false,
            msg_item_id: format!("msg_{}", uuid_simple()),
            tool_calls: BTreeMap::new(),
            usage: None,
        }
    }

    pub fn created(&self) -> String {
        sse(
            "response.created",
            &json!({
                "type": "response.created",
                "response": { "id": self.response_id, "status": "in_progress", "model": self.model },
            }),
        )
    }

    pub fn consume(&mut self, chunk: &Value) -> Vec<String> {
        let mut out = Vec::new();
        if let Some(u) = chunk.get("usage") {
            if u.is_object() {
                self.usage = Some(u.clone());
            }
        }
        let Some(choices) = chunk.get("choices").and_then(Value::as_array) else {
            return out;
        };
        for choice in choices {
            let delta = choice.get("delta").cloned().unwrap_or(json!({}));
            if let Some(content) = delta.get("content").and_then(Value::as_str) {
                if !content.is_empty() {
                    if !self.emitted_message_item {
                        out.push(sse(
                            "response.output_item.added",
                            &json!({
                                "type": "response.output_item.added", "output_index": 0,
                                "item": { "type": "message", "id": self.msg_item_id, "role": "assistant", "status": "in_progress", "content": [] },
                            }),
                        ));
                        self.emitted_message_item = true;
                    }
                    self.accumulated_text.push_str(content);
                    out.push(sse(
                        "response.output_text.delta",
                        &json!({
                            "type": "response.output_text.delta", "item_id": self.msg_item_id, "output_index": 0, "delta": content,
                        }),
                    ));
                }
            }
            if let Some(tcs) = delta.get("tool_calls").and_then(Value::as_array) {
                for tc in tcs {
                    let idx = tc.get("index").and_then(Value::as_i64).unwrap_or(0);
                    let acc = self.tool_calls.entry(idx).or_default();
                    if let Some(id) = tc.get("id").and_then(Value::as_str) {
                        if !id.is_empty() {
                            acc.id = id.to_string();
                        }
                    }
                    if let Some(f) = tc.get("function") {
                        if let Some(n) = f.get("name").and_then(Value::as_str) {
                            if !n.is_empty() {
                                acc.name.push_str(n);
                            }
                        }
                        if let Some(a) = f.get("arguments").and_then(Value::as_str) {
                            acc.arguments.push_str(a);
                        }
                    }
                }
            }
        }
        out
    }

    pub fn finish(&self) -> Vec<String> {
        let mut out = Vec::new();
        if self.emitted_message_item {
            out.push(sse(
                "response.output_item.done",
                &json!({
                    "type": "response.output_item.done", "output_index": 0,
                    "item": { "type": "message", "id": self.msg_item_id, "role": "assistant", "status": "completed",
                              "content": [{ "type": "output_text", "text": self.accumulated_text }] },
                }),
            ));
        }
        let base_index = if self.emitted_message_item { 1 } else { 0 };
        let mut fc_items: Vec<Value> = Vec::new();
        for (rel, (_key, tc)) in self.tool_calls.iter().enumerate() {
            let fc_id = format!("fc_{}", uuid_simple());
            let output_index = base_index + rel;
            out.push(sse(
                "response.output_item.added",
                &json!({
                    "type": "response.output_item.added", "output_index": output_index,
                    "item": { "type": "function_call", "id": fc_id, "call_id": tc.id, "name": tc.name, "arguments": "", "status": "in_progress" },
                }),
            ));
            if !tc.arguments.is_empty() {
                out.push(sse(
                    "response.function_call_arguments.delta",
                    &json!({
                        "type": "response.function_call_arguments.delta", "item_id": fc_id, "output_index": output_index, "delta": tc.arguments,
                    }),
                ));
            }
            let done_item = json!({ "type": "function_call", "id": fc_id, "call_id": tc.id, "name": tc.name, "arguments": tc.arguments, "status": "completed" });
            out.push(sse(
                "response.output_item.done",
                &json!({ "type": "response.output_item.done", "output_index": output_index, "item": done_item }),
            ));
            fc_items.push(done_item);
        }
        let mut output_items: Vec<Value> = Vec::new();
        if self.emitted_message_item {
            output_items.push(json!({ "type": "message", "id": self.msg_item_id, "role": "assistant", "status": "completed",
                                      "content": [{ "type": "output_text", "text": self.accumulated_text }] }));
        }
        output_items.extend(fc_items);
        let u = self.usage.clone().unwrap_or(json!({}));
        let pick = |k: &str| u.get(k).and_then(Value::as_i64).unwrap_or(0);
        out.push(sse(
            "response.completed",
            &json!({
                "type": "response.completed",
                "response": { "id": self.response_id, "status": "completed", "model": self.model, "output": output_items,
                              "usage": { "input_tokens": pick("prompt_tokens"), "output_tokens": pick("completion_tokens"), "total_tokens": pick("total_tokens") } },
            }),
        ));
        out
    }

    pub fn failed(&self, code: &str, message: &str) -> String {
        sse(
            "response.failed",
            &json!({
                "type": "response.failed",
                "response": { "id": self.response_id, "status": "failed", "error": { "code": code, "message": message } },
            }),
        )
    }
}

pub fn new_response_id() -> String {
    format!("resp_{}", uuid_simple())
}

fn sse(event: &str, payload: &Value) -> String {
    format!("event: {}\ndata: {}\n\n", event, payload)
}
