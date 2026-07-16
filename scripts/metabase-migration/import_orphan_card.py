#!/usr/bin/env python3
"""
Import a single Mac Mini card into Hetzner v0.61 (used for CRM card after CRM DB got connected late).

Usage:
    HETZNER_MB_URL=... HETZNER_SESSION=... MAC_CARD_ID=50 python3 import_orphan_card.py
"""

import copy
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SECRETS = HERE / "secrets"
RAW = Path("/tmp/mb-migration-2026-07-02/raw")


def http(method, url, token=None, body=None, timeout=60, retries=2):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Metabase-Session"] = token
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return json.loads(b.decode()) if b else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body[:400]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def remap_in_place(obj, field_map, card_remap):
    if isinstance(obj, list):
        if len(obj) >= 2 and obj[0] == "field" and isinstance(obj[1], int) and obj[1] in field_map:
            obj[1] = field_map[obj[1]]
        for it in obj:
            remap_in_place(it, field_map, card_remap)
    elif isinstance(obj, dict):
        for k, v in list(obj.items()):
            if k == "source-table" and isinstance(v, str) and v.startswith("card__"):
                try:
                    old_id = int(v.split("__", 1)[1])
                    if old_id in card_remap:
                        obj[k] = f"card__{card_remap[old_id]}"
                except ValueError:
                    pass
            elif k in ("card_id", "source_card_id") and isinstance(v, int) and v in card_remap:
                obj[k] = card_remap[v]
            elif k == "field_id" and isinstance(v, int) and v in field_map:
                obj[k] = field_map[v]
            else:
                remap_in_place(v, field_map, card_remap)


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    session = os.environ["HETZNER_SESSION"]
    mac_card_id = int(os.environ["MAC_CARD_ID"])

    state = json.loads((SECRETS / "hetzner_v061_state.json").read_text())
    db_remap = {int(k): int(v) for k, v in state["db_id_remap"].items()}
    card_remap = {int(k): int(v) for k, v in state.get("card_id_remap", {}).items()}
    print(f"db_remap: {db_remap}")

    # rebuild field_map for CRM DB (we only need this DB for this card)
    src = json.loads((RAW / "card_full" / f"{mac_card_id}.json").read_text())
    src_db_id = src.get("database_id") or (src.get("dataset_query") or {}).get("database")
    hetz_db_id = db_remap[src_db_id]
    print(f"card {mac_card_id} '{src.get('name')}' → mac_db={src_db_id} → hetz_db={hetz_db_id}")

    mac_meta_file = RAW / "database_full" / f"{src_db_id}.json"
    field_map = {}
    if mac_meta_file.exists():
        mac_meta = json.loads(mac_meta_file.read_text())
        hetz_meta = http("GET", f"{base}/api/database/{hetz_db_id}/metadata", session)
        lookup = {(t.get('schema') or '', t.get('name'), f.get('name')): f['id']
                  for t in hetz_meta.get('tables', []) for f in t.get('fields', [])}
        for t in mac_meta.get("tables", []):
            for f in t.get("fields", []):
                key = (t.get('schema') or '', t.get('name'), f.get('name'))
                if key in lookup:
                    field_map[f['id']] = lookup[key]
    print(f"field_map size: {len(field_map)}")

    # collection remap: id 5 (WaterWorks BI on Mac Mini) → id 5 (WaterWorks BI on Hetzner, from earlier import)
    target_coll = 5  # hard-coded — matches import script's ensure_collection result

    payload = copy.deepcopy(src)
    if payload.get("database_id") in db_remap:
        payload["database_id"] = db_remap[payload["database_id"]]
    payload["collection_id"] = target_coll

    dq = payload.get("dataset_query") or {}
    if dq.get("database") in db_remap:
        dq["database"] = db_remap[dq["database"]]
    remap_in_place(dq, field_map, card_remap)
    remap_in_place(payload.get("result_metadata") or [], field_map, card_remap)
    remap_in_place(payload.get("visualization_settings") or {}, field_map, card_remap)
    remap_in_place(payload.get("parameters") or [], field_map, card_remap)
    remap_in_place(payload.get("parameter_mappings") or [], field_map, card_remap)

    strip = {"id", "creator_id", "created_at", "updated_at", "entity_id", "public_uuid",
             "made_public_by_id", "public_uuid_at", "moderation_reviews", "creator",
             "collection", "dashboard_count", "average_query_time", "last_query_start",
             "based_on_upload", "dashboard_id", "in_public_dashboard", "can_write",
             "can_restore", "can_delete", "can_run_adhoc_query", "initially_published_at",
             "archived_directly", "cache_invalidated_at", "last_used_at"}
    body = {k: v for k, v in payload.items() if k not in strip}

    r = http("POST", f"{base}/api/card", session, body=body)
    new_id = r["id"]
    print(f"created card #{new_id}")
    card_remap[mac_card_id] = new_id
    state["card_id_remap"] = card_remap
    (SECRETS / "hetzner_v061_state.json").write_text(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()
