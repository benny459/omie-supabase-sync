// ========================================
// MonitoramentoTempoReal.gs
// Sistema de Logs com Execução ao Vivo
// Versão: 7.0 - Real Time Monitoring
// Data: 17/10/2025
// ========================================

// ========================================
// CONFIGURAÇÕES GLOBAIS
// ========================================

var CONFIG_MONITORAMENTO = {
  nomeAbaMonitoramento: "Monitor_Sistema",
  nomeAbaLogs: "Logs_Execucao",
  maxLinhasLog: 10000,
  limiteTotalCelulas: 10000000,  // 10 milhões
  intervaloAtualizacao: 2000  // 2 segundos para atualização em tempo real
};

// Variável global para rastreamento
var EXECUCAO_ATIVA = {
  nome: '',
  inicio: null,
  linha: null,
  etapas: []
};

// ========================================
// SISTEMA DE LOG EM TEMPO REAL
// ========================================

/**
 * INICIAR LOG - Cria entrada "em execução" e retorna linha
 */
function iniciarLogTempoReal(nomeScript, tipo, mensagem) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  
  if (!abaLogs) {
    criarAbasMonitoramentoRapido();
    abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  }
  
  const horaInicio = new Date();
  
  // Cria linha com status "Executando"
  const novaLinha = [
    horaInicio,
    nomeScript,
    tipo,
    `🔄 EXECUTANDO... ${mensagem}`,
    '⏱️ Em andamento',
    '-',
    '🔄 Executando'
  ];
  
  abaLogs.appendRow(novaLinha);
  
  const linha = abaLogs.getLastRow();
  
  // Destaca linha em execução
  const rangeAtiva = abaLogs.getRange(linha, 1, 1, 7);
  rangeAtiva.setBackground('#e3f2fd');  // Azul claro
  rangeAtiva.setFontWeight('bold');
  
  SpreadsheetApp.flush();
  
  // Salva contexto global
  EXECUCAO_ATIVA = {
    nome: nomeScript,
    inicio: horaInicio,
    linha: linha,
    etapas: []
  };
  
  return linha;
}

/**
 * ATUALIZAR LOG - Atualiza progresso durante execução
 */
function atualizarLogTempoReal(linhaLog, etapa, registros) {
  if (!linhaLog) return;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  
  if (!abaLogs) return;
  
  const tempoDecorrido = ((new Date().getTime() - EXECUCAO_ATIVA.inicio.getTime()) / 1000).toFixed(1);
  
  // Adiciona etapa ao histórico
  EXECUCAO_ATIVA.etapas.push({
    hora: new Date(),
    etapa: etapa,
    registros: registros || '-'
  });
  
  // Monta mensagem com todas as etapas
  let mensagemCompleta = `🔄 EXECUTANDO...\n`;
  EXECUCAO_ATIVA.etapas.slice(-5).forEach(e => {  // Últimas 5 etapas
    mensagemCompleta += `  ✓ ${e.etapa} (${e.registros})\n`;
  });
  
  // Atualiza célula de mensagem
  abaLogs.getRange(linhaLog, 4).setValue(mensagemCompleta);
  
  // Atualiza tempo decorrido
  abaLogs.getRange(linhaLog, 5).setValue(`⏱️ ${tempoDecorrido}s`);
  
  // Atualiza registros processados
  if (registros) {
    abaLogs.getRange(linhaLog, 6).setValue(registros);
  }
  
  SpreadsheetApp.flush();
  
  Logger.log(`[${tempoDecorrido}s] ${etapa} - ${registros || '-'}`);
}

/**
 * FINALIZAR LOG - Marca como concluído com resultado final
 */
function finalizarLogTempoReal(linhaLog, mensagemFinal, registrosTotal, status) {
  if (!linhaLog) return;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  
  if (!abaLogs) return;
  
  const duracao = ((new Date().getTime() - EXECUCAO_ATIVA.inicio.getTime()) / 1000).toFixed(2);
  
  // Atualiza linha com dados finais
  abaLogs.getRange(linhaLog, 4).setValue(mensagemFinal);
  abaLogs.getRange(linhaLog, 5).setValue(duracao);
  abaLogs.getRange(linhaLog, 6).setValue(registrosTotal || '-');
  abaLogs.getRange(linhaLog, 7).setValue(status);
  
  // Cor de fundo baseada no status
  const rangeStatus = abaLogs.getRange(linhaLog, 1, 1, 7);
  rangeStatus.setFontWeight('normal');
  
  if (status === "✅ Sucesso") {
    rangeStatus.setBackground("#d9ead3");
  } else if (status === "⚠️ Aviso") {
    rangeStatus.setBackground("#fff2cc");
  } else if (status === "❌ Erro") {
    rangeStatus.setBackground("#f4cccc");
  }
  
  SpreadsheetApp.flush();
  
  // Limpa contexto
  EXECUCAO_ATIVA = { nome: '', inicio: null, linha: null, etapas: [] };
  
  Logger.log(`✅ Finalizado em ${duracao}s`);
}

