import { useState, useEffect, useRef } from 'react';
import { FileUp, FileText, Download, CheckCircle, ChevronRight, Settings, Home as HomeIcon, Upload, ArrowLeft, FileIcon, ChevronDown, ChevronUp, User, Package, Sun, Moon, Plus, Trash2, Brain, Database, Bell, RefreshCw, Layout, Save, RotateCcw } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { open, save, ask, message } from '@tauri-apps/plugin-dialog';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';

import { extractFieldsFromDocx, extractTextFromDocx } from './utils/docxParser';
import type { FormField } from './utils/docxParser';
import { autoFillFields, extractTextFromPdf } from './utils/pdfParser';
import { generateDocx } from './utils/documentGenerator';
import { saveTemplateFile, getTemplateFile, getAllTemplatesMeta, deleteTemplate, type TemplateIndex, getSetting, setSetting, getTechnicians, setTechnicians, getCustomLayout, setCustomLayout, type CustomLayout, getCsvPath, setCsvPath, getSavePath, setSavePath, getNextDocNumber, getAiSettings, setAiSettings, type AiSettings, DEFAULT_AI_SETTINGS, getUpdateSettings, checkForUpdates, installUpdate, type UpdateSettings, DEFAULT_UPDATE_SETTINGS, getSectionDefinitions, setSectionDefinitions, type SectionDefinition, DEFAULT_SECTIONS, exportAllSettings, importAllSettings, resetAllSettings } from './utils/storage';
import { DEFAULT_SYSTEM_PROMPT } from './utils/ollama';
import AIExtraction from './AIExtraction';
import './App.css';

type View = 'home' | 'settings' | 'form' | 'download' | 'ai-extraction';

function AutoResizeTextarea({ value, onChange, placeholder, className, onKeyDown }: any) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = (textareaRef.current.scrollHeight) + 'px';
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={className + " resize-none overflow-hidden scroll-py-0"}
      rows={1}
      spellCheck={false}
    />
  );
}


