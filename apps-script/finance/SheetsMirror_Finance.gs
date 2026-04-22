// ════════════════════════════════════════════════════════════════════════════
// 🪞 SHEETS MIRROR + 📊 DASHBOARD — FINANCE
// Supabase → Google Sheets (read-only)
//
// ⚠️ ESTE ARQUIVO VAI NO PROJETO APPS SCRIPT DA PLANILHA DE FINANCE
//    (NÃO na planilha de Sales ou Orders!)
//
// DEPENDÊNCIA: SupabaseClient.gs no mesmo projeto
//              + supaSetupCredenciais() rodado 1x
//
// FUNCIONALIDADES:
//   1. Mirror: lê Supabase → reescreve abas no Sheets (com clean de células extras)
//   2. Dashboard: aba "📊 Dashboard" com resumo de sync_state do Supabase
//   3. Trigger automático a cada 15min
//
// TABELAS ESPELHADAS (schema: finance):
//   - ContasPagar, ContasReceber, PesquisaTitulos, ExtratosCC
//   - Clientes, Categorias, Projetos, ContasCorrentes
//   - Empresas, Parcelas, LancamentosCC, Bancos
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎛️ FILTROS DE DATA — CONFIGURE AQUI
// Cada tabela pode ter um filtro por data pra limitar o volume no Sheets.
// Formato: "gte.DD/MM/YYYY" (maior ou igual) ou "gte.YYYY-MM-DD" (ISO)
// Deixe null pra trazer tudo.
// ========================================
// ════════════════════════════════════════════════════════════════════════════
// 🎛️ FILTROS DE DATA — CONFIGURE AQUI
// ════════════════════════════════════════════════════════════════════════════
// Cada tabela pode ter um filtro por data pra limitar o que vai pro Sheets.
// O filtro é aplicado DEPOIS de buscar do Supabase (funciona com datas DD/MM/YYYY).
//
// Formato:
//   { campo: "nome_da_coluna", a_partir_de: "01/01/2025" }
//
// Exemplos:
//   - Só vencimentos de 2025:  { campo: "data_vencimento", a_partir_de: "01/01/2025" }
//   - Só lançamentos de Jul/24: { campo: "dt_lancamento", a_partir_de: "01/07/2024" }
//   - Tudo (sem filtro):        null
//
// ⚠️ ATENÇÃO: PesquisaTitulos tem 60k+ rows × 62 colunas = estoura o Sheets!
//    Use filtro pra manter abaixo de ~20k rows nessa aba.
// ════════════════════════════════════════════════════════════════════════════
var FILTROS = {
  ContasPagar:      { campo: "data_vencimento", a_partir_de: "01/01/2025" },
  ContasReceber:    { campo: "data_vencimento", a_partir_de: "01/01/2025" },
  PesquisaTitulos:  { campo: "dt_vencimento",   a_partir_de: "01/01/2025", ate: "31/12/2027" },  // faixa 2025-2027 (exclui vencimentos longos 2028+)
  ExtratosCC:       { campo: "data_lancamento", a_partir_de: "01/01/2025" },
  LancamentosCC:    { campo: "dt_lancamento",   a_partir_de: "01/01/2025" },
  Clientes:         null,
  Categorias:       null,
  Projetos:         null,
  ContasCorrentes:  null,
  Bancos:           null
};

// Converte "DD/MM/YYYY" → "YYYY-MM-DD" pra comparação
function _parseDataBR_(str) {
  if (!str || typeof str !== 'string') return '';
  var p = str.split('/');
  if (p.length !== 3) return '';
  return p[2] + '-' + p[1] + '-' + p[0]; // "2025-01-15"
}

