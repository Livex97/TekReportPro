import { load, Store } from '@tauri-apps/plugin-store';
import { writeFile, readFile, remove, BaseDirectory, mkdir } from '@tauri-apps/plugin-fs';

let _store: Store | null = null;

async function getStore() {
    if (!_store) {
        _store = await load('app_settings.json', { autoSave: true, defaults: {} });
    }
    return _store;
}

export interface TemplateIndex {
    id: string;
    name: string;
}

/**
 * Saves a template File to Local Disk (AppData) and metadata to Store
 */
export async function saveTemplateFile(id: string, file: File) {
    // 1. Ensure the templates directory exists in AppData
    await mkdir('templates', { baseDir: BaseDirectory.AppData, recursive: true });
    
    // 2. Save the file to disk
    const fileName = `template_${id}.docx`;
    const buffer = await file.arrayBuffer();
    await writeFile(`templates/${fileName}`, new Uint8Array(buffer), { baseDir: BaseDirectory.AppData });
    
    // 3. Save metadata to store
    const store = await getStore();
    await store.set(`template_meta_${id}`, { id, name: file.name });
    await store.save();
}

/**
 * Retrieves a template File from Local Disk
 */
export async function getTemplateFile(id: string): Promise<File | undefined> {
    try {
        const store = await getStore();
        const meta = await store.get<TemplateIndex>(`template_meta_${id}`);
        if (!meta) return undefined;

        const content = await readFile(`templates/template_${id}.docx`, { baseDir: BaseDirectory.AppData });
        return new File([content], meta.name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    } catch (e) {
        console.error("[Storage] Error reading template file from disk", e);
        return undefined;
    }
}

/**
 * Retrieves template metadata from Store
 */
export async function getTemplateMeta(id: string): Promise<TemplateIndex | undefined> {
    const store = await getStore();
    return await store.get<TemplateIndex>(`template_meta_${id}`) || undefined;
}

/**
 * Deletes a template from Disk and Store
 */
export async function deleteTemplate(id: string) {
    console.log('[Storage] Deleting template and meta for ID:', id);
    try {
        await remove(`templates/template_${id}.docx`, { baseDir: BaseDirectory.AppData });
    } catch (e) {
        console.warn('[Storage] Could not delete file (might not exist):', e);
    }
    
    const store = await getStore();
    await store.delete(`template_meta_${id}`);
    await store.save();
    console.log('[Storage] Internal deletion complete');
}

/**
 * Gets metadata for all slots (1, 2, 3)
 */
export async function getAllTemplatesMeta(): Promise<(TemplateIndex | undefined)[]> {
    const meta1 = await getTemplateMeta('1');
    const meta2 = await getTemplateMeta('2');
    const meta3 = await getTemplateMeta('3');
    return [meta1, meta2, meta3];
}

/**
 * Generic setting getter
 */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const store = await getStore();
    const val = await store.get<T>(key);
    return val !== null && val !== undefined ? val : defaultValue;
}

/**
 * Generic setting setter
 */
export async function setSetting<T>(key: string, value: T): Promise<void> {
    const store = await getStore();
    await store.set(key, value);
    await store.save();
}

/**
 * Specifically for technicians list
 */
export async function getTechnicians(): Promise<string[]> {
    return await getSetting<string[]>('technicians', []);
}

export async function setTechnicians(techs: string[]): Promise<void> {
    await setSetting('technicians', techs);
}

/**
 * Specifically for CSV file path
 */
export async function getCsvPath(): Promise<string> {
    return await getSetting<string>('csvPath', '');
}

export async function setCsvPath(path: string): Promise<void> {
    await setSetting('csvPath', path);
}

/**
 * Specifically for default save path
 */
export async function getSavePath(): Promise<string> {
    return await getSetting<string>('savePath', '');
}

export async function setSavePath(path: string): Promise<void> {
    await setSetting('savePath', path);
}

/**
 * Scans the directory for the latest document number and returns the next one.
 * Example: if latest is A26099, returns A26100
 */
export async function getNextDocNumber(dirPath: string): Promise<string> {
    if (!dirPath) return '';
    try {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(dirPath);
        
        let maxNum = 0;
        let prefix = 'A'; // Default prefix

        for (const entry of entries) {
            if (entry.isFile && entry.name.toLowerCase().endsWith('.docx')) {
                // Regex to match prefix letter + 5 digits at the start of filename
                const match = entry.name.match(/^([A-Z])(\d{5})/i);
                if (match) {
                    const currentPrefix = match[1].toUpperCase();
                    const num = parseInt(match[2], 10);
                    if (num > maxNum) {
                        maxNum = num;
                        prefix = currentPrefix;
                    }
                }
            }
        }

        if (maxNum === 0) return '';
        
        // Return next number formatted with 5 digits
        const nextNum = (maxNum + 1).toString().padStart(5, '0');
        return `${prefix}${nextNum}`;
    } catch (e) {
        console.error('[Storage] Error scanning directory for next doc number', e);
        return '';
    }
}

/**
 * Management of custom layout (mapping field IDs to sections and order)
 */
export interface CustomLayout {
    [fieldId: string]: {
        sectionId: string;
        order: number;
    };
}

export interface SectionDefinition {
    id: string;
    title: string;
    icon: string; // Lucide icon name
}

export const DEFAULT_SECTIONS: SectionDefinition[] = [
    { id: 'client', title: 'Dati Cliente e Destinazione', icon: 'User' },
    { id: 'refs', title: 'Riferimenti Documento', icon: 'ClipboardList' },
    { id: 'items', title: 'Articoli e Materiali', icon: 'Package' },
    { id: 'checks', title: 'Configurazioni e Opzioni', icon: 'ListCheck' },
    { id: 'staff', title: 'Personale e Firme', icon: 'Users' },
    { id: 'other', title: 'Altri Campi', icon: 'MoreHorizontal' }
];

