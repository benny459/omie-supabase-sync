#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📥 IMPORT — SmartSuite → approval.approvals
─────────────────────────────────────────────────────────────────────────────
Lê snapshots em /tmp/smartsuite_snapshot/ (gerados pelo dry-run) e escreve em
approval.approvals via PostgREST (mesma base que os outros importers usam).

Filtros:
  • Skip 187 órfãos (Smart tem PC.Numero sem correspondência em Omie SF)
  • Skip 8 registros-perdedores de colisão (já apagados do Smart, redundância)
  • Skip linhas Avulsos/Projetos sem PC.Numero (itens-irmãos do mesmo PV)
  • Dedup within-table por pc_num (keep most-recent last_updated)

Env vars necessárias:
  SUPA_URL (default: https://zodflkfdnjhtwcjutbjl.supabase.co)
  SUPA_KEY (service_role; fallback lê de cmds.sh do repo)
═════════════════════════════════════════════════════════════════════════════
"""
import json, os, sys, re, time
from datetime import datetime
import urllib.request, urllib.error, urllib.parse

SNAP  = '/tmp/smartsuite_snapshot'
EMPRESA = 'SF'
BATCH = 200  # Nº de rows por request PostgREST

SUPA_URL = os.environ.get('SUPA_URL', 'https://zodflkfdnjhtwcjutbjl.supabase.co').rstrip('/')
SUPA_KEY = os.environ.get('SUPA_KEY')
if not SUPA_KEY:
    # fallback: lê do cmds.sh
    try:
        with open(os.path.join(os.path.dirname(__file__), '..', 'cmds.sh')) as f:
            m = re.search(r'SUPA_KEY="([^"]+)"', f.read())
            if m: SUPA_KEY = m.group(1)
    except Exception:
        pass
if not SUPA_KEY:
    sys.exit('❌ SUPA_KEY não definida (env var ou cmds.sh)')

# ── Mapas de tradução ──────────────────────────────────────────────────────
STATUS_MAP = {
    'KM0AI': 'APROVADO', 'SRN0f': 'NAO_APROVADO', 'hEqQz': 'PRE_SELECAO',
    'cNYLj': 'N_A', 'aS5Hh': 'REJEITADO_VALIDADE', '6vKa8': 'REJEITADO_VALIDADE',
    'wU5kx': 'REJEITADO_VALIDADE', 'OamXK': 'CANCELAR_PEDIDO',
    'WV99j': 'APROVADO_FAT_DIRETO',
}
COMPRADOR_MAP = {'ready_for_review': 'Paulo', 'complete': 'Erick'}
PRIORIDADE_MAP = {'tiyjO': '0', 'wcoZI': '1', 'Xkk1D': '2'}
MT_STATUS_MAP = {'XPWlp': 'Faturado pelo Fornecedor', 'AtWQZ': 'Recebido', 'yr7tf': 'Conferido'}
MATERIAL_ENVIADO_MAP = {'backlog': 'Não', 'x9qN0': 'Sim - remessa', 'bXy8K': 'Sim - faturado'}
STATUS_MATERIAL_MAP = {
    'Ivf7s': '0.Não há material', 'PYpNB': '1.Cotação',
    '1tw6a': '2.Aguardando Aprovação', 'NAsY7': '3. Aprovado Aguardando Pagam.',
    'p3O5T': '4. Aprovado Aguardando Chegada', '3qKxH': '5. Em estoque',
    '6vCfm': '6. Estoque - Faturar', 'aIxRJ': '7.Enviado c/NF',
    'oxkQA': '8.Enviado simples remessa', 'vZNDW': '7. Enviado e Faturado (SR)',
    'kJFFv': '8. Enviado',
}

SLUGS = {
    'avulsos': {'pc_num':'s670dc5f17','status':'sce8327bbb','aprovador':'s8dfb4a40b',
                'aprovado_em':'s98eb6904f','valor_aprovado':'scdff03d9d',
                'valor_aprovado_audit':'s6aa9f8ac0','aprovar_ate':'s394a485bc',
                'justificativa':'s2ee658402','comprador':'s0d4c98840',
                'status_material':'s47e7b73ae','rc_numero':'s3d4aaf144',
                'rc_descricao':'sf6383dg','rc_custo':'s66b865956',
                'rc_custo_total':'sc91f74641','mt_status':'s7d92bld',
                'mt_emissao':'s1866928ef','mt_recebimento':'syzle95a',
                'mt_nf':'sb51b79ee5','pc_pago':'sa9a2f10a4','material_enviado':'sb063e3bab'},
    'projetos': {'pc_num':'s670dc5f17','status':'sce8327bbb','aprovador':'s8dfb4a40b',
                'aprovado_em':'s98eb6904f','valor_aprovado':'scdff03d9d',
                'valor_aprovado_audit':'s6aa9f8ac0','aprovar_ate':'s394a485bc',
                'justificativa':'s2ee658402','comprador':'s0d4c98840',
                'status_material':'s47e7b73ae','rc_numero':'s3d4aaf144',
                'rc_descricao':'sf6383dg','rc_custo':'s66b865956',
                'rc_custo_total':'sf13db4835','mt_status':'s7d92bld',
                'mt_emissao':'s1866928ef','mt_recebimento':'syzle95a',
                'mt_nf':'sb51b79ee5','pc_pago':'sa9a2f10a4','material_enviado':'sb063e3bab'},
    'pcs': {'pc_num':'title','status':'sce8327bbb','aprovador':'s8dfb4a40b',
            'aprovado_em':'s98eb6904f','valor_aprovado':'s0efb96120',
            'aprovar_ate':None,'justificativa':'s2ee658402',
            'comprador':'s0d0ccf8ea','prioridade':'s38f01c3ed',
            'status_material':'s47e7b73ae','rc_numero':'s3d4aaf144',
            'rc_descricao':'sf6383dg','mt_emissao':'s412680e66',
            'mt_recebimento':'s987a3e9ab','mt_nf':'sa6772185e',
            'pc_pago':'sa9a2f10a4','material_enviado':'sb063e3bab'},
}
CUSTOM_SLUGS = [
    's45deebc11','s40eb44451','sf655fd134','s2de66f7c2','s5ce09ac98',
    's1cd8f5240','s2d248cea5','s72512058c','s1ab47c85b',
    's242fb18ba','s4b87bk9','sf93f06414','sdehbc9j','s0b34685a6','s83d610878',
    'sffa361729','s424b8f7f9','s2c70d8927','s70aa3b8ae',
    'sbab94f35e','s88a2e1990','sdfcedb0fa','s49f2dbc2e','sc10666bff','s52132a410',
    's7f7561ca4','sb9082e2f2','scd5745327','sb050a8a1c',
    'sb8bd04e4f','sb9bb1d2fe','s1abb0d597',
]

# ── Helpers de extração ────────────────────────────────────────────────────
def to_num(v):
    if v is None or v == '': return None
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        try: return float(v.replace(',', '.'))
        except ValueError: return None
    if isinstance(v, dict):
        for k in ('value','number'):
            if k in v:
                try: return float(v[k])
                except: pass
    return None

def to_date(v):
    if not v: return None
    if isinstance(v, dict):
        d = v.get('date')
        if d: return d[:10]
        fd = v.get('from_date', {}) or {}
        td = v.get('to_date', {}) or {}
        return (td.get('date') or fd.get('date') or '')[:10] or None
    if isinstance(v, str): return v[:10]
    return None

def to_ts(v):
    if not v: return None
    if isinstance(v, dict):
        return v.get('date') or v.get('on')
    if isinstance(v, str): return v
    return None

def choice_value(v):
    if isinstance(v, dict): return v.get('value')
    if isinstance(v, str):  return v
    return None

def extract_pc_num(raw, table):
    if table == 'pcs':
        v = raw.get('title')
        return v.strip() if isinstance(v, str) and v.strip() else None
    v = raw.get(SLUGS[table]['pc_num'])
    if isinstance(v, str) and v.strip(): return v.strip()
    if isinstance(v, list) and v:
        it = v[0]
        if isinstance(it, dict):
            for k in ('title','label','display_value'):
                if it.get(k): return str(it[k]).strip() or None
        elif isinstance(it, str): return it.strip() or None
    return None

def extract_aprovador_email(v, user_map):
    if not v: return None
    ids = v if isinstance(v, list) else [v]
    for uid in ids:
        if not isinstance(uid, str): continue
        u = user_map.get(uid)
        if u and u.get('email'): return u['email']
    return None

def last_updated_ts(r):
    lu = r.get('last_updated', {})
    if isinstance(lu, dict): return lu.get('on') or ''
    return str(lu or '')

# ── Carrega inputs ─────────────────────────────────────────────────────────
orphans = set(json.load(open(f'{SNAP}/orphans.json')))
user_map = json.load(open(f'{SNAP}/user_map.json'))
deleted_ids = {
    '679bd37861f688f6107fe08d','696d3e74bd62ebcdef2a288a','67aca276afea6785843f22c9',
    '682f4103c329905ff1aced85','696d3e76bd62ebcdef2a28c3','696fa3f35dc8136b9ee53665',
    '699f264101ec64aa47c14a7c','6978bb87acd0105bf7990030',
}

# ── Helpers HTTP (PostgREST) ───────────────────────────────────────────────
def pg_request(method, path, body=None, profile='approval', params=None, prefer=None):
    url = f"{SUPA_URL}{path}"
    if params: url += '?' + urllib.parse.urlencode(params, safe=',()')
    headers = {
        'apikey': SUPA_KEY,
        'Authorization': f'Bearer {SUPA_KEY}',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    }
    if profile: headers['Accept-Profile'] = profile
    if profile and method in ('POST','PATCH','DELETE'): headers['Content-Profile'] = profile
    if prefer: headers['Prefer'] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', errors='replace')

# ── Lookup: pc_num → ncod_ped pra SF (uma chamada só, em chunks) ───────────
print('▶ Fetching cnumero→ncod_ped map from orders.pedidos_compra (SF)...')
# Pega só PC numbers únicos de todos os 3 snapshots
all_pc_nums = set()
for t in ('avulsos','projetos','pcs'):
    for r in json.load(open(f'{SNAP}/{t}_extracted.json')):
        if r['pc_numero'] and r['pc_numero'] not in orphans:
            all_pc_nums.add(r['pc_numero'])
print(f'  {len(all_pc_nums)} pc_nums únicos a consultar')

# Vai em batches (PostgREST limit URL)
pc_to_ncod = {}
pc_list = sorted(all_pc_nums)
URL_BATCH = 200
for i in range(0, len(pc_list), URL_BATCH):
    batch = pc_list[i:i+URL_BATCH]
    vals = ','.join(f'"{p}"' for p in batch)
    status, body = pg_request('GET', '/rest/v1/pedidos_compra',
        profile='orders',
        params={'select': 'cnumero,ncod_ped', 'empresa': 'eq.SF',
                'cnumero': f'in.({vals})'})
    if status != 200:
        sys.exit(f'ERRO lookup: {status} {body[:300]}')
    data = json.loads(body)
    # múltiplas linhas por cnumero (1 por item do PC); pega MIN ncod_ped
    for row in data:
        cn = row['cnumero']
        nc = row['ncod_ped']
        if cn not in pc_to_ncod or nc < pc_to_ncod[cn]:
            pc_to_ncod[cn] = nc
print(f'  {len(pc_to_ncod)} pc_nums encontrados em Omie SF')

# ── Constrói os rows ───────────────────────────────────────────────────────
rows = []
stats = {'total_raw':0,'skipped_deleted':0,'skipped_no_pc':0,'skipped_orphan':0,
         'skipped_within_table_dup':0,'skipped_no_omie_match':0,
         'prepared':0,'by_table':{},'by_status':{}}

for table in ('avulsos','projetos','pcs'):
    raw_list = json.load(open(f'{SNAP}/{table}.json'))
    seen = {}
    for r in raw_list: seen[r['id']] = r
    uniq = list(seen.values())
    stats['total_raw'] += len(uniq)
    slg = SLUGS[table]

    by_pc = {}
    for r in uniq:
        if r['id'] in deleted_ids:
            stats['skipped_deleted'] += 1; continue
        pc_num = extract_pc_num(r, table)
        if not pc_num:
            stats['skipped_no_pc'] += 1; continue
        if pc_num in orphans:
            stats['skipped_orphan'] += 1; continue
        cur = by_pc.get(pc_num)
        if cur is None or last_updated_ts(r) > last_updated_ts(cur):
            if cur is not None: stats['skipped_within_table_dup'] += 1
            by_pc[pc_num] = r
        else:
            stats['skipped_within_table_dup'] += 1

    for pc_num, r in by_pc.items():
        ncod_ped = pc_to_ncod.get(pc_num)
        if ncod_ped is None:
            stats['skipped_no_omie_match'] += 1; continue

        status_code = choice_value(r.get(slg['status']))
        status = STATUS_MAP.get(status_code, 'PENDENTE')

        custom = {}
        for cs in CUSTOM_SLUGS:
            v = r.get(cs)
            if v in (None, '', [], {}): continue
            if isinstance(v, dict):
                if set(v.keys()) == {'value','updated_on'}: custom[cs] = v.get('value')
                elif 'date' in v: custom[cs] = to_date(v)
                elif 'from_date' in v or 'to_date' in v: custom[cs] = to_date(v)
                elif 'text' in v: custom[cs] = v.get('text')
                elif 'value' in v and len(v) <= 3: custom[cs] = v.get('value')
                else: custom[cs] = v
            else: custom[cs] = v

        row = {
            'empresa': EMPRESA,
            'ncod_ped': ncod_ped,
            'modulo': table,
            'status': status,
            'aprovador_email': extract_aprovador_email(r.get(slg['aprovador']), user_map),
            'aprovado_em': to_ts(r.get(slg['aprovado_em'])),
            'valor_aprovado': to_num(r.get(slg['valor_aprovado'])),
            'valor_aprovado_audit': to_num(r.get(slg.get('valor_aprovado_audit'))) if slg.get('valor_aprovado_audit') else None,
            'aprovar_ate': to_date(r.get(slg['aprovar_ate'])) if slg.get('aprovar_ate') else None,
            'prioridade': PRIORIDADE_MAP.get(choice_value(r.get(slg.get('prioridade')))) if slg.get('prioridade') else None,
            'justificativa': r.get(slg['justificativa']) if isinstance(r.get(slg['justificativa']), str) else None,
            'comprador': COMPRADOR_MAP.get(choice_value(r.get(slg['comprador']))),
            'status_material': STATUS_MATERIAL_MAP.get(choice_value(r.get(slg['status_material']))),
            'rc_numero': to_num(r.get(slg['rc_numero'])),
            'rc_descricao': r.get(slg['rc_descricao']) if isinstance(r.get(slg['rc_descricao']), str) else None,
            'rc_custo': to_num(r.get(slg.get('rc_custo'))) if slg.get('rc_custo') else None,
            'rc_custo_total': to_num(r.get(slg.get('rc_custo_total'))) if slg.get('rc_custo_total') else None,
            'mt_status_fornecimento': MT_STATUS_MAP.get(choice_value(r.get(slg.get('mt_status')))) if slg.get('mt_status') else None,
            'mt_data_emissao_nf': to_date(r.get(slg.get('mt_emissao'))) if slg.get('mt_emissao') else None,
            'mt_data_recebimento_nf': to_date(r.get(slg.get('mt_recebimento'))) if slg.get('mt_recebimento') else None,
            'mt_nf_fornecedor': r.get(slg.get('mt_nf')) if slg.get('mt_nf') and isinstance(r.get(slg.get('mt_nf')), (str, int, float)) else None,
            'pc_pago': r.get(slg['pc_pago']) if isinstance(r.get(slg['pc_pago']), bool) else None,
            'material_enviado': MATERIAL_ENVIADO_MAP.get(choice_value(r.get(slg['material_enviado']))),
            'custom_fields': custom,
            'source': 'smartsuite',
            'smart_id': r['id'],
            'smart_tabela': table,
            'imported_at': datetime.utcnow().isoformat() + 'Z',
        }
        # Normaliza pra tipos JSON-serializáveis
        if row['mt_nf_fornecedor'] is not None:
            row['mt_nf_fornecedor'] = str(row['mt_nf_fornecedor'])
        rows.append(row)
        stats['prepared'] += 1
        stats['by_table'][table] = stats['by_table'].get(table, 0) + 1
        stats['by_status'][status] = stats['by_status'].get(status, 0) + 1

print('▶ Stats preparação:')
print(json.dumps(stats, indent=2, ensure_ascii=False))

# ── Dedup cross-table por (empresa, ncod_ped) ─────────────────────────────
# Depois do mapping, pode haver 2 módulos apontando pro mesmo ncod_ped
# (se houve colisão em Omie que não pegamos). Mantém o mais recente.
dedup_by_pk = {}
dup_cross = 0
for row in rows:
    pk = (row['empresa'], row['ncod_ped'])
    cur = dedup_by_pk.get(pk)
    if cur is None or row['imported_at'] > cur['imported_at']:
        if cur is not None: dup_cross += 1
        dedup_by_pk[pk] = row
    else:
        dup_cross += 1
rows = list(dedup_by_pk.values())
stats['deduped_by_pk'] = dup_cross
print(f'▶ Após dedup cross-table por (empresa,ncod_ped): {len(rows)} rows ({dup_cross} duplicatas removidas)')

# ── Escreve em approval.approvals via PostgREST ────────────────────────────
print(f'▶ Inserindo {len(rows)} rows em approval.approvals...')
total_ok = 0
total_fail = 0
for i in range(0, len(rows), BATCH):
    batch = rows[i:i+BATCH]
    status, body = pg_request(
        'POST', '/rest/v1/approvals',
        body=batch, profile='approval',
        prefer='resolution=ignore-duplicates,return=minimal'
    )
    if 200 <= status < 300:
        total_ok += len(batch)
        print(f'  [{i+len(batch):4}/{len(rows)}] HTTP {status} OK')
    else:
        total_fail += len(batch)
        print(f'  [{i+len(batch):4}/{len(rows)}] HTTP {status} FAIL: {body[:500]}')
    time.sleep(0.15)

print()
print(f'✅ Concluído: {total_ok} OK, {total_fail} FAIL (de {len(rows)} rows)')
