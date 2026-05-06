#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🛟 BUG REPORTER — relata falhas de sync pra Supabase central de bugs
─────────────────────────────────────────────────────────────────────────────
Cria automaticamente bug + bug_session com status 'submetida' quando algum
import script quebra. A sessão Claude Code que poll esses Supabase pega
e tenta resolver.

Schema esperado: tabelas bugs + bug_sessions (kit central-bugs-kit).

Uso:
  from _bug_reporter import report_sync_failure
  try:
      main()
  except Exception as e:
      report_sync_failure("import_itens_vendidos", e, {"empresa": "SF"})
      raise

Sem deps externas — só stdlib.
═════════════════════════════════════════════════════════════════════════════
"""
import json
import os
import socket
import sys
import time
import traceback
import urllib.error
import urllib.request

EMPRESA_ID = "b1bf590f-c281-41f8-9968-a70b0dc02b31"
REPORTER_EMAIL = "omie-sync@waterworks.com.br"
REPORTER_NOME = "Omie sync (system)"


def _post(url: str, key: str, payload: dict, timeout: int = 10) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def report_sync_failure(script_name: str, exc: BaseException, context: dict | None = None) -> bool:
    """Posts a bug + auto-submitted session to the central de bugs Supabase.

    Returns True on success, False on failure (best-effort, never raises).
    """
    sb_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not sb_url or not sb_key:
        print(f"⚠️ bug-reporter: SUPABASE_URL/KEY ausentes — não vou registrar a falha.", file=sys.stderr)
        return False

    tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    desc_lines = [
        f"SYNC FAILURE em {script_name}",
        f"Host: {socket.gethostname()}",
        f"Python: {sys.version.split()[0]}",
        f"Erro: {type(exc).__name__}: {exc}",
    ]
    if context:
        desc_lines.append("")
        desc_lines.append("Contexto:")
        for k, v in context.items():
            desc_lines.append(f"  {k}: {v}")
    desc_lines.append("")
    desc_lines.append("Traceback:")
    desc_lines.append(tb)
    descricao = "\n".join(desc_lines)[:8000]

    try:
        sess = _post(
            f"{sb_url}/rest/v1/bug_sessions",
            sb_key,
            {
                "empresa_id": EMPRESA_ID,
                "reporter_email": REPORTER_EMAIL,
                "reporter_nome": REPORTER_NOME,
                "status": "submetida",
                "bug_count": 1,
                "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "resumo": f"{script_name}: {type(exc).__name__}",
            },
        )
        session_id = sess[0]["id"] if isinstance(sess, list) and sess else sess.get("id")
        if not session_id:
            return False

        bug_payload = {
            "empresa_id": EMPRESA_ID,
            "session_id": session_id,
            "reporter_email": REPORTER_EMAIL,
            "reporter_nome": REPORTER_NOME,
            "titulo": f"Sync falhou: {script_name}",
            "descricao": descricao,
            "url": f"omie-supabase-sync/scripts/{script_name}.py",
            "user_agent": f"python/{sys.version.split()[0]} {sys.platform}",
            "contexto": context or {},
            "mensagens": [
                {"role": "user", "content": descricao},
            ],
            "status": "aberto",
        }
        bug = _post(f"{sb_url}/rest/v1/bugs", sb_key, bug_payload)
        bug_id = bug[0].get("id") if isinstance(bug, list) and bug else bug.get("id")
        ticket_code = bug[0].get("ticket_code") if isinstance(bug, list) and bug else bug.get("ticket_code")
        print(f"🛟 bug-reporter: ticket {ticket_code or bug_id} criado pra {script_name}", file=sys.stderr)
        return True
    except urllib.error.HTTPError as he:
        try:
            err_body = he.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            err_body = ""
        print(f"⚠️ bug-reporter HTTPError {he.code}: {err_body}", file=sys.stderr)
        return False
    except Exception as e:
        print(f"⚠️ bug-reporter: falha ao registrar — {type(e).__name__}: {e}", file=sys.stderr)
        return False
