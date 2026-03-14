import { useState, useEffect } from 'react';
import { ArrowLeft, Upload, FileText, Database, CheckCircle, Brain, RefreshCw } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { extractTextFromPdf } from './utils/pdfParser';
import { generateOllamaExtraction, type ExtractedData } from './utils/ollama';
import { checkDuplicateInCsv, appendRowToCsv } from './utils/csvHandler';
import { getCsvPath } from './utils/storage';

interface AIExtractionProps {
    onBack: () => void;
    theme?: 'light' | 'dark';
}

export function AIExtraction({ onBack }: AIExtractionProps) {
    const [csvPath, setCsvPath] = useState<string>('');
    const [sourceText, setSourceText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [extracted, setExtracted] = useState<ExtractedData | null>(null);
    const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | 'warning', msg: string } | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [executionTime, setExecutionTime] = useState<number | null>(null);
    const [timerValue, setTimerValue] = useState<number>(0);

    useEffect(() => {
        let interval: any;
        if (isProcessing) {
            const start = Date.now();
            setTimerValue(0);
            interval = setInterval(() => {
                setTimerValue(Math.floor((Date.now() - start) / 100) / 10);
            }, 100);
        } else {
            clearInterval(interval);
        }
        return () => clearInterval(interval);
    }, [isProcessing]);

    useEffect(() => {
        loadCsvPath();
        return () => {
            if (abortController) abortController.abort();
        };
    }, []);

    const loadCsvPath = async () => {
        const path = await getCsvPath();
        setCsvPath(path);
    };

    const handleFileUpload = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Documenti', extensions: ['pdf', 'txt', 'eml'] }]
            });

            if (selected && typeof selected === 'string') {
                setIsProcessing(false); // Non avviamo il caricamento visivo dell'AI qui
                setSaveStatus(null);
                const fileName = selected.split(/[/\\]/).pop() || '';
                const content = await readFile(selected);
                
                let text = '';
                if (fileName.toLowerCase().endsWith('.pdf')) {
                    const pdfResult = await extractTextFromPdf(content);
                    text = pdfResult.fullText;
                } else {
                    const decoder = new TextDecoder();
                    text = decoder.decode(content);
                }

                setSourceText(text);
                setExtracted(null); // Reset dei dati estratti precedenti
            }
        } catch (error) {
            console.error(error);
            setSaveStatus({ type: 'error', msg: 'Errore durante la lettura del file.' });
            setIsProcessing(false);
        }
    };

    const processTextWithAI = async (text: string) => {
        if (!text.trim()) {
            setSaveStatus({ type: 'error', msg: 'Il testo è vuoto.' });
            setIsProcessing(false);
            return;
        }

        const controller = new AbortController();
        setAbortController(controller);
        setIsProcessing(true);
        setSaveStatus(null);
        setExecutionTime(null);
        const startTime = Date.now();
        
        try {
            const result = await generateOllamaExtraction(text, controller.signal);
            const endTime = Date.now();
            setExecutionTime((endTime - startTime) / 1000);
            setExtracted(result);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                setSaveStatus({ type: 'warning', msg: 'Analisi interrotta dall\'utente.' });
            } else {
                setSaveStatus({ type: 'error', msg: error.message || 'Errore di connessione a Ollama.' });
            }
        } finally {
            setIsProcessing(false);
            setAbortController(null);
        }
    };

    const handleExtractClick = () => {
        if (isProcessing) {
            if (abortController) {
                abortController.abort();
            }
        } else {
            processTextWithAI(sourceText);
        }
    };

    const handleFieldChange = (field: keyof ExtractedData, value: string) => {
        if (extracted) {
            setExtracted({ ...extracted, [field]: value });
        }
    };

    const handleSaveToCsv = async () => {
        if (!csvPath) {
            setSaveStatus({ type: 'error', msg: 'Devi prima impostare il percorso del file Pandetta CSV nelle impostazioni!' });
            return;
        }
        if (!extracted || !extracted.data || !extracted.cliente) {
            setSaveStatus({ type: 'error', msg: 'Attenzione: Data e Cliente sono campi obbligatori.' });
            return;
        }

        setIsSaving(true);
        setSaveStatus(null);
        try {
            const isDuplicate = await checkDuplicateInCsv(csvPath, extracted);
            if (isDuplicate) {
                setSaveStatus({ type: 'warning', msg: 'Esiste già un intervento per questo cliente, strumento e data!' });
                setIsSaving(false);
                return;
            }

            await appendRowToCsv(csvPath, extracted);
            setSaveStatus({ type: 'success', msg: 'Richiesta di intervento salvata correttamente nel CSV.' });
            setExtracted(null);
            setSourceText('');
        } catch (error: any) {
            console.error(error);
            setSaveStatus({ type: 'error', msg: 'Errore durante il salvataggio nel file CSV.' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-4 mb-8">
                <button
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white flex items-center gap-3">
                        <Brain className="w-8 h-8 text-primary-600" />
                        Estrazione Automatica Assistenza
                    </h2>
                    <p className="text-neutral-600 dark:text-neutral-400">Analizza email o PDF tecnici e aggiungi i dati automaticamente in Pandetta.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Input */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6">
                        <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-4">Sorgente Dati</h3>
                        
                        <button
                            onClick={handleFileUpload}
                            disabled={isProcessing}
                            className="w-full mb-6 border-2 border-dashed border-primary-200 hover:border-primary-500 bg-primary-50/50 dark:border-primary-900 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-xl p-8 flex flex-col items-center justify-center transition-all disabled:opacity-50"
                        >
                            <Upload className="w-10 h-10 text-primary-500 mb-2" />
                            <span className="font-bold text-primary-700 dark:text-primary-400">Carica PDF o Email (.txt, .eml)</span>
                        </button>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                <div className="w-full border-t border-neutral-200 dark:border-neutral-700"></div>
                            </div>
                            <div className="relative flex justify-center">
                                <span className="px-3 bg-white dark:bg-neutral-800 text-sm font-medium text-neutral-500">Oppure incolla il testo</span>
                            </div>
                        </div>

                        <textarea
                            value={sourceText}
                            onChange={(e) => setSourceText(e.target.value)}
                            placeholder="Incolla qui il testo dell'email di assistenza..."
                            className="mt-6 w-full h-48 p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 resize-none dark:text-white"
                        />
                        
                        <button
                            onClick={handleExtractClick}
                            disabled={!sourceText.trim()}
                            className={`w-full mt-4 flex justify-center items-center gap-2 px-5 py-3 font-bold rounded-xl transition-colors 
                                ${isProcessing 
                                    ? 'bg-red-500 hover:bg-red-600 text-white' 
                                    : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 text-white'}
                                disabled:opacity-50`}
                        >
                            {isProcessing ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Brain className="w-5 h-5" />}
                            <div className="flex flex-col items-center">
                                <span>{isProcessing ? 'Interrompi Analisi' : 'Analizza con AI'}</span>
                                {isProcessing && (
                                    <span className="text-[10px] opacity-80 font-mono">Tempo trascorso: {timerValue.toFixed(1)}s</span>
                                )}
                            </div>
                        </button>

                        {executionTime !== null && !isProcessing && (
                            <div className="mt-3 flex items-center justify-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 py-2 rounded-lg border border-emerald-100 dark:border-emerald-800 animate-in fade-in slide-in-from-top-2">
                                <RefreshCw className="w-3 h-3" />
                                Analisi completata in {executionTime.toFixed(2)} secondi
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Output & Form */}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 flex flex-col">
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-emerald-500" />
                            Dati Estratti {executionTime !== null && <span className="text-[10px] font-normal text-neutral-400 ml-1">({executionTime.toFixed(2)}s)</span>}
                        </h3>
                        {!csvPath && (
                            <span className="text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1 rounded-full">CSV non configurato</span>
                        )}
                    </div>

                    {saveStatus && (
                        <div className={`p-4 rounded-xl mb-6 text-sm font-semibold flex items-center gap-2
                            ${saveStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30' : 
                              saveStatus.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30' : 
                              'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30'}
                        `}>
                            {saveStatus.type === 'success' ? <CheckCircle className="w-5 h-5" /> : null}
                            {saveStatus.msg}
                        </div>
                    )}

                    {!extracted ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 p-8 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl">
                            <Database className="w-12 h-12 mb-4 opacity-50" />
                            <p className="text-center font-medium">I dati estratti appariranno qui. Carica un file per iniziare l'analisi.</p>
                        </div>
                    ) : (
                        <div className="flex-1 space-y-4 overflow-y-auto pr-2 pb-4 animate-in fade-in duration-300">
                            {[
                                { key: 'richiestaIntervento', label: 'Richiesta n.' },
                                { key: 'data', label: 'Data' },
                                { key: 'cliente', label: 'Cliente' },
                                { key: 'ubicazione', label: 'Ubicazione' },
                                { key: 'strumentoDaRiparare', label: 'Strumento / SN' },
                                { key: 'tipoDiAttivitaGuasto', label: 'Problema Segnalato / Attività' },
                                { key: 'tecnico', label: 'Tecnico (se assegnato)' }
                            ].map(({ key, label }) => (
                                <div key={key} className="bg-neutral-50 dark:bg-neutral-700/30 p-3 rounded-lg border border-neutral-100 dark:border-neutral-700">
                                    <label className="block text-xs font-bold text-neutral-500 tracking-wide uppercase mb-1">{label}</label>
                                    <input 
                                        type="text" 
                                        value={extracted[key as keyof ExtractedData]} 
                                        onChange={(e) => handleFieldChange(key as keyof ExtractedData, e.target.value)}
                                        className="w-full bg-transparent border-none outline-none focus:ring-0 p-0 text-neutral-900 dark:text-white text-sm font-semibold"
                                    />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-neutral-700">
                        <button
                            onClick={handleSaveToCsv}
                            disabled={!extracted || isSaving || !csvPath}
                            className="w-full flex justify-center items-center gap-2 px-5 py-4 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:hover:bg-primary-600"
                        >
                            {isSaving ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Database className="w-6 h-6" />}
                            Salva in Pandetta CSV
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AIExtraction;