export async function getSectionDefinitions(): Promise<SectionDefinition[]> {
    return await getSetting<SectionDefinition[]>('section_definitions', DEFAULT_SECTIONS);
}

export async function setSectionDefinitions(sections: SectionDefinition[]): Promise<void> {
    await setSetting('section_definitions', sections);
}

export async function getCustomLayout(slotId: string): Promise<CustomLayout> {
    return await getSetting<CustomLayout>(`custom_layout_${slotId}`, {});
}

export async function setCustomLayout(slotId: string, layout: CustomLayout): Promise<void> {
    await setSetting(`custom_layout_${slotId}`, layout);
}

export interface AiSettings {
    ollamaUrl: string;
    ollamaModel: string;
    temperature: number;
    numPredict: number;
    systemPrompt?: string;
    notificationsEnabled: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.2',
    temperature: 0,
    numPredict: 350,
    notificationsEnabled: true
};

export async function getAiSettings(): Promise<AiSettings> {
    return await getSetting<AiSettings>('ai_settings', DEFAULT_AI_SETTINGS);
}

export async function setAiSettings(settings: AiSettings): Promise<void> {
    await setSetting('ai_settings', settings);
}

// ===========================
// UPDATE SETTINGS
// ===========================

export interface UpdateSettings {
    enabled: boolean;
    autoInstall: boolean;
}

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = {
    enabled: true,
    autoInstall: false,
};

export async function getUpdateSettings(): Promise<UpdateSettings> {
    return await getSetting<UpdateSettings>('update_settings', DEFAULT_UPDATE_SETTINGS);
}

export async function setUpdateSettings(settings: UpdateSettings): Promise<void> {
    await setSetting('update_settings', settings);
}

// Tipo per i dati dell'update ( corrispondente a tauri_plugin_updater::Update )
export type UpdateInfo = {
    version: string;
    body?: string | null;
    date?: string | null;
} | null;

// ===========================
// APP VERSION
// ===========================

export async function getCurrentVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return await getVersion();
}

// ===========================
// UPDATE FUNCTIONS (Tauri 2 Updater Plugin - Comandi invocati via IPC)
// ===========================

export async function checkForUpdates(): Promise<{
  available: boolean;
  currentVersion: string;
  latestVersion?: string;
  body?: string | null;
  date?: string | null;
}> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    
    if (!update) {
      return { 
        available: false, 
        currentVersion: await getCurrentVersion() 
      };
    }
    
    return {
      available: true,
      currentVersion: await getCurrentVersion(),
      latestVersion: update.version,
      body: update.body,
      date: update.date,
    };
  } catch (e) {
    console.error('Update check error:', e);
    return { 
      available: false, 
      currentVersion: await getCurrentVersion() 
    };
  }
}

export async function installUpdate(): Promise<void> {
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (update) {
        await update.downloadAndInstall();
    }
  } catch (e) {
    console.error('Install update error:', e);
    throw e;
  }
}

// Event listeners per aggiornamenti (non più usati, ma留per compatibilità)
export function onUpdateAvailable(callback: (payload: any) => void): void {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen('update-available', (event) => callback(event.payload));
  }).catch(console.error);
}

export function onUpdateDownloaded(callback: () => void): void {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen('update-downloaded', () => callback());
  }).catch(console.error);
}
// ===========================
// BACKUP & RESTORE (Task 13 & 14)
// ===========================

export interface BackupData {
    store: Record<string, any>;
    templates: Record<string, string>; // slotId -> base64
}

export async function exportAllSettings(): Promise<BackupData> {
    const store = await getStore();
    const entries = await store.entries();
    
    const storeData: Record<string, any> = {};
    for (const [key, value] of entries) {
        storeData[key] = value;
    }

    const templatesData: Record<string, string> = {};
    const meta = await getAllTemplatesMeta();
    
    for (const m of meta) {
        if (m) {
            try {
                const content = await readFile(`templates/template_${m.id}.docx`, { baseDir: BaseDirectory.AppData });
                // Convert Uint8Array to base64 string
                const base64 = btoa(String.fromCharCode(...content));
                templatesData[m.id] = base64;
            } catch (e) {
                console.warn(`[Storage] Could not read template ${m.id} for backup:`, e);
            }
        }
    }

    return {
        store: storeData,
        templates: templatesData
    };
}

export async function importAllSettings(data: BackupData): Promise<void> {
    const store = await getStore();
    
    // 1. Clear current store (or we can just overwrite)
    await store.clear();
    
    // 2. Restore store entries
    for (const [key, value] of Object.entries(data.store)) {
        await store.set(key, value);
    }
    await store.save();

    // 3. Restore templates
    if (data.templates) {
        await mkdir('templates', { baseDir: BaseDirectory.AppData, recursive: true });
        for (const [id, base64] of Object.entries(data.templates)) {
            try {
                const binaryString = atob(base64);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                await writeFile(`templates/template_${id}.docx`, bytes, { baseDir: BaseDirectory.AppData });
            } catch (e) {
                console.error(`[Storage] Error restoring template ${id}:`, e);
            }
        }
    }
}

export async function resetAllSettings(): Promise<void> {
    const store = await getStore();
    await store.clear();
    await store.save();

    // Delete templates
    try {
        const ids = ['1', '2', '3'];
        for (const id of ids) {
            try {
                await remove(`templates/template_${id}.docx`, { baseDir: BaseDirectory.AppData });
            } catch (e) {
                // Ignore if not exists
            }
        }
    } catch (e) {
        console.error('[Storage] Error during reset:', e);
    }
}