function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [isProcessing, setIsProcessing] = useState(false);

  // Storage State
  const [templateMeta, setTemplateMeta] = useState<(TemplateIndex | undefined)[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [technicians, setTechniciansList] = useState<string[]>([]);
  const [newTechName, setNewTechName] = useState('');
  const [csvPath, setCsvPathState] = useState('');
  const [savePath, setSavePathState] = useState('');
  const [customLayout, setCustomLayoutState] = useState<CustomLayout>({});
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

   // Update State
   const [updateSettings, setUpdateSettingsState] = useState<UpdateSettings>(DEFAULT_UPDATE_SETTINGS);
   const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloaded' | 'error'>('idle');
   const [latestVersion, setLatestVersion] = useState<string>('');
   const [currentVersion, setCurrentVersion] = useState<string>('');
   const [updateBody, setUpdateBody] = useState<string | null>(null);
   const [updateDate, setUpdateDate] = useState<string | null>(null);

  // Form State
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null);
  const [generateSecondDoc, setGenerateSecondDoc] = useState(false);
  const [isAiSaved, setIsAiSaved] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [sectionDefinitions, setSectionDefinitionsState] = useState<SectionDefinition[]>(DEFAULT_SECTIONS);
  const [isSectionsSaved, setIsSectionsSaved] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const actionLock = useRef(false);


  useEffect(() => {
    loadInitialData();
  }, []);

   const loadInitialData = async () => {
     const meta = await getAllTemplatesMeta();
     setTemplateMeta(meta);
     
     const savedTheme = await getSetting<'light' | 'dark'>('theme', 'light');
     console.log('[Theme] Initial load:', savedTheme);
     setTheme(savedTheme);
     applyTheme(savedTheme);

     const techs = await getTechnicians();
     setTechniciansList(techs);

     const savedCsvPath = await getCsvPath();
     setCsvPathState(savedCsvPath);

     const savedSavePath = await getSavePath();
     setSavePathState(savedSavePath);

      const savedAiSettings = await getAiSettings();
      setAiSettingsState(savedAiSettings);

      const updSettings = await getUpdateSettings();
      setUpdateSettingsState(updSettings);

      const version = await import('./utils/storage').then(m => m.getCurrentVersion());
      setCurrentVersion(version);

      const { listen } = await import('@tauri-apps/api/event');
      // 1. Listen for new update available
      listen('update-available', (event: any) => {
        setUpdateStatus('available');
        setLatestVersion(event.payload.version);
        setUpdateBody(typeof event.payload.body === 'string' ? event.payload.body : null);
        setUpdateDate(typeof event.payload.date === 'string' ? event.payload.date : null);
        
        // Notify user if enabled
        if (updSettings.enabled) {
          import('./utils/notifications').then(m => m.sendAppNotification(
            "Nuovo Aggiornamento", 
            `Versione ${event.payload.version} disponibile!`
          ));
        }

        if (updSettings.enabled && updSettings.autoInstall) {
          installUpdate();
        }
      });

      // 2. Listen for update downloaded
      listen('update-downloaded', () => {
        setUpdateStatus('downloaded');
      });

      // 3. Manual check on startup if enabled
      if (updSettings.enabled) {
        checkForUpdates().then(result => {
           if (result.available) {
             setUpdateStatus('available');
             setLatestVersion(result.latestVersion || '');
             setUpdateBody(result.body || null);
             setUpdateDate(result.date || null);
             import('./utils/notifications').then(m => m.sendAppNotification(
                "Nuovo Aggiornamento", 
                `Versione ${result.latestVersion} disponibile!`
              ));
           }
        }).catch(err => console.error('[Update] Startup check error:', err));
      }

      const sections = await getSectionDefinitions();
      setSectionDefinitionsState(sections);
    };

  // Task 8: Drag and Drop Listeners
  useEffect(() => {
    let unlistenDrop: any = null;
    let unlistenEnter: any = null;
    let unlistenLeave: any = null;

    const setupTauriEvents = async () => {
      const { listen } = await import('@tauri-apps/api/event');

      unlistenEnter = await listen('tauri://drag-enter', () => {
        if (currentView === 'form') setIsDragging(true);
      });

      unlistenLeave = await listen('tauri://drag-leave', () => {
        setIsDragging(false);
      });

      unlistenDrop = await listen('tauri://drag-drop', async (event: any) => {
        setIsDragging(false);
        if (currentView !== 'form') return;

        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          try {
            const filePath = paths[0];
            const fileName = filePath.split(/[/\\]/).pop() || 'source';
            const content = await readFile(filePath);
            await processSourceFile(fileName, content);
          } catch (err) {
            console.error('[App] Drag drop error:', err);
          }
        }
      });
    };

    setupTauriEvents();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenEnter) unlistenEnter();
      if (unlistenLeave) unlistenLeave();
    };
  }, [currentView]);


  const applyTheme = (t: 'light' | 'dark') => {
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const toggleTheme = async () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    console.log('[Theme] Switching to:', newTheme);
    setTheme(newTheme);
    applyTheme(newTheme);
    await setSetting('theme', newTheme);
  };

  const handleAddTechnician = async () => {
    if (!newTechName.trim()) return;
    const updated = [...technicians, newTechName.trim()];
    setTechniciansList(updated);
    await setTechnicians(updated);
    setNewTechName('');
  };

  const handleRemoveTechnician = async (index: number) => {
    const updated = technicians.filter((_, i) => i !== index);
    setTechniciansList(updated);
    await setTechnicians(updated);
  };

  const handleGoHome = () => {
    setCurrentView('home');
    setTemplateFile(null);
    setFormFields([]);
  };

  // --- Settings Logic ---
  const handleSlotUpload = async (slotId: string) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      });

      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'template.docx';
        setIsProcessing(true);
        const content = await readFile(selected);
        const file = new File([content], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        
        await saveTemplateFile(slotId, file);
        await loadInitialData();
      }
    } catch (err) {
      console.error("Error picking/saving template", err);
      alert("Errore nel caricamento del template.");
    } finally {
      setIsProcessing(false);
    }
  };


  const handleDeleteSlot = async (slotId: string) => {
    if (deleteConfirming !== slotId) {
      setDeleteConfirming(slotId);
      // Reset after 3 seconds
      setTimeout(() => setDeleteConfirming(null), 3000);
      return;
    }

    console.log('[App] Confirmed deletion of slot:', slotId);
    try {
      await deleteTemplate(slotId);
      setDeleteConfirming(null);
      await loadInitialData();
    } catch (err) {
      console.error('[App] Error during deletion:', err);
    }
  };

  // --- Backup & Restore Logic (Task 13 & 14) ---
  const handleExportSettings = async () => {
    if (isProcessing || actionLock.current) return;
    actionLock.current = true;
    setIsProcessing(true);
    try {
      const data = await exportAllSettings();
      const selected = await save({
        filters: [{ name: 'Backup Settings', extensions: ['json'] }],
        defaultPath: 'rapportini_backup.json'
      });

      if (selected) {
        await writeTextFile(selected, JSON.stringify(data, null, 2));
        await message("Impostazioni esportate correttamente!", { title: 'Successo', kind: 'info' });
      }
    } catch (err) {
      console.error("Export error:", err);
      await message("Errore nell'esportazione delle impostazioni.", { title: 'Errore', kind: 'error' });
    } finally {
      setIsProcessing(false);
      actionLock.current = false;
    }
  };

  const handleImportSettings = async () => {
    if (isProcessing || actionLock.current) return;
    actionLock.current = true;
    setIsProcessing(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Backup Settings', extensions: ['json'] }]
      });

      if (selected && typeof selected === 'string') {
        const confirmed = await ask(
          "L'importazione sovrascriverà tutti i settaggi attuali e i template. Vuoi procedere?",
          { title: 'Conferma Ripristino', kind: 'warning' }
        );
        
        if (confirmed) {
          const content = await readFile(selected);
          const text = new TextDecoder().decode(content);
          const data = JSON.parse(text);

          await importAllSettings(data);
          await message("Impostazioni ripristinate con successo! L'applicazione verrà ricaricata.", { title: 'Successo', kind: 'info' });
          window.location.reload();
          return;
        }
      }
    } catch (err) {
      console.error("Import error:", err);
      await message("Errore nell'importazione delle impostazioni. Verifica il file.", { title: 'Errore', kind: 'error' });
    } finally {
      setIsProcessing(false);
      actionLock.current = false;
    }
  };

  const handleResetSettings = async () => {
    if (isProcessing || actionLock.current) return;
    if (!resetConfirming) {
      setResetConfirming(true);
      setTimeout(() => setResetConfirming(false), 3000);
      return;
    }

    actionLock.current = true;
    setIsProcessing(true);
    try {
      await resetAllSettings();
      await message("Impostazioni ripristinate ai valori predefiniti.", { title: 'Successo', kind: 'info' });
      window.location.reload();
    } catch (err) {
      console.error("Reset error:", err);
      await message("Errore durante il reset.", { title: 'Errore', kind: 'error' });
      setIsProcessing(false);
      actionLock.current = false;
    }
  };

  // --- Home Logic ---
  const handleSelectTemplate = async (slotId: string) => {
    setIsProcessing(true);
    try {
      const file = await getTemplateFile(slotId);
      if (!file) {
        alert("Template non trovato.");
        return;
      }
      setTemplateFile(file);
      setActiveSlotId(slotId);
      setGenerateSecondDoc(false);

      // Extract fields and load specific layout
      const [fields, layout] = await Promise.all([
        extractFieldsFromDocx(file),
        getCustomLayout(slotId)
      ]);
      
      setCustomLayoutState(layout);

      // Task 4: Auto-fill N_DOC if savePath is set
      const nextNum = await getNextDocNumber(savePath);
      if (nextNum) {
        setFormFields(fields.map(f => {
          const labelUc = f.label.toUpperCase();
          if (labelUc.includes('N_DOC') || labelUc.includes('N.DOC') || labelUc.includes('NUMERO DOCUMENTO')) {
             return { ...f, value: nextNum };
          }
          return f;
        }));
      } else {
        setFormFields(fields);
      }

      setCurrentView('form');
    } catch (err) {
      console.error("Error loading template for form", err);
      alert("Errore caricamento template.");
    } finally {
      setIsProcessing(false);
    }
  };

  const processSourceFile = async (fileName: string, content: Uint8Array) => {
    setIsProcessing(true);
    try {
      console.log('[App] Processing source file:', fileName);
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      const isDocx = fileName.toLowerCase().endsWith('.docx');
      
      if (!isPdf && !isDocx) {
        alert("Formato non supportato. Trascina un file PDF o DOCX.");
        return;
      }

      const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      let extractedData: any = '';
      if (isPdf) {
        extractedData = await extractTextFromPdf(content);
      } else if (isDocx) {
        const file = new File([content as any], fileName, { type: mimeType });
        extractedData = await extractTextFromDocx(file);
      }

      if (extractedData) {
        console.log('[App] Data extracted, auto-filling...');
        const updatedFields = autoFillFields(formFields, extractedData);
        setFormFields(updatedFields);
      }
    } catch (err) {
      console.error("[App] Error processing source file:", err);
      alert("Errore nell'estrazione del testo dalla sorgente.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddRow = (sectionId: string) => {
    // 1. Get all fields in this section
    const sectionFields = formFields.filter(f => getFieldSection(f) === sectionId);
    
    // 2. Identify indexed fields (ending in _N or N)
    // We check both label and ID
    const indexedFields = sectionFields.filter(f => /_(\d+)$/.test(f.label) || /_(\d+)$/.test(f.id));
    if (indexedFields.length === 0) return;

    // 3. Find max index N
    let maxN = 0;
    indexedFields.forEach(f => {
      const matchLabel = f.label.match(/_(\d+)$/);
      const matchId = f.id.match(/_(\d+)$/);
      if (matchLabel) maxN = Math.max(maxN, parseInt(matchLabel[1], 10));
      if (matchId) maxN = Math.max(maxN, parseInt(matchId[1], 10));
    });

    if (maxN === 0) return;

    // 4. Find fields with index 1 (as templates for the new row)
    const fieldsIndex1 = indexedFields.filter(f => f.label.endsWith('_1') || f.id.endsWith('_1'));
    if (fieldsIndex1.length === 0) return;

    // 5. Create new fields for maxN + 1
    const nextN = maxN + 1;
    const newFields: FormField[] = fieldsIndex1.map(f => {
      const newLabel = f.label.replace(/_1$/, `_${nextN}`);
      const newId = f.id.replace(/_1$/, `_${nextN}`);
      return {
        ...f,
        id: newId,
        label: newLabel,
        value: ''
      };
    });

    setFormFields([...formFields, ...newFields]);
  };

  const handleSourceUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ 
          name: 'Sorgente Dati', 
          extensions: ['pdf', 'docx'] 
        }]
      });

      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'source';
        const content = await readFile(selected);
        await processSourceFile(fileName, content);
      }
    } catch (err) {
      console.error("[App] Error picking source file:", err);
    }
  };

  const handleFieldChange = (id: string, value: string) => {
    setFormFields(prev => prev.map(f => f.id === id ? { ...f, value } : f));
  };

  const handleGenerate = () => {
    if (!templateFile) return;
    setCurrentView('download');
  };

  const handleDownloadDocx = async () => {
    if (!templateFile) return;

    // Find N_DOC field (case insensitive)
    const nDocField = formFields.find(f => 
      f.label.toUpperCase() === 'N_DOC' || 
      f.id.toUpperCase() === 'N_DOC' ||
      f.label.toUpperCase() === 'N.DOC' ||
      f.id.toUpperCase() === 'N.DOC' ||
      f.label.toUpperCase() === 'NUMERO DOCUMENTO'
    );

    let baseName = '';
    let outputName = 'rapportino.docx';
    if (nDocField && nDocField.value.trim()) {
      baseName = nDocField.value.trim();
      outputName = `${baseName}_.docx`;
    }

    // Generate First Document
    await generateDocx(templateFile, formFields, outputName);

    // Task 6: Generate Second Document if requested
    const isInstallation = templateFile.name.toLowerCase().includes('installazione') && templateFile.name.toLowerCase().includes('collaudo');
    if (generateSecondDoc && isInstallation) {
      console.log('[App] Generating second document (Formazione del Personale)...');
      
      // Find the template by name in existing slots
      const secondTemplateMeta = templateMeta.find(m => 
        m?.name.toLowerCase().includes('formazione') && 
        m?.name.toLowerCase().includes('personale')
      );

      if (secondTemplateMeta) {
        try {
          const secondTemplateFile = await getTemplateFile(secondTemplateMeta.id);
          if (secondTemplateFile) {
            const secondOutputName = baseName ? `${baseName}P_.docx` : 'formazione_personale.docx';
            // Small delay to prevent issues with multiple dialogs if they happen too fast
            await new Promise(r => setTimeout(r, 500));
            await generateDocx(secondTemplateFile, formFields, secondOutputName);
          }
        } catch (err) {
          console.error('[App] Error generating second doc:', err);
          alert('Errore nella generazione del secondo documento.');
        }
      } else {
        alert('Attenzione: Template "Formazione del Personale" non trovato negli slot. Caricalo per poter generare il secondo file.');
      }
    }
  };

  // Sorting logic for form fields
  const sortTextFields = (fields: FormField[]) => {
    return [...fields].sort((a, b) => {
      // 1. Check custom layout first
      const layoutA = customLayout[a.id];
      const layoutB = customLayout[b.id];
      if (layoutA && layoutB && layoutA.sectionId === layoutB.sectionId) {
        return layoutA.order - layoutB.order;
      }

      // 2. Default sorting logic
      const getPriority = (label: string) => {
        const l = label.toUpperCase();
        if (l.includes('QUALIFICA') || l.includes('NOME') || l.includes('FIRMA')) return 100;
        if (l.includes('ARTICOLO') || l.includes('DESCRIZIONE') || l.startsWith('Q_') || l.startsWith('SN_')) return 50;
        return 10;
      };

      const getIndex = (label: string) => {
        const match = label.match(/_(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      };

      const getTypeOrder = (label: string) => {
        const l = label.toUpperCase();
        if (l.includes('ARTICOLO')) return 1;
        if (l.includes('DESCRIZIONE')) return 2;
        if (l.startsWith('Q_')) return 3;
        if (l.startsWith('SN_')) return 4;
        if (l.includes('QUALIFICA')) return 1;
        if (l.includes('NOME')) return 2;
        if (l.includes('FIRMA')) return 3;
        return 0;
      };

      const pA = getPriority(a.label);
      const pB = getPriority(b.label);
      if (pA !== pB) return pA - pB;

      const iA = getIndex(a.label);
      const iB = getIndex(b.label);
      if (iA !== iB) return iA - iB;

      const tA = getTypeOrder(a.label);
      const tB = getTypeOrder(b.label);
      if (tA !== tB) return tA - tB;

      return a.label.localeCompare(b.label);
    });
  };

    // --- Shared Section Logic ---
    const getFieldSection = (field: FormField): string => {
      if (customLayout[field.id]?.sectionId) {
        return customLayout[field.id].sectionId;
      }
      const l = field.label.toLowerCase();
      if (l.includes('cliente') || l.includes('ragione_sociale') || l.includes('indirizzo') || l.includes('cap') || l.includes('citta') || l.includes('reparto') || l.includes('luogo') || l.includes('destinazione')) return 'client';
      if (l.includes('richiesta') || l.includes('data') || l.includes('documento') || l.match(/^n_/) || l.includes('riferimento')) return 'refs';
      if (l.includes('articolo') || l.includes('descrizione') || l.startsWith('q_') || l.startsWith('sn_')) return 'items';
      if (l.includes('qualifica') || l.includes('nome') || l.includes('firma') || l.includes('tecnico')) return 'staff';
      return 'other';
    };

    const moveField = async (fieldId: string, direction: 'up' | 'down') => {
      const field = formFields.find(f => f.id === fieldId);
      if (!field) return;
      
      const sectionId = getFieldSection(field);
      const sectionFields = formFields
        .filter(f => f.type !== 'checkbox' && getFieldSection(f) === sectionId)
        .sort((a, b) => (customLayout[a.id]?.order ?? 999) - (customLayout[b.id]?.order ?? 999));
        
      const currentIndex = sectionFields.findIndex(f => f.id === fieldId);
      const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      
      if (newIndex < 0 || newIndex >= sectionFields.length) return;
      
      // Swap items
      const newSectionFields = [...sectionFields];
      const [movedItem] = newSectionFields.splice(currentIndex, 1);
      newSectionFields.splice(newIndex, 0, movedItem);
      
      const newLayout = { ...customLayout };
      newSectionFields.forEach((f, idx) => {
        newLayout[f.id] = { sectionId, order: idx };
      });
      
      setCustomLayoutState(newLayout);
      if (activeSlotId) {
        await setCustomLayout(activeSlotId, newLayout);
      }
    };

    const handleSectionChange = async (fieldId: string, newSectionId: string) => {
      // Find current field
      const field = formFields.find(f => f.id === fieldId);
      if (!field) return;

      const sectionFields = formFields.filter(f => getFieldSection(f) === newSectionId);
      const newLayout = { 
        ...customLayout,
        [fieldId]: { sectionId: newSectionId, order: sectionFields.length }
      };

      setCustomLayoutState(newLayout);
      if (activeSlotId) {
        await setCustomLayout(activeSlotId, newLayout);
      }

      console.log(`[Layout] Moved field ${fieldId} to section ${newSectionId}`);
    };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-900 transition-colors duration-300 relative">
      {/* Task 8: Drag and Drop Overlay */}
      {isDragging && currentView === 'form' && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-12 bg-black/40 backdrop-blur-sm pointer-events-none"
        >
          <div 
            className="w-full h-full border-4 border-dashed border-primary-500 rounded-3xl flex flex-col items-center justify-center bg-white dark:bg-neutral-900 shadow-2xl animate-in zoom-in-95 duration-200"
          >
            <Upload className="w-20 h-20 text-primary-500 mb-4 animate-bounce" />
            <h3 className="text-3xl font-black text-neutral-900 dark:text-white mb-2 text-center px-4">Rilascia il file sorgente</h3>
            <p className="text-xl text-neutral-600 dark:text-neutral-400 text-center px-4">PDF o DOCX verranno usati per l'auto-compilazione del template</p>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="bg-white dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleGoHome}
          >
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <FileIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary-700 to-primary-500 bg-clip-text text-transparent">
              Rapportini<span className="font-light text-neutral-800 dark:text-neutral-200">Tech</span>
            </h1>
          </div>
          <div className="flex gap-2">
            {currentView !== 'home' && (
              <button
                onClick={handleGoHome}
                className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                title="Home"
              >
                <HomeIcon className="w-6 h-6" />
              </button>
            )}
            <button
              onClick={toggleTheme}
              className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              title={theme === 'light' ? 'Tema Scuro' : 'Tema Chiaro'}
            >
              {theme === 'light' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
            </button>
            <button
              onClick={() => { setCurrentView('ai-extraction'); setTemplateFile(null); setFormFields([]); }}
              className="p-2 text-neutral-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              title="Estrazione AI Automatica"
            >
              <Brain className="w-6 h-6" />
            </button>
            {currentView !== 'settings' && (
              <button
                onClick={() => setCurrentView('settings')}
                className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                title="Impostazioni Template"
              >
                <Settings className="w-6 h-6" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* --- VIEW: HOME --- */}
        {currentView === 'home' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Seleziona un Template</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
                Scegli il modello di rapportino che desideri compilare. Se gli slot sono vuoti, puoi caricarli dalle impostazioni.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
              {[1, 2, 3].map(slotNum => {
                const id = slotNum.toString();
                const meta = templateMeta[slotNum - 1];

                return (
                  <div
                    key={id}
                    onClick={() => meta && !isProcessing ? handleSelectTemplate(id) : null}
                    className={`relative overflow-hidden rounded-2xl border-2 transition-all duration-300 flex flex-col items-center justify-center p-10 text-center h-64
                      ${meta
                        ? 'border-primary-200 bg-white dark:bg-neutral-800 dark:border-neutral-700 hover:border-primary-500 hover:shadow-xl hover:shadow-primary-500/10 cursor-pointer group'
                        : 'border-dashed border-neutral-300 bg-neutral-100 dark:bg-neutral-800/50 opacity-60 cursor-not-allowed'
                      }
                    `}
                  >
                    {meta ? (
                      <>
                        <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                          <FileText className="w-8 h-8 text-primary-600" />
                        </div>
                        <h3 className="text-xl font-bold text-neutral-800 dark:text-neutral-100 mb-2">Template {slotNum}</h3>
                        <p className="text-sm text-neutral-500 truncate w-full px-4">{meta.name}</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-neutral-200 dark:bg-neutral-700 rounded-full flex items-center justify-center mb-4">
                          <FileUp className="w-8 h-8 text-neutral-400" />
                        </div>
                        <h3 className="text-lg font-bold text-neutral-500 mb-2">Slot Vuoto</h3>
                        <p className="text-xs text-neutral-400">Nessun file assegnato</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {!templateMeta.some(m => !!m) && (
              <div className="mt-12 text-center">
                <button
                  onClick={() => setCurrentView('settings')}
                  className="px-6 py-3 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 shadow-sm rounded-xl text-primary-600 font-semibold hover:bg-primary-50 dark:hover:bg-neutral-700 transition-colors"
                >
                  Vai alle Impostazioni per caricare i file
                </button>
              </div>
            )}
          </div>
        )}

        {/* --- VIEW: SETTINGS --- */}
        {currentView === 'settings' && (
          <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={handleGoHome}
                className="p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white">Gestione Template</h2>
                <p className="text-neutral-600 dark:text-neutral-400">Assegna un file .docx a ciascuno slot per renderlo disponibile nella Home.</p>
              </div>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-100 dark:divide-neutral-700">
              {[1, 2, 3].map(slotNum => {
                const id = slotNum.toString();
                const meta = templateMeta[slotNum - 1];

                return (
                  <div key={id} className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors">
                    <div className="flex items-center gap-4 flex-1">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-bold text-xl
                        ${meta ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-700'}`}>
                        {slotNum}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-lg font-bold text-neutral-900 dark:text-white mb-1">Slot Template {slotNum}</h4>
                        {meta ? (
                          <p className="text-sm text-green-600 dark:text-green-400 font-medium flex items-center gap-1 truncate pb-1">
                            <CheckCircle className="w-4 h-4 shrink-0" />
                            {meta.name}
                          </p>
                        ) : (
                          <p className="text-sm text-neutral-500">Nessun file assegnato.</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      {meta && (
                        <button
                          onClick={() => handleDeleteSlot(id)}
                          className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors 
                            ${deleteConfirming === id 
                              ? 'bg-red-600 text-white hover:bg-red-700' 
                              : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400'}`}
                        >
                          {deleteConfirming === id ? 'Confermi Rimozione?' : 'Rimuovi'}
                        </button>
                      )}
                      <div className="relative group overflow-hidden w-full sm:w-auto">
                        <button 
                          onClick={() => handleSlotUpload(id)}
                          disabled={isProcessing}
                          className="w-full sm:w-auto px-6 py-2 text-sm font-bold text-white bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white rounded-lg transition-colors shrink-0 disabled:opacity-50"
                        >
                          {meta ? 'Sostituisci' : 'Carica File DOCX'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Technicians Management */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <User className="w-6 h-6 text-primary-600" />
                Gestione Tecnici
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Aggiungi i nomi dei tecnici per poterli selezionare velocemente nei form.</p>
              
              <div className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={newTechName}
                  onChange={(e) => setNewTechName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTechnician()}
                  placeholder="Nome Tecnico (es. Mario Rossi)"
                  className="flex-1 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-transparent dark:text-white"
                />
                <button
                  onClick={handleAddTechnician}
                  className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Aggiungi
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {technicians.map((name, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-700/50 rounded-lg border border-neutral-100 dark:border-neutral-700 group">
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">{name}</span>
                    <button
                      onClick={() => handleRemoveTechnician(index)}
                      className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {technicians.length === 0 && (
                  <div className="col-span-full py-4 text-center text-neutral-400 italic">
                    Nessun tecnico aggiunto.
                  </div>
                )}
              </div>
            </div>

            {/* CSV Database Settings */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <Database className="w-6 h-6 text-emerald-500" />
                Database CSV Pandetta
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Seleziona il file CSV principale in cui verranno salvati tutti gli interventi elaborati dall'AI.</p>
              
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  readOnly
                  value={csvPath || 'Nessun file selezionato...'}
                  className="flex-1 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 truncate"
                />
                <button
                  onClick={async () => {
                    const selected = await open({
                        multiple: false,
                        filters: [{ name: 'CSV Document', extensions: ['csv'] }]
                    });
                    if (selected && typeof selected === 'string') {
                        setCsvPathState(selected);
                        await setCsvPath(selected);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 text-white font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-white transition-colors"
                >
                  Seleziona CSV
                </button>
              </div>
            </div>

            {/* Default Save Path Settings */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <Download className="w-6 h-6 text-primary-600" />
                Percorso di Salvataggio Predefinito
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Seleziona la cartella in cui verranno salvati i documenti generati. Verrà utilizzata anche per calcolare il prossimo numero di documento.</p>
              
              <div className="flex gap-3 items-center">
                <input
                  type="text"
                  readOnly
                  value={savePath || 'Nessuna cartella selezionata...'}
                  className="flex-1 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 truncate"
                />
                <button
                  onClick={async () => {
                    const selected = await open({
                        directory: true,
                        multiple: false,
                    });
                    if (selected && typeof selected === 'string') {
                        setSavePathState(selected);
                        await setSavePath(selected);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 text-white font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-white transition-colors"
                >
                  Sfoglia Cartella
                </button>
              </div>
            </div>

            {/* AI Settings */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <Brain className="w-6 h-6 text-primary-600" />
                  Impostazioni Intelligenza Artificiale
                </h3>
                <button
                  onClick={async () => {
                    setIsProcessing(true);
                    await setAiSettings(aiSettings);
                    setIsProcessing(false);
                    setIsAiSaved(true);
                    setTimeout(() => setIsAiSaved(false), 3000);
                  }}
                  className={`px-4 py-2 font-bold rounded-lg transition-all duration-300 flex items-center gap-2 text-sm shadow-sm 
                    ${isAiSaved 
                      ? 'bg-emerald-600 text-white shadow-emerald-500/20' 
                      : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20'}`}
                >
                  {isAiSaved ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Impostazioni Salvate!
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 shadow-sm" />
                      Salva Impostazioni AI
                    </>
                  )}
                </button>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Configura i parametri per la connessione a Ollama e il comportamento del modello AI.</p>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <Bell className={`w-5 h-5 ${aiSettings.notificationsEnabled ? 'text-primary-600' : 'text-neutral-400'}`} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Notifiche Completamento</h4>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-neutral-500">Invia una notifica quando l'analisi IA è terminata.</p>
                        {aiSettings.notificationsEnabled && (
                          <button 
                            onClick={() => import('./utils/notifications').then(m => m.sendAppNotification("Test Notifica", "Se vedi questo, le notifiche funzionano!"))}
                            className="text-[10px] bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 rounded hover:bg-neutral-300 transition-colors"
                          >
                            Invia Test
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      const newValue = !aiSettings.notificationsEnabled;
                      if (newValue) {
                        try {
                          const { requestPermission, isPermissionGranted } = await import('@tauri-apps/plugin-notification');
                          let hasPermission = await isPermissionGranted();
                          if (!hasPermission) {
                            await requestPermission();
                          }
                        } catch (e) {
                          console.error('Notification plugin error:', e);
                        }
                      }
                      setAiSettingsState({ ...aiSettings, notificationsEnabled: newValue });
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ring-2 ring-transparent focus:ring-primary-500
                      ${aiSettings.notificationsEnabled ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                        ${aiSettings.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Endpoint Ollama URL</label>
                    <input
                      type="text"
                      value={aiSettings.ollamaUrl}
                      onChange={(e) => setAiSettingsState({ ...aiSettings, ollamaUrl: e.target.value })}
                      placeholder="http://127.0.0.1:11434"
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Modello (Model Name)</label>
                    <input
                      type="text"
                      value={aiSettings.ollamaModel}
                      onChange={(e) => setAiSettingsState({ ...aiSettings, ollamaModel: e.target.value })}
                      placeholder="llama3.2"
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Temperatura ({aiSettings.temperature})</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={aiSettings.temperature}
                      onChange={(e) => setAiSettingsState({ ...aiSettings, temperature: parseFloat(e.target.value) })}
                      className="w-full h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
                    />
                    <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
                      <span>Rigoroso (0)</span>
                      <span>Creativo (1)</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Max Tokens ({aiSettings.numPredict})</label>
                    <input
                      type="number"
                      value={aiSettings.numPredict}
                      onChange={(e) => setAiSettingsState({ ...aiSettings, numPredict: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest">Istruzioni di Sistema (Custom Prompt Override)</label>
                    <button
                      onClick={() => setAiSettingsState({ ...aiSettings, systemPrompt: '' })}
                      className="text-[10px] font-bold text-primary-600 hover:text-primary-700 underline"
                    >
                      Ripristina Default
                    </button>
                  </div>
                  <textarea
                    value={aiSettings.systemPrompt || ''}
                    onChange={(e) => setAiSettingsState({ ...aiSettings, systemPrompt: e.target.value })}
                    placeholder="Il testo inserito qui sovrascriverà il prompt di default..."
                    className="w-full h-48 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 resize-none font-mono text-xs"
                  />
                  
                  {!aiSettings.systemPrompt && (
                    <div className="mt-4 p-4 bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-neutral-100 dark:border-neutral-700">
                      <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Brain className="w-3 h-3" />
                        Prompt In Uso (Default):
                      </p>
                      <pre className="text-[10px] text-neutral-500 whitespace-pre-wrap font-sans leading-relaxed italic">
                        {DEFAULT_SYSTEM_PROMPT}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>


            {/* Section Definitions Management */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <Layout className="w-6 h-6 text-primary-600" />
                  Personalizzazione Sezioni
                </h3>
                <button
                  onClick={async () => {
                    setIsProcessing(true);
                    await setSectionDefinitions(sectionDefinitions);
                    setIsProcessing(false);
                    setIsSectionsSaved(true);
                    setTimeout(() => setIsSectionsSaved(false), 3000);
                  }}
                  className={`px-4 py-2 font-bold rounded-lg transition-all duration-300 flex items-center gap-2 text-sm shadow-sm 
                    ${isSectionsSaved 
                      ? 'bg-emerald-600 text-white shadow-emerald-500/20' 
                      : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20'}`}
                >
                  {isSectionsSaved ? (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Sezioni Salvate!
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4 shadow-sm" />
                      Salva Sezioni
                    </>
                  )}
                </button>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Personalizza le sezioni appariranno nei template relativi ai Rapportini. Puoi cambiare i nomi e le icone (usa i nomi delle icone Lucide).</p>
              
              <div className="space-y-4">
                {sectionDefinitions.map((sec, idx) => {
                  const Icon = (LucideIcons as any)[sec.icon] || LucideIcons.HelpCircle;
                  return (
                    <div key={sec.id} className="flex flex-col sm:flex-row gap-4 p-4 bg-neutral-50 dark:bg-neutral-700/50 rounded-xl border border-neutral-100 dark:border-neutral-700">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg flex items-center justify-center shrink-0 border border-neutral-200 dark:border-neutral-600">
                          <Icon className="w-5 h-5 text-primary-600" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <div className="flex gap-2">
                             <div className="flex-1">
                               <label className="block text-[10px] uppercase font-black text-neutral-400 mb-1">Titolo Sezione</label>
                               <input 
                                 type="text" 
                                 value={sec.title}
                                 onChange={(e) => {
                                   const next = [...sectionDefinitions];
                                   next[idx].title = e.target.value;
                                   setSectionDefinitionsState(next);
                                 }}
                                 className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                               />
                             </div>
                             <div className="w-32">
                               <label className="block text-[10px] uppercase font-black text-neutral-400 mb-1">Icona Lucide</label>
                               <input 
                                 type="text" 
                                 value={sec.icon}
                                 onChange={(e) => {
                                   const next = [...sectionDefinitions];
                                   next[idx].icon = e.target.value;
                                   setSectionDefinitionsState(next);
                                 }}
                                 placeholder="User, Package..."
                                 className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                               />
                             </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button 
                          onClick={() => {
                            if (idx === 0) return;
                            const next = [...sectionDefinitions];
                            [next[idx-1], next[idx]] = [next[idx], next[idx-1]];
                            setSectionDefinitionsState(next);
                          }}
                          className="p-2 text-neutral-400 hover:text-primary-600"
                        >
                          <ChevronUp className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            if (idx === sectionDefinitions.length - 1) return;
                            const next = [...sectionDefinitions];
                            [next[idx], next[idx+1]] = [next[idx+1], next[idx]];
                            setSectionDefinitionsState(next);
                          }}
                          className="p-2 text-neutral-400 hover:text-primary-600"
                        >
                          <ChevronDown className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            setSectionDefinitionsState(sectionDefinitions.filter((_, i) => i !== idx));
                          }}
                          className="p-2 text-neutral-400 hover:text-red-500"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  const newId = `custom_${Date.now()}`;
                  setSectionDefinitionsState([...sectionDefinitions, { id: newId, title: 'Nuova Sezione', icon: 'Type' }]);
                }}
                className="mt-6 w-full py-3 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500 hover:border-primary-500 hover:text-primary-500 transition-all font-bold flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Aggiungi Nuova Sezione
              </button>
            </div>


            {/* Update Settings */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <RefreshCw className="w-6 h-6 text-primary-600" />
                  Aggiornamenti Applicazione
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      setUpdateStatus('checking');
                      const result = await import('./utils/storage').then(m => m.checkForUpdates());
                      if (result.available) {
                        setUpdateStatus('available');
                        setLatestVersion(result.latestVersion || '');
                        setUpdateBody(result.body || null);
                        setUpdateDate(result.date || null);
                      } else {
                        setUpdateStatus('idle');
                      }
                    }}
                    disabled={updateStatus === 'checking' || isProcessing}
                    className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
                  >
                    {updateStatus === 'checking' ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Verifica...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Controlla Aggiornamenti
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Verifica la disponibilità di nuove versioni dell'applicazione e installa gli aggiornamenti automaticamente.</p>

              <div className="space-y-6">
                {/* Current Version Display */}
                <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <Package className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Versione Corrente</h4>
                      <p className="text-xs text-neutral-500">{currentVersion || 'Caricamento...'}</p>
                    </div>
                  </div>
                  {latestVersion && (
                    <div className="text-right">
                      <p className="text-xs font-bold text-primary-600">Nuova: {latestVersion}</p>
                    </div>
                  )}
                </div>

                {/* Update Status & Actions */}
                {updateStatus === 'available' && (
                  <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900/50 rounded-full flex items-center justify-center shrink-0">
                        <Download className="w-4 h-4 text-primary-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-primary-800 dark:text-primary-400 mb-1">Aggiornamento Disponibile!</h4>
                        {updateBody && (
                          <p className="text-xs text-primary-700 dark:text-primary-500 mb-2">{updateBody}</p>
                        )}
                        {updateDate && (
                          <p className="text-[10px] text-primary-600/70 dark:text-primary-500/70">
                            Pubblicato: {new Date(updateDate).toLocaleDateString('it-IT')}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        setIsProcessing(true);
                        try {
                          await import('./utils/storage').then(m => m.installUpdate());
                          setUpdateStatus('downloaded');
                        } catch (e) {
                          console.error('Install error:', e);
                          setUpdateStatus('error');
                        } finally {
                          setIsProcessing(false);
                        }
                      }}
                      disabled={isProcessing}
                      className="w-full px-4 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                    >
                      {isProcessing && updateStatus === 'available' ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Installazione...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          Scarica e Installa Aggiornamento
                        </>
                      )}
                    </button>
                  </div>
                )}

                {updateStatus === 'downloaded' && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center shrink-0">
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-green-800 dark:text-green-400">Aggiornamento Pronto</h4>
                        <p className="text-xs text-green-700 dark:text-green-500">L'aggiornamento è stato scaricato e verrà installato al prossimo riavvio dell'app.</p>
                      </div>
                    </div>
                  </div>
                )}

                {updateStatus === 'error' && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-red-100 dark:bg-red-900/50 rounded-full flex items-center justify-center shrink-0">
                        <span className="text-red-600 text-xs">!</span>
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-red-800 dark:text-red-400">Errore Aggiornamento</h4>
                        <p className="text-xs text-red-700 dark:text-red-500">Impossibile verificare o installare gli aggiornamenti. Riprova più tardi.</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Settings Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                        <RefreshCw className={`w-5 h-5 ${updateSettings.enabled ? 'text-primary-600' : 'text-neutral-400'}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Controllo Automatico</h4>
                        <p className="text-xs text-neutral-500">Verifica aggiornamenti all'avvio</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !updateSettings.enabled;
                        await setUpdateSettingsState({ ...updateSettings, enabled: newValue });
                        await import('./utils/storage').then(m => m.setUpdateSettings({ ...updateSettings, enabled: newValue }));
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ring-2 ring-transparent focus:ring-primary-500
                        ${updateSettings.enabled ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                          ${updateSettings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                        <Download className={`w-5 h-5 ${updateSettings.autoInstall ? 'text-primary-600' : 'text-neutral-400'}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Installazione Automatica</h4>
                        <p className="text-xs text-neutral-500">Installa automaticamente</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !updateSettings.autoInstall;
                        await setUpdateSettingsState({ ...updateSettings, autoInstall: newValue });
                        await import('./utils/storage').then(m => m.setUpdateSettings({ ...updateSettings, autoInstall: newValue }));
                      }}
                      disabled={!updateSettings.enabled}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ring-2 ring-transparent focus:ring-primary-500 disabled:opacity-50
                        ${updateSettings.autoInstall ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                          ${updateSettings.autoInstall ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Backup & Restore Settings (Task 13 & 14) */}
            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <Save className="w-6 h-6 text-primary-600" />
                Backup & Ripristino
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Salva o ripristina tutte le impostazioni dell'applicazione (tecnici, percorsi, configurazioni IA e template).</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <button
                  onClick={handleExportSettings}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-3 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors font-bold disabled:opacity-50"
                >
                  <Download className="w-5 h-5" />
                  Esporta Tutto (JSON)
                </button>
                <button
                  onClick={handleImportSettings}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-3 p-4 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors font-bold shadow-sm disabled:opacity-50"
                >
                  <Upload className="w-5 h-5" />
                  Importa Backup
                </button>
              </div>

              <div className="pt-6 border-t border-neutral-100 dark:border-neutral-700">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-red-600 flex items-center gap-2">
                      <RotateCcw className="w-4 h-4" />
                      Reset alle impostazioni di fabbrica
                    </h4>
                    <p className="text-xs text-neutral-500">Elimina tutti i settaggi e i template caricati.</p>
                  </div>
                  <button
                    onClick={handleResetSettings}
                    disabled={isProcessing}
                    className={`px-6 py-2 text-sm font-bold rounded-lg transition-all disabled:opacity-50
                      ${resetConfirming 
                        ? 'bg-red-600 text-white animate-pulse' 
                        : 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400'}`}
                  >
                    {resetConfirming ? 'Sei sicuro? Clicca di nuovo' : 'Esegui Reset'}
                  </button>
                </div>
              </div>
            </div>

            {isProcessing && <div className="mt-4 text-center text-primary-600 font-semibold animate-pulse">Salvataggio in corso...</div>}

          </div>
        )}

        {/* --- VIEW: FORM COMPILATION --- */}
        {currentView === 'form' && (
          <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

            <div className="flex items-center gap-4 mb-8 bg-white dark:bg-neutral-800 p-6 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700">
              <div className="w-16 h-16 bg-primary-50 dark:bg-primary-900/20 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-8 h-8 text-primary-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-1">Compilazione Documento</h2>
                <p className="text-neutral-500 dark:text-neutral-400 text-sm">{templateFile?.name}</p>
              </div>

              <div className="relative group overflow-hidden shrink-0 hidden sm:block">
                <button 
                  onClick={handleSourceUpload}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white text-white font-bold rounded-xl transition-colors shadow-md disabled:opacity-50"
                >
                  <Upload className="w-5 h-5" />
                  {isProcessing ? 'Analisi...' : 'Auto-Compila da PDF'}
                </button>
              </div>
            </div>

            {/* Auto compile mobile button */}
            <div className="relative group overflow-hidden sm:hidden mb-6 w-full">
              <button 
                onClick={handleSourceUpload}
                disabled={isProcessing}
                className="w-full flex justify-center items-center gap-2 px-5 py-4 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 text-white font-bold rounded-xl transition-colors shadow-md text-lg disabled:opacity-50"
              >
                <Upload className="w-6 h-6" />
                {isProcessing ? 'Analisi...' : 'Auto-Compila da PDF'}
              </button>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-10">

              {/* Task 6: Option for second document (Formazione del Personale) */}
              {templateFile?.name.toLowerCase().includes('installazione') && templateFile?.name.toLowerCase().includes('collaudo') && (
                <div className="mb-8 p-6 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-2xl flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white dark:bg-neutral-800 rounded-xl border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <FileUp className="w-6 h-6 text-primary-600" />
                    </div>
                    <div>
                      <h4 className="text-base font-bold text-neutral-900 dark:text-white">Genera anche "Formazione del Personale"</h4>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">Crea automaticamente un secondo file con gli stessi dati e suffisso "P".</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setGenerateSecondDoc(!generateSecondDoc)}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ring-2 ring-transparent focus:ring-primary-500
                      ${generateSecondDoc ? 'bg-primary-600' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform
                        ${generateSecondDoc ? 'translate-x-6' : 'translate-x-1'}`}
                    />
                  </button>
                </div>
              )}

              {/* Macro Sections Rendering */}
              {(() => {
                const textFields = sortTextFields(formFields.filter(f => f.type !== 'checkbox'));
                const checkFields = formFields.filter(f => f.type === 'checkbox');

                if (formFields.length === 0) return null;

                const sections = sectionDefinitions.map(def => {
                  const Icon = (LucideIcons as any)[def.icon] || LucideIcons.HelpCircle;
                  let fields: FormField[] = [];
                  if (def.id === 'checks') {
                    fields = checkFields;
                  } else {
                    fields = textFields.filter(f => getFieldSection(f) === def.id);
                    // Apply relative ordering within section if available
                    fields.sort((a, b) => {
                      const orderA = customLayout[a.id]?.order ?? 999;
                      const orderB = customLayout[b.id]?.order ?? 999;
                      return orderA - orderB;
                    });
                  }
                  return { ...def, iconElement: <Icon className="w-5 h-5 text-primary-600" />, fields };
                }).filter(s => s.fields.length > 0);

                return sections.map((section) => {
                  const isCollapsed = collapsedSections[section.id];
                  const toggle = () => setCollapsedSections(prev => ({ ...prev, [section.id]: !prev[section.id] }));

                  return (
                    <div
                      key={section.id}
                      className="mb-6 last:mb-0 border border-neutral-100 dark:border-neutral-700 rounded-2xl bg-white dark:bg-neutral-800 shadow-sm transition-all"
                    >
                      <button
                        onClick={toggle}
                        tabIndex={-1}
                        className={`w-full flex items-center justify-between p-5 bg-neutral-50/50 dark:bg-neutral-700/30 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors ${isCollapsed ? 'rounded-2xl' : 'rounded-t-2xl'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white dark:bg-neutral-700 rounded-lg border border-neutral-100 dark:border-neutral-600 flex items-center justify-center shadow-sm">
                            {section.iconElement}
                          </div>
                          <h3 className="text-lg font-bold text-neutral-800 dark:text-neutral-100">{section.title}</h3>
                          <span className="text-xs font-bold bg-neutral-200 dark:bg-neutral-600 text-neutral-600 dark:text-neutral-300 px-2 py-0.5 rounded-full">
                            {section.fields.length} {section.fields.length === 1 ? 'campo' : 'campi'}
                          </span>
                        </div>
                        {isCollapsed ? <ChevronDown className="text-neutral-400" /> : <ChevronUp className="text-neutral-400" />}
                      </button>

                      {!isCollapsed && (
                        <div className="p-6 sm:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
                          {section.id !== 'checks' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {section.fields.map((field) => {
                                const isTechnicianField = field.label.toLowerCase().includes('tecnico') || field.label.toLowerCase().includes('nome');

                                return (
                                  <div key={field.id} className="relative group/field-wrapper">
                                    <div className="bg-neutral-50 dark:bg-neutral-700/30 p-4 rounded-xl border-2 border-neutral-100 dark:border-neutral-700 transition-all duration-300 relative group/field focus-within:ring-2 focus-within:ring-primary-500">
                                      <div className="flex justify-between items-center mb-3">
                                        <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                          {field.label}
                                        </label>

                                        <div className="flex items-center gap-1 opacity-0 group-hover/field:opacity-100 transition-opacity">
                                          {/* Sorting Buttons */}
                                          <div className="flex bg-white dark:bg-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-600 shadow-sm overflow-hidden">
                                            <button
                                              onClick={() => moveField(field.id, 'up')}
                                              tabIndex={-1}
                                              className="p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-500 hover:text-primary-600"
                                              title="Sposta su"
                                            >
                                              <ChevronUp className="w-3.5 h-3.5" />
                                            </button>
                                            <div className="w-[1px] bg-neutral-100 dark:bg-neutral-700" />
                                            <button
                                              onClick={() => moveField(field.id, 'down')}
                                              tabIndex={-1}
                                              className="p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-500 hover:text-primary-600"
                                              title="Sposta giù"
                                            >
                                              <ChevronDown className="w-3.5 h-3.5" />
                                            </button>
                                          </div>

                                          {/* Move to Section Dropdown */}
                                          <div className="relative group/move">
                                            <button 
                                              tabIndex={-1}
                                              className="p-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-md shadow-sm text-neutral-500 hover:text-primary-600 hover:border-primary-200"
                                            >
                                              <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                                            </button>
                                            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl z-50 py-2 hidden group-hover/move:block min-w-[180px] animate-in fade-in zoom-in-95 duration-200">
                                              <p className="px-4 py-1.5 text-[10px] font-black text-neutral-400 uppercase tracking-widest border-b border-neutral-50 dark:border-neutral-700 mb-1">Sposta in Sezione:</p>
                                              {sectionDefinitions.filter(d => d.id !== section.id).map(d => {
                                                const Icon = (LucideIcons as any)[d.icon] || LucideIcons.HelpCircle;
                                                return (
                                                  <button
                                                    key={d.id}
                                                    onClick={() => handleSectionChange(field.id, d.id)}
                                                    className="w-full text-left px-4 py-2 text-xs hover:bg-primary-50 dark:hover:bg-primary-900/20 text-neutral-700 dark:text-neutral-200 flex items-center gap-3 transition-colors"
                                                  >
                                                    <span className="shrink-0"><Icon className="w-4 h-4" /></span>
                                                    <span className="font-semibold">{d.title}</span>
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {isTechnicianField && technicians.length > 0 ? (
                                        <div className="relative">
                                          <input
                                            type="text"
                                            list={`tech-list-${field.id}`}
                                            value={field.value}
                                            onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                            className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-neutral-900 dark:text-white font-semibold text-base"
                                            placeholder="Seleziona o scrivi..."
                                          />
                                          <datalist id={`tech-list-${field.id}`}>
                                            {technicians.map((t, i) => <option key={i} value={t} />)}
                                          </datalist>
                                        </div>
                                      ) : (
                                        <AutoResizeTextarea
                                          value={field.value}
                                          onChange={(v: string) => handleFieldChange(field.id, v)}
                                          className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-neutral-900 dark:text-white font-semibold text-base"
                                          placeholder="Inserisci un valore..."
                                        />
                                      )}

                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div>
                              {(() => {
                                const grouped = section.fields.reduce((acc: Record<string, FormField[]>, field) => {
                                  const groupName = field.group || "Opzioni Generali";
                                  if (!acc[groupName]) acc[groupName] = [];
                                  acc[groupName].push(field);
                                  return acc;
                                }, {});

                                return Object.entries(grouped).map(([groupName, fields]) => (
                                  <div key={groupName} className="mb-8 last:mb-0">
                                    <h4 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                      {groupName}
                                    </h4>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                      {fields.map(field => {
                                        const isChecked = field.value === '1' || field.value === 'true';
                                        return (
                                          <div
                                            key={field.id}
                                            onClick={() => handleFieldChange(field.id, isChecked ? '0' : '1')}
                                            className={`cursor-pointer p-4 rounded-xl border-2 flex items-center gap-3 transition-all
                                              ${isChecked ? 'border-emerald-500 bg-emerald-50/30 dark:bg-emerald-900/20' : 'border-neutral-100 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-emerald-200'}
                                            `}
                                          >
                                            <div className={`shrink-0 w-6 h-6 rounded flex items-center justify-center
                                              ${isChecked ? 'bg-emerald-500 text-white' : 'border-2 border-neutral-200 dark:border-neutral-600'}
                                            `}>
                                              {isChecked && <CheckCircle className="w-4 h-4" />}
                                            </div>
                                            <span className={`font-semibold text-sm ${isChecked ? 'text-emerald-900 dark:text-emerald-400' : 'text-neutral-700 dark:text-neutral-300'}`}>
                                              {field.label}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          )}
                          
                          {(() => {
                            const hasIndexedFields = section.fields.some(f => f.type !== 'checkbox' && (/_(\d+)$/.test(f.label) || /_(\d+)$/.test(f.id)));
                            if (hasIndexedFields) {
                              return (
                                <div className="mt-8 pt-6 border-t border-neutral-100 dark:border-neutral-700/50 flex justify-center sticky bottom-2">
                                  <button
                                    onClick={() => handleAddRow(section.id)}
                                    tabIndex={-1}
                                    className="flex items-center gap-2 px-6 py-3 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-primary-600 dark:hover:bg-primary-500 hover:text-white dark:hover:text-white rounded-xl shadow-lg shadow-neutral-500/10 dark:shadow-none transition-all font-bold text-sm group"
                                  >
                                    <Plus className="w-5 h-5 group-hover:scale-125 transition-transform" />
                                    Aggiungi Riga / Elemento
                                  </button>
                                </div>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}

              {formFields.length === 0 && !isProcessing && (
                <div className="text-center py-16 text-neutral-500">
                  <FileText className="w-12 h-12 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" />
                  Nessun campo rilevato in questo template. (Verifica che il DOCX abbia tag format {'{{ ...}}'} o checkbox w14)
                </div>
              )}

              <div className="pt-6 border-t border-neutral-200 dark:border-neutral-700 flex justify-end">
                <button
                  onClick={handleGenerate}
                  disabled={isProcessing || !templateFile}
                  className="px-8 py-4 bg-primary-600 rounded-xl text-white text-lg font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/30 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                >
                  Completa e Scarica <ChevronRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- VIEW: DOWNLOAD SUCCESS --- */}
        {currentView === 'download' && (
          <div className="p-12 md:p-24 text-center animate-in zoom-in-95 duration-500 max-w-2xl mx-auto">
            <div className="w-24 h-24 bg-green-50 dark:bg-green-900/20 rounded-full flex items-center justify-center mx-auto mb-8 ring-8 ring-green-50/50 dark:ring-green-900/10">
              <CheckCircle className="w-12 h-12 text-green-500" />
            </div>
            <h2 className="text-3xl font-extrabold mb-4 text-neutral-900 dark:text-white">Documento Pronto!</h2>
            <p className="text-neutral-600 dark:text-neutral-400 mb-10 text-lg">
              Il compilatore ha elaborato i campi mantenendo intatta la struttura originale del file Word.
            </p>

            <div className="flex flex-col sm:flex-row justify-center gap-4">
              <button
                onClick={() => setCurrentView('form')}
                className="px-8 py-4 bg-white dark:bg-neutral-800 border-2 border-primary-100 dark:border-neutral-700 rounded-xl text-neutral-600 dark:text-neutral-300 text-lg font-bold hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors shadow-sm flex items-center justify-center gap-2 group w-full sm:w-auto"
              >
                <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                Torna al Modulo
              </button>
              <button
                onClick={handleDownloadDocx}
                className="px-8 py-4 bg-primary-600 rounded-xl text-white text-lg font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-500/30 flex items-center justify-center gap-2 group w-full sm:w-auto"
              >
                <Download className="w-6 h-6 opacity-80 group-hover:opacity-100 group-hover:-translate-y-1 transition-all" />
                Scarica .DOCX
              </button>
            </div>

            <div className="mt-12 text-center text-sm text-neutral-400">
              L'anteprima PDF online è stata rimossa per garantire la stabilità strutturale del file generato. Scarica il DOCX e convertilo da Word se necessiti un PDF ad alta fedeltà.
            </div>

            <div className="mt-12 text-center">
              <button
                onClick={handleGoHome}
                className="text-neutral-500 font-semibold hover:text-primary-600 hover:underline dark:hover:text-primary-400 transition-colors"
              >
                ← Torna alla Home
              </button>
            </div>
          </div>
        )}

        {/* --- VIEW: AI EXTRACTION --- */}
        {currentView === 'ai-extraction' && (
          <AIExtraction onBack={handleGoHome} theme={theme} />
        )}
      </main>

    </div>
  );
}

export default App;
