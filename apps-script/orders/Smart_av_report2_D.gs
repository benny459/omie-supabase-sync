/**
 * 🕵️‍♂️ SCRIPT ANALISTA SMART (V6.1 - COMPATÍVEL ORQUESTRADOR V3)
 * 1. Return Count: Retorna 1 (Sucesso) ou 0 (Falha/Vazio).
 * 2. Mantém lógica de envio direto Webex e formatação.
 */

const CONFIG_ANALISE = {
  SHEET_NOME: 'Smart_Consolidada',
  WEBEX: {
    API_URL: "https://webexapis.com/v1/messages",
    TOKEN: "MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad",
    ROOM_ID: "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNjQ0MGM5ODAtMDAwNS0xMWYxLWI2N2QtYzU1YjQ2MGJhMDA2"
  },
  EMAILS: {
    ERICK: 'erick@waterworks.com.br',
    SUPORTE: 'suporte@waterworks.com.br',
    FERNANDA: 'fernanda@waterworks.com.br',
    FILIPE: 'filipe@waterworks.com.br'
  },
  NOMES: {
    ERICK: 'Erick Teixeira',
    SUPORTE: 'Suporte Water Works',
    FERNANDA: 'Fernanda Santos',
    FILIPE: 'Filipe Brito'
  },
  COLUNAS: {
    PV: 'V.PV / OS',
    CLIENTE: 'V.Cliente_Omie',
    TIPO: 'V.Tipo_Omie', 
    PREV_LIMITE: 'V.Previsão Limite_Omie',
    ETAPA: 'V.Etapa Venda_Omie',
    NOVA_PREV_SERV: 'V.Nova Previsão de Serviço', 
    NOVA_PREV_MAT: 'V.Nova Previsão de Materiais', 
    RC_NUM: 'RC.Numero',
    RC_CUSTO: 'RC.Custo',
    PC_NUM: 'PC.Numero',
    PC_CUSTO: 'PC.Custo',
    PC_FORN: 'PC.Fornecedor',
    PC_COND: 'PC.Cond. Pagamento',
    PC_PRAZO: 'PC.Prazo de entrega', 
    PC_APROVACAO: 'PC.Aprovação', 
    PC_STATUS: 'PC.Status',       
    MT_STATUS: 'MT.Status de Fornecimento',
    FONTE: 'Fonte',
    PC_APROVAR_ATE: 'PC.Aprovar até:',
    POSICAO: 'Posição adicional'
  },
  ICONES: {
    'MERCANTIL': '📦',
    'SERVIÇO': '🛠️',
    'SERVICO': '🛠️',
    'MIX': '🔄',
    'OUTROS': '📁'
  },
  RESPONSAVEIS: {
    'MERCANTIL': 'ERICK',
    'SERVIÇO': 'SUPORTE',
    'MIX': 'SUPORTE',
    'OUTROS': 'SUPORTE'
  }
};

function getMention(chave) {
  const nome = CONFIG_ANALISE.NOMES[chave];
  const email = CONFIG_ANALISE.EMAILS[chave];
  if (!email) return `@${nome}`;
  return `<@personEmail:${email}|${nome}>`;
}

