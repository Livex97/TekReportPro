import { getAiSettings } from './storage';

export interface ExtractedData {
  richiestaIntervento: string;
  data: string;
  cliente: string;
  ubicazione: string;
  strumentoDaRiparare: string;
  tipoDiAttivitaGuasto: string;
  tecnico: string;
}

export const DEFAULT_SYSTEM_PROMPT = `Sei un assistente per l'estrazione dati dal testo di email o PDF di richieste di assistenza tecnica.
Estrai le seguenti informazioni dal testo fornito. Se un campo manca o non c'è, usa una stringa vuota "".
NON INSERIRE MAI SIGLE O TESTO NON RICHIESTO COME RISPOSTA.

NOTA: Il testo potrebbe essere diviso in "METADATI:" e "CORPO:". I Metadati (Da, Oggetto, Data) contengono spesso la data e un'idea del cliente (email), ma analizza anche il Corpo per il dettaglio tecnico, strumento, ecc.
Nel caso dei PDF, il testo è organizzato per righe e le colonne sono spesso separate dal carattere "|".

FORMATTAZIONE: 
- Ogni valore deve essere estratto e riportato in MAIUSCOLO.
- Mantieni la punteggiatura originale delle denominazioni (es. S.C., S.S.D., ASLTA).

CAMPI:
- "richiestaIntervento": Estrai SOLAMENTE il numero o l'ID della richiesta o dell'ODL (es. "2026/00873" o "ODL 216169"). NON inserire parole aggiuntive. Se non trovi nessun numero di richiesta esplicito nel testo (come accade spesso nelle email), scrivi ESATTAMENTE la parola "EMAIL" e NON INVENTARE numeri.
- "data": Data del documento nel formato "DD MM YYYY".
- "cliente": Denominazione completa del cliente richiedente. Prediligi nomi rigorosi e specifici (es. "S.C. AREA GESTIONE TECNICA S.S.D." o "INGEGNERIA CLINICA") invece che termini limitati o generici se compaiono assieme.
- "ubicazione": Luogo fisico (l'ospedale, la sede lavorativa o il reparto dell'intervento).
- "strumentoDaRiparare": Che cosa si deve riparare? Specifica Nome, marca e modello, includendo il Serial Number / SN numerico se trovalo.
- "tipoDiAttivitaGuasto": Sintesi concisa del guasto, dell'errore, o dell'attività che bisogna fare.
- "tecnico": Il nome del tecnico assegnato, altrimenti stringa vuota.`;

export async function generateOllamaExtraction(text: string, signal?: AbortSignal): Promise<ExtractedData> {
  const settings = await getAiSettings();
  
  const schema = {
    type: "object",
    properties: {
      richiestaIntervento: { type: "string" },
      data: { type: "string" },
      cliente: { type: "string" },
      ubicazione: { type: "string" },
      strumentoDaRiparare: { type: "string" },
      tipoDiAttivitaGuasto: { type: "string" },
      tecnico: { type: "string" }
    },
    required: ["richiestaIntervento", "data", "cliente", "ubicazione", "strumentoDaRiparare", "tipoDiAttivitaGuasto", "tecnico"]
  };

  const systemPrompt = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const prompt = `
${systemPrompt}

Testo:
"""
${text}
"""
`;

  try {
    const baseUrl = settings.ollamaUrl.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: signal,
      body: JSON.stringify({
        model: settings.ollamaModel,
        prompt: prompt,
        stream: false,
        format: schema,
        options: {
          temperature: settings.temperature,
          num_predict: settings.numPredict
        }
      })
    });

    if (!response.ok) {
        let msg = 'Errore di connessione a Ollama';
        try {
            const errorData = await response.json();
            msg = errorData.error || msg;
        } catch(e) {}
        throw new Error(msg);
    }

    const data = await response.json();
    const result = JSON.parse(data.response);
    
    // Normalize to UPPERCASE as safety
    const upper = (val: any) => (typeof val === 'string' ? val.trim().toUpperCase() : '');

    return {
        richiestaIntervento: upper(result.richiestaIntervento),
        data: upper(result.data),
        cliente: upper(result.cliente),
        ubicazione: upper(result.ubicazione),
        strumentoDaRiparare: upper(result.strumentoDaRiparare),
        tipoDiAttivitaGuasto: upper(result.tipoDiAttivitaGuasto),
        tecnico: upper(result.tecnico)
    };
  } catch (error) {
    console.error('Ollama extraction error:', error);
    throw error;
  }
}
