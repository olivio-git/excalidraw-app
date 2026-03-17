use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Emitter};
use tokio::sync::{Mutex, oneshot};
use axum::{Router, routing::post, extract::State, Json, http::StatusCode};
use uuid::Uuid;

// ─── External plugin loader ───────────────────────────────────────────────────

#[derive(Serialize)]
struct ExternalPluginInfo {
    manifest_json: String,
    script_content: String,
}

#[tauri::command]
async fn get_external_plugins(
    app: tauri::AppHandle,
) -> Result<Vec<ExternalPluginInfo>, String> {
    let plugins_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("plugins");

    if !plugins_dir.exists() {
        std::fs::create_dir_all(&plugins_dir).map_err(|e| e.to_string())?;
    }

    let mut plugins = Vec::new();

    for entry in std::fs::read_dir(&plugins_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        let entry_point = path.join("index.js");

        if !manifest_path.exists() || !entry_point.exists() {
            continue;
        }

        let manifest_json = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Error leyendo manifest en {:?}: {}", path, e))?;
        let script_content = std::fs::read_to_string(&entry_point)
            .map_err(|e| format!("Error leyendo index.js en {:?}: {}", path, e))?;

        plugins.push(ExternalPluginInfo {
            manifest_json,
            script_content,
        });
    }

    Ok(plugins)
}

// ─── MCP bridge ──────────────────────────────────────────────────────────────

struct McpResponse {
    result: serde_json::Value,
    error: Option<String>,
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<McpResponse>>>>;

struct McpState {
    pending: PendingMap,
}

impl Default for McpState {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Deserialize)]
struct ToolRequest {
    tool: String,
    input: serde_json::Value,
}

#[derive(Serialize)]
struct ToolResponse {
    result: serde_json::Value,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
struct McpCommandPayload {
    uuid: String,
    tool: String,
    input: serde_json::Value,
}

#[derive(Clone)]
struct BridgeState {
    pending: PendingMap,
    app: tauri::AppHandle,
}

async fn handle_tool(
    State(state): State<BridgeState>,
    Json(req): Json<ToolRequest>,
) -> Result<Json<ToolResponse>, (StatusCode, Json<ToolResponse>)> {
    let uuid = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<McpResponse>();

    state.pending.lock().await.insert(uuid.clone(), tx);

    let payload = McpCommandPayload {
        uuid: uuid.clone(),
        tool: req.tool,
        input: req.input,
    };

    if let Err(e) = state.app.emit("mcp:command", &payload) {
        state.pending.lock().await.remove(&uuid);
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ToolResponse {
                result: serde_json::Value::Null,
                error: Some(format!("Excalidraw app is not running. Start the app first. ({})", e)),
            }),
        ));
    }

    match tokio::time::timeout(std::time::Duration::from_secs(5), rx).await {
        Ok(Ok(response)) => Ok(Json(ToolResponse {
            result: response.result,
            error: response.error,
        })),
        Ok(Err(_)) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ToolResponse {
                result: serde_json::Value::Null,
                error: Some("Internal channel error.".to_string()),
            }),
        )),
        Err(_) => {
            state.pending.lock().await.remove(&uuid);
            Err((
                StatusCode::GATEWAY_TIMEOUT,
                Json(ToolResponse {
                    result: serde_json::Value::Null,
                    error: Some("Frontend timeout — no active diagram tab or canvas not ready.".to_string()),
                }),
            ))
        }
    }
}

async fn start_mcp_bridge(app: tauri::AppHandle, pending: PendingMap, port: u16) {
    let bridge_state = BridgeState { pending, app };
    let router = Router::new()
        .route("/api/tool", post(handle_tool))
        .with_state(bridge_state);

    let addr = format!("127.0.0.1:{}", port);
    match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            log::info!("MCP bridge listening on {}", addr);
            if let Err(e) = axum::serve(listener, router).await {
                log::error!("MCP bridge error: {}", e);
            }
        }
        Err(e) => {
            log::warn!("MCP bridge: failed to bind to {} — {}", addr, e);
        }
    }
}

#[tauri::command]
async fn mcp_ack(
    state: tauri::State<'_, McpState>,
    uuid: String,
    result: serde_json::Value,
    error: Option<String>,
) -> Result<(), String> {
    let mut pending = state.pending.lock().await;
    if let Some(sender) = pending.remove(&uuid) {
        let _ = sender.send(McpResponse { result, error });
    }
    Ok(())
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mcp_state = McpState::default();
    let pending = mcp_state.pending.clone();

    tauri::Builder::default()
        .manage(mcp_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            let port: u16 = std::env::var("MCP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(7888);
            let p = pending.clone();
            tauri::async_runtime::spawn(start_mcp_bridge(handle, p, port));
            Ok(())
        })
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Warn).build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_external_plugins, mcp_ack])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
