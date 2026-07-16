"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";
import { fmtBRL, fmtNum, fmtDate } from "@/lib/format";

type Kind = "date" | "text" | "number" | "money" | "textarea";

/**
 * Célula editável inline — persiste em approval.approvals.
 * - kind="date" | "text" | "number" | "money"
 * - field: nome da coluna em approval.approvals (rc_numero, rc_descricao, …)
 *          OU 'custom:<slug>' pra gravar dentro de custom_fields[slug]
 * Visual amarelo-claro + borda tracejada sinalizando editável.
 */
export default function EditableCell({
  empresa,
  ncod_ped,
  modulo,
  field,
  kind,
  initialValue,
  trackHistory = false,
}: {
  empresa: string;
  ncod_ped: number;
  // Modulo do row atual (avulsos/pcs/projetos/standby). CRÍTICO pra RLS —
  // approvals_write checa can_write_module(modulo); hardcoding "avulsos" pra
  // um PC em /pcs faz o INSERT falhar pra qualquer user não-admin. (2026-07-16)
  modulo: "avulsos" | "projetos" | "pcs" | "standby";
  field: string;
  kind: Kind;
  initialValue: unknown;
  // Só faz sentido em field="custom:<slug>". Quando ativo, além de gravar
  // custom_fields[slug]=newVal, também grava:
  //   - custom_fields[slug_inicio] = 1º valor preenchido (fixo depois disso)
  //   - custom_fields[slug_hist]   = [{ v, at }, …] (append em toda troca)
  trackHistory?: boolean;
}) {
  const router = useRouter();
  const [value, setValue]   = useState<string>(toEditStr(initialValue, kind));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => { setValue(toEditStr(initialValue, kind)); }, [initialValue, kind]);

  // ncod_ped negativo = orphan (PV/OS do Omie sem approval row ainda). Não dá pra editar
  // direto; vamos criar a approval row no 1º save. ncod_ped positivo = PC real.
  const isOrphan = ncod_ped < 0;

  async function persist(newStr: string) {
    setSaving(true); setError(null);
    const supa = supaBrowser();
    // .schema("approval") explicito — @supabase/ssr nao respeita db.schema global
    // (sem isso, todas as edicoes inline caiam silenciosamente em public.approvals)
    const approval = supa.schema("approval" as never);

    const newVal = fromEditStr(newStr, kind);

    // custom_fields slug?
    if (field.startsWith("custom:")) {
      const slug = field.slice("custom:".length);
      const { data: row, error: re } = await approval
        .from("approvals")
        .select("custom_fields")
        .eq("empresa", empresa).eq("ncod_ped", ncod_ped)
        .maybeSingle();
      if (re) {
        setError(re.message);
        setValue(toEditStr(initialValue, kind)); // reverte
        alert(`❌ Não salvou:\n\n${re.message}`);
        setSaving(false); return;
      }
      const cf: Record<string, unknown> = { ...((row as { custom_fields?: object })?.custom_fields ?? {}) };
      const prevVal = cf[slug];
      if (newVal === null) delete cf[slug]; else cf[slug] = newVal;

      if (trackHistory && newVal !== null && newVal !== prevVal) {
        // Só registra renovações do usuário. O "início" é derivado no
        // client (dt_previsao do PC), então NÃO armazenamos aqui.
        const histKey = `${slug}_hist`;
        const rawHist = cf[histKey];
        const hist: Array<{ v: unknown; at: string }> = Array.isArray(rawHist)
          ? (rawHist as Array<{ v: unknown; at: string }>)
          : [];
        hist.push({ v: newVal, at: new Date().toISOString() });
        cf[histKey] = hist;
      }
      const { error: ue } = await approval
        .from("approvals")
        .upsert({ empresa, ncod_ped, modulo, custom_fields: cf },
                { onConflict: "empresa,ncod_ped" });
      if (ue) {
        setError(ue.message);
        setValue(toEditStr(initialValue, kind)); // reverte
        alert(`❌ Não salvou:\n\n${ue.message}`);
      }
      setSaving(false);
      if (!ue) router.refresh();
      return;
    }

    // Campo direto em approval.approvals
    const patch: Record<string, unknown> = { [field]: newVal };
    let saveErr: string | null = null;
    if (isOrphan) {
      // Cria approval row pra esse orphan — modulo vem do row atual.
      const { error: ue } = await approval
        .from("approvals")
        .upsert({ empresa, ncod_ped, modulo, source: "native", ...patch },
                { onConflict: "empresa,ncod_ped" });
      if (ue) saveErr = ue.message;
    } else {
      const { error: ue } = await approval
        .from("approvals")
        .upsert({ empresa, ncod_ped, modulo, ...patch },
                { onConflict: "empresa,ncod_ped" });
      if (ue) saveErr = ue.message;
    }
    if (saveErr) {
      setError(saveErr);
      // Limpa o valor digitado e volta pro original — bloqueia "duplicado parecer salvo"
      setValue(toEditStr(initialValue, kind));
      // Mostra alert pro user perceber que NÃO foi salvo
      alert(`❌ Não salvou:\n\n${saveErr}`);
    }
    setSaving(false);
    if (!saveErr) router.refresh();
  }

  function onBlur() {
    if (value !== toEditStr(initialValue, kind)) void persist(value);
  }
  function onKey(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    // Textarea permite Enter pra nova linha; só Ctrl/Cmd+Enter confirma
    if (kind === "textarea") {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
      if (e.key === "Escape") { setValue(toEditStr(initialValue, kind)); (e.target as HTMLTextAreaElement).blur(); }
      return;
    }
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
    if (e.key === "Escape") { setValue(toEditStr(initialValue, kind)); (e.target as HTMLInputElement).blur(); }
  }

  // Variação D — "ink underline": sem fundo amarelo cheio, apenas dashed
  // border-bottom no idle. Em focus/edit recebe background sutil + linha sólida.
  const base =
    `px-1 py-0.5 text-[11.5px] bg-transparent rounded-sm ` +
    `border-0 border-b border-dashed border-ww-border ` +
    `${saving ? "border-ww-editLine animate-pulse" : ""} ` +
    `${error ? "border-rose-400 bg-rose-50/60 dark:bg-rose-950/30" : ""} ` +
    `text-ww-text caret-ww-editLine cursor-text ` +
    `focus:outline-none focus:bg-ww-editHi focus:border-b-2 focus:border-ww-editLine focus:border-solid ` +
    `hover:border-ww-borderStrong transition-colors`;

  if (kind === "date") {
    return (
      <input type="date" value={value}
        onChange={(e) => setValue(e.target.value)} onBlur={onBlur} onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        className={`${base} w-[120px]`}
        title={error ?? "Editável"} />
    );
  }

  if (kind === "textarea") {
    return (
      <textarea value={value}
        onChange={(e) => setValue(e.target.value)} onBlur={onBlur} onKeyDown={onKey}
        onClick={(e) => e.stopPropagation()}
        rows={2}
        className={`${base} w-[220px] min-h-[40px] resize-y align-top leading-snug`}
        placeholder="Escreva aqui…"
        title={error ?? "Editável — Cmd/Ctrl+Enter confirma"} />
    );
  }

  const isNum = kind === "number" || kind === "money";
  // Widths específicos por field:
  //   pc_numero_manual: 4 dígitos típicos → ~70px centralizado
  //   rc_numero:        4-5 dígitos → ~90px centralizado
  //   demais text:      180px
  //   number/money:     100px centralizado (com tabular-nums)
  const fieldWidth =
    field === "pc_numero_manual" ? "w-[70px] text-center font-mono" :
    field === "rc_numero" ? "w-[90px] text-center font-mono" :
    kind === "text" ? "w-[180px]" :
    "w-[100px] text-center tabular-nums";

  const inputEl = (
    <input type="text"
      inputMode={isNum ? "decimal" : "text"}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onBlur} onKeyDown={onKey}
      onClick={(e) => e.stopPropagation()}
      className={`${base} ${fieldWidth}`}
      placeholder={kind === "number" ? "0" : ""}
      title={error ?? "Editável"} />
  );

  // money: prefixa "R$" inline antes do input pra deixar claro a unidade
  if (kind === "money") {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="text-[10px] font-semibold text-ww-textMuted">R$</span>
        {inputEl}
      </span>
    );
  }

  return inputEl;
}

function toEditStr(v: unknown, kind: Kind): string {
  if (v == null || v === "") return "";
  if (kind === "date") {
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const m2 = s.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (m2) return m2[1];
    return "";
  }
  if (kind === "number" || kind === "money") {
    const n = Number(v);
    if (!Number.isFinite(n)) return "";
    // Mostra com vírgula (padrão BR). Aceita dot/vírgula na leitura.
    return String(n).replace(".", ",");
  }
  return String(v);
}

function fromEditStr(s: string, kind: Kind): unknown {
  const t = s.trim();
  if (t === "") return null;
  if (kind === "date") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    return null;
  }
  if (kind === "number" || kind === "money") {
    const n = Number(t.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return t;
}