function gerarRelatorioAnalista() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_ANALISE.SHEET_NOME);
  
  if (!sheet) { 
    console.error("Aba Consolidada não encontrada!"); 
    return 0; // Retorno para o Orquestrador
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return 0; // Sem dados

  const rows = data.slice(1);
  const idx = {};
  
  // Mapeia índices dinamicamente
  Object.keys(CONFIG_ANALISE.COLUNAS).forEach(k => { 
      idx[k] = data[0].indexOf(CONFIG_ANALISE.COLUNAS[k]); 
  });

  const hoje = new Date();
  hoje.setHours(0,0,0,0);

  let report = { 
    atrasos: {}, 
    prontoParaFaturar: {}, 
    radarDatas: {}, 
    aprovarAtrasado: [],
    aprovarHoje: [],
    aprovarSemana: [], 
    correcoes: { financeiro: [], dadosRC: [], dadosPC: [], agenda: [], status: [] }
  };
  
  let pvsProcessados = new Set();
  let dataTracker = {}; 

  rows.forEach(row => {
    const fonte = String(row[idx.FONTE] || '').trim().toUpperCase();
    if (fonte !== 'AVULSOS') return; 
    const cliente = String(row[idx.CLIENTE] || '').trim();
    if (!cliente) return;
    const etapa = String(row[idx.ETAPA] || '');
    if (isFaturado(etapa)) return; 

    const pvRaw = row[idx.PV];
    const pvBold = `**${pvRaw}**`; 
    const ultimaObs = extrairUltimaObservacao(String(row[idx.POSICAO] || ''));
    const obsFinal = ultimaObs ? ` | Obs: (${ultimaObs})` : "";

    let tipoRaw = String(row[idx.TIPO] || 'OUTROS').toUpperCase().trim();
    if (tipoRaw.includes('SERVI')) tipoRaw = 'SERVIÇO';
    const tipoIcone = CONFIG_ANALISE.ICONES[tipoRaw] || CONFIG_ANALISE.ICONES['OUTROS'];
    const chaveResp = CONFIG_ANALISE.RESPONSAVEIS[tipoRaw] || 'SUPORTE';
    const nomeGrupo = `${tipoIcone} ${tipoRaw} - ${getMention(chaveResp)}`; 

    const dataLimite = parseDate(row[idx.PREV_LIMITE]);
    const novaPrevServ = parseDate(row[idx.NOVA_PREV_SERV]);
    const novaPrevMat = parseDate(row[idx.NOVA_PREV_MAT]);
    const pcNum = row[idx.PC_NUM];
    const mtStatus = row[idx.MT_STATUS];
    
    // TRACKER INTEGRIDADE
    if (!dataTracker[pvRaw]) dataTracker[pvRaw] = { obs: obsFinal, rcNum: false, rcCusto: false, pcNum: false, pcCusto: false, pcForn: false, pcCond: false };
    if (String(row[idx.RC_NUM] || '').trim().length > 0) dataTracker[pvRaw].rcNum = true;
    if (String(row[idx.RC_CUSTO] || '').trim().length > 0) dataTracker[pvRaw].rcCusto = true;
    if (String(row[idx.PC_NUM] || '').trim().length > 0) dataTracker[pvRaw].pcNum = true;
    if (String(row[idx.PC_CUSTO] || '').trim().length > 0) dataTracker[pvRaw].pcCusto = true;
    if (String(row[idx.PC_FORN] || '').trim().length > 0) dataTracker[pvRaw].pcForn = true;
    if (String(row[idx.PC_COND] || '').trim().length > 0) dataTracker[pvRaw].pcCond = true;

    // STATUS
    if (pcNum) {
      const pcBold = `**PC ${pcNum}**`;
      const stAprovacao = String(row[idx.PC_APROVACAO] || '').toLowerCase();
      const stStatus = String(row[idx.PC_STATUS] || '').toLowerCase();
      const decisaoEhAprovado = stAprovacao.includes('aprovado!'); 
      const statusEhAprovacao = stStatus === 'aprovação';

      if (decisaoEhAprovado && !statusEhAprovacao) {
        const msg = `• ${pcBold} (${pvBold}) ➝ Status incorreto`;
        if (!report.correcoes.status.some(m => m.includes(pcNum))) report.correcoes.status.push(msg);
      }
      if (statusEhAprovacao && !decisaoEhAprovado) {
        const msg = `• ${pcBold} (${pvBold}) ➝ Decisão pendente`;
        if (!report.correcoes.status.some(m => m.includes(pcNum))) report.correcoes.status.push(msg);
      }
    }

    // RADAR PRONTO
    if (mtStatus === 'Recebido' || mtStatus === 'Conferido') {
      if (!report.prontoParaFaturar[nomeGrupo]) report.prontoParaFaturar[nomeGrupo] = [];
      let datasStr = [];
      if (novaPrevMat) datasStr.push(`Mat: ${formatDate(novaPrevMat)}`);
      if (novaPrevServ) datasStr.push(`Serv: ${formatDate(novaPrevServ)}`);
      let infoData = datasStr.length > 0 ? `(${datasStr.join(' | ')})` : "";
      const textoItem = `• ${pvBold} | ${cliente} ${infoData}${obsFinal}`;
      if (!report.prontoParaFaturar[nomeGrupo].some(t => t.includes(pvRaw))) report.prontoParaFaturar[nomeGrupo].push(textoItem);
    }

    // RADAR DATAS
    if (dataLimite) {
      let dataLabel = "";
      let deveIncluir = false;
      if (isSameDay(dataLimite, hoje)) { dataLabel = "**HOJE**"; deveIncluir = true; }
      else if (isThisWeek(dataLimite)) { dataLabel = formatDate(dataLimite); deveIncluir = true; }

      if (deveIncluir) {
        if (!report.radarDatas[nomeGrupo]) report.radarDatas[nomeGrupo] = [];
        let obs = (novaPrevMat || novaPrevServ) ? " (Reagendado)" : "";
        const textoItem = `• ${pvBold} | ${cliente} - ${dataLabel}${obs}${obsFinal}`;
        if (!report.radarDatas[nomeGrupo].some(t => t.includes(pvRaw))) report.radarDatas[nomeGrupo].push(textoItem);
      }
    }

    // ATRASOS
    if (dataLimite && dataLimite < hoje) {
      if (!pvsProcessados.has(pvRaw)) {
        if (!report.atrasos[nomeGrupo]) report.atrasos[nomeGrupo] = [];
        let novaDataStr = "Sem previsão";
        if (novaPrevMat) novaDataStr = `Mat: ${formatDate(novaPrevMat)}`;
        else if (novaPrevServ) novaDataStr = `Serv: ${formatDate(novaPrevServ)}`;
        report.atrasos[nomeGrupo].push(`• ${pvBold} | ${cliente} | Era: ${formatDate(dataLimite)} ➝ ${novaDataStr}${obsFinal}`);
        pvsProcessados.add(pvRaw);
      }
    }

    // APROVAÇÕES
    const statusAprovacao = String(row[idx.PC_APROVACAO] || '').toLowerCase();
    const statusSucesso = ['aprovado', 'aprovado!', 'aprovada', 'aprovada!', 'aprovado faturamento direto', 'aprovado faturamento direto!'];
    if (pcNum && !statusSucesso.includes(statusAprovacao)) {
      let rawValor = row[idx.PC_CUSTO];
      let valorFmt = "R$ -";
      if (typeof rawValor === 'number' && !isNaN(rawValor)) valorFmt = rawValor.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
      else if (typeof rawValor === 'string' && rawValor !== '') {
         let parsed = parseFloat(rawValor);
         if (!isNaN(parsed)) valorFmt = parsed.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
      }
      const pcPrazo = parseDate(row[idx.PC_PRAZO]); 
      const dataAprovarAte = parseDate(row[idx.PC_APROVAR_ATE]); 
      const dataRef = dataAprovarAte || pcPrazo || dataLimite;
      const jaExistePC = (lista, pc) => lista.some(item => item.includes(pc));
      let baseInfo = `• **PC ${pcNum}** | ${valorFmt} | PV: ${pvBold}`;
      
      if (dataRef) {
        if (dataRef < hoje) {
           if (!jaExistePC(report.aprovarAtrasado, pcNum)) report.aprovarAtrasado.push(`${baseInfo} (Venceu: ${formatDate(dataRef)})${obsFinal}`);
        } else if (isSameDay(dataRef, hoje)) {
           if (!jaExistePC(report.aprovarHoje, pcNum)) report.aprovarHoje.push(`${baseInfo}${obsFinal}`);
        } else if (isThisWeek(dataRef)) {
           if (!jaExistePC(report.aprovarSemana, pcNum)) report.aprovarSemana.push(`${baseInfo} (Vence: ${formatDate(dataRef)})${obsFinal}`);
        }
      } else {
        if (!jaExistePC(report.aprovarHoje, pcNum)) report.aprovarHoje.push(`${baseInfo} (Sem data definida)${obsFinal}`);
      }
    }

    // CORREÇÕES
    if (mtStatus === 'Faturado pelo Fornecedor') {
       const msg = `• Dar Entrada: **PC ${pcNum}** do ${pvBold}`;
       if (!report.correcoes.financeiro.some(x => x.includes(pcNum))) report.correcoes.financeiro.push(msg);
    }
    const checkAgenda = (msg) => { if (!report.correcoes.agenda.some(x => x.includes(pvRaw))) report.correcoes.agenda.push(msg); };
    if (etapa === 'Agendado para' && !novaPrevServ && !novaPrevMat) checkAgenda(`• Agendamento Vazio: ${pvBold}${obsFinal}`);
    if ((novaPrevServ && novaPrevServ < hoje) || (novaPrevMat && novaPrevMat < hoje)) checkAgenda(`• Agendamento Vencido: ${pvBold}${obsFinal}`);
    if (etapa === 'Compras Aprovadas' && !novaPrevServ && !novaPrevMat) checkAgenda(`• Sem Previsão Futura: ${pvBold}${obsFinal}`);
  });

  Object.keys(dataTracker).forEach(pv => {
    let faltasRC = [];
    if (!dataTracker[pv].rcNum) faltasRC.push("Número");
    if (!dataTracker[pv].rcCusto) faltasRC.push("Custo");
    if (faltasRC.length > 0) report.correcoes.dadosRC.push(`• **${pv}** (Falta: ${faltasRC.join(', ')})`);

    let faltasPC = [];
    if (!dataTracker[pv].pcNum) faltasPC.push("Número");
    if (!dataTracker[pv].pcCusto) faltasPC.push("Custo");
    if (!dataTracker[pv].pcForn) faltasPC.push("Fornecedor");
    if (!dataTracker[pv].pcCond) faltasPC.push("Cond. Pagto");
    const temAlgoPC = dataTracker[pv].pcNum || dataTracker[pv].pcCusto || dataTracker[pv].pcForn || dataTracker[pv].pcCond;
    if (temAlgoPC && faltasPC.length > 0) report.correcoes.dadosPC.push(`• **${pv}** (Falta: ${faltasPC.join(', ')})`);
  });

  // =================================================================================
  // MONTAGEM POR BLOCOS (ARRAY)
  // =================================================================================
  let blocks = [];
  blocks.push(`# 📊 RELATÓRIO ANALISTA (AVULSOS) - ${formatDate(hoje)}`);
  
  // 1. ATRASOS
  let blockAtrasos = [];
  blockAtrasos.push(`---\n## 🚨 1. VENDAS EM ATRASO`);
  let temAtraso = false;
  Object.keys(report.atrasos).sort().forEach(grupo => {
    if (report.atrasos[grupo].length > 0) {
      temAtraso = true;
      blockAtrasos.push(`\n**${grupo}**\n` + report.atrasos[grupo].join('\n'));
    }
  });
  if (!temAtraso) blockAtrasos.push("_Nada consta._");
  blocks.push(blockAtrasos.join('\n'));

  // 2. FATURAMENTO
  let blockRadar = [];
  blockRadar.push(`---\n## 📈 2. RADAR DE FATURAMENTO`);
  
  blockRadar.push(`\n\u00A0\n### 2.1. JÁ PODEMOS FATURAR?! (Recebido/Conferido)`);
  let temPronto = false;
  Object.keys(report.prontoParaFaturar).sort().forEach(tipo => {
    if (report.prontoParaFaturar[tipo].length > 0) {
      temPronto = true;
      blockRadar.push(`\n**${tipo}**\n` + report.prontoParaFaturar[tipo].join('\n'));
    }
  });
  if (!temPronto) blockRadar.push("_Nenhum item pronto._");

  blockRadar.push(`\n\u00A0\n### 2.2. PREVISÕES (POR DATA)`);
  let temDatas = false;
  Object.keys(report.radarDatas).sort().forEach(tipo => {
    if (report.radarDatas[tipo].length > 0) {
      temDatas = true;
      blockRadar.push(`\n**${tipo}**\n` + report.radarDatas[tipo].join('\n'));
    }
  });
  if (!temDatas && !temPronto) blockRadar.push("_Nada previsto para curto prazo._");
  blocks.push(blockRadar.join('\n'));

  // 3. APROVAÇÕES
  let blockAprov = [];
  blockAprov.push(`---\n## ⚠️ 3. APROVAÇÕES PENDENTES - ${getMention('FERNANDA')}`);
  let temAprovacao = false;
  
  if (report.aprovarAtrasado.length > 0) { 
    temAprovacao = true; 
    blockAprov.push(`\n**🔴 EM ATRASO:**\n` + report.aprovarAtrasado.join('\n')); 
  }
  if (report.aprovarHoje.length > 0) { 
    temAprovacao = true; 
    blockAprov.push(`\n**🟡 VENCE HOJE:**\n` + report.aprovarHoje.join('\n')); 
  }
  if (report.aprovarSemana.length > 0) { 
    temAprovacao = true; 
    blockAprov.push(`\n**🟢 PARA A SEMANA:**\n` + report.aprovarSemana.join('\n')); 
  }
  if (!temAprovacao) blockAprov.push("_Tudo aprovado._");
  blocks.push(blockAprov.join('\n'));

  // 4. CORREÇÕES
  let blockCorrecoes = [];
  blockCorrecoes.push(`---\n## 🛠️ 4. AÇÕES DE CORREÇÃO`);
  let temCorrecoes = false;

  if (report.correcoes.status.length > 0) {
    temCorrecoes = true;
    blockCorrecoes.push(`\n**⚠️ Status de Aprovação Irregular - ${getMention('ERICK')}**\n` + [...new Set(report.correcoes.status)].join('\n'));
  }
  if (report.correcoes.dadosRC.length > 0) {
    temCorrecoes = true;
    blockCorrecoes.push(`\n**⚠️ RCs Faltantes ou Irregulares - ${getMention('FILIPE')}**\n` + report.correcoes.dadosRC.join('\n'));
  }
  if (report.correcoes.dadosPC.length > 0) {
    temCorrecoes = true;
    blockCorrecoes.push(`\n**⚠️ PCs Faltantes ou Irregulares - ${getMention('FILIPE')}**\n` + report.correcoes.dadosPC.join('\n'));
  }
  if (report.correcoes.financeiro.length > 0) {
    temCorrecoes = true;
    blockCorrecoes.push(`\n**🔹 Financeiro (Entrada NFs)**\n` + [...new Set(report.correcoes.financeiro)].join('\n'));
  }
  if (report.correcoes.agenda.length > 0) {
    temCorrecoes = true;
    blockCorrecoes.push(`\n**⚠️ Agendamentos - ${getMention('SUPORTE')}**\n` + [...new Set(report.correcoes.agenda)].join('\n'));
  }

  if (!temCorrecoes) blockCorrecoes.push("_Dados consistentes. Nenhuma ação necessária._");
  blocks.push(blockCorrecoes.join('\n'));

  const finalMessage = blocks.join('\n\n\u00A0\n'); 

  enviarParaWebex(finalMessage);
  
  return 1; // Retorno de Sucesso para o Orquestrador
}

