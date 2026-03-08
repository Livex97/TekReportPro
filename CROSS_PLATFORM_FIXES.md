# CROSS_PLATFORM_FIXES

## Overview
This document outlines all cross-platform compatibility fixes implemented for macOS Apple Silicon (ARM64), Windows, and Linux.

## Implemented Fixes

### 1. Build & Configuration (Vite + Tauri)
- **Fixed Ports**: Set Vite server port to `1420` and HMR port to `1421` to ensure consistent communication between Tauri and the frontend across all OS.
- **Environment Prefixes**: Added `TAURI_` and `VITE_` prefixes to `envPrefix` for secure and correct environment variable handling.
- **Platform-Specific Targets**: Configured `build.target` in `vite.config.ts` to use `chrome105` for Windows and `safari13` (modern WKWebView) for others.

### 2. Native Persistence (Tauri Plugins)
- **Problem**: IndexedDB (`idb-keyval`) can be unreliable or difficult to manage across different desktop environments and webview versions.
- **Fix**: Replaced IndexedDB with `@tauri-apps/plugin-store` for metadata and `@tauri-apps/plugin-fs` for binary storage.
- **Data Location**: Files are now saved in the system's standard `AppData` (or equivalent) directory under a `templates` folder, ensuring proper OS integration and persistent storage.

### 3. File Handling & Dialogs
- **Problem**: The HTML5 `<input type="file">` element has inconsistent behavior and UI limitations across operating systems (macOS vs Windows vs Linux).
- **Fix**: Implemented native OS file dialogs using `@tauri-apps/plugin-dialog`. This provides a premium, native-feeling experience and bypasses webview input limitations.
- **Save As**: The document generation now uses a native "Save As" dialog, allowing users to choose the destination path directly on their filesystem.

### 4. PDF Parsing & Web Workers
- **Problem**: `pdfjs-dist` Web Workers often fail in production builds with "Unexpected token '<'" because the worker script is not correctly resolved or identified as a JS file.
- **Fix**: 
  - Optimized `workerSrc` initialization in `pdfParser.ts` using Vite's `?url` asset handling.
  - Ensured the worker script is correctly bundled into the `dist/assets` directory.
  - Wrapped worker initialization in a robust try-catch block to prevent app crashes on ARM64 if the worker fails initially.

### 5. Character Encoding
- **Optimization**: Standardized text extraction using UTF-8 aware libraries (`mammoth`, `pdfjs-dist`). The transition to native file reading via `plugin-fs` further ensures that binary data remains intact without browser-level encoding interference.

## Testing Procedures
1. **macOS ARM64**: Verify PDF parsing and native dialogs.
2. **Windows**: Check that the `chrome105` build target correctly handles all modern JS features.
3. **General**: Ensure templates are correctly saved/loaded from slots after app restart (Persistent Storage test).