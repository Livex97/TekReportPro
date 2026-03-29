import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Upload, Search, Plus, FileSpreadsheet, X, ArrowLeft, CheckCircle, Save } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { saveExcelFile, getExcelFile, getExcelFileBuffer, getExcelFilePath, saveExcelDataJson, getExcelDataJson, getExcelFileName, getSetting, setSetting } from './utils/storage';

import { save } from '@tauri-apps/plugin-dialog';

// --- Types ---
interface DataRow {
  _id: number;
  _new?: boolean;
  [key: string]: any;
}

interface SterlinkManagerPageProps {
  onFileSelected?: (name: string, path: string | null) => void;
}

type ViewState = 'upload' | 'table';

interface MultiEntryEditorProps {
  value: string;
  onChange?: (val: string) => void;
}

// --- Global Helpers ---
function isMultiEntryValue(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  const strVal = String(value);
  return /^\d+\.\s/.test(strVal) && (strVal.includes('\n') || strVal.includes('\\n'));
}

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type} animate-in fade-in slide-in-from-right-4 duration-300`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-4');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function parseMultiEntry(val: string): { idx: number; value: string }[] {
  if (!val) return [];
  const normalized = val.replace(/\\n/g, '\n');
  const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
  const entries: { idx: number; value: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d+)\.\s*(.*)$/);
    if (m) {
      entries.push({ idx: parseInt(m[1], 10) - 1, value: m[2].trim() });
    } else if (entries.length) {
      entries[entries.length - 1].value += ' ' + lines[i];
    }
  }
  return entries;
}

function formatMultiEntry(entries: { idx: number; value: string }[]): string {
  return entries.map((e, i) => `${i + 1}. ${e.value}`).join('\n');
}

// --- Sub-components ---
function MultiEntryEditor({ value, onChange }: MultiEntryEditorProps) {
  const [entries, setEntries] = useState<{ idx: number; value: string }[]>(() => parseMultiEntry(value));

  const updateEntry = (index: number, newValue: string) => {
    const next = [...entries];
    next[index] = { ...next[index], value: newValue };
    setEntries(next);
    if (onChange) onChange(formatMultiEntry(next));
  };

  const addEntry = () => {
    const next = [...entries, { idx: entries.length, value: '' }];
    setEntries(next);
    if (onChange) onChange(formatMultiEntry(next));
  };

  const removeEntry = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    setEntries(next);
    if (onChange) onChange(formatMultiEntry(next));
  };

  return (
    <div className="multi-entry-editor flex flex-col gap-3">
      <div className="entries-list flex flex-col gap-2">
        {entries.map((entry, idx) => (
          <div key={idx} className="entry-edit-slot flex items-center gap-3 p-2 bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-neutral-100 dark:border-neutral-800" data-idx={Math.min(idx, 4)}>
            <span className="w-6 h-6 flex items-center justify-center bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded-full text-[10px] font-bold">
              {idx + 1}
            </span>
            <input
              type="text"
              className="flex-1 bg-transparent border-none text-sm outline-none focus:ring-0 placeholder-neutral-400"
              value={entry.value}
              onChange={e => updateEntry(idx, e.target.value)}
              placeholder="Inserisci testo..."
            />
            <button
              type="button"
              className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
              onClick={() => removeEntry(idx)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <button 
        type="button" 
        className="flex items-center gap-2 px-3 py-1.5 w-fit text-xs font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg transition-all uppercase tracking-wider"
        onClick={addEntry}
      >
        <Plus className="w-3.5 h-3.5" />
        Aggiungi condizione
      </button>
    </div>
  );
}

// --- Main Page ---
export default function SterlinkManagerPage({ onFileSelected }: SterlinkManagerPageProps) {
  const [view, setView] = useState<ViewState>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState<DataRow | null>(null);
  const [isNewRow, setIsNewRow] = useState(false);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [modified, setModified] = useState(false);
  const nextIdRef = useRef(1);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Initial Data Loading (Once on mount)
  useEffect(() => {
    const loadPersistentData = async () => {
      try {
        const jsonData = await getExcelDataJson('sterlink');
        const path = await getExcelFilePath('sterlink');
        const name = await getExcelFileName('sterlink');
        const headersMeta = await getSetting<string[]>('sterlink_headers', []);
        
        if (path) setOriginalPath(path);
        if (name) setFileName(name);
        
        if (jsonData && jsonData.length > 0 && headersMeta.length > 0) {
          setRows(jsonData);
          setHeaders(headersMeta);
          setView('table');
          setLoadedAt(new Date().toLocaleString('it-IT'));
          // Find max ID
          const maxId = jsonData.reduce((max, r) => Math.max(max, r._id || 0), 0);
          nextIdRef.current = maxId + 1;
        } else {
          // Fallback to Excel if JSON not found but Excel index is
          const file = await getExcelFile('sterlink');
          if (file) {
            const buffer = await file.arrayBuffer();
            parseExcel(buffer, file.name);
          }
        }
      } catch (err) {
        console.error('Error loading persistent data:', err);
      }
    };
    loadPersistentData();
  }, []);

  // 2. Drag & Drop Event Listeners
  useEffect(() => {
    let unlistenEnter: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;
    let unlistenDrop: (() => void) | null = null;

    const setup = async () => {
      unlistenEnter = await listen('tauri://drag-enter', () => {
        if (view === 'upload') setIsDragging(true);
      });
      unlistenLeave = await listen('tauri://drag-leave', () => {
        setIsDragging(false);
      });
      unlistenDrop = await listen('tauri://drag-drop', async (event: any) => {
        setIsDragging(false);
        if (view !== 'upload') return;
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          const path = paths[0];
          const name = path.split(/[/\\]/).pop() || 'excel_file.xlsx';
          try {
            const content = await readFile(path);
            await parseExcel(content.buffer, name, path);
            if (onFileSelected) onFileSelected(name, path);
          } catch (err) {
            console.error('Error reading dropped file:', err);
            showToast('Errore nel caricamento del file', 'error');
          }
        }
      });
    };

    setup();

    return () => {
      if (unlistenEnter) unlistenEnter();
      if (unlistenLeave) unlistenLeave();
      if (unlistenDrop) unlistenDrop();
    };
  }, [view]);

  // --- Logic Functions ---

  const readExcelFile = (file: File, path?: string | null) => {
    if (path) setOriginalPath(path);
    saveExcelFile('sterlink', file, path).catch(err => console.error('Error saving file:', err));
    if (onFileSelected) onFileSelected(file.name, path || null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      parseExcel(buffer, file.name, path);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseExcel = async (buffer: ArrayBuffer, fileName: string, path?: string | null) => {
    try {
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, dateNF: 'dd/mm/yyyy' }) as any[][];

      if (!raw || raw.length < 1) {
          showToast('File vuoto o non leggibile', 'error');
          return;
      }

      const headerNames = raw[0].map(h => String(h || ''));
      const dataRows = raw.slice(1).filter(r => r.length > 0).map((r, ri) => {
        const obj: DataRow = { _id: ri + 1 };
        headerNames.forEach((h, ci) => {
            obj[h] = r[ci];
        });
        return obj;
      });

      setHeaders(headerNames);
      setRows(dataRows);
      setFileName(fileName);
      setOriginalPath(path || null);
      setLoadedAt(new Date().toLocaleString('it-IT'));
      setView('table');
      setModified(false);
      nextIdRef.current = dataRows.length + 1;
      
      // Save metadata
      await setSetting('sterlink_headers', headerNames);
      await setSetting('sterlink_original_rows_count', dataRows.length);
      await saveExcelDataJson('sterlink', dataRows);
      
      showToast('File caricato con successo', 'success');
    } catch (err) {
      console.error('Error parsing excel:', err);
      showToast('Errore nel caricamento del file Excel', 'error');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readExcelFile(file);
  };

  const handleAddRow = () => {
    const newRow: DataRow = { _id: nextIdRef.current++, _new: true };
    headers.forEach(h => newRow[h] = '');
    setModalData(newRow);
    setIsNewRow(true);
    setIsModalOpen(true);
  };

  const deleteRow = (id: number) => {
    setRows(prev => prev.filter(r => r._id !== id));
    setModified(true);
  };

  const openEdit = (id: number) => {
    const row = rows.find(r => r._id === id);
    if (!row) return;
    setModalData({ ...row });
    setIsNewRow(false);
    setIsModalOpen(true);
  };

  const saveModalRow = () => {
    if (!modalData) return;
    setRows(prev => {
      const updated = isNewRow 
        ? [...prev, modalData] 
        : prev.map(r => r._id === modalData._id ? modalData : r);
      saveExcelDataJson('sterlink', updated);
      return updated;
    });
    setIsModalOpen(false);
    setModified(true);
    showToast(isNewRow ? 'Nuova riga aggiunta' : 'Riga aggiornata', 'success');
  };

  const updateModalField = (header: string, val: string) => {
    setModalData(prev => prev ? { ...prev, [header]: val } : null);
  };

  const saveToExcel = async () => {
    if (!rows.length) {
      showToast('Nessun dato da salvare', 'error');
      return;
    }

    try {
      const origBuffer = await getExcelFileBuffer('sterlink');
      if (!origBuffer) {
        showToast('File originale non trovato. Carica nuovamente il file.', 'error');
        return;
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(origBuffer);
      const worksheet = workbook.worksheets[0];
      
      const originalRowsCount = await getSetting<number>('sterlink_original_rows_count', 0);
      const headerNames = await getSetting<string[]>('sterlink_headers', headers);
      
      // Task 43: Update Existing Rows & Append New Ones
      rows.forEach((row, ri) => {
        const rowIdx = ri + 1; // logical index
        if (!row._new && rowIdx <= originalRowsCount) {
          // Update existing row
          const xlRow = worksheet.getRow(rowIdx + 1); // +1 for header
          headerNames.forEach((h, ci) => {
            xlRow.getCell(ci + 1).value = row[h] ?? '';
          });
        } else {
          // New row: add manually and copy styles from previous row to maintain parity
          const prevRow = worksheet.getRow(worksheet.lastRow ? worksheet.lastRow.number : ri + 1);
          const newRowNumber = (worksheet.lastRow ? worksheet.lastRow.number : ri + 1) + 1;
          const newXlRow = worksheet.getRow(newRowNumber);
          
          headerNames.forEach((h, ci) => {
            const cell = newXlRow.getCell(ci + 1);
            cell.value = row[h] ?? '';
            // Copy base style accurately
            const prevCell = prevRow.getCell(ci + 1);
            if (prevCell && prevCell.style) {
              cell.style = { ...prevCell.style };
            }
          });
        }
      });

      // Clear AutoFilter to prevent Table corruption (Task 43 fix)
      worksheet.autoFilter = undefined;

      const buffer = await workbook.xlsx.writeBuffer();
      
      // Update local cache and state
      await saveExcelDataJson('sterlink', rows);
      
      let userPath = originalPath;
      if (!userPath) {
        userPath = await save({
          defaultPath: (fileName || 'sterlink_export').replace(/\.(xlsx|xls)$/i, '') + '_aggiornato.xlsx',
          filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
        });
      }

      if (userPath) {
        // Save to source (now sync logic handles it inside saveExcelFile)
        await saveExcelFile('sterlink', new File([buffer], fileName || 'export.xlsx'), userPath);
        if (userPath !== originalPath) {
          setOriginalPath(userPath);
          if (onFileSelected) onFileSelected(fileName || 'export.xlsx', userPath);
        }
        setModified(false);
        showToast('Sincronizzazione completata!', 'success');
      } else {
        // Fallback save to internal cache only
        await saveExcelFile('sterlink', new File([buffer], fileName || 'export.xlsx'), originalPath);
        showToast('Copia aggiornata salvata in locale (AppData)', 'info');
      }
    } catch (err) {
      console.error('Error saving excel:', err);
      showToast('Errore durante il salvataggio', 'error');
    }
  };

  const getFilteredSortedRows = () => {
    let result = [...rows];
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter(r => 
        Object.values(r).some(v => String(v).toLowerCase().includes(q))
      );
    }
    if (sortCol !== null) {
      const h = headers[sortCol];
      result.sort((a, b) => {
        const va = String(a[h] || '');
        const vb = String(b[h] || '');
        return va.localeCompare(vb, 'it', { numeric: true }) * sortDir;
      });
    }
    return result;
  };

  const handleSort = (idx: number) => {
    if (sortCol === idx) {
      setSortDir(prev => prev === 1 ? -1 : 1);
    } else {
      setSortCol(idx);
      setSortDir(1);
    }
  };

  const renderCellValue = (value: any, header: string, query: string) => {
    if (value === null || value === undefined || value === '') return <span className="cell-null">—</span>;
    const strVal = String(value);
    if (isMultiEntryValue(strVal)) return renderMultiEntry(strVal, query, header);
    
    let display = strVal;
    if (query && strVal.toLowerCase().includes(query.toLowerCase())) {
      const re = new RegExp(`(${query})`, 'gi');
      display = strVal.replace(re, '<mark class="highlight">$1</mark>');
    }
    
    const isDate = header.toLowerCase().includes('data');
    const isSerial = header.toUpperCase().includes('SERIALE');
    let className = 'cell-content';
    if (isSerial) className += ' cell-serial';
    else if (isDate) className += ' cell-date';
    
    return <div className={className} dangerouslySetInnerHTML={{ __html: display }} />;
  };

  const renderMultiEntry = (val: string, query: string, colHeader: string) => {
    const entries = parseMultiEntry(val);
    return (
      <div className="multi-entries flex flex-col gap-1.5 py-1">
        {entries.map((e, idx) => {
          const isNA = !e.value || e.value.toUpperCase() === 'NA' || e.value === 'N/A';
          let text = isNA ? 'N/D' : e.value;
          if (query && text.toLowerCase().includes(query.toLowerCase())) {
            const re = new RegExp(`(${query})`, 'gi');
            text = text.replace(re, '<mark class="highlight">$1</mark>');
          }
          const isDate = colHeader.toLowerCase().includes('data');
          return (
            <div key={idx} className="entry-slot flex items-center gap-2 group/entry" data-idx={Math.min(idx, 4)}>
              <div className="entry-dot w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[var(--dot-color)] shadow-[0_0_8px_var(--dot-color)] opacity-70" />
              <span className={`text-[11px] font-medium leading-relaxed ${isNA ? 'text-neutral-400 italic' : isDate ? 'text-amber-600' : 'text-neutral-600 dark:text-neutral-300'}`} dangerouslySetInnerHTML={{ __html: text }} />
            </div>
          );
        })}
      </div>
    );
  };

  const displayedRows = getFilteredSortedRows();

  return (
    <div className="flex flex-col bg-neutral-50 dark:bg-neutral-900 min-h-full">
      <style>{`
        .highlight { background: #fde047; color: #000; padding: 0 2px; border-radius: 2px; }
        .cell-content { font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; min-width: 140px; padding: 8px 0; }
        .cell-null { color: #9ca3af; font-style: italic; }
        .cell-serial { font-weight: 800; color: #10b981; }
        .cell-date { color: #f59e0b; font-weight: 600; }
        .entry-slot[data-idx="0"] { --dot-color: #3b82f6; }
        .entry-slot[data-idx="1"] { --dot-color: #10b981; }
        .entry-slot[data-idx="2"] { --dot-color: #f59e0b; }
        .entry-slot[data-idx="3"] { --dot-color: #a855f7; }
        .entry-slot[data-idx="4"] { --dot-color: #ef4444; }
        .toast { padding: 12px 20px; border-radius: 12px; font-size: 14px; font-weight: bold; color: white; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); display: flex; align-items: center; gap: 8px; }
        .toast.success { background: #10b981; }
        .toast.error { background: #ef4444; }
        .toast.info { background: #3b82f6; }
      `}</style>

      {/* Upload View */}
      {view === 'upload' && (
        <div className="flex-1 flex flex-col items-center justify-center py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Sterlink Manager</h2>
            <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
              Carica un file Excel con il log degli interventi Sterlink per visualizzarli in formato tabella e modificarli.
            </p>
          </div>

          <div
            className={`w-full max-w-3xl p-16 text-center border-2 border-dashed rounded-3xl transition-all duration-300 cursor-pointer shadow-sm
              ${isDragging 
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 scale-[1.02] shadow-xl shadow-primary-500/10' 
                : 'border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-primary-500 hover:shadow-lg hover:shadow-primary-500/5'
              }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) readExcelFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx,.xls" onChange={handleFileSelect} />
            <div className="w-24 h-24 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-8 transition-transform group-hover:scale-110">
              <FileSpreadsheet className="w-12 h-12 text-primary-600" />
            </div>
            <h3 className="text-3xl font-bold mb-3 text-neutral-900 dark:text-white">Trascina qui il file Excel</h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-8 max-w-md mx-auto text-lg leading-relaxed">
              Puoi anche cliccare ovunque in quest'area per sfogliare i file nel tuo computer.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <div className="px-4 py-2 bg-neutral-100 dark:bg-neutral-700/50 rounded-xl text-xs font-bold text-neutral-500 flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5" /> Supporta .xlsx, .xls
              </div>
              <div className="px-4 py-2 bg-neutral-100 dark:bg-neutral-700/50 rounded-xl text-xs font-bold text-neutral-500 flex items-center gap-2">
                <CheckCircle className="w-3.5 h-3.5" /> Lettura celle formattate
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table View */}
      {view === 'table' && (
        <div className="flex-1 flex flex-col p-6 animate-in fade-in duration-500 overflow-hidden">
          
          {/* Header Section */}
          <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-100 dark:border-neutral-800">
                <FileSpreadsheet className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h3 className="text-xl font-black text-neutral-900 dark:text-white flex items-center gap-2">
                  {fileName}
                  {modified && <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" title="Modifiche non salvate" />}
                </h3>
                <p className="text-xs text-neutral-500 font-medium">Caricato il: {loadedAt}</p>
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={saveToExcel} 
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-lg shadow-primary-500/10 transition-all flex items-center gap-2 text-sm font-bold"
              >
                <Save className="w-4 h-4" />
                Salva Modifiche
              </button>
              <button 
                onClick={() => setView('upload')} 
                className="px-4 py-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-all flex items-center gap-2 text-sm font-bold"
              >
                <Upload className="w-4 h-4" />
                Ricarica file
              </button>
            </div>
          </div>

          {/* Toolbar - Matching Pandetta Layout (Task 45) */}
          <div className="mb-6 flex flex-wrap items-center gap-3 p-4 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-neutral-400" />
              <input 
                type="text" 
                placeholder="Cerca in tutte le colonne..." 
                className="w-full pl-11 pr-4 py-2.5 bg-neutral-50 dark:bg-neutral-900 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="h-8 w-px bg-neutral-200 dark:bg-neutral-700 mx-1 hidden sm:block" />
            
            <button 
              onClick={handleAddRow}
              className="px-4 py-2.5 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-xl text-xs font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Aggiungi Riga
            </button>
            
            <div className="flex items-center gap-2 ml-auto text-xs font-bold text-neutral-500">
              <div className="px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg">
                <span className="text-neutral-900 dark:text-neutral-200">{displayedRows.length}</span> Righe
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 bg-white dark:bg-neutral-800 rounded-3xl shadow-sm border border-neutral-100 dark:border-neutral-800 overflow-hidden flex flex-col">
            <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr className="bg-neutral-50/80 dark:bg-neutral-900/50 backdrop-blur-sm sticky top-0 z-10 border-b border-neutral-100 dark:border-neutral-800">
                    <th className="px-6 py-5 first:rounded-tl-3xl last:rounded-tr-3xl">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">#</div>
                    </th>
                    {headers.map((h, i) => (
                      <th 
                        key={i} 
                        className="px-6 py-5 cursor-pointer group/th"
                        onClick={() => handleSort(i)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 group-hover/th:text-primary-600 transition-colors">
                            {h}
                          </span>
                          {sortCol === i && (
                            <div className={`w-1.5 h-1.5 rounded-full bg-primary-500 ${sortDir === 1 ? 'animate-bounce' : ''}`} />
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="px-6 py-5 text-right w-20 sticky right-0 bg-neutral-50/80 dark:bg-neutral-900/50">
                       <div className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Azioni</div>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 dark:divide-neutral-900">
                  {displayedRows.length > 0 ? (
                    displayedRows.map((row, ri) => (
                      <tr key={row._id} className="group hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <span className="text-xs font-bold text-neutral-400">#{ri + 1}</span>
                        </td>
                        {headers.map((h, ci) => (
                          <td key={ci} className="px-6 py-4" onClick={() => openEdit(row._id)}>
                            {renderCellValue(row[h], h, searchTerm)}
                          </td>
                        ))}
                        <td className="px-6 py-4 sticky right-0 bg-white dark:bg-neutral-800 group-hover:bg-neutral-50 dark:group-hover:bg-neutral-850 transition-colors">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => openEdit(row._id)}
                              className="p-1.5 text-neutral-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-all"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => deleteRow(row._id)}
                              className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={headers.length + 2} className="px-6 py-24 text-center">
                        <Search className="w-12 h-12 text-neutral-200 dark:text-neutral-700 mx-auto mb-4" />
                        <p className="text-neutral-500 font-medium">Nessuna riga trovata con i filtri attuali</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Persistence Info Footer */}
      {view === 'table' && originalPath && (
        <div className="px-6 py-3 bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-hidden">
            <ArrowLeft className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest flex-shrink-0">Percorso Source:</span>
            <span className="text-[10px] text-neutral-500 truncate font-mono bg-white dark:bg-neutral-800 px-2 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">{originalPath}</span>
          </div>
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest whitespace-nowrap">
            Status: {modified ? 'Modifiche non salvate' : 'Sincronizzato'}
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {isModalOpen && modalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-neutral-800 w-full max-w-4xl max-h-[90vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            {/* Modal Header */}
            <div className="px-8 py-6 border-b border-neutral-100 dark:border-neutral-700 flex justify-between items-center bg-neutral-50/50 dark:bg-neutral-800/50">
              <div>
                <h3 className="text-xl font-black text-neutral-900 dark:text-white">
                  {isNewRow ? 'Aggiungi Nuova Riga' : 'Modifica Intervento'}
                </h3>
                <p className="text-xs text-neutral-500 font-medium">Identificativo riga: #{modalData._id}</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-all"
              >
                <X className="w-6 h-6 text-neutral-400" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {headers.map((h) => {
                  const val = modalData[h];
                  const isMulti = isMultiEntryValue(val);
                  
                  return (
                    <div key={h} className="flex flex-col gap-2">
                      <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">
                        {h}
                      </label>
                      {isMulti ? (
                        <MultiEntryEditor
                          value={String(val)}
                          onChange={(newVal) => updateModalField(h, newVal)}
                        />
                      ) : (
                        <textarea
                          className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none resize-none min-h-[44px]"
                          value={val ?? ''}
                          rows={1}
                          onChange={(e) => {
                            const target = e.target;
                            target.style.height = 'auto';
                            target.style.height = target.scrollHeight + 'px';
                            updateModalField(h, target.value);
                          }}
                          onFocus={(e) => {
                             const target = e.target as HTMLTextAreaElement;
                             target.style.height = 'auto';
                             target.style.height = target.scrollHeight + 'px';
                          }}
                          placeholder={`Inserisci ${h.toLowerCase()}...`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-6 border-t border-neutral-100 dark:border-neutral-700 flex justify-end gap-3 bg-neutral-50/50 dark:bg-neutral-800/50">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-3 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-200 font-bold rounded-2xl hover:bg-neutral-50 dark:hover:bg-neutral-650 transition-all text-sm"
              >
                Annulla
              </button>
              <button 
                onClick={saveModalRow}
                className="px-8 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-2xl shadow-lg shadow-primary-500/20 transition-all text-sm flex items-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Conferma Modifiche
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Container */}
      <div id="toast-container" className="fixed bottom-8 right-8 flex flex-col gap-2 z-[9999]"></div>
    </div>
  );
}