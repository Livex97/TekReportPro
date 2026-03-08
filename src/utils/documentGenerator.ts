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
        // 1. Process Row Duplication (must happen before Docxtemplater parses the template)
        const maxQ = fields.reduce((max, f) => {
            const m = f.label.match(/Q\s*_\s*(\d+)/i) || f.id.match(/q\s*_\s*(\d+)/i);
            return m ? Math.max(max, parseInt(m[1])) : max;
        }, 0);

        if (maxQ > 0) {
            const rows = xml.match(/<w:tr(?:>|\s[^>]*>).*?<\/w:tr>/gs) || [];
            let maxExistingN = 0;
            let lastRowWithTag = "";
            let templateRow = "";

            for (const row of rows) {
                const textContent = row.replace(/<[^>]+>/g, '');
                const m = textContent.match(/Q\s*_\s*(\d+)/i);
                if (m) {
                    const n = parseInt(m[1]);
                    if (n > maxExistingN) {
                        maxExistingN = n;
                        lastRowWithTag = row;
                    }
                    if (n === 1) templateRow = row;
                }
            }

            if (maxQ > maxExistingN && templateRow && lastRowWithTag) {
                let additionalRowsXml = "";
                for (let i = maxExistingN + 1; i <= maxQ; i++) {
                    let duplicatedRow = templateRow;
                    duplicatedRow = duplicatedRow.replace(/(_\s*(?:<[^>]*>)*\s*)1/g, `$1${i}`);
                    additionalRowsXml += duplicatedRow;
                }
                xml = xml.replace(lastRowWithTag, () => lastRowWithTag + additionalRowsXml);
            }
        }

        // 2. Process Underline replacements
        fields.forEach(f => {
            if (f.type !== 'checkbox' && (f.value || '').trim()) {
                const escaped = escapeRegExp(f.label);
                // Improved regex: ensure $1 doesn't capture trailing spaces that we want to discard
                const regex = new RegExp(`(${escaped}(?:<[^>]+>)*(?::)?)\\s*(?:<[^>]+>)*\\s*_{3,}`, 'gi');
                xml = xml!.replace(regex, `$1 ${f.value.trim()}`);
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
        delimiters: { start: '{', end: '}' }
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
