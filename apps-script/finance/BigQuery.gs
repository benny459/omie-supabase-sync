/**
 * VERSÃO TURBO (V4.0 - CORREÇÃO MONETÁRIA): 
 * Adiciona tratamento para converter formato BR (1.234,56) para SQL (1234.56).
 */
function enviarParaBigQuery() {
  const projectId = 'dashboard-gerencial-489115'; 
  const datasetId = 'meus_dados';
  
  const abasParaSincronizar = [
    'Pagar_Flow', 
    'Receber_Flow', 
    'Lançamentos_Consolidados', 
    'ContasPagar_Consolidada', 
    'ContasReceber_Consolidada'
  ]; 

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();

  abasParaSincronizar.forEach(function(nomeDaAba) {
    let values;
    try {
      const range = Sheets.Spreadsheets.Values.get(ssId, nomeDaAba);
      values = range.values;
    } catch (e) {
      Logger.log('AVISO: Aba não encontrada ou vazia: ' + nomeDaAba);
      return;
    }

    if (!values || values.length < 2) return;

    const data = values;

    // === 2. TRATAMENTO DE CABEÇALHOS ===
    let headers = data[0].map(h => (h ? h.toString().trim() : ""));
    let counts = {};

    headers = headers.map(function(h, index) {
      let cleanName = h ? h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_]/g, "_") : `coluna_${index}`;
      if (counts[cleanName]) {
        counts[cleanName]++;
        cleanName = `${cleanName}_${counts[cleanName]}`;
      } else {
        counts[cleanName] = 1;
      }
      return cleanName;
    });

    // === 3. PREPARAÇÃO DO CSV COM SANITIZAÇÃO DE NÚMEROS ===
    let tableId = nomeDaAba.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                           .replace(/\s+/g, "_")
                           .replace(/[^a-zA-Z0-9_]/g, "");

    const rows = data.slice(1);
    let csvContent = headers.join(",") + "\n"; 

    const csvRows = rows.map(row => 
      row.map(cell => {
        if (cell === null || cell === undefined) return "";
        
        let val = cell.toString();

        // --- INÍCIO DA CORREÇÃO DE VALORES (BR -> SQL) ---
        // Verifica se a célula contém uma vírgula (indicativo de decimal BR)
        // e se parece um número (remove R$, espaços e pontos de milhar antes de testar)
        if (val.includes(',')) {
          let checkVal = val.replace(/[R$\s\.]/g, '').replace(',', '.');
          if (!isNaN(parseFloat(checkVal))) {
            val = checkVal; // Agora é "1234.56" em vez de "1.234,56"
          }
        }
        // --- FIM DA CORREÇÃO ---

        // Limpeza simples para velocidade
        val = val.replace(/"/g, "'"); 
        
        if (val.search(/("|,|\n)/g) >= 0) {
          val = `"${val}"`;
        }
        return val;
      }).join(",")
    ).join("\n");

    csvContent += csvRows;

    const blob = Utilities.newBlob(csvContent, 'application/octet-stream');

    // === 4. ENVIO PARA O BIGQUERY ===
    const job = {
      configuration: {
        load: {
          destinationTable: {
            projectId: projectId,
            datasetId: datasetId,
            tableId: tableId
          },
          skipLeadingRows: 1, 
          writeDisposition: 'WRITE_TRUNCATE', 
          sourceFormat: 'CSV',
          autodetect: true, 
          maxBadRecords: 50, 
          ignoreUnknownValues: true 
        }
      }
    };

    try {
      const jobResult = BigQuery.Jobs.insert(job, projectId, blob);
      Logger.log('🚀 ENVIADO RÁPIDO (E CORRIGIDO): ' + tableId);
    } catch (e) {
      Logger.log('ERRO CRÍTICO na aba ' + nomeDaAba + ': ' + e.toString());
    }
  });
}