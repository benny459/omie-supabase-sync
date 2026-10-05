// Corpo de uma página do manual (markdown → HTML). Server component.
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode } from "react";

function textoDe(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textoDe).join("");
  if (typeof n === "object" && "props" in (n as object)) return textoDe((n as { props: { children?: ReactNode } }).props.children);
  return "";
}

export default function ManualConteudo({ corpo }: { corpo: string }) {
  return (
    <div className="mn-corpo">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          blockquote: ({ children }) => {
            const t = textoDe(children).trim().toLowerCase();
            const tipo = t.startsWith("atenção") ? "atencao" : t.startsWith("dica") ? "dica" : "nota";
            return <blockquote className={`mn-aviso mn-${tipo}`}>{children}</blockquote>;
          },
          a: ({ href, children }) => {
            const externo = !!href && /^https?:/.test(href);
            return <a href={href} target={externo ? "_blank" : undefined} rel={externo ? "noreferrer" : undefined}>{children}</a>;
          },
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="mn-img" loading="lazy" />
          ),
          table: ({ children }) => <div className="mn-tabela"><table>{children}</table></div>,
        }}
      >
        {corpo}
      </ReactMarkdown>
    </div>
  );
}
