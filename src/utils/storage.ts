import { load, Store } from '@tauri-apps/plugin-store';
import { writeFile, readFile, remove, BaseDirectory, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { listen } from '@tauri-apps/api/event';

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
 * Google OAuth tokens
 */
export interface GoogleTokens {
    accessToken: string;
    refreshToken: string;
    expiryDate: number;
}

export async function getGoogleTokens(): Promise<GoogleTokens | null> {
    return await getSetting<GoogleTokens | null>('googleTokens', null);
}

export async function setGoogleTokens(tokens: GoogleTokens): Promise<void> {
    await setSetting('googleTokens', tokens);
    const store = await getStore();
    await store.save();
}

/**
 * Mapping from local event ID to Google Calendar event ID
 */
export async function getGoogleEventMap(): Promise<Record<string, string>> {
    return await getSetting<Record<string, string>>('googleEventMap', {});
}

export async function setGoogleEventMap(map: Record<string, string>): Promise<void> {
    await setSetting('googleEventMap', map);
    const store = await getStore();
    await store.save();
}

/**
 * Scans the directory for the latest document number and returns the next one.
 * Example: if latest is A26099, returns A26100
 */
export async function getNextDocNumber(dirPath: string): Promise<string> {
    if (!dirPath) return '';
    try {
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

// ===========================
// CALENDAR & GOOGLE SYNC (New)
// ===========================

export interface CalendarEvent {
    id: string;
    date: string; // ISO format (YYYY-MM-DD)
    activity: string;
    technician: string;
    startTime?: string; // HH:mm format
    endTime?: string; // HH:mm format
    notes?: string;
    googleEventId?: string; // To correlate with Google Calendar
}

export interface GoogleCalendarSettings {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    expiryDate?: number;
    lastSync?: string;
}

export const DEFAULT_GOOGLE_SETTINGS: GoogleCalendarSettings = {
    enabled: false,
    clientId: '',
    clientSecret: '',
    refreshToken: '',
};

export async function getCalendarEvents(): Promise<CalendarEvent[]> {
    return await getSetting<CalendarEvent[]>('calendar_events', []);
}

export async function setCalendarEvents(events: CalendarEvent[]): Promise<void> {
    await setSetting('calendar_events', events);
}

export async function getGoogleSettings(): Promise<GoogleCalendarSettings> {
    return await getSetting<GoogleCalendarSettings>('google_calendar_settings', DEFAULT_GOOGLE_SETTINGS);
}

export async function setGoogleSettings(settings: GoogleCalendarSettings): Promise<void> {
    await setSetting('google_calendar_settings', settings);
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
    const update = await check();
    if (update) {
        await update.downloadAndInstall();
    }
  } catch (e) {
    console.error('Install update error:', e);
    throw e;
  }
}

export function onUpdateAvailable(callback: (payload: any) => void): void {
  listen('update-available', (event) => callback(event.payload)).catch(console.error);
}

export function onUpdateDownloaded(callback: () => void): void {
  listen('update-downloaded', () => callback()).catch(console.error);
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

    // Delete Excel cache
    try {
        await remove(`excel/pandetta_data.xlsx`, { baseDir: BaseDirectory.AppData }).catch(() => {});
        await remove(`excel/sterlink_data.xlsx`, { baseDir: BaseDirectory.AppData }).catch(() => {});
    } catch (e) {}
}


// ===========================
// EXCEL STORAGE (Task 42)
// ===========================

/**
 * Saves an Excel file to Local Disk (AppData)
 */
export async function saveExcelFile(type: 'pandetta' | 'sterlink', file: File, originalPath?: string | null) {
    // 1. Ensure directory exists
    try {
        await mkdir('excel', { baseDir: BaseDirectory.AppData, recursive: true });
    } catch(e) {}
    
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // 2. Save the file to AppData (cache/backup)
    const fileName = `${type}_data.xlsx`;
    await writeFile(`excel/${fileName}`, bytes, { baseDir: BaseDirectory.AppData });
    
    // 3. IMPORTANT: Directly overwrite the source file on disk
    if (originalPath) {
        try {
            console.log(`[Storage] Overwriting source file at: ${originalPath}`);
            await writeFile(originalPath, bytes);
        } catch (e) {
            console.error(`[Storage] Failed to overwrite original file at ${originalPath}:`, e);
        }
    }

    // 4. Save file name and path to store
    const store = await getStore();
    await store.set(`${type}_file_name`, file.name);
    if (originalPath) {
        await store.set(`${type}_file_path`, originalPath);
    }
    await store.save();
}

/**
 * Retrieves an Excel file from Local Disk
 */
export async function getExcelFile(type: 'pandetta' | 'sterlink'): Promise<File | undefined> {
    try {
        const store = await getStore();
        const fileName = await store.get<string>(`${type}_file_name`);
        if (!fileName) return undefined;

        const content = await readFile(`excel/${type}_data.xlsx`, { baseDir: BaseDirectory.AppData });
        return new File([content], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    } catch (e) {
        return undefined;
    }
}

/**
 * Gets the stored original file name for an Excel manager
 */
export async function getExcelFileName(type: 'pandetta' | 'sterlink'): Promise<string | null | undefined> {
    try {
        const store = await getStore();
        return await store.get<string>(`${type}_file_name`);
    } catch (e) {
        return null;
    }
}

/**
 * Removes persistent Excel data for a manager
 */
export async function clearExcelFile(type: 'pandetta' | 'sterlink') {
    try {
        const store = await getStore();
        await store.delete(`${type}_file_name`);
        await store.delete(`${type}_file_path`);
        await store.save();

        // 2. Remove the actual Excel file
        await remove(`excel/${type}_data.xlsx`, { baseDir: BaseDirectory.AppData }).catch(() => {});
        // 3. Remove the JSON data file
        await remove(`excel/${type}_data.json`, { baseDir: BaseDirectory.AppData }).catch(() => {});
    } catch (e) {
        console.error(`[Storage] Error clearing ${type} file:`, e);
    }
}

/**
 * Gets the stored original file path for an Excel manager
 */
export async function getExcelFilePath(type: 'pandetta' | 'sterlink'): Promise<string | null | undefined> {
    try {
        const store = await getStore();
        return await store.get<string>(`${type}_file_path`);
    } catch (e) {
        return null;
    }
}

/**
 * Gets the raw ArrayBuffer of an Excel file
 */
export async function getExcelFileBuffer(type: 'pandetta' | 'sterlink'): Promise<ArrayBuffer | undefined> {
    try {
        return await readFile(`excel/${type}_data.xlsx`, { baseDir: BaseDirectory.AppData }).then(c => c.buffer);
    } catch (e) {
        return undefined;
    }
}

/**
 * Saves Excel data as JSON to Local Disk (AppData)
 */
export async function saveExcelDataJson(type: 'pandetta' | 'sterlink', data: any[]) {
    try {
        await mkdir('excel', { baseDir: BaseDirectory.AppData, recursive: true });
        await writeFile(`excel/${type}_data.json`, new TextEncoder().encode(JSON.stringify(data)), { baseDir: BaseDirectory.AppData });
    } catch (e) {
        console.error(`[Storage] Error saving ${type} JSON data:`, e);
    }
}

/**
 * Retrieves Excel data as JSON from Local Disk
 */
export async function getExcelDataJson(type: 'pandetta' | 'sterlink'): Promise<any[] | undefined> {
    try {
        const content = await readFile(`excel/${type}_data.json`, { baseDir: BaseDirectory.AppData });
        return JSON.parse(new TextDecoder().decode(content));
    } catch (e) {
        return undefined;
    }
}

/**
 * Gets the stored original file hash for an Excel manager
 */
export async function getExcelFileHash(type: 'pandetta' | 'sterlink'): Promise<string | null | undefined> {
    try {
        const store = await getStore();
        return await store.get<string>(`${type}_file_hash`);
    } catch (e) {
        return null;
    }
}

/**
 * Saves the original file hash for an Excel manager
 */
export async function setExcelFileHash(type: 'pandetta' | 'sterlink', hash: string): Promise<void> {
    try {
        const store = await getStore();
        await store.set(`${type}_file_hash`, hash);
        await store.save();
    } catch (e) {
        console.error(`[Storage] Error saving ${type} file hash:`, e);
    }
}
