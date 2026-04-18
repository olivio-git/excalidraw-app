use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::{Manager, Emitter};
use tokio::sync::{Mutex, oneshot};
use rusqlite;
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

// ─── Chat history ────────────────────────────────────────────────────────────

struct ChatDb(std::sync::Mutex<rusqlite::Connection>);

fn init_db(conn: &rusqlite::Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS conversations (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            context_kind TEXT NOT NULL DEFAULT 'general',
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
            id              TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL DEFAULT '',
            tool_calls_json TEXT,
            timestamp       INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conv_ts
            ON messages(conversation_id, timestamp);
    ")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSummary {
    id: String,
    title: String,
    context_kind: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedMessage {
    id: String,
    conversation_id: String,
    role: String,
    content: String,
    tool_calls_json: Option<String>,
    timestamp: i64,
}

#[tauri::command]
fn chat_create_conversation(
    db: tauri::State<'_, ChatDb>,
    id: String,
    title: String,
    context_kind: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    conn.execute(
        "INSERT INTO conversations (id, title, context_kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, title, context_kind, now, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn chat_save_message(
    db: tauri::State<'_, ChatDb>,
    msg: SavedMessage,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![msg.id, msg.conversation_id, msg.role, msg.content, msg.tool_calls_json, msg.timestamp],
    ).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![msg.timestamp, msg.conversation_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn chat_list_conversations(
    db: tauri::State<'_, ChatDb>,
) -> Result<Vec<ConversationSummary>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, context_kind, created_at, updated_at FROM conversations ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(ConversationSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            context_kind: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn chat_load_conversation(
    db: tauri::State<'_, ChatDb>,
    id: String,
) -> Result<Vec<SavedMessage>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, tool_calls_json, timestamp FROM messages WHERE conversation_id = ?1 ORDER BY timestamp ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![id], |row| {
        Ok(SavedMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            tool_calls_json: row.get(4)?,
            timestamp: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn chat_delete_conversation(
    db: tauri::State<'_, ChatDb>,
    id: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM conversations WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
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

            // Chat history DB
            let db_path = app.path().app_data_dir()
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error>)?
                .join("chat-history.db");
            std::fs::create_dir_all(db_path.parent().unwrap()).ok();
            let conn = rusqlite::Connection::open(&db_path)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error>)?;
            init_db(&conn)
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())) as Box<dyn std::error::Error>)?;
            app.manage(ChatDb(std::sync::Mutex::new(conn)));

            Ok(())
        })
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Warn).build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            get_external_plugins,
            mcp_ack,
            chat_create_conversation,
            chat_save_message,
            chat_list_conversations,
            chat_load_conversation,
            chat_delete_conversation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application:review logs for details");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn test_db_init() {
        let conn = setup_db();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tables: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(tables.contains(&"conversations".to_string()));
        assert!(tables.contains(&"messages".to_string()));
    }

    #[test]
    fn test_create_and_list_conversations() {
        let conn = setup_db();
        let now = 1000i64;
        conn.execute(
            "INSERT INTO conversations (id, title, context_kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["id1", "First", "diagram", now, now],
        ).unwrap();
        let later = 2000i64;
        conn.execute(
            "INSERT INTO conversations (id, title, context_kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["id2", "Second", "document", later, later],
        ).unwrap();

        let mut stmt = conn.prepare(
            "SELECT id FROM conversations ORDER BY updated_at DESC"
        ).unwrap();
        let ids: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids, vec!["id2".to_string(), "id1".to_string()]);
    }

    #[test]
    fn test_save_message_bumps_updated_at() {
        let conn = setup_db();
        let created = 1000i64;
        conn.execute(
            "INSERT INTO conversations (id, title, context_kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["conv1", "Test", "general", created, created],
        ).unwrap();

        let msg_ts = 5000i64;
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params!["msg1", "conv1", "user", "hello", None::<String>, msg_ts],
        ).unwrap();
        conn.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            rusqlite::params![msg_ts, "conv1"],
        ).unwrap();

        let updated_at: i64 = conn.query_row(
            "SELECT updated_at FROM conversations WHERE id = ?1",
            rusqlite::params!["conv1"],
            |row| row.get(0),
        ).unwrap();
        assert!(updated_at > created);
        assert_eq!(updated_at, msg_ts);
    }

    #[test]
    fn test_delete_cascades_messages() {
        let conn = setup_db();
        let ts = 1000i64;
        conn.execute(
            "INSERT INTO conversations (id, title, context_kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params!["conv1", "Test", "general", ts, ts],
        ).unwrap();

        for i in 0..3 {
            conn.execute(
                "INSERT INTO messages (id, conversation_id, role, content, tool_calls_json, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![format!("msg{i}"), "conv1", "user", "text", None::<String>, ts + i as i64],
            ).unwrap();
        }

        conn.execute(
            "DELETE FROM conversations WHERE id = ?1",
            rusqlite::params!["conv1"],
        ).unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1",
            rusqlite::params!["conv1"],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }
} // end mod tests
