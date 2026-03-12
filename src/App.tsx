import { useState, useEffect } from 'react';
import { FileUp, FileText, Download, CheckCircle, ChevronRight, Settings, Home as HomeIcon, Upload, ArrowLeft, FileIcon, ChevronDown, ChevronUp, User, Package, ClipboardList, ListCheck, Sun, Moon, Plus, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

import { extractFieldsFromDocx, extractTextFromDocx } from './utils/docxParser';
import type { FormField } from './utils/docxParser';
import { autoFillFields, extractTextFromPdf } from './utils/pdfParser';
import { generateDocx } from './utils/documentGenerator';
import { saveTemplateFile, getTemplateFile, getAllTemplatesMeta, deleteTemplate, type TemplateIndex, getSetting, setSetting, getTechnicians, setTechnicians, getCustomLayout, setCustomLayout, type CustomLayout } from './utils/storage';
import './App.css';

type View = 'home' | 'settings' | 'form' | 'download';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [isProcessing, setIsProcessing] = useState(false);

  // Storage State
  const [templateMeta, setTemplateMeta] = useState<(TemplateIndex | undefined)[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [technicians, setTechniciansList] = useState<string[]>([]);
  const [newTechName, setNewTechName] = useState('');
  const [customLayout, setCustomLayoutState] = useState<CustomLayout>({});
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  // Form State
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [deleteConfirming, setDeleteConfirming] = useState<string | null>(null);

  // No D&D state needed

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
  };

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

      // Extract fields and load specific layout
      const [fields, layout] = await Promise.all([
        extractFieldsFromDocx(file),
        getCustomLayout(slotId)
      ]);
      
      setFormFields(fields);
      setCustomLayoutState(layout);
      setCurrentView('form');
    } catch (err) {
      console.error("Error loading template for form", err);
      alert("Errore caricamento template.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Form Logic ---
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
        setIsProcessing(true);
        console.log('[App] Loading source file:', selected);
        
        const fileName = selected.split(/[/\\]/).pop() || 'source';
        const content = await readFile(selected);
        
        const isPdf = fileName.toLowerCase().endsWith('.pdf');
        const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        
        let extractedData: any = '';
        if (isPdf) {
          console.log('[App] Calling extractTextFromPdf...');
          extractedData = await extractTextFromPdf(content);
        } else if (fileName.toLowerCase().endsWith('.docx')) {
          console.log('[App] Calling extractTextFromDocx...');
          const file = new File([content], fileName, { type: mimeType });
          extractedData = await extractTextFromDocx(file);
        }

        if (extractedData) {
          console.log('[App] Data extracted, auto-filling...');
          const updatedFields = autoFillFields(formFields, extractedData);
          setFormFields(updatedFields);
        }
      }
    } catch (err) {
      console.error("[App] Error extracting text from source:", err);
      alert("Errore nell'estrazione del testo dalla sorgente.");
    } finally {
      setIsProcessing(false);
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
    await generateDocx(templateFile, formFields);
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
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-900 transition-colors duration-300">
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

              {/* Macro Sections Rendering */}
              {(() => {
                const textFields = sortTextFields(formFields.filter(f => f.type !== 'checkbox'));
                const checkFields = formFields.filter(f => f.type === 'checkbox');

                if (formFields.length === 0) return null;

                // 2. Define sections
                const sectionDefinitions = [
                  { id: 'client', title: 'Dati Cliente e Destinazione', icon: <User className="w-5 h-5 text-blue-500" /> },
                  { id: 'refs', title: 'Riferimenti Documento', icon: <ClipboardList className="w-5 h-5 text-purple-500" /> },
                  { id: 'items', title: 'Articoli e Materiali', icon: <Package className="w-5 h-5 text-amber-500" /> },
                  { id: 'checks', title: 'Configurazioni e Opzioni', icon: <ListCheck className="w-5 h-5 text-emerald-500" /> },
                  { id: 'staff', title: 'Personale e Firme', icon: <User className="w-5 h-5 text-indigo-500" /> },
                  { id: 'other', title: 'Altri Campi', icon: <div className="w-5 h-5 bg-neutral-100 dark:bg-neutral-700 rounded text-[10px] flex items-center justify-center font-bold">...</div> }
                ];

                // 3. Populate sections with fields
                const sections = sectionDefinitions.map(def => {
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
                  return { ...def, fields };
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
                        className={`w-full flex items-center justify-between p-5 bg-neutral-50/50 dark:bg-neutral-700/30 hover:bg-neutral-50 dark:hover:bg-neutral-700/50 transition-colors ${isCollapsed ? 'rounded-2xl' : 'rounded-t-2xl'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white dark:bg-neutral-700 rounded-lg border border-neutral-100 dark:border-neutral-600 flex items-center justify-center shadow-sm">
                            {section.icon}
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
                                              className="p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-500 hover:text-primary-600"
                                              title="Sposta su"
                                            >
                                              <ChevronUp className="w-3.5 h-3.5" />
                                            </button>
                                            <div className="w-[1px] bg-neutral-100 dark:bg-neutral-700" />
                                            <button
                                              onClick={() => moveField(field.id, 'down')}
                                              className="p-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-500 hover:text-primary-600"
                                              title="Sposta giù"
                                            >
                                              <ChevronDown className="w-3.5 h-3.5" />
                                            </button>
                                          </div>

                                          {/* Move to Section Dropdown */}
                                          <div className="relative group/move">
                                            <button className="p-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-md shadow-sm text-neutral-500 hover:text-primary-600 hover:border-primary-200">
                                              <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                                            </button>
                                            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl z-50 py-2 hidden group-hover/move:block min-w-[180px] animate-in fade-in zoom-in-95 duration-200">
                                              <p className="px-4 py-1.5 text-[10px] font-black text-neutral-400 uppercase tracking-widest border-b border-neutral-50 dark:border-neutral-700 mb-1">Sposta in Sezione:</p>
                                              {sectionDefinitions.filter(d => d.id !== section.id).map(d => (
                                                <button
                                                  key={d.id}
                                                  onClick={() => handleSectionChange(field.id, d.id)}
                                                  className="w-full text-left px-4 py-2 text-xs hover:bg-primary-50 dark:hover:bg-primary-900/20 text-neutral-700 dark:text-neutral-200 flex items-center gap-3 transition-colors"
                                                >
                                                  <span className="shrink-0">{d.icon}</span>
                                                  <span className="font-semibold">{d.title}</span>
                                                </button>
                                              ))}
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
                                        <input
                                          type="text"
                                          value={field.value}
                                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
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
      </main>

    </div>
  );
}

export default App;