/**
 * REGISTRAR LOG SIMPLES (mantém compatibilidade)
 */
function registrarLog(nomeScript, tipo, mensagem, duracao, registros, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  
  if (!abaLogs) {
    criarAbasMonitoramentoRapido();
    abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  }
  
  const novaLinha = [
    new Date(),
    nomeScript,
    tipo,
    mensagem,
    duracao || "",
    registros || "",
    status
  ];
  
  abaLogs.appendRow(novaLinha);
  
  const ultimaLinha = abaLogs.getLastRow();
  const rangeStatus = abaLogs.getRange(ultimaLinha, 7);
  
  if (status === "✅ Sucesso") {
    rangeStatus.setBackground("#d9ead3");
  } else if (status === "⚠️ Aviso") {
    rangeStatus.setBackground("#fff2cc");
  } else if (status === "❌ Erro") {
    rangeStatus.setBackground("#f4cccc");
  }
  
  if (abaLogs.getLastRow() > CONFIG_MONITORAMENTO.maxLinhasLog) {
    abaLogs.deleteRow(2);
  }
}

// ========================================
// EXEMPLO DE USO: FUNÇÃO COM LOG EM TEMPO REAL
// ========================================

/**
 * EXEMPLO: Atualizar Contas a Pagar com logs em tempo real
 */
function exemploFuncaoComLogTempoReal() {
  // 1. INICIA LOG
  const linhaLog = iniciarLogTempoReal(
    'exemploFuncaoComLogTempoReal',
    '💰 Contas',
    'Iniciando processamento...'
  );
  
  try {
    // 2. ETAPA 1
    atualizarLogTempoReal(linhaLog, 'Conectando API OMIE', '-');
    Utilities.sleep(1000);  // Simula processamento
    
    // 3. ETAPA 2
    atualizarLogTempoReal(linhaLog, 'Buscando registros SF', '0/300');
    Utilities.sleep(1000);
    
    // 4. LOOP COM PROGRESSO
    for (let i = 1; i <= 5; i++) {
      atualizarLogTempoReal(linhaLog, `Processando lote ${i}/5`, `${i * 60}/300`);
      Utilities.sleep(800);  // Simula processamento
    }
    
    // 5. ETAPA FINAL
    atualizarLogTempoReal(linhaLog, 'Salvando dados na planilha', '300');
    Utilities.sleep(1000);
    
    // 6. FINALIZA COM SUCESSO
    finalizarLogTempoReal(
      linhaLog,
      'Processamento concluído com sucesso!',
      300,
      '✅ Sucesso'
    );
    
    SpreadsheetApp.getActiveSpreadsheet().toast('✅ Exemplo concluído!', 'Sucesso', 3);
    
  } catch (erro) {
    // 7. FINALIZA COM ERRO
    finalizarLogTempoReal(
      linhaLog,
      `Erro: ${erro.message}`,
      '-',
      '❌ Erro'
    );
    
    throw erro;
  }
}

// ========================================
// WRAPPER AUTOMÁTICO - RASTREIA QUALQUER FUNÇÃO
// ========================================

/**
 * WRAPPER: Executa qualquer função com log automático
 */
function executarComLog(nomeFuncao, parametros) {
  const linhaLog = iniciarLogTempoReal(
    nomeFuncao,
    '⚙️ Execução',
    'Iniciando...'
  );
  
  try {
    // Busca função pelo nome
    if (typeof this[nomeFuncao] !== 'function') {
      throw new Error(`Função "${nomeFuncao}" não encontrada`);
    }
    
    atualizarLogTempoReal(linhaLog, 'Executando função', '-');
    
    // Executa a função
    const resultado = this[nomeFuncao].apply(this, parametros || []);
    
    finalizarLogTempoReal(
      linhaLog,
      'Execução concluída',
      '-',
      '✅ Sucesso'
    );
    
    return resultado;
    
  } catch (erro) {
    finalizarLogTempoReal(
      linhaLog,
      `Erro: ${erro.message}`,
      '-',
      '❌ Erro'
    );
    
    throw erro;
  }
}

