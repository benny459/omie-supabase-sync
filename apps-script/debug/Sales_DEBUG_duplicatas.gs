// ════════════════════════════════════════════════════════════════════════════
// 🔬 DEBUG DUPLICATAS — conta registros com mesmo title no SmartSuite
// ════════════════════════════════════════════════════════════════════════════

function debugDuplicatasSmart() {
  Logger.log('🔬 DEBUG — duplicatas no SmartSuite');
  Logger.log('═══════════════════════════════════════════════');

  var smart = buscarTodosRegistrosSmartSuite();
  Logger.log('📦 Total de registros no Smart: ' + smart.length);

  // Conta por title
  var contagem = {};
  smart.forEach(function(r) {
    var t = r.title || '(vazio)';
    contagem[t] = (contagem[t] || 0) + 1;
  });

  // Filtra só os com duplicata
  var duplicados = [];
  Object.keys(contagem).forEach(function(t) {
    if (contagem[t] > 1) duplicados.push({ title: t, count: contagem[t] });
  });

  duplicados.sort(function(a, b) { return b.count - a.count; });

  Logger.log('');
  Logger.log('⚠️ ' + duplicados.length + ' títulos com duplicatas');
  Logger.log('');

  if (duplicados.length === 0) {
    Logger.log('✅ NENHUMA duplicata! Bug é em outro lugar.');
    return;
  }

  // Top 20
  Logger.log('📊 TOP 20 títulos mais duplicados:');
  duplicados.slice(0, 20).forEach(function(d) {
    Logger.log('  ' + d.title + ' → ' + d.count + ' cópias');
  });

  // Estatísticas
  var totalDuplicatas = duplicados.reduce(function(sum, d) { return sum + d.count; }, 0);
  var registrosUnicos = Object.keys(contagem).length;
  var excedente = totalDuplicatas - duplicados.length; // quantos "sobrando"

  Logger.log('');
  Logger.log('═══════════════════════════════════════════════');
  Logger.log('📈 Estatísticas:');
  Logger.log('   Total de registros no Smart: ' + smart.length);
  Logger.log('   Títulos únicos: ' + registrosUnicos);
  Logger.log('   Títulos com duplicatas: ' + duplicados.length);
  Logger.log('   Registros duplicados (excedente): ' + excedente);
  Logger.log('   → Se remover duplicatas, sobrariam ' + registrosUnicos + ' registros');
}
