import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Download, Upload, Search, FileText, Clipboard, Database, Plus, Settings, FileSpreadsheet, X } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';

// Canvas context for accurate text measurement (singleton)
let measureCtx: CanvasRenderingContext2D | null = null;

const getMeasureContext = (): CanvasRenderingContext2D => {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    // Set font to match table cell styling
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot create canvas context');
    // Match the font used in table cells: Inter-like font stack, 14px
    ctx.font = '14px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    measureCtx = ctx;
  }
  return measureCtx;
};

const measureTextWidth = (text: string): number => {
  if (!text || text.trim() === '') return 0;
  const ctx = getMeasureContext();
  // Split by lines and measure the longest line (multi-line support)
  const lines = text.split('\n');
  let maxWidth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      const metrics = ctx.measureText(trimmed);
      maxWidth = Math.max(maxWidth, metrics.width);
    }
  }
  return maxWidth;
};

interface DataRow {
  _id: number;
  _new?: boolean;
  [key: string]: any;
}

type Page = 'table' | 'import' | 'settings';

function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

export default function SterlinkManagerPage() {
  const [activePage, setActivePage] = useState<Page>('table');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [filter, setFilter] = useState('');
  const [modified, setModified] = useState(false);
  const nextIdRef = useRef(1);
   const [isDragging, setIsDragging] = useState(false);
   const [columnWidths, setColumnWidths] = useState<{ [key: number]: number }>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreInputRef = useRef<HTMLTextAreaElement>(null);

  // Drag & Drop
  useEffect(() => {
    let unlistenEnter: (() => void) | null = null;
    let unlistenLeave: (() => void) | null = null;
    let unlistenDrop: (() => void) | null = null;

    const setup = async () => {
      unlistenEnter = await listen('tauri://drag-enter', () => {
        if (activePage === 'import') setIsDragging(true);
      });
      unlistenLeave = await listen('tauri://drag-leave', () => {
        setIsDragging(false);
      });
      unlistenDrop = await listen('tauri://drag-drop', async (event: any) => {
        setIsDragging(false);
        if (activePage !== 'import') return;
        const paths = event.payload?.paths;
        if (paths && paths.length > 0) {
          try {
            const filePath = paths[0];
            const name = filePath.split(/[/\\]/).pop() || 'file';
             const content = await readFile(filePath);
             parseExcel(content.buffer, name);
          } catch (err) {
            console.error('Drag-drop error:', err);
            showToast('Errore nel caricamento file', 'error');
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
   }, [activePage]);

   // Recalculate column widths when headers or rows change (e.g., after edit, add row)
   useEffect(() => {
     if (headers.length === 0) {
       setColumnWidths({});
       return;
     }

     const calculateWidths = () => {
       const widths: { [key: number]: number } = {};

       headers.forEach((_, colIdx) => {
         let maxContentWidth = 0;
         let hasContent = false;

         // Measure all cells in this column
         rows.forEach(row => {
           const val = row[headers[colIdx]];
           if (val != null && val !== '') {
             hasContent = true;
             const strVal = String(val);
             const width = measureTextWidth(strVal);
             maxContentWidth = Math.max(maxContentWidth, width);
           }
         });

         // If column has content, use max content width + padding
         // If no content, use a minimal default width
         let finalWidth: number;
         if (hasContent) {
           // Convert canvas pixels to CSS pixels (they're already CSS pixels, but add padding)
           // Required padding: cell padding (16px horizontal = 8px left + 8px right) + some breathing room
           finalWidth = Math.max(120, Math.min(600, maxContentWidth + 32));
         } else {
           // No content at all – keep it minimal but usable
           finalWidth = 100;
         }

         widths[colIdx] = finalWidth;
       });

       return widths;
     };

     if (rows.length > 0) {
       setColumnWidths(calculateWidths());
     } else {
       // If headers exist but no rows, use minimal default widths
       const widths: { [key: number]: number } = {};
       headers.forEach((_, idx) => {
         widths[idx] = 120;
       });
       setColumnWidths(widths);
     }
   }, [headers, rows]);

   const readExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buffer = ev.target?.result as ArrayBuffer;
      parseExcel(buffer, file.name);
    };
    reader.readAsArrayBuffer(file);
  };

  const parseExcel = (buffer: ArrayBuffer, fileName: string) => {
    try {
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false, dateNF: 'dd/mm/yyyy' }) as any[][];

      if (!raw || raw.length < 1) {
        showToast('File vuoto o non leggibile', 'error');
        return;
      }

      const headerRow = raw[0];
      const headers = headerRow.map((h: any, i: number) => {
        const clean = h ? String(h).replace(/\n/g, ' ').trim() : `Colonna ${i + 1}`;
        return clean;
      }).filter((_ : any, i: number) => i < headerRow.length - 1 || headerRow[i] !== null);

      const cleanHeaders = headers[headers.length - 1] === `Colonna ${headers.length}` && raw.slice(1).some((r: any[]) => r[headers.length - 1])
        ? headers.slice(0, -1)
        : headers;

      const parsedRows: DataRow[] = raw.slice(1)
        .filter((r: any[]) => r.some((c: any) => c !== null && c !== ''))
        .map((r: any[]) => {
          const obj: DataRow = { _id: nextIdRef.current++ };
          cleanHeaders.forEach((h: string, i: number) => {
            let v = r[i];
            if (v === null || v === undefined) v = null;
            else v = String(v).trim();
            obj[h] = v;
          });
          return obj;
        });

      setHeaders(cleanHeaders);
      setRows(parsedRows);
      setFileName(fileName);
      setLoadedAt(new Date().toLocaleString('it-IT'));
      setModified(false);
      setSortCol(null);
      setEditingRowId(null);
      setActivePage('table');

      // Calculate column widths based on maximum content length (excluding headers)
      const widths: number[] = cleanHeaders.map((_, colIdx) => {
        let maxChars = 0;
        // Find maximum character count in this column across all rows
        parsedRows.forEach(row => {
          const val = row[cleanHeaders[colIdx]];
          if (val != null) {
            const strVal = String(val);
            maxChars = Math.max(maxChars, strVal.length);
          }
        });
        // Estimate width: ~8px per character + padding
        // Minimum 100px, maximum 400px per column
        const estimatedWidth = Math.max(100, Math.min(400, maxChars * 8 + 24));
        return estimatedWidth;
      });
      setColumnWidths(widths);

      showToast(`Caricati ${parsedRows.length} record da "${fileName}"`, 'success');
    } catch (err) {
      console.error('Parse error:', err);
      showToast('Errore nella lettura del file Excel', 'error');
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readExcelFile(file);
    e.target.value = '';
  };

  const handleAddRow = () => {
    if (!headers.length) {
      showToast('Carica prima un file Excel', 'error');
      return;
    }
    const newRow: DataRow = { _id: nextIdRef.current++, _new: true };
    headers.forEach(h => newRow[h] = null);
    setRows(prev => [...prev, newRow]);
    setEditingRowId(newRow._id);
    showToast('Nuova riga aggiunta — compila i campi e salva', 'info');
   };

   const deleteRow = (id: number) => {
    if (!confirm('Eliminare questa riga?')) return;
    setRows(prev => prev.filter(r => r._id !== id));
    setModified(true);
    showToast('Riga eliminata', 'info');
  };

  const startEdit = (id: number) => {
    setEditingRowId(id);
  };

  const cancelEdit = (id: number) => {
    const row = rows.find(r => r._id === id);
    if (row && row._new) {
      setRows(prev => prev.filter(r => r._id !== id));
    }
    setEditingRowId(null);
  };

  const saveRow = (id: number) => {
    const row = rows.find(r => r._id === id);
    if (!row) return;
    
    headers.forEach(header => {
      const input = document.querySelector(`textarea[data-id="${id}"][data-col="${header}"]`) as HTMLTextAreaElement;
      if (input) {
        const value = input.value.trim() || null;
        row[header] = value;
      }
    });
    
    setRows(prev => prev.map(r => r._id === id ? { ...r, _new: false } : r));
    setEditingRowId(null);
    setModified(true);
    showToast('Riga salvata', 'success');
  };

  // Excel Export
  const saveToExcel = async () => {
    if (!rows.length) {
      showToast('Nessun dato da salvare', 'error');
      return;
    }

    if (typeof ExcelJS === 'undefined') {
      showToast('Caricamento ExcelJS...', 'info');
      await loadExcelJS();
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sterlink Manager';
    wb.created = new Date();
    const ws = wb.addWorksheet('Foglio1', { views: [{ state: 'frozen', ySplit: 1 }] });

    ws.columns = headers.map(() => ({ width: 18 }));

    const headerRow = ws.addRow(headers);
    headerRow.height = 33.75;
    const HDR_BG = '1F4E79';
    const HDR_FG = 'FFFFFF';
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: HDR_FG } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HDR_BG } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: '2F75B6' } },
        left: { style: 'thin', color: { argb: '2F75B6' } },
        bottom: { style: 'thin', color: { argb: '2F75B6' } },
        right: { style: 'thin', color: { argb: '2F75B6' } }
      };
    });

    rows.forEach((row) => {
      const values = headers.map(h => row[h] ?? '');
      const dataRow = ws.addRow(values);
      dataRow.height = 30;
      dataRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Calibri', size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'top', wrapText: false };
        cell.border = {
          top: { style: 'thin', color: { argb: 'BDD7EE' } },
          left: { style: 'thin', color: { argb: 'BDD7EE' } },
          bottom: { style: 'thin', color: { argb: 'BDD7EE' } },
          right: { style: 'thin', color: { argb: 'BDD7EE' } }
        };
      });
    });

    const lastRow = rows.length + 1;
    const lastCol = String.fromCharCode(64 + headers.length);
    ws.addTable({
      name: 'Tabella1',
      ref: `A1:${lastCol}${lastRow}`,
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium9', showRowStripes: true },
      columns: headers.map(h => ({ name: h, filterButton: true })),
      rows: rows.map(row => headers.map(h => row[h] ?? ''))
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fname = fileName ? fileName.replace(/\.(xlsx|xls)$/i, '') + '_aggiornato.xlsx' : 'sterlink_export.xlsx';
    a.download = fname;
    a.click();
    URL.revokeObjectURL(url);

    setModified(false);
    showToast(`File "${fname}" scaricato`, 'success');
  };

  const loadExcelJS = () => {
    return new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ExcelJS'));
      document.head.appendChild(s);
    });
  };

  // JSON Backup/Restore
  const buildBackupJSON = () => {
    return JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      fileName,
      headers,
      rows: rows.map(r => {
        const clean: Record<string, any> = {};
        headers.forEach(h => clean[h] = r[h] ?? null);
        return clean;
      })
    }, null, 2);
  };

  const exportJSON = () => {
    if (!rows.length) {
      showToast('Nessun dato da esportare', 'error');
      return;
    }
    const json = buildBackupJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fileName || 'sterlink').replace(/\.[^.]+$/, '') + '_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup JSON esportato', 'success');
  };

  const copyJSON = () => {
    if (!rows.length) {
      showToast('Nessun dato da copiare', 'error');
      return;
    }
    navigator.clipboard.writeText(buildBackupJSON())
      .then(() => showToast('JSON copiato negli appunti', 'success'))
      .catch(() => showToast('Copia non riuscita', 'error'));
  };

  const restoreFromJSON = () => {
    const text = (restoreInputRef.current?.value || '').trim();
    if (!text) {
      showToast('Incolla prima il JSON nel campo', 'error');
      return;
    }
    let data: any;
    try { data = JSON.parse(text); } catch {
      showToast('JSON non valido', 'error');
      return;
    }
    if (!data.headers || !Array.isArray(data.headers) || !data.rows || !Array.isArray(data.rows)) {
      showToast('Struttura JSON non riconosciuta', 'error');
      return;
    }
    if (!confirm(`Ripristinare ${data.rows.length} record dal backup? I dati attuali verranno sostituiti.`)) return;

    setHeaders(data.headers);
    const newRows: DataRow[] = data.rows.map((r: any) => {
      const row: DataRow = { _id: nextIdRef.current++ };
      data.headers.forEach((h: string) => row[h] = r[h] ?? null);
      return row;
    });
    setRows(newRows);
    setFileName(data.fileName || 'backup_ripristinato.xlsx');
    setLoadedAt(new Date().toLocaleString('it-IT'));
    setModified(false);
    if (restoreInputRef.current) restoreInputRef.current.value = '';
    showToast(`Ripristinati ${newRows.length} record dal backup`, 'success');
  };

  // Filtered and sorted rows
  const getFilteredSortedRows = () => {
    let filtered = [...rows];
    const q = filter.toLowerCase();
    if (q) {
      filtered = filtered.filter(row => 
        headers.some(h => {
          const val = row[h];
          return val != null && String(val).toLowerCase().includes(q);
        })
      );
    }
    if (sortCol !== null) {
      const h = headers[sortCol];
      filtered.sort((a, b) => {
        const av = a[h] ?? '', bv = b[h] ?? '';
        return av.localeCompare(bv, 'it', { numeric: true }) * sortDir;
      });
    }
    return filtered;
  };

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      setSortDir(sortDir === 1 ? -1 : 1);
    } else {
      setSortCol(colIdx);
      setSortDir(1);
    }
  };

  const handleFilter = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter(e.target.value);
  };

  const handleClearSearch = () => {
    setFilter('');
  };

  // Render helpers
  const renderCellValue = (value: any, header: string, query: string) => {
    if (value === null || value === undefined || value === '') {
      return <span className="cell-null">—</span>;
    }

    const strVal = String(value);
    const isMultiEntryVal = /^\d+\.\s/.test(strVal) && (strVal.includes('\n') || strVal.includes('\\n'));

    if (isMultiEntryVal) {
      return renderMultiEntry(strVal, query, header);
    }

    let display = strVal;
    const isDate = header.toLowerCase().includes('data');
    const isSerial = header.toUpperCase() === 'SERIALE' || header.toUpperCase().includes('SERIALE');
    const isNA = strVal.trim().toUpperCase() === 'NA' || strVal.trim() === 'N/A';

    let className = 'cell-content';
    if (isNA) className += ' cell-na';
    else if (isSerial) className += ' cell-serial';
    else if (isDate) className += ' cell-date';

    if (query && strVal.toLowerCase().includes(query.toLowerCase())) {
      const re = new RegExp(`(${query})`, 'gi');
      display = strVal.replace(re, '<mark class="highlight">$1</mark>');
    }

    return <div className={className} dangerouslySetInnerHTML={{ __html: display }} />;
  };

  const renderMultiEntry = (val: string, query: string, colHeader: string) => {
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

    return (
      <div className="multi-entries">
        {entries.map((e, idx) => {
          const isNA = !e.value || e.value.toUpperCase() === 'NA' || e.value === 'N/A';
          let text = isNA ? 'N/D' : e.value;
          const isDateCol = colHeader.toLowerCase().includes('data') || colHeader.toLowerCase().includes('ispezioni') || colHeader.toLowerCase().includes('intervento');
          let valClass = 'entry-value';
          if (isNA) valClass += ' is-na';
          else if (isDateCol) valClass += ' is-date';
          if (query && text.toLowerCase().includes(query.toLowerCase())) {
            const re = new RegExp(`(${query})`, 'gi');
            text = text.replace(re, '<mark class="highlight">$1</mark>');
          }
          return (
            <div key={idx} className="entry-slot" data-idx={Math.min(idx, 4)}>
              <span className="entry-index">{e.idx + 1}</span>
              <span className={valClass} dangerouslySetInnerHTML={{ __html: text }} />
            </div>
          );
        })}
      </div>
    );
  };

  const displayedRows = getFilteredSortedRows();

  return (
    <div className="flex flex-col bg-neutral-50 dark:bg-neutral-900 min-h-screen">
       <style>{`
         .cell-editor {
           width: 100%;
          box-sizing: border-box;
          border: 2px solid #3b82f6;
          border-radius: 8px;
          padding: 10px;
          font-family: inherit;
          resize: vertical;
          min-height: 60px;
          font-size: 14px;
          line-height: 1.5;
          background: white;
          transition: ring 0.2s;
        }
        .cell-editor:focus {
          outline: none;
          ring: 2px;
          ring-color: #3b82f6;
          ring-offset: 2px;
        }
         .cell-null { color: #9ca3af; font-style: italic; }
         .cell-serial { font-weight: 600; color: #10b981; }
         .cell-date { color: #d97706; }
         .cell-content {
           white-space: pre-wrap;
           word-break: break-word;
           line-height: 1.6;
           padding: 2px 0;
           overflow-wrap: anywhere;
         }

         /* Header cells with fixed layout: prevent expansion */
         thead th {
           overflow: hidden;
           text-overflow: ellipsis;
           white-space: nowrap;
           max-width: 100%;
         }

         /* Data cells allow wrapping */
         tbody td {
           white-space: pre-wrap;
           word-break: break-word;
           overflow-wrap: anywhere;
         }

         .multi-entries { display: flex; flex-direction: column; gap: 4px; }
         .entry-slot { display: flex; align-items: flex-start; gap: 6px; padding: 4px 8px; border-radius: 6px; border-left: 3px solid; background: rgba(0,0,0,0.02); }
         .entry-slot[data-idx="0"] { border-color: #3b82f6; background: rgba(59, 130, 246, 0.05); }
         .entry-slot[data-idx="1"] { border-color: #10b981; background: rgba(16, 185, 129, 0.05); }
         .entry-slot[data-idx="2"] { border-color: #f59e0b; background: rgba(245, 158, 11, 0.05); }
         .entry-slot[data-idx="3"] { border-color: #a855f7; background: rgba(168, 85, 247, 0.05); }
         .entry-slot[data-idx="4"] { border-color: #ef4444; background: rgba(239, 68, 68, 0.05); }
         .entry-index { width: 20px; height: 20px; border-radius: 50%; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; background: currentColor; color: white; flex-shrink: 0; }
         .entry-value { font-size: 13px; line-height: 1.5; word-break: break-word; color: #374151; }
         .entry-value.is-na { color: #9ca3af; font-style: italic; }
         .entry-value.is-date { color: #d97706; font-weight: 500; }

         .toast { position: fixed; bottom: 24px; right: 24px; padding: 12px 16px; border-radius: 8px; font-size: 14px; color: white; box-shadow: 0 4px 12px rgba(0,0,0,0.15); animation: slideIn 0.2s ease; z-index: 9999; }
         .toast.success { background: #10b981; }
         .toast.error { background: #ef4444; }
         .toast.info { background: #3b82f6; }
         @keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
       `}</style>

      {/* Top Navigation Tabs */}
      <div className="flex gap-2 mb-6 border-b border-neutral-200 dark:border-neutral-700 pb-4">
        {[
          { id: 'table', label: 'Tabella Dati' },
          { id: 'import', label: 'Importa Excel' },
          { id: 'settings', label: 'Impostazioni' }
        ].map(item => {
          const Icon = item.id === 'table' ? FileText : item.id === 'import' ? Upload : Settings;
          return (
            <button
              key={item.id}
              onClick={() => setActivePage(item.id as Page)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-all ${
                activePage === item.id
                  ? 'bg-primary-600 text-white shadow-md'
                  : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Table Page */}
      {activePage === 'table' && (
        <div className="flex flex-col h-full">
          {/* Header Stats & Actions */}
          <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                {fileName && (
                  <>
                    <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900/30 rounded-lg flex items-center justify-center">
                      <FileText className="w-4 h-4 text-primary-600" />
                    </div>
                    <div>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">File Caricato</p>
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white truncate max-w-[200px]">{fileName}</p>
                    </div>
                  </>
                )}
                {!fileName && (
                  <div className="px-3 py-1.5 bg-neutral-100 dark:bg-neutral-700 rounded-lg text-sm text-neutral-500 dark:text-neutral-400">
                    Nessun file caricato
                  </div>
                )}
              </div>
              {modified && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-lg text-xs font-bold">
                  <span className="w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                  Modificato
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 px-3 py-1.5 rounded-lg">
                {displayedRows.length} / {rows.length} record
              </div>
              <button onClick={handleAddRow} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2 text-sm font-semibold">
                <Plus className="w-4 h-4" />
                Aggiungi Riga
              </button>
              <button onClick={saveToExcel} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm hover:shadow-md transition-all flex items-center gap-2 text-sm font-semibold">
                <Download className="w-4 h-4" />
                Salva Excel
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div className="mb-6 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-neutral-400" />
              </div>
              <input
                type="text"
                placeholder="Cerca in tutte le colonne..."
                className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-sm dark:text-white placeholder-neutral-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all"
                value={filter}
                onChange={handleFilter}
              />
              {filter && (
                <button
                  onClick={handleClearSearch}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {filter && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-neutral-500 dark:text-neutral-400">
                  {displayedRows.length} risultati
                </span>
              </div>
            )}
          </div>

          {/* Professional Table */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 overflow-hidden">
            {headers.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full" id="data-table" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      {/* Index column (row numbers) - fixed 48px */}
                      <col style={{ width: '48px' }} />
                      {/* Data columns - dynamic widths */}
                      {headers.map((_, i) => (
                        <col key={`col-${i}`} style={{ width: columnWidths[i] || 120 }} />
                      ))}
                      {/* Actions column - fixed 96px */}
                      <col style={{ width: '96px' }} />
                    </colgroup>
                    <thead>
                      <tr className="bg-gradient-to-r from-neutral-50 to-neutral-100 dark:from-neutral-700 dark:to-neutral-600 border-b border-neutral-200 dark:border-neutral-600">
                        <th className="th-index px-4 py-3 text-left text-xs font-bold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider w-12">
                          #
                        </th>
                        {headers.map((h, i) => (
                          <th
                            key={i}
                            colSpan={1}
                            className={`px-4 py-3 text-left text-xs font-bold text-neutral-700 dark:text-neutral-200 uppercase tracking-wider cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors select-none ${
                              sortCol === i ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' : ''
                            }`}
                            onClick={() => handleSort(i)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{h}</span>
                              {sortCol === i && (
                                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center bg-primary-600 dark:bg-primary-500 text-white rounded text-[10px]">
                                  {sortDir > 0 ? '▲' : '▼'}
                                </span>
                              )}
                            </div>
                          </th>
                        ))}
                        <th className="th-actions px-4 py-3 text-center text-xs font-bold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider w-24">
                          Azioni
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-200 dark:divide-neutral-700">
                      {displayedRows.map((row, idx) => (
                        <tr
                          key={row._id}
                          data-id={row._id}
                          className={`group hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors ${
                            editingRowId === row._id
                              ? 'bg-primary-50/50 dark:bg-primary-900/20 border-l-4 border-primary-500'
                              : 'border-l-4 border-transparent'
                          }`}
                        >
                          <td className="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400 font-mono w-12">
                            {idx + 1}
                          </td>
                          {headers.map((h) => {
                            const isEditing = editingRowId === row._id;
                            return (
                              <td key={h} className="px-4 py-3 align-top">
                                {isEditing ? (
                                  <textarea
                                    className="w-full min-h-[60px] p-2.5 bg-white dark:bg-neutral-900 border-2 border-primary-300 dark:border-primary-600 rounded-lg text-sm dark:text-white resize-y focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all font-sans"
                                    data-col={h}
                                    defaultValue={row[h] ?? ''}
                                    onInput={(e) => {
                                      const target = e.target as HTMLTextAreaElement;
                                      target.style.height = 'auto';
                                      target.style.height = target.scrollHeight + 'px';
                                    }}
                                    autoFocus
                                  />
                                ) : (
                                  <div className="text-sm text-neutral-800 dark:text-neutral-200 min-h-[20px]">
                                    {renderCellValue(row[h], h, filter)}
                                  </div>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              {editingRowId === row._id ? (
                                <>
                                  <button
                                    onClick={() => saveRow(row._id)}
                                    className="p-2 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/70 rounded-lg transition-all"
                                    title="Salva modifiche"
                                  >
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="w-4 h-4">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => cancelEdit(row._id)}
                                    className="p-2 bg-neutral-100 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded-lg transition-all"
                                    title="Annulla"
                                  >
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="w-4 h-4">
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => startEdit(row._id)}
                                    className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    title="Modifica riga"
                                  >
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="w-4 h-4">
                                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => deleteRow(row._id)}
                                    className="p-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                                    title="Elimina riga"
                                  >
                                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="w-4 h-4">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                      <path d="M10 11v6M14 11v6" />
                                      <path d="M9 6V4h6v2" />
                                    </svg>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {displayedRows.length === 0 && rows.length > 0 && (
                  <div className="px-8 py-16 text-center">
                    <div className="w-16 h-16 bg-neutral-100 dark:bg-neutral-700 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Search className="w-8 h-8 text-neutral-400" />
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 font-medium">Nessun risultato trovato</p>
                    <p className="text-sm text-neutral-500 dark:text-neutral-500 mt-1">Prova a modificare i criteri di ricerca</p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-24 px-8 text-neutral-500 dark:text-neutral-400">
                <FileSpreadsheet className="w-20 h-20 mb-6 opacity-30" />
                <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300 mb-2">Nessun dato caricato</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-500 mb-6 max-w-md text-center">
                  Carica un file Excel dalla pagina "Importa" per visualizzare i dati estratti in questa tabella.
                </p>
                <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium text-sm">
                  <Upload className="w-4 h-4" />
                  Vai alla pagina Importa
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Import Page */}
      {activePage === 'import' && (
        <div className="flex flex-col items-center justify-center py-12">
          <div
            className={`drop-zone w-full max-w-2xl p-16 text-center border-2 border-dashed rounded-2xl transition-colors ${
              isDragging ? 'drag-over border-primary-500 bg-primary-50 dark:bg-primary-900/20' : 'border-neutral-300 dark:border-neutral-700 hover:border-primary-500'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) readExcelFile(file);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleFileSelect}
            />
            <Upload className="w-16 h-16 mx-auto mb-6 text-neutral-400" />
            <h3 className="text-2xl font-bold mb-2 text-neutral-800 dark:text-white">Trascina qui il file Excel</h3>
            <p className="text-neutral-500 dark:text-neutral-400 mb-4">oppure clicca per sfogliare</p>
            <p className="text-sm text-neutral-400">Supportati: .xlsx, .xls</p>
          </div>

          <div className="mt-8 max-w-2xl w-full bg-white dark:bg-neutral-800 rounded-xl p-6 border border-neutral-200 dark:border-neutral-700">
            <h4 className="font-bold mb-3 text-neutral-800 dark:text-white">Come funziona</h4>
            <ul className="list-disc list-inside space-y-2 text-sm text-neutral-600 dark:text-neutral-300">
              <li>Il file viene letto direttamente nel browser — nessun dato viene inviato a server esterni.</li>
              <li>Vengono estratte le intestazioni dalla prima riga e tutti i record dalle righe successive.</li>
              <li>Le date vengono convertite in formato leggibile. I valori nulli sono mostrati come —.</li>
              <li>Tutti i campi sono modificabili nella tabella e puoi aggiungere nuove righe.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Settings Page */}
      {activePage === 'settings' && (
        <div className="max-w-4xl">
          {/* Statistics */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 mb-6">
            <div className="text-lg font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-primary-600" />
              Statistiche Dataset
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
                <div className="text-xs text-neutral-500 uppercase mb-1">Totale Record</div>
                <div className="text-2xl font-bold text-primary-600">{rows.length}</div>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
                <div className="text-xs text-neutral-500 uppercase mb-1">Colonne</div>
                <div className="text-2xl font-bold text-primary-600">{headers.length}</div>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
                <div className="text-xs text-neutral-500 uppercase mb-1">File Caricato</div>
                <div className="text-sm font-medium break-all">{fileName || '—'}</div>
              </div>
              <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
                <div className="text-xs text-neutral-500 uppercase mb-1">Ultimo Aggiornamento</div>
                <div className="text-sm font-medium">{loadedAt || '—'}</div>
              </div>
            </div>
          </div>

          {/* JSON Backup */}
          <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 mb-6">
            <div className="text-lg font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
              <Clipboard className="w-5 h-5 text-primary-600" />
              Backup & Ripristino JSON
            </div>
            <p className="text-sm text-neutral-500 mb-4">
              Esporta tutti i dati (incluse le righe aggiunte manualmente) in un file <code>.json</code>. Puoi usarlo come backup sicuro da ripristinare in qualsiasi momento.
            </p>
            <div className="flex gap-3 flex-wrap mb-6">
              <button onClick={exportJSON} className="px-4 py-2 border border-primary-200 bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 transition-colors flex items-center gap-2 text-sm font-medium">
                <Download className="w-4 h-4" /> Esporta JSON
              </button>
              <button onClick={copyJSON} className="px-4 py-2 border border-neutral-200 bg-transparent text-neutral-600 hover:bg-neutral-50 transition-colors flex items-center gap-2 text-sm font-medium">
                <Clipboard className="w-4 h-4" /> Copia negli Appunti
              </button>
            </div>

            <div className="border-t border-neutral-200 dark:border-neutral-700 pt-6">
              <div className="text-sm font-bold text-neutral-900 dark:text-white mb-2">Ripristina da Backup</div>
              <textarea
                ref={restoreInputRef}
                className="w-full min-h-[120px] bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg p-3 text-sm font-mono dark:text-white outline-none resize-y"
                placeholder='Incolla qui il JSON del backup... {"headers": [...], "rows": [...], ...}'
              />
              <button
                onClick={restoreFromJSON}
                className="mt-3 px-4 py-2 border border-red-200 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Database className="w-4 h-4" /> Ripristina Backup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}