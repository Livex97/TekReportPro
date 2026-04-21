import { useState, useEffect, useRef } from 'react';
import { FileUp, FileText, Download, CheckCircle, ChevronRight, Upload, ArrowLeft, ChevronDown, ChevronUp, Trash2, Plus, HelpCircle } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { open, ask } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import type { FormField } from './utils/docxParser';
import { extractTextFromDocx } from './utils/docxParser';
import { autoFillFields, extractTextFromPdf } from './utils/pdfParser';
import { generateDocx } from './utils/documentGenerator';
import { setCustomLayout, type CustomLayout, type TemplateIndex, type SectionDefinition, getTemplateFile } from './utils/storage';

interface TemplateManagerPageProps {
  templateMeta: (TemplateIndex | undefined)[];
  templateFile: File | null;
  formFields: FormField[];
  customLayout: CustomLayout;
  activeSlotId: string | null;
  technicians: string[];
  sectionDefinitions: SectionDefinition[];
  isProcessing: boolean;
  currentView: 'templates' | 'form' | 'download';
  onViewChange: (view: 'templates' | 'form' | 'download') => void;
  onSelectTemplate: (slotId: string) => Promise<void>;
  onFormFieldsChange: (fields: FormField[] | ((prev: FormField[]) => FormField[])) => void;
  onCustomLayoutChange: (layout: CustomLayout) => void;
  onGoHome: () => void;
  className?: string;
}

function AutoResizeTextarea({ value, onChange, placeholder, className, onKeyDown }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
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
      className={className + " resize-none overflow-hidden"}
      rows={1}
      spellCheck={false}
    />
  );
}

const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

export default function TemplateManagerPage({
  templateMeta,
  templateFile,
  formFields,
  customLayout,
  activeSlotId,
  technicians,
  sectionDefinitions,
  isProcessing,
  currentView,
  onViewChange,
  onSelectTemplate,
  onFormFieldsChange,
  onCustomLayoutChange,
  onGoHome,
  className = ''
}: TemplateManagerPageProps) {
  const [generateSecondDoc, setGenerateSecondDoc] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);

  // We use the prop currentView instead of local state
  const setCurrentView = onViewChange;

  useEffect(() => {
    let unlistenDrop: any = null;
    let unlistenEnter: any = null;
    let unlistenLeave: any = null;

    const setupTauriEvents = async () => {
      unlistenEnter = await import('@tauri-apps/api/event').then(m => m.listen('tauri://drag-enter', () => {
        if (currentView === 'form') setIsDragging(true);
      }));

      unlistenLeave = await import('@tauri-apps/api/event').then(m => m.listen('tauri://drag-leave', () => {
        setIsDragging(false);
      }));

      unlistenDrop = await import('@tauri-apps/api/event').then(m => m.listen('tauri://drag-drop', async (event: any) => {
        setIsDragging(false);
        if (currentView !== 'form') return;

        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          try {
            const filePath = paths[0];
            const fileName = filePath.split(/[/\\]/).pop() || 'source';
            const content = await readFile(filePath);
            await processSourceFile(fileName, content, filePath);
          } catch (err) {
            console.error('[TemplateManager] Drag drop error:', err);
          }
        }
      }));
    };

    setupTauriEvents();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenEnter) unlistenEnter();
      if (unlistenLeave) unlistenLeave();
    };
  }, [currentView]);

  useEffect(() => {
    setGenerateSecondDoc(false);
  }, [activeSlotId]);

  const processSourceFile = async (fileName: string, content: Uint8Array, filePath?: string) => {
    try {
      const isPdf = fileName.toLowerCase().endsWith('.pdf');
      const isDocx = fileName.toLowerCase().endsWith('.docx');
      const isDoc = fileName.toLowerCase().endsWith('.doc');

      if (!isPdf && !isDocx && !isDoc) {
        alert("Formato non supportato. Trascina un file PDF, DOCX o DOC.");
        return;
      }

      const mimeType = isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      let extractedData: any = '';
      if (isPdf) {
        extractedData = await extractTextFromPdf(content);
      } else if (isDocx) {
        const file = new File([content as any], fileName, { type: mimeType });
        extractedData = await extractTextFromDocx(file);
      } else if (isDoc) {
        if (filePath) {
          const docxContent = await invoke<number[]>('convert_doc_to_docx', { inputPath: filePath });
          const docxUint8 = new Uint8Array(docxContent);
          const file = new File([docxUint8 as any], fileName + 'x', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
          extractedData = await extractTextFromDocx(file);
        } else {
          alert("Il formato .doc richiede il percorso del file per la conversione.");
          return;
        }
      }

      if (extractedData) {
        const updatedFields = autoFillFields(formFields, extractedData);
        const todayDate = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const finalizedFields = updatedFields.map(f => {
          const labelUc = f.label.toUpperCase();
          if (labelUc === 'DATA' || labelUc === 'DATA INTERVENTO') {
            return { ...f, value: todayDate };
          }
          return f;
        });

        const newLayout = { ...customLayout };
        let layoutUpdated = false;

        const fieldsWithoutLayout = finalizedFields.filter(f => !customLayout[f.id]);

        if (fieldsWithoutLayout.length > 0) {
          const fieldsBySection = fieldsWithoutLayout.reduce((acc: Record<string, FormField[]>, field) => {
            const sectionId = getFieldSection(field);
            if (!acc[sectionId]) acc[sectionId] = [];
            acc[sectionId].push(field);
            return acc;
          }, {});

          Object.entries(fieldsBySection).forEach(([sectionId, newFieldsInSection]) => {
            const allSectionFields = finalizedFields.filter(f => getFieldSection(f) === sectionId);
            const fieldsIndex1 = allSectionFields.filter(f => f.label.endsWith('_1') || f.id.endsWith('_1'));
            if (fieldsIndex1.length === 0) return;

            const rowPrefixes = fieldsIndex1.map(f => ({
              labelPrefix: f.label.replace(/_1$/, ''),
              idPrefix: f.id.replace(/_1$/, '')
            }));

            let maxExistingOrder = 0;
            allSectionFields.forEach(f => {
              const order = customLayout[f.id]?.order;
              if (order !== undefined && order > maxExistingOrder) {
                maxExistingOrder = order;
              }
            });

            const rowGroups = new Map<number, Map<string, FormField>>();
            newFieldsInSection.forEach(field => {
              const labelMatch = field.label.match(/_(\d+)$/);
              const idMatch = field.id.match(/_(\d+)$/);
              const suffix = labelMatch ? parseInt(labelMatch[1], 10) : (idMatch ? parseInt(idMatch[1], 10) : null);
              if (suffix === null) return;

              const prefixIdx = rowPrefixes.findIndex(p =>
                (labelMatch && field.label.startsWith(p.labelPrefix)) ||
                (idMatch && field.id.startsWith(p.idPrefix))
              );
              if (prefixIdx === -1) return;

              const prefixKey = rowPrefixes[prefixIdx].labelPrefix;
              if (!rowGroups.has(suffix)) rowGroups.set(suffix, new Map());
              rowGroups.get(suffix)!.set(prefixKey, field);
            });

            const sortedSuffixes = Array.from(rowGroups.keys()).sort((a, b) => a - b);
            sortedSuffixes.forEach((suffix, rowIdx) => {
              const prefixMap = rowGroups.get(suffix)!;
              fieldsIndex1.forEach((_, idx) => {
                const prefix = rowPrefixes[idx].labelPrefix;
                const field = prefixMap.get(prefix);
                if (field) {
                  const order = maxExistingOrder + 1 + rowIdx * fieldsIndex1.length + idx;
                  newLayout[field.id] = { sectionId, order };
                  layoutUpdated = true;
                }
              });
            });
          });
        }

        if (layoutUpdated) {
          onCustomLayoutChange(newLayout);
          if (activeSlotId) {
            await setCustomLayout(activeSlotId, newLayout);
          }
        }

        const nextN_Richiesta = finalizedFields.find(f => f.label.toUpperCase() === 'N_RICHIESTA' || f.id.toUpperCase() === 'N_RICHIESTA')?.value;
        if (nextN_Richiesta && nextN_Richiesta.trim() !== '') {
          onFormFieldsChange(finalizedFields.map(f =>
            f.label.toUpperCase() === 'SCRITTA' ? { ...f, value: '1' } : f
          ));
        } else {
          onFormFieldsChange(finalizedFields);
        }
      }
    } catch (err) {
      console.error("[TemplateManager] Error processing source file:", err);
      alert("Errore nell'estrazione del testo dalla sorgente.");
    }
  };

  const handleSourceUpload = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Sorgente Dati',
          extensions: ['pdf', 'docx', 'doc']
        }]
      });

      if (selected && typeof selected === 'string') {
        const fileName = selected.split(/[/\\]/).pop() || 'source';
        const content = await readFile(selected);
        await processSourceFile(fileName, content, selected);
      }
    } catch (err) {
      console.error("[TemplateManager] Error picking source file:", err);
    }
  };

  const handleFieldChange = (id: string, value: string) => {
    onFormFieldsChange((prev: FormField[]) => {
      let next = prev.map((f: FormField) => f.id === id ? { ...f, value } : f);

      const changedField = prev.find((f: FormField) => f.id === id);
      if (changedField && (changedField.label.toUpperCase() === 'N_RICHIESTA' || changedField.id.toUpperCase() === 'N_RICHIESTA')) {
        const isFilled = typeof value === 'string' && value.trim() !== '';
        next = next.map((f: FormField) =>
          f.label.toUpperCase() === 'SCRITTA' ? { ...f, value: isFilled ? '1' : '0' } : f
        );
      }

      return next;
    });
  };

  const handleAddRow = (sectionId: string) => {
    const sectionFields = formFields.filter(f => getFieldSection(f) === sectionId);
    const indexedFields = sectionFields.filter(f => /_(\d+)$/.test(f.label) || /_(\d+)$/.test(f.id));
    if (indexedFields.length === 0) return;

    const fieldsIndex1 = indexedFields.filter(f => f.label.endsWith('_1') || f.id.endsWith('_1'));
    if (fieldsIndex1.length === 0) return;

    const rowPrefixes = fieldsIndex1.map(f => {
      const labelPrefix = f.label.replace(/_1$/, '');
      const idPrefix = f.id.replace(/_1$/, '');
      return { labelPrefix, idPrefix };
    });

    let maxN = 0;
    indexedFields.forEach(f => {
      const isPartOfThisRow = rowPrefixes.some(p => {
        const labelMatch = f.label.match(new RegExp(`^${escapeRegExp(p.labelPrefix)}_(\\d+)$`));
        const idMatch = f.id.match(new RegExp(`^${escapeRegExp(p.idPrefix)}_(\\d+)$`));
        return labelMatch || idMatch;
      });

      if (isPartOfThisRow) {
        const matchLabel = f.label.match(/_(\d+)$/);
        const matchId = f.id.match(/_(\d+)$/);
        if (matchLabel) maxN = Math.max(maxN, parseInt(matchLabel[1], 10));
        if (matchId) maxN = Math.max(maxN, parseInt(matchId[1], 10));
      }
    });

    if (maxN === 0) return;

    const nextN = maxN + 1;
    const groupId = `row_${sectionId}_${nextN}`;

    let maxSectionOrder = 0;
    sectionFields.forEach(f => {
      const order = customLayout[f.id]?.order;
      if (order !== undefined && order > maxSectionOrder) {
        maxSectionOrder = order;
      }
    });

    const newLayout = { ...customLayout };
    let hasCustomLayoutUpdate = false;

    const newFields: FormField[] = fieldsIndex1.map((f, idx) => {
      const newLabel = f.label.replace(/_1$/, `_${nextN}`);
      const newId = f.id.replace(/_1$/, `_${nextN}`);

      if (customLayout[f.id]) {
        newLayout[newId] = {
          sectionId: customLayout[f.id].sectionId,
          order: maxSectionOrder + 1 + idx
        };
        hasCustomLayoutUpdate = true;
      }

      return {
        ...f,
        id: newId,
        label: newLabel,
        value: '',
        isDynamic: true,
        groupId
      };
    });

    onFormFieldsChange([...formFields, ...newFields]);
    if (hasCustomLayoutUpdate) {
      onCustomLayoutChange(newLayout);
      if (activeSlotId) setCustomLayout(activeSlotId, newLayout);
    }
  };

  const handleRemoveDynamicField = async (fieldToRemove: FormField) => {
    if (!fieldToRemove.isDynamic || !fieldToRemove.groupId) return;

    const relatedFields = formFields.filter(f => f.groupId === fieldToRemove.groupId);

    let shouldRemove = false;
    if (relatedFields.length > 1) {
      shouldRemove = await ask(
        `Questa azione eliminerà TUTTI i campi di questa riga (${relatedFields.length} campi totali). Vuoi procedere?`,
        { title: 'Conferma Eliminazione Riga', kind: 'warning' }
      );
    } else {
      shouldRemove = await ask(
        `Vuoi davvero eliminare questo campo dinamico? (${fieldToRemove.label})`,
        { title: 'Conferma Eliminazione', kind: 'warning' }
      );
    }

    if (shouldRemove) {
      onFormFieldsChange((prev: FormField[]) => prev.filter((f: FormField) => f.groupId !== fieldToRemove.groupId));

      const newLayout = { ...customLayout };
      let layoutChanged = false;
      relatedFields.forEach(f => {
        if (newLayout[f.id]) {
          delete newLayout[f.id];
          layoutChanged = true;
        }
      });
      if (layoutChanged) {
        onCustomLayoutChange(newLayout);
        if (activeSlotId) setCustomLayout(activeSlotId, newLayout);
      }
    }
  };

  const handleGenerate = () => {
    if (!templateFile) return;
    setCurrentView('download');
  };

  const handleDownloadDocx = async () => {
    if (!templateFile) return;

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

    await generateDocx(templateFile, formFields, outputName);

    const isInstallation = templateFile.name.toLowerCase().includes('installazione') && templateFile.name.toLowerCase().includes('collaudo');
    if (generateSecondDoc && isInstallation) {
      console.log('[TemplateManager] Generating second document (Formazione del Personale)...');

      const secondTemplateMeta = templateMeta.find(m =>
        m?.name.toLowerCase().includes('formazione') &&
        m?.name.toLowerCase().includes('personale')
      );

      if (secondTemplateMeta) {
        try {
          // getTemplateFile imported statically
          const secondTemplateFile = await getTemplateFile(secondTemplateMeta.id);
          if (secondTemplateFile) {
            const secondOutputName = baseName ? `${baseName}P_.docx` : 'formazione_personale.docx';
            await new Promise(r => setTimeout(r, 500));
            await generateDocx(secondTemplateFile, formFields, secondOutputName);
          }
        } catch (err) {
          console.error('[TemplateManager] Error generating second doc:', err);
          alert('Errore nella generazione del secondo documento.');
        }
      } else {
        alert('Attenzione: Template "Formazione del Personale" non trovato negli slot. Caricalo per poter generare il secondo file.');
      }
    }
  };

  const sortTextFields = (fields: FormField[]) => {
    return [...fields].sort((a, b) => {
      const layoutA = customLayout[a.id];
      const layoutB = customLayout[b.id];
      if (layoutA && layoutB && layoutA.sectionId === layoutB.sectionId) {
        return layoutA.order - layoutB.order;
      }

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

    const newSectionFields = [...sectionFields];
    const [movedItem] = newSectionFields.splice(currentIndex, 1);
    newSectionFields.splice(newIndex, 0, movedItem);

    const newLayout = { ...customLayout };
    newSectionFields.forEach((f, idx) => {
      newLayout[f.id] = { sectionId, order: idx };
    });

    onCustomLayoutChange(newLayout);
    if (activeSlotId) {
      await setCustomLayout(activeSlotId, newLayout);
    }
  };

  const handleSectionChange = async (fieldId: string, newSectionId: string) => {
    const field = formFields.find(f => f.id === fieldId);
    if (!field) return;

    const sectionFields = formFields.filter(f => getFieldSection(f) === newSectionId);
    const newLayout = {
      ...customLayout,
      [fieldId]: { sectionId: newSectionId, order: sectionFields.length }
    };

    onCustomLayoutChange(newLayout);
    if (activeSlotId) {
      await setCustomLayout(activeSlotId, newLayout);
    }
  };
  
  if (currentView === 'download') {
    return (
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
            onClick={onGoHome}
            className="text-neutral-500 font-semibold hover:text-primary-600 hover:underline dark:hover:text-primary-400 transition-colors"
          >
            ← Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  if (currentView === 'form') {
    return (
      <div className="max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        {isDragging && (
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
          {templateFile?.name.toLowerCase().includes('installazione') && templateFile?.name.toLowerCase().includes('collaudo') && (
            <div className="mb-8 p-6 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-primary-50 dark:bg-primary-900/20 rounded-xl border border-primary-100 dark:border-primary-800 flex items-center justify-center shadow-sm">
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

          {(() => {
            const textFields = sortTextFields(formFields.filter(f => f.type !== 'checkbox'));
            const checkFields = formFields.filter(f => f.type === 'checkbox');

            if (formFields.length === 0) return null;

            const sections = sectionDefinitions.map(def => {
              const Icon = (LucideIcons as any)[def.icon] || HelpCircle;
              let fields: FormField[] = [];
              if (def.id === 'checks') {
                fields = checkFields;
              } else {
                fields = textFields.filter(f => getFieldSection(f) === def.id);
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
                                    <div className="flex items-center gap-2">
                                      <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
                                        {field.label}
                                      </label>
                                      {field.isDynamic && (
                                        <button
                                          onClick={() => handleRemoveDynamicField(field)}
                                          title="Elimina riga"
                                          className="p-1 rounded bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 transition-colors"
                                          tabIndex={-1}
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-1 opacity-0 group-hover/field:opacity-100 transition-opacity">
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
                                            const Icon = (LucideIcons as any)[d.icon] || HelpCircle;
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
                            <div className="mt-8 pt-4 pb-4 border-t border-neutral-100 dark:border-neutral-700/50 flex justify-center">
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
    );
  }

  return (
    <div className={`animate-in fade-in slide-in-from-bottom-4 duration-500 ${className}`}>
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
              onClick={() => meta && !isProcessing ? onSelectTemplate(id) : null}
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
            onClick={onGoHome}
            className="px-6 py-3 bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 shadow-sm rounded-xl text-primary-600 font-semibold hover:bg-primary-50 dark:hover:bg-neutral-700 transition-colors"
          >
            Vai alle Impostazioni per caricare i file
          </button>
        </div>
      )}
    </div>
  );
}