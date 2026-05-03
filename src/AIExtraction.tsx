import { useState, useEffect } from 'react';
import { ArrowLeft, Upload, FileText, Database, CheckCircle, Brain, RefreshCw, Settings, Mail, RefreshCcw, X, Paperclip, Search } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { extractTextFromPdf } from './utils/pdfParser';
import { extractTextFromDocx } from './utils/docxParser';
import { generateOllamaExtraction, type ExtractedData } from './utils/ollama';
import { sendAppNotification } from './utils/notifications';
import { getEmailSettings, setEmailSettings, type EmailSettings, DEFAULT_EMAIL_SETTINGS, getGoogleSettings, getEmailsJson, saveEmailsJson, getProcessedEmailIds, addProcessedEmailId, getExcelDataJson } from './utils/storage';
import { fetchGmailEmails, refreshAccessToken } from './utils/googleCalendar';
import PostalMime from 'postal-mime';

interface AIExtractionProps {
    onBack: () => void;
    onAddToPandetta?: (data: ExtractedData) => void;
    hasPandettaFile?: boolean;
    theme?: 'light' | 'dark';
}

interface FetchedEmail {
    id: string;
    messageId: string;
    subject: string;
    from: string;
    date: string;
    body: string;
    attachments: { filename: string, mimeType: string, data: string }[];
}

