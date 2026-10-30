use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Deserialize)]
struct KeyValue {
    key: String,
    value: String,
    enabled: bool,
}

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<KeyValue>,
    body: Option<String>,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
    time_ms: u128,
    size_bytes: usize,
}

/// Sends the HTTP request from the Rust side (no browser CORS restrictions).
#[tauri::command]
async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|e| format!("Invalid method: {e}"))?;

    let client = reqwest::Client::builder()
        .user_agent("Burno/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client.request(method, &request.url);
    for h in request.headers.iter().filter(|h| h.enabled && !h.key.trim().is_empty()) {
        builder = builder.header(h.key.trim(), &h.value);
    }
    if let Some(body) = request.body.filter(|b| !b.is_empty()) {
        builder = builder.body(body);
    }

    let start = Instant::now();
    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let time_ms = start.elapsed().as_millis();

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        size_bytes: bytes.len(),
        body: String::from_utf8_lossy(&bytes).to_string(),
        time_ms,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![send_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
