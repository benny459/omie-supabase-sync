"use client";
// Índice lateral do manual com busca. Esconde as páginas de módulos que a
// pessoa não acessa (mesma regra da barra: canViewArea).
import Link from "next/link";
import { useMemo, useState } from "react";
import { useUserPerms } from "../UserPermsProvider";
import { canViewArea, type Area } from "@/lib/permissions";

export type ItemIndice = { slug: string; titulo: string; icone: string; area: string | null; texto: string };

export default function ManualIndice({ itens, atual }: { itens: ItemIndice[]; atual: string | null }) {
  const perms = useUserPerms();
  const [q, setQ] = useState("");
  const visiveis = useMemo(() => itens.filter((p) => !p.area || canViewArea(perms, p.area as Area)), [itens, perms]);
  const termo = q.trim().toLowerCase();
  const lista = termo
    ? visiveis.filter((p) => (p.titulo + " " + p.texto).toLowerCase().includes(termo))
    : visiveis;
  return (
    <nav className="mn-indice" aria-label="Páginas do manual">
      <input className="mn-busca" placeholder="Buscar no manual…" value={q} onChange={(e) => setQ(e.target.value)} />
      {termo && <div className="mn-res">{lista.length} página(s) com “{q.trim()}”</div>}
      <ul>
        <li><Link href="/manual" data-on={atual === null ? "1" : undefined}>📘 Visão geral</Link></li>
        {lista.map((p) => (
          <li key={p.slug}>
            <Link href={`/manual/${p.slug}${termo ? `?q=${encodeURIComponent(q.trim())}` : ""}`} data-on={atual === p.slug ? "1" : undefined}>
              <span aria-hidden>{p.icone}</span> {p.titulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
