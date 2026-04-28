import os
import sys
import subprocess
import shutil
import platform

def get_target():
    system = platform.system().lower()
    machine = platform.machine().lower()
    
    if system == "darwin":
        if machine == "arm64" or machine == "aarch64":
            return "aarch64-apple-darwin"
        return "x86_64-apple-darwin"
    if system == "windows":
        return "x86_64-pc-windows-msvc"
    if system == "linux":
        return "x86_64-unknown-linux-gnu"
    return f"{machine}-unknown-{system}-gnu"

def build_binary(script_path, target_name, output_dir):
    filename = os.path.basename(script_path)
    name = os.path.splitext(filename)[0]
    
    print(f"\n[BUILD] {name.upper()}: Building for {target_name}...")
    
    # Use --name to ensure the output binary has the correct name for Tauri
    # Tauri expects: name-target_triple.exe (on windows) or name-target_triple (on mac/linux)
    ext = ".exe" if platform.system().lower() == "windows" else ""
    target_filename = f"{name}-{target_name}"
    
    cmd = [
        "python3", "-m", "PyInstaller",
        "--onefile",
        "--clean",
        "--noconfirm",
        "--distpath", "dist",
        "--name", target_filename,
        script_path
    ]
    
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd)
    
    if result.returncode != 0:
        print(f"[ERROR] Error building {name}")
        return False
    
    src_file = os.path.join("dist", f"{target_filename}{ext}")
    dest_file = os.path.join(output_dir, f"{target_filename}{ext}")
    
    os.makedirs(output_dir, exist_ok=True)
    
    if os.path.exists(src_file):
        shutil.copy2(src_file, dest_file)
        # Also create a non-platform-specific symlink/copy for local dev if on the same platform
        if target_name == get_target():
            dev_dest = os.path.join(output_dir, f"{name}{ext}")
            shutil.copy2(src_file, dev_dest)
            if platform.system().lower() != "windows":
                os.chmod(dev_dest, 0o755)
            print(f"[SUCCESS] Local dev binary created: {dev_dest}")
            
        if platform.system().lower() != "windows":
            os.chmod(dest_file, 0o755)
        print(f"[DONE] Built: {dest_file}")
        return True
    else:
        print(f"[ERROR] Source file not found: {src_file}")
        return False

def main():
    target = get_target()
    # If a target is passed as argument, use it (useful for GH Actions)
    if len(sys.argv) > 1:
        target = sys.argv[1]
        
    # Get the directory where the script is located (src-tauri/python)
    python_dir = os.path.dirname(os.path.abspath(__file__))
    # Go up to src-tauri
    src_tauri_dir = os.path.dirname(python_dir)
    # Target binaries directory
    output_dir = os.path.join(src_tauri_dir, "binaries")
    
    scripts = [
        os.path.join(python_dir, "save_pandetta.py"),
        os.path.join(python_dir, "save_sterlink.py"),
        os.path.join(python_dir, "read_excel.py"),
        os.path.join(python_dir, "check_email.py")
    ]
    
    success_count = 0
    for script in scripts:
        if os.path.exists(script):
            if build_binary(script, target, output_dir):
                success_count += 1
        else:
            print(f"[WARNING] {script} not found")
            
    if success_count == len(scripts):
        print("\n[SUCCESS] All binaries built successfully!")
    else:
        print(f"\n[INFO] Built {success_count}/{len(scripts)} binaries.")
        sys.exit(1)

if __name__ == "__main__":
    main()
