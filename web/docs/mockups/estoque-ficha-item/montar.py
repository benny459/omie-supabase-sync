"""Monta o mockup: template.html + base.css + data.js -> ../estoque-ficha-item.html
data.js vem de build_data.py (pos.json, mov.json, pcs.json exportados do omie-data; SQL no briefing)."""
import pathlib, datetime, sys
d = pathlib.Path(__file__).parent
dados = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else d
t = (d / "template.html").read_text()
t = t.replace("{{CSS}}", (d / "base.css").read_text()).replace("{{GERADO}}", datetime.date.today().isoformat())
t = t.replace("{{DATA}}", (dados / "data.js").read_text().replace("</", "<\\/"))
(d.parent / "estoque-ficha-item.html").write_text(t)
print("ok", len(t.encode()) // 1024, "KB")