var MIRROR_CFG = {

  "ContasPagar": {
    schema: "finance", tabela: "contas_pagar", abaSheets: "ContasPagar", corHeader: "#C0392B",
    headers: ["Empresa","Cód Lanc","Cód Int","Cód Fornecedor","Dt Vencimento","Dt Previsão","Vlr Documento","Vlr Pago","Cód Categoria","Categorias Rateio","ID CC","Num Doc Fiscal","Dt Emissão","Dt Entrada","Cód Projeto","Num Pedido","Num Documento","Num Parcela","Chave NFe","Status","ID Origem","Observação","Vlr PIS","Ret PIS","Vlr COFINS","Ret COFINS","Vlr CSLL","Ret CSLL","Vlr IR","Ret IR","Vlr ISS","Ret ISS","Vlr INSS","Ret INSS","Dt Inc","Hr Inc","User Inc","Dt Alt","Hr Alt","User Alt"],
    rowMapper: function(r) {
      return [r.empresa||"",r.codigo_lancamento_omie||"",r.codigo_lancamento_integracao||"",r.codigo_cliente_fornecedor||"",r.data_vencimento||"",r.data_previsao||"",r.valor_documento!=null?r.valor_documento:0,r.valor_pago!=null?r.valor_pago:0,r.codigo_categoria||"",r.categorias_rateio||"",r.id_conta_corrente||"",r.numero_documento_fiscal||"",r.data_emissao||"",r.data_entrada||"",r.codigo_projeto||"",r.numero_pedido||"",r.numero_documento||"",r.numero_parcela||"",r.chave_nfe||"",r.status_titulo||"",r.id_origem||"",r.observacao||"",r.valor_pis!=null?r.valor_pis:0,r.retem_pis||"",r.valor_cofins!=null?r.valor_cofins:0,r.retem_cofins||"",r.valor_csll!=null?r.valor_csll:0,r.retem_csll||"",r.valor_ir!=null?r.valor_ir:0,r.retem_ir||"",r.valor_iss!=null?r.valor_iss:0,r.retem_iss||"",r.valor_inss!=null?r.valor_inss:0,r.retem_inss||"",r.info_d_inc||"",r.info_h_inc||"",r.info_u_inc||"",r.info_d_alt||"",r.info_h_alt||"",r.info_u_alt||""];
    },
    query: "select=*&order=empresa,codigo_lancamento_omie"
  },

  "ContasReceber": {
    schema: "finance", tabela: "contas_receber", abaSheets: "ContasReceber", corHeader: "#27AE60",
    headers: ["Empresa","Cód Lanc","Cód Int","Cód Cliente","Dt Vencimento","Dt Previsão","Vlr Documento","Cód Categoria","Categorias Rateio","ID CC","Num Documento","Num Parcela","Num Doc Fiscal","Num Pedido","Chave NFe","Dt Emissão","ID Origem","Cód Projeto","Cód Vendedor","Status","Observação","Vlr PIS","Ret PIS","Vlr COFINS","Ret COFINS","Vlr CSLL","Ret CSLL","Vlr IR","Ret IR","Vlr ISS","Ret ISS","Vlr INSS","Ret INSS","Boleto Gerado","Boleto Dt Emissão","Boleto Número","Boleto Num Bancário","Dt Inc","Hr Inc","User Inc","Dt Alt","Hr Alt","User Alt"],
    rowMapper: function(r) {
      return [r.empresa||"",r.codigo_lancamento_omie||"",r.codigo_lancamento_integracao||"",r.codigo_cliente_fornecedor||"",r.data_vencimento||"",r.data_previsao||"",r.valor_documento!=null?r.valor_documento:0,r.codigo_categoria||"",r.categorias_rateio||"",r.id_conta_corrente||"",r.numero_documento||"",r.numero_parcela||"",r.numero_documento_fiscal||"",r.numero_pedido||"",r.chave_nfe||"",r.data_emissao||"",r.id_origem||"",r.codigo_projeto||"",r.codigo_vendedor||"",r.status_titulo||"",r.observacao||"",r.valor_pis!=null?r.valor_pis:0,r.retem_pis||"",r.valor_cofins!=null?r.valor_cofins:0,r.retem_cofins||"",r.valor_csll!=null?r.valor_csll:0,r.retem_csll||"",r.valor_ir!=null?r.valor_ir:0,r.retem_ir||"",r.valor_iss!=null?r.valor_iss:0,r.retem_iss||"",r.valor_inss!=null?r.valor_inss:0,r.retem_inss||"",r.boleto_gerado||"",r.boleto_dt_emissao||"",r.boleto_numero||"",r.boleto_num_bancario||"",r.info_d_inc||"",r.info_h_inc||"",r.info_u_inc||"",r.info_d_alt||"",r.info_h_alt||"",r.info_u_alt||""];
    },
    query: "select=*&order=empresa,codigo_lancamento_omie"
  },

  "PesquisaTitulos": {
    schema: "finance", tabela: "pesquisa_titulos", abaSheets: "PesquisaTitulos", corHeader: "#8E44AD",
    headers: ["Empresa","Cód Título","Cód Int","Num Título","Dt Emissão","Dt Vencimento","Dt Previsão","Dt Pagamento","Cód Cliente","CPF/CNPJ","Cód Contrato","Num Contrato","Cód OS","Num OS","Cód CC","Status","Natureza","Tipo","Operação","Num Doc Fiscal","Cód Categoria","Cat Rateio","Num Parcela","Vlr Título","Vlr PIS","Ret PIS","Vlr COFINS","Ret COFINS","Vlr CSLL","Ret CSLL","Vlr IR","Ret IR","Vlr ISS","Ret ISS","Vlr INSS","Ret INSS","Obs","Cód Projeto","Cód Vendedor","Cód Comprador","Cód Barras","NSU","Cód NF","Dt Registro","Num Boleto","Chave NFe","Origem","Cód Tit Repet","Dt Cancelamento","Liquidado","Vlr Pago","Vlr Aberto","Desconto","Juros","Multa","Vlr Líquido","Dt Inc","Hr Inc","User Inc","Dt Alt","Hr Alt","User Alt"],
    rowMapper: function(r) {
      return [r.empresa||"",r.cod_titulo||"",r.cod_int_titulo||"",r.num_titulo||"",r.dt_emissao||"",r.dt_vencimento||"",r.dt_previsao||"",r.dt_pagamento||"",r.cod_cliente||"",r.cpf_cnpj_cliente||"",r.cod_contrato||"",r.num_contrato||"",r.cod_os||"",r.num_os||"",r.cod_cc||"",r.status||"",r.natureza||"",r.tipo||"",r.operacao||"",r.num_doc_fiscal||"",r.cod_categoria||"",r.categorias_rateio||"",r.num_parcela||"",r.valor_titulo!=null?r.valor_titulo:0,r.valor_pis!=null?r.valor_pis:0,r.ret_pis||"",r.valor_cofins!=null?r.valor_cofins:0,r.ret_cofins||"",r.valor_csll!=null?r.valor_csll:0,r.ret_csll||"",r.valor_ir!=null?r.valor_ir:0,r.ret_ir||"",r.valor_iss!=null?r.valor_iss:0,r.ret_iss||"",r.valor_inss!=null?r.valor_inss:0,r.ret_inss||"",r.observacao||"",r.cod_projeto||"",r.cod_vendedor||"",r.cod_comprador||"",r.codigo_barras||"",r.nsu||"",r.cod_nf||"",r.dt_registro||"",r.num_boleto||"",r.chave_nfe||"",r.origem||"",r.cod_tit_repet||"",r.dt_cancelamento||"",r.liquidado||"",r.val_pago!=null?r.val_pago:0,r.val_aberto!=null?r.val_aberto:0,r.desconto!=null?r.desconto:0,r.juros!=null?r.juros:0,r.multa!=null?r.multa:0,r.val_liquido!=null?r.val_liquido:0,r.info_d_inc||"",r.info_h_inc||"",r.info_u_inc||"",r.info_d_alt||"",r.info_h_alt||"",r.info_u_alt||""];
    },
    query: "select=*&order=empresa,cod_titulo"
  },

  "ExtratosCC": {
    schema: "finance", tabela: "extratos_cc", abaSheets: "ExtratoCC", corHeader: "#2980B9",
    headers: ["Empresa","Cód CC","Desc CC","Cód Banco","Agência","Num Conta","Cód Lanc","Cód Lanc Relac","Situação","Data","Descrição Cliente","Cód Cliente","Razão Cliente","Doc Cliente","Tipo Doc","Número","Valor","Saldo","Cód Categoria","Desc Categoria","Doc Fiscal","Parcela","Nosso Número","Origem","Vendedor","Projeto","Observações","Dt Inclusão","Hr Inclusão","Natureza","Bloqueado","Dt Conciliação"],
    rowMapper: function(r) {
      return [r.empresa||"",r.cod_conta_corrente||"",r.descricao_cc||"",r.cod_banco||"",r.cod_agencia||"",r.num_conta||"",r.cod_lancamento||"",r.cod_lanc_relac||"",r.situacao||"",r.data_lancamento||"",r.des_cliente||"",r.cod_cliente||"",r.raz_cliente||"",r.doc_cliente||"",r.tipo_documento||"",r.numero||"",r.valor_documento!=null?r.valor_documento:0,r.saldo!=null?r.saldo:0,r.cod_categoria||"",r.des_categoria||"",r.documento_fiscal||"",r.parcela||"",r.nosso_numero||"",r.origem||"",r.vendedor||"",r.projeto||"",r.observacoes||"",r.data_inclusao||"",r.hora_inclusao||"",r.natureza||"",r.bloqueado||"",r.data_conciliacao||""];
    },
    query: "select=*&order=empresa,cod_conta_corrente,cod_lancamento"
  },

  "Clientes": {
    schema: "finance", tabela: "clientes", abaSheets: "Clientes", corHeader: "#16A085",
    headers: ["Empresa","Cód Omie","Cód Int","Razão Social","Nome Fantasia","CNPJ/CPF","IE","IM","Tipo Pessoa","Email","Telefone","Telefone2","Fax","Homepage","Endereço","Número","Complemento","Bairro","Cidade","Estado","CEP","País","Contato","Inativo","Bloqueado","Dt Inclusão","Dt Alteração","Cód Vendedor"],
    rowMapper: function(r) {
      return [r.empresa||"",r.codigo_cliente_omie||"",r.codigo_cliente_integracao||"",r.razao_social||"",r.nome_fantasia||"",r.cnpj_cpf||"",r.inscricao_estadual||"",r.inscricao_municipal||"",r.tipo_pessoa||"",r.email||"",r.telefone||"",r.telefone2||"",r.fax||"",r.homepage||"",r.endereco||"",r.endereco_numero||"",r.complemento||"",r.bairro||"",r.cidade||"",r.estado||"",r.cep||"",r.pais||"",r.contato||"",r.inativo||"",r.bloqueado||"",r.dt_inclusao||"",r.dt_alteracao||"",r.cod_vendedor||""];
    },
    query: "select=*&order=empresa,codigo_cliente_omie"
  },

  "Categorias": {
    schema: "finance", tabela: "categorias", abaSheets: "Categorias", corHeader: "#E0E0E0",
    headers: ["Empresa","Código","Descrição","Desc Padrão","Conta Inativa","Natureza","Totalizadora","Transferência","Cód DRE","Desc DRE","Nível DRE","Sinal DRE"],
    rowMapper: function(r) {
      return [r.empresa||"",r.codigo||"",r.descricao||"",r.descricao_padrao||"",r.conta_inativa||"",r.natureza||"",r.totalizadora||"",r.transferencia||"",r.codigo_dre||"",r.descricao_dre||"",r.nivel_dre||"",r.sinal_dre||""];
    },
    query: "select=*&order=empresa,codigo"
  },

  "Projetos": {
    schema: "finance", tabela: "projetos", abaSheets: "Projetos", corHeader: "#E0E0E0",
    headers: ["Empresa","Código","Nome","Cód Integração","Status","Inativo","Dt Inclusão","Dt Alteração","Obs","Cód Cliente"],
    rowMapper: function(r) {
      return [r.empresa||"",r.codigo||"",r.nome||"",r.cod_integracao||"",r.status||"",r.inativo||"",r.dt_inclusao||"",r.dt_alteracao||"",r.obs||"",r.cod_cliente||""];
    },
    query: "select=*&order=empresa,codigo"
  },

  "ContasCorrentes": {
    schema: "finance", tabela: "contas_correntes", abaSheets: "ContasCorrentes", corHeader: "#E0E0E0",
    headers: ["Empresa","Cód CC","Descrição","Tipo","Cód Banco","Agência","Num Conta","Saldo Inicial","Saldo Data","Não Exibir","PIX","Moeda"],
    rowMapper: function(r) {
      return [r.empresa||"",r.cod_cc||"",r.descricao||"",r.tipo||"",r.cod_banco||"",r.agencia||"",r.num_conta||"",r.saldo_inicial!=null?r.saldo_inicial:0,r.saldo_data||"",r.nao_exibir||"",r.pix||"",r.moeda||""];
    },
    query: "select=*&order=empresa,cod_cc"
  },

  "LancamentosCC": {
    schema: "finance", tabela: "lancamentos_cc", abaSheets: "LancamentosCC", corHeader: "#34495E",
    headers: ["Empresa","Cód Lanc","Dt Lanc","Dt Registro","Dt Previsão","Dt Conciliação","Dt Vencimento","Descrição","Obs","Valor","Cód Categoria","Desc Categoria","Cód CC","Desc CC","Tipo","Natureza","Cód Cliente","Nome Cliente","Num Documento","Num Doc Fiscal","Cód Projeto","Cód Vendedor","NSU","ID Movimento","Conciliado","Operação","Origem","ID Origem","Cód Tipo Doc","Status"],
    rowMapper: function(r) {
      return [r.empresa||"",r.cod_lancamento||"",r.dt_lancamento||"",r.dt_registro||"",r.dt_previsao||"",r.dt_conciliacao||"",r.dt_vencimento||"",r.descricao||"",r.obs||"",r.valor!=null?r.valor:0,r.cod_categoria||"",r.desc_categoria||"",r.cod_cc||"",r.desc_cc||"",r.tipo||"",r.natureza||"",r.cod_cliente||"",r.nome_cliente||"",r.num_documento||"",r.num_doc_fiscal||"",r.cod_projeto||"",r.cod_vendedor||"",r.nsu||"",r.id_movimento||"",r.conciliado||"",r.operacao||"",r.origem||"",r.id_origem||"",r.cod_tipo_doc||"",r.status||""];
    },
    query: "select=*&order=empresa,cod_lancamento"
  },

  "Bancos": {
    schema: "finance", tabela: "bancos", abaSheets: "Bancos", corHeader: "#E0E0E0",
    headers: ["Código","Nome","Sigla"],
    rowMapper: function(r) { return [r.codigo||"",r.nome||"",r.sigla||""]; },
    query: "select=*&order=codigo"
  }
};

