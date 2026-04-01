#!/usr/bin/env python3
"""
Watcher che monitora le modifiche ai file Python e rigenera automaticamente
i file di supporto (requirements.txt, etc.)
"""

import sys
import time
from pathlib import Path

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    print("Errore: il modulo 'watchdog' non è installato.")
    print("Installa con: pip install watchdog")
    sys.exit(1)

import subprocess

class PythonFileHandler(FileSystemEventHandler):
    def __init__(self, python_dir: Path):
        self.python_dir = python_dir
        self.last_generated = 0
    
    def on_modified(self, event):
        if event.is_directory:
            return
        
        file_path = Path(event.src_path)
        if file_path.suffix == '.py' and file_path.parent == self.python_dir:
            # Debounce: evita trigger multipli
            current_time = time.time()
            if current_time - self.last_generated < 1:
                return
            self.last_generated = current_time
            
            print(f"\n[WATCHER] Detected change in {file_path.name}")
            self.regenerate()
    
    def regenerate(self):
        """Esegue generate.py e sync.py per rigenerare e sincronizzare i file."""
        generate_script = self.python_dir / 'generate.py'
        sync_script = self.python_dir / 'sync.py'
        
        if generate_script.exists():
            print("[WATCHER] Running generate.py...")
            result = subprocess.run([sys.executable, str(generate_script)], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                print("[WATCHER] Generation complete.")
                if result.stdout:
                    print(result.stdout)
            else:
                print("[WATCHER] Error during generation:")
                print(result.stderr)
        else:
            print("[WATCHER] generate.py not found!")
            return
        
        if sync_script.exists():
            print("[WATCHER] Running sync.py...")
            result = subprocess.run([sys.executable, str(sync_script)], 
                                  capture_output=True, text=True)
            if result.returncode == 0:
                print("[WATCHER] Sync complete.")
                if result.stdout:
                    print(result.stdout)
            else:
                print("[WATCHER] Error during sync:")
                print(result.stderr)
        else:
            print("[WATCHER] sync.py not found!")

def main():
    python_dir = Path(__file__).parent
    print(f"[WATCHER] Monitoring {python_dir} for Python file changes...")
    print("[WATCHER] Press Ctrl+C to stop")
    
    event_handler = PythonFileHandler(python_dir)
    observer = Observer()
    observer.schedule(event_handler, str(python_dir), recursive=False)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == '__main__':
    main()
