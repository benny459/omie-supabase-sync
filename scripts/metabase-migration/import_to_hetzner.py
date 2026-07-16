#!/usr/bin/env python3
"""
Import Mac Mini state (raw JSON export) into Hetzner v0.61 Metabase via API.

Reads:
  /tmp/mb-migration-2026-07-02/raw/  (from export_from_mac_mini.py)
  scripts/metabase-migration/secrets/hetzner_v061_state.json  (from bootstrap_hetzner.py)

Writes:
  scripts/metabase-migration/secrets/hetzner_v061_state.json  (updated with card_id + dashboard_id remaps)

Assumes DB connections already exist on Hetzner and schemas already synced.

Strategy:
  1. Build field_id remap (mac_field_id -> hetzner_field_id) using table_name + field_name as join key.
  2. Create WaterWorks BI collection.
  3. Topo-sort cards by inter-card references (source-table: "card__N").
  4. For each card: remap database_id, collection_id, field ids inside dataset_query and result_metadata → POST /api/card.
  5. For each dashboard: POST shell (name/description/collection_id), then create tabs + parameters + dashcards with remapped card_ids.

Usage:
    HETZNER_MB_URL=... HETZNER_SESSION=... python3 import_to_hetzner.py
"""

import copy
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SECRETS = HERE / "secrets"
RAW = Path("/tmp/mb-migration-2026-07-02/raw")

TARGET_COLLECTION_NAME = "WaterWorks BI"
SKIP_COLLECTIONS = {"Coleção pessoal de Benny A", "Examples"}
SKIP_DATABASES_FOR_CARDS = {1}  # Mac Mini H2 Sample — skip its cards


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
                body_bytes = r.read()
                if not body_bytes:
                    return {}
                return json.loads(body_bytes.decode())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body[:500]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def build_field_map(base, session, db_remap):
    """
    Returns {mac_field_id: hetzner_field_id} using (schema, table, field_name) as join key.
    """
    field_map = {}
    for mac_db_id, hetz_db_id in db_remap.items():
        mac_db_id, hetz_db_id = int(mac_db_id), int(hetz_db_id)
        mac_meta_file = RAW / "database_full" / f"{mac_db_id}.json"
        if not mac_meta_file.exists():
            print(f"  skip DB {mac_db_id}: no mac metadata dump")
            continue
        mac_meta = json.loads(mac_meta_file.read_text())
        hetz_meta = http("GET", f"{base}/api/database/{hetz_db_id}/metadata", session)

        # Build lookup from Hetzner side
        hetz_lookup = {}
        for t in hetz_meta.get("tables", []):
            for f in t.get("fields", []):
                key = (t.get("schema") or "", t.get("name"), f.get("name"))
                hetz_lookup[key] = f["id"]

        matched, unmatched = 0, 0
        for t in mac_meta.get("tables", []):
            for f in t.get("fields", []):
                key = (t.get("schema") or "", t.get("name"), f.get("name"))
                new_id = hetz_lookup.get(key)
                if new_id:
                    field_map[f["id"]] = new_id
                    matched += 1
                else:
                    unmatched += 1
        print(f"  DB {mac_db_id}→{hetz_db_id}: matched {matched} fields, {unmatched} unmatched")
    return field_map


def remap_in_place(obj, field_map, card_remap):
    """
    Walk any nested structure and rewrite:
      - integer field references in MBQL v1 shape: ['field', <id>, opts]
      - integer field references in MBQL 2.0 shape: ['field', <opts_dict>, <id>]
        (v0.61 card_schema >= 22 uses this form in template-tag dimensions)
      - "source-table": "card__<id>" strings
      - "card_id" / "source_card_id" keys
    """
    if isinstance(obj, list):
        # MBQL v1: ['field', <int_id>, <opts>]
        if len(obj) >= 2 and obj[0] == "field" and isinstance(obj[1], int):
            if obj[1] in field_map:
                obj[1] = field_map[obj[1]]
        # MBQL 2.0: ['field', <opts_dict>, <int_id>]  — used in template-tag dimensions on card_schema >= 22
        elif len(obj) >= 3 and obj[0] == "field" and isinstance(obj[1], dict) and isinstance(obj[2], int):
            if obj[2] in field_map:
                obj[2] = field_map[obj[2]]
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


