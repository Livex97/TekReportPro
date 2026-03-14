import { readFile, writeFile } from '@tauri-apps/plugin-fs';

export interface CsvRowData {
  richiestaIntervento: string;
  data: string;
  cliente: string;
  ubicazione: string;
  strumentoDaRiparare: string;
  tipoDiAttivitaGuasto: string;
  ddtRitiro?: string;
  dataRitiro?: string;
  garanziaContratto?: string;
  nPrevGt?: string;
  dataPreventivo?: string;
  accettazionePrevGt?: string;
  dataAccettazione?: string;
  statoIntervento?: string;
  esito?: string;
  ddtConsegna?: string;
  dataConsegna?: string;
  rapportoN?: string;
  tecnico: string;
  // nRifPandetta is calculated automatically
}

export async function readCsvData(filePath: string): Promise<string[]> {
    try {
        const content = await readFile(filePath);
        const decoder = new TextDecoder('utf-8');
        const text = decoder.decode(content);
        return text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    } catch (e) {
        console.error("Error reading CSV", e);
        throw e;
    }
}

export async function checkDuplicateInCsv(filePath: string, request: CsvRowData): Promise<boolean> {
    const lines = await readCsvData(filePath);
    
    // Skip header
    for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split(';');
        if (columns.length < 6) continue;
        
        const existingData = columns[1].trim();
        const existingCliente = columns[2].trim();
        const existingStrumento = columns[4].trim();
        
        if (
            existingData === request.data &&
            existingCliente.toLowerCase() === request.cliente.toLowerCase() &&
            existingStrumento.toLowerCase() === request.strumentoDaRiparare.toLowerCase()
        ) {
            return true;
        }
    }
    return false;
}

export async function appendRowToCsv(filePath: string, rowData: CsvRowData): Promise<void> {
    const lines = await readCsvData(filePath);
    
    // Calculate new nRifPandetta
    let maxRif = 0;
    for (let i = 1; i < lines.length; i++) {
        const columns = lines[i].split(';');
        if (columns.length >= 20) { // 20th column is N.RIF PANDETTA
            const r = parseInt(columns[19], 10);
            if (!isNaN(r) && r > maxRif) {
                maxRif = r;
            }
        }
    }
    const newRif = maxRif + 1;

    // Formatting fields
    const formatField = (f?: string) => f ? f.replace(/;/g, ',') : '';

    const newRowArray = [
        formatField(rowData.richiestaIntervento),
        formatField(rowData.data),
        formatField(rowData.cliente),
        formatField(rowData.ubicazione),
        formatField(rowData.strumentoDaRiparare),
        formatField(rowData.tipoDiAttivitaGuasto),
        formatField(rowData.ddtRitiro) || '//',
        formatField(rowData.dataRitiro) || '//',
        formatField(rowData.garanziaContratto) || '//',
        formatField(rowData.nPrevGt) || '//',
        formatField(rowData.dataPreventivo) || '//',
        formatField(rowData.accettazionePrevGt) || '//',
        formatField(rowData.dataAccettazione) || '//',
        formatField(rowData.statoIntervento) || '',
        formatField(rowData.esito) || '',
        formatField(rowData.ddtConsegna) || '//',
        formatField(rowData.dataConsegna) || '//',
        formatField(rowData.rapportoN) || '',
        formatField(rowData.tecnico),
        newRif.toString()
    ];

    const newRowString = newRowArray.join(';');

    // Use TextEncoder to prepare the complete new string
    const completeContent = [...lines, newRowString].join('\n') + '\n';
    const encoder = new TextEncoder();
    const dataToWrite = encoder.encode(completeContent);
    
    await writeFile(filePath, dataToWrite);
}
