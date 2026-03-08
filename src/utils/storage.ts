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

