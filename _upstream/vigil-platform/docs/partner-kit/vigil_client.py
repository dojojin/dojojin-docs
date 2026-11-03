#!/usr/bin/env python3
"""Minimal client for the Vigil partner API (/v1). Python 3.8+, standard library only.

Usage:
    export VIGIL_BASE=https://dashboard.example.com
    export VIGIL_KEY=<your app key>
    export VIGIL_SECRET=<your app secret>     # never hard-code it, never log it
    python3 vigil_client.py

Signing, in one paragraph: every request carries X-Ca-Key, X-Ca-Nonce (new UUID per request),
X-Ca-Timestamp (epoch milliseconds, within 5 minutes of server time) and X-Ca-Signature, which is
base64(HMAC-SHA256(secret, string_to_sign)). string_to_sign is
    METHOD \n application/json \n [Content-MD5 \n] application/json \n
    x-ca-key:<key>\n x-ca-nonce:<nonce>\n x-ca-timestamp:<ts>\n
    <path including /v1>[?k=v&... sorted by key, values NOT url-encoded]
The Content-MD5 line exists only when there is a body. A header you do not send adds no line at all.
"""
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class VigilClient:
    def __init__(self, base, key, secret):
        self.base, self.key, self.secret = base.rstrip("/"), key, secret

    def _sign(self, method, path, query, body):
        content_md5 = base64.b64encode(hashlib.md5(body).digest()).decode() if body else ""
        nonce, ts = str(uuid.uuid4()), str(int(time.time() * 1000))
        signed_path = path + ("?" + "&".join(f"{k}={query[k]}" for k in sorted(query)) if query else "")
        lines = [method, "application/json"] + ([content_md5] if content_md5 else []) + ["application/json"]
        to_sign = "\n".join(lines) + "\n" + f"x-ca-key:{self.key}\nx-ca-nonce:{nonce}\nx-ca-timestamp:{ts}\n" + signed_path
        sig = base64.b64encode(hmac.new(self.secret.encode(), to_sign.encode(), hashlib.sha256).digest()).decode()
        headers = {
            "Accept": "application/json", "Content-Type": "application/json",
            "X-Ca-Key": self.key, "X-Ca-Nonce": nonce, "X-Ca-Timestamp": ts, "X-Ca-Signature": sig,
            "X-Ca-Signature-Headers": "x-ca-key,x-ca-nonce,x-ca-timestamp",
        }
        if content_md5:
            headers["Content-MD5"] = content_md5
        return headers

    def request(self, method, path, query=None, body=None):
        query = {k: str(v) for k, v in (query or {}).items()}
        for k, v in query.items():                      # the server refuses non-ASCII query values
            if not v.isascii():
                raise ValueError(f"query value for {k} is not ASCII; send it in a POST body instead")
        raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
        headers = self._sign(method, path, query, raw)
        url = self.base + path + ("?" + urllib.parse.urlencode(sorted(query.items())) if query else "")
        req = urllib.request.Request(url, data=raw or None, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:              # problems come back as RFC 7807 JSON
            return e.code, json.loads(e.read() or b"null")

    def walk(self, path, query):
        """Yield every row of a paged endpoint. Keep the last nextCursor you saw to resume later."""
        cursor = None
        while True:
            q = dict(query, **({"cursor": cursor} if cursor else {}))
            status, page = self.request("GET", path, q)
            if status != 200:
                raise RuntimeError(f"{path} -> {status} {page}")
            yield from page["data"]
            cursor = page["nextCursor"]
            if not cursor:
                return


if __name__ == "__main__":
    c = VigilClient(os.environ["VIGIL_BASE"], os.environ["VIGIL_KEY"], os.environ["VIGIL_SECRET"])
    status, health = c.request("GET", "/v1/healthz")
    print("healthz:", status)
    if status != 200:
        raise SystemExit(f"stop here: {health}")
    # Your own contract: exactly the endpoints and fields granted to you, nothing else.
    _, spec = c.request("GET", "/v1/openapi.json")
    feeds = [p for p, ops in spec["paths"].items()
             if "get" in ops and any(x["name"] == "since" for x in ops["get"].get("parameters", []))]
    print("your endpoints:", " ".join(sorted(spec["paths"])))
    since = time.strftime("%Y-%m-%dT%H:00:00Z", time.gmtime(time.time() - 3600))
    for path in feeds:
        rows = list(c.walk(path, {"since": since, "pageSize": 500}))
        print(f"{path}: {len(rows)} rows in the last hour")
