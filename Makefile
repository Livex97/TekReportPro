.PHONY: help generate sync watch install install-dev build clean

help:
	@echo "Comandi disponibili:"
	@echo "  make generate    - Genera/aggiorna requirements.txt basandosi sulle importazioni"
	@echo "  make sync        - Sincrona i file Python da src-tauri/python/ (nessuna sync necessaria)"
	@echo "  make watch       - Avvia il watcher che rigenera automaticamente"
	@echo "  make install     - Installa le dipendenze da requirements.txt"
	@echo "  make install-dev - Installa dipendenze di sviluppo (watchdog)"
	@echo "  make build       - Crea l'eseguibile con PyInstaller e lo copia in src-tauri/binaries/"
	@echo "  make clean       - Pulisce i file di build"

generate:
	@echo "Generazione requirements.txt..."
	@python3 src-tauri/python/generate.py

sync:
	@echo "Sincronizzazione: tutti i file sono già in src-tauri/python/"

watch:
	@echo "Avvio watcher (rigenera automaticamente)..."
	@python3 src-tauri/python/watch.py

install:
	@echo "Installazione dipendenze..."
	@pip3 install -r src-tauri/python/requirements.txt

install-dev:
	@echo "Installazione dipendenze di sviluppo..."
	@pip3 install watchdog

build:
	@echo "Build binaries for the current platform..."
	@python3 src-tauri/python/build_binaries.py
	@echo "Build complete!"

clean:
	@echo "Pulizia..."
	@rm -rf build dist
