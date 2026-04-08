#!/usr/bin/env python3
import sys
import json
import openpyxl
from openpyxl.styles import PatternFill, Font
from openpyxl.utils import column_index_from_string

def get_column_index(headers, column_name):
    """Trova l'indice della colonna con nome specifico (case-insensitive, gestisce varianti)."""
    column_name_clean = column_name.strip().upper().replace('.', '').replace(' ', '').replace('\n', '')
    
    for idx, h in enumerate(headers):
        if h:
            header_clean = str(h).strip().upper().replace('.', '').replace(' ', '').replace('\n', '')
            if header_clean == column_name_clean:
                return idx + 1
            if column_name_clean in header_clean or header_clean in column_name_clean:
                return idx + 1
    return None

def copy_row_formatting(source_row, target_row, ws):
    """Copia la formattazione da una riga sorgente a una riga destinazione."""
    for source_cell, target_cell in zip(source_row, target_row):
        if source_cell.has_style:
            target_cell.font = source_cell.font.copy()
            target_cell.border = source_cell.border.copy()
            target_cell.alignment = source_cell.alignment.copy()
            target_cell.number_format = source_cell.number_format
            target_cell.protection = source_cell.protection.copy()
            if source_cell.fill and source_cell.fill.fill_type:
                target_cell.fill = source_cell.fill.copy()

def main():
    if len(sys.argv) != 4:
        print("Usage: save_sterlink.py <json> <input.xlsx> <output.xlsx>", file=sys.stderr)
        sys.exit(1)

    json_path, in_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(json_path, 'r', encoding='utf-8') as f:
        payload = json.load(f)
    
    current_data = payload.get('current_data', [])
    dynamic_cols = payload.get('dynamic_cols')
    original_rows_count = payload.get('original_rows_count')

    try:
        wb = openpyxl.load_workbook(in_path)
    except Exception as e:
        print(f"Error loading workbook: {e}", file=sys.stderr)
        sys.exit(1)
    
    ws = wb.active # Sterlink usually has one main sheet

    if not dynamic_cols:
        if current_data:
            dynamic_cols = [k for k in current_data[0].keys() if not k.startswith('_')]
        else:
            raise ValueError("No columns provided")

    header_cells = list(ws.iter_rows(min_row=1, max_row=1, values_only=True))[0]
    headers = [str(h).strip() if h else '' for h in header_cells]
    col_map = {h: idx+1 for idx, h in enumerate(headers) if h}

    # ID colonna per Sterlink: NUMERO CHECKLIST
    id_col_idx = get_column_index(headers, 'NUMERO CHECKLIST')
    if id_col_idx is None:
        # Fallback to SERIALE if NUMERO CHECKLIST not found, but user asked for NUMERO CHECKLIST
        id_col_idx = get_column_index(headers, 'SERIALE')
        if id_col_idx is None:
            raise ValueError("Colonna 'NUMERO CHECKLIST' o 'SERIALE' non trovata nel file")

    # Mappa dei valori ID esistenti -> numero riga nel foglio
    existing_keys = {}
    example_row = None
    for r_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=False), start=2):
        if id_col_idx <= len(row):
            key_cell = row[id_col_idx-1]
            if key_cell.value is not None:
                key_val = key_cell.value
                # Normalize numeric IDs
                if isinstance(key_val, float) and key_val.is_integer():
                    key_val = int(key_val)
                key_str = str(key_val).strip()
                if key_str:
                    existing_keys[key_str] = r_idx
                    if example_row is None:
                        example_row = row

    # Trova il nome esatto della colonna ID nelle dynamic_cols
    id_col_name = next((col for col in dynamic_cols if 'NUMERO' in col.upper() and 'CHECKLIST' in col.upper()), None)
    if not id_col_name:
        id_col_name = next((col for col in dynamic_cols if 'SERIALE' in col.upper()), None)

    # Raccogli ID delle righe correnti per individuare eliminazioni
    current_ids = set()
    for row in current_data:
        if row.get('_empty'):
            continue
        id_val = row.get(id_col_name) if id_col_name else None
        if id_val is not None:
            if isinstance(id_val, float) and id_val.is_integer():
                id_val = int(id_val)
            current_ids.add(str(id_val).strip())

    # Identifica righe da eliminare
    rows_to_delete = []
    for id_str, r_idx in existing_keys.items():
        if id_str not in current_ids:
            rows_to_delete.append(r_idx)

    # Processa le righe correnti
    for row in current_data:
        if row.get('_empty'):
            continue

        id_val = row.get(id_col_name) if id_col_name else None
        if isinstance(id_val, float) and id_val.is_integer():
            id_val = int(id_val)
        
        target_row = None
        key_str = str(id_val).strip() if id_val is not None else None
        
        if key_str and key_str in existing_keys:
            r = existing_keys[key_str]
            for col in dynamic_cols:
                if col in col_map:
                    ws.cell(row=r, column=col_map[col], value=row.get(col))
            target_row = ws[r]
        else:
            # Nuova riga
            r = ws.max_row + 1
            for col in dynamic_cols:
                if col in col_map:
                    ws.cell(row=r, column=col_map[col], value=row.get(col))
            target_row = ws[r]
            if example_row:
                copy_row_formatting(example_row, target_row, ws)

    # Elimina le righe rimosse
    rows_to_delete.sort(reverse=True)
    for r_idx in rows_to_delete:
        try:
            ws.delete_rows(r_idx)
        except Exception as e:
            print(f"Warning: could not delete row {r_idx}: {e}", file=sys.stderr)

    wb.save(out_path)
    print(f"Successfully saved to {out_path}")

if __name__ == '__main__':
    main()
