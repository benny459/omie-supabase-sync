"use client";
// NCM do item na ficha do Estoque (05/10/26): mostra o NCM efetivo, avisa se falta
// ou é inválido e abre o localizador, gravando no cadastro do item.
import { useEffect, useState } from "react";
import LocalizarNcm, { ncmFmt } from "./LocalizarNcm";

export default function NcmDoItem({ emp, codigo, descricao, onSalvo }: { emp: string; codigo: string; descricao: string; onSalvo?: () => void }) {
  const [info, setInfo] = useState<{ ncm: string | null; valido: boolean } | null>(null);
  const [aberto, setAberto] = useState(false);
  const carregar = () => fetch(`/api/fiscal/ncm?op=item&emp=${emp}&cod=${encodeURIComponent(codigo)}`).then((r) => r.json())
    .then((j) => setInfo({ ncm: j.ncm ?? null, valido: !!j.valido })).catch(() => setInfo({ ncm: null, valido: false }));
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [emp, codigo]);
  if (!info) return null;
  return (
    <>
      {info.ncm && info.valido
        ? <span>NCM {ncmFmt(info.ncm)} <button type="button" className="ncm-btn" onClick={() => setAberto(true)}>trocar</button></span>
        : <span><button type="button" className="ncm-btn alerta" onClick={() => setAberto(true)}>{info.ncm ? `NCM ${ncmFmt(info.ncm)} inválido — localizar` : "sem NCM — localizar"}</button></span>}
      {aberto && <LocalizarNcm emp={emp} descricao={descricao} codigo={codigo} atual={info.ncm}
        onFechar={() => setAberto(false)}
        onEscolher={(_ncm, salvo) => { setAberto(false); if (salvo) { carregar(); onSalvo?.(); } }} />}
    </>
  );
}
