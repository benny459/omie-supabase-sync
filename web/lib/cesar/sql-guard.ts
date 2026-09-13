/**
 * Guardião das consultas sob medida do Cesar (13/09/2026).
 *
 * Quando falta ferramenta pronta, o Cesar monta um SELECT na hora — e este
 * módulo é o que torna isso seguro. Defesa em camadas:
 *   1. este validador recusa qualquer coisa que não seja UMA leitura;
 *   2. quem executa é a função bi.cesar_consulta_livre no Postgres, que só
 *      aceita SELECT/WITH, bloqueia palavras de escrita de novo e roda com
 *      statement_timeout de 8s e teto de 200 linhas;
 *   3. a função só é executável pelo service_role — o navegador nunca a vê.
 *
 * Puro e exportado para testes de contrato baterem nele sem servidor.
 */

const PROIBIDOS = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|call|do|execute|merge|refresh|reindex|comment|listen|notify|set|reset|begin|commit|rollback|savepoint|lock|prepare|deallocate)\b/i;
const SENSIVEIS = /password|senha|password_hash|token|secret|api_key|apikey/i;

export function validarSqlLeitura(sql: string): { ok: boolean; motivo?: string } {
  const s = String(sql || "").trim();
  if (!s) return { ok: false, motivo: "consulta vazia" };
  if (s.length > 2400) return { ok: false, motivo: "consulta longa demais" };
  // um comando só — ';' no meio é tentativa de empilhar comandos
  if (s.replace(/;\s*$/, "").includes(";")) return { ok: false, motivo: "apenas uma consulta por vez" };
  const semComentarios = s.replace(/--.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const inicio = semComentarios.trim().slice(0, 6).toLowerCase();
  if (!inicio.startsWith("select") && !inicio.startsWith("with")) {
    return { ok: false, motivo: "só consultas de leitura (SELECT/WITH)" };
  }
  if (PROIBIDOS.test(semComentarios)) return { ok: false, motivo: "a consulta contém um comando que não é de leitura" };
  if (SENSIVEIS.test(semComentarios)) return { ok: false, motivo: "a consulta toca em dados sigilosos (senhas/chaves)" };
  return { ok: true };
}

/** Tira o ; final — a função do banco recusa qualquer ; por segurança. */
export function limparSql(sql: string): string {
  return String(sql).trim().replace(/;\s*$/, "");
}