// ========================================
// MONITORAMENTO EM TEMPO REAL (TELA)
// ========================================

/**
 * Abre sidebar com logs em tempo real
 */
function abrirMonitorTempoReal() {
  const html = HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html>
      <head>
        <base target="_top">
        <style>
          body {
            font-family: 'Roboto', Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
          }
          
          .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          
          .header h2 {
            margin: 0 0 10px 0;
            font-size: 24px;
          }
          
          .status {
            font-size: 14px;
            opacity: 0.9;
          }
          
          #logs-container {
            background: white;
            border-radius: 8px;
            padding: 15px;
            max-height: 500px;
            overflow-y: auto;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          
          .log-entry {
            padding: 12px;
            margin-bottom: 10px;
            border-left: 4px solid #e0e0e0;
            background: #fafafa;
            border-radius: 4px;
            animation: slideIn 0.3s ease;
          }
          
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateX(-20px);
            }
            to {
              opacity: 1;
              transform: translateX(0);
            }
          }
          
          .log-entry.executando {
            border-left-color: #2196f3;
            background: #e3f2fd;
            animation: pulse 2s infinite;
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
          
          .log-entry.sucesso {
            border-left-color: #4caf50;
            background: #e8f5e9;
          }
          
          .log-entry.erro {
            border-left-color: #f44336;
            background: #ffebee;
          }
          
          .log-entry.aviso {
            border-left-color: #ff9800;
            background: #fff3e0;
          }
          
          .log-time {
            font-size: 11px;
            color: #666;
            margin-bottom: 5px;
          }
          
          .log-script {
            font-weight: bold;
            color: #333;
            margin-bottom: 5px;
          }
          
          .log-message {
            color: #555;
            font-size: 13px;
            line-height: 1.5;
            white-space: pre-wrap;
          }
          
          .log-stats {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid #e0e0e0;
            font-size: 12px;
            color: #666;
          }
          
          .loading {
            text-align: center;
            padding: 20px;
            color: #999;
          }
          
          .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 10px;
          }
          
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>📊 Monitor em Tempo Real</h2>
          <div class="status" id="status">
            Aguardando execuções...
          </div>
        </div>
        
        <div id="logs-container">
          <div class="loading">
            <div class="spinner"></div>
            <p>Carregando logs...</p>
          </div>
        </div>
        
        <script>
          // Atualiza logs a cada 2 segundos
          function atualizarLogs() {
            google.script.run
              .withSuccessHandler(exibirLogs)
              .withFailureHandler(erro => console.error(erro))
              .obterLogsRecentes();
          }
          
          function exibirLogs(logs) {
            const container = document.getElementById('logs-container');
            
            if (!logs || logs.length === 0) {
              container.innerHTML = '<div class="loading"><p>Nenhum log ainda...</p></div>';
              return;
            }
            
            let html = '';
            
            // Inverte para mostrar mais recentes primeiro
            logs.reverse().forEach(log => {
              let classe = 'log-entry';
              
              if (log.status.includes('Executando')) classe += ' executando';
              else if (log.status.includes('Sucesso')) classe += ' sucesso';
              else if (log.status.includes('Erro')) classe += ' erro';
              else if (log.status.includes('Aviso')) classe += ' aviso';
              
              html += \`
                <div class="\${classe}">
                  <div class="log-time">\${log.timestamp}</div>
                  <div class="log-script">\${log.script} - \${log.tipo}</div>
                  <div class="log-message">\${log.mensagem}</div>
                  <div class="log-stats">
                    ⏱️ \${log.duracao} | 📊 \${log.registros} registros | \${log.status}
                  </div>
                </div>
              \`;
            });
            
            container.innerHTML = html;
            
            // Atualiza status
            const executando = logs.filter(l => l.status.includes('Executando')).length;
            document.getElementById('status').textContent = 
              executando > 0 
                ? \`🔄 \${executando} execução(ões) ativa(s)\`
                : \`✅ \${logs.length} log(s) | Nenhuma execução ativa\`;
          }
          
          // Inicia atualização automática
          atualizarLogs();
          setInterval(atualizarLogs, 2000);  // Atualiza a cada 2s
        </script>
      </body>
    </html>
  `).setTitle('Monitor Tempo Real');
  
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Retorna logs recentes para o monitor em tempo real
 */
function obterLogsRecentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
  
  if (!abaLogs) return [];
  
  const ultimaLinha = abaLogs.getLastRow();
  if (ultimaLinha <= 1) return [];
  
  // Pega últimas 20 linhas
  const numLinhas = Math.min(20, ultimaLinha - 1);
  const dados = abaLogs.getRange(ultimaLinha - numLinhas + 1, 1, numLinhas, 7).getValues();
  
  return dados.map(linha => ({
    timestamp: Utilities.formatDate(linha[0], Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
    script: linha[1],
    tipo: linha[2],
    mensagem: linha[3],
    duracao: linha[4],
    registros: linha[5],
    status: linha[6]
  }));
}

// ========================================
// RESTANTE DAS FUNÇÕES (mantidas)
// ========================================

function verificarEspacoDisponivel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  let totalCelulas = 0;
  sheets.forEach(sheet => {
    totalCelulas += (sheet.getMaxRows() * sheet.getMaxColumns());
  });
  const limite = CONFIG_MONITORAMENTO.limiteTotalCelulas;
  return {
    total: totalCelulas,
    disponiveis: limite - totalCelulas,
    percentual: ((totalCelulas / limite) * 100).toFixed(2),
    limite: limite
  };
}

function obterConfiguracoes() {
  const props = PropertiesService.getDocumentProperties();
  return {
    anoInicial: parseInt(props.getProperty('filtro_ano_inicial') || '2023'),
    anoFinal: parseInt(props.getProperty('filtro_ano_final') || '2025')
  };
}

function salvarConfiguracoes(anoInicial, anoFinal) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('filtro_ano_inicial', anoInicial.toString());
  props.setProperty('filtro_ano_final', anoFinal.toString());
}

