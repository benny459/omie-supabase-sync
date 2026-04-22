// ════════════════════════════════════════════════════════════════════════════
// 🔧 FIX DE DATAS — Sales_avulsos (VENDAS AVULSAS)
// Substitua as funções converterParaISO() e formatarDataSmart() no seu
// Sales_avulsos_3.13.gs por estas versões robustas.
//
// PROBLEMA: as versões antigas usavam substring(0,10) direto e
// Session.getScriptTimeZone() pra converter Dates. Isso gerava off-by-one
// day quando o SmartSuite retornava datas com fuso horário,
// causando loop infinito de atualizações "Previsão/Dt. Emissão/Data H".
//
// FIX: sempre normaliza pra UTC. Agora compara "maçã com maçã".
// ════════════════════════════════════════════════════════════════════════════

/**
 * Converte QUALQUER formato de data pra YYYY-MM-DD em UTC.
 * Lida com: Date object, string ISO, string DD/MM/YYYY, null, vazio.
 */
function converterParaISO(valor) {
  if (!valor) return '';

  // Se é Date object (veio do Sheets)
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    // Usa UTC pra evitar problema de fuso
    return Utilities.formatDate(valor, 'UTC', 'yyyy-MM-dd');
  }

  var s = String(valor).trim();
  if (!s) return '';

  // Formato ISO: "2026-04-15" ou "2026-04-15T..."
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.substring(0, 10);
  }

  // Formato BR: "15/04/2026" ou "15/04/2026 00:00:00"
  var mBR = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mBR) {
    var dia = mBR[1].padStart(2, '0');
    var mes = mBR[2].padStart(2, '0');
    var ano = mBR[3];
    if (ano.length === 2) ano = '20' + ano;
    return ano + '-' + mes + '-' + dia;
  }

  // Fallback: tenta parsear como Date
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    }
  } catch(e) {}

  return '';
}

/**
 * Lê data do SmartSuite em YYYY-MM-DD (normaliza pra UTC).
 * Lida com todos os formatos: {to_date:{date:"..."}}, {date:"..."}, string direta.
 */
function formatarDataSmart(obj) {
  if (!obj) return '';

  var dateStr = '';
  if (obj.to_date && obj.to_date.date) dateStr = obj.to_date.date;
  else if (obj.date) dateStr = obj.date;
  else if (typeof obj === 'string') dateStr = obj;
  else if (typeof obj === 'object' && obj.from_date && obj.from_date.date) dateStr = obj.from_date.date;

  if (!dateStr) return '';

  // Se já tem o "Z" ou offset, parse correto e formata em UTC
  try {
    var d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
    }
  } catch(e) {}

  // Fallback: pega 10 primeiros chars se ISO simples
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }

  return '';
}