// ========================================
// 🚀 FUNÇÕES PÚBLICAS — UMA POR TABELA
// ========================================
function mirrorContasPagar()     { return _finalizarMirror_(mirrorTabela_("ContasPagar")); }
function mirrorContasReceber()   { return _finalizarMirror_(mirrorTabela_("ContasReceber")); }
function mirrorPesquisaTitulos() { return _finalizarMirror_(mirrorTabela_("PesquisaTitulos")); }
function mirrorExtratosCC()      { return _finalizarMirror_(mirrorTabela_("ExtratosCC")); }
function mirrorClientes()        { return _finalizarMirror_(mirrorTabela_("Clientes")); }
function mirrorCategorias()      { return _finalizarMirror_(mirrorTabela_("Categorias")); }
function mirrorProjetos()        { return _finalizarMirror_(mirrorTabela_("Projetos")); }
function mirrorContasCorrentes() { return _finalizarMirror_(mirrorTabela_("ContasCorrentes")); }
function mirrorLancamentosCC()   { return _finalizarMirror_(mirrorTabela_("LancamentosCC")); }
function mirrorBancos()          { return _finalizarMirror_(mirrorTabela_("Bancos")); }

/** Wrapper que dispara atualização do Dashboard após qualquer mirror individual. */
function _finalizarMirror_(r) {
  try { atualizarDashboard(); }
  catch(e) { Logger.log("⚠️ Dashboard (pós-mirror individual): " + e.message); }
  return r;
}

