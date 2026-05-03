import { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { open, ask } from '@tauri-apps/plugin-dialog';
import { sendAppNotification } from './utils/notifications';
import { DEFAULT_SYSTEM_PROMPT } from './utils/ollama';
import { setSectionDefinitions, type SectionDefinition, type TemplateIndex, type AiSettings, type GoogleCalendarSettings, type UpdateSettings } from './utils/storage';

interface SettingsPageProps {
  activeSettingsTab: 'system' | 'database' | 'templates' | 'integrations';
  onTabChange: (tab: 'system' | 'database' | 'templates' | 'integrations') => void;
  templateMeta: (TemplateIndex | undefined)[];
  technicians: string[];
  newTechName: string;
  onNewTechNameChange: (name: string) => void;
  savePath: string;
  onSavePathChange: (path: string) => void;
  sectionDefinitions: SectionDefinition[];
  onSectionDefinitionsChange: (sections: SectionDefinition[]) => void;
  isSectionsSaved: boolean;
  onIsSectionsSavedChange: (saved: boolean) => void;
  isProcessing: boolean;
  isAiSaved: boolean;
  onIsAiSavedChange: (saved: boolean) => void;
  aiSettings: AiSettings;
  onAiSettingsChange: (settings: AiSettings) => void;
  googleSettings: GoogleCalendarSettings | null;
  onGoogleSettingsChange: (settings: GoogleCalendarSettings | null) => void;
  isGoogleSaved: boolean;
  onIsGoogleSavedChange: (saved: boolean) => void;
  googleAuthCode: string;
  onGoogleAuthCodeChange: (code: string) => void;
  isSyncing: boolean;
  pandettaFileName: string | null;
  pandettaFilePath: string | null;
  sterlinkFileName: string | null;
  sterlinkFilePath: string | null;
  updateSettings: UpdateSettings;
  onUpdateSettingsChange: (settings: UpdateSettings) => void;
  updateStatus: 'idle' | 'checking' | 'available' | 'downloaded' | 'error' | 'up-to-date';
  latestVersion: string;
  updateBody: string | null;
  updateDate: string | null;
  currentVersion: string;
  onGoHome: () => void;
  onSlotUpload: (slotId: string) => Promise<void>;
  onDeleteSlot: (slotId: string) => Promise<void>;
  onAddTechnician: () => Promise<void>;
  onRemoveTechnician: (index: number) => Promise<void>;
  onExportSettings: () => Promise<void>;
  onImportSettings: () => Promise<void>;
  onResetSettings: () => Promise<void>;
  onGoogleAuth: () => Promise<void>;
  onVerifyGoogleCode: () => Promise<void>;
  onManualSync: () => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onClearExcelFile: (type: 'pandetta' | 'sterlink') => Promise<void>;
  onSetSavePath: (path: string) => Promise<void>;
  onSetAiSettings: (settings: import('./utils/storage').AiSettings) => Promise<void>;
  onSetGoogleSettings: (settings: import('./utils/storage').GoogleCalendarSettings) => Promise<void>;
  onSetUpdateSettings: (settings: import('./utils/storage').UpdateSettings) => Promise<void>;
}

const POPULAR_ICONS = [
  'User', 'Users', 'Wrench', 'Tool', 'FileText', 'File', 'FileSignature', 'Folder', 'FolderOpen',
  'PenTool', 'Settings', 'Cpu', 'Monitor', 'Smartphone', 'Zap', 'Activity', 'AlertCircle',
  'CheckCircle', 'CheckSquare', 'Calendar', 'Clock', 'Compass', 'Crosshair',
  'Database', 'HardDrive', 'Server', 'MapPin', 'Map', 'Truck', 'Box', 'Package', 'Shield',
  'Camera', 'Video', 'Mic', 'List', 'Menu', 'Grid', 'Layout',
  'Home', 'Building', 'Briefcase', 'Coffee', 'Heart', 'Star', 'ThumbsUp',
  'TrendingUp', 'BarChart', 'PieChart'
];

export default function SettingsPage({
  activeSettingsTab,
  onTabChange,
  templateMeta,
  technicians,
  newTechName,
  onNewTechNameChange,
  savePath,
  onSavePathChange,
  sectionDefinitions,
  onSectionDefinitionsChange,
  isSectionsSaved,
  onIsSectionsSavedChange,
  isProcessing,
  isAiSaved,
  onIsAiSavedChange,
  aiSettings,
  onAiSettingsChange,
  googleSettings,
  onGoogleSettingsChange,
  isGoogleSaved,
  onIsGoogleSavedChange,
  googleAuthCode,
  onGoogleAuthCodeChange,
  isSyncing,
  pandettaFileName,
  pandettaFilePath,
  sterlinkFileName,
  sterlinkFilePath,
  updateSettings,
  onUpdateSettingsChange,
  updateStatus,
  latestVersion,
  updateBody,
  updateDate,
  currentVersion,
  onGoHome,
  onSlotUpload,
  onDeleteSlot,
  onAddTechnician,
  onRemoveTechnician,
  onExportSettings,
  onImportSettings,
  onResetSettings,
  onGoogleAuth,
  onVerifyGoogleCode,
  onManualSync,
  onCheckForUpdates,
  onInstallUpdate,
  onClearExcelFile,
  onSetSavePath,
  onSetAiSettings,
  onSetGoogleSettings,
  onSetUpdateSettings,
}: SettingsPageProps) {
  const [isIconPickerOpen, setIsIconPickerOpen] = useState<number | null>(null);

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onGoHome}
          className="p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
        >
          <LucideIcons.ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-3xl font-extrabold text-neutral-900 dark:text-white">Gestione Template</h2>
          <p className="text-neutral-600 dark:text-neutral-400">Assegna un file .docx a ciascuno slot per renderlo disponibile nella Home.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-8 border-b border-neutral-200 dark:border-neutral-700 pb-4">
        {[
          { id: 'system', label: 'Sistema & Dati', icon: <LucideIcons.Server className="w-4 h-4" /> },
          { id: 'database', label: 'Gestione Database', icon: <LucideIcons.Database className="w-4 h-4" /> },
          { id: 'templates', label: 'Template & Layout', icon: <LucideIcons.Layout className="w-4 h-4" /> },
          { id: 'integrations', label: 'Integrazioni & AI', icon: <LucideIcons.Brain className="w-4 h-4" /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id as any)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-all
               ${activeSettingsTab === tab.id
                ? 'bg-primary-600 text-white shadow-md'
                : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-700'}
              `}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-8">
        {activeSettingsTab === 'templates' && (
          <>
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
                            <LucideIcons.CheckCircle className="w-4 h-4 shrink-0" />
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
                          onClick={() => onDeleteSlot(id)}
                          className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400"
                        >
                          Rimuovi
                        </button>
                      )}
                      <div className="relative group overflow-hidden w-full sm:w-auto">
                        <button
                          onClick={() => onSlotUpload(id)}
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

            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <LucideIcons.Layout className="w-6 h-6 text-primary-600" />
                  Personalizzazione Sezioni Rapportino
                </h3>
                <button
                  onClick={async () => {
                    onIsSectionsSavedChange(true);
                    await setSectionDefinitions(sectionDefinitions);
                    setTimeout(() => onIsSectionsSavedChange(false), 3000);
                  }}
                  className={`px-4 py-2 font-bold rounded-lg transition-all duration-300 flex items-center gap-2 text-sm shadow-sm 
              ${isSectionsSaved
                      ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                      : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20'}`}
                >
                  {isSectionsSaved ? (
                    <>
                      <LucideIcons.CheckCircle className="w-4 h-4" />
                      Sezioni Salvate!
                    </>
                  ) : (
                    <>
                      <LucideIcons.Download className="w-4 h-4 shadow-sm" />
                      Salva Sezioni
                    </>
                  )}
                </button>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Personalizza le sezioni appariranno nei template relativi ai Rapportini. Puoi cambiare i nomi e le icone.</p>

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
                                  onSectionDefinitionsChange(next);
                                }}
                                className="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                              />
                            </div>
                            <div className="w-32 relative">
                              <label className="block text-[10px] uppercase font-black text-neutral-400 mb-1">Icona</label>
                              <button
                                onClick={() => setIsIconPickerOpen(isIconPickerOpen === idx ? null : idx)}
                                className="w-full flex justify-between items-center bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-1.5 text-sm dark:text-white hover:border-primary-500 transition-colors"
                              >
                                <span className="truncate flex items-center gap-2 font-medium">
                                  <Icon className="w-4 h-4" />
                                  {sec.icon}
                                </span>
                                <LucideIcons.ChevronDown className="w-4 h-4 text-neutral-400" />
                              </button>
                              {isIconPickerOpen === idx && (
                                <div className="absolute top-full mt-1 right-0 w-64 p-3 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-xl z-50 grid grid-cols-5 gap-2 max-h-48 overflow-y-auto">
                                  {POPULAR_ICONS.map(i => {
                                    const PreviewIcon = (LucideIcons as any)[i];
                                    if (!PreviewIcon) return null;
                                    return (
                                      <button
                                        key={i}
                                        title={i}
                                        onClick={() => {
                                          const next = [...sectionDefinitions];
                                          next[idx].icon = i;
                                          onSectionDefinitionsChange(next);
                                          setIsIconPickerOpen(null);
                                        }}
                                        className={`p-2 rounded-lg flex justify-center items-center hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors ${sec.icon === i ? 'bg-primary-100 dark:bg-primary-900/50 text-primary-600' : 'text-neutral-600 dark:text-neutral-300'}`}
                                      >
                                        <PreviewIcon className="w-5 h-5" />
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          onClick={() => {
                            if (idx === 0) return;
                            const next = [...sectionDefinitions];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            onSectionDefinitionsChange(next);
                          }}
                          className="p-2 text-neutral-400 hover:text-primary-600"
                        >
                          <LucideIcons.ChevronUp className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            if (idx === sectionDefinitions.length - 1) return;
                            const next = [...sectionDefinitions];
                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                            onSectionDefinitionsChange(next);
                          }}
                          className="p-2 text-neutral-400 hover:text-primary-600"
                        >
                          <LucideIcons.ChevronDown className="w-5 h-5" />
                        </button>
                        <button
                          onClick={async () => {
                            const confirmed = await ask(`Vuoi eliminare la sezione "${sec.title}"? Questo influisce solo sulla visualizzazione dei campi.`, { title: 'Elimina Sezione', kind: 'warning' });
                            if (confirmed) {
                              onSectionDefinitionsChange(sectionDefinitions.filter((_, i) => i !== idx));
                            }
                          }}
                          className="p-2 text-neutral-400 hover:text-red-500"
                        >
                          <LucideIcons.Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => {
                  const newId = `custom_${Date.now()}`;
                  onSectionDefinitionsChange([...sectionDefinitions, { id: newId, title: 'Nuova Sezione', icon: 'Type' }]);
                }}
                className="mt-6 w-full py-3 border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500 hover:border-primary-500 hover:text-primary-500 transition-all font-bold flex items-center justify-center gap-2"
              >
                <LucideIcons.Plus className="w-5 h-5" />
                Aggiungi Nuova Sezione
              </button>
            </div>
          </>
        )}

        {activeSettingsTab === 'system' && (
          <>
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <LucideIcons.User className="w-6 h-6 text-primary-600" />
                Gestione Tecnici
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Aggiungi i nomi dei tecnici per poterli selezionare velocemente nei form.</p>

              <div className="flex gap-3 mb-6">
                <input
                  type="text"
                  value={newTechName}
                  onChange={(e) => onNewTechNameChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onAddTechnician()}
                  placeholder="Nome Tecnico (es. Mario Rossi)"
                  className="flex-1 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg focus:ring-2 focus:ring-primary-500 outline-none bg-transparent dark:text-white"
                />
                <button
                  onClick={onAddTechnician}
                  className="px-4 py-2 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
                >
                  <LucideIcons.Plus className="w-5 h-5" />
                  Aggiungi
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {technicians.map((name, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-neutral-50 dark:bg-neutral-700/50 rounded-lg border border-neutral-100 dark:border-neutral-700 group">
                    <span className="font-medium text-neutral-700 dark:text-neutral-200">{name}</span>
                    <button
                      onClick={() => onRemoveTechnician(index)}
                      className="p-1.5 text-neutral-400 hover:text-red-500 transition-colors"
                    >
                      <LucideIcons.Trash2 className="w-4 h-4" />
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

            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <LucideIcons.Download className="w-6 h-6 text-primary-600" />
                Percorso di Salvataggio Predefinito
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Seleziona la cartella in cui verranno salvati i documenti generati.</p>

              <div className="flex gap-3 items-center">
                <div className="relative flex-1">
                  <input
                    type="text"
                    readOnly
                    value={savePath || 'Nessuna cartella selezionata...'}
                    className="w-full px-4 py-2 pr-8 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 truncate"
                  />
                  {savePath && savePath.trim() !== '' && (
                    <button
                      onClick={async () => {
                        onSavePathChange('');
                        await onSetSavePath('');
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-600 dark:text-neutral-500 rounded transition-colors"
                      title="Rimuovi percorso"
                    >
                      <LucideIcons.X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <button
                  onClick={async () => {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                    });
                    if (selected && typeof selected === 'string') {
                      onSavePathChange(selected);
                      await onSetSavePath(selected);
                    }
                  }}
                  className="px-4 py-2 bg-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 text-white font-bold rounded-lg hover:bg-neutral-800 dark:hover:bg-white transition-colors shrink-0"
                >
                  Sfoglia Cartella
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <LucideIcons.RefreshCw className="w-6 h-6 text-primary-600" />
                  Aggiornamenti Applicazione
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={onCheckForUpdates}
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
                        <LucideIcons.RefreshCw className="w-4 h-4" />
                        Controlla Aggiornamenti
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Verifica la disponibilità di nuove versioni dell'applicazione e installa gli aggiornamenti automaticamente.</p>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <LucideIcons.Package className="w-5 h-5 text-primary-600" />
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

                {updateStatus === 'available' && (
                  <div className="p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-8 h-8 bg-primary-100 dark:bg-primary-900/50 rounded-full flex items-center justify-center shrink-0">
                        <LucideIcons.Download className="w-4 h-4 text-primary-600" />
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
                      onClick={onInstallUpdate}
                      disabled={isProcessing}
                      className="w-full px-4 py-3 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-2"
                    >
                      <LucideIcons.Download className="w-4 h-4" />
                      Scarica e Installa Aggiornamento
                    </button>
                  </div>
                )}

                {updateStatus === 'downloaded' && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-100 dark:bg-green-900/50 rounded-full flex items-center justify-center shrink-0">
                        <LucideIcons.CheckCircle className="w-4 h-4 text-green-600" />
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

                {updateStatus === 'up-to-date' && (
                  <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-neutral-100 dark:bg-neutral-800 rounded-full flex items-center justify-center shrink-0">
                        <LucideIcons.CheckCircle className="w-4 h-4 text-neutral-600 dark:text-neutral-400" />
                      </div>
                      <div className="flex-1">
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Applicazione Aggiornata</h4>
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">Non sono disponibili nuovi aggiornamenti. L'ultima versione installata è la più recente.</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                        <LucideIcons.RefreshCw className={`w-5 h-5 ${updateSettings.enabled ? 'text-primary-600' : 'text-neutral-400'}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Controllo Automatico</h4>
                        <p className="text-xs text-neutral-500">Verifica aggiornamenti all'avvio</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !updateSettings.enabled;
                        onUpdateSettingsChange({ ...updateSettings, enabled: newValue });
                        await onSetUpdateSettings({ ...updateSettings, enabled: newValue });
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
                        <LucideIcons.Download className={`w-5 h-5 ${updateSettings.autoInstall ? 'text-primary-600' : 'text-neutral-400'}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Installazione Automatica</h4>
                        <p className="text-xs text-neutral-500">Installa automaticamente</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        const newValue = !updateSettings.autoInstall;
                        onUpdateSettingsChange({ ...updateSettings, autoInstall: newValue });
                        await onSetUpdateSettings({ ...updateSettings, autoInstall: newValue });
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

            <div className="mt-8 bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white mb-4 flex items-center gap-2">
                <LucideIcons.Save className="w-6 h-6 text-primary-600" />
                Backup & Ripristino
              </h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Salva o ripristina tutte le impostazioni dell'applicazione (tecnici, percorsi, configurazioni IA e template).</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <button
                  onClick={onExportSettings}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-3 p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-xl text-primary-700 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors font-bold disabled:opacity-50"
                >
                  <LucideIcons.Download className="w-5 h-5" />
                  Esporta Tutto (JSON)
                </button>
                <button
                  onClick={onImportSettings}
                  disabled={isProcessing}
                  className="flex items-center justify-center gap-3 p-4 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors font-bold shadow-sm disabled:opacity-50"
                >
                  <LucideIcons.Upload className="w-5 h-5" />
                  Importa Backup
                </button>
              </div>

              <div className="pt-6 border-t border-neutral-100 dark:border-neutral-700">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-bold text-red-600 flex items-center gap-2">
                      <LucideIcons.RotateCcw className="w-4 h-4" />
                      Reset alle impostazioni di fabbrica
                    </h4>
                    <p className="text-xs text-neutral-500">Elimina tutti i settaggi e i template caricati.</p>
                  </div>
                  <button
                    onClick={onResetSettings}
                    disabled={isProcessing}
                    className="px-6 py-2 text-sm font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 rounded-lg transition-all disabled:opacity-50"
                  >
                    Esegui Reset
                  </button>
                </div>
              </div>
            </div>

            {isProcessing && <div className="mt-4 text-center text-primary-600 font-semibold animate-pulse">Salvataggio in corso...</div>}
          </>
        )}

        {activeSettingsTab === 'database' && (
          <div className="space-y-8">
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center justify-center">
                  <LucideIcons.Database className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Pandetta Manager</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Configurazione database e file sorgente per Pandetta.</p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                        <LucideIcons.FileSpreadsheet className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Dataset Persistente (Excel)</h4>
                        <p className="text-xs text-neutral-500">{pandettaFileName || 'Nessun file caricato (utilizza la pagina Pandetta Manager)'}</p>
                      </div>
                    </div>
                    {(pandettaFileName || pandettaFilePath) && (
                      <button
                        onClick={async () => {
                          const confirmed = await ask("Vuoi davvero rimuovere il file Excel persistente per Pandetta Manager?", { title: 'Rimuovi Cache Pandetta', kind: 'warning' });
                          if (confirmed) {
                            await onClearExcelFile('pandetta');
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                      >
                        Dimentica File
                      </button>
                    )}
                  </div>
                  {pandettaFilePath && (
                    <p className="mt-2 text-[10px] text-neutral-400 bg-neutral-100 dark:bg-neutral-800/50 p-2 rounded-lg break-all font-mono">
                      {pandettaFilePath}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center">
                  <LucideIcons.Layout className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-neutral-900 dark:text-white">Sterlink Manager</h3>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">Configurazione file sorgente per Sterlink.</p>
                </div>
              </div>

              <div className="p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <LucideIcons.FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Dataset Persistente (Excel)</h4>
                      <p className="text-xs text-neutral-500">{sterlinkFileName || 'Nessun file caricato (utilizza la pagina Sterlink Manager)'}</p>
                    </div>
                  </div>
                  {(sterlinkFileName || sterlinkFilePath) && (
                    <button
                      onClick={async () => {
                        const confirmed = await ask("Vuoi davvero rimuovere il file Excel persistente per Sterlink Manager?", { title: 'Rimuovi Cache Sterlink', kind: 'warning' });
                        if (confirmed) {
                          await onClearExcelFile('sterlink');
                        }
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded-lg transition-colors border border-red-200 dark:border-red-800"
                    >
                      Dimentica File
                    </button>
                  )}
                </div>
                {sterlinkFilePath && (
                  <p className="mt-2 text-[10px] text-neutral-400 bg-neutral-100 dark:bg-neutral-800/50 p-2 rounded-lg break-all font-mono">
                    {sterlinkFilePath}
                  </p>
                )}
              </div>
            </div>

            <div className="p-6 bg-neutral-100 dark:bg-neutral-900/50 rounded-2xl border border-neutral-200 dark:border-neutral-700">
              <div className="flex items-start gap-4">
                <LucideIcons.Server className="w-6 h-6 text-neutral-400 mt-1" />
                <div>
                  <h4 className="text-sm font-bold text-neutral-700 dark:text-neutral-300">Posizione Dati Locali</h4>
                  <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                    I dataset sono memorizzati in locale nella cartella dei dati dell'applicazione per garantirti un accesso rapido ed offline.
                    I file originali non vengono modificati.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSettingsTab === 'integrations' && (
          <>
            <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                  <LucideIcons.Brain className="w-6 h-6 text-primary-600" />
                  Impostazioni Intelligenza Artificiale
                </h3>
                <button
                  onClick={async () => {
                    onIsAiSavedChange(true);
                    await onSetAiSettings(aiSettings);
                    setTimeout(() => onIsAiSavedChange(false), 3000);
                  }}
                  className={`px-4 py-2 font-bold rounded-lg transition-all duration-300 flex items-center gap-2 text-sm shadow-sm 
              ${isAiSaved
                      ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                      : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20'}`}
                >
                  {isAiSaved ? (
                    <>
                      <LucideIcons.CheckCircle className="w-4 h-4" />
                      Impostazioni Salvate!
                    </>
                  ) : (
                    <>
                      <LucideIcons.Download className="w-4 h-4 shadow-sm" />
                      Salva Impostazioni AI
                    </>
                  )}
                </button>
              </div>
              <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-6">Configura i parametri per la connessione a Ollama.</p>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white dark:bg-neutral-800 rounded-lg border border-neutral-100 dark:border-neutral-700 flex items-center justify-center shadow-sm">
                      <LucideIcons.Bell className={`w-5 h-5 ${aiSettings.notificationsEnabled ? 'text-primary-600' : 'text-neutral-400'}`} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-white">Notifiche Completamento</h4>
                      <div className="flex items-center gap-2">
                        <p className="text-xs text-neutral-500">Invia una notifica quando l'analisi IA è terminata.</p>
                        {aiSettings.notificationsEnabled && (
                          <button
                            onClick={() => sendAppNotification("Test Notifica", "Se vedi questo, le notifiche funzionano!")}
                            className="text-[10px] bg-neutral-200 dark:bg-neutral-700 px-2 py-0.5 rounded hover:bg-neutral-300 transition-colors"
                          >
                            Invia Test
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => onAiSettingsChange({ ...aiSettings, notificationsEnabled: !aiSettings.notificationsEnabled })}
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
                      onChange={(e) => onAiSettingsChange({ ...aiSettings, ollamaUrl: e.target.value })}
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Modello (Model Name)</label>
                    <input
                      type="text"
                      value={aiSettings.ollamaModel}
                      onChange={(e) => onAiSettingsChange({ ...aiSettings, ollamaModel: e.target.value })}
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest mb-2">Temperatura ({aiSettings.temperature})</label>
                    <input
                      type="range" min="0" max="1" step="0.1"
                      value={aiSettings.temperature}
                      onChange={(e) => onAiSettingsChange({ ...aiSettings, temperature: parseFloat(e.target.value) })}
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
                      min="0"
                      max="4096"
                      value={aiSettings.numPredict}
                      onChange={(e) => onAiSettingsChange({ ...aiSettings, numPredict: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300"
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-neutral-500 uppercase tracking-widest">Istruzioni di Sistema (Custom Prompt Override)</label>
                    <button
                      onClick={() => onAiSettingsChange({ ...aiSettings, systemPrompt: '' })}
                      className="text-[10px] font-bold text-primary-600 hover:text-primary-700 underline"
                    >
                      Ripristina Default
                    </button>
                  </div>
                  <textarea
                    value={aiSettings.systemPrompt || ''}
                    onChange={(e) => onAiSettingsChange({ ...aiSettings, systemPrompt: e.target.value })}
                    placeholder="Il testo inserito qui sovrascriverà il prompt di default..."
                    className="w-full h-48 px-4 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg outline-none bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-300 resize-none font-mono text-xs"
                  />

                  {!aiSettings.systemPrompt && (
                    <div className="mt-4 p-4 bg-neutral-50 dark:bg-neutral-900/50 rounded-xl border border-neutral-100 dark:border-neutral-700">
                      <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <LucideIcons.Brain className="w-3 h-3" />
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

            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-sm border border-neutral-200 dark:border-neutral-700 p-6 sm:p-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center border border-emerald-100 dark:border-emerald-800 shadow-sm">
                      <LucideIcons.Cloud className="w-7 h-7 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-neutral-900 dark:text-white">Sincronizzazione Google</h3>
                      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">Configura le chiavi API per mantenere sincronizzati i tuoi lavori.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {googleSettings?.refreshToken && (
                      <button
                        onClick={onManualSync}
                        disabled={isSyncing}
                        className={`px-4 py-3 font-bold rounded-xl transition-all duration-300 flex items-center gap-2 text-sm border-2
                        ${isSyncing ? 'bg-neutral-50 text-neutral-400 border-neutral-100' : 'bg-white text-neutral-600 border-neutral-100 hover:border-emerald-500 hover:text-emerald-600'}`}
                      >
                        <LucideIcons.RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                        Forza Sincronizzazione
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        if (googleSettings) {
                          onIsGoogleSavedChange(true);
                          await onSetGoogleSettings(googleSettings);
                          setTimeout(() => onIsGoogleSavedChange(false), 3000);
                        }
                      }}
                      className={`px-6 py-3 font-black rounded-xl transition-all duration-300 flex items-center gap-2 text-sm shadow-lg
                    ${isGoogleSaved
                          ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                          : 'bg-primary-600 text-white hover:bg-primary-700 shadow-primary-500/20 active:scale-95'}`}
                    >
                      {isGoogleSaved ? (
                        <>
                          <LucideIcons.CheckCircle className="w-4 h-4" />
                          Salvato!
                        </>
                      ) : (
                        <>
                          <LucideIcons.Save className="w-4 h-4" />
                          Salva Impostazioni
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="flex items-center justify-between p-6 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-3xl">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-sm ${googleSettings?.enabled && googleSettings?.refreshToken ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600' : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400'}`}>
                        <LucideIcons.RefreshCw className={`w-6 h-6 ${googleSettings?.enabled && googleSettings?.refreshToken ? 'animate-spin-slow' : ''}`} />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-neutral-900 dark:text-white">Sincronizzazione Automatica</h4>
                        <p className={`text-xs font-bold ${googleSettings?.refreshToken ? 'text-emerald-600' : 'text-neutral-500'}`}>
                          {googleSettings?.refreshToken ? 'App autorizzata e pronta.' : 'Richiede autorizzazione.'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (googleSettings) {
                          onGoogleSettingsChange({ ...googleSettings, enabled: !googleSettings.enabled });
                        }
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all focus:outline-none shadow-inner
                    ${googleSettings?.enabled ? 'bg-emerald-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all shadow-md
                      ${googleSettings?.enabled ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-6 bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-700 rounded-3xl">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all shadow-sm ${googleSettings?.notificationsEnabled ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600' : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-400'}`}>
                        <LucideIcons.Bell className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-neutral-900 dark:text-white">Notifiche Nuovi Eventi</h4>
                        <p className={`text-xs font-bold ${googleSettings?.refreshToken ? 'text-blue-600' : 'text-neutral-500'}`}>
                          {googleSettings?.notificationsEnabled ? 'Notifiche attive' : 'Disattivate'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (googleSettings) {
                          onGoogleSettingsChange({ ...googleSettings, notificationsEnabled: !googleSettings.notificationsEnabled });
                        }
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all focus:outline-none shadow-inner
                    ${googleSettings?.notificationsEnabled ? 'bg-blue-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-all shadow-md
                      ${googleSettings?.notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}`}
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Google Client ID</label>
                      <input
                        type="password"
                        value={googleSettings?.clientId || ''}
                        onChange={(e) => onGoogleSettingsChange(googleSettings ? { ...googleSettings, clientId: e.target.value } : null)}
                        placeholder="Inserisci il tuo Client ID"
                        className="w-full px-5 py-3.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 dark:focus:border-primary-500 text-neutral-800 dark:text-white font-mono text-xs shadow-inner transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest ml-1">Google Client Secret</label>
                      <input
                        type="password"
                        value={googleSettings?.clientSecret || ''}
                        onChange={(e) => onGoogleSettingsChange(googleSettings ? { ...googleSettings, clientSecret: e.target.value } : null)}
                        placeholder="Inserisci il tuo Client Secret"
                        className="w-full px-5 py-3.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl outline-none focus:border-primary-500 dark:focus:border-primary-500 text-neutral-800 dark:text-white font-mono text-xs shadow-inner transition-all"
                      />
                    </div>
                  </div>

                  {!googleSettings?.refreshToken ? (
                    <div className="p-8 bg-primary-50/30 dark:bg-primary-900/10 rounded-3xl border border-primary-100 dark:border-primary-800/50">
                      <div className="flex flex-col md:flex-row items-center gap-8">
                        <div className="flex-1 space-y-4">
                          <h4 className="text-lg font-black text-neutral-900 dark:text-white flex items-center gap-2">
                            <LucideIcons.Lock className="w-5 h-5 text-primary-600" />
                            Autorizzazione Necessaria
                          </h4>
                          <p className="text-sm text-neutral-500 dark:text-neutral-400 leading-relaxed font-medium">
                            Per collegare il tuo account, dopo aver salvato il Client ID e Secret:
                            <br />
                            1. Clicca su <strong>"Autorizza App"</strong>
                            <br />
                            2. Accetta le autorizzazioni nel browser
                            <br />
                            3. Copia il codice fornito e incollalo qui sotto
                            <br />
                            <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 rounded-lg text-[10px] text-red-600 dark:text-red-400 font-bold">
                              Nota: Al primo accesso Google mostrerà "App non verificata". Clicca su "Avanzate" -&gt; "Vai a [App] (non sicura)" per procedere. Assicurati di aver aggiunto la tua mail ai "Test Users" nella Google Cloud Console.
                            </div>
                          </p>
                          <button
                            onClick={onGoogleAuth}
                            disabled={!googleSettings?.clientId || !googleSettings?.clientSecret}
                            className="px-6 py-3 bg-white dark:bg-neutral-800 border-2 border-primary-200 text-primary-600 font-black rounded-xl hover:bg-primary-50 transition-all disabled:opacity-30 flex items-center gap-2 shadow-sm"
                          >
                            <LucideIcons.ExternalLink className="w-4 h-4" />
                            Autorizza App
                          </button>
                        </div>
                        <div className="w-full md:w-1/2 space-y-3">
                          <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Incolla qui il codice di autorizzazione</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={googleAuthCode}
                              onChange={(e) => onGoogleAuthCodeChange(e.target.value)}
                              placeholder="Codice Google..."
                              className="flex-1 px-5 py-3.5 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl outline-none focus:border-emerald-500 text-xs font-mono"
                            />
                            <button
                              onClick={onVerifyGoogleCode}
                              disabled={!googleAuthCode || isProcessing}
                              className="px-5 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-700 transition-colors disabled:opacity-50"
                            >
                              Verifica
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 bg-emerald-50/50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-800/50 rounded-3xl flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/40 rounded-2xl flex items-center justify-center text-emerald-600">
                          <LucideIcons.CheckCircle className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black text-neutral-900 dark:text-white">Account Collegato Correttamente</h4>
                          <p className="text-xs font-bold text-emerald-600/80">Ultima sincronizzazione: {googleSettings.lastSync ? new Date(googleSettings.lastSync).toLocaleString('it-IT') : 'Nessuna'}</p>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          const confirmed = await ask("Vuoi davvero scollegare l'account Google? I dati locali rimarranno intatti ma la sincronizzazione si fermerà.", { title: 'Scollega Account', kind: 'warning' });
                          if (confirmed) {
                            const reset = { ...googleSettings, refreshToken: '', accessToken: '', expiryDate: 0, enabled: false };
                            onGoogleSettingsChange(reset);
                            await onSetGoogleSettings(reset);
                          }
                        }}
                        className="text-xs font-black text-red-500 hover:text-red-600 transition-colors bg-white dark:bg-neutral-800 px-4 py-2 rounded-xl border border-red-100 dark:border-red-900/30"
                      >
                        Scollega Account
                      </button>
                    </div>
                  )}

                  <div className="flex items-start gap-3 p-4 bg-yellow-50/50 dark:bg-yellow-900/10 border border-yellow-100 dark:border-yellow-800/30 rounded-2xl">
                    <LucideIcons.AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                    <p className="text-[10px] font-bold text-yellow-800/80 dark:text-yellow-500/80 leading-relaxed">
                      Nota: Assicurati che l'app sia in modalità "Produzione" nella Console Google per evitare che i token scadano dopo 7 giorni.
                      In alternativa, aggiungi il tuo indirizzo email come "Test User".
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}