// @ts-ignore
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

import type { FormField } from './docxParser';

// Use a more robust worker initialization for Tauri/Vite
if (typeof window !== 'undefined') {
    // Polyfill for ReadableStream async iterator, required for some versions of Safari/WKWebView
    if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as any)[Symbol.asyncIterator]) {
        (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* () {
            const reader = this.getReader();
            try {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) return;
                    yield value;
                }
            } finally {
                reader.releaseLock();
            }
        };
    }

    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
    } catch (e) {
        console.error('[PDF Parser] Failed to set workerSrc:', e);
    }
}


export type DocumentType = 'DDT' | 'Fattura' | 'Documento Tecnico' | 'Generico';
export const DocumentTypes = {
    DDT: 'DDT' as DocumentType,
    FATTURA: 'Fattura' as DocumentType,
    TECNICO: 'Documento Tecnico' as DocumentType,
    GENERIC: 'Generico' as DocumentType
};


export interface PdfExtractionResult {
    fullText: string;
    type: DocumentType;
    pages: {
        lines: { y: number; items: { str: string; x: number }[] }[];
    }[];
}

export function detectDocumentType(fullText: string): DocumentType {
    const text = fullText.toUpperCase();
    
    // Fattura keywords (based on FATTURA N.207.PDF example context)
    if (text.includes('FATTURA') || text.includes('IMPONIBILE') || (text.includes('IVA') && text.includes('SCADENZA'))) {
        return DocumentTypes.FATTURA;
    }
    
    // DDT keywords (current logic)
    if (text.includes('DDT') || text.includes('DOCUMENTO DI TRASPORTO') || text.includes('VETTORE') || text.includes('NUMERO COLLI')) {
        return DocumentTypes.DDT;
    }
    
    // Tecnico keywords (Technical Document)
    if (text.includes('COLLAUDO') || text.includes('CERTIFICATO') || text.includes('TECHNICAL') || text.includes('PROTOCOLLO')) {
        return DocumentTypes.TECNICO;
    }
    
    return DocumentTypes.GENERIC;
}

/**
 * Extracts raw text and spatial layout from a PDF binary data.
 */
