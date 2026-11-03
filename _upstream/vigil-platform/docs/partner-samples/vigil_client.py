#!/usr/bin/env python3
"""
Vigil Platform Partner API — reference client.

Signing is AK/SK HMAC-SHA256. The string being signed is positional and every
optional field still contributes its newline even when empty; getting that
wrong gives a signature the server rejects with no hint as to which field was
off, so the layout is written out rather than built in a loop.

    pip install requests
    export VIGIL_KEY=vk_...  VIGIL_SECRET=...
    python3 vigil_client.py
"""
import base64, hashlib, hmac, os, uuid, time
import requests

BASE = os.environ.get("VIGIL_BASE", "https://meta.dojojin.tech")
KEY = os.environ["VIGIL_KEY"]
SECRET = os.environ["VIGIL_SECRET"]

SIGNED = ["x-ca-key", "x-ca-nonce", "x-ca-timestamp"]


def sign(method, path, params=None, body=b""):
    """Returns headers for one request. Call it afresh for every request — the nonce
    must never repeat inside the server's 5 minute window."""
    accept = content_type = "application/json"
    # Content-MD5 is only signed when there IS a body. An empty body leaves the
    # field empty rather than sending the MD5 of the empty string — those are
    # different strings to sign.
    content_md5 = base64.b64encode(hashlib.md5(body).digest()).decode() if body else ""

    nonce = str(uuid.uuid4())
    timestamp = str(int(time.time() * 1000))

    # Query params are sorted by name, because the server sorts them before
    # rebuilding the string to compare against.
    q = ""
    if params:
        q = "?" + "&".join(f"{k}={params[k]}" for k in sorted(params))
    full_path = path + q

    values = {"x-ca-key": KEY, "x-ca-nonce": nonce, "x-ca-timestamp": timestamp}
    header_block = "".join(f"{h}:{values[h]}\n" for h in SIGNED)

    # METHOD \n Accept \n [Content-MD5 \n] Content-Type \n [Date \n] <headers> <path>
    #
    # A header we do NOT send contributes NO line — not an empty one. We always
    # send Accept and Content-Type, we send Content-MD5 only with a body, and we
    # never send Date (X-Ca-Timestamp carries the time). So a bodiless request
    # has three lines before the header block, not five.
    #
    # This follows HikCentral Professional OpenAPI V3.0.1 §3.2 exactly, which is
    # the scheme this API is modelled on. An earlier version of this file put a
    # blank line in for Date and for a missing Content-MD5; that shape is
    # rejected, and it was rejected by the real HCP gateway too.
    lines = [method.upper(), accept]
    if content_md5:
        lines.append(content_md5)
    lines.append(content_type)
    string_to_sign = "\n".join(lines) + "\n" + header_block + full_path

    signature = base64.b64encode(
        hmac.new(SECRET.encode(), string_to_sign.encode(), hashlib.sha256).digest()
    ).decode()

    headers = {
        "Accept": accept,
        "Content-Type": content_type,
        "X-Ca-Key": KEY,
        "X-Ca-Nonce": nonce,
        "X-Ca-Timestamp": timestamp,
        "X-Ca-Signature": signature,
        "X-Ca-Signature-Headers": ",".join(SIGNED),
    }
    if content_md5:
        headers["Content-MD5"] = content_md5
    return headers, full_path


def get(path, params=None):
    headers, full = sign("GET", path, params)
    r = requests.get(BASE + full, headers=headers, timeout=30)
    r.raise_for_status()
    return r.json()


def post(path, payload):
    import json
    # Sign the EXACT bytes that will be sent. Re-serialising the dict for the
    # request would change key order or whitespace and break the signature.
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    headers, full = sign("POST", path, None, body)
    r = requests.post(BASE + full, headers=headers, data=body, timeout=30)
    r.raise_for_status()
    return r.json()


def walk(path, since, page_size=1000):
    """Follow the feed. Keep the last nextCursor you were given and resume from
    it — re-deriving one from `since` replays the tail on every poll."""
    cursor = None
    while True:
        params = {"since": since, "pageSize": str(page_size)}
        if cursor:
            params["cursor"] = cursor
        page = get(path, params)
        for row in page["data"]:
            yield row
        cursor = page.get("nextCursor")
        if not cursor:
            return


if __name__ == "__main__":
    import datetime, json

    me = get("/v1/healthz")
    print(f"connected as {me['consumer']} ({me['label']}) — server time {me['serverTime']}")

    cams = get("/v1/cameras", {"pageSize": "5"})
    print(f"cameras visible: {len(cams['data'])} (first page)")

    since = (datetime.datetime.now(datetime.timezone.utc)
             - datetime.timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    n = 0
    for _ in walk("/v1/lpr/events", since, 500):
        n += 1
    print(f"plate reads in the last 10 minutes: {n}")

    # Thai plates go in the BODY, never the query string — non-ASCII cannot be
    # signed in a URL unambiguously and is refused with 400 non-ascii-query.
    hit = post("/v1/lpr/search", {"plate": "1กข1234", "exact": True, "pageSize": 10})
    print(f"exact search returned {len(hit['data'])} rows")
