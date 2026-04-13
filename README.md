# 📋 TekReport Pro

> **Applicazione desktop** per la compilazione automatica di rapportini tecnici, disponibile su **Windows**, **macOS** (Intel e Apple Silicon) e **Linux**.

---

## 📖 Descrizione

**TekReport Pro** permette di:
- **Caricare** fino a tre template DOCX personalizzati.
- **Estrarre** i segnaposti `{CAMPO}` presenti nei template.
- **Importare** dati da PDF (DDT, ordini, ecc.) e compilare automaticamente i campi corrispondenti.
- **Gestire** checkbox native di Word e aggiungere righe dinamiche per articoli aggiuntivi.
- **Salvare** localmente i template mediante IndexedDB (archiviazione offline).
- **Generare** il documento finale in formato DOCX pronto per stampa o invio.

L’intera elaborazione avviene **offline**, senza inviare dati a server esterni.

---

## ✨ Funzionalità principali

| Funzione | Descrizione |
|---|---|
| 📁 **Gestione template** | Carica e salva fino a tre template DOCX in slot predefiniti. |
| 🔍 **Estrazione campi** | Rileva automaticamente tutti i segnaposti `{CAMPO}` nel template. |
| 📄 **Import da PDF** | Legge DDT/ordini PDF e compila i campi corrispondenti. |
| ☑️ **Checkbox Word** | Gestisce le checkbox native di Word come opzioni selezionabili. |
| 📝 **Righe dinamiche** | Aggiunge automaticamente righe articolo se il PDF contiene più voci del template. |
| 💾 **Persistenza locale** | I template sono salvati in IndexedDB e disponibili ad ogni avvio. |
| ⬇️ **Export DOCX** | Genera e scarica il rapportino compilato in formato Word. |

---

## 💻 Download e installazione

Vai alla sezione **Releases** del repository e scarica l’installer per il tuo sistema operativo:

| Sistema operativo | File da scaricare |
|---|---|
| **Windows** | `TekReportPro_x.x.x_x64.msi` o `.exe` |
| **macOS (Apple Silicon)** | `TekReportPro_x.x.x_aarch64.dmg` |
| **macOS (Intel)** | `TekReportPro_x.x.x_x64.dmg` |
| **Linux (Ubuntu/Debian)** | `TekReportPro_x.x.x_amd64.deb` |
| **Linux (generico)** | `TekReportPro_x.x.x_amd64.AppImage` |

> **Nota macOS**: se compare l’avviso “Apple non può verificare questa app”, apri **Impostazioni di Sistema → Privacy e Sicurezza** e scegli **“Apri comunque”**.

> **Nota Linux (AppImage)**: rendi il file eseguibile con `chmod +x TekReportPro_*.AppImage` prima di avviarlo.

---

## 🚀 Guida all’utilizzo

### 1️⃣ Prima configurazione – Carica i template
1. Avvia l’app.
2. Apri **⚙️ Impostazioni** (icona ingranaggio in alto a destra).
3. Troverai tre slot per i template; per ciascuno clicca **Upload** e seleziona il file `.docx`.
4. Dopo il caricamento, lo slot mostrerà il nome del file.

> I template sono salvati localmente e saranno disponibili ad ogni riapertura dell’app.

### 2️⃣ Schermata Home – Seleziona il template
1. Nella schermata principale, scegli il template desiderato.
2. L’app ti porterà automaticamente al modulo di compilazione.

### 3️⃣ Compilazione del modulo
#### • Manuale
- I campi estratti dal template compaiono come caselle di testo.
- Le checkbox native di Word sono presentate come selettori.
- Compila i valori e premi **Genera DOCX**.

#### • Auto‑compilazione da PDF
1. Nella schermata del modulo, premi **Carica PDF**.
2. Seleziona il DDT o l’ordine da cui estrarre i dati.
3. L’app legge il PDF e compila automaticamente:
   - Ragione sociale, indirizzo, CAP, città del destinatario
   - Numero richiesta/DDT e data
   - Reparto/ambulatorio di destinazione
   - Elenco articoli (descrizione, quantità) – con aggiunta di righe se necessario
4. Verifica e correggi eventuali valori errati.
5. Premi **Genera DOCX** per scaricare il documento finale.

### 4️⃣ Download del rapportino
- Il file verrà salvato nella cartella **Download** con nome basato sul template scelto.

---

## 🛠️ Sviluppo locale

### Prerequisiti
- **Node.js** v18 o superiore
- **Rust** (toolchain stabile) – `rustup toolchain install stable`
- **Linux**: dipendenze di sistema per WebKit (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`)

### Avvio in modalità sviluppo
```bash
# Clona il repository
git clone https://github.com/YourOrg/TekReportPro.git
cd TekReportPro

# Installa le dipendenze Node
npm install

# Avvia con hot‑reload
npm run tauri dev
```

### Compilazione per distribuzione
```bash
# Genera gli installer per la piattaforma corrente
npm run tauri build
```
Gli installer verranno creati in `src-tauri/target/release/bundle/`.

---

## 🤖 Build automatiche (GitHub Actions)

Il repository contiene un workflow **GitHub Actions** che compila l’app per tutte le piattaforme.

### Creare una nuova release
1. Accertati che tutte le modifiche siano commitate su `main`.
2. Crea un tag di versione, ad esempio `v1.2.0`:
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
3. Il workflow partirà automaticamente e, al termine (~15‑20 min), creerà una **Draft Release** con gli installer allegati.
4. Aggiungi note di rilascio e pubblica la release.

---

## 📁 Struttura del progetto
```
TekReportPro/
├─ src/                     # Codice React + TypeScript
│   ├─ App.tsx
│   ├─ utils/               # Parser DOCX, PDF, ecc.
│   └─ …
├─ src-tauri/               # Configurazione e codice Rust (Tauri)
│   ├─ tauri.conf.json
│   ├─ icons/
│   └─ src/
├─ .github/
│   └─ workflows/
│       └─ build-tauri.yml
├─ public/                  # Asset statici
└─ index.html               # Entry point HTML
```

---

## 📄 Licenza

Questo progetto è distribuito sotto licenza **MIT**. Vedi il file `LICENSE` per i dettagli.
