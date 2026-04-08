use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::Command;
use std::path::PathBuf;

#[derive(Serialize, Deserialize)]
pub struct SavePandettaParams {
    pub current_data: serde_json::Value,
    pub original_data: serde_json::Value,
    pub dynamic_cols: Vec<String>,
    pub tecnico_color_map: std::collections::HashMap<String, serde_json::Value>,
    pub original_rows_count: usize,
    pub original_path: String,
    pub output_path: String,
}

#[derive(Serialize, Deserialize)]
pub struct SaveSterlinkParams {
    pub current_data: serde_json::Value,
    pub original_data: serde_json::Value,
    pub dynamic_cols: Vec<String>,
    pub original_rows_count: usize,
    pub original_path: String,
    pub output_path: String,
}

fn find_sidecar_dev(name: &str) -> Result<PathBuf, String> {
    // In development build, il binary è in src-tauri/binaries/
    let manifest_dir = env!("CARGO_MANIFEST_DIR");

    // Prova prima con il nome target-specifico (symlink)
    let target = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else {
        "x86_64-unknown-linux-gnu"
    };

    let dev_path = PathBuf::from(manifest_dir)
        .join("binaries")
        .join(format!("{}-{}", name, target));
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // Fallback: nome semplice
    let simple = PathBuf::from(manifest_dir).join("binaries").join(name);
    if simple.exists() {
        return Ok(simple);
    }

    Err(format!(
        "Sidecar {} non trovato in src-tauri/binaries/. Cercato: {}-{} e {}",
        name, name, target, name
    ))
}

#[tauri::command]
pub async fn save_pandetta_command(
    params: SavePandettaParams,
) -> Result<String, String> {
    // cfg!(debug_assertions) è true in `npm run tauri dev`, false in build di produzione
    let executable = if cfg!(debug_assertions) {
        find_sidecar_dev("save_pandetta")?
    } else {
        // In release, Tauri mette i binary da externalBin in Contents/MacOS/ (stesso dir dell'eseguibile)
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Impossibile trovare exe path: {}", e))?
            .parent()
            .ok_or_else(|| "Impossibile trovare directory exe".to_string())?
            .to_path_buf();

        // Tauri aggiunge il target triple al nome del file nel bundle
        let target = if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
        } else if cfg!(target_os = "windows") {
            "x86_64-pc-windows-msvc"
        } else {
            "x86_64-unknown-linux-gnu"
        };

        // Prima prova con target triple, poi senza
        let with_triple = exe_dir.join(format!("save_pandetta-{}", target));
        let without_triple = exe_dir.join("save_pandetta");
        if with_triple.exists() {
            with_triple
        } else if without_triple.exists() {
            without_triple
        } else {
            return Err(format!(
                "save_pandetta non trovato in {:?}. Cercato: save_pandetta-{} e save_pandetta",
                exe_dir, target
            ));
        }
    };

    // Crea JSON payload temporaneo
    let mut json_file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "current_data": params.current_data,
        "original_data": params.original_data,
        "dynamic_cols": params.dynamic_cols,
        "tecnico_color_map": params.tecnico_color_map,
        "original_rows_count": params.original_rows_count,
    });
    let json_content = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    json_file.write_all(json_content.as_bytes()).map_err(|e| e.to_string())?;
    let json_path = json_file.path().to_string_lossy().into_owned();

    // Esegui
    let output = Command::new(&executable)
        .arg(&json_path)
        .arg(&params.original_path)
        .arg(&params.output_path)
        .output()
        .map_err(|e| format!("Failed to execute {:?}: {}", executable, e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", err_msg));
    }

    Ok(format!("File salvato: {}", params.output_path))
}

#[tauri::command]
pub async fn save_sterlink_command(
    params: SaveSterlinkParams,
) -> Result<String, String> {
    let executable = if cfg!(debug_assertions) {
        find_sidecar_dev("save_sterlink")?
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Impossibile trovare exe path: {}", e))?
            .parent()
            .ok_or_else(|| "Impossibile trovare directory exe".to_string())?
            .to_path_buf();

        let target = if cfg!(target_os = "macos") {
            if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
        } else if cfg!(target_os = "windows") {
            "x86_64-pc-windows-msvc"
        } else {
            "x86_64-unknown-linux-gnu"
        };

        let with_triple = exe_dir.join(format!("save_sterlink-{}", target));
        let without_triple = exe_dir.join("save_sterlink");
        if with_triple.exists() {
            with_triple
        } else if without_triple.exists() {
            without_triple
        } else {
            return Err(format!(
                "save_sterlink non trovato in {:?}. Cercato: save_sterlink-{} e save_sterlink",
                exe_dir, target
            ));
        }
    };

    let mut json_file = tempfile::NamedTempFile::new().map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "current_data": params.current_data,
        "original_data": params.original_data,
        "dynamic_cols": params.dynamic_cols,
        "original_rows_count": params.original_rows_count,
    });
    let json_content = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    json_file.write_all(json_content.as_bytes()).map_err(|e| e.to_string())?;
    let json_path = json_file.path().to_string_lossy().into_owned();

    let output = Command::new(&executable)
        .arg(&json_path)
        .arg(&params.original_path)
        .arg(&params.output_path)
        .output()
        .map_err(|e| format!("Failed to execute {:?}: {}", executable, e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", err_msg));
    }

    Ok(format!("File salvato: {}", params.output_path))
}
