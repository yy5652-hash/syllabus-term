#!/usr/bin/env python3
"""Publish firestore.rules, firestore.indexes.json and remoteconfig.template.json (idempotent). Standard library only.

Usage: python3 scripts/firebase_setup.py [--rules] [--indexes] [--rc]   (both when no flag)
Auth: short-lived token via gcloud service-account impersonation, as in deploy.py.
"""
import json, os, subprocess, sys, urllib.request, urllib.error

P = "buildhybridai-term"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = subprocess.check_output([os.path.expanduser("~/google-cloud-sdk/bin/gcloud"), "auth", "print-access-token",
                                 f"--impersonate-service-account=fb-admin@{P}.iam.gserviceaccount.com"],
                                stderr=subprocess.DEVNULL, text=True).strip()


def call(method, url, body=None, headers=None, want_headers=False):
    h = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json; charset=utf-8", **(headers or {})}
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode() or "{}")
            return (data, r.headers) if want_headers else data
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url} -> {e.code}: {e.read().decode()[:500]}")


def rules():
    src = open(os.path.join(ROOT, "firestore.rules")).read()
    rs = call("POST", f"https://firebaserules.googleapis.com/v1/projects/{P}/rulesets",
              {"source": {"files": [{"name": "firestore.rules", "content": src}]}})
    name = f"projects/{P}/releases/cloud.firestore"
    rel = {"release": {"name": name, "rulesetName": rs["name"]}}
    try:
        call("PATCH", f"https://firebaserules.googleapis.com/v1/{name}", rel)
    except SystemExit:
        call("POST", f"https://firebaserules.googleapis.com/v1/projects/{P}/releases", rel["release"])
    print("rules released:", rs["name"])


def indexes():
    base = f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/collectionGroups"
    for ix in json.load(open(os.path.join(ROOT, "firestore.indexes.json")))["indexes"]:
        url = f"{base}/{ix['collectionGroup']}/indexes"
        have = call("GET", url).get("indexes", [])
        want = [(f["fieldPath"], f["order"]) for f in ix["fields"]]
        if any([(f["fieldPath"], f.get("order")) for f in h["fields"] if f["fieldPath"] != "__name__"] == want for h in have):
            print("index exists:", want); continue
        op = call("POST", url, {"queryScope": ix["queryScope"], "fields": ix["fields"]})
        print("index creating:", want, op.get("name", "")[-20:])


def rc():
    url = f"https://firebaseremoteconfig.googleapis.com/v1/projects/{P}/remoteConfig"
    _, hdr = call("GET", url, want_headers=True)
    tpl = json.load(open(os.path.join(ROOT, "remoteconfig.template.json")))
    out, _ = call("PUT", url, tpl, {"If-Match": hdr.get("ETag", "*")}, want_headers=True)
    print("remote config version:", out.get("version", {}).get("versionNumber"), list(out.get("parameters", {})))


if __name__ == "__main__":
    flags = set(sys.argv[1:])
    if not flags or "--rules" in flags: rules()
    if not flags or "--indexes" in flags: indexes()
    if not flags or "--rc" in flags: rc()