// ========================================
// 🔐 SETUP DO TOKEN DO WEBHOOK (rodar 1x)
// ========================================
function setupMirrorToken() {
  var props = PropertiesService.getScriptProperties();
  var TOKEN = "5e7bc8216d354466fc65ac34aef09d67c6475f59ceaec20bd05258788f1fd99d";
  props.setProperty('MIRROR_WEBHOOK_TOKEN', TOKEN);
  Logger.log("✅ MIRROR_WEBHOOK_TOKEN salvo em ScriptProperties");
}

// ========================================
// 🌐 WEBHOOK doPost — disparado pelo GitHub Actions após import
// ========================================
function doPost(e) {
  var inicio = new Date().getTime();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _jsonResponse_({ ok: false, error: "empty body" });
    }
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (err) { return _jsonResponse_({ ok: false, error: "invalid JSON" }); }

    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('MIRROR_WEBHOOK_TOKEN');
    if (!tokenEsperado) return _jsonResponse_({ ok: false, error: "no token configured" });
    if (!data.token || data.token !== tokenEsperado) return _jsonResponse_({ ok: false, error: "unauthorized" });

    var cfgName = data.cfgName || "TUDO";

    // "TUDO"/"ALL" → mirrorTudo completo
    if (cfgName === "TUDO" || cfgName === "ALL") {
      var resultados = mirrorTudo();
      return _jsonResponse_({ ok: true, cfgName: "TUDO",
                              resultados: resultados,
                              webhook_ms: new Date().getTime() - inicio });
    }

    if (!MIRROR_CFG[cfgName]) return _jsonResponse_({ ok: false, error: "unknown cfgName: " + cfgName });

    var resultado = mirrorTabela_(cfgName);
    try { atualizarDashboard(); }
    catch(e) { Logger.log("⚠️ Dashboard (pós-webhook): " + e.message); }
    return _jsonResponse_({ ok: true, cfgName: cfgName,
                            linhas: resultado.linhas, segundos: resultado.segundos,
                            webhook_ms: new Date().getTime() - inicio });
  } catch (err) {
    return _jsonResponse_({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return _jsonResponse_({
    ok: true,
    service: "Sheets Mirror Finance",
    modulos: Object.keys(MIRROR_CFG),
    info: "POST com { token, cfgName } para acionar. cfgName='TUDO' roda mirrorTudo."
  });
}

function _jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function mirrorTudo() {
  var resultados = [];

  // 🧠 SMART MIRROR: lê sync_state uma vez e compara timestamps
  var syncMap = {};
  try {
    var syncData = supaSelect('sales', 'sync_state', 'select=modulo,last_sync_at&order=modulo');
    syncData.forEach(function(s) { syncMap[s.modulo] = s.last_sync_at || ''; });
  } catch(e) { Logger.log("⚠️ Falha lendo sync_state: " + e.message); }

  var props = PropertiesService.getScriptProperties();
  var totalSkipped = 0;

  Object.keys(MIRROR_CFG).forEach(function(nome) {
    var cfg = MIRROR_CFG[nome];
    // Verifica se dados mudaram desde último mirror
    var syncKey = cfg.tabela; // ex: "contas_pagar"
    var lastSyncRemote = '';
    // Procura qualquer módulo que contenha o nome da tabela
    Object.keys(syncMap).forEach(function(mod) {
      if (mod.indexOf(syncKey) >= 0 && syncMap[mod] > lastSyncRemote) {
        lastSyncRemote = syncMap[mod];
      }
    });
    var lastMirrorLocal = props.getProperty('MIRROR_TS_' + nome) || '';

    if (lastSyncRemote && lastMirrorLocal && lastSyncRemote <= lastMirrorLocal) {
      Logger.log("⏭️ " + nome + ": sem mudanças (sync=" + lastSyncRemote.substring(0,19) + " ≤ mirror=" + lastMirrorLocal.substring(0,19) + ")");
      resultados.push(nome + ": skip");
      totalSkipped++;
      return; // pula este mirror
    }

    try {
      var r = mirrorTabela_(nome);
      resultados.push(nome + ": " + r.linhas + " (" + r.segundos + "s)");
      // Salva timestamp do mirror bem-sucedido
      props.setProperty('MIRROR_TS_' + nome, new Date().toISOString());
    } catch (err) {
      Logger.log("❌ " + nome + ": " + err.message);
      resultados.push(nome + ": ERRO");
    }
  });

  if (totalSkipped > 0) {
    Logger.log("⏭️ " + totalSkipped + " abas skipadas (sem mudanças)");
  }
  Logger.log("🏁 Mirror Finance: " + resultados.join(" | "));

  try { atualizarDashboard(); } catch(e) { Logger.log("⚠️ Dashboard: " + e.message); }

  return resultados;
}

// ========================================
// 📊 DASHBOARD — Resumo do sync_state
// ========================================
function atualizarDashboard() {
  var inicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var syncData = [];
  try {
    syncData = supaSelect('sales', 'sync_state', 'select=*&order=modulo');
  } catch (err) {
    Logger.log('⚠️ Dashboard: falha lendo sync_state: ' + err.message);
    return;
  }

  // Filtra só módulos Finance
  var financeData = syncData.filter(function(s) {
    return s.modulo && (
      s.modulo.indexOf('contas_pagar') >= 0 || s.modulo.indexOf('contas_receber') >= 0 ||
      s.modulo.indexOf('pesquisa_titulos') >= 0 || s.modulo.indexOf('extratos_cc') >= 0 ||
      s.modulo.indexOf('clientes') >= 0 || s.modulo.indexOf('categorias') >= 0 ||
      s.modulo.indexOf('projetos') >= 0 || s.modulo.indexOf('contas_correntes') >= 0 ||
      s.modulo.indexOf('empresas') >= 0 || s.modulo.indexOf('parcelas') >= 0 ||
      s.modulo.indexOf('lancamentos_cc') >= 0 || s.modulo.indexOf('bancos') >= 0 ||
      s.modulo.indexOf('aux_') >= 0
    );
  });

  var sheet = ss.getSheetByName('📊 Dashboard') || ss.insertSheet('📊 Dashboard');
  sheet.clear();

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  sheet.getRange('A1').setValue('📊 Dashboard Finance — ' + agora).setFontSize(14).setFontWeight('bold');

  var headerSync = ['Módulo', 'Empresa', 'Status', 'Modo', 'Total Rows', 'Novos', 'Atualizados', 'Duração', 'Última Sync'];
  sheet.getRange(3, 1, 1, headerSync.length).setValues([headerSync])
    .setFontWeight('bold').setBackground('#8E44AD').setFontColor('white');

  if (financeData.length > 0) {
    var rows = financeData.map(function(s) {
      var statusIcon = s.ultima_execucao_status === 'SUCESSO' ? '✅' : '❌';
      var modo = s.modo || '—';
      var lastSync = '—';
      if (s.last_sync_at) {
        try { lastSync = Utilities.formatDate(new Date(s.last_sync_at), 'America/Sao_Paulo', 'dd/MM HH:mm'); }
        catch(e) { lastSync = s.last_sync_at.substring(0, 16); }
      }
      return [
        (s.modulo || '').replace(/_/g, ' '),
        s.empresa || '',
        statusIcon + ' ' + (s.ultima_execucao_status || ''),
        modo,
        s.total_registros || 0,
        s.rows_inserted || 0,
        s.rows_updated || 0,
        s.duracao_segundos ? s.duracao_segundos + 's' : '—',
        lastSync
      ];
    });
    sheet.getRange(4, 1, rows.length, headerSync.length).setValues(rows);
    sheet.getRange(4, 5, rows.length, 3).setNumberFormat('#,##0');

    // Formatação condicional
    var statusRange = sheet.getRange(4, 3, rows.length, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('SUCESSO').setBackground('#d9ead3').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('ERRO').setBackground('#f4cccc').setRanges([statusRange]).build()
    ]);
  }

  sheet.setFrozenRows(3);
  sheet.setColumnWidth(1, 250);
  Logger.log('📊 Dashboard Finance atualizado');
}

// ========================================
// ⏰ TRIGGERS
// ========================================
function criarTriggerMirror() {
  removerTriggersMirror();
  ScriptApp.newTrigger('mirrorTudo').timeBased().everyHours(1).create();
  Logger.log("✅ Trigger criado: mirrorTudo Finance a cada 1 hora (smart mirror skipa quando não ha mudancas)");
}

function removerTriggersMirror() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'mirrorTudo') ScriptApp.deleteTrigger(t);
  });
}