function criarAbasMonitoramentoRapido() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  try {
    let abaMonitor = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaMonitoramento);
    if (abaMonitor) {
      ss.deleteSheet(abaMonitor);
      Utilities.sleep(2000);
    }
    
    abaMonitor = ss.insertSheet(CONFIG_MONITORAMENTO.nomeAbaMonitoramento);
    
    abaMonitor.getRange("A1").setValue("PAINEL DE MONITORAMENTO - ATUALIZADO AUTOMATICAMENTE");
    abaMonitor.getRange("A3").setValue("ÚLTIMA ATUALIZAÇÃO:");
    abaMonitor.getRange("B3").setValue(new Date());
    
    abaMonitor.getRange("A5").setValue("USO DE ESPAÇO");
    abaMonitor.getRange("A6:D6").setValues([["Métrica", "Valor", "Status", "Info"]]);
    abaMonitor.getRange("A7:A11").setValues([
      ["Total de Abas"],
      ["Células por Aba (ideal)"],
      ["Uso de Células Total"],
      ["Células Disponíveis"],
      ["Percentual Usado"]
    ]);
    
    abaMonitor.getRange("A13").setValue("ANÁLISE POR ABA");
    abaMonitor.getRange("A14:H14").setValues([["Aba", "Registros", "Colunas", "Células com Dados", "Capacidade Ideal", "% Ocupação", "Status", "Observação"]]);
    
    abaMonitor.getRange("A1").setFontWeight("bold").setFontSize(14);
    abaMonitor.getRange("A5").setFontWeight("bold").setFontSize(12);
    abaMonitor.getRange("A6:D6").setFontWeight("bold");
    abaMonitor.getRange("A13").setFontWeight("bold").setFontSize(12);
    abaMonitor.getRange("A14:H14").setFontWeight("bold");
    abaMonitor.setFrozenRows(1);
    
    let abaLogs = ss.getSheetByName(CONFIG_MONITORAMENTO.nomeAbaLogs);
    if (abaLogs) {
      ss.deleteSheet(abaLogs);
      Utilities.sleep(2000);
    }
    
    abaLogs = ss.insertSheet(CONFIG_MONITORAMENTO.nomeAbaLogs);
    
    abaLogs.getRange("A1:G1").setValues([[
      "Timestamp", "Script", "Tipo", "Mensagem", "Duração (s)", "Registros", "Status"
    ]]);
    
    abaLogs.getRange("A1:G1").setFontWeight("bold");
    abaLogs.setFrozenRows(1);
    
    Logger.log("✅ Abas criadas");
    
    SpreadsheetApp.getUi().alert(
      'Sucesso!',
      'Abas criadas:\n\n✅ Monitor_Sistema\n✅ Logs_Execucao\n\nUse "Abrir Monitor Tempo Real" para ver execuções ao vivo!',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    
  } catch (erro) {
    Logger.log("❌ ERRO: " + erro.message);
  }
}

// [Resto das funções mantidas do original: formatarAbasMonitoramento, atualizarPainelMonitoramento, etc.]
