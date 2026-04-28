import { useState, useEffect, useRef } from 'react';
import { FileText, Settings, Home as HomeIcon, FileIcon, Sun, Moon, Brain, Database, FileSpreadsheet, Calendar } from 'lucide-react';
import { open, save, ask, message } from '@tauri-apps/plugin-dialog';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { readFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

import { extractFieldsFromDocx } from './utils/docxParser';
import type { FormField } from './utils/docxParser';

import { saveTemplateFile, getTemplateFile, getAllTemplatesMeta, deleteTemplate, type TemplateIndex, getSetting, setSetting, getTechnicians, setTechnicians, getCustomLayout, type CustomLayout, getSavePath, setSavePath, getNextDocNumber, getAiSettings, setAiSettings, type AiSettings, DEFAULT_AI_SETTINGS, getUpdateSettings, setUpdateSettings, checkForUpdates, installUpdate, getCurrentVersion, type UpdateSettings, DEFAULT_UPDATE_SETTINGS, getSectionDefinitions, type SectionDefinition, DEFAULT_SECTIONS, exportAllSettings, importAllSettings, resetAllSettings, getExcelFileName, getExcelFilePath, clearExcelFile, getGoogleSettings, setGoogleSettings, type GoogleCalendarSettings } from './utils/storage';
import { getGoogleAuthUrl, getTokensFromCode } from './utils/googleCalendar';
import { sendAppNotification } from './utils/notifications';
import AIExtraction from './AIExtraction';
import SterlinkManagerPage from './SterlinkManagerPage';
import PandettaManager from './PandettaManager';
import CalendarPage from './CalendarPage';
import TemplateManagerPage from './TemplateManagerPage';
import SettingsPage from './SettingsPage';
import './App.css';

type View = 'home' | 'templates' | 'settings' | 'form' | 'download' | 'ai-extraction' | 'sterlink-manager' | 'pandetta-manager' | 'calendar';

function App() {
  const [activeSettingsTab, setActiveSettingsTab] = useState<'system' | 'database' | 'templates' | 'integrations'>('system');


  const [currentView, setCurrentView] = useState<View>('home');
  const [isProcessing, setIsProcessing] = useState(false);

  // Storage State
  const [templateMeta, setTemplateMeta] = useState<(TemplateIndex | undefined)[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [technicians, setTechniciansList] = useState<string[]>([]);
  const [newTechName, setNewTechName] = useState('');
  const [savePath, setSavePathState] = useState('');
  const [customLayout, setCustomLayoutState] = useState<CustomLayout>({});
  const [aiSettings, setAiSettingsState] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);

  // Update State
  const [updateSettings, setUpdateSettingsState] = useState<UpdateSettings>(DEFAULT_UPDATE_SETTINGS);
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'available' | 'downloaded' | 'error' | 'up-to-date'>('idle');
  const [latestVersion, setLatestVersion] = useState<string>('');
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [updateBody, setUpdateBody] = useState<string | null>(null);
  const [updateDate, setUpdateDate] = useState<string | null>(null);

  // Form State

  // Navigation color mapping for icons
  const navColorMap: Record<View, {text: string; bg: string; hoverBg: string}> = {
    home: {text: 'text-primary-600', bg: 'bg-primary-50 dark:bg-primary-900/30', hoverBg: ''},
    templates: {text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', hoverBg: ''},
    form: {text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', hoverBg: ''},
    download: {text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20', hoverBg: ''},
    'ai-extraction': {text: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20', hoverBg: ''},
    'sterlink-manager': {text: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20', hoverBg: ''},
    'pandetta-manager': {text: 'text-cyan-600', bg: 'bg-cyan-50 dark:bg-cyan-900/20', hoverBg: ''},
    calendar: {text: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', hoverBg: ''},
    settings: {text: 'text-neutral-600', bg: 'bg-neutral-100 dark:bg-neutral-800', hoverBg: ''},
  };

  const getNavClasses = (view: View) => {
    const base = 'p-2 transition-colors rounded-lg';
    const active = navColorMap[view];
    const isActive = currentView === view;
    return `${base} ${isActive ? `${active.text} ${active.bg}` : 'text-neutral-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-neutral-700'}`;
  };

// Form State
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [isAiSaved, setIsAiSaved] = useState(false);
  const [sectionDefinitions, setSectionDefinitionsState] = useState<SectionDefinition[]>(DEFAULT_SECTIONS);
  const [isSectionsSaved, setIsSectionsSaved] = useState(false);
  const [googleSettings, setGoogleSettingsState] = useState<GoogleCalendarSettings | null>(null);
  const [isGoogleSaved, setIsGoogleSaved] = useState(false);
  const [googleAuthCode, setGoogleAuthCode] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [pandettaFileName, setPandettaFileName] = useState<string | null>(null);
  const [pandettaFilePath, setPandettaFilePath] = useState<string | null>(null);
  const [sterlinkFileName, setSterlinkFileName] = useState<string | null>(null);
  const [sterlinkFilePath, setSterlinkFilePath] = useState<string | null>(null);
  const [pendingPandettaRows, setPendingPandettaRows] = useState<any[]>([]);
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

    const savedSavePath = await getSavePath();
    setSavePathState(savedSavePath);

    const savedAiSettings = await getAiSettings();
    setAiSettingsState(savedAiSettings);

    const updSettings = await getUpdateSettings();
    setUpdateSettingsState(updSettings);

    const version = await getCurrentVersion();
    setCurrentVersion(version);

    // 1. Listen for new update available
    listen('update-available', (event: any) => {
      setUpdateStatus('available');
      setLatestVersion(event.payload.version);
      setUpdateBody(typeof event.payload.body === 'string' ? event.payload.body : null);
      setUpdateDate(typeof event.payload.date === 'string' ? event.payload.date : null);

      // Notify user if enabled
      if (updSettings.enabled) {
        sendAppNotification("Nuovo Aggiornamento", `Versione ${event.payload.version} disponibile!`);
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
          sendAppNotification("Nuovo Aggiornamento", `Versione ${result.latestVersion} disponibile!`);

          if (updSettings.autoInstall) {
            installUpdate();
          }
        }
      }).catch(err => console.error('[Update] Startup check error:', err));
    }

    const sections = await getSectionDefinitions();
    setSectionDefinitionsState(sections);

    const pFile = await getExcelFileName('pandetta');
    setPandettaFileName(pFile || null);
    const pPath = await getExcelFilePath('pandetta');
    setPandettaFilePath(pPath || null);

    const sPath = await getExcelFilePath('sterlink');
    setSterlinkFilePath(sPath || null);

    const gSettings = await getGoogleSettings();
    setGoogleSettingsState(gSettings);
  };

  // --- Theme Logic ---


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
    const confirmed = await ask(`Vuoi davvero rimuovere ${technicians[index]} dalla lista dei tecnici?`, { title: 'Rimuovi Tecnico', kind: 'warning' });
    if (confirmed) {
      const updated = technicians.filter((_, i) => i !== index);
      setTechniciansList(updated);
      await setTechnicians(updated);
    }
  };



  // --- Settings Logic ---
  const handleSlotUpload = async (slotId: string) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Word Document', extensions: ['docx', 'doc'] }]
      });

      if (selected && typeof selected === 'string') {
        const isLegacyDoc = selected.toLowerCase().endsWith('.doc');
        const fileName = selected.split(/[/\\]/).pop() || 'template.docx';
        const finalName = isLegacyDoc ? fileName + 'x' : fileName;
        
        setIsProcessing(true);
        
        let content: Uint8Array;
        if (isLegacyDoc) {
          const docxContent = await invoke<number[]>('convert_doc_to_docx', { inputPath: selected });
          content = new Uint8Array(docxContent);
        } else {
          content = await readFile(selected);
        }

        const file = new File([content as any], finalName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

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
    const confirmed = await ask("Vuoi davvero rimuovere questo template dallo slot? L'operazione non è reversibile.", { title: 'Conferma Rimozione Template', kind: 'warning' });
    if (confirmed) {
      console.log('[App] Confirmed deletion of slot:', slotId);
      try {
        await deleteTemplate(slotId);
        await loadInitialData();
      } catch (err) {
        console.error('[App] Error during deletion:', err);
      }
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

    const confirmed = await ask("Tutti i settaggi (tecnici, percorsi, API) e i template verranno eliminati definitivamente. Procedere?", { title: 'RESET TOTALE', kind: 'warning' });
    if (!confirmed) return;

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

      // Extract fields and load specific layout
      const [fields, layout] = await Promise.all([
        extractFieldsFromDocx(file),
        getCustomLayout(slotId)
      ]);

      setCustomLayoutState(layout);

      // Task 4 & 22: Auto-fill N_DOC and DATA
      const nextNum = await getNextDocNumber(savePath);
      const todayDate = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });

      setFormFields(fields.map(f => {
        const labelUc = f.label.toUpperCase();
        if ((labelUc.includes('N_DOC') || labelUc.includes('N.DOC') || labelUc.includes('NUMERO DOCUMENTO')) && nextNum) {
          return { ...f, value: nextNum };
        }
        if (labelUc === 'DATA' || labelUc === 'DATA INTERVENTO') {
          return { ...f, value: todayDate };
        }
        return f;
      }));

      setCurrentView('form');
    } catch (err) {
      console.error("Error loading template for form", err);
      alert("Errore caricamento template.");
    } finally {
      setIsProcessing(false);
    }
  };

  const navigateView = async (targetView: View) => {
    if (currentView === 'form' && formFields.length > 0) {
      const ignoredKeywords = ['DATA', 'N_DOC', 'N.DOC', 'NUMERO DOCUMENTO', 'DATA INTERVENTO'];
      const isDirty = formFields.some(f => {
        const ucLabel = f.label.toUpperCase();
        const ucId = f.id.toUpperCase();
        const isIgnored = ignoredKeywords.some(kw => ucLabel === kw || ucId === kw);
        if (isIgnored) return false;
        const val = (f.value || '').trim();
        if (f.type === 'checkbox') return val === '1';
        return val.length > 0;
      });
      if (isDirty) {
        const confirmExit = await ask('Ci sono dati inseriti nel form. Vuoi uscire senza salvare?', { title: 'Dati non salvati', kind: 'warning' });
        if (!confirmExit) return;
      }
    }

    setCurrentView(targetView);
    if (targetView !== 'settings' && targetView !== 'form') {
      setTemplateFile(null);
      setFormFields([]);
      setCustomLayoutState({});
      setActiveSlotId(null);
    }
  };

  const handleGoHome = async () => {
    await navigateView('home');
  };

  useEffect(() => {
    import('./utils/syncManager').then(m => {
      if (googleSettings?.enabled && googleSettings?.refreshToken) {
        m.startAutoSync();
      } else {
        m.stopAutoSync();
      }
    });
    return () => {
      import('./utils/syncManager').then(m => m.stopAutoSync());
    };
  }, [googleSettings?.enabled, googleSettings?.refreshToken]);

  const handleGoogleAuth = async () => {
    if (!googleSettings?.clientId) return;
    try {
      const url = getGoogleAuthUrl(googleSettings.clientId);
await shellOpen(url);
    } catch (err) {
      console.error('[GoogleAuth] Failed to open auth URL:', err);
    }
  };

  const handleVerifyGoogleCode = async () => {
    if (!googleAuthCode || !googleSettings?.clientId || !googleSettings?.clientSecret) {
      return;
    }

    setIsProcessing(true);
    try {
      
      

      const tokens = await getTokensFromCode(googleAuthCode, googleSettings.clientId, googleSettings.clientSecret);

      const updatedSettings = {
        ...googleSettings,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiryDate: tokens.expiryDate,
        lastSync: new Date().toISOString()
      };

      setGoogleSettingsState(updatedSettings);
      await setGoogleSettings(updatedSettings);
      setGoogleAuthCode('');
      setIsGoogleSaved(true);
      setTimeout(() => setIsGoogleSaved(false), 3000);
    } catch (e: any) {
      await message(e.message || "Errore durante l'autorizzazione", { title: 'Errore Sync', kind: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualSync = async () => {
    if (!googleSettings?.enabled || !googleSettings?.refreshToken) return;
    setIsSyncing(true);
    try {
      const { performSync } = await import('./utils/syncManager');
      await performSync(googleSettings);
      // Reload events if on calendar view or updated via storage listener
    } catch (e) {
      console.error('Manual sync failed:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCheckForUpdates = async () => {
    setUpdateStatus('checking');
    try {
      const result = await checkForUpdates();
      if (result.available) {
        setUpdateStatus('available');
        setLatestVersion(result.latestVersion || '');
        setUpdateBody(result.body || null);
        setUpdateDate(result.date || null);
        sendAppNotification("Aggiornamento Disponibile", `La versione ${result.latestVersion} è pronta per il download.`);
      } else {
        setUpdateStatus('up-to-date');
        setTimeout(() => setUpdateStatus('idle'), 3000);
      }
    } catch (err) {
      console.error('[Update] Manual check error:', err);
      setUpdateStatus('error');
      setTimeout(() => setUpdateStatus('idle'), 3000);
    }
  };

  const handleInstallUpdate = async () => {
    try {
      await installUpdate();
    } catch (err) {
      console.error('[Update] Installation error:', err);
      setUpdateStatus('error');
    }
  };

  const handleAddToPandetta = (data: any) => {
    setPendingPandettaRows(prev => [...prev, data]);
  };

  // --- Navigation ---

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-900 transition-colors duration-300 relative">
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
              TekReport<span className="font-light text-neutral-800 dark:text-neutral-200">Pro</span>
            </h1>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigateView('home')}
className={getNavClasses('home')}
              title="Home"
            >
              <HomeIcon className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('templates')}
className={getNavClasses('templates')}
              title="Modelli Rapportino"
            >
              <FileText className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('ai-extraction')}
className={getNavClasses('ai-extraction')}
              title="Estrazione AI Automatica"
            >
              <Brain className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('sterlink-manager')}
className={getNavClasses('sterlink-manager')}
              title="Gestione Excel Sterlink"
            >
              <Database className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('pandetta-manager')}
className={getNavClasses('pandetta-manager')}
              title="Gestione Pandetta Assistenze"
            >
              <FileSpreadsheet className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('calendar')}
className={getNavClasses('calendar')}
              title="Calendario Lavori"
            >
              <Calendar className="w-6 h-6" />
            </button>
            <button
              onClick={() => navigateView('settings')}
className={getNavClasses('settings')}
              title="Impostazioni Template"
            >
              <Settings className="w-6 h-6" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 text-neutral-500 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              title={theme === 'light' ? 'Tema Scuro' : 'Tema Chiaro'}
            >
              {theme === 'light' ? <Moon className="w-6 h-6" /> : <Sun className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className={`flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 ${['pandetta-manager', 'sterlink-manager', 'calendar'].includes(currentView) ? 'h-[calc(100vh-4rem)] p-0 pt-8' : 'py-8'}`}>

        {/* --- VIEW: HOME (DASHBOARD) --- */}
        {currentView === 'home' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-extrabold text-neutral-900 dark:text-white mb-4">Dashboard Principale</h2>
              <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-2xl mx-auto">
                Benvenuto! Scegli a cosa vuoi lavorare oggi.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto px-4">
              {[
                { id: 'templates', title: 'Compilazione Rapportino', desc: 'Compila tramite i tuoi template (.docx).', icon: <FileText className="w-8 h-8 text-blue-600" />, iconBg: 'bg-blue-50 dark:bg-blue-900/20', hoverBorder: 'hover:border-blue-500 dark:hover:border-blue-500/50' },
                { id: 'sterlink-manager', title: 'Sterlink Manager', desc: 'Gestione del DB riparazioni.', icon: <Database className="w-8 h-8 text-emerald-600" />, iconBg: 'bg-emerald-50 dark:bg-emerald-900/20', hoverBorder: 'hover:border-emerald-500 dark:hover:border-emerald-500/50' },
                { id: 'pandetta-manager', title: 'Pandetta Manager', desc: 'Elenco assistenze e interventi.', icon: <FileSpreadsheet className="w-8 h-8 text-cyan-600" />, iconBg: 'bg-cyan-50 dark:bg-cyan-900/20', hoverBorder: 'hover:border-cyan-500 dark:hover:border-cyan-500/50' },
                { id: 'ai-extraction', title: 'Estrazione AI', desc: 'Converti PDF in form smart con IA.', icon: <Brain className="w-8 h-8 text-purple-600" />, iconBg: 'bg-purple-50 dark:bg-purple-900/20', hoverBorder: 'hover:border-purple-500 dark:hover:border-purple-500/50' },
                { id: 'calendar', title: 'Calendario Google', desc: 'Visualizza gli interventi programmati.', icon: <Calendar className="w-8 h-8 text-orange-600" />, iconBg: 'bg-orange-50 dark:bg-orange-900/20', hoverBorder: 'hover:border-orange-500 dark:hover:border-orange-500/50' },
                { id: 'settings', title: 'Impostazioni App', desc: 'Configura layout, cartelle e API.', icon: <Settings className="w-8 h-8 text-neutral-600 dark:text-neutral-300" />, iconBg: 'bg-neutral-100 dark:bg-neutral-800', hoverBorder: 'hover:border-neutral-500 dark:hover:border-neutral-500/50' },
              ].map(card => (
                <div
                  key={card.id}
                  onClick={() => navigateView(card.id as View)}
                  className={`bg-white dark:bg-neutral-800 p-8 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 hover:shadow-xl cursor-pointer group transition-all duration-300 flex flex-col items-center text-center ${card.hoverBorder}`}
                >
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${card.iconBg}`}>
                    {card.icon}
                  </div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">{card.title}</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --- VIEW: TEMPLATES (MODULAR) --- */}
        {(currentView === 'templates' || currentView === 'form' || currentView === 'download') && (
          <TemplateManagerPage
            templateMeta={templateMeta}
            templateFile={templateFile}
            formFields={formFields}
            customLayout={customLayout}
            activeSlotId={activeSlotId}
            technicians={technicians}
            sectionDefinitions={sectionDefinitions}
            isProcessing={isProcessing}
            currentView={currentView}
            onViewChange={setCurrentView}
            onSelectTemplate={handleSelectTemplate}
            onFormFieldsChange={setFormFields}
            onCustomLayoutChange={setCustomLayoutState}
            onGoHome={handleGoHome}
          />
        )}

        {/* --- VIEW: SETTINGS (MODULAR) --- */}
        {currentView === 'settings' && (
          <SettingsPage
            activeSettingsTab={activeSettingsTab}
            onTabChange={setActiveSettingsTab}
            templateMeta={templateMeta}
            technicians={technicians}
            newTechName={newTechName}
            onNewTechNameChange={setNewTechName}
            savePath={savePath}
            onSavePathChange={setSavePathState}
            sectionDefinitions={sectionDefinitions}
            onSectionDefinitionsChange={setSectionDefinitionsState}
            isSectionsSaved={isSectionsSaved}
            onIsSectionsSavedChange={setIsSectionsSaved}
            isProcessing={isProcessing}
            isAiSaved={isAiSaved}
            onIsAiSavedChange={setIsAiSaved}
            aiSettings={aiSettings}
            onAiSettingsChange={setAiSettingsState}
            googleSettings={googleSettings}
            onGoogleSettingsChange={setGoogleSettingsState}
            isGoogleSaved={isGoogleSaved}
            onIsGoogleSavedChange={setIsGoogleSaved}
            googleAuthCode={googleAuthCode}
            onGoogleAuthCodeChange={setGoogleAuthCode}
            isSyncing={isSyncing}
            pandettaFileName={pandettaFileName}
            pandettaFilePath={pandettaFilePath}
            sterlinkFileName={sterlinkFileName}
            sterlinkFilePath={sterlinkFilePath}
            updateSettings={updateSettings}
            onUpdateSettingsChange={setUpdateSettingsState}
            updateStatus={updateStatus}
            latestVersion={latestVersion}
            updateBody={updateBody}
            updateDate={updateDate}
            currentVersion={currentVersion}
            onGoHome={handleGoHome}
            onSlotUpload={handleSlotUpload}
            onDeleteSlot={handleDeleteSlot}
            onAddTechnician={handleAddTechnician}
            onRemoveTechnician={handleRemoveTechnician}
            onExportSettings={handleExportSettings}
            onImportSettings={handleImportSettings}
            onResetSettings={handleResetSettings}
            onGoogleAuth={handleGoogleAuth}
            onVerifyGoogleCode={handleVerifyGoogleCode}
            onManualSync={handleManualSync}
            onCheckForUpdates={handleCheckForUpdates}
            onInstallUpdate={handleInstallUpdate}
            onClearExcelFile={async (type: 'pandetta' | 'sterlink') => {
              await clearExcelFile(type);
              if (type === 'pandetta') {
                setPandettaFileName(null);
                setPandettaFilePath(null);
              } else {
                setSterlinkFileName(null);
                setSterlinkFilePath(null);
              }
            }}
            onSetSavePath={setSavePath}
            onSetAiSettings={setAiSettings}
            onSetGoogleSettings={setGoogleSettings}
            onSetUpdateSettings={setUpdateSettings}
          />
        )}

        {/* --- VIEW: AI EXTRACTION --- */}
        {currentView === 'ai-extraction' && (
          <AIExtraction 
            onBack={handleGoHome} 
            onAddToPandetta={handleAddToPandetta}
            hasPandettaFile={!!pandettaFilePath}
            theme={theme} 
          />
        )}

        {/* --- VIEW: STERLINK MANAGER --- */}
        {currentView === 'sterlink-manager' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <SterlinkManagerPage
              onFileSelected={(name: string, path: string | null) => {
                setSterlinkFileName(name);
                setSterlinkFilePath(path);
              }}
              onResetPersistent={async () => {
                await clearExcelFile('sterlink');
                setSterlinkFileName(null);
                setSterlinkFilePath(null);
              }}
            />
          </div>
        )}

        {/* --- VIEW: PANDETTA MANAGER --- */}
        {currentView === 'pandetta-manager' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full">
            <PandettaManager
              onFileSelected={(name: string, path: string | null) => {
                setPandettaFileName(name);
                setPandettaFilePath(path);
              }}
              onResetPersistent={async () => {
                await clearExcelFile('pandetta');
                setPandettaFileName(null);
                setPandettaFilePath(null);
              }}
              onExternalAddRow={pendingPandettaRows}
              onExternalRowsProcessed={() => setPendingPandettaRows([])}
            />
          </div>
        )}

        {/* --- VIEW: CALENDAR --- */}
        {currentView === 'calendar' && (
          <CalendarPage />
        )}
      </main>

    </div>
  );
}

export default App;
