#!/usr/bin/env python3
"""
Sincronizza i file di supporto Python da python/ a src-tauri/python/
"""

import shutil
from pathlib import Path

def main():
    root = Path(__file__).parent.parent  # python/ -> root/
    python_dir = root / 'python'
    tauri_python_dir = root / 'src-tauri' / 'python'
    
    files_to_sync = [
        'save_pandetta.py',
        'requirements.txt',
        'app.py',
        'save_pandetta.spec'
    ]
    
    print(f"Syncing from {python_dir} to {tauri_python_dir}")
    
    for f in files_to_sync:
        src = python_dir / f
        dst = tauri_python_dir / f
        if src.exists():
            shutil.copy2(src, dst)
            print(f"  ✓ Synced {f}")
        else:
            print(f"  ✗ Missing {src}, skipping")

if __name__ == '__main__':
    main()