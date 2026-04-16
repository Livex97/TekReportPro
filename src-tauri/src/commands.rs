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

fn get_current_target() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") { "aarch64-apple-darwin" } else { "x86_64-apple-darwin" }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else if cfg!(target_os = "linux") {
        "x86_64-unknown-linux-gnu"
    } else {
        "unknown"
    }
}

fn get_exe_extension() -> &'static str {
    if cfg!(target_os = "windows") { ".exe" } else { "" }
}

fn find_sidecar_dev(name: &str) -> Result<PathBuf, String> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let target = get_current_target();
    let ext = get_exe_extension();

    // 1. Cerca con target triple e estensione: name-target.exe
    let target_spec = PathBuf::from(manifest_dir)
        .join("binaries")
        .join(format!("{}-{}{}", name, target, ext));
    if target_spec.exists() {
        return Ok(target_spec);
    }

    // 2. Cerca solo con estensione: name.exe
    let simple_ext = PathBuf::from(manifest_dir)
        .join("binaries")
        .join(format!("{}{}", name, ext));
    if simple_ext.exists() {
        return Ok(simple_ext);
    }

    // 3. Fallback nome semplice (compatibilità)
    let simple = PathBuf::from(manifest_dir).join("binaries").join(name);
    if simple.exists() {
        return Ok(simple);
    }

    Err(format!(
        "Sidecar {} non trovato in src-tauri/binaries/. Cercato: {}-{}{} e {}{}",
        name, name, target, ext, name, ext
    ))
}

#[tauri::command]
pub async fn save_pandetta_command(
    params: SavePandettaParams,
) -> Result<String, String> {
    let executable = if cfg!(debug_assertions) {
        find_sidecar_dev("save_pandetta")?
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Impossibile trovare exe path: {}", e))?
            .parent()
            .ok_or_else(|| "Impossibile trovare directory exe".to_string())?
            .to_path_buf();

        let target = get_current_target();
        let ext = get_exe_extension();

        let with_triple = exe_dir.join(format!("save_pandetta-{}{}", target, ext));
        let without_triple = exe_dir.join(format!("save_pandetta{}", ext));
        
        if with_triple.exists() {
            with_triple
        } else if without_triple.exists() {
            without_triple
        } else {
            return Err(format!(
                "save_pandetta non trovato in {:?}. Cercato: save_pandetta-{}{} e save_pandetta{}",
                exe_dir, target, ext, ext
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

        let target = get_current_target();
        let ext = get_exe_extension();

        let with_triple = exe_dir.join(format!("save_sterlink-{}{}", target, ext));
        let without_triple = exe_dir.join(format!("save_sterlink{}", ext));
        
        if with_triple.exists() {
            with_triple
        } else if without_triple.exists() {
            without_triple
        } else {
            return Err(format!(
                "save_sterlink non trovato in {:?}. Cercato: save_sterlink-{}{} e save_sterlink{}",
                exe_dir, target, ext, ext
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

#[tauri::command]
pub async fn read_excel_command(
    path: String,
    type_hint: String,
) -> Result<serde_json::Value, String> {
    let executable = if cfg!(debug_assertions) {
        find_sidecar_dev("read_excel")?
    } else {
        let exe_dir = std::env::current_exe()
            .map_err(|e| format!("Impossibile trovare exe path: {}", e))?
            .parent()
            .ok_or_else(|| "Impossibile trovare directory exe".to_string())?
            .to_path_buf();

        let target = get_current_target();
        let ext = get_exe_extension();

        let with_triple = exe_dir.join(format!("read_excel-{}{}", target, ext));
        let without_triple = exe_dir.join(format!("read_excel{}", ext));
        
        if with_triple.exists() {
            with_triple
        } else if without_triple.exists() {
            without_triple
        } else {
            return Err(format!(
                "read_excel non trovato in {:?}. Cercato: read_excel-{}{} e read_excel{}",
                exe_dir, target, ext, ext
            ));
        }
    };

    // Esegui lo script Python
    let output = Command::new(&executable)
        .arg(&path)
        .arg(&type_hint)
        .output()
        .map_err(|e| format!("Failed to execute {:?}: {}", executable, e))?;

    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", err_msg));
    }

    // Decodifica JSON restituito da stdout
    let stdout_content = String::from_utf8_lossy(&output.stdout);
    let data: serde_json::Value = serde_json::from_str(&stdout_content)
        .map_err(|e| format!("Failed to parse JSON output: {}", e))?;

    Ok(data)
}

#[tauri::command]
pub async fn convert_doc_to_docx(input_path: String) -> Result<Vec<u8>, String> {
    let temp_dir = tempfile::tempdir().map_err(|e| format!("Errore directory temporanea: {}", e))?;
    let temp_path = temp_dir.path();
    
    // 1. Proviamo con textutil se siamo su macOS (integrato nel sistema)
    if cfg!(target_os = "macos") {
        let output_file = temp_path.join("output.docx");
        let output = Command::new("textutil")
            .arg("-convert").arg("docx")
            .arg("-output").arg(&output_file)
            .arg(&input_path)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                if let Ok(content) = std::fs::read(&output_file) {
                    return Ok(content);
                }
            }
        }
    }

    // 2. Fallback su LibreOffice (soffice) - Disponibile su Windows e Linux
    let soffice_cmd = if cfg!(target_os = "windows") { "soffice.exe" } else { "soffice" };
    
    // Cerchiamo soffice nel PATH del sistema
    if let Ok(soffice_path) = which::which(soffice_cmd) {
        let output = Command::new(soffice_path)
            .arg("--headless")
            .arg("--convert-to").arg("docx")
            .arg("--outdir").arg(temp_path)
            .arg(&input_path)
            .output()
            .map_err(|e| format!("Errore durante l'esecuzione di LibreOffice: {}", e))?;

        if output.status.success() {
            // LibreOffice salva il file con lo stesso nome ma estensione .docx nella outdir
            let file_name = std::path::Path::new(&input_path)
                .file_stem()
                .ok_or("Nome file non valido")?
                .to_string_lossy();
            let converted_path = temp_path.join(format!("{}.docx", file_name));
            
            return std::fs::read(&converted_path).map_err(|e| format!("Errore lettura file convertito: {}", e));
        }
    }

    Err("Impossibile convertire il file .doc. Su macOS assicurati che textutil funzioni, su Windows/Linux è necessario LibreOffice installato e aggiunto al PATH.".to_string())
}