function enviarParaWebex(textoMarkdown) {
  const payload = { "roomId": CONFIG_ANALISE.WEBEX.ROOM_ID, "markdown": textoMarkdown };
  const options = { "method": "post", "headers": { "Authorization": `Bearer ${CONFIG_ANALISE.WEBEX.TOKEN}`, "Content-Type": "application/json" }, "payload": JSON.stringify(payload), "muteHttpExceptions": true };
  try {
    const response = UrlFetchApp.fetch(CONFIG_ANALISE.WEBEX.API_URL, options);
    const code = response.getResponseCode();
    if (code >= 200 && code < 300) console.log("✅ Enviado ao Webex.");
    else console.error(`❌ Erro Webex (${code}): ${response.getContentText()}`);
  } catch (error) { console.error("Erro fatal Webex: " + error.message); }
}

function extrairUltimaObservacao(texto) {
  if (!texto || texto.trim() === '') return '';
  const linhas = texto.split('\n');
  let obsEncontradas = [];
  const regexData = /^(\d{1,2}[\/.-]\d{1,2})\s*[-:–]?\s*(.*)/;
  linhas.forEach(linha => {
    const match = linha.trim().match(regexData);
    if (match) {
      const dataStr = match[1]; 
      let conteudo = match[2]; 
      if (conteudo.startsWith('-') || conteudo.startsWith(':')) conteudo = conteudo.substring(1).trim();
      const partes = dataStr.split(/[\/.-]/);
      const dataObj = new Date(new Date().getFullYear(), parseInt(partes[1]) - 1, parseInt(partes[0]));
      obsEncontradas.push({ data: dataObj, textoLimpo: `${dataStr} - ${conteudo}` });
    }
  });
  if (obsEncontradas.length === 0) return '';
  obsEncontradas.sort((a, b) => b.data - a.data);
  return obsEncontradas[0].textoLimpo;
}

function parseDate(d){if(!d)return null;if(d instanceof Date)return d;if(typeof d==='string'){const p=d.split('/');if(p.length===3)return new Date(p[2],p[1]-1,p[0])}return null}
function formatDate(d){return d?Utilities.formatDate(d,Session.getScriptTimeZone(),"dd/MM"):""}
function isSameDay(a,b){return a&&b&&a.getDate()===b.getDate()&&a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear()}
function isThisWeek(d){if(!d)return false;const h=new Date();const p=new Date();p.setDate(h.getDate()+7);return d>=h&&d<=p}
function isFaturado(s){if(!s)return false;const v=String(s).toLowerCase();return v.includes('faturado')||v.includes('entrega')||v.includes('concluí')}