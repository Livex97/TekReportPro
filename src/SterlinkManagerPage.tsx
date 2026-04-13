import { useState, useCallback, useEffect, useMemo } from 'react';
import { FileSpreadsheet, Upload, Search, X, Plus, CheckCircle, AlertCircle, Edit2, Trash2, Loader2, ArrowLeft, Save } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { save, open, ask } from '@tauri-apps/plugin-dialog';
import { saveExcelFile, getExcelFile, getExcelFilePath, saveExcelDataJson, getExcelDataJson, getExcelFileName, getSetting, setSetting, getExcelFileHash, setExcelFileHash } from './utils/storage';
import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';

// --- Types ---
interface SterlinkRow {
  [key: string]: any;
  _empty: boolean;
  _new?: boolean;
}

interface SterlinkManagerPageProps {
  onFileSelected?: (name: string, path: string | null) => void;
  className?: string;
}

type ViewState = 'upload' | 'table';

// --- Global Helpers ---
function isMultiEntryValue(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  const strVal = String(value);
  return /^\d+\.\s/.test(strVal) && (strVal.includes('\n') || strVal.includes('\\n'));
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
interface MultiEntryEditorProps {
  value: string;
  onChange?: (val: string) => void;
}

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
          <div key={idx} className="entry-edit-slot flex items-center gap-3 p-2 bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-neutral-100 dark:border-neutral-800">
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
export default function SterlinkManagerPage({ onFileSelected, className = '' }: SterlinkManagerPageProps) {
  const [view, setView] = useState<ViewState>('upload');
  const [rows, setRows] = useState<SterlinkRow[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [fileName, setFileName] = useState('Sterlink_Installate.xlsx');
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' | 'loading' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
   const [dynamicCols, setDynamicCols] = useState<string[]>([]);
   const [originalFileHash, setOriginalFileHash] = useState<string | null>(null);
   const [showExternalUpdateBanner, setShowExternalUpdateBanner] = useState(false);
   const [lastNotifiedExternalHash, setLastNotifiedExternalHash] = useState<string | null>(null);
   const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [originalRows, setOriginalRows] = useState<SterlinkRow[]>([]);
    const AUTO_REFRESH_INTERVAL = 8000;

    const calculateFileHash = async (filePath: string): Promise<string | null> => {
      try {
        const fileContent = await readFile(filePath);
        const bytes = new Uint8Array(fileContent);
        let hash = 0;
        for (let i = 0; i < bytes.length; i++) {
          hash = ((hash << 5) - hash) + bytes[i];
          hash |= 0;
        }
        return `${hash}-${bytes.length}`;
      } catch (err) {
        console.error('Error calculating file hash:', err);
        return null;
      }
    };

    useEffect(() => {
      const loadPersistentData = async () => {
        try {
          const jsonData = await getExcelDataJson('sterlink');
          const path = await getExcelFilePath('sterlink');
          const name = await getExcelFileName('sterlink');

          if (path) {
            setOriginalPath(path);
            // Controlla se esiste un hash persisitente precedentemente salvato
            const persistedHash = await getExcelFileHash('sterlink');
            if (persistedHash) {
              setOriginalFileHash(persistedHash);
            } else {
              // Altrimenti calcola l'hash del file corrente
              const hash = await calculateFileHash(path);
              if (hash) {
                setOriginalFileHash(hash);
                // Salva l'hash persistente per confronti futuri
                await setExcelFileHash('sterlink', hash);
              }
            }
          }
          if (name) setFileName(name);

          if (jsonData && jsonData.length > 0) {
            setRows(jsonData);
            setOriginalRows(jsonData);
            setHasUnsavedChanges(false);

            const savedCols = await getSetting<string[]>('sterlink_dynamic_cols', []);
            if (savedCols.length > 0) {
              setDynamicCols(savedCols);
            } else {
              const cols = Object.keys(jsonData[0]).filter(k => !k.startsWith('_'));
              setDynamicCols(cols);
            }
            setView('table');
          } else {
            const file = await getExcelFile('sterlink');
            if (file) {
              const buffer = await file.arrayBuffer();
              const wb = new ExcelJS.Workbook();
              await wb.xlsx.load(buffer);
              await parseSheet(wb);
              setView('table');
            }
          }
        } catch (err) {
          console.error('Error loading persistent data:', err);
        }
      };
      loadPersistentData();
    }, []);

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
            try {
              const filePath = paths[0];
              const content = await readFile(filePath);
              const name = filePath.split(/[/\\]/).pop() || 'file';
              handleFile(new File([content], name), filePath);
            } catch (err) {
              console.error('Drag-drop error:', err);
              toast('Errore nel caricamento file', 'error');
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

    useEffect(() => {
          if (!originalPath || originalFileHash === null) return;
          let mounted = true;
          const interval = setInterval(() => {
            (async () => {
              if (!originalPath) return;
              try {
                const currentHash = await calculateFileHash(originalPath);
                if (currentHash && currentHash !== originalFileHash && currentHash !== lastNotifiedExternalHash) {
                  if (mounted) {
                    setLastNotifiedExternalHash(currentHash);
                    setShowExternalUpdateBanner(true);
                    toast('Il file originale è stato modificato esternamente', 'info');
                  }
                }
              } catch (err) { }
            })();
          }, AUTO_REFRESH_INTERVAL);
        return () => {
          mounted = false;
          clearInterval(interval);
        };
      }, [originalPath, originalFileHash, lastNotifiedExternalHash]);

      const toast = (text: string, type: 'success' | 'error' | 'info' | 'loading' = 'info') => {
        setToastMsg({ text, type });
        if (type !== 'loading') {
          setTimeout(() => setToastMsg(null), 3000);
        }
      };

      const reloadFromExternal = async () => {
        if (!originalPath) return;
        try {
          const content = await readFile(originalPath);
          const file = new File([content], fileName);
          await handleFile(file, originalPath);
          toast('File ricaricato con le modifiche esterne', 'success');
        } catch (err) {
          console.error('Error reloading external file:', err);
          toast('Errore nel ricaricare il file', 'error');
        }
      };

  const handleFile = async (file: File, path?: string | null) => {
    setFileName(file.name);
    if (path) setOriginalPath(path);
    if (onFileSelected) onFileSelected(file.name, path || null);
    await saveExcelFile('sterlink', file, path).catch(err => console.error('Error saving file:', err));

if (path) {
        const hash = await calculateFileHash(path);
        if (hash) {
          setOriginalFileHash(hash);
          await setExcelFileHash('sterlink', hash);
        }
        setShowExternalUpdateBanner(false);
      }

    try {
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      await parseSheet(wb);
      setView('table');
      toast(`File caricato: ${file.name}`, 'success');
    } catch (err: any) {
      toast(`Errore nel caricamento: ${err.message}`, 'error');
    }
  };

  const formatDate = (d: any) => {
    if (!d) return null;
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${dt.getFullYear()}`;
  };

  const parseSheet = async (wb: any) => {
    const ws = wb.worksheets[0]; // Prendi il primo foglio per Sterlink
    const headerRow = ws.getRow(1);
    const colCount = headerRow.cellCount;

    const cols: string[] = [];
    const colIndices: number[] = [];

    for (let c = 1; c <= colCount; c++) {
      const cell = headerRow.getCell(c);
      const header = cell.value;
      if (header != null && String(header).trim() !== '') {
        cols.push(String(header).trim());
        colIndices.push(c - 1);
      }
    }

    if (cols.length === 0) throw new Error('Impossibile identificare le colonne');

    setDynamicCols(cols);
    const newRows: SterlinkRow[] = [];
    const rowCount = ws.rowCount;

    for (let r = 2; r <= rowCount; r++) {
      const xlRow = ws.getRow(r);
      let hasData = false;
      for (let i = 0; i < Math.min(3, cols.length); i++) {
        const cell = xlRow.getCell(colIndices[i] + 1);
        const val = cell.value;
        if (val != null && val !== '' && val !== 'null') {
          hasData = true;
          break;
        }
      }

      if (!hasData) {
        const emptyRow: SterlinkRow = { _empty: true };
        for (const col of cols) emptyRow[col] = null;
        newRows.push(emptyRow);
        continue;
      }

      const row: SterlinkRow = { _empty: false };
      for (let idx = 0; idx < cols.length; idx++) {
        const col = cols[idx];
        const cell = xlRow.getCell(colIndices[idx] + 1);
        let value = cell.value;
        if (value instanceof Date) value = formatDate(value);
        else if (value !== null && value !== undefined) value = String(value);
        else value = null;
        row[col] = value;
      }
      newRows.push(row);
    }

    while (newRows.length > 0 && newRows[newRows.length - 1]._empty) newRows.pop();

    setRows(newRows);
    setOriginalRows(newRows);
    setHasUnsavedChanges(false);
    await saveExcelDataJson('sterlink', newRows);
    await setSetting('sterlink_original_rows_count', newRows.length);
    await setSetting('sterlink_dynamic_cols', cols);
  };

  const getVisibleRows = useCallback(() => {
    let visible = rows.filter(r => !r._empty);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      visible = visible.filter(r => dynamicCols.some(c => r[c] && String(r[c]).toLowerCase().includes(s)));
    }
    if (sortCol) {
      visible.sort((a, b) => String(a[sortCol] || '').localeCompare(String(b[sortCol] || ''), undefined, { numeric: true }) * sortDir);
    }
    return visible;
  }, [rows, searchTerm, sortCol, sortDir, dynamicCols]);

  const exportXlsx = async () => {
    if (rows.length === 0) {
      toast('Nessun dato da esportare', 'error');
      return;
    }
    try {
      let outputPath = originalPath;
      if (!outputPath) {
        outputPath = await save({
          defaultPath: fileName.replace(/\.(xlsx|xls)$/i, '') + '_aggiornato.xlsx',
          filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
        });
      }
      if (!outputPath) {
        toast('Percorso di salvataggio non specificato', 'error');
        return;
      }
      setIsSaving(true);
      toast('Salvataggio in corso...', 'loading');

      const result = await invoke<string>('save_sterlink_command', {
        params: {
          current_data: rows,
          original_data: originalRows,
          dynamic_cols: dynamicCols,
          original_rows_count: originalRows.length,
          original_path: originalPath || outputPath,
          output_path: outputPath
        }
      });

      await saveExcelDataJson('sterlink', rows);
      setOriginalRows([...rows]);
      if (outputPath !== originalPath) {
        setOriginalPath(outputPath);
        if (onFileSelected) onFileSelected(fileName, outputPath);
       }
       
       if (outputPath) {
         const newHash = await calculateFileHash(outputPath);
         if (newHash) {
           setOriginalFileHash(newHash);
           await setExcelFileHash('sterlink', newHash);
           setShowExternalUpdateBanner(false);
         }
       }

      setIsSaving(false);
      toast(result || 'Sincronizzazione completata!', 'success');
      setHasUnsavedChanges(false);
    } catch (err: any) {
      console.error('Export error:', err);
      setIsSaving(false);
      toast(`Errore: ${err.message}`, 'error');
    }
  };

  const openNewRow = () => {
    setEditingIdx(null);
    setIsNew(true);

    const idCol = dynamicCols.find(c => c.toUpperCase().includes('NUMERO') && c.toUpperCase().includes('CHECKLIST'))
      || dynamicCols.find(c => c.toUpperCase().includes('SERIALE'))
      || dynamicCols[0];

    const nextId = Math.max(0, ...rows.filter(r => !r._empty).map(r => {
      const val = r[idCol];
      return val != null ? parseInt(String(val)) || 0 : 0;
    })) + 1;

    const emptyRow: Partial<SterlinkRow> = {
      [idCol]: nextId,
      _empty: false,
      _new: true
    };
    dynamicCols.forEach(col => {
      if (!(col in emptyRow)) emptyRow[col] = null;
    });
    setFormData(emptyRow);
    setModalOpen(true);
  };

  const saveRow = () => {
    const newRow: SterlinkRow = {
      ...formData as Record<string, any>,
      _empty: false
    };

    if (isNew) {
      setRows(prev => {
        const updated = [...prev, newRow];
        saveExcelDataJson('sterlink', updated);
        return updated;
      });
      toast('Nuova riga aggiunta', 'success');
    } else if (editingIdx !== null) {
      setRows(prev => {
        const updated = [...prev];
        updated[editingIdx] = newRow;
        saveExcelDataJson('sterlink', updated);
        return updated;
      });
      toast('Riga aggiornata', 'success');
    }
    setModalOpen(false);
    setHasUnsavedChanges(true);
  };

  const deleteRow = async (idx: number, skipConfirmation = false) => {
    if (!skipConfirmation) {
      const confirmed = await ask('Eliminare definitivamente questa riga?', {
        title: 'Conferma eliminazione',
        kind: 'warning'
      });
      if (!confirmed) return;
    }
    setRows(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      saveExcelDataJson('sterlink', updated);
      return updated;
    });
    setHasUnsavedChanges(true);
    toast('Riga eliminata', 'info');
  };

  const openEdit = (idx: number) => {
    setEditingIdx(idx);
    setIsNew(false);
    setFormData({ ...rows[idx] });
    setModalOpen(true);
  };

  const visibleRows = getVisibleRows();
  const tableCols = useMemo(() => {
    if (dynamicCols.length === 0) return [];
    const idCol = dynamicCols.find(c => c.toUpperCase().includes('SERIALE'));
    const checklistCol = dynamicCols.find(c => c.toUpperCase().includes('NUMERO') && c.toUpperCase().includes('CHECKLIST'));
    const priority = checklistCol || idCol;
    if (priority) return [priority, ...dynamicCols.filter(c => c !== priority)];
    return dynamicCols;
  }, [dynamicCols]);

  const [modalOpen, setModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<SterlinkRow>>({});

  const renderCellValue = (value: any, header: string) => {
    if (value === null || value === undefined || value === '') return <span className="text-neutral-400 italic">—</span>;
    const strVal = String(value);

    // MultiEntry logic for Sterlink
    if (isMultiEntryValue(strVal)) {
      const entries = parseMultiEntry(strVal);
      return (
        <div className="flex flex-col gap-1 py-1">
          {entries.map((e, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="w-1 h-1 rounded-full bg-primary-500" />
              <span className="text-[11px] text-neutral-600 dark:text-neutral-300 leading-tight">{e.value}</span>
            </div>
          ))}
     </div>
   );
}

    const isSerial = header.toUpperCase().includes('SERIALE');
    const isVersion = header.toUpperCase().includes('VERSIONE') || header.toUpperCase().includes('SW');
    const isDate = header.toUpperCase().includes('DATA');

    return (
      <div className={`text-sm leading-relaxed ${isSerial ? 'font-black text-emerald-600' : isVersion ? 'font-bold text-blue-600' : isDate ? 'text-amber-600 font-medium' : 'text-neutral-700 dark:text-neutral-200'}`}>
        {strVal}
      </div>
    );
  };

  if (view === 'upload') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ${className}`}>
        <div className="text-center mb-12">
          <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Sterlink Manager</h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
            Gestisci l'elenco delle macchine Sterlink installate, monitora le versioni software e gli interventi tecnici.
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
          onDrop={(e) => {
            e.preventDefault(); setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={async () => {
            const selected = await open({ filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }] });
            if (selected && !Array.isArray(selected)) {
              const content = await readFile(selected);
              handleFile(new File([content], selected.split(/[/\\]/).pop() || 'file'), selected);
            }
          }}
        >
          <div className="w-24 h-24 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-8 transition-transform">
            <FileSpreadsheet className="w-12 h-12 text-primary-600" />
          </div>
          <h3 className="text-3xl font-bold mb-3 text-neutral-900 dark:text-white">Carica il database Sterlink</h3>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8 max-w-md mx-auto">Trascina qui il file Excel o clicca per sfogliare il computer.</p>
          <div className="inline-flex items-center gap-2 px-8 py-4 bg-primary-600 text-white font-bold rounded-2xl hover:bg-primary-700 transition-colors shadow-lg">
            <Upload className="w-5 h-5" /> Sfoglia File
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {showExternalUpdateBanner && (
        <div className="fixed top-24 left-1/2 transform -translate-x-1/2 bg-yellow-100/90 backdrop-blur-md border border-yellow-400 text-yellow-800 p-4 rounded-2xl shadow-2xl z-50 max-w-md animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5" />
            <span className="font-semibold text-lg">Modifica rilevata all'esterno</span>
          </div>
          <p className="text-sm mb-3">Vuoi ricaricare i dati e sincronizzare?</p>
          <div className="flex gap-2">
            <button onClick={reloadFromExternal} className="flex-1 px-4 py-2 bg-yellow-500 text-white rounded-xl text-sm font-bold shadow-sm hover:bg-yellow-600">Ricarica</button>
            <button onClick={() => setShowExternalUpdateBanner(false)} className="flex-1 px-4 py-2 bg-white/50 text-yellow-800 rounded-xl text-sm font-bold border border-yellow-300">Ignora</button>
          </div>
        </div>
      )}

      {/* Header Fisso */}
      <div className="sticky top-16 z-20 flex flex-col gap-4 pt-4 pb-6 bg-transparent -mx-4 px-4 -mt-8">
        <div className="flex items-center gap-4 p-4 bg-white/80 dark:bg-neutral-800/80 rounded-2xl shadow-sm border border-neutral-200/50 dark:border-neutral-700/50 backdrop-blur-md">
          <div className="flex items-center gap-2 flex-shrink-0">
            <FileSpreadsheet className="w-6 h-6 text-blue-600" />
            {!searchTerm && (
              <span className="px-2 py-1 text-xs font-mono bg-neutral-100 dark:bg-neutral-700/50 rounded text-neutral-600 dark:text-neutral-300 transition-all duration-300">{fileName}</span>
            )}
          </div>
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              placeholder="Cerca macchine, seriali, versioni..."
              className="w-full pl-10 pr-10 py-2 bg-neutral-100 dark:bg-neutral-700/50 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all duration-300"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 hover:text-neutral-600 transition-all duration-300"
                onClick={() => setSearchTerm('')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={openNewRow}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-bold rounded-xl hover:scale-105 transition-transform text-sm"
            >
              <Plus className="w-4 h-4" /> Aggiungi Macchina
            </button>
            <button
              onClick={exportXlsx}
              disabled={isSaving}
              className={`flex items-center gap-2 px-6 py-2 bg-primary-600 text-white font-bold rounded-xl shadow-lg shadow-primary-500/20 transition-all text-sm
                 ${isSaving ? 'opacity-70 cursor-not-allowed' : 'hover:bg-primary-700 hover:scale-105 active:scale-95'}`}
            >
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isSaving ? 'Salvataggio...' : 'Sincronizza Excel'}
            </button>
          </div>
        </div>
      </div>

      {/* Tabella Premium */}
      <div className="flex-1 flex-col">
        <div className="relative flex-1 min-w-0 overflow-x-auto overflow-y-auto custom-scrollbar [&::-webkit-scrollbar]:w-[8px] [&::-webkit-scrollbar-track]:bg-neutral-100 dark:[&::-webkit-scrollbar-track]:bg-neutral-800 [&::-webkit-scrollbar-thumb]:bg-neutral-300 dark:[&::-webkit-scrollbar-thumb]:bg-neutral-600 [&::-webkit-scrollbar-thumb:hover]:bg-neutral-400 dark:[&::-webkit-scrollbar-thumb:hover]:bg-neutral-500">
          <table className="w-full text-left border-collapse min-w-max">
            <thead>
              <tr className="bg-neutral-50/80 dark:bg-neutral-900/50 backdrop-blur-sm sticky top-0 border-b border-neutral-100 dark:border-neutral-800">

                {tableCols.map((col, i) => (
                  <th key={i} className={`px-6 py-5 ${i === 0 ? 'first:rounded-tl-3xl' : ''} cursor-pointer group/th`} onClick={() => { setSortCol(col); setSortDir(prev => prev === 1 ? -1 : 1); }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 group-hover/th:text-primary-600 transition-colors uppercase">{col}</span>
                      {sortCol === col && <div className={`w-1.5 h-1.5 rounded-full bg-primary-500 ${sortDir === 1 ? 'animate-bounce' : ''}`} />}
                    </div>
                  </th>
                ))}
                <th className="px-6 py-5"><div className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Azioni</div></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50 dark:divide-neutral-900">
              {visibleRows.map((row, ri) => (
                <tr key={ri} className="group hover:bg-neutral-50/50 dark:hover:bg-neutral-800/50 transition-colors cursor-pointer" onClick={() => openEdit(rows.indexOf(row))}>
                  {tableCols.map((col, ci) => (
                    <td key={ci} className="px-6 py-4">{renderCellValue(row[col], col)}</td>
                  ))}
                  <td className="px-6 py-4 group-hover:bg-neutral-50 dark:group-hover:bg-neutral-850 transition-colors">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); openEdit(rows.indexOf(row)); }} className="p-1.5 text-neutral-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={(e) => { e.stopPropagation(); deleteRow(rows.indexOf(row)); }} className="p-1.5 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-neutral-400">
              <Search className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">Nessuna macchina trovata</p>
            </div>
          )}
        </div>
      </div>

      {/* Footer info */}
      <div className="mt-auto px-4 py-3 bg-white dark:bg-neutral-800 rounded-2xl border border-neutral-100 dark:border-neutral-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ArrowLeft className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest">Source:</span>
          <span className="text-[10px] text-neutral-500 truncate font-mono max-w-sm">{originalPath || 'Cache locale'}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-[10px] font-bold text-neutral-400 uppercase tracking-widest whitespace-nowrap">
            {hasUnsavedChanges ? <span className="text-amber-500">● Modifiche non salvate</span> : <span className="text-emerald-500">✓ Sincronizzato</span>}
          </div>
        </div>
      </div>

      {/* Modal di Modifica */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-neutral-800 w-full max-w-4xl max-h-[90vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            <div className="px-8 py-6 border-b border-neutral-100 dark:border-neutral-700 flex justify-between items-center bg-neutral-50/50 dark:bg-neutral-800/50">
              <div>
                <h3 className="text-xl font-black text-neutral-900 dark:text-white">{isNew ? 'Nuova Macchina' : 'Modifica Dati'}</h3>
                <p className="text-xs text-neutral-500 font-medium">Numero Checklist: {formData[dynamicCols.find(c => c.toUpperCase().includes('CHECKLIST')) || ''] || '—'}</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-full transition-all"><X className="w-6 h-6 text-neutral-400" /></button>
            </div>
            <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {dynamicCols.map(col => {
                  const val = formData[col];
                  const isMulti = isMultiEntryValue(val);
                  return (
                    <div key={col} className="flex flex-col gap-2">
                      <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">{col}</label>
                      {isMulti ? (
                        <MultiEntryEditor value={String(val)} onChange={(newVal) => setFormData(prev => ({ ...prev, [col]: newVal }))} />
                      ) : (
                        <textarea
                          className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none resize-none min-h-[44px]"
                          value={val ?? ''}
                          onChange={(e) => {
                            const target = e.target;
                            target.style.height = 'auto';
                            target.style.height = target.scrollHeight + 'px';
                            setFormData(prev => ({ ...prev, [col]: target.value }));
                          }}
                          onFocus={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = target.scrollHeight + 'px';
                          }}
                          placeholder={`Inserisci ${col.toLowerCase()}...`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="px-8 py-6 border-t border-neutral-100 dark:border-neutral-700 flex justify-end gap-3 bg-neutral-50/50 dark:bg-neutral-800/50">
              <button onClick={() => setModalOpen(false)} className="px-6 py-3 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-200 font-bold rounded-2xl transition-all">Annulla</button>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const confirmed = await ask('Eliminare definitivamente questa riga?', {
                    title: 'Conferma eliminazione',
                    kind: 'warning'
                  });
                  if (confirmed && editingIdx !== null) {
                    deleteRow(editingIdx, true);
                    setModalOpen(false);
                  }
                }}
                disabled={isNew}
                className={`px-6 py-3 ${isNew ? 'bg-neutral-400 text-neutral-500 cursor-not-allowed' : 'bg-red-500 text-white font-bold hover:bg-red-600'} rounded-2xl transition-all flex items-center gap-2`}
              >
                <Trash2 className="w-4 h-4" /> Elimina
              </button>
              <button onClick={saveRow} className="px-8 py-3 bg-primary-600 text-white font-bold rounded-2xl shadow-lg hover:bg-primary-700 transition-all flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Conferma</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div className={`fixed bottom-8 right-8 z-[200] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right-10 
          ${toastMsg.type === 'success' ? 'bg-emerald-500 text-white' :
            toastMsg.type === 'error' ? 'bg-red-500 text-white' :
              toastMsg.type === 'loading' ? 'bg-blue-600 text-white' : 'bg-neutral-800 text-white'}`}>
          {toastMsg.type === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> :
            toastMsg.type === 'success' ? <CheckCircle className="w-5 h-5" /> :
              toastMsg.type === 'error' ? <AlertCircle className="w-5 h-5" /> : <Loader2 className="w-5 h-5" />}
          <span className="text-sm font-bold">{toastMsg.text}</span>
        </div>
      )}
    </div>
  );
}