mod collections;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::oneshot;

#[derive(Deserialize)]
struct KeyValue {
    key: String,
    value: String,
}

#[derive(Deserialize)]
struct MultipartField {
    key: String,
    value: String,
    is_file: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RequestBody {
    None,
    Raw { content: String },
    Multipart { fields: Vec<MultipartField> },
}

#[derive(Deserialize)]
struct RequestSettings {
    /// 0 means no timeout
    timeout_ms: u64,
    follow_redirects: bool,
    verify_ssl: bool,
}

#[derive(Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<KeyValue>,
    body: RequestBody,
    settings: RequestSettings,
}

#[derive(Serialize)]
struct HttpResponse {
    status: u16,
    status_text: String,
    /// Final URL, after redirects
    url: String,
    headers: Vec<(String, String)>,
    body: String,
    time_ms: u128,
    size_bytes: usize,
}

fn build_multipart(fields: Vec<MultipartField>) -> Result<reqwest::multipart::Form, String> {
    let mut form = reqwest::multipart::Form::new();
    for field in fields {
        if field.is_file {
            let bytes = std::fs::read(&field.value)
                .map_err(|e| format!("Cannot read file {}: {e}", field.value))?;
            let file_name = Path::new(&field.value)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            form = form.part(field.key, reqwest::multipart::Part::bytes(bytes).file_name(file_name));
        } else {
            form = form.text(field.key, field.value);
        }
    }
    Ok(form)
}

/// Sends the HTTP request from the Rust side (no browser CORS restrictions).
#[tauri::command]
async fn send_request(request: HttpRequest) -> Result<HttpResponse, String> {
    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|e| format!("Invalid method: {e}"))?;

    let settings = &request.settings;
    let redirect = if settings.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };
    let mut client = reqwest::Client::builder()
        .user_agent("Burno/0.1")
        .redirect(redirect)
        .danger_accept_invalid_certs(!settings.verify_ssl);
    if settings.timeout_ms > 0 {
        client = client.timeout(Duration::from_millis(settings.timeout_ms));
    }
    let client = client.build().map_err(|e| e.to_string())?;

    let mut builder = client.request(method, &request.url);
    for h in &request.headers {
        builder = builder.header(&h.key, &h.value);
    }
    builder = match request.body {
        RequestBody::None => builder,
        RequestBody::Raw { content } => builder.body(content),
        RequestBody::Multipart { fields } => builder.multipart(build_multipart(fields)?),
    };

    let start = Instant::now();
    let response = builder.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let url = response.url().to_string();
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
        url,
        headers,
        size_bytes: bytes.len(),
        body: String::from_utf8_lossy(&bytes).to_string(),
        time_ms,
    })
}

/// Opens the OAuth 2.0 authorization page in a new window and resolves with the
/// full callback URL (query + fragment) as soon as the provider redirects to it.
#[tauri::command]
async fn oauth2_authorize(
    app: AppHandle,
    authorize_url: String,
    callback_url: String,
) -> Result<String, String> {
    let url: tauri::Url = authorize_url
        .parse()
        .map_err(|e| format!("Invalid authorization URL: {e}"))?;
    if callback_url.trim().is_empty() {
        return Err("Callback URL is required".into());
    }

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();

    let nav_tx = tx.clone();
    let window = WebviewWindowBuilder::new(&app, format!("oauth2-{nonce}"), WebviewUrl::External(url))
        .title("Burno — Authorize")
        .inner_size(600.0, 760.0)
        .on_navigation(move |nav_url| {
            if !nav_url.as_str().starts_with(&callback_url) {
                return true;
            }
            if let Some(tx) = nav_tx.lock().unwrap().take() {
                let _ = tx.send(Ok(nav_url.to_string()));
            }
            false
        })
        .build()
        .map_err(|e| e.to_string())?;

    let close_tx = tx.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Destroyed = event {
            if let Some(tx) = close_tx.lock().unwrap().take() {
                let _ = tx.send(Err("Authorization window was closed".into()));
            }
        }
    });

    let result = rx.await.map_err(|_| "Authorization cancelled".to_string())?;
    let _ = window.close();
    result
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            send_request,
            oauth2_authorize,
            collections::collection_load,
            collections::collection_create,
            collections::collection_rename,
            collections::collection_default,
            collections::request_create,
            collections::request_write,
            collections::folder_create,
            collections::entry_rename,
            collections::entry_delete,
            collections::collection_set_variables,
            collections::env_list,
            collections::env_write,
            collections::env_rename,
            collections::env_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
