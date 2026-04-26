#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📥 IMPORT — RC (Requisição de Compra) via planilha Excel (.xlsx)
─────────────────────────────────────────────────────────────────────────────
Lê um .xlsx, detecta header, mapeia colunas-chave e faz UPDATE nos campos
rc_* de approval.approvals via PostgREST.

Formatos suportados:
  (A) Planilha estilo Omie "Vendas e NF-e → Lista dos Produtos"
      Colunas: Produto, Descrição do Produto, Quantidade,
               Preço Unitário de Venda, Valor Total do Item, Vinculado à
  (B) Planilha manual com colunas: PC.Numero, RC.Numero, RC.Descrição,
      RC.Custo, RC.Custo Total

Uso:
  # dry-run (não grava):
  python3 scripts/import_rc_from_xlsx.py <arquivo.xlsx>
  # grava mesmo:
  python3 scripts/import_rc_from_xlsx.py <arquivo.xlsx> --apply

Env vars:
  SUPA_URL (default: https://zodflkfdnjhtwcjutbjl.supabase.co)
  SUPA_KEY (service_role; fallback lê de cmds.sh do repo)

Status: ESTRUTURA PRONTA. Quando tiver a planilha de RC real, rode dry-run
pra conferir o match de colunas antes de usar --apply.
═════════════════════════════════════════════════════════════════════════════
"""
import json, os, sys, re, zipfile
from decimal import Decimal, InvalidOperation
import xml.etree.ElementTree as ET
import urllib.request, urllib.parse, urllib.error

NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
NS = {'s': NS_MAIN}

SUPA_URL = os.environ.get('SUPA_URL', 'https://zodflkfdnjhtwcjutbjl.supabase.co').rstrip('/')
SUPA_KEY = os.environ.get('SUPA_KEY')
if not SUPA_KEY:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        with open(os.path.join(repo_root, 'cmds.sh')) as f:
            m = re.search(r'SUPA_KEY="([^"]+)"', f.read())
            if m: SUPA_KEY = m.group(1)
    except Exception: pass

# ── XLSX reader (stdlib only) ──────────────────────────────────────────────
def col_index(ref):
    letters = ''.join(c for c in ref if c.isalpha())
    n = 0
    for c in letters: n = n*26 + (ord(c.upper()) - 64)
    return n - 1

def read_xlsx(path, sheet='sheet1'):
    """Retorna lista de dicts col_index→value da primeira aba."""
    z = zipfile.ZipFile(path)
    # shared strings
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml').decode('utf-8'))
        for si in root.findall('s:si', NS):
            shared.append(''.join(t.text or '' for t in si.findall('.//s:t', NS)))
    # first sheet
    sheet_path = f'xl/worksheets/{sheet}.xml'
    if sheet_path not in z.namelist():
        # fallback: primeiro xl/worksheets/*.xml
        sheet_path = next((n for n in z.namelist() if n.startswith('xl/worksheets/') and n.endswith('.xml')), None)
        if not sheet_path: raise RuntimeError('sheet não encontrado')
    root = ET.fromstring(z.read(sheet_path).decode('utf-8'))
    rows = []
    for row in root.find('s:sheetData', NS).findall('s:row', NS):
        cells = {}
        for c in row.findall('s:c', NS):
            ref = c.get('r'); t = c.get('t')
            v = c.find('s:v', NS)
            val = v.text if v is not None else ''
            if t == 's' and val.isdigit():
                val = shared[int(val)]
            elif t == 'inlineStr':
                isv = c.find('s:is/s:t', NS)
                val = isv.text if isv is not None else ''
            elif t == 'b':
                val = (val == '1')
            cells[col_index(ref)] = val
        if cells: rows.append(cells)
    return rows

# ── Detector de header ────────────────────────────────────────────────────
def normalize(s):
    if s is None: return ''
    return re.sub(r'\s+', ' ', str(s).strip().lower())

# Sinônimos → campo canônico
HEADER_ALIASES = {
    'pc_num': ['pc.numero','pc numero','pc nº','pc #','numero do pc','nº pc'],
    'rc_numero': ['rc.numero','rc numero','rc nº','numero da rc','nº rc'],
    'rc_descricao': ['rc.descrição','rc descricao','descrição da rc','descricao da rc',
                     'descrição do produto','descricao do produto','descrição','descricao'],
    'rc_custo': ['rc.custo','rc custo unitário','rc custo unit','custo unitário',
                 'preço unitário de venda','preco unitario de venda',
                 'preço unitário','preco unitario'],
    'rc_custo_total': ['rc.custo total','custo total','valor total','valor total do item'],
    'produto_codigo': ['produto','código do produto','codigo do produto','cod produto'],
    'quantidade': ['quantidade','qtd','qtde'],
    'vinculado': ['vinculado à','vinculado','vinculado a','pedido origem','nota fiscal'],
}

def detect_header_row(rows, scan_n=10):
    """Varre as primeiras N linhas procurando a que tem mais matches de header."""
    best = (-1, 0, {})
    for i in range(min(scan_n, len(rows))):
        row = rows[i]
        col_map = {}
        hits = 0
        for col_idx, val in row.items():
            norm = normalize(val)
            for field, aliases in HEADER_ALIASES.items():
                if norm in aliases or any(a in norm for a in aliases):
                    col_map[field] = col_idx
                    hits += 1
                    break
        if hits > best[1]:
            best = (i, hits, col_map)
    return best  # (row_idx, hit_count, {field: col_idx})

# ── Parse numeric "1.234,56" ou "1,234.56" ou "12.34" ─────────────────────
def parse_num(v):
    if v is None or v == '': return None
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip()
    # BR style: 1.234,56
    if re.match(r'^-?[\d.]+,\d+$', s):
        s = s.replace('.', '').replace(',', '.')
    # US/plain style: 1,234.56 ou 12.34
    else:
        s = s.replace(',', '') if s.count('.') <= 1 else s.replace(',', '')
    try: return float(s)
    except (ValueError, InvalidOperation): return None

# ── PostgREST helper ──────────────────────────────────────────────────────
def pg_patch(table, filter_qs, body, profile='approval'):
    url = f'{SUPA_URL}/rest/v1/{table}?{filter_qs}'
    headers = {
        'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
        'Content-Type': 'application/json',
        'Accept-Profile': profile, 'Content-Profile': profile,
        'Prefer': 'return=minimal',
    }
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method='PATCH')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# ── Main ──────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        sys.exit('uso: import_rc_from_xlsx.py <arquivo.xlsx> [--apply]')
    path = sys.argv[1]
    apply_mode = '--apply' in sys.argv[2:]

    rows = read_xlsx(path)
    hdr_row, hits, col_map = detect_header_row(rows)
    if hits < 2:
        sys.exit(f'❌ Não reconheci o header. Colunas vistas:\n'
                 + '\n'.join(f'  r{i+1}: {dict(sorted(r.items()))}' for i, r in enumerate(rows[:5])))
    print(f'▶ Header detectado em r{hdr_row+1} ({hits} matches)')
    for f, c in col_map.items(): print(f'    {f:15} → col{c}')

    # Validação mínima: precisa de pc_num ou rc_numero pra casar
    if 'pc_num' not in col_map and 'rc_numero' not in col_map:
        sys.exit('❌ A planilha precisa de pelo menos uma coluna "PC.Numero" OU "RC.Numero" pra casar com approval.approvals')

    records = []
    for i, r in enumerate(rows[hdr_row+1:], start=hdr_row+2):
        rec = {}
        for f, c in col_map.items():
            rec[f] = r.get(c)
        # Skip linha vazia
        if not any(rec.values()): continue
        # Normaliza numéricos
        for f in ('rc_numero','rc_custo','rc_custo_total','quantidade'):
            if f in rec: rec[f] = parse_num(rec[f])
        rec['_row'] = i
        records.append(rec)

    print(f'\n▶ {len(records)} linhas de dados lidas')
    print('▶ Primeiras 5 linhas parseadas:')
    for rec in records[:5]:
        print(f'  {rec}')

    if not apply_mode:
        print('\n[dry-run] Rodando sem --apply. Nenhuma alteração feita no banco.')
        print('Ajuste o mapeamento em HEADER_ALIASES se faltou coluna, e rode de novo.')
        return

    # UPDATE em approval.approvals por pc_numero (precisa do JOIN com orders.pedidos_compra pra ncod_ped)
    # Como PostgREST não faz JOIN em UPDATE, a gente puxa o ncod_ped primeiro pelos pc_nums
    if 'pc_num' in col_map:
        pc_nums = list({str(r['pc_num']).strip() for r in records if r.get('pc_num')})
        print(f'\n▶ Buscando ncod_ped pra {len(pc_nums)} PCs...')
        pc_to_ncod = {}
        for i in range(0, len(pc_nums), 200):
            batch = pc_nums[i:i+200]
            vals = ','.join(f'"{p}"' for p in batch)
            url = (f'{SUPA_URL}/rest/v1/pedidos_compra?'
                   f'select=cnumero,ncod_ped&empresa=eq.SF&cnumero=in.({vals})')
            req = urllib.request.Request(url, headers={
                'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}',
                'Accept-Profile': 'orders'})
            with urllib.request.urlopen(req, timeout=30) as r:
                for row in json.loads(r.read()):
                    cn, nc = row['cnumero'], row['ncod_ped']
                    if cn not in pc_to_ncod or nc < pc_to_ncod[cn]:
                        pc_to_ncod[cn] = nc

        ok = fail = skipped = 0
        for rec in records:
            pc = str(rec.get('pc_num') or '').strip()
            ncod = pc_to_ncod.get(pc)
            if ncod is None:
                skipped += 1; continue
            body = {}
            if 'rc_numero' in rec: body['rc_numero'] = rec['rc_numero']
            if 'rc_descricao' in rec: body['rc_descricao'] = rec.get('rc_descricao')
            if 'rc_custo' in rec: body['rc_custo'] = rec['rc_custo']
            if 'rc_custo_total' in rec: body['rc_custo_total'] = rec['rc_custo_total']
            if not body: continue
            status, resp = pg_patch('approvals',
                f'empresa=eq.SF&ncod_ped=eq.{ncod}', body)
            if 200 <= status < 300: ok += 1
            else: fail += 1; print(f'  FAIL r{rec["_row"]} pc={pc}: {status} {resp[:120]}')
        print(f'\n✅ UPDATE concluído: {ok} OK, {fail} FAIL, {skipped} PCs sem match em Omie')
    else:
        print('⚠️  Sem coluna PC.Numero — update direto por rc_numero ainda não implementado.')
        print('    (Se tiver só rc_numero, precisamos decidir se atualiza todos os registros com esse RC.)')

if __name__ == '__main__':
    main()
