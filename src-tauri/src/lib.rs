use serde::Serialize;
use tauri::Manager;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Warn).build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_external_plugins])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
