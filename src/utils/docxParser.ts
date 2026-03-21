import mammoth from 'mammoth';
import PizZip from 'pizzip';
import { DOMParser } from '@xmldom/xmldom';

export interface FormField {
    id: string;
    label: string;
    value: string;
    type: 'text' | 'textarea' | 'checkbox';
    group?: string; // For grouping radio/checkbox options together
    isDynamic?: boolean;
    groupId?: string;
}

/**
 * Parses a .docx file and extracts potential form fields.
 * It looks for:
 * 1. Explicit tags: {{FieldName}}, [FieldName], {FieldName}
 * 2. Blank spaces with labels: "Label Name: _________"
 */
export async function extractFieldsFromDocx(file: File): Promise<FormField[]> {
    const arrayBuffer = await file.arrayBuffer();

    // Extract raw text to find patterns
    const result = await mammoth.extractRawText({ arrayBuffer });
    const text = result.value;

    const fields: Map<string, FormField> = new Map();

    // 1. Match explicit tags: {{tag}}, [tag], {tag}
    // Exclude single brackets if they seem like normal punctuation, but we'll try to match word characters
    const tagRegex = /(?:\{\{([^}]+)\}\})|(?:\[([^\]]+)\])|(?:\{([^}]+)\})/g;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        const tagName = (match[1] || match[2] || match[3]).trim();
        if (tagName && tagName.length < 50 && !fields.has(tagName)) {
            fields.set(tagName, {
                id: tagName,
                label: tagName,
                value: '',
                type: 'text'
            });
        }
    }

    // 2. Match lines with "Label: ______" or "Label _______" or "Label : -"
    // This looks for a label (1 to 50 chars), optionally a colon, and then 3 or more underscores OR a colon followed by a dash
    const lines = text.split('\n');
    const underlineRegex = /^([\w\s./-]+?)(?:\s*[:-])\s*(_+|[-])/;

    lines.forEach((line) => {
        const trimmed = line.trim();
        const ulMatch = trimmed.match(underlineRegex);
        if (ulMatch && ulMatch[1]) {
            const label = ulMatch[1].trim();
            // Ensure it's not too long to be a label and not already captured
            if (label.length > 0 && label.length < 60) {
                // Check if it's already a tag
                let isDuplicate = false;
                fields.forEach((f) => {
                    if (f.label === label) isDuplicate = true;
                });

                if (!isDuplicate) {
                    const id = label.replace(/\s+/g, '_').toLowerCase();
                    fields.set(id, {
                        id,
                        label,
                        value: '',
                        type: 'text'
                    });
                }
            }
        }
    });

    // 3. Extract MS Word Checkboxes (Modern and Legacy)
    try {
        const zip = new PizZip(arrayBuffer.slice(0)); // clone buffer
        const xml = zip.file("word/document.xml")?.asText();
        if (xml) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, "text/xml");

            // Helper to find a group title for a node
            const findGroupTitle = (startNode: Node): string | undefined => {
                const isCb = (n: any): boolean => {
                    const txt = n.textContent || '';
                    if (txt.includes('FORMCHECKBOX')) return true;
                    return n.getElementsByTagName('w:checkBox').length > 0 ||
                        n.getElementsByTagName('w14:checkbox').length > 0;
                };

                const clean = (t: string) => {
                    return t.replace(/FORMCHECKBOX/g, '')
                        .replace(/[\u2610\u2611\u2612\u260A\u260B\u260C\u260D]/g, '')
                        .replace(/^[\s\-\.]+/, '')
                        .replace(/[\s\-\.:]+$/, '')
                        .trim();
                };

                const semanticFallbacks: Record<string, string> = {
                    'collaudo': 'Esito collaudo',
                    'manuale': 'Manuale d\'uso',
                    'digitale': 'Manuale d\'uso',
                    'cartaceo': 'Manuale d\'uso',
                    'positive': 'Prove di funzionamento',
                    'negative': 'Prove di funzionamento'
                };

                let cell: any = startNode.parentNode;
                while (cell && cell.nodeName !== 'w:tc') cell = cell.parentNode;
                if (!cell) return undefined;

                let row: any = cell.parentNode;
                while (row && row.nodeName !== 'w:tr') row = row.parentNode;

                let foundTitle: string | undefined;

                if (row) {
                    const cells = Array.from(row.getElementsByTagName('w:tc'));
                    const cellIndex = cells.indexOf(cell);

                    // 1. Table: Search for header in rows ABOVE (skipping checkbox rows)
                    let prevRow: any = row.previousSibling;
                    while (prevRow) {
                        if (prevRow.nodeName === 'w:tr') {
                            const prevCells = prevRow.getElementsByTagName('w:tc');
                            const targetCell = prevCells[cellIndex];
                            if (targetCell) {
                                if (!isCb(targetCell)) {
                                    const t = clean(targetCell.textContent || "");
                                    if (t && t.length > 1 && t.length < 80) {
                                        foundTitle = t;
                                        break;
                                    }
                                }
                            }
                        }
                        prevRow = prevRow.previousSibling;
                    }

                    // 2. Table: Check Left Cell
                    if (!foundTitle && cellIndex > 0) {
                        const leftCell = cells[cellIndex - 1] as any;
                        if (!isCb(leftCell)) {
                            const t = clean(leftCell.textContent || "");
                            if (t && t.length > 1 && t.length < 80) foundTitle = t;
                        }
                    }
                }

                // 3. Same Cell Search
                if (!foundTitle) {
                    const pNodes = cell.getElementsByTagName('w:p');
                    let cellTitle = "";
                    for (let i = 0; i < pNodes.length; i++) {
                        const p = pNodes[i];
                        let isOursOrLater = false;
                        let walk: any = startNode;
                        while (walk) { if (walk === p) { isOursOrLater = true; break; } walk = walk.parentNode; }
                        if (isOursOrLater) break;

                        if (!isCb(p)) {
                            const t = clean(p.textContent || "");
                            if (t && t.length > 2) cellTitle = t;
                        } else if (cellTitle) {
                            break;
                        }
                    }
                    foundTitle = cellTitle || undefined;
                }

                // Hard fallback for specific common labels if the heuristic is noisy or fails
                const nodeXml = startNode.toString().toLowerCase();
                for (const [key, val] of Object.entries(semanticFallbacks)) {
                    if (nodeXml.includes(key)) return val;
                }

                if (foundTitle && foundTitle.includes('{DESCRIZIONE}')) {
                    return 'Prove di funzionamento';
                }

                return foundTitle;
            };

            // --- A. Modern Structured Document Tag (SDT) Checkboxes ---
            const sdts = doc.getElementsByTagName("w:sdt");
            for (let i = 0; i < sdts.length; i++) {
                const sdt = sdts[i];
                const checkboxNode = sdt.getElementsByTagName("w14:checkbox")[0];

                if (checkboxNode) {
                    let label = "Checkbox";
                    const aliasNode = sdt.getElementsByTagName("w:alias")[0];
                    if (aliasNode && aliasNode.getAttribute("w:val")) {
                        label = aliasNode.getAttribute("w:val") || label;
                    } else {
                        let parent = sdt.parentNode;
                        while (parent && parent.nodeName !== 'w:p') {
                            parent = parent.parentNode;
                        }
                        if (parent) {
                            const pText = parent.textContent || '';
                            const cleanText = pText.replace(/[\u2610\u2611\u2612\u260A\u260B\u260C\u260D]/g, '').trim();
                            if (cleanText) {
                                label = cleanText.substring(0, 40) + (cleanText.length > 40 ? '...' : '');
                            }
                        }
                    }

                    const group = findGroupTitle(sdt);
                    const id = `cb_${label.replace(/\s+/g, '_').toLowerCase()}_${i}`;
                    fields.set(id, {
                        id,
                        label: label,
                        value: '0',
                        type: 'checkbox',
                        group
                    });
                }
            }

            // --- B. Legacy Form Field (FFData) Checkboxes ---
            const legacyCheckboxes = doc.getElementsByTagName("w:checkBox");
            for (let i = 0; i < legacyCheckboxes.length; i++) {
                const cbNode = legacyCheckboxes[i];
                let ffData = cbNode.parentNode;
                while (ffData && ffData.nodeName !== 'w:ffData') {
                    ffData = ffData.parentNode;
                }

                if (ffData) {
                    const nameNode = (ffData as any).getElementsByTagName("w:name")[0];
                    let label = nameNode ? nameNode.getAttribute("w:val") : null;

                    if (!label) {
                        let parent = ffData.parentNode;
                        while (parent && parent.nodeName !== 'w:p') {
                            parent = parent.parentNode;
                        }
                        if (parent) {
                            label = (parent.textContent || '').trim().substring(0, 40);
                        }
                    }

                    label = label || `Opzione_${i + 1}`;
                    const group = findGroupTitle(ffData);
                    const id = `lcb_${label.replace(/\s+/g, '_').toLowerCase()}_${i}`;

                    if (!fields.has(id)) {
                        fields.set(id, {
                            id,
                            label: label,
                            value: '0',
                            type: 'checkbox',
                            group
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.warn("Could not parse checkboxes via XML", e);
    }

    return Array.from(fields.values());
}

/**
 * Gets the HTML representation of the docx for preview purposes
 */
export async function getTemplateHtml(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    return result.value;
}

/**
 * Extracts all raw text from a .docx file for parsing purposes (auto-fill source)
 */
export async function extractTextFromDocx(file: File): Promise<string> {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return result.value;
    } catch (err) {
        console.error("Error extracting text from docx:", err);
        return "";
    }
}
