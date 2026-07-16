#!/usr/bin/env python3
"""
Export full Metabase state from Mac Mini (v0.61.2.9) via API.

Usage:
    MB_URL=http://100.64.8.120:3000 MB_USER=... MB_PASS=... \
    python3 export_from_mac_mini.py <out_dir>

Writes one JSON per endpoint under <out_dir>/raw/.
Session token is kept in memory only, never written to disk.
"""

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def http(method, url, token=None, body=None, timeout=120, retries=3):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Metabase-Session"] = token
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def login(base, user, pw):
    resp = http("POST", f"{base}/api/session", body={"username": user, "password": pw})
    return resp["id"]


def dump(out, name, payload):
    path = out / f"{name}.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, default=str))
    if isinstance(payload, list):
        print(f"  {name}.json ({len(payload)} items)")
    elif isinstance(payload, dict) and "data" in payload and isinstance(payload["data"], list):
        print(f"  {name}.json ({len(payload['data'])} items)")
    else:
        print(f"  {name}.json")


def main():
    base = os.environ["MB_URL"].rstrip("/")
    user = os.environ["MB_USER"]
    pw = os.environ["MB_PASS"]
    out = Path(sys.argv[1]) / "raw"
    out.mkdir(parents=True, exist_ok=True)

    print(f"login: {base}")
    tok = login(base, user, pw)

    # simple endpoints (skip /api/card mega-list — walk per-collection instead)
    for name, path in [
        ("collection_tree", "/api/collection/tree"),
        ("collection", "/api/collection"),
        ("database", "/api/database"),
        ("dashboard", "/api/dashboard"),
        ("user", "/api/user"),
        ("permissions_group", "/api/permissions/group"),
        ("permissions_graph", "/api/permissions/graph"),
        ("permissions_collection_graph", "/api/collection/graph"),
        ("setting", "/api/setting"),
        ("snippet", "/api/native-query-snippet"),
        ("segment", "/api/segment"),
        ("metric", "/api/metric"),
        ("timeline", "/api/timeline"),
        ("pulse", "/api/pulse"),
    ]:
        try:
            dump(out, name, http("GET", base + path, tok))
        except urllib.error.HTTPError as e:
            print(f"  {name}.json SKIPPED ({e.code})")

    # walk collections to discover card + dashboard ids without the heavy /api/card mega-list
    collections = json.loads((out / "collection.json").read_text())
    all_card_ids = []
    all_dashboard_ids = []
    coll_items_dir = out / "collection_items"
    coll_items_dir.mkdir(exist_ok=True)
    for c in collections:
        cid = c["id"]
        try:
            items = http("GET", f"{base}/api/collection/{cid}/items?limit=1000", tok)
            (coll_items_dir / f"{cid}.json").write_text(
                json.dumps(items, indent=2, ensure_ascii=False, default=str)
            )
            data = items.get("data", []) if isinstance(items, dict) else items
            for it in data:
                if it.get("model") == "card":
                    all_card_ids.append(it["id"])
                elif it.get("model") == "dashboard":
                    all_dashboard_ids.append(it["id"])
            print(f"  collection_items/{cid}.json ({len(data)} items in {c.get('name','?')})")
        except urllib.error.HTTPError as e:
            print(f"  collection_items/{cid}.json SKIPPED ({e.code})")

    # union with /api/dashboard list ids (in case some live outside a collection)
    dashboards_list = json.loads((out / "dashboard.json").read_text())
    if isinstance(dashboards_list, dict) and "data" in dashboards_list:
        dashboards_list = dashboards_list["data"]
    for d in dashboards_list:
        if d["id"] not in all_dashboard_ids:
            all_dashboard_ids.append(d["id"])

    # per-dashboard full details
    dash_dir = out / "dashboard_full"
    dash_dir.mkdir(exist_ok=True)
    for did in all_dashboard_ids:
        try:
            full = http("GET", f"{base}/api/dashboard/{did}", tok)
            (dash_dir / f"{did}.json").write_text(json.dumps(full, indent=2, ensure_ascii=False, default=str))
            # dashcards embed card refs but sometimes card_id != referenced card — collect for safety
            for dc in full.get("dashcards", []) or full.get("ordered_cards", []) or []:
                cid = dc.get("card_id") or (dc.get("card") or {}).get("id")
                if cid and cid not in all_card_ids:
                    all_card_ids.append(cid)
            print(f"  dashboard_full/{did}.json ({full.get('name','?')[:60]})")
        except urllib.error.HTTPError as e:
            print(f"  dashboard_full/{did}.json SKIPPED ({e.code})")

    # per-card full details
    card_dir = out / "card_full"
    card_dir.mkdir(exist_ok=True)
    ok, fail = 0, 0
    for cid in sorted(set(all_card_ids)):
        try:
            full = http("GET", f"{base}/api/card/{cid}", tok)
            (card_dir / f"{cid}.json").write_text(json.dumps(full, indent=2, ensure_ascii=False, default=str))
            ok += 1
        except urllib.error.HTTPError as e:
            print(f"  card_full/{cid}.json SKIPPED ({e.code})")
            fail += 1
    print(f"  card_full/*.json ({ok} ok, {fail} fail)")

    # per-database details (schemas, tables, fields - useful for id remap)
    dbs = json.loads((out / "database.json").read_text())
    if isinstance(dbs, dict) and "data" in dbs:
        dbs = dbs["data"]
    db_dir = out / "database_full"
    db_dir.mkdir(exist_ok=True)
    for db in dbs:
        dbid = db["id"]
        try:
            full = http("GET", f"{base}/api/database/{dbid}?include=tables.fields", tok)
            (db_dir / f"{dbid}.json").write_text(json.dumps(full, indent=2, ensure_ascii=False, default=str))
            print(f"  database_full/{dbid}.json ({db.get('name','?')})")
        except urllib.error.HTTPError as e:
            print(f"  database_full/{dbid}.json SKIPPED ({e.code})")

    print("done.")


if __name__ == "__main__":
    main()
