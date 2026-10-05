"use client";
// Ao abrir qualquer tela: traz a aparência gravada no banco (a mesma do portal
// e dos Serviços) e segue o sistema operativo quando o modo é "Sistema".
import { useEffect } from "react";
import { aplicar } from "@/lib/aparencia";
import { carregarDoBanco, obterAparencia } from "@/lib/aparencia-store";

export default function AparenciaSync() {
  useEffect(() => {
    carregarDoBanco().catch(() => null);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const seguir = () => { if (obterAparencia().modo === "sistema") aplicar(obterAparencia()); };
    mq.addEventListener("change", seguir);
    return () => mq.removeEventListener("change", seguir);
  }, []);
  return null;
}
