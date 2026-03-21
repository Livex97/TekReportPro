import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { FormField } from './docxParser';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

/**
 * Generates a .docx file by attempting to replace fields via docxtemplater.
 * 
 * Note: docxtemplater works perfectly for {{tags}}, [tags], and {tags}.
 * For blank spaces (______), this function makes a best effort to do a direct
 * XML string replacement, though word processors often split runs making it brittle.
 */
/**
 * Generates a .docx file and returns it as a Blob.
 */
export async function getDocxBlob(file: File, fields: FormField[]): Promise<Blob> {
    const arrayBuffer = await file.arrayBuffer();
    const zip = new PizZip(arrayBuffer);

    // Create an object of key-value pairs for docxtemplater
    const data: Record<string, string> = {};
    fields.forEach(f => {
        const val = (f.value || '').trim();
        data[f.id] = val;
        data[f.label] = val;
        // Map common variations
        const cleanLabel = f.label.replace(/^[[{]+|[\]}]+$/g, '');
        data[cleanLabel] = val;
    });

    // Process XML modifications first
    let xml = zip.file("word/document.xml")?.asText();
    if (xml) {
        // 1. Process Row Duplication (Generic for any indexed tags _1, _2, ...)
        const rows = xml.match(/<w:tr(?:>|\s[^>]*>).*?<\/w:tr>/gs) || [];
        let modifiedXml = xml;

        for (const row of rows) {
            // Find all tags in this row: {{TAG_1}}, {TAG_1}, etc.
            const tagsInRow = row.match(/\{+([^}]+)\}+/g);
            if (!tagsInRow) continue;

            const indexedTagsInRow = tagsInRow.filter(t => t.includes('_1'));
            if (indexedTagsInRow.length === 0) continue;

            // This row is a template for index 1.
            // A. Find the maximum index already present in the template for these tags
            let maxExistingN = 1;
            const prefixList: string[] = [];

            indexedTagsInRow.forEach(tagRef => {
                const cleanTag = tagRef.replace(/[\{\}]/g, '').trim();
                const prefix = cleanTag.replace(/_1$/, '');
                prefixList.push(prefix);

                // Check other rows for the same prefix with higher N
                const searchRegex = new RegExp(`${prefix}_(\\d+)`, 'g');
                let rowMatch;
                while ((rowMatch = searchRegex.exec(xml!)) !== null) {
                    maxExistingN = Math.max(maxExistingN, parseInt(rowMatch[1]));
                }
            });

            // B. Find the maximum index provided in the form data for these prefixes
            let maxDataN = 0;
            prefixList.forEach(prefix => {
                fields.forEach(f => {
                    const m = f.label.match(new RegExp(`^${prefix}_(\\d+)$`, 'i')) || 
                              f.id.match(new RegExp(`^${prefix}_(\\d+)$`, 'i'));
                    if (m) maxDataN = Math.max(maxDataN, parseInt(m[1]));
                });
            });

            // C. Duplicate if needed
            if (maxDataN > maxExistingN) {
                let additionalRowsXml = "";
                // We use the row template (index 1) to create new rows
                for (let i = maxExistingN + 1; i <= maxDataN; i++) {
                    let duplicatedRow = row;
                    // Replace _1 with _i in all tags and labels
                    duplicatedRow = duplicatedRow.replace(/(_\s*(?:<[^>]*>)*\s*)1(?=[^0-9])/g, `$1${i}`);
                    additionalRowsXml += duplicatedRow;
                }
                
                // Find the last row that contains the highest existing index for these tags to append after it
                const lastExistingIndexRegex = new RegExp(`<w:tr(?:>|\\s[^>]*>)(?:(?!<w:tr).)*?${prefixList[0]}_${maxExistingN}.*?<\/w:tr>`, 'gs');
                const lastRowMatches = xml!.match(lastExistingIndexRegex);
                const lastRowToAppendAfter = lastRowMatches ? lastRowMatches[lastRowMatches.length - 1] : row;

                modifiedXml = modifiedXml!.replace(lastRowToAppendAfter, lastRowToAppendAfter + additionalRowsXml);
            }
        }
        xml = modifiedXml;

        // 2. Process Underline replacements
        fields.forEach(f => {
            if (f.type !== 'checkbox') {
                const escaped = escapeRegExp(f.label);
                // Improved regex: ensure $1 doesn't capture trailing spaces that we want to discard
                const regex = new RegExp(`(${escaped}(?:<[^>]+>)*(?::)?)\\s*(?:<[^>]+>)*\\s*_{3,}`, 'gi');
                const newVal = (f.value || '').trim();
                xml = xml!.replace(regex, (_, p1) => `${p1} ${newVal.replace(/\n/g, '<w:br/>')}`);
            }
        });

        // 3. Process Checkboxes via DOM manipulation
        const checkboxFields = fields.filter(f => f.type === 'checkbox');
        if (checkboxFields.length > 0) {
            const parser = new DOMParser();
            const docXML = parser.parseFromString(xml, "text/xml");

            // --- A. Process Modern SDT Checkboxes ---
            const sdts = docXML.getElementsByTagName("w:sdt");
            let modernCbIndex = 0;
            for (let i = 0; i < sdts.length; i++) {
                const sdt = sdts[i];
                const checkboxNode = sdt.getElementsByTagName("w14:checkbox")[0];
                if (checkboxNode) {
                    // Modern checkboxes are identified by their order in our fields array (prefixed cb_)
                    const field = checkboxFields.find(f => f.id.startsWith(`cb_`) && f.id.endsWith(`_${modernCbIndex}`));
                    if (field) {
                        const isChecked = field.value === '1' || field.value === 'true';
                        let checkedNode = sdt.getElementsByTagName("w14:checked")[0];
                        if (isChecked) {
                            if (!checkedNode) {
                                checkedNode = docXML.createElement("w14:checked");
                                checkedNode.setAttribute("w14:val", "1");
                                checkboxNode.appendChild(checkedNode);
                            } else {
                                checkedNode.setAttribute("w14:val", "1");
                            }
                        } else if (checkedNode) {
                            checkedNode.setAttribute("w14:val", "0");
                        }
                        // Update visual symbol if present
                        const tNodes = sdt.getElementsByTagName("w:t");
                        for (let j = 0; j < tNodes.length; j++) {
                            const tNode = tNodes[j];
                            if (tNode.textContent && /[\u2610\u2611\u2612\u260A\u260B\u260C\u260D]/.test(tNode.textContent)) {
                                tNode.textContent = isChecked ? '\u2612' : '\u2610';
                            }
                        }
                    }
                    modernCbIndex++;
                }
            }

            // --- B. Process Legacy FFData Checkboxes ---
            const legacyCbNodes = docXML.getElementsByTagName("w:checkBox");
            for (let i = 0; i < legacyCbNodes.length; i++) {
                const cbNode = legacyCbNodes[i];
                const field = checkboxFields.find(f => f.id.startsWith(`lcb_`) && f.id.endsWith(`_${i}`));
                if (field) {
                    const isChecked = field.value === '1' || field.value === 'true';
                    let defaultNode = cbNode.getElementsByTagName("w:default")[0];
                    if (!defaultNode) {
                        defaultNode = docXML.createElement("w:default");
                        cbNode.appendChild(defaultNode);
                    }
                    defaultNode.setAttribute("w:val", isChecked ? "1" : "0");
                }
            }

            const serializer = new XMLSerializer();
            xml = serializer.serializeToString(docXML);
        }

        zip.file("word/document.xml", xml);
    }

    // Now instantiate Docxtemplater with the (possibly) modified zip
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{', end: '}' },
        nullGetter() { return ""; }
    });

    doc.render(data);
    return doc.getZip().generate({
        type: 'blob',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
}

/**
 * Generates and downloads a .docx file.
 */
export async function generateDocx(file: File, fields: FormField[], outputName: string = 'rapportino.docx') {
    try {
        const out = await getDocxBlob(file, fields);
        const arrayBuffer = await out.arrayBuffer();
        
        const path = await save({
            defaultPath: outputName,
            filters: [{ name: 'Word Document', extensions: ['docx'] }]
        });

        if (path) {
            await writeFile(path, new Uint8Array(arrayBuffer));
        }
    } catch (error) {
        console.error("Error generating docx:", error);
        alert('Errore durante la generazione del DOCX. Verifica che il template sia corretto.');
    }
}

/**
 * Escapes regex characters
 */
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generates a PDF from a given HTML element ID using html2canvas and jsPDF
 */
export async function generatePdfFromElement(elementId: string, outputName: string = 'rapportino.pdf') {
    const element = document.getElementById(elementId);
    if (!element) {
        console.error(`Element with ID ${elementId} not found`);
        return;
    }

    try {
        const canvas = await html2canvas(element, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');

        const pdf = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a4'
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        pdf.save(outputName);
    } catch (error) {
        console.error("Error generating pdf:", error);
        alert('Errore durante la generazione del PDF.');
    }
}
