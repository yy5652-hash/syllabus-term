#!/usr/bin/env python3
"""Deploy web/dist to Firebase Hosting via the REST API, self-check, roll back on failure.

Usage:  python3 scripts/deploy.py            # build, deploy, check
        python3 scripts/deploy.py --no-build # deploy the existing web/dist
        python3 scripts/deploy.py --rollback # re-release the previous version

Auth: a short-lived token from `gcloud auth print-access-token --impersonate-service-account`
(no key files). Standard library only.
"""
import gzip, hashlib, json, os, subprocess, sys, time, urllib.request, urllib.error

PROJECT = "buildhybridai-term"
SITE = PROJECT
SA = f"fb-admin@{PROJECT}.iam.gserviceaccount.com"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "web", "dist")
API = "https://firebasehosting.googleapis.com/v1beta1"
URL = f"https://{SITE}.web.app"
GCLOUD = os.path.expanduser("~/google-cloud-sdk/bin/gcloud")


def token():
    return subprocess.check_output([GCLOUD, "auth", "print-access-token", f"--impersonate-service-account={SA}"],
                                   stderr=subprocess.DEVNULL, text=True).strip()


TOKEN = None


def call(method, url, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            txt = r.read().decode() or "{}"
            return json.loads(txt)
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url} -> {e.code}: {e.read().decode()[:400]}")


def releases():
    return call("GET", f"{API}/sites/{SITE}/channels/live/releases?pageSize=10").get("releases", [])


def release(version_name, msg):
    return call("POST", f"{API}/sites/{SITE}/releases?versionName={version_name}", {"message": msg})


def self_check():
    """The judge link must load: index 200, every referenced asset 200, title present."""
    import re
    bust = f"?check={int(time.time())}"
    with urllib.request.urlopen(URL + "/" + bust, timeout=30) as r:
        html = r.read().decode()
        assert r.status == 200
    assert "<title>" in html, "no title in index.html"
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', html)
    assert assets, "index.html references no built assets"
    for a in assets:
        with urllib.request.urlopen(URL + a, timeout=30) as r:
            assert r.status == 200, f"{a} -> {r.status}"
    return len(assets)


def main():
    global TOKEN
    TOKEN = token()
    if "--rollback" in sys.argv:
        rel = [r for r in releases() if r.get("type") == "DEPLOY"]
        if len(rel) < 2:
            sys.exit("no previous release to roll back to")
        print("rolling back to", rel[1]["version"]["name"])
        release(rel[1]["version"]["name"], "rollback")
        print("checked assets:", self_check())
        return

    if "--no-build" not in sys.argv:
        subprocess.check_call(["npm", "run", "build"], cwd=os.path.join(ROOT, "web"))

    files = {}
    for dp, _, fns in os.walk(DIST):
        for fn in fns:
            p = os.path.join(dp, fn)
            gz = gzip.compress(open(p, "rb").read(), mtime=0)
            files["/" + os.path.relpath(p, DIST).replace(os.sep, "/")] = (hashlib.sha256(gz).hexdigest(), gz)
    prev = next((r["version"]["name"] for r in releases() if r.get("type") == "DEPLOY"), None)

    cfg = {"config": {
        "headers": [
            {"glob": "/assets/**", "headers": {"Cache-Control": "public, max-age=31536000, immutable"}},
            {"glob": "/index.html", "headers": {"Cache-Control": "no-cache"}},
        ],
        "rewrites": [{"glob": "**", "path": "/index.html"}],
    }}
    ver = call("POST", f"{API}/sites/{SITE}/versions", cfg)["name"]
    pop = call("POST", f"{API}/{ver}:populateFiles", {"files": {k: v[0] for k, v in files.items()}})
    need = set(pop.get("uploadRequiredHashes", []))
    by_hash = {h: gz for h, gz in files.values()}
    for h in need:
        call("POST", f"{pop['uploadUrl']}/{h}", raw=by_hash[h], ctype="application/octet-stream")
    call("PATCH", f"{API}/{ver}?update_mask=status", {"status": "FINALIZED"})
    release(ver, f"deploy {time.strftime('%Y-%m-%d %H:%M')}")
    print(f"released {ver} ({len(files)} files, {len(need)} uploaded)")
    time.sleep(5)
    try:
        print("self-check ok, assets:", self_check(), "→", URL)
    except Exception as e:  # roll back so the judge link never breaks
        print("SELF-CHECK FAILED:", e)
        if prev:
            release(prev, "auto-rollback after failed self-check")
            print("rolled back to", prev)
        sys.exit(1)


if __name__ == "__main__":
    main()