// ========================================
// 🛠️ IMPLEMENTAÇÃO INTERNA (com clean de células extras)
// ========================================
function mirrorTabela_(nomeCfg) {
  var cfg = MIRROR_CFG[nomeCfg];
  if (!cfg) throw new Error("Config não encontrada: " + nomeCfg);

  var inicio = new Date().getTime();
  Logger.log("🪞 Mirror " + nomeCfg + " (" + cfg.schema + "." + cfg.tabela + " → '" + cfg.abaSheets + "')");

  var rows = supaSelectAllPaginated(cfg.schema, cfg.tabela, cfg.query, 1000);
  var totalBruto = rows.length;

  // Aplica filtro de data client-side (DD/MM/YYYY → comparação ISO)
  var filtro = FILTROS[nomeCfg];
  if (filtro && filtro.campo) {
    var dataMinISO = filtro.a_partir_de ? _parseDataBR_(filtro.a_partir_de) : '';
    var dataMaxISO = filtro.ate ? _parseDataBR_(filtro.ate) : '';
    rows = rows.filter(function(r) {
      var val = r[filtro.campo];
      if (!val) return false;
      var iso = _parseDataBR_(val);
      if (dataMinISO && iso < dataMinISO) return false;
      if (dataMaxISO && iso > dataMaxISO) return false;
      return true;
    });
    var desc = filtro.campo;
    if (dataMinISO) desc += " >= " + filtro.a_partir_de;
    if (dataMaxISO) desc += " e <= " + filtro.ate;
    Logger.log("   📥 Supabase: " + totalBruto + " total → 🔍 " + desc + " → " + rows.length + " rows");
  } else {
    Logger.log("   📥 Lidas " + rows.length + " linhas (tudo)");
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.abaSheets);
  if (!sheet) {
    sheet = ss.insertSheet(cfg.abaSheets);
    Logger.log("   ➕ Aba '" + cfg.abaSheets + "' criada");
  }

  var numCols = cfg.headers.length;
  var maxRow = sheet.getMaxRows();

  // 🧹 CLEAN: limpa TODAS as células de dados (incluindo linhas extras de runs anteriores)
  if (maxRow > 1) {
    sheet.getRange(2, 1, maxRow - 1, numCols).clearContent();
  }

  // Cabeçalho
  sheet.getRange(1, 1, 1, numCols)
    .setValues([cfg.headers])
    .setFontWeight("bold")
    .setBackground(cfg.corHeader)
    .setFontColor("white");
  sheet.setFrozenRows(1);

  if (rows.length === 0) {
    Logger.log("   📭 Supabase vazio — só cabeçalho");
    _logAZ1_(sheet, "SUCESSO", 0, inicio, "Mirror (vazio)");
    return { linhas: 0, segundos: Math.floor((new Date().getTime() - inicio) / 1000) };
  }

  var matriz = rows.map(cfg.rowMapper);
  sheet.getRange(2, 1, matriz.length, numCols).setValues(matriz);

  // 🧹 CLEAN EXTRA: se tinha mais linhas antes do que agora, limpa as sobras
  var linhasDepois = matriz.length + 1; // +1 pelo cabeçalho
  if (maxRow > linhasDepois) {
    var sobras = maxRow - linhasDepois;
    if (sobras > 0) {
      sheet.getRange(linhasDepois + 1, 1, sobras, numCols).clearContent();
      Logger.log("   🧹 Clean: " + sobras + " linhas extras limpas");
    }
  }

  SpreadsheetApp.flush();

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log("   ✅ " + matriz.length + " linhas escritas em " + tempo + "s");
  _logAZ1_(sheet, "SUCESSO", matriz.length, inicio, "Mirror do Supabase");

  return { linhas: matriz.length, segundos: tempo };
}

function _logAZ1_(sheet, status, linhas, tempoInicio, msg) {
  try {
    var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
    var tempo = Math.floor((new Date().getTime() - tempoInicio) / 1000);
    var icone = status === "SUCESSO" ? "✅" : "❌";
    var texto = icone + " " + status + " | " + agora + " | " + linhas + " linhas | " + tempo + "s | " + msg;
    sheet.getRange("AZ1").setValue(texto)
      .setBackground(status === "SUCESSO" ? "#d9ead3" : "#f4cccc")
      .setFontColor("black").setFontWeight("bold");
  } catch (e) {}
}
