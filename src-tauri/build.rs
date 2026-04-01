use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // Compila lo script Python se necessario
    if let Err(e) = compile_python_sidecar() {
        println!("cargo:warning=Errore durante la compilazione del sidecar Python: {}", e);
    }

    tauri_build::build();
}

fn compile_python_sidecar() -> Result<(), Box<dyn std::error::Error>> {
    let source_path = Path::new("python/save_pandetta.py");
    let binaries_dir = PathBuf::from("binaries");
    
    // Istruiamo cargo a rieseguire questo script se il file sorgente cambia
    println!("cargo:rerun-if-changed=python/save_pandetta.py");

    if !source_path.exists() {
        return Err("File sorgente python/save_pandetta.py non trovato".into());
    }

    // Determina il target attuale
    let target = env::var("TARGET").unwrap_or_else(|_| "aarch64-apple-darwin".to_string());
    let binary_name = if cfg!(windows) {
        format!("save_pandetta-{}.exe", target)
    } else {
        format!("save_pandetta-{}", target)
    };
    
    let dest_binary_path = binaries_dir.join(&binary_name);

    // Controlla se dobbiamo ricompilare (se il binario non esiste o è vecchio)
    let should_compile = if !dest_binary_path.exists() {
        true
    } else {
        let src_meta = fs::metadata(source_path)?;
        let dst_meta = fs::metadata(&dest_binary_path)?;
        src_meta.modified()? > dst_meta.modified()?
    };

    if should_compile {
        println!("cargo:warning=Compilazione sidecar Python in corso (PyInstaller)...");
        
        fs::create_dir_all(&binaries_dir)?;

        // Esegui pyinstaller
        let status = Command::new("pyinstaller")
            .args(&["--onefile", "--clean", "--distpath", "target/pyinstaller_dist", source_path.to_str().unwrap()])
            .status()?;

        if !status.success() {
            return Err("Esecuzione di PyInstaller fallita".into());
        }

        // Copia il binary generato nella cartella binaries con il nome corretto per Tauri
        let build_output_name = if cfg!(windows) { "save_pandetta.exe" } else { "save_pandetta" };
        let built_binary = Path::new("target/pyinstaller_dist").join(build_output_name);
        
        fs::copy(&built_binary, &dest_binary_path)?;
        
        // Assicurati che sia eseguibile su Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&dest_binary_path)?.permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&dest_binary_path, perms)?;
        }

        // Copia anche il file senza target-triple per compatibilità con certi setup
        let generic_dest = binaries_dir.join(if cfg!(windows) { "save_pandetta.exe" } else { "save_pandetta" });
        fs::copy(&dest_binary_path, &generic_dest)?;

        println!("cargo:warning=Sidecar Python compilato con successo: {:?}", dest_binary_path);
    }

    Ok(())
}