def topo_sort_cards(cards):
    """
    Sort cards so that any card referencing another (via source-table card__N) comes AFTER it.
    """
    by_id = {c["id"]: c for c in cards}
    deps = {c["id"]: set() for c in cards}

    def walk(o, out):
        if isinstance(o, list):
            for it in o:
                walk(it, out)
        elif isinstance(o, dict):
            for k, v in o.items():
                if k == "source-table" and isinstance(v, str) and v.startswith("card__"):
                    try:
                        out.add(int(v.split("__", 1)[1]))
                    except ValueError:
                        pass
                walk(v, out)

    for cid, c in by_id.items():
        refs = set()
        walk(c.get("dataset_query", {}), refs)
        deps[cid] = refs & set(by_id.keys())

    visited, order = set(), []

    def visit(cid, stack):
        if cid in visited:
            return
        if cid in stack:
            return  # cycle, break
        stack.add(cid)
        for d in deps.get(cid, ()):
            visit(d, stack)
        stack.discard(cid)
        visited.add(cid)
        order.append(cid)

    for cid in by_id.keys():
        visit(cid, set())
    return [by_id[i] for i in order]


def ensure_collection(base, session, name, parent_id=None):
    existing = http("GET", f"{base}/api/collection", session)
    for c in existing:
        if c.get("name") == name and c.get("parent_id") == parent_id:
            return c["id"]
    body = {"name": name, "color": "#509EE3", "parent_id": parent_id}
    r = http("POST", f"{base}/api/collection", session, body=body)
    return r["id"]


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    session = os.environ["HETZNER_SESSION"]

    state = json.loads((SECRETS / "hetzner_v061_state.json").read_text())
    db_remap = {int(k): int(v) for k, v in state["db_id_remap"].items()}
    print(f"db_remap: {db_remap}")

    print("building field_id remap ...")
    field_map = build_field_map(base, session, db_remap)
    print(f"total fields remapped: {len(field_map)}")

    # ensure target collection
    target_coll_id = ensure_collection(base, session, TARGET_COLLECTION_NAME)
    print(f"target collection '{TARGET_COLLECTION_NAME}': id={target_coll_id}")

    # load Mac Mini collections to build (mac_coll_id -> hetzner_coll_id) map
    mac_colls = json.loads((RAW / "collection.json").read_text())
    mac_coll_by_id = {c["id"]: c for c in mac_colls}
    coll_remap = {}
    for c in mac_colls:
        if c["id"] == "root":
            coll_remap["root"] = None  # posts without collection_id land in root
        elif c.get("name") == TARGET_COLLECTION_NAME:
            coll_remap[c["id"]] = target_coll_id

    # load cards (skip Sample DB + skip cards in Personal/Examples collections)
    all_cards = []
    for f in (RAW / "card_full").iterdir():
        c = json.loads(f.read_text())
        db_id = c.get("database_id") or (c.get("dataset_query") or {}).get("database")
        if db_id in SKIP_DATABASES_FOR_CARDS:
            continue
        coll = c.get("collection_id")
        if coll and coll in mac_coll_by_id and mac_coll_by_id[coll].get("name") in SKIP_COLLECTIONS:
            continue
        all_cards.append(c)
    print(f"cards to import: {len(all_cards)}")

    ordered_cards = topo_sort_cards(all_cards)
    print(f"topo-sorted: {len(ordered_cards)}")

    card_remap = {}  # mac_card_id -> hetzner_card_id
    fail_cards = []
    for c in ordered_cards:
        payload = copy.deepcopy(c)
        # remap db + collection
        if payload.get("database_id") in db_remap:
            payload["database_id"] = db_remap[payload["database_id"]]
        if payload.get("collection_id") in coll_remap:
            payload["collection_id"] = coll_remap[payload["collection_id"]]

        # remap dataset_query
        dq = payload.get("dataset_query") or {}
        if dq.get("database") in db_remap:
            dq["database"] = db_remap[dq["database"]]
        remap_in_place(dq, field_map, card_remap)
        remap_in_place(payload.get("result_metadata") or [], field_map, card_remap)
        remap_in_place(payload.get("visualization_settings") or {}, field_map, card_remap)
        remap_in_place(payload.get("parameters") or [], field_map, card_remap)
        remap_in_place(payload.get("parameter_mappings") or [], field_map, card_remap)

        # strip fields Metabase populates itself
        strip = {"id", "creator_id", "created_at", "updated_at", "entity_id", "public_uuid",
                 "made_public_by_id", "public_uuid_at", "moderation_reviews", "creator",
                 "collection", "dashboard_count", "average_query_time", "last_query_start",
                 "based_on_upload", "dashboard_id", "in_public_dashboard", "can_write",
                 "can_restore", "can_delete", "can_run_adhoc_query", "initially_published_at",
                 "archived_directly", "cache_invalidated_at", "last_used_at"}
        body = {k: v for k, v in payload.items() if k not in strip}

        try:
            r = http("POST", f"{base}/api/card", session, body=body)
            card_remap[c["id"]] = r["id"]
        except RuntimeError as e:
            fail_cards.append((c["id"], c.get("name"), str(e)[:200]))
    print(f"cards created: {len(card_remap)} · failed: {len(fail_cards)}")
    if fail_cards:
        print("  failures:")
        for fid, name, err in fail_cards[:20]:
            print(f"    #{fid} '{name}': {err}")

    # dashboards
    dash_remap = {}
    fail_dashes = []
    dashboard_files = sorted((RAW / "dashboard_full").iterdir(), key=lambda p: int(p.stem))
    for f in dashboard_files:
        d = json.loads(f.read_text())
        # skip Examples dashboards
        coll = d.get("collection_id")
        if coll and coll in mac_coll_by_id and mac_coll_by_id[coll].get("name") in SKIP_COLLECTIONS:
            continue

        # 1. create shell
        shell = {
            "name": d["name"],
            "description": d.get("description"),
            "collection_id": coll_remap.get(coll, target_coll_id),
        }
        try:
            new_dash = http("POST", f"{base}/api/dashboard", session, body=shell)
            new_id = new_dash["id"]
            dash_remap[d["id"]] = new_id
        except RuntimeError as e:
            fail_dashes.append((d["id"], d["name"], str(e)[:200]))
            continue

        # 2. remap parameters (may reference field ids in mappings)
        params = copy.deepcopy(d.get("parameters") or [])
        remap_in_place(params, field_map, card_remap)

        # 3. remap tabs (v0.61 supports dashboard tabs)
        tabs = copy.deepcopy(d.get("tabs") or [])
        # tabs have their own ids we can't reuse; strip and rely on PUT to assign
        tab_id_remap = {}
        for t in tabs:
            old_tab_id = t.pop("id", None)
            t.pop("dashboard_id", None)
            t.pop("created_at", None)
            t.pop("updated_at", None)
            t.pop("entity_id", None)
            tab_id_remap[old_tab_id] = None  # will fill after PUT if returned

        # 4. remap dashcards
        dashcards = copy.deepcopy(d.get("dashcards") or d.get("ordered_cards") or [])
        clean_dcs = []
        for dc in dashcards:
            new_dc = {
                "id": -abs(hash(str(dc.get("id","")))) % 100000 - 1,  # negative placeholder
                "card_id": card_remap.get(dc.get("card_id")) if dc.get("card_id") else None,
                "row": dc.get("row"),
                "col": dc.get("col"),
                "size_x": dc.get("size_x"),
                "size_y": dc.get("size_y"),
                "series": [{"id": card_remap[s["id"]]} for s in (dc.get("series") or []) if s.get("id") in card_remap],
                "visualization_settings": dc.get("visualization_settings") or {},
                "parameter_mappings": dc.get("parameter_mappings") or [],
                "dashboard_tab_id": None,  # patched after we know tabs
            }
            # preserve dashboard_tab_id via placeholder
            if dc.get("dashboard_tab_id"):
                new_dc["_mac_tab_id"] = dc["dashboard_tab_id"]
            remap_in_place(new_dc["parameter_mappings"], field_map, card_remap)
            remap_in_place(new_dc["visualization_settings"], field_map, card_remap)
            clean_dcs.append(new_dc)

        # PUT dashboard with tabs first (to get new tab ids)
        put_body = {"parameters": params}
        if tabs:
            put_body["tabs"] = tabs
        try:
            r = http("PUT", f"{base}/api/dashboard/{new_id}", session, body=put_body)
            # extract new tab ids from response
            new_tabs = r.get("tabs") or []
            # match by name (order preserved)
            for old, new in zip(list(tab_id_remap.keys()), new_tabs):
                tab_id_remap[old] = new["id"]
        except RuntimeError as e:
            print(f"  dashboard #{d['id']} PUT tabs failed: {e}")

        # patch dashcards with correct tab ids
        for dc in clean_dcs:
            mac_tab = dc.pop("_mac_tab_id", None)
            if mac_tab and mac_tab in tab_id_remap:
                dc["dashboard_tab_id"] = tab_id_remap[mac_tab]

        # PUT dashcards
        if clean_dcs:
            try:
                http("PUT", f"{base}/api/dashboard/{new_id}/cards", session, body={"cards": clean_dcs})
            except RuntimeError as e:
                fail_dashes.append((d["id"], d["name"], f"cards PUT: {str(e)[:200]}"))
                continue
        print(f"  dashboard '{d['name']}' -> id={new_id} ({len(clean_dcs)} cards, {len(tabs)} tabs)")

    print(f"dashboards created: {len(dash_remap)} · failed: {len(fail_dashes)}")
    for did, name, err in fail_dashes:
        print(f"  #{did} '{name}': {err}")

    state["card_id_remap"] = card_remap
    state["dashboard_id_remap"] = dash_remap
    state["field_id_remap_count"] = len(field_map)
    state["import_completed_at"] = time.time()
    (SECRETS / "hetzner_v061_state.json").write_text(json.dumps(state, indent=2, default=str))
    print(f"saved state → secrets/hetzner_v061_state.json")


if __name__ == "__main__":
    main()
