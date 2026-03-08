import React, { useState, useEffect } from 'react';
import { FileUp, FileText, Download, CheckCircle, ChevronRight, Settings, Home as HomeIcon, Upload, ArrowLeft, FileIcon, ChevronDown, ChevronUp, User, Package, ClipboardList, Info, ListCheck } from 'lucide-react';
import { extractFieldsFromDocx, extractTextFromDocx } from './utils/docxParser';
import type { FormField } from './utils/docxParser';
import { autoFillFields, extractTextFromPdf } from './utils/pdfParser';
import { generateDocx } from './utils/documentGenerator';
import { saveTemplateFile, getTemplateFile, getAllTemplatesMeta, deleteTemplate, type TemplateIndex } from './utils/storage';
import './App.css';

type View = 'home' | 'settings' | 'form' | 'download';

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [isProcessing, setIsProcessing] = useState(false);

  // Storage State
  const [templateMeta, setTemplateMeta] = useState<(TemplateIndex | undefined)[]>([]);

  // Form State
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadTemplateMeta();
  }, []);

  const loadTemplateMeta = async () => {
    const meta = await getAllTemplatesMeta();
    setTemplateMeta(meta);
  };

  const handleGoHome = () => {
    setCurrentView('home');
    setTemplateFile(null);
    setFormFields([]);
  };

  // --- Settings Logic ---
  const handleSlotUpload = async (slotId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.toLowerCase().endsWith('.doc')) {
        alert("Il formato .doc (Word 97-2003) non è supportato. Usa file .docx.");
        return;
      }
      setIsProcessing(true);
      try {
        await saveTemplateFile(slotId, file);
        await loadTemplateMeta();
      } catch (err) {
        console.error("Error saving template", err);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleDeleteSlot = async (slotId: string) => {
    if (window.confirm("Sei sicuro di voler rimuovere questo template?")) {
      await deleteTemplate(slotId);
      await loadTemplateMeta();
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

      // Extract fields
      const fields = await extractFieldsFromDocx(file);
      setFormFields(fields);
      setCurrentView('form');
    } catch (err) {
      console.error("Error loading template for form", err);
      alert("Errore caricamento template.");
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Form Logic ---
  const handleSourceUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setIsProcessing(true);

      try {
        console.log('[App] Starting handleSourceUpload for:', file.name, 'type:', file.type);
        let extractedData: any = '';
        if (file.type === 'application/pdf') {
          console.log('[App] Calling extractTextFromPdf...');
          extractedData = await extractTextFromPdf(file);
          console.log('[App] extractTextFromPdf returned data');
        } else if (file.name.toLowerCase().endsWith('.docx')) {
          console.log('[App] Calling extractTextFromDocx...');
          extractedData = await extractTextFromDocx(file);
          console.log('[App] extractTextFromDocx returned data');
        } else if (file.name.toLowerCase().endsWith('.doc')) {
          alert("I file .doc non sono analizzabili automaticamente. Converti in PDF o .docx.");
        }

        if (extractedData) {
          console.log('[App] Data extracted, calling autoFillFields...');
          const updatedFields = autoFillFields(formFields, extractedData);
          console.log('[App] autoFillFields produced updatedFields');
          setFormFields(updatedFields);
        } else {
          console.warn('[App] No data extracted from file');
        }
      } catch (err) {
        console.error("[App] Error extracting text from source:", err);
        alert("Errore nell'estrazione del testo dalla sorgente.");
      } finally {
        setIsProcessing(false);
      }
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

  // Split text fields and checkboxes for a better UI grouping
  // Enhanced sorting to keep articles contiguous and move participants to the end
  const sortTextFields = (fields: FormField[]) => {
    const getPriority = (label: string) => {
      const l = label.toUpperCase();
      // Participants fields should be at the very bottom
      if (l.includes('QUALIFICA') || l.includes('NOME') || l.includes('FIRMA')) return 100;
      // Article rows priority
      if (l.includes('ARTICOLO') || l.includes('DESCRIZIONE') || l.startsWith('Q_') || l.startsWith('SN_')) return 50;
      // Header/General fields priority
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

    return [...fields].sort((a, b) => {
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


  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={handleGoHome}
          >
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <FileIcon className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-primary-700 to-primary-500 bg-clip-text text-transparent">
              Rapportini<span className="font-light text-neutral-800">Tech</span>
            </h1>
          </div>
          <div className="flex gap-2">
            {currentView !== 'home' && (
              <button
                onClick={handleGoHome}
                className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                title="Home"
              >
                <HomeIcon className="w-6 h-6" />
              </button>
            )}
            {currentView !== 'settings' && (
              <button
                onClick={() => setCurrentView('settings')}
                className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
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
              <h2 className="text-4xl font-extrabold text-neutral-900 mb-4">Seleziona un Template</h2>
              <p className="text-lg text-neutral-600 max-w-2xl mx-auto">
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
                        ? 'border-primary-200 bg-white hover:border-primary-500 hover:shadow-xl hover:shadow-primary-500/10 cursor-pointer group'
                        : 'border-dashed border-neutral-300 bg-neutral-100 opacity-60 cursor-not-allowed'
                      }
                    `}
                  >
                    {meta ? (
                      <>
                        <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                          <FileText className="w-8 h-8 text-primary-600" />
                        </div>
                        <h3 className="text-xl font-bold text-neutral-800 mb-2">Template {slotNum}</h3>
                        <p className="text-sm text-neutral-500 truncate w-full px-4">{meta.name}</p>
                      </>
                    ) : (
                      <>
                        <div className="w-16 h-16 bg-neutral-200 rounded-full flex items-center justify-center mb-4">
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
                  className="px-6 py-3 bg-white border border-neutral-300 shadow-sm rounded-xl text-primary-600 font-semibold hover:bg-primary-50 transition-colors"
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
                className="p-2 bg-white border border-neutral-200 rounded-lg text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-3xl font-extrabold text-neutral-900">Gestione Template</h2>
                <p className="text-neutral-600">Assegna un file .docx a ciascuno slot per renderlo disponibile nella Home.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 divide-y divide-neutral-100">
              {[1, 2, 3].map(slotNum => {
                const id = slotNum.toString();
                const meta = templateMeta[slotNum - 1];

                return (
                  <div key={id} className="p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 hover:bg-neutral-50 transition-colors">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-bold text-xl
                        ${meta ? 'bg-primary-100 text-primary-600' : 'bg-neutral-100 text-neutral-400'}">
                        {slotNum}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-lg font-bold text-neutral-900 mb-1">Slot Template {slotNum}</h4>
                        {meta ? (
                          <p className="text-sm text-green-600 font-medium flex items-center gap-1 truncate pb-1">
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
                          className="px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          Rimuovi
                        </button>
                      )}
                      <div className="relative group overflow-hidden w-full sm:w-auto">
                        <input
                          type="file"
                          accept=".docx"
                          onChange={(e) => handleSlotUpload(id, e)}
                          disabled={isProcessing}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                        />
                        <button className="w-full sm:w-auto px-6 py-2 text-sm font-bold text-white bg-neutral-900 group-hover:bg-neutral-800 rounded-lg transition-colors shrink-0">
                          {meta ? 'Sostituisci' : 'Carica File DOCX'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {isProcessing && <div className="mt-4 text-center text-primary-600 font-semibold animate-pulse">Salvataggio in corso...</div>}
          </div>
        )}

        {/* --- VIEW: FORM COMPILATION --- */}
        {currentView === 'form' && (
          <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">

            <div className="flex items-center gap-4 mb-8 bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
              <div className="w-16 h-16 bg-primary-50 rounded-xl flex items-center justify-center shrink-0">
                <FileText className="w-8 h-8 text-primary-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-neutral-900 mb-1">Compilazione Documento</h2>
                <p className="text-neutral-500 text-sm">{templateFile?.name}</p>
              </div>

              <div className="relative group overflow-hidden shrink-0 hidden sm:block">
                <input
                  type="file"
                  accept="application/pdf,.docx"
                  onChange={handleSourceUpload}
                  disabled={isProcessing}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <button className="flex items-center gap-2 px-5 py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl transition-colors shadow-md">
                  <Upload className="w-5 h-5" />
                  {isProcessing ? 'Analisi...' : 'Auto-Compila da PDF'}
                </button>
              </div>
            </div>

            {/* Auto compile mobile button */}
            <div className="relative group overflow-hidden sm:hidden mb-6 w-full">
              <input
                type="file"
                accept="application/pdf,.docx"
                onChange={handleSourceUpload}
                disabled={isProcessing}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <button className="w-full flex justify-center items-center gap-2 px-5 py-4 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl transition-colors shadow-md text-lg">
                <Upload className="w-6 h-6" />
                {isProcessing ? 'Analisi...' : 'Auto-Compila da PDF'}
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6 sm:p-10">

              {/* Macro Sections Rendering */}
              {(() => {
                const textFields = sortTextFields(formFields.filter(f => f.type !== 'checkbox'));
                const checkFields = formFields.filter(f => f.type === 'checkbox');

                if (formFields.length === 0) return null;

                // 1. Grouping Logic for Sections
                const sections = [
                  {
                    id: 'client',
                    title: 'Dati Cliente e Destinazione',
                    icon: <User className="w-5 h-5 text-blue-500" />,
                    fields: textFields.filter(f => {
                      const l = f.label.toLowerCase();
                      return l.includes('cliente') || l.includes('ragione_sociale') || l.includes('indirizzo') ||
                        l.includes('cap') || l.includes('citta') || l.includes('reparto') || l.includes('luogo');
                    })
                  },
                  {
                    id: 'refs',
                    title: 'Riferimenti Documento',
                    icon: <ClipboardList className="w-5 h-5 text-purple-500" />,
                    fields: textFields.filter(f => {
                      const l = f.label.toLowerCase();
                      return l.includes('richiesta') || l.includes('data') || l.includes('documento') ||
                        l.match(/^n_/) || l.includes('riferimento');
                    })
                  },
                  {
                    id: 'items',
                    title: 'Articoli e Materiali',
                    icon: <Package className="w-5 h-5 text-amber-500" />,
                    fields: textFields.filter(f => {
                      const l = f.label.toLowerCase();
                      return l.includes('articolo') || l.includes('descrizione') || l.startsWith('q_') || l.startsWith('sn_');
                    })
                  },
                  {
                    id: 'checks',
                    title: 'Configurazioni e Opzioni',
                    icon: <ListCheck className="w-5 h-5 text-emerald-500" />,
                    fields: checkFields
                  },
                  {
                    id: 'staff',
                    title: 'Personale e Firme',
                    icon: <Info className="w-5 h-5 text-neutral-500" />,
                    fields: textFields.filter(f => {
                      const l = f.label.toLowerCase();
                      return l.includes('qualifica') || l.includes('nome') || l.includes('firma') || l.includes('tecnico');
                    })
                  },
                  {
                    id: 'other',
                    title: 'Altri Campi',
                    icon: <div className="w-5 h-5 bg-neutral-100 rounded text-[10px] flex items-center justify-center font-bold">...</div>,
                    fields: textFields.filter(f => {
                      const l = f.label.toLowerCase();
                      const isClient = l.includes('cliente') || l.includes('ragione_sociale') || l.includes('indirizzo') || l.includes('cap') || l.includes('citta') || l.includes('reparto') || l.includes('luogo');
                      const isRef = l.includes('richiesta') || l.includes('data') || l.includes('documento') || l.match(/^n_/) || l.includes('riferimento');
                      const isItem = l.includes('articolo') || l.includes('descrizione') || l.startsWith('q_') || l.startsWith('sn_');
                      const isStaff = l.includes('qualifica') || l.includes('nome') || l.includes('firma') || l.includes('tecnico');
                      return !isClient && !isRef && !isItem && !isStaff;
                    })
                  }
                ].filter(s => s.fields.length > 0);

                return sections.map((section) => {
                  const isCollapsed = collapsedSections[section.id];
                  const toggle = () => setCollapsedSections(prev => ({ ...prev, [section.id]: !prev[section.id] }));

                  return (
                    <div key={section.id} className="mb-6 last:mb-0 border border-neutral-100 rounded-2xl overflow-hidden bg-white shadow-sm">
                      <button
                        onClick={toggle}
                        className="w-full flex items-center justify-between p-5 bg-neutral-50/50 hover:bg-neutral-50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-lg border border-neutral-100 flex items-center justify-center shadow-sm">
                            {section.icon}
                          </div>
                          <h3 className="text-lg font-bold text-neutral-800">{section.title}</h3>
                          <span className="text-xs font-bold bg-neutral-200 text-neutral-600 px-2 py-0.5 rounded-full">
                            {section.fields.length} {section.fields.length === 1 ? 'campo' : 'campi'}
                          </span>
                        </div>
                        {isCollapsed ? <ChevronDown className="text-neutral-400" /> : <ChevronUp className="text-neutral-400" />}
                      </button>

                      {!isCollapsed && (
                        <div className="p-6 sm:p-8 animate-in fade-in slide-in-from-top-2 duration-300">
                          {section.id !== 'checks' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {section.fields.map(field => (
                                <div key={field.id} className="bg-neutral-50 p-4 rounded-xl border border-neutral-100 focus-within:ring-2 focus-within:ring-primary-500 transition-all">
                                  <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider mb-2">
                                    {field.label}
                                  </label>
                                  <input
                                    type="text"
                                    value={field.value}
                                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                    className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-neutral-900 font-semibold text-base"
                                    placeholder="Inserisci un valore..."
                                  />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div>
                              {(() => {
                                const grouped = section.fields.reduce((acc, field) => {
                                  const groupName = field.group || "Opzioni Generali";
                                  if (!acc[groupName]) acc[groupName] = [];
                                  acc[groupName].push(field);
                                  return acc;
                                }, {} as Record<string, FormField[]>);

                                return Object.entries(grouped).map(([groupName, fields]) => (
                                  <div key={groupName} className="mb-8 last:mb-0">
                                    <h4 className="text-xs font-bold text-neutral-400 uppercase tracking-widest mb-4 flex items-center gap-2">
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
                                               ${isChecked ? 'border-emerald-500 bg-emerald-50/30' : 'border-neutral-100 bg-white hover:border-emerald-200'}
                                            `}
                                          >
                                            <div className={`shrink-0 w-6 h-6 rounded flex items-center justify-center
                                               ${isChecked ? 'bg-emerald-500 text-white' : 'border-2 border-neutral-200'}
                                            `}>
                                              {isChecked && <CheckCircle className="w-4 h-4" />}
                                            </div>
                                            <span className={`font-semibold text-sm ${isChecked ? 'text-emerald-900' : 'text-neutral-700'}`}>
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
                  <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
                  Nessun campo rilevato in questo template. (Verifica che il DOCX abbia tag format {'{{ ...}}'} o checkbox w14)
                </div>
              )}

              <div className="pt-6 border-t border-neutral-200 flex justify-end">
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
            <div className="w-24 h-24 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-8 ring-8 ring-green-50/50">
              <CheckCircle className="w-12 h-12 text-green-500" />
            </div>
            <h2 className="text-3xl font-extrabold mb-4 text-neutral-900">Documento Pronto!</h2>
            <p className="text-neutral-600 mb-10 text-lg">
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
                className="text-neutral-500 font-semibold hover:text-primary-600 hover:underline transition-colors"
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