const formatDateItalian = (dateStr: string) => {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleString('it-IT', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
};

const HighlightedText = ({ text, highlight }: { text: string, highlight: string }) => {
    if (!highlight.trim()) return <>{text}</>;

    const regex = new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return (
        <>
            {parts.map((part, i) =>
                regex.test(part) ? (
                    <mark key={i} className="bg-primary-200 dark:bg-primary-900/60 dark:text-primary-100 rounded-sm px-0.5">
                        {part}
                    </mark>
                ) : (
                    part
                )
            )}
        </>
    );
};

export function AIExtraction({ onBack, onAddToPandetta, hasPandettaFile }: AIExtractionProps) {
    const [sourceText, setSourceText] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [extracted, setExtracted] = useState<ExtractedData | null>(null);
    const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | 'warning', msg: string } | null>(null);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const [executionTime, setExecutionTime] = useState<number | null>(null);
    const [timerValue, setTimerValue] = useState<number>(0);
    const [isDragging, setIsDragging] = useState(false);

    // IMAP & Email State
    const [inputMode, setInputMode] = useState<'imap' | 'manual'>('imap');
    const [emailSettings, setEmailSettingsState] = useState<EmailSettings>(DEFAULT_EMAIL_SETTINGS);
    const [showSettings, setShowSettings] = useState(false);
    const [emails, setEmails] = useState<FetchedEmail[]>([]);
    const [selectedEmail, setSelectedEmail] = useState<FetchedEmail | null>(null);
    const [isFetchingEmails, setIsFetchingEmails] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [processedIds, setProcessedIds] = useState<string[]>([]);
    const [pandettaRows, setPandettaRows] = useState<any[]>([]);

    useEffect(() => {
        // Carica impostazioni email
        getEmailSettings().then(setEmailSettingsState);
        // Carica email locali
        getEmailsJson().then(saved => {
            if (saved && Array.isArray(saved)) {
                setEmails(saved);
            }
        });
        // Carica messageId processati e righe pandetta per controlli incrociati
        getProcessedEmailIds().then(setProcessedIds);
        getExcelDataJson('pandetta').then(data => {
            if (data) setPandettaRows(data);
        });
    }, []);

    // Polling automatico e sincronizzazione al focus
    useEffect(() => {
        let intervalId: any;

        const performSync = () => {
            if (emailSettings.autoCheck) {
                // Se siamo in modalità Gmail, verifichiamo di avere il token
                getGoogleSettings().then(googleSettings => {
                    if (googleSettings?.accessToken || (emailSettings.username && emailSettings.password)) {
                        handleFetchEmails(true);
                    }
                });
            }
        };

        if (emailSettings.autoCheck) {
            // Sincronizza ogni 2 minuti invece di 5 per un feeling più real-time
            intervalId = setInterval(performSync, 2 * 60 * 1000);

            // Sincronizza anche quando l'utente torna sull'app (focus finestra)
            window.addEventListener('focus', performSync);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
            window.removeEventListener('focus', performSync);
        };
    }, [emailSettings.autoCheck, emailSettings.username, emailSettings.password]);

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
        let unlistenDrop: any = null;
        let unlistenEnter: any = null;
        let unlistenLeave: any = null;

        const setupTauriEvents = async () => {
            unlistenEnter = await listen('tauri://drag-enter', () => {
                setIsDragging(true);
            });

            unlistenLeave = await listen('tauri://drag-leave', () => {
                setIsDragging(false);
            });

            unlistenDrop = await listen('tauri://drag-drop', async (event: any) => {
                setIsDragging(false);
                const paths = event.payload.paths;
                if (paths && paths.length > 0) {
                    try {
                        setInputMode('manual'); // Forza il tab manuale
                        const filePath = paths[0];
                        const fileName = filePath.split(/[/\\]/).pop() || '';
                        const content = await readFile(filePath);
                        await processFileContent(fileName, content, filePath);
                    } catch (error) {
                        console.error("Errore durante il caricamento del file:", error);
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
    }, []);

    const handleSaveSettings = async () => {
        await setEmailSettings(emailSettings);
        setShowSettings(false);
        setSaveStatus({ type: 'success', msg: 'Impostazioni IMAP salvate.' });
    };

    const isEmailRelevant = (email: FetchedEmail) => {
        const keywords = ['richiesta', 'si richiede', 'odl', 'sopralluogo', 'assistenza tecnica', 'manutenzione', 'riparazione', 'intervento in garanzia', 'guasto'];
        const lowerSubj = email.subject.toLowerCase();
        const lowerBody = email.body.toLowerCase();
        return keywords.some(k => lowerSubj.includes(k) || lowerBody.includes(k));
    };

    const isEmailInPandetta = (email: FetchedEmail) => {
        // 1. Controllo ID processato
        if (processedIds.includes(email.messageId)) return true;

        // 2. Controllo incrociato con Pandetta (testo in Oggetto o Corpo)
        const lowerSubj = email.subject.toLowerCase();
        const lowerBody = email.body.toLowerCase();

        for (const row of pandettaRows) {
            if (row._empty) continue;

            // Cerca se la Richiesta/ODL della pandetta è menzionata nell'email
            const keys = Object.keys(row);
            const reqKey = keys.find(k => k.toUpperCase().includes('RICHIESTA'));
            if (reqKey) {
                const richiesta = String(row[reqKey] || '').toLowerCase().trim();
                // Assumiamo che se l'ODL è di almeno 3 caratteri ed è presente, sia un match
                if (richiesta.length > 3 && (lowerSubj.includes(richiesta) || lowerBody.includes(richiesta))) {
                    return true;
                }
            }

            // Prova con Cliente (se nome molto specifico > 5 caratteri ed è nell'oggetto)
            const cliKey = keys.find(k => k.toUpperCase().includes('CLIENTE'));
            if (cliKey) {
                const cliente = String(row[cliKey] || '').toLowerCase().trim();
                if (cliente.length > 5 && lowerSubj.includes(cliente)) {
                    return true;
                }
            }
        }

        return false;
    };

    const handleFetchEmails = async (silent = false) => {
        // Se usiamo Gmail API, non servono username/password IMAP ma i token Google
        if (emailSettings.useGmailAPI) {
            setIsFetchingEmails(true);
            if (!silent) setSaveStatus(null);
            try {
                const gSettings = await getGoogleSettings();
                if (!gSettings.enabled || !gSettings.refreshToken) {
                    if (!silent) setSaveStatus({ type: 'warning', msg: 'Integrazione Google non configurata. Vai in Impostazioni -> Google Calendar.' });
                    return;
                }

                let token = gSettings.accessToken;
                // Check expiry (con margine di 1 minuto)
                if (!token || !gSettings.expiryDate || Date.now() > gSettings.expiryDate - 60000) {
                    const newTokens = await refreshAccessToken(gSettings.refreshToken, gSettings.clientId, gSettings.clientSecret);
                    token = newTokens.accessToken;
                }

                const gmailEmails = await fetchGmailEmails(token, emailSettings.maxEmails || 15);

                let newCount = 0;
                setEmails(prev => {
                    const existingIds = new Set(prev.map(e => e.messageId));
                    // Filtra solo le nuove email E che contengono le keyword
                    const filteredNew = gmailEmails.filter(e => !existingIds.has(e.messageId) && isEmailRelevant(e));
                    newCount = filteredNew.length;

                    if (newCount > 0) {
                        const combined = [...filteredNew, ...prev];
                        const unique = Array.from(new Map(combined.map(item => [item.messageId, item])).values());
                        saveEmailsJson(unique);
                        return unique;
                    }
                    return prev;
                });

                if (newCount > 0) {
                    sendAppNotification("Nuove Email (Gmail)", `Trovati ${newCount} nuovi messaggi rilevanti.`);
                    if (!silent) setSaveStatus({ type: 'success', msg: `Sincronizzazione Gmail completata: ${newCount} nuovi messaggi rilevanti.` });
                } else {
                    if (!silent) setSaveStatus({ type: 'success', msg: `Nessun nuovo messaggio rilevante Gmail.` });
                }
                return;
            } catch (error: any) {
                console.error("Gmail fetch error:", error);
                if (!silent) setSaveStatus({ type: 'error', msg: `Errore Gmail API: ${error.message}` });
                return;
            } finally {
                setIsFetchingEmails(false);
            }
        }

        if (!emailSettings.username || !emailSettings.password) {
            if (!silent) {
                setSaveStatus({ type: 'warning', msg: 'Configura le credenziali email nelle impostazioni (icona ingranaggio).' });
                setShowSettings(true);
            }
            return;
        }
        setIsFetchingEmails(true);
        if (!silent) setSaveStatus(null);
        try {
            const result: any = await invoke('check_email_command', { settings: emailSettings });

            if (result.success) {
                const newEmails = result.emails as FetchedEmail[];
                let newCount = 0;
                setEmails(prev => {
                    const existingIds = new Set(prev.map(e => e.messageId));
                    // Filtra solo le nuove email E che contengono le keyword
                    const filteredNew = newEmails.filter(e => !existingIds.has(e.messageId) && isEmailRelevant(e));
                    newCount = filteredNew.length;

                    if (newCount > 0) {
                        const combined = [...filteredNew, ...prev];
                        const unique = Array.from(new Map(combined.map(item => [item.messageId, item])).values());
                        saveEmailsJson(unique);
                        return unique;
                    }
                    return prev;
                });
                if (newCount > 0) {
                    sendAppNotification("Nuove Email", `Trovati ${newCount} nuovi messaggi rilevanti in arrivo.`);
                    if (!silent) setSaveStatus({ type: 'success', msg: `Sincronizzazione completata: ${newCount} nuovi messaggi rilevanti.` });
                } else {
                    if (!silent) setSaveStatus({ type: 'success', msg: `Nessun nuovo messaggio rilevante trovato.` });
                }
            } else {
                if (!silent) setSaveStatus({ type: 'error', msg: result.error || 'Errore durante la sincronizzazione IMAP.' });
            }
        } catch (error: any) {
            if (!silent) setSaveStatus({ type: 'error', msg: `Errore durante la chiamata al sidecar: ${error}` });
        } finally {
            setIsFetchingEmails(false);
        }
    };

    const handleSelectEmail = async (email: FetchedEmail) => {
        setSelectedEmail(email);
        setIsProcessing(false);
        setSaveStatus(null);

        let combinedText = `METADATI:\nDa: ${email.from}\nOggetto: ${email.subject}\nData: ${formatDateItalian(email.date)}\n\nCORPO:\n${email.body}\n`;

        // Process PDF attachments
        if (email.attachments && email.attachments.length > 0) {
            combinedText += `\n--- TESTO ESTRATTO DAGLI ALLEGATI PDF ---\n`;
            for (const att of email.attachments) {
                if (att.mimeType === 'application/pdf') {
                    try {
                        const binaryString = atob(att.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        const pdfResult = await extractTextFromPdf(bytes);
                        combinedText += `\n[ALLEGATO: ${att.filename}]\n${pdfResult.fullText}\n`;
                    } catch (e) {
                        console.error("Error parsing attached PDF:", e);
                        combinedText += `\n[ERRORE DURANTE L'ESTRAZIONE DELL'ALLEGATO: ${att.filename}]\n`;
                    }
                }
            }
        }

        setSourceText(combinedText);
        setExtracted(null);
    };

    const processFileContent = async (fileName: string, content: Uint8Array, filePath?: string) => {
        setIsProcessing(false);
        setSaveStatus(null);

        let text = '';
        const lowerName = fileName.toLowerCase();

        if (lowerName.endsWith('.pdf')) {
            const pdfResult = await extractTextFromPdf(content);
            text = pdfResult.fullText;
        } else if (lowerName.endsWith('.docx')) {
            const file = new File([content as any], fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
            text = await extractTextFromDocx(file);
        } else if (lowerName.endsWith('.doc')) {
            if (filePath) {
                try {
                    const docxContent = await invoke<number[]>('convert_doc_to_docx', { inputPath: filePath });
                    const docxUint8 = new Uint8Array(docxContent);
                    const file = new File([docxUint8 as any], fileName + 'x', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
                    text = await extractTextFromDocx(file);
                } catch (err) {
                    console.error('Extraction error (.doc):', err);
                    setSaveStatus({ type: 'error', msg: 'Errore durante la conversione del file .doc.' });
                    return;
                }
            } else {
                setSaveStatus({ type: 'error', msg: 'Percorso file mancante per conversione .doc.' });
                return;
            }
        } else if (fileName.toLowerCase().endsWith('.eml')) {
            const parser = new PostalMime();
            const email = await parser.parse(content as any);

            const metaFrom = email.from?.address || email.from?.name || '';
            const metaSubject = email.subject || '';
            const metaDate = email.date || '';

            let bodyText = email.text || '';
            if (!bodyText && email.html) {
                bodyText = email.html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<[^>]*>?/gm, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            let combinedText = `METADATI:\nDa: ${metaFrom}\nOggetto: ${metaSubject}\nData: ${metaDate}\n\nCORPO:\n${bodyText}\n`;

            // Parsing degli allegati PDF dentro la EML
            if (email.attachments && email.attachments.length > 0) {
                combinedText += `\n--- TESTO ESTRATTO DAGLI ALLEGATI PDF ---\n`;
                for (const att of email.attachments) {
                    if (att.mimeType === 'application/pdf' || (att.filename && att.filename.toLowerCase().endsWith('.pdf'))) {
                        try {
                            const contentBytes = att.content instanceof Uint8Array ? att.content : new Uint8Array(att.content as any);
                            const pdfResult = await extractTextFromPdf(contentBytes);
                            combinedText += `\n[ALLEGATO: ${att.filename}]\n${pdfResult.fullText}\n`;
                        } catch (e) {
                            console.error("Error parsing attached PDF from EML:", e);
                            combinedText += `\n[ERRORE DURANTE L'ESTRAZIONE DELL'ALLEGATO: ${att.filename}]\n`;
                        }
                    }
                }
            }

            text = combinedText;
        } else {
            const decoder = new TextDecoder();
            text = decoder.decode(content);
        }

        setSourceText(text);
        setExtracted(null);
    };

    const handleFileUpload = async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [{ name: 'Documenti', extensions: ['pdf', 'txt', 'eml', 'docx', 'doc'] }]
            });

            if (selected && typeof selected === 'string') {
                const fileName = selected.split(/[/\\]/).pop() || '';
                const content = await readFile(selected);
                await processFileContent(fileName, content, selected);
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
            sendAppNotification("Analisi Completata", `Dati estratti con successo per ${result.cliente || 'il cliente'}.`);
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

    const handleSaveToPandetta = async () => {
        if (!extracted || !extracted.data || !extracted.cliente) {
            setSaveStatus({ type: 'error', msg: 'Attenzione: Data e Cliente sono campi obbligatori.' });
            return;
        }

        if (onAddToPandetta) {
            onAddToPandetta(extracted);
            if (selectedEmail) {
                addProcessedEmailId(selectedEmail.messageId).then(() => {
                    setProcessedIds(prev => [...prev, selectedEmail.messageId]);
                });
            }
            setSaveStatus({ type: 'success', msg: 'Intervento aggiunto alla Pandetta con stato APERTO.' });
            setExtracted(null);
            setSourceText('');
            setSelectedEmail(null);
        } else {
            setSaveStatus({ type: 'error', msg: 'Pandetta non disponibile. Carica prima un file Excel.' });
        }
    };

    return (
        <div className="max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 relative h-full flex flex-col">
            {isDragging && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-12 bg-black/40 backdrop-blur-sm pointer-events-none">
                    <div className="w-full h-full border-4 border-dashed border-primary-500 rounded-3xl flex flex-col items-center justify-center bg-white dark:bg-neutral-900 shadow-2xl animate-in zoom-in-95 duration-200">
                        <Upload className="w-20 h-20 text-primary-500 mb-4 animate-bounce" />
                        <h3 className="text-3xl font-black text-neutral-900 dark:text-white mb-2 text-center px-4">Rilascia il file per l'estrazione</h3>
                        <p className="text-xl text-neutral-600 dark:text-neutral-400 text-center px-4">PDF, Word (.doc, .docx) o Email verranno elaborati automaticamente</p>
                    </div>
                </div>
            )}

            {/* Impostazioni IMAP Modal */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl max-w-md w-full p-6 animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold flex items-center gap-2 dark:text-white"><Mail className="w-5 h-5" /> Configurazione Email Aruba</h3>
                            <button onClick={() => setShowSettings(false)} className="text-neutral-400 hover:text-neutral-600"><X className="w-5 h-5" /></button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-neutral-50 dark:bg-neutral-900/50 p-3 rounded-xl border border-neutral-100 dark:border-neutral-700">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                                            <Mail className="w-4 h-4 text-red-600" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold dark:text-white">Usa Google / Gmail API</div>
                                            <div className="text-[10px] text-neutral-500">Usa l'account Google collegato al Calendario</div>
                                        </div>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={emailSettings.useGmailAPI}
                                        onChange={e => setEmailSettingsState({ ...emailSettings, useGmailAPI: e.target.checked })}
                                        className="w-5 h-5 text-primary-600 rounded"
                                    />
                                </div>
                            </div>

                            {!emailSettings.useGmailAPI && (
                                <div className="space-y-4 animate-in slide-in-from-top-2 duration-200">
                                    <div>
                                        <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Provider Predefinito</label>
                                        <select
                                            className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white"
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'aruba') {
                                                    setEmailSettingsState({ ...emailSettings, host: 'imap.aruba.it', port: 993 });
                                                } else if (val === 'yahoo') {
                                                    setEmailSettingsState({ ...emailSettings, host: 'imap.mail.yahoo.com', port: 993 });
                                                } else if (val === 'gmail') {
                                                    setEmailSettingsState({ ...emailSettings, host: 'imap.gmail.com', port: 993 });
                                                } else if (val === 'outlook') {
                                                    setEmailSettingsState({ ...emailSettings, host: 'imap-mail.outlook.com', port: 993 });
                                                }
                                            }}
                                        >
                                            <option value="">-- Seleziona o inserisci manuale --</option>
                                            <option value="aruba">Aruba</option>
                                            <option value="yahoo">Yahoo Mail</option>
                                            <option value="gmail">Gmail (via IMAP)</option>
                                            <option value="outlook">Outlook / Hotmail</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Host IMAP</label>
                                        <input type="text" value={emailSettings.host} onChange={e => setEmailSettingsState({ ...emailSettings, host: e.target.value })} className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white" placeholder="imap.aruba.it" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Porta (SSL)</label>
                                        <input type="number" value={emailSettings.port} onChange={e => setEmailSettingsState({ ...emailSettings, port: parseInt(e.target.value) })} className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Email / Username</label>
                                        <input type="text" value={emailSettings.username} onChange={e => setEmailSettingsState({ ...emailSettings, username: e.target.value })} className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white" placeholder="tuonome@dominio.it" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Password</label>
                                        <input type="password" value={emailSettings.password} onChange={e => setEmailSettingsState({ ...emailSettings, password: e.target.value })} className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white" placeholder="••••••••" />
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-1">Max Email da scaricare</label>
                                <input type="number" value={emailSettings.maxEmails} onChange={e => setEmailSettingsState({ ...emailSettings, maxEmails: parseInt(e.target.value) })} className="w-full p-2 border border-neutral-300 dark:border-neutral-600 rounded-lg dark:bg-neutral-700 dark:text-white" />
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                <input type="checkbox" id="autoCheck" checked={emailSettings.autoCheck} onChange={e => setEmailSettingsState({ ...emailSettings, autoCheck: e.target.checked })} className="w-4 h-4 text-primary-600" />
                                <label htmlFor="autoCheck" className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Sincronizza in automatico in background (ogni 5 min)</label>
                            </div>
                        </div>

                        <div className="mt-8 flex justify-end gap-3">
                            <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-neutral-600 font-bold hover:bg-neutral-100 dark:hover:bg-neutral-700 rounded-lg">Annulla</button>
                            <button onClick={handleSaveSettings} className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700">Salva Credenziali</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-4 mb-8 shrink-0">
                <button
                    onClick={onBack}
                    className="p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                >
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white flex items-center gap-3">
                        <Brain className="w-8 h-8 text-primary-600" />
                        AI Hub & Sincronizzazione Email
                    </h2>
                    <p className="text-neutral-600 dark:text-neutral-400">Recupera le email da Aruba, Yahoo, Gmail o carica un PDF/Documento, poi estrai automaticamente i dati per Pandetta.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0">
                {/* Left Column: Input Source */}
                <div className="flex flex-col space-y-4 h-full min-h-0">
                    <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 flex flex-col h-full min-h-0">

                        {/* Source Tabs */}
                        <div className="flex gap-2 mb-6 shrink-0 bg-neutral-100 dark:bg-neutral-900 p-1 rounded-xl">
                            <button onClick={() => setInputMode('imap')} className={`flex-1 py-2.5 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${inputMode === 'imap' ? 'bg-white dark:bg-neutral-800 shadow-sm text-primary-700 dark:text-primary-400' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>
                                <Mail className="w-4 h-4" /> Inbox IMAP
                            </button>
                            <button onClick={() => setInputMode('manual')} className={`flex-1 py-2.5 rounded-lg font-bold text-sm flex justify-center items-center gap-2 transition-colors ${inputMode === 'manual' ? 'bg-white dark:bg-neutral-800 shadow-sm text-primary-700 dark:text-primary-400' : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'}`}>
                                <Upload className="w-4 h-4" /> Caricamento Manuale
                            </button>
                        </div>

                        {/* IMAP Mode Controls */}
                        {inputMode === 'imap' && (
                            <div className="flex flex-col flex-[1.2] min-h-0">
                                <div className="flex gap-2 items-center mb-4 shrink-0">
                                    <button
                                        onClick={() => handleFetchEmails(false)}
                                        disabled={isFetchingEmails}
                                        className="flex items-center gap-2 px-4 py-2 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:hover:bg-white dark:text-neutral-900 text-white text-sm font-bold rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        <RefreshCcw className={`w-4 h-4 ${isFetchingEmails ? 'animate-spin' : ''}`} />
                                        {isFetchingEmails ? '...' : 'Sincronizza'}
                                    </button>

                                    <div className="flex-1 relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                                        <input
                                            type="text"
                                            placeholder="Cerca nelle email..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 bg-neutral-100 dark:bg-neutral-700 border border-neutral-200 dark:border-neutral-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>

                                    <button onClick={() => setShowSettings(true)} className="p-2 bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-700 dark:hover:bg-neutral-600 text-neutral-600 dark:text-neutral-300 rounded-lg transition-colors">
                                        <Settings className="w-5 h-5" />
                                    </button>
                                </div>

                                {/* Email List */}
                                <div className="flex-1 overflow-y-auto space-y-2 pr-2 mb-4">
                                    {emails.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-neutral-400 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl">
                                            <Mail className="w-10 h-10 mb-2 opacity-50" />
                                            <p className="text-sm font-medium">Nessuna email sincronizzata.</p>
                                        </div>
                                    ) : (
                                        (() => {
                                            const filtered = emails.filter(e =>
                                                e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
                                                e.from.toLowerCase().includes(searchQuery.toLowerCase())
                                            );

                                            if (filtered.length === 0 && searchQuery) {
                                                return (
                                                    <div className="h-full flex flex-col items-center justify-center text-neutral-400">
                                                        <Search className="w-8 h-8 mb-2 opacity-30" />
                                                        <p className="text-xs">Nessun risultato per "{searchQuery}"</p>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <>
                                                    {filtered.map(e => {
                                                        const isNewRequest = !isEmailInPandetta(e);
                                                        return (
                                                            <div
                                                                key={e.messageId}
                                                                onClick={() => handleSelectEmail(e)}
                                                                className={`p-4 rounded-xl cursor-pointer border transition-all relative ${selectedEmail?.messageId === e.messageId ? 'border-primary-500 bg-primary-100/50 dark:bg-primary-900/20 dark:border-primary-700' : isNewRequest ? 'border-amber-400 dark:border-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/10' : 'border-neutral-200 dark:border-neutral-700 hover:border-primary-300 hover:bg-neutral-100/50 dark:hover:bg-neutral-700/50'}`}
                                                            >
                                                                {isNewRequest && (
                                                                    <div className="absolute top-0 right-0 -mt-2 -mr-2 bg-amber-500 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                                                                        Nuova Richiesta
                                                                    </div>
                                                                )}
                                                                <div className={`font-bold text-sm truncate mb-1 pr-6 ${isNewRequest ? 'text-amber-900 dark:text-amber-100' : 'text-neutral-900 dark:text-white'}`}>
                                                                    <HighlightedText text={e.subject} highlight={searchQuery} />
                                                                </div>
                                                                <div className={`text-xs truncate ${isNewRequest ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-600 dark:text-neutral-400'}`}>
                                                                    <HighlightedText text={e.from} highlight={searchQuery} />
                                                                </div>
                                                                <div className="text-[10px] text-neutral-400 mt-2 flex justify-between items-center">
                                                                    <span className={isNewRequest ? 'text-amber-600/70 dark:text-amber-400/70' : ''}>{formatDateItalian(e.date)}</span>
                                                                    {e.attachments.length > 0 && (
                                                                        <span className="flex items-center gap-1 text-primary-600 font-bold bg-primary-100 dark:bg-primary-900/40 px-2 py-0.5 rounded-full">
                                                                            <Paperclip className="w-3 h-3" /> {e.attachments.length} PDF
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </>
                                            );
                                        })()
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Manual Mode Controls */}
                        {inputMode === 'manual' && (
                            <div className="shrink-0 mb-6">
                                <button
                                    onClick={handleFileUpload}
                                    disabled={isProcessing}
                                    className="w-full border-2 border-dashed border-primary-200 hover:border-primary-500 bg-primary-50/50 dark:border-primary-900 dark:bg-primary-900/10 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-xl p-8 flex flex-col items-center justify-center transition-all disabled:opacity-50"
                                >
                                    <Upload className="w-10 h-10 text-primary-500 mb-2" />
                                    <span className="font-bold text-primary-700 dark:text-primary-400">Carica PDF, Word (.doc/x) o Email (.eml)</span>
                                </button>
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                        <div className="w-full border-t border-neutral-200 dark:border-neutral-700"></div>
                                    </div>
                                    <div className="relative flex justify-center">
                                        <span className="px-3 bg-white dark:bg-neutral-800 text-xs font-medium text-neutral-500 uppercase tracking-widest">Oppure incolla il testo</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Unified Text Area & Extract Button */}
                        <div className="flex flex-col flex-1 min-h-0 mt-4">
                            <textarea
                                value={sourceText}
                                onChange={(e) => setSourceText(e.target.value)}
                                placeholder="Il testo da analizzare apparirà qui..."
                                className="flex-1 w-full p-4 bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl outline-none focus:ring-2 focus:ring-primary-500 resize-none dark:text-white font-mono text-xs"
                            />

                            <button
                                onClick={handleExtractClick}
                                disabled={!sourceText.trim()}
                                className={`w-full mt-4 shrink-0 flex justify-center items-center gap-2 px-5 py-3 font-bold rounded-xl transition-colors 
                                    ${isProcessing
                                        ? 'bg-red-500 hover:bg-red-600 text-white'
                                        : 'bg-primary-600 hover:bg-primary-700 text-white'}
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
                        </div>
                    </div>
                </div>

                {/* Right Column: Output & Form */}
                <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 flex flex-col h-full min-h-0">
                    <div className="flex items-center justify-between mb-6 shrink-0">
                        <h3 className="text-lg font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                            <FileText className="w-5 h-5 text-emerald-500" />
                            Dati Estratti {executionTime !== null && <span className="text-[10px] font-normal text-neutral-400 ml-1">({executionTime.toFixed(2)}s)</span>}
                        </h3>
                        {!hasPandettaFile && (
                            <span className="text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1 rounded-full">Carica Pandetta</span>
                        )}
                    </div>

                    {saveStatus && (
                        <div className={`shrink-0 p-4 rounded-xl mb-6 text-sm font-semibold flex items-center gap-2
                            ${saveStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30' :
                                saveStatus.type === 'warning' ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/30' :
                                    'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30'}
                        `}>
                            {saveStatus.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0" /> : null}
                            {saveStatus.msg}
                        </div>
                    )}

                    {!extracted ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 p-8 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl min-h-0">
                            <Database className="w-12 h-12 mb-4 opacity-50" />
                            <p className="text-center font-medium">I dati estratti appariranno qui. Carica un file o seleziona un'email per iniziare l'analisi.</p>
                        </div>
                    ) : (
                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 pb-4 animate-in fade-in duration-300 min-h-0">
                            {[
                                { key: 'richiestaIntervento', label: 'Richiesta n.' },
                                { key: 'data', label: 'Data' },
                                { key: 'cliente', label: 'Cliente' },
                                { key: 'ubicazione', label: 'Ubicazione' },
                                { key: 'strumentoDaRiparare', label: 'Strumento / SN' },
                                { key: 'tipoDiAttivitaGuasto', label: 'Problema Segnalato / Attività' },
                                { key: 'tecnico', label: 'Tecnico (se assegnato)' }
                            ].map(({ key, label }) => (
                                <div key={key} className="bg-neutral-100 dark:bg-neutral-700/30 p-3 rounded-lg border border-neutral-200 dark:border-neutral-700">
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

                    <div className="mt-6 pt-6 border-t border-neutral-100 dark:border-neutral-700 shrink-0">
                        <button
                            onClick={handleSaveToPandetta}
                            disabled={!extracted || !hasPandettaFile}
                            className="w-full flex justify-center items-center gap-2 px-5 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-colors disabled:opacity-50 disabled:hover:bg-emerald-600"
                        >
                            <Database className="w-6 h-6" />
                            Salva in Pandetta
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AIExtraction;
