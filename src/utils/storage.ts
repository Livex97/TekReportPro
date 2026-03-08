import { get, set, del } from 'idb-keyval';

export interface TemplateIndex {
    id: string;
    name: string;
}

/**
 * Saves a template File to IndexedDB 
 */
export async function saveTemplateFile(id: string, file: File) {
    await set(`template_${id}`, file);
    // Also save a small index so we can retrieve names without loading the whole file
    await set(`template_meta_${id}`, { id, name: file.name });
}

/**
 * Retrieves a template File from IndexedDB
 */
export async function getTemplateFile(id: string): Promise<File | undefined> {
    return await get(`template_${id}`);
}

/**
 * Retrieves template metadata from IndexedDB
 */
export async function getTemplateMeta(id: string): Promise<TemplateIndex | undefined> {
    return await get(`template_meta_${id}`);
}

/**
 * Deletes a template from IndexedDB
 */
export async function deleteTemplate(id: string) {
    console.log('[Storage] Deleting template and meta for ID:', id);
    await del(`template_${id}`);
    await del(`template_meta_${id}`);
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
