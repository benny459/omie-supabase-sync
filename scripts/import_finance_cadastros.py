#!/usr/bin/env python3
"""
Finance Cadastros -- Omie -> Supabase  (weekly combined script)
Combines multiple cadastro importers into a single script:

  1. Clientes       /geral/clientes/           | ListarClientes
  2. Categorias     /geral/categorias/         | ListarCategorias
  3. Projetos       /geral/projetos/           | ListarProjetos
  4. ContasCorrentes /geral/contacorrente/     | ListarContasCorrentes
  5. Empresas       /geral/empresas/           | ListarEmpresas        (single-key SF)
  6. Parcelas       /geral/parcelas/           | ListarParcelas        (single-key SF)
  7. LancamentosCC  /financas/contacorrentelancamentos/ | ListarLancCC (nPagina/nRegPorPagina)
  8. Auxiliares     (7 small tables: bandeiras, origens, finalidades, DRE, tiposCC, tiposDoc, bancos)

Tabelas: finance.*
Freq:    Semanal (domingo)
"""
import sys, time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_omie, fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror, upsert_with_tracking,
)

SCHEMA = "finance"


# ═════════════════════════════════════════════════════════════════════════════
# 1. CLIENTES
# ═════════════════════════════════════════════════════════════════════════════

def import_clientes():
    print("\n" + "=" * 60)
    print("  CLIENTES")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/clientes/"

    def map_cliente(c, sigla):
        info = c.get("info") or {}
        tags_list = c.get("tags") or []
        tags_str = ", ".join(
            (t.get("tag") if isinstance(t, dict) else str(t)) for t in tags_list
        ) if isinstance(tags_list, list) else ""

        return {
            "empresa": sigla,
            "codigo_cliente_omie": to_int(c.get("codigo_cliente_omie")),
            "codigo_cliente_integracao": c.get("codigo_cliente_integracao") or None,
            "razao_social": c.get("razao_social") or None,
            "nome_fantasia": c.get("nome_fantasia") or None,
            "cnpj_cpf": c.get("cnpj_cpf") or None,
            "contato": c.get("contato") or None,
            "endereco": c.get("endereco") or None,
            "endereco_numero": c.get("endereco_numero") or None,
            "complemento": c.get("complemento") or None,
            "bairro": c.get("bairro") or None,
            "cidade": c.get("cidade") or None,
            "estado": c.get("estado") or None,
            "cep": c.get("cep") or None,
            "telefone1_ddd": c.get("telefone1_ddd") or None,
            "telefone1_numero": c.get("telefone1_numero") or None,
            "telefone2_ddd": c.get("telefone2_ddd") or None,
            "telefone2_numero": c.get("telefone2_numero") or None,
            "fax_ddd": c.get("fax_ddd") or None,
            "fax_numero": c.get("fax_numero") or None,
            "email": c.get("email") or None,
            "homepage": c.get("homepage") or None,
            "inscricao_estadual": c.get("inscricao_estadual") or None,
            "inscricao_municipal": c.get("inscricao_municipal") or None,
            "inscricao_suframa": c.get("inscricao_suframa") or None,
            "pessoa_fisica": c.get("pessoa_fisica") or None,
            "optante_simples_nacional": c.get("optante_simples_nacional") or None,
            "contribuinte": c.get("contribuinte") or None,
            "produtor_rural": c.get("produtor_rural") or None,
            "inativo": c.get("inativo") or None,
            "importado_api": c.get("importado_api") or None,
            "cidade_ibge": c.get("cidade_ibge") or None,
            "tags": tags_str or None,
            "info_d_inc": info.get("dInc") or None,
            "info_h_inc": info.get("hInc") or None,
            "info_u_inc": info.get("uInc") or None,
            "info_d_alt": info.get("dAlt") or None,
            "info_h_alt": info.get("hAlt") or None,
            "info_u_alt": info.get("uAlt") or None,
        }

    total = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla): continue
        inicio = time.time()
        try:
            items = fetch_omie_paginated(
                url=URL, call="ListarClientes", sigla=sigla,
                list_field="clientes_cadastro", page_size=100,
                label="Clientes",
            )
            rows = [map_cliente(c, sigla) for c in items]
            rows = [r for r in rows if r["codigo_cliente_omie"]]
            n, ins, upd, bef, aft = upsert_with_tracking(
                SCHEMA, "clientes", rows, "empresa,codigo_cliente_omie", empresa=sigla
            )
            dur = int(time.time() - inicio)
            print(f"   {sigla}: {n} ({ins} new, {upd} upd) {dur}s")
            update_sync_state(f"clientes_{sigla}", sigla, n, modo="FULL",
                              rows_inserted=ins, rows_updated=upd, rows_before=bef, duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(f"clientes_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])
    return total


# ═════════════════════════════════════════════════════════════════════════════
# 2. CATEGORIAS
# ═════════════════════════════════════════════════════════════════════════════

def import_categorias():
    print("\n" + "=" * 60)
    print("  CATEGORIAS (DRE)")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/categorias/"

    def map_cat(c, sigla):
        dre = c.get("dadosDRE") or {}
        return {
            "empresa": sigla,
            "codigo": str(c.get("codigo", "")),
            "descricao": c.get("descricao") or None,
            "descricao_padrao": c.get("descricao_padrao") or None,
            "tipo_categoria": c.get("tipo_categoria") or None,
            "conta_inativa": c.get("conta_inativa") or None,
            "definida_pelo_usuario": c.get("definida_pelo_usuario") or None,
            "id_conta_contabil": c.get("id_conta_contabil") or None,
            "tag_conta_contabil": c.get("tag_conta_contabil") or None,
            "conta_despesa": c.get("conta_despesa") or None,
            "conta_receita": c.get("conta_receita") or None,
            "nao_exibir": c.get("nao_exibir") or None,
            "natureza": c.get("natureza") or None,
            "totalizadora": c.get("totalizadora") or None,
            "transferencia": c.get("transferencia") or None,
            "codigo_dre": c.get("codigo_dre") or None,
            "categoria_superior": c.get("categoria_superior") or None,
            "dre_codigo_dre": dre.get("codigoDRE") or None,
            "dre_descricao_dre": dre.get("descricaoDRE") or None,
            "dre_nao_exibir_dre": dre.get("naoExibirDRE") or None,
            "dre_nivel_dre": dre.get("nivelDRE") or None,
            "dre_sinal_dre": dre.get("sinalDRE") or None,
            "dre_totaliza_dre": dre.get("totalizaDRE") or None,
        }

    total = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla): continue
        inicio = time.time()
        try:
            items = fetch_omie_paginated(
                url=URL, call="ListarCategorias", sigla=sigla,
                list_field="categoria_cadastro", page_size=100,
                label="Categorias",
            )
            rows = [map_cat(c, sigla) for c in items]
            rows = [r for r in rows if r["codigo"]]
            n, ins, upd, bef, aft = upsert_with_tracking(
                SCHEMA, "categorias", rows, "empresa,codigo", empresa=sigla
            )
            dur = int(time.time() - inicio)
            print(f"   {sigla}: {n} ({ins} new, {upd} upd) {dur}s")
            update_sync_state(f"categorias_{sigla}", sigla, n, modo="FULL",
                              rows_inserted=ins, rows_updated=upd, rows_before=bef, duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(f"categorias_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])
    return total


# ═════════════════════════════════════════════════════════════════════════════
# 3. PROJETOS
# ═════════════════════════════════════════════════════════════════════════════

def import_projetos():
    print("\n" + "=" * 60)
    print("  PROJETOS")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/projetos/"

    def map_proj(p, sigla):
        info = p.get("info") or {}
        return {
            "empresa": sigla,
            "codigo": to_int(p.get("codigo")),
            "cod_int": p.get("codInt") or None,
            "nome": p.get("nome") or None,
            "inativo": p.get("inativo") or None,
            "data_inc": info.get("data_inc") or None,
            "hora_inc": info.get("hora_inc") or None,
            "user_inc": info.get("user_inc") or None,
            "data_alt": info.get("data_alt") or None,
            "hora_alt": info.get("hora_alt") or None,
            "user_alt": info.get("user_alt") or None,
        }

    total = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla): continue
        inicio = time.time()
        try:
            items = fetch_omie_paginated(
                url=URL, call="ListarProjetos", sigla=sigla,
                list_field="cadastro", page_size=100,
                label="Projetos",
            )
            rows = [map_proj(p, sigla) for p in items]
            rows = [r for r in rows if r["codigo"]]
            n, ins, upd, bef, aft = upsert_with_tracking(
                SCHEMA, "projetos", rows, "empresa,codigo", empresa=sigla
            )
            dur = int(time.time() - inicio)
            print(f"   {sigla}: {n} ({ins} new, {upd} upd) {dur}s")
            update_sync_state(f"projetos_{sigla}", sigla, n, modo="FULL",
                              rows_inserted=ins, rows_updated=upd, rows_before=bef, duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(f"projetos_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])
    return total


# ═════════════════════════════════════════════════════════════════════════════
# 4. CONTAS CORRENTES
# ═════════════════════════════════════════════════════════════════════════════

def import_contas_correntes():
    print("\n" + "=" * 60)
    print("  CONTAS CORRENTES")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/contacorrente/"

    def map_cc(c, sigla):
        return {
            "empresa": sigla,
            "cod_cc": to_int(c.get("nCodCC")),
            "cod_cc_int": c.get("cCodCCInt") or None,
            "descricao": c.get("descricao") or None,
            "tipo_conta_corrente": c.get("tipo_conta_corrente") or None,
            "codigo_banco": c.get("codigo_banco") or None,
            "codigo_agencia": c.get("codigo_agencia") or None,
            "numero_conta_corrente": c.get("numero_conta_corrente") or None,
            "saldo_inicial": to_float(c.get("saldo_inicial")),
            "saldo_data": c.get("saldo_data") or None,
            "valor_limite": to_float(c.get("valor_limite")),
            "inativo": c.get("inativo") or None,
            "observacao": c.get("observacao") or None,
            "nome_gerente": c.get("nome_gerente") or None,
            "telefone": c.get("telefone") or None,
            "email": c.get("email") or None,
            "data_inc": c.get("data_inc") or None,
            "hora_inc": c.get("hora_inc") or None,
            "user_inc": c.get("user_inc") or None,
            "data_alt": c.get("data_alt") or None,
            "hora_alt": c.get("hora_alt") or None,
            "user_alt": c.get("user_alt") or None,
        }

    total = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla): continue
        inicio = time.time()
        try:
            items = fetch_omie_paginated(
                url=URL, call="ListarContasCorrentes", sigla=sigla,
                list_field="ListarContasCorrentes", page_size=100,
                label="ContasCC",
            )
            rows = [map_cc(c, sigla) for c in items]
            rows = [r for r in rows if r["cod_cc"]]
            n, ins, upd, bef, aft = upsert_with_tracking(
                SCHEMA, "contas_correntes", rows, "empresa,cod_cc", empresa=sigla
            )
            dur = int(time.time() - inicio)
            print(f"   {sigla}: {n} ({ins} new, {upd} upd) {dur}s")
            update_sync_state(f"contas_correntes_{sigla}", sigla, n, modo="FULL",
                              rows_inserted=ins, rows_updated=upd, rows_before=bef, duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(f"contas_correntes_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])
    return total


# ═════════════════════════════════════════════════════════════════════════════
# 5. EMPRESAS  (single app-key, SF only in .gs)
# ═════════════════════════════════════════════════════════════════════════════

def import_empresas():
    print("\n" + "=" * 60)
    print("  EMPRESAS")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/empresas/"
    # Use only the first empresa alvo for this single-key endpoint
    sigla = EMPRESAS_ALVO[0] if EMPRESAS_ALVO else "SF"
    if not EMPRESAS_OMIE.get(sigla):
        print(f"   {sigla}: credenciais ausentes, pulando")
        return 0

    inicio = time.time()
    try:
        items = fetch_omie_paginated(
            url=URL, call="ListarEmpresas", sigla=sigla,
            list_field="empresas_cadastro", page_size=100,
            label="Empresas",
        )

        rows = []
        for e in items:
            rows.append({
                "codigo_empresa": to_int(e.get("codigo_empresa")),
                "codigo_empresa_integracao": e.get("codigo_empresa_integracao") or None,
                "cnpj": e.get("cnpj") or None,
                "razao_social": e.get("razao_social") or None,
                "nome_fantasia": e.get("nome_fantasia") or None,
                "endereco": e.get("endereco") or None,
                "endereco_numero": e.get("endereco_numero") or None,
                "complemento": e.get("complemento") or None,
                "bairro": e.get("bairro") or None,
                "cidade": e.get("cidade") or None,
                "estado": e.get("estado") or None,
                "cep": e.get("cep") or None,
                "telefone1_ddd": e.get("telefone1_ddd") or None,
                "telefone1_numero": e.get("telefone1_numero") or None,
                "telefone2_ddd": e.get("telefone2_ddd") or None,
                "telefone2_numero": e.get("telefone2_numero") or None,
                "email": e.get("email") or None,
                "website": e.get("website") or None,
                "inscricao_estadual": e.get("inscricao_estadual") or None,
                "inscricao_municipal": e.get("inscricao_municipal") or None,
                "cnae": e.get("cnae") or None,
                "regime_tributario": e.get("regime_tributario") or None,
                "optante_simples_nacional": e.get("optante_simples_nacional") or None,
                "inativa": e.get("inativa") or None,
                "gera_nfe": e.get("gera_nfe") or None,
                "gera_nfse": e.get("gera_nfse") or None,
                "inclusao_data": e.get("inclusao_data") or None,
                "inclusao_hora": e.get("inclusao_hora") or None,
                "alteracao_data": e.get("alteracao_data") or None,
                "alteracao_hora": e.get("alteracao_hora") or None,
            })

        rows = [r for r in rows if r["codigo_empresa"]]
        n = supa_upsert(SCHEMA, "empresas", rows, "codigo_empresa")
        dur = int(time.time() - inicio)
        print(f"   Empresas: {n} upserted em {dur}s")
        update_sync_state("empresas", sigla, n, modo="FULL", duracao_segundos=dur)
        return n
    except Exception as e:
        print(f"   Empresas: ERRO -> {e}")
        update_sync_state("empresas", sigla, 0, status="ERRO", erro=str(e)[:200])
        return 0


# ═════════════════════════════════════════════════════════════════════════════
# 6. PARCELAS  (single app-key, SF only in .gs)
# ═════════════════════════════════════════════════════════════════════════════

def import_parcelas():
    print("\n" + "=" * 60)
    print("  PARCELAS")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/geral/parcelas/"
    sigla = EMPRESAS_ALVO[0] if EMPRESAS_ALVO else "SF"
    if not EMPRESAS_OMIE.get(sigla):
        print(f"   {sigla}: credenciais ausentes, pulando")
        return 0

    inicio = time.time()
    try:
        items = fetch_omie_paginated(
            url=URL, call="ListarParcelas", sigla=sigla,
            list_field="cadastros", page_size=100,
            label="Parcelas",
        )

        rows = []
        for p in items:
            rows.append({
                "codigo": str(p.get("nCodigo", "")),
                "descricao": p.get("cDescricao") or None,
                "n_parcelas": to_float(p.get("nParcelas")),
            })

        rows = [r for r in rows if r["codigo"]]
        n = supa_upsert(SCHEMA, "parcelas", rows, "codigo")
        dur = int(time.time() - inicio)
        print(f"   Parcelas: {n} upserted em {dur}s")
        update_sync_state("parcelas", sigla, n, modo="FULL", duracao_segundos=dur)
        return n
    except Exception as e:
        print(f"   Parcelas: ERRO -> {e}")
        update_sync_state("parcelas", sigla, 0, status="ERRO", erro=str(e)[:200])
        return 0


# ═════════════════════════════════════════════════════════════════════════════
# 7. LANCAMENTOS CC
# ═════════════════════════════════════════════════════════════════════════════

def import_lancamentos_cc():
    print("\n" + "=" * 60)
    print("  LANCAMENTOS CC")
    print("=" * 60)

    URL = "https://app.omie.com.br/api/v1/financas/contacorrentelancamentos/"

    def extract_categorias(detalhes):
        a_cats = detalhes.get("aCodCateg") or []
        if isinstance(a_cats, list) and a_cats:
            return ", ".join(cat.get("cCodCateg", "") for cat in a_cats if isinstance(cat, dict))
        return detalhes.get("cCodCateg") or ""

    def map_lanc(l, sigla):
        cab = l.get("cabecalho") or {}
        det = l.get("detalhes") or {}
        div = l.get("diversos") or {}
        info = l.get("info") or {}
        return {
            "empresa": sigla,
            "cod_lancamento": to_int(l.get("nCodLanc")),
            "cod_int_lanc": l.get("cCodIntLanc") or None,
            "cod_agrup": to_int(l.get("nCodAgrup")),
            "cod_cc": to_int(cab.get("nCodCC")),
            "dt_lancamento": cab.get("dDtLanc") or None,
            "valor_lancamento": to_float(cab.get("nValorLanc")),
            "categorias": extract_categorias(det) or None,
            "tipo": det.get("cTipo") or None,
            "num_documento": det.get("cNumDoc") or None,
            "cod_cliente": to_int(det.get("nCodCliente")),
            "cod_projeto": to_int(det.get("nCodProjeto")),
            "observacao": det.get("cObs") or None,
            "origem": div.get("cOrigem") or None,
            "dt_conciliacao": div.get("dDtConc") or None,
            "hr_conciliacao": div.get("cHrConc") or None,
            "user_conciliacao": div.get("cUsConc") or None,
            "cod_vendedor": to_int(div.get("nCodVendedor")),
            "cod_comprador": to_int(div.get("nCodComprador")),
            "natureza": div.get("cNatureza") or None,
            "ident_lancamento": div.get("cIdentLanc") or None,
            "cod_lanc_cp": to_int(div.get("nCodLancCP")),
            "cod_lanc_cr": to_int(div.get("nCodLancCR")),
            "info_d_inc": info.get("dInc") or None,
            "info_h_inc": info.get("hInc") or None,
            "info_u_inc": info.get("uInc") or None,
            "info_d_alt": info.get("dAlt") or None,
            "info_h_alt": info.get("hAlt") or None,
            "info_u_alt": info.get("uAlt") or None,
            "info_imp_api": info.get("cImpAPI") or None,
        }

    total = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla): continue
        inicio = time.time()
        try:
            # ListarLancCC uses nPagina/nRegPorPagina and returns nTotPaginas
            items = fetch_omie_paginated(
                url=URL, call="ListarLancCC", sigla=sigla,
                list_field="listaLancamentos", page_size=100,
                page_key="nPagina", size_key="nRegPorPagina",
                label="LancCC",
            )
            rows = [map_lanc(l, sigla) for l in items]
            rows = [r for r in rows if r["cod_lancamento"]]
            n, ins, upd, bef, aft = upsert_with_tracking(
                SCHEMA, "lancamentos_cc", rows, "empresa,cod_lancamento", empresa=sigla
            )
            dur = int(time.time() - inicio)
            print(f"   {sigla}: {n} ({ins} new, {upd} upd) {dur}s")
            update_sync_state(f"lancamentos_cc_{sigla}", sigla, n, modo="FULL",
                              rows_inserted=ins, rows_updated=upd, rows_before=bef, duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(f"lancamentos_cc_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])
    return total


# ═════════════════════════════════════════════════════════════════════════════
# 8. AUXILIARES FINANCEIROS (7 small lookup tables)
# ═════════════════════════════════════════════════════════════════════════════

AUXILIARES_CONFIG = {
    "bandeiras_cartao": {
        "url": "https://app.omie.com.br/api/v1/geral/bandeiracartao/",
        "call": "ListarBandeiras",
        "list_field": "listaBandeira",
        "pk": "codigo",
        "paginated": True,
        "page_key": "nPagina", "size_key": "nRegPorPagina",
        "fields": lambda r: {"codigo": r.get("cCodigo") or "", "descricao": r.get("cDescricao") or None},
    },
    "origens_lancamento": {
        "url": "https://app.omie.com.br/api/v1/geral/origemlancamento/",
        "call": "ListarOrigem",
        "list_field": "origem",
        "pk": "codigo",
        "paginated": False,
        "param": {"codigo": ""},
        "fields": lambda r: {"codigo": r.get("codigo") or "", "descricao": r.get("descricao") or None},
    },
    "finalidades_transferencia": {
        "url": "https://app.omie.com.br/api/v1/geral/finaltransf/",
        "call": "ListarFinalTransf",
        "list_field": "cadastros",
        "pk": "codigo",
        "paginated": False,
        "param": {"filtrarPorBanco": ""},
        "fields": lambda r: {"banco": r.get("banco") or None, "codigo": r.get("codigo") or "", "descricao": r.get("descricao") or None},
    },
    "dre": {
        "url": "https://app.omie.com.br/api/v1/geral/dre/",
        "call": "ListarCadastroDRE",
        "list_field": "dreLista",
        "pk": "codigo_dre",
        "paginated": False,
        "param": {"apenasContasAtivas": "N"},
        "fields": lambda r: {"codigo_dre": r.get("codigoDRE") or "", "descricao_dre": r.get("descricaoDRE") or None},
    },
    "tipos_conta_corrente": {
        "url": "https://app.omie.com.br/api/v1/geral/tipocc/",
        "call": "ListarTiposCC",
        "list_field": "listaTiposCC",
        "pk": "codigo",
        "paginated": False,
        "param": {"codigo": ""},
        "fields": lambda r: {"codigo": r.get("codigo") or "", "descricao": r.get("descricao") or None},
    },
    "tipos_documento": {
        "url": "https://app.omie.com.br/api/v1/geral/tiposdoc/",
        "call": "PesquisarTipoDocumento",
        "list_field": "tipo_documento_cadastro",
        "pk": "codigo",
        "paginated": False,
        "param": {"codigo": ""},
        "fields": lambda r: {"codigo": r.get("codigo") or "", "descricao": r.get("descricao") or None},
    },
    "bancos": {
        "url": "https://app.omie.com.br/api/v1/geral/bancos/",
        "call": "ListarBancos",
        "list_field": "fin_banco_cadastro",
        "pk": "codigo",
        "paginated": True,
        "page_key": "pagina", "size_key": "registros_por_pagina",
        "fields": lambda r: {"codigo": r.get("codigo") or "", "nome": r.get("nome") or None, "tipo": r.get("tipo") or None},
    },
}


def import_auxiliares():
    print("\n" + "=" * 60)
    print("  AUXILIARES FINANCEIROS (7 tabelas)")
    print("=" * 60)

    sigla = EMPRESAS_ALVO[0] if EMPRESAS_ALVO else "SF"
    if not EMPRESAS_OMIE.get(sigla):
        print(f"   {sigla}: credenciais ausentes, pulando")
        return 0

    total = 0
    for table_name, cfg in AUXILIARES_CONFIG.items():
        inicio = time.time()
        try:
            if cfg.get("paginated"):
                items = fetch_omie_paginated(
                    url=cfg["url"], call=cfg["call"], sigla=sigla,
                    list_field=cfg["list_field"], page_size=100,
                    page_key=cfg.get("page_key", "nPagina"),
                    size_key=cfg.get("size_key", "nRegPorPagina"),
                    label=table_name,
                )
            else:
                param = cfg.get("param") or {}
                data = fetch_omie(cfg["url"], cfg["call"], sigla, param)
                items = data.get(cfg["list_field"]) or [] if not data.get("_empty_page") else []

            if not isinstance(items, list):
                items = []

            rows = [cfg["fields"](r) for r in items]
            rows = [r for r in rows if r.get(cfg["pk"])]

            n = supa_upsert(SCHEMA, table_name, rows, cfg["pk"])
            dur = int(time.time() - inicio)
            print(f"   {table_name}: {n} upserted em {dur}s")
            update_sync_state(f"aux_{table_name}", sigla, n, modo="FULL", duracao_segundos=dur)
            total += n
        except Exception as e:
            print(f"   {table_name}: ERRO -> {e}")
            update_sync_state(f"aux_{table_name}", sigla, 0, status="ERRO", erro=str(e)[:200])

    return total


# ═════════════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("  IMPORT FINANCE CADASTROS  (Omie -> Supabase)")
    print("  Clientes + Categorias + Projetos + ContasCC +")
    print("  Empresas + Parcelas + LancamentosCC + Auxiliares")
    print("=" * 60)

    totais = {}
    totais["clientes"] = import_clientes()
    totais["categorias"] = import_categorias()
    totais["projetos"] = import_projetos()
    totais["contas_correntes"] = import_contas_correntes()
    totais["empresas"] = import_empresas()
    totais["parcelas"] = import_parcelas()
    totais["lancamentos_cc"] = import_lancamentos_cc()
    totais["auxiliares"] = import_auxiliares()

    print("\n" + "=" * 60)
    print("  RESUMO FINAL")
    print("=" * 60)
    for k, v in totais.items():
        print(f"   {k}: {v}")
    print(f"   TOTAL: {sum(totais.values())}")

    trigger_sheets_mirror("finance_cadastros")


if __name__ == "__main__":
    main()
