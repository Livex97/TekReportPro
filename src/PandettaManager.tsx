import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { FileSpreadsheet, Upload, Download, Search, X, Plus, CheckCircle, AlertCircle, Clock, Edit2, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { save, open } from '@tauri-apps/plugin-dialog';
import { saveExcelFile, getExcelFile, getExcelFilePath, saveExcelDataJson, getExcelDataJson, getExcelFileName, getSetting, setSetting } from './utils/storage';
import { invoke } from '@tauri-apps/api/core';
import ExcelJS from 'exceljs';

// Tipi
interface PandettaRow {
  [key: string]: any;
  _status: 'aperta' | 'chiusa' | 'irreparabile';
  _empty: boolean;
  _originalBg?: string | null;
  _new?: boolean;
}

interface PandettaManagerProps {
  onFileSelected?: (name: string, path: string | null) => void;
  className?: string;
}

type ViewState = 'upload' | 'table';

// Mappa label statiche per colonne note
const COL_LABELS_MAP: Record<string, string> = {
  'N.RIF PANDETTA': 'N.RIF',
  'RICHIESTA INTERVENTO': 'Richiesta',
  'DATA': 'Data',
  'CLIENTE': 'Cliente',
  'UBICAZIONE': 'Ubicazione',
  'STRUMENTO DA RIPARARE': 'Strumento',
  "TIPO DI ATTIVITA'/GUASTO": 'Guasto/Attività',
  'DDT RITIRO': 'DDT Ritiro',
  'DATA RITIRO': 'Data Ritiro',
  'GARANZIA (G) - CONTRATTO (C)': 'G/C',
  'N.PREV GT': 'N.Prev GT',
  'DATA PREVENTIVO': 'Data Prev.',
  'ACCETTAZIONE PREV GT': 'Accettazione',
  'DATA ACCETTAZIONE': 'Data Acc.',
  'STATO INTERVENTO': 'Stato Intervento',
  'ESITO': 'Esito',
  'DDT CONSEGNA': 'DDT Consegna',
  'DATA CONSEGNA': 'Data Cons.',
  'RAPPORTO N.': 'Rapporto N.',
  'TECNICO': 'Tecnico'
};

const TECNICO_PALETTE = [
  { name: 'MEZZAPESA',   bg: 'rgba(59,130,246,0.18)', text: '#93c5fd', export: '1e40af' },
  { name: 'ALLEGREZZA',  bg: 'rgba(167,139,250,0.22)', text: '#c4b5fd', export: '7c3aed' },
  { name: 'AMARA',       bg: 'rgba(251,191,36,0.22)', text: '#fbbf24', export: 'b45309' },
];

const DYNAMIC_COLORS = [
  { bg: 'rgba(244,114,182,0.2)', text: '#f472b6', export: 'be185d' },
  { bg: 'rgba(52,211,153,0.2)',  text: '#34d399', export: '065f46' },
  { bg: 'rgba(251,146,60,0.2)',  text: '#fb923c', export: '9a3412' },
  { bg: 'rgba(129,140,248,0.2)', text: '#818cf8', export: '3730a3' },
  { bg: 'rgba(34,211,238,0.2)',  text: '#22d3ee', export: '164e63' },
];

interface TecnicoColor {
  bg: string;
  text: string;
  export: string;
}

export default function PandettaManager({ onFileSelected, className = '' }: PandettaManagerProps) {
  const [view, setView] = useState<ViewState>('upload');
  const [rows, setRows] = useState<PandettaRow[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState<'all' | 'aperta' | 'chiusa' | 'irreparabile'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [fileName, setFileName] = useState('Pandetta_2026.xlsx');
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [tecnicoColorMap, setTecnicoColorMap] = useState<Record<string, TecnicoColor>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' | 'loading' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [dynamicCols, setDynamicCols] = useState<string[]>([]);

  // Drag & Drop
  useEffect(() => {
    const loadPersistentData = async () => {
      try {
        const jsonData = await getExcelDataJson('pandetta');
        const path = await getExcelFilePath('pandetta');
        const name = await getExcelFileName('pandetta');
        
        if (path) setOriginalPath(path);
        if (name) setFileName(name);

        if (jsonData && jsonData.length > 0) {
          setRows(jsonData);
          buildTecnicoColorMap(jsonData);
          
          const savedCols = await getSetting<string[]>('pandetta_dynamic_cols', []);
          if (savedCols.length > 0) {
            setDynamicCols(savedCols);
          } else {
            const cols = Object.keys(jsonData[0]).filter(k => !k.startsWith('_'));
            setDynamicCols(cols);
          }
          
          setView('table');
        } else {
          const file = await getExcelFile('pandetta');
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
            if (onFileSelected) onFileSelected(filePath.split(/[/\\]/).pop() || 'file', filePath);
            handleFile(new File([content], filePath.split(/[/\\]/).pop() || 'file'), filePath);
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

  // Toast
  const toast = (text: string, type: 'success' | 'error' | 'info' | 'loading' = 'info') => {
    setToastMsg({ text, type });
    if (type !== 'loading') {
      setTimeout(() => setToastMsg(null), 3000);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── STATUS DETECTION ──
  const deriveStatus = useCallback((statoVal: any, esitoVal: any, rowBgRgb: string | null): 'aperta' | 'chiusa' | 'irreparabile' => {
    const stato = String(statoVal || '').trim().toUpperCase();
    const esito = String(esitoVal || '').trim().toUpperCase();

    if ((stato === 'CHIUSO' || stato === 'CHIUSA' || stato.includes('CHIUSO') || stato.includes('CHIUSA'))
        && (esito === 'POSITIVO' || esito.includes('POSITIVO'))) {
      return 'chiusa';
    }

    if (stato.includes('ANNULLAT') || stato.includes('FUORI USO')
        || stato.includes('NON RIPARABILE') || stato.includes('IRREPARABILE')
        || esito.includes('ANNULLAT') || esito.includes('FUORI USO')) {
      return 'irreparabile';
    }

    if (rowBgRgb === 'FF00B050' || rowBgRgb === '00B050') return 'chiusa';
    if (rowBgRgb === 'FFFF0000' || rowBgRgb === 'FF0000') return 'irreparabile';

    return 'aperta';
  }, []);

  // ── TECNICO COLOR MAP ──
  const buildTecnicoColorMap = useCallback((allRows: PandettaRow[]) => {
    const seen = new Map<string, {bg: string; text: string; export: string}>();
    TECNICO_PALETTE.forEach(p => seen.set(p.name, p));
    let dynIdx = 0;
    allRows.forEach(row => {
      const t = String(row['TECNICO'] || '').trim().toUpperCase();
      if (t && !seen.has(t)) {
        seen.set(t, DYNAMIC_COLORS[dynIdx % DYNAMIC_COLORS.length]);
        dynIdx++;
      }
    });
    const newMap: Record<string, {bg: string; text: string; export: string}> = {};
    seen.forEach((v, k) => { newMap[k] = v; });
    setTecnicoColorMap(newMap);
  }, []);

  const getTecnicoStyle = useCallback((name: string) => {
    if (!name) return { bg: '', text: '' };
    const key = name.trim().toUpperCase();
    const found = tecnicoColorMap[key];
    if (found) return found;
    return { bg: 'rgba(100,116,139,0.15)', text: '#94a3b8', export: '475569' };
  }, [tecnicoColorMap]);

  // ── FILE HANDLING ──
  const handleFile = async (file: File, path?: string | null) => {
    setFileName(file.name);
    if (path) setOriginalPath(path);
    if (onFileSelected) onFileSelected(file.name, path || null);
    saveExcelFile('pandetta', file, path).catch(err => console.error('Error saving file:', err));
    
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

  // Trova il foglio PANDETTA per nome
  const findPandettaSheet = (wb: any) => {
    const sheets = wb.worksheets || [];
    const sheetNames: string[] = [];
    for (const ws of sheets) {
      const name = ws.name;
      if (typeof name === 'string') {
        sheetNames.push(name);
      }
    }
    const pandettaSheet = sheetNames.find((name: string) => 
      name.toUpperCase().includes('PANDETTA') || 
      name.toUpperCase().includes('PANDET') ||
      name.toUpperCase().includes('ASSISTENZA')
    );
    return pandettaSheet || sheetNames[0];
  };

  const getCellRgbFromExcelJS = (cell: any) => {
    if (!cell || !cell.fill) return null;
    const fill = cell.fill;
    if (fill.type === 'pattern' && fill.fgColor && fill.fgColor.argb) {
      return fill.fgColor.argb.replace(/^FF/i, '');
    }
    return null;
  };

  const parseSheet = async (wb: any) => {
    const sheetName = findPandettaSheet(wb);
    const ws = wb.worksheets.find((ws: any) => ws.name === sheetName) || wb.worksheets[0];
    
    // Leggi la prima riga come intestazione
    const headerRow = ws.getRow(1);
    const colCount = headerRow.cellCount;
    
    // Identifica le colonne dinamicamente
    const cols: string[] = [];
    const colIndices: number[] = [];
    
    for (let c = 1; c <= colCount; c++) {
      const cell = headerRow.getCell(c);
      const header = cell.value;
      if (header != null && String(header).trim() !== '') {
        cols.push(String(header).trim());
        colIndices.push(c - 1); // 0-based per uso successivo
      }
    }
    
    if (cols.length === 0) {
      throw new Error('Impossibile identificare le colonne nella prima riga');
    }
    
    setDynamicCols(cols);
    
    const newRows: PandettaRow[] = [];
    const rowCount = ws.rowCount;
    
    // Inizia dalla riga 2 (dopo l'intestazione)
    for (let r = 2; r <= rowCount; r++) {
      const xlRow = ws.getRow(r);
      
      // Verifica se la riga è vuota (controlla le prime 3 colonne)
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
        const emptyRow: PandettaRow = { 
          _originalBg: null,
          _empty: true,
          _status: 'aperta'
        };
        for (const col of cols) {
          emptyRow[col] = null;
        }
        newRows.push(emptyRow);
        continue;
      }
      
      const row: PandettaRow = { _status: 'aperta', _empty: false };
      
      // Popola i valori dalle colonne identificate
      for (let idx = 0; idx < cols.length; idx++) {
        const col = cols[idx];
        const cell = xlRow.getCell(colIndices[idx] + 1);
        let value = cell.value;
        
        if (value instanceof Date) {
          value = formatDate(value);
        } else if (value !== null && value !== undefined) {
          value = String(value);
        } else {
          value = null;
        }
        
        row[col] = value;
      }
      
      // Ottieni il colore di sfondo dalla prima colonna
      const bgCell = xlRow.getCell(1);
      const rowBg = getCellRgbFromExcelJS(bgCell);
      row._originalBg = rowBg;
      
      // Deriva lo stato usando le colonne identificate
      const statoCol = cols.find(c => c.toUpperCase().includes('STATO') && c.toUpperCase().includes('INTERVENTO'));
      const esitoCol = cols.find(c => c.toUpperCase().includes('ESITO'));
      
      const statoVal = statoCol ? row[statoCol] : null;
      const esitoVal = esitoCol ? row[esitoCol] : null;
      
      row._status = deriveStatus(statoVal, esitoVal, rowBg);
      
      newRows.push(row);
    }
    
    // Rimuovi le righe vuote finali
    while (newRows.length > 0 && newRows[newRows.length - 1]._empty) {
      newRows.pop();
    }
    
    setRows(newRows);
    buildTecnicoColorMap(newRows);
    
    // Salva i metadati
    await saveExcelDataJson('pandetta', newRows);
    await setSetting('pandetta_original_rows_count', newRows.length);
    await setSetting('pandetta_dynamic_cols', cols);
  };

  const getVisibleRows = useCallback(() => {
    let visible = rows.filter(r => !r._empty);
    if (filter !== 'all') visible = visible.filter(r => r._status === filter);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      visible = visible.filter(r => dynamicCols.some(c => r[c] && String(r[c]).toLowerCase().includes(s)));
    }
    if (sortCol) {
      visible.sort((a, b) => String(a[sortCol] || '').localeCompare(String(b[sortCol] || '')) * sortDir);
    }
    return visible;
  }, [rows, filter, searchTerm, sortCol, sortDir, dynamicCols]);

   const exportXlsx = async () => {
     if (rows.length === 0) {
       toast('Nessun dato da esportare', 'error');
       return;
     }

     try {
       let outputPath = originalPath;
       // Se non c'è un percorso originale, chiedi all'utente dove salvare
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

       // Chiama il comando Tauri per salvare via Python
       const result = await invoke<string>('save_pandetta_command', {
         params: {
           data: rows,
           dynamic_cols: dynamicCols,
           tecnico_color_map: tecnicoColorMap,
           original_rows_count: await getSetting<number>('pandetta_original_rows_count', rows.length),
           original_path: originalPath || outputPath,
           output_path: outputPath
         }
       });

       // Aggiorna persistence
       await saveExcelDataJson('pandetta', rows);
       if (outputPath !== originalPath) {
         setOriginalPath(outputPath);
         if (onFileSelected) onFileSelected(fileName, outputPath);
       }

       setIsSaving(false);
       toast(result || 'Sincronizzazione completata!', 'success');
     } catch (err: any) {
       console.error('Export error:', err);
       setIsSaving(false);
       toast(`Errore durante l'esportazione: ${err.message}. Assicurati che Python sia installato.`, 'error');
     }
   };

  const openNewRow = () => {
    setEditingIdx(null);
    setIsNew(true);
    
    // Trova la colonna RIF dinamicamente
    const rifCol = dynamicCols.find(c => c.toUpperCase().includes('RIF') && c.toUpperCase().includes('PANDETTA')) 
                   || dynamicCols.find(c => c.toUpperCase().includes('RIF'))
                   || 'N.RIF PANDETTA';
    
    const nextRif = Math.max(0, ...rows.filter(r => !r._empty).map(r => {
      const val = r[rifCol];
      return val != null ? parseInt(String(val)) || 0 : 0;
    })) + 1;
    
    const emptyRow: Partial<PandettaRow> = {
      [rifCol]: nextRif,
      _status: 'aperta',
      _empty: false,
      _new: true
    };
    
    dynamicCols.forEach(col => {
      if (!(col in emptyRow)) emptyRow[col] = null;
    });
    
    setFormData(emptyRow);
    setModalStatus('aperta');
    setModalOpen(true);
  };

  const saveRow = () => {
    const newRow: PandettaRow = {
      ...formData as Record<string, any>,
      _status: modalStatus,
      _empty: false
    };

    if (isNew) {
      setRows(prev => {
        const updated = [...prev, newRow];
        buildTecnicoColorMap(updated);
        saveExcelDataJson('pandetta', updated);
        return updated;
      });
      toast('Nuova riga aggiunta', 'success');
    } else if (editingIdx !== null) {
      setRows(prev => {
        const updated = [...prev];
        updated[editingIdx] = newRow;
        buildTecnicoColorMap(updated);
        saveExcelDataJson('pandetta', updated);
        return updated;
      });
      toast('Riga aggiornata', 'success');
    }
    setModalOpen(false);
  };

  const deleteRow = (idx: number) => {
    if (!confirm('Eliminare definitivamente questa riga?')) return;
    setRows(prev => {
      const updated = prev.filter((_, i) => i !== idx);
      saveExcelDataJson('pandetta', updated);
      return updated;
    });
    toast('Riga eliminata', 'info');
  };

  const openEdit = (idx: number) => {
    setEditingIdx(idx);
    setIsNew(false);
    const row = rows[idx];
    setFormData({ ...row });
    setModalStatus(row._status);
    setModalOpen(true);
  };

  // Derived
  const stats = {
    all: rows.filter(r => !r._empty).length,
    aperta: rows.filter(r => r._status === 'aperta' && !r._empty).length,
    chiusa: rows.filter(r => r._status === 'chiusa' && !r._empty).length,
    irreparabile: rows.filter(r => r._status === 'irreparabile' && !r._empty).length,
  };

  const tecnici = [...new Set(rows.filter(r => !r._empty).map(r => (r['TECNICO'] || '').trim()).filter(Boolean))];
  const visibleRows = getVisibleRows();

  // Ordina colonne: N.RIF PANDETTA per primo se presente
  const tableCols = useMemo(() => {
    if (dynamicCols.length === 0) return [];
    const rifCol = dynamicCols.find(c => c.toUpperCase().includes('RIF') && c.toUpperCase().includes('PANDETTA'));
    if (rifCol) {
      return [rifCol, ...dynamicCols.filter(c => c !== rifCol)];
    }
    return dynamicCols;
  }, [dynamicCols]);

  const getColLabel = (col: string) => COL_LABELS_MAP[col] || col;

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [modalStatus, setModalStatus] = useState<'aperta' | 'chiusa' | 'irreparabile'>('aperta');
  const [formData, setFormData] = useState<Partial<PandettaRow>>({});

  // ── UI ──
  if (view === 'upload') {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center py-12 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500 ${className}`}>
        <div className="text-center mb-12">
          <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Pandetta 2026</h2>
          <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
            Carica il file Excel per iniziare a gestire le assistenze tecniche e mantenere il monitoraggio costante degli strumenti.
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
            e.preventDefault();
            setIsDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
          }}
          onClick={async () => {
             const selected = await open({
               filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }]
             });
             if (selected && !Array.isArray(selected)) {
               const name = selected.split(/[/\\]/).pop() || 'file';
               const content = await readFile(selected);
               const file = new File([content], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
               handleFile(file, selected);
             } else {
               fileInputRef.current?.click();
             }
          }}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".xlsx,.xls"
            onChange={onFileChange}
          />
          <div className="w-24 h-24 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mx-auto mb-8 transition-transform group-hover:scale-110">
            <FileSpreadsheet className="w-12 h-12 text-primary-600" />
          </div>
          <h3 className="text-3xl font-bold mb-3 text-neutral-900 dark:text-white">Trascina qui il file Excel</h3>
          <p className="text-neutral-500 dark:text-neutral-400 mb-8 max-w-md mx-auto">
            Puoi anche cliccare ovunque in quest'area per sfogliare i file nel tuo computer.
          </p>
          <div className="inline-flex items-center gap-2 px-8 py-4 bg-primary-600 text-white font-bold rounded-2xl hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/20">
            <Upload className="w-5 h-5" />
            Sfoglia File Excel
          </div>
          <p className="mt-6 text-sm text-neutral-400 font-medium">Formati supportati: .xlsx, .xls</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full gap-4 ${className}`}>
      {/* Top Bar */}
      <div className="flex items-center gap-4 p-4 bg-white dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700">
        <button 
          onClick={() => setView('upload')}
          className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg transition-colors text-neutral-500"
        >
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-6 h-6 text-blue-600" />
          <span className="font-bold text-lg text-neutral-900 dark:text-white">Pandetta</span>
          <span className="px-2 py-1 text-xs font-mono bg-neutral-100 dark:bg-neutral-700 rounded text-neutral-600 dark:text-neutral-300">
            {fileName}
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
              {[
                { key: 'all', label: 'Tutte', color: 'text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600' },
                { key: 'aperta', label: 'Aperte', color: 'text-amber-600 border-amber-500' },
                { key: 'chiusa', label: 'Chiuse', color: 'text-emerald-600 border-emerald-500' },
                { key: 'irreparabile', label: 'Irreparabili', color: 'text-red-600 border-red-500' }
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key as any)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium border rounded-lg transition-colors ${
                    filter === f.key
                      ? `${f.color} bg-current/10`
                      : 'text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${
                    f.key === 'all' ? 'bg-transparent' :
                    f.key === 'aperta' ? 'bg-amber-500' :
                    f.key === 'chiusa' ? 'bg-emerald-500' : 'bg-red-500'
                  }`} />
                  {stats[f.key as keyof typeof stats]} <span className="hidden sm:inline">{f.label}</span>
                </button>
              ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
          <input
            type="text"
            placeholder="Cerca cliente, strumento, stato…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-neutral-300 dark:border-neutral-600 rounded-lg bg-neutral-50 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {searchTerm && (
          <button
            onClick={() => { setSearchTerm(''); setFilter('all'); }}
            className="p-2 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="h-6 w-px bg-neutral-300 dark:bg-neutral-600" />

        <button
          onClick={openNewRow}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuova riga
        </button>

        <button
          onClick={exportXlsx}
          disabled={isSaving}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {isSaving ? 'Salvataggio in corso...' : 'Esporta Excel'}
        </button>

        <button
          onClick={() => setView('upload')}
          className="flex items-center gap-2 px-4 py-2 bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded-lg text-sm font-medium transition-colors border border-neutral-300 dark:border-neutral-600"
        >
          <Upload className="w-4 h-4" />
          Ricarica file
        </button>

        <div className="h-6 w-px bg-neutral-300 dark:border-neutral-600" />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Tecnici:</span>
          {tecnici.map(t => {
            const style = getTecnicoStyle(t);
            return (
              <span
                key={t}
                className="px-2 py-1 text-xs font-bold rounded-full"
                style={{ background: style.bg, color: style.text, border: `1px solid ${style.text}40` }}
              >
                {t}
              </span>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 bg-white dark:bg-neutral-800 rounded-xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-auto">
        <table className="w-full text-sm text-left">
            <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-700 z-10">
              <tr>
                {tableCols.map(col => (
                  <th
                    key={col}
                    onClick={() => {
                      if (sortCol === col) {
                        setSortDir(prev => (prev === 1 ? -1 : 1));
                      } else {
                        setSortCol(col);
                        setSortDir(1);
                      }
                    }}
                    className="px-4 py-3 font-semibold text-neutral-700 dark:text-neutral-200 border-b border-neutral-200 dark:border-neutral-600 cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 select-none whitespace-nowrap align-middle"
                  >
                    <div className="flex items-center gap-1">
                      {getColLabel(col)}
                      {sortCol === col && (
                        <span className="text-blue-500">{sortDir === 1 ? '▲' : '▼'}</span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 font-semibold text-neutral-700 dark:text-neutral-200 border-b border-neutral-200 dark:border-neutral-600 w-24 align-middle">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={tableCols.length + 1} className="px-4 py-12 text-center text-neutral-500">
                    Nessun dato disponibile
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const realIdx = rows.findIndex(r => r === row);
                  const status = row._status;
                  const rowStyle = status === 'chiusa' ? 'bg-emerald-50/20 dark:bg-emerald-900/10 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/20' :
                                   status === 'irreparabile' ? 'bg-red-50/20 dark:bg-red-900/10 hover:bg-red-100/40 dark:hover:bg-red-900/20' :
                                   'bg-amber-50/20 dark:bg-amber-900/10 hover:bg-amber-100/40 dark:hover:bg-amber-900/10';
                   return (
                     <tr 
                       key={realIdx} 
                       className={`group transition-colors duration-200 cursor-pointer ${rowStyle}`}
                       onClick={() => openEdit(realIdx)}
                     >
                       {tableCols.map(col => (
                         <td key={col} className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-600 align-middle whitespace-nowrap">
                           {String(row[col] || '').trim()}
                         </td>
                       ))}
                      <td className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-600 text-right align-middle">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEdit(realIdx); }}
                            className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-xl transition-all shadow-sm border border-blue-100 dark:border-blue-800"
                            title="Modifica"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteRow(realIdx); }}
                            className="p-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-xl transition-all shadow-sm border border-red-100 dark:border-red-800"
                            title="Elimina"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
      </div>

      {/* Modal - Simplified for brevity but will be built dynamically */}
      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 backdrop-blur-sm bg-neutral-900/40 animate-in fade-in duration-300">
          <div className="bg-white dark:bg-neutral-800 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-300">
            
            {/* Modal Header */}
            <div className="px-8 py-6 border-b border-neutral-100 dark:border-neutral-700 flex justify-between items-center bg-neutral-50/50 dark:bg-neutral-800/50">
              <div>
                <h3 className="text-2xl font-black text-neutral-900 dark:text-white">
                  {isNew ? 'Nuova Assistenza' : 'Modifica Assistenza'}
                </h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-neutral-500 font-medium">RIF:</span>
                  <span className="px-2 py-0.5 bg-neutral-100 dark:bg-neutral-700 rounded text-xs font-mono font-bold text-neutral-600 dark:text-neutral-300">
                    {formData['N.RIF PANDETTA'] || formData['N.RIF'] || '—'}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setModalOpen(false)}
                className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-xl transition-colors text-neutral-400 hover:text-neutral-600"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-8 overflow-y-auto flex-1 bg-white dark:bg-neutral-800">
              
              {/* Status Selector */}
              <div className="mb-10">
                <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1 mb-3 block">
                  Stato Assistenza
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    { id: 'aperta', label: 'Aperta', icon: Clock, color: 'amber' },
                    { id: 'chiusa', label: 'Chiusa', icon: CheckCircle, color: 'emerald' },
                    { id: 'irreparabile', label: 'Irreparabile', icon: AlertCircle, color: 'red' }
                  ].map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setModalStatus(s.id as any)}
                      className={`flex items-center justify-center gap-3 p-4 rounded-2xl border-2 transition-all font-bold text-sm
                        ${modalStatus === s.id 
                          ? `border-${s.color}-500 bg-${s.color}-50 dark:bg-${s.color}-900/20 text-${s.color}-700 dark:text-${s.color}-400 shadow-lg shadow-${s.color}-500/10` 
                          : 'border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/30 text-neutral-500 hover:border-neutral-200 dark:hover:border-neutral-600'
                        }`}
                    >
                      <s.icon className={`w-5 h-5 ${modalStatus === s.id ? `text-${s.color}-500` : ''}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-px bg-neutral-100 dark:bg-neutral-700 mb-10" />

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {dynamicCols.map(col => {
                  if (col.toUpperCase() === 'N.RIF PANDETTA' || col.toUpperCase() === 'N.RIF') return null;

                  const label = getColLabel(col);
                  const value = formData[col] || '';

                  if (col.toUpperCase() === 'STATO INTERVENTO') {
                    return (
                      <div key={col} className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">
                          {label}
                        </label>
                        <select
                          value={value}
                          onChange={(e) => setFormData({ ...formData, [col]: e.target.value })}
                          className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none"
                        >
                          <option value="">Seleziona...</option>
                          {['APERTO', 'CHIUSO', 'ANNULLATO', 'FUORI USO', 'IRREPARABILE', 'NON RIPARABILE'].map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  if (col.toUpperCase() === 'ESITO') {
                    return (
                      <div key={col} className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">
                          {label}
                        </label>
                        <select
                          value={value}
                          onChange={(e) => setFormData({ ...formData, [col]: e.target.value })}
                          className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none"
                        >
                          <option value="">Seleziona...</option>
                          {['POSITIVO', 'NEGATIVO', 'ANNULLATO'].map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  if (col.toUpperCase() === 'TECNICO') {
                    return (
                      <div key={col} className="flex flex-col gap-1.5">
                        <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">
                          {label}
                        </label>
                        <input
                          list="tecnici-datalist"
                          value={value}
                          onChange={(e) => setFormData({ ...formData, [col]: e.target.value })}
                          className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none"
                          placeholder="Nome tecnico..."
                        />
                        <datalist id="tecnici-datalist">
                          {tecnici.map(t => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                    );
                  }

                  return (
                    <div key={col} className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-black uppercase tracking-widest text-neutral-400 px-1">
                        {label}
                      </label>
                      <textarea
                        className="w-full px-4 py-3 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-neutral-800 transition-all outline-none resize-none min-h-[46px]"
                        value={value}
                        rows={1}
                        onChange={(e) => {
                          const target = e.target;
                          target.style.height = 'auto';
                          target.style.height = target.scrollHeight + 'px';
                          setFormData({ ...formData, [col]: target.value });
                        }}
                        onFocus={(e) => {
                          e.target.style.height = 'auto';
                          e.target.style.height = e.target.scrollHeight + 'px';
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-8 py-6 border-t border-neutral-100 dark:border-neutral-700 flex justify-between items-center bg-neutral-50/50 dark:bg-neutral-800/50">
              <div>
                {!isNew && (
                  <button 
                    onClick={() => deleteRow(editingIdx!)} 
                    className="flex items-center gap-2 px-5 py-3 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-2xl transition-all font-bold text-sm"
                  >
                    <Trash2 className="w-4 h-4" />
                    Elimina Record
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setModalOpen(false)} 
                  className="px-6 py-3 bg-white dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-200 font-bold rounded-2xl hover:bg-neutral-50 dark:hover:bg-neutral-650 transition-all text-sm"
                >
                  Annulla
                </button>
                <button 
                  onClick={saveRow} 
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg shadow-blue-500/20 transition-all text-sm flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Salva Modifiche
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg border-l-4 ${
            toastMsg.type === 'success' ? 'border-l-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200' :
            toastMsg.type === 'error' ? 'border-l-red-500 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200' :
            toastMsg.type === 'loading' ? 'border-l-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200' :
            'border-l-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200'
          } transition-all duration-300 animate-in slide-in-from-bottom-5 fade-in`}
        >
          <div className="flex items-center gap-2">
            {toastMsg.type === 'success' && <CheckCircle className="w-4 h-4" />}
            {toastMsg.type === 'error' && <AlertCircle className="w-4 h-4" />}
            {toastMsg.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin" />}
            {toastMsg.type === 'info' && <Clock className="w-4 h-4" />}
            <span className="text-sm font-medium">{toastMsg.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}
