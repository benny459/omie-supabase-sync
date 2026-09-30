import Link from "next/link";

/** Rodapé das telas Navy: caminho de volta à tela antiga, para comparar. */
export default function LinkClassica({ href, novo = false }: { href: string; novo?: boolean }) {
  return (
    <div style={{ textAlign: "right", marginTop: novo ? 0 : -36, fontSize: 12 }}>
      <Link href={href} style={{ color: novo ? "var(--ww-accent-text)" : "var(--ww-text-faint)", textDecoration: "underline" }}>
        {novo ? "Ver tela nova" : "tela clássica"}
      </Link>
    </div>
  );
}