export async function extractTextFromPdf(data: Uint8Array | ArrayBuffer | File): Promise<PdfExtractionResult> {
    let binaryData: Uint8Array;
    
    if (data instanceof File) {
        console.log('[PDF Parser] Converting File to ArrayBuffer...');
        const buffer = await data.arrayBuffer();
        binaryData = new Uint8Array(buffer);
    } else if (data instanceof ArrayBuffer) {
        binaryData = new Uint8Array(data);
    } else {
        binaryData = data;
    }

    console.log('[PDF Parser] Starting extraction, binary size:', binaryData.byteLength);

    try {
        const loadingTask = pdfjsLib.getDocument({
            data: binaryData,
            standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version || '5.5.207'}/standard_fonts/`,
            disableFontFace: true,
            useSystemFonts: true,
            isEvalSupported: false,
            // Force disabling streams and range requests for maximum compatibility in WebView
            disableStream: true,
            disableRange: true,
            enableXfa: false,
        });
        const pdfDoc = await loadingTask.promise;
        console.log('[PDF Parser] PDF loaded successfully. Number of pages:', pdfDoc.numPages);


        let fullText = '';
        const pages: PdfExtractionResult['pages'] = [];

        // Iterate through all pages
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        console.log(`[PDF Parser] Processing page ${pageNum}...`);
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        
        if (!textContent || !textContent.items) {
            console.warn(`[PDF Parser] Page ${pageNum} returned no text content`);
            continue;
        }

        const items = Array.isArray(textContent.items) 
            ? textContent.items 
            : (textContent.items as any)._items || []; // Catch potential non-array items

        console.log(`[PDF Parser] Page ${pageNum} items found:`, items.length);

            // Spatial grouping
            const linesMap = new Map<number, { str: string, x: number }[]>();

            for (let i = 0; i < items.length; i++) {
            const item = items[i] as any;
            if (!item || typeof item.str !== 'string' || !item.transform) continue;
            const str = item.str.trim();
            if (!str) continue;

            const x = Math.round(item.transform[4]);
            const y = Math.round(item.transform[5]);


            let targetY = y;
            // Allow small y differences to be grouped together
            if (linesMap.size > 0) {
                const existingYs: number[] = [];
                linesMap.forEach((_, key) => existingYs.push(key));
                
                for (let k = 0; k < existingYs.length; k++) {
                    const existingY = existingYs[k];
                    if (Math.abs(existingY - y) <= 4) {
                        targetY = existingY;
                        break;
                    }
                }
            }
          
                if (!linesMap.has(targetY)) {
                    linesMap.set(targetY, []);
                }
                linesMap.get(targetY)!.push({ str, x });
            }

            // Sort lines by Y descending (PDF coordinates usually have 0,0 at bottom-left)
            const sortedY: number[] = [];
            linesMap.forEach((_, key) => sortedY.push(key));
            sortedY.sort((a, b) => b - a);
            
            const lines = sortedY.map(y => {
                const items = linesMap.get(y)!;
                // Sort items left to right
                items.sort((a, b) => a.x - b.x); 
                return { y, items };
            });

            // Build structured text preserving columns using visual spacing relative to X
            const structuredPageText = lines.map(line => {
                return line.items.map(it => it.str).join(' | ');
            }).join('\n');
            
            fullText += structuredPageText + '\n\n';

            pages.push({ lines });
        }

        console.log('[PDF Parser] Finished raw text extraction. Total characters:', fullText.length);
        const type = detectDocumentType(fullText);
        console.log('[PDF Parser] Detected document type:', type);

        return { fullText, type, pages };
    } catch (error) {
        console.error('[PDF Parser] Error during PDF document loading:', error);
        throw error;
    }
}

/**
 * General purpose spatial extraction for different document types.
 */
function extractStructuredFields(result: PdfExtractionResult): Record<string, string> {
    const type = result.type;
    console.log(`[PDF Parser] Starting structured extraction for type: ${type}...`);
    const extractions: Record<string, string> = {};
    if (!result.pages.length) {
        console.warn('[PDF Parser] No pages found in result');
        return extractions;
    }

    const allLines = result.pages.flatMap(p => p.lines);

    // 1. Tipologia Documento (TIPO_DOCUMENTO)
    // Find lines that contain DDT or FATTURA near top
    for (let i = 0; i < allLines.length; i++) {
        const line = allLines[i];
        const ddtItem = line.items.find(it => it.str.includes('DDT VENDITA') || it.str.includes('FATTURA') || it.str.includes('PROGETTO'));
        if (ddtItem) {
            extractions['tipo_documento'] = ddtItem.str;
            break;
        }
    }


    // 2. Destinazione: REPARTO_AMBULATORIO, INDIRIZZO, CAP, CITTA
    const destIdx = allLines.findIndex(l => l.items.some(i => i.str.includes('LUOGO DI DESTINAZIONE')));
    if (destIdx !== -1) {
        const destItem = allLines[destIdx].items.find(i => i.str.includes('LUOGO DI DESTINAZIONE'));
        const dx = destItem?.x || 0;

        const destLines = [];
        for (let i = destIdx + 1; i < destIdx + 7; i++) {
            if (i >= allLines.length) break;
            // Collect all items on this line that are inside the destination column (roughly from dx to 580)
            const items = allLines[i].items.filter(it => it.x >= dx - 10 && it.x < dx + 230);
            if (items.length > 0) {
                const s = items.map(it => it.str).join(' ').trim();

                // CRITICAL: Stop if we find bank info or specific footer labels
                if (s.toLowerCase().includes('dati bancari') || s.toLowerCase().includes('partita iva') || s.toLowerCase().includes('telefono')) {
                    break;
                }

                destLines.push(s);
                // Stop if we find a line starting with 5 digits (CAP)
                if (/^\d{5}/.test(s)) break;
            }
        }

        if (destLines.length > 0) {
            // Keep the full block in reparto_ambulatorio including CAP/City
            extractions['reparto_ambulatorio'] = destLines.join(' - ');

            const lastLine = destLines[destLines.length - 1];
            const capCittaMatch = lastLine.match(/^(\d{5})\s*(.*)$/);

            if (capCittaMatch) {
                extractions['dest_cap'] = capCittaMatch[1];
                extractions['dest_citta'] = capCittaMatch[2].replace(/\s*\([^)]+\)$/, '').trim();

                // Indirizzo is typically the line before the CAP line
                if (destLines.length >= 2) {
                    extractions['dest_indirizzo'] = destLines[destLines.length - 2];
                }
            }
        }
        console.log('[PDF Parser] Extraction complete: Destinazione', extractions['reparto_ambulatorio'] ? 'Found' : 'Not Found');
    }

    // 3. Spett.le: RAGIONE_SOCIALE, INDIRIZZO, CAP, CITTA
    const spettIdx = allLines.findIndex(l => l.items.some(i => i.str.includes('SPETT.LE')));
    if (spettIdx !== -1) {
        const spettItem = allLines[spettIdx].items.find(i => i.str.includes('SPETT.LE'));
        const sx = spettItem?.x || 0;

        const clientLines = [];
        for (let i = spettIdx + 1; i < spettIdx + 7; i++) {
            if (i >= allLines.length) break;
            // Collect all items for the right column (from sx to the right)
            const items = allLines[i].items.filter(it => it.x >= sx - 10);
            if (items.length > 0) {
                const s = items.map(it => it.str).join(' ').trim();

                // Stop at bank details/PIVA footer
                if (s.toLowerCase().includes('dati bancari') || s.toLowerCase().includes('partita iva') || s.toLowerCase().includes('biotek')) {
                    break;
                }

                clientLines.push(s);
                // Stop at CAP line but include it first
                if (/^\d{5}/.test(s)) break;
            }
        }

        if (clientLines.length > 0) {
            let capIdx = -1;
            for (let i = 0; i < clientLines.length; i++) {
                if (/^\d{5}/.test(clientLines[i])) {
                    capIdx = i;
                    break;
                }
            }

            if (capIdx !== -1) {
                const capCittaMatch = clientLines[capIdx].match(/^(\d{5})\s*(.*)$/);
                if (capCittaMatch) {
                    extractions['cap'] = capCittaMatch[1];
                    extractions['citta'] = capCittaMatch[2].replace(/\s*\([^)]+\)$/, '').trim();
                }

                if (capIdx === 1) {
                    extractions['ragione_sociale'] = clientLines[0];
                } else if (capIdx === 2) {
                    extractions['ragione_sociale'] = clientLines[0];
                    extractions['indirizzo'] = clientLines[1];
                } else if (capIdx >= 3) {
                    // Indirizzo is line before CAP, everything else is Ragione Sociale
                    extractions['ragione_sociale'] = clientLines.slice(0, capIdx - 1).join(' ');
                    extractions['indirizzo'] = clientLines[capIdx - 1];
                }
            } else {
                // Fallback if no CAP line found
                extractions['ragione_sociale'] = clientLines[0];
                if (clientLines.length >= 2) extractions['indirizzo'] = clientLines[1];
            }
        }
        console.log('[PDF Parser] Extraction complete: Spett.le', extractions['ragione_sociale'] ? 'Found' : 'Not Found');
    }

    // 4. ID DOCUMENTO e DATA DOC (N_RICHIESTA)
    const idDocIdx = allLines.findIndex(l => l.items.some(i => i.str.includes('ID DOCUMENTO')));
    if (idDocIdx !== -1) {
        const idDocItem = allLines[idDocIdx].items.find(i => i.str.includes('ID DOCUMENTO'));
        const dataDocItem = allLines[idDocIdx].items.find(i => i.str.includes('DATA DOC'));

        const idX = idDocItem?.x || 0;
        const dataX = dataDocItem?.x || 0;

        let idDocVal = '';
        let dataDocVal = '';

        for (let i = idDocIdx + 1; i < idDocIdx + 4; i++) {
            if (i >= allLines.length) break;

            if (!idDocVal) {
                const item = allLines[i].items.find(it => Math.abs(it.x - idX) < 40);
                if (item) idDocVal = item.str.trim();
            }
            if (!dataDocVal) {
                const item = allLines[i].items.find(it => Math.abs(it.x - dataX) < 40);
                if (item) dataDocVal = item.str.trim();
            }
        }

        if (idDocVal && dataDocVal) {
            extractions['n_richiesta'] = `${idDocVal} DEL ${dataDocVal}`;
        } else if (idDocVal) {
            extractions['n_richiesta'] = idDocVal;
        } else if (dataDocVal) {
            extractions['n_richiesta'] = dataDocVal;
        }
        console.log('[PDF Parser] Extraction complete: N_RICHIESTA:', extractions['n_richiesta'] || 'Not Found');
    }

    // 5. Table Articoli (Multi-page support)
    let artCount = 0;
    let colX: Record<string, number> = {};

    result.pages.forEach((page) => {
        const pageLines = page.lines;
        const tableHeaderIdx = pageLines.findIndex(l => l.items.some(i => {
          const s = i.str.toUpperCase();
          return s.includes('CODICE ARTICOLO') || s === 'CODICE' || s === 'ARTICOLO' || s === 'DESCRIZIONE' || s === 'PREZZO UNIT.';
        }));

        if (tableHeaderIdx === -1) return;

        // Initialize or update column positions if not set
        if (!colX['n']) {
            const headerItems = pageLines[tableHeaderIdx].items;
            for (let j = 0; j < headerItems.length; j++) {
                const hi = headerItems[j];
                const txt = hi.str.toUpperCase().trim();
                
                if (txt === 'N.' || txt === 'N') colX['n'] = hi.x;
                else if (txt.includes('CODICE ARTICOLO') || txt === 'CODICE') colX['codice'] = hi.x;
                else if (txt.includes('DESCRIZIONE')) colX['descrizione'] = hi.x;
                else if (txt === 'UM') colX['um'] = hi.x;
                else if (txt.includes("QUANTITA'") || txt === "QUANTITA" || txt === 'Q.TA' || txt === 'Q.TÀ') colX['quantita'] = hi.x;
                else if (txt.includes('PREZZO UNIT.')) colX['prezzo_unit'] = hi.x;
                else if (txt.includes('SC.%')) colX['sconto'] = hi.x;
                else if (txt.includes('PREZZO TOT.')) colX['prezzo_tot'] = hi.x;
                else if (txt.includes('C.IVA') || txt === 'IVA') colX['iva'] = hi.x;
                else if (txt.includes('MATRICOLA') || txt === 'SN') colX['matricola'] = hi.x;
            }


            if (!colX['n']) colX['n'] = 25;
            if (!colX['codice']) colX['codice'] = colX['n'] + 30;
            if (!colX['descrizione']) colX['descrizione'] = colX['codice'] + 60;
            if (!colX['um']) colX['um'] = colX['descrizione'] + 150;
            if (!colX['quantita']) colX['quantita'] = colX['um'] + 30;
            if (!colX['matricola'] && type === DocumentTypes.DDT) colX['matricola'] = colX['quantita'] + 150;
        }

        const getColVal = (items: { str: string, x: number }[], expectedX: number, tolerance = 40, ignoreXs: number[] = []) => {
            if (expectedX === undefined) return '';
            const validItems = items.filter(it => {
                for (const ix of ignoreXs) {
                    if (ix !== undefined && Math.abs(it.x - ix) < Math.abs(it.x - expectedX)) {
                        return false;
                    }
                }
                return true;
            });
            if (!validItems.length) return '';

            const closest = validItems.reduce((prev, curr) => {
                return (Math.abs(curr.x - expectedX) < Math.abs(prev.x - expectedX) ? curr : prev);
            }, { str: '', x: 9999 });
            return Math.abs(closest.x - expectedX) < tolerance ? closest.str : '';
        };

        for (let i = tableHeaderIdx + 1; i < pageLines.length; i++) {
            const line = pageLines[i];

            // Stop parsing articles on this page if we hit footer markers
            if (line.items.some(it => it.str.includes('CAUSALE DEL TRASPORTO') || it.str.includes('SEGUE'))) {
                break;
            }

            // Check for new row start
            const hasNum = line.items.some(it => Math.abs(it.x - colX['n']) < 25 && /^\d+$/.test(it.str));
            const hasCode = line.items.some(it => Math.abs(it.x - colX['codice']) < 25);
            const isNewRow = hasNum || hasCode;

            const descStartX = colX['codice'] ? colX['codice'] + 30 : 80;
            const descEndX = colX['um'] ? colX['um'] - 20 : (colX['quantita'] ? colX['quantita'] - 40 : 400);
            const descItems = line.items.filter(it => it.x >= descStartX && it.x <= descEndX);
            const desc = descItems.map(it => it.str).join(' ').trim();

            if (isNewRow) {
                artCount++;
                const q = getColVal(line.items, colX['quantita'], 50, [colX['um']]);
                const art = getColVal(line.items, colX['codice'], 50);
                const sn = getColVal(line.items, colX['matricola'], 80);

                if (q || art || desc) {
                    extractions[`q_${artCount}`] = q.trim();
                    extractions[`articolo_${artCount}`] = art.trim();
                    extractions[`descrizione_${artCount}`] = desc.replace(/\s+/g, ' ').trim();
                    extractions[`sn_${artCount}`] = (sn !== '/' && sn !== '' ? sn.trim() : '');
                    
                    // Extra invoice fields
                    if (colX['prezzo_unit']) extractions[`prezzo_unit_${artCount}`] = getColVal(line.items, colX['prezzo_unit'], 40).trim();
                    if (colX['sconto']) extractions[`sconto_${artCount}`] = getColVal(line.items, colX['sconto'], 40).trim();
                    if (colX['prezzo_tot']) extractions[`prezzo_tot_${artCount}`] = getColVal(line.items, colX['prezzo_tot'], 40).trim();
                    if (colX['iva']) extractions[`iva_${artCount}`] = getColVal(line.items, colX['iva'], 40).trim();
                } else {
                    artCount--;
                }
            } else if (artCount > 0 && desc && !line.items.some(it => it.str.includes('CAUSALE'))) {
                const prevDesc = extractions[`descrizione_${artCount}`] || '';
                const cleanLineDesc = desc.replace(/\s+/g, ' ').trim();
                if (cleanLineDesc) {
                    extractions[`descrizione_${artCount}`] = (prevDesc ? prevDesc + ' ' : '') + cleanLineDesc;
                    extractions[`descrizione_${artCount}`] = extractions[`descrizione_${artCount}`].replace(/\s+/g, ' ').trim();
                }
            }
        }
    });

    // 6. Post-process descriptions for Invoices and Technical docs to extract inline Serial Numbers
    for (let i = 1; i <= artCount; i++) {
        const desc = extractions[`descrizione_${i}`] || '';
        if (desc) {
            // Look for S/N: or MATR: or MATRICOLA: in description
            const snMatch = desc.match(/s\/n[:\s]+([A-Z0-9\._-]+)/i) || desc.match(/MATR(?:ICOLA)?[:\.\s]+([A-Z0-9\._-]+)/i);
            if (snMatch && (!extractions[`sn_${i}`] || extractions[`sn_${i}`] === '/')) {
                extractions[`sn_${i}`] = snMatch[1].trim();
            }
        }
    }


    const artCountTotal = Object.keys(extractions).filter(k => k.startsWith('articolo_')).length;
    console.log(`[PDF Parser] Table Articles extraction complete. Found ${artCountTotal} items.`);
    return extractions;
}

/**
 * Attempts to automatically fill fields by fuzzy searching labels in the extracted text.
 * Enhanced with specific format handling for spatial parsing results.
 */
export function autoFillFields(fields: FormField[], sourceData: string | PdfExtractionResult): FormField[] {
    console.log('[PDF Parser] autoFillFields called with', fields.length, 'fields and sourceData type:', typeof sourceData === 'string' ? 'string' : 'PdfExtractionResult');
    let normalizedText = '';
    let spatialExtractions: Record<string, string> = {};

    if (typeof sourceData === 'string') {
        normalizedText = sourceData.replace(/\s+/g, ' ');
    } else {
        normalizedText = sourceData.fullText.replace(/\s+/g, ' ');
        spatialExtractions = extractStructuredFields(sourceData);
    }

    const extractions: Record<string, string> = { ...spatialExtractions };
    console.log('[PDF Parser] Total raw extractions found before auto-filling:', Object.keys(extractions).length);

    // Regex fallbacks (only populate if not already found via spatial layout)
    if (!extractions['document_number']) {
        const docRefMatch = normalizedText.match(/(?:BO|DDT|FATTURA|N° DOCUMENTO)\s*(?:N\.)?\s*(\d+[A-Z]?)\s*(?:del|del:|DATA DOC|DATA DOCUMENTO)\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (docRefMatch) {
            extractions['document_number'] = docRefMatch[1];
            extractions['document_date'] = docRefMatch[2];
        }
    }

    if (!extractions['cliente'] && !extractions['ragione_sociale']) {
        const customerMatch = normalizedText.match(/(?:SPETT\.LE|CLIENTE|DESTINATARIO)\s+([A-Z0-9\s.,&/]+?)(?:\s{2,}|PARTITA IVA|PIVA|C\.CLIENTE|DDT|FATTURA|\n|$)/i);
        if (customerMatch) extractions['cliente'] = customerMatch[1].trim();
    }

    const resultFields = fields.map(field => {
        const label = field.label.toLowerCase().trim();

        // 1. Direct Spatial Map matching by placeholder
        if (spatialExtractions[label]) return { ...field, value: spatialExtractions[label] };

        // 2. Specialized Aliases
        if (label.includes('cliente') || label.includes('ragione_sociale')) {
            if (extractions['ragione_sociale']) return { ...field, value: extractions['ragione_sociale'] };
        }
        if (label.includes('indirizzo')) {
            if (extractions['indirizzo']) return { ...field, value: extractions['indirizzo'] };
            if (extractions['dest_indirizzo']) return { ...field, value: extractions['dest_indirizzo'] };
        }
        if (label.includes('cap')) {
            if (extractions['cap']) return { ...field, value: extractions['cap'] };
            if (extractions['dest_cap']) return { ...field, value: extractions['dest_cap'] };
        }
        if (label.includes('citta') || label.includes('città')) {
            if (extractions['citta']) return { ...field, value: extractions['citta'] };
            if (extractions['dest_citta']) return { ...field, value: extractions['dest_citta'] };
        }

        if (label.includes('destinazione')) {
            if (extractions['reparto_ambulatorio']) return { ...field, value: extractions['reparto_ambulatorio'] };
        }

        if ((label.includes('documento') || label.includes('ddt') || label.includes('fattura')) && !label.includes('data')) {
            if (extractions['document_number']) return { ...field, value: extractions['document_number'] };
        }
        if (label.includes('data') && extractions['document_date']) return { ...field, value: extractions['document_date'] };

        // 3. Generic fuzzy matching
        const escapedLabel = field.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const genericRegex = new RegExp(`(?:${escapedLabel})\\s*:?\\s*([^\\n\\r]{1,100}?)(?:  |$)`, 'i');
        const match = normalizedText.match(genericRegex);

        if (match && match[1]) {
            return {
                ...field,
                value: match[1].trim()
            };
        }

        return field;
    });

    // Append any dynamically extracted table items that aren't already mapped
    const maxExtractedItem = Object.keys(extractions).reduce((max, key) => {
        const m = key.match(/_(?!.*_)(\d+)$/);
        if (m) return Math.max(max, parseInt(m[1]));
        return max;
    }, 0);

    for (let i = 1; i <= maxExtractedItem; i++) {
        if (!resultFields.some(f => f.id === `q_${i}` || f.label.toLowerCase() === `q_${i}`)) {
            if (extractions[`q_${i}`] || extractions[`articolo_${i}`] || extractions[`descrizione_${i}`]) {
                resultFields.push({ id: `q_${i}`, label: `Q_${i}`, value: extractions[`q_${i}`] || '', type: 'text' });
                resultFields.push({ id: `articolo_${i}`, label: `ARTICOLO_${i}`, value: extractions[`articolo_${i}`] || '', type: 'text' });
                resultFields.push({ id: `descrizione_${i}`, label: `DESCRIZIONE_${i}`, value: extractions[`descrizione_${i}`] || '', type: 'text' });
                resultFields.push({ id: `sn_${i}`, label: `SN_${i}`, value: extractions[`sn_${i}`] || '', type: 'text' });
            }
        }
    }

    const filledCount = resultFields.filter(f => f.value).length;
    console.log(`[PDF Parser] autoFillFields complete. Fields filled: ${filledCount}/${resultFields.length}`);

    return resultFields;
}
