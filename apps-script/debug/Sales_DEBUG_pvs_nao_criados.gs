// ════════════════════════════════════════════════════════════════════════════
// 🔬 DEBUG — por que certos PVs não foram inseridos no SmartSuite
// Rode debugPvsNaoCriados() e veja os logs.
// ════════════════════════════════════════════════════════════════════════════

function debugPvsNaoCriados() {
  // Edite esta lista com os PVs que você quer investigar
  const ALVOS = ['PV1710', 'PV1712', 'PV1713', 'PV1714', 'PV1715'];

  Logger.log('🔬 DEBUG — investigando: ' + ALVOS.join(', '));
  Logger.log('═══════════════════════════════════════════════════════════');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_IMPORTACAO.NOME_ABA);
  if (!sheet) { Logger.log('❌ Aba "' + CONFIG_IMPORTACAO.NOME_ABA + '" não encontrada!'); return; }

  const dados = sheet.getDataRange().getValues();
  Logger.log('📄 Aba: ' + CONFIG_IMPORTACAO.NOME_ABA + ' | Linhas: ' + (dados.length - 1));

  // Configs que filtram
  const projPermitidos = CONFIG_IMPORTACAO.PROJETOS_PERMITIDOS; // ['40_VS','41_VP']
  const diasCorte = CONFIG_IMPORTACAO.DIAS_FILTRO_INSERCAO;     // 90
  const hoje = new Date();
  const dataCorte = new Date(hoje.getTime() - diasCorte * 86400000);
  Logger.log('⚙️  Projetos permitidos: ' + projPermitidos.join(', '));
  Logger.log('⚙️  Filtro data emissão: >= ' + Utilities.formatDate(dataCorte, 'America/Sao_Paulo', 'dd/MM/yyyy'));
  Logger.log('');

  // 1) Busca no Smart pra comparar
  Logger.log('🔍 Carregando registros do SmartSuite...');
  const smart = buscarTodosRegistrosSmartSuite();
  const mapaSmart = {};
  smart.forEach(function(r) { mapaSmart[r.title] = true; });
  Logger.log('   ✅ ' + smart.length + ' registros no Smart\n');

  // 2) Pra cada alvo, faz análise
  ALVOS.forEach(function(alvo) {
    const alvoUpper = alvo.toUpperCase();
    Logger.log('─── ' + alvo + ' ───');

    // Procura na planilha
    let encontradoNaPlanilha = false;
    for (let i = 1; i < dados.length; i++) {
      const linha = dados[i];
      const cod = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.COD_PVOS] || '').trim().toUpperCase();
      if (cod !== alvoUpper) continue;

      encontradoNaPlanilha = true;
      const projeto = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PROJETO] || '').trim().toUpperCase();
      const dataEmissao = linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.DATA_EMISSAO];
      const cliente = linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CLIENTE];

      Logger.log('  ✅ Achado na planilha (linha ' + (i+1) + ')');
      Logger.log('     Cliente:  ' + cliente);
      Logger.log('     Projeto:  "' + projeto + '"');
      Logger.log('     Data emissão (raw): ' + dataEmissao);

      // Verifica filtros
      const problemas = [];

      // Filtro 1: projeto permitido
      const projOK = projPermitidos.indexOf(projeto) >= 0;
      if (!projOK) problemas.push('❌ Projeto "' + projeto + '" NÃO está em [' + projPermitidos.join(', ') + ']');
      else Logger.log('     ✓ Projeto OK (' + projeto + ')');

      // Filtro 2: data emissão dentro do corte
      let dataOK = false;
      if (dataEmissao) {
        const dt = (dataEmissao instanceof Date) ? dataEmissao : new Date(dataEmissao);
        if (!isNaN(dt.getTime())) {
          dataOK = dt >= dataCorte;
          const dtFmt = Utilities.formatDate(dt, 'America/Sao_Paulo', 'dd/MM/yyyy');
          if (!dataOK) problemas.push('❌ Data emissão ' + dtFmt + ' é anterior ao corte de ' + diasCorte + ' dias');
          else Logger.log('     ✓ Data emissão OK (' + dtFmt + ')');
        } else {
          problemas.push('❌ Data emissão inválida: ' + dataEmissao);
        }
      } else {
        problemas.push('❌ Data emissão VAZIA');
      }

      // Filtro 3: já existe no Smart?
      const jaExiste = mapaSmart[alvoUpper];
      if (jaExiste) problemas.push('⚠️  JÁ EXISTE no SmartSuite — vira UPDATE, não CREATE');
      else Logger.log('     ✓ Não existe no Smart (seria criado)');

      Logger.log('');
      if (problemas.length === 0) {
        Logger.log('     🎯 DEVERIA ter sido inserido! Rodar sincronizarEInserir() deve criar.');
      } else {
        Logger.log('     🚫 NÃO foi inserido porque:');
        problemas.forEach(function(p) { Logger.log('        ' + p); });
      }
      break;
    }

    if (!encontradoNaPlanilha) {
      Logger.log('  ❌ NÃO encontrado na planilha ' + CONFIG_IMPORTACAO.NOME_ABA);
      Logger.log('     (Mirror Supabase→Sheets pode não ter atualizado ainda)');
    }
    Logger.log('');
  });

  Logger.log('═══════════════════════════════════════════════════════════');
  Logger.log('💡 Pra forçar inserção de algum PV válido:');
  Logger.log('   1. Confirme que projeto é "40_VS" ou "41_VP"');
  Logger.log('   2. Confirme que data emissão é recente (<= 90 dias)');
  Logger.log('   3. Rode sincronizarEInserir() manualmente');
}
