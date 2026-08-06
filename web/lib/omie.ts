/**
 * Cliente da API Omie — escrita de data de previsão.
 *
 * Portado de waterworks-bi/src/lib/omie.ts, que rodou em produção entre 08 e
 * 16/06/2026 (23 sincronizações com sucesso, registradas em
 * finance.omie_sync_log). O comportamento é o mesmo; mudou só o entorno.
 *
 * Doc: https://developer.omie.com.br/service-list/
 *   POST /financas/contapagar/    call: AlterarContaPagar
 *   POST /financas/contareceber/  call: AlterarContaReceber
 *
 * A armadilha desta API, e a razão de o retorno ser inspecionado no corpo: o
 * Omie responde HTTP 200 mesmo quando a operação falha, sinalizando o erro em
 * `faultstring`/`faultcode`. Confiar no status HTTP faria a tela dizer "gravado"
 * para alterações que não aconteceram.
 */

const OMIE_BASE = "https://app.omie.com.br/api/v1/financas";

/** Credenciais por empresa. Hoje só a Safe escreve — é dela a conta que ancora
 *  a projeção. Deixar explícito por empresa evita mandar título da CDG com a
 *  chave da Safe, que o Omie aceitaria e aplicaria no lugar errado. */
function getCreds(empresa: string) {
  const suf = empresa.toUpperCase();
  const app_key = process.env[`OMIE_APP_KEY_${suf}`];
  const app_secret = process.env[`OMIE_APP_SECRET_${suf}`];
  if (!app_key || !app_secret) {
    throw new Error(
      `OMIE_APP_KEY_${suf} e OMIE_APP_SECRET_${suf} não configurados no ambiente`,
    );
  }
  return { app_key, app_secret };
}

/** YYYY-MM-DD → dd/mm/aaaa, que é o formato que o Omie exige. */
export function dateToOmie(yyyy_mm_dd: string): string {
  const [y, m, d] = yyyy_mm_dd.split("-");
  return `${d}/${m}/${y}`;
}

export type OmieResult = {
  ok: boolean;
  http_status: number;
  body: string;
  error?: string;
};

export async function alterarPrevisao(
  natureza: "R" | "P",
  codigo_lancamento_omie: number,
  dt_previsao_yyyymmdd: string,
  empresa = "SF",
): Promise<OmieResult> {
  let creds: { app_key: string; app_secret: string };
  try {
    creds = getCreds(empresa);
  } catch (err) {
    return {
      ok: false, http_status: 0, body: "",
      error: err instanceof Error ? err.message : "credenciais ausentes",
    };
  }

  const isPagar = natureza === "P";
  const url = `${OMIE_BASE}/${isPagar ? "contapagar" : "contareceber"}/`;

  const payload = {
    call: isPagar ? "AlterarContaPagar" : "AlterarContaReceber",
    app_key: creds.app_key,
    app_secret: creds.app_secret,
    param: [{ codigo_lancamento_omie, data_previsao: dateToOmie(dt_previsao_yyyymmdd) }],
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();

    let ok = resp.ok;
    let errorMsg: string | undefined;
    try {
      const json = JSON.parse(text);
      // 200 com faultstring = falhou. Ver o comentário do topo.
      if (json.faultcode || json.faultstring) {
        ok = false;
        errorMsg = json.faultstring || json.faultcode;
      }
    } catch {
      if (!resp.ok) {
        ok = false;
        errorMsg = `Resposta não-JSON (HTTP ${resp.status})`;
      }
    }
    // body truncado: vai pro log e não precisa do HTML inteiro de uma página
    // de erro.
    return { ok, http_status: resp.status, body: text.slice(0, 4000), error: errorMsg };
  } catch (err: unknown) {
    return {
      ok: false, http_status: 0, body: "",
      error: err instanceof Error ? err.message : "erro desconhecido",
    };
  }
}
