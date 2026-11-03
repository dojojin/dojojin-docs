# Vigil Partner API: getting started

This kit gets you from credentials to your first page of data. Two working clients are included,
with no third-party dependencies:

| File | Runtime |
|---|---|
| `vigil_client.py` | Python 3.8+ |
| `vigil-client.mjs` | Node 18+ |

Both clients do the same thing:

1. Call `/v1/healthz`.
2. Read **your own** contract from `/v1/openapi.json`.
3. Page through every feed in that contract for the last hour.

They have been run end to end against the live API code.

A Thai-language guide with the same content for non-developers is in `partner-guide-th.html`.

## 1. Run it

```sh
export VIGIL_BASE=https://<host you were given>
export VIGIL_KEY=<app key>
export VIGIL_SECRET=<app secret>
python3 vigil_client.py          # or: node vigil-client.mjs
```

Keep the secret in the environment or a secrets store. Do not commit it, paste it into tickets or write it to logs.
If it leaks, ask the operator to rotate it. A rotation issues a new key and secret and invalidates the old pair immediately.

## 2. Your contract is `/v1/openapi.json`

That document is generated for your credentials from the grants the database actually holds. It lists exactly
the endpoints and fields you receive, so treat it as the source of truth and re-read it after any change the
operator tells you about. A field outside your agreement is simply absent from rows. An endpoint whose key fields
you do not hold answers `403 not-permitted`. If you need more, raise it with the operator together with your use case.

## 3. Signing

Every request carries four headers:

| Header | Value |
|---|---|
| `X-Ca-Key` | your app key |
| `X-Ca-Nonce` | a fresh UUID for every request (replays are refused) |
| `X-Ca-Timestamp` | epoch milliseconds, within 5 minutes of server time |
| `X-Ca-Signature` | `base64( HMAC-SHA256( secret, string_to_sign ) )` |

Also send `Accept: application/json`, `Content-Type: application/json` and
`X-Ca-Signature-Headers: x-ca-key,x-ca-nonce,x-ca-timestamp`. The `string_to_sign` is:

```
GET
application/json
application/json
x-ca-key:<key>
x-ca-nonce:<nonce>
x-ca-timestamp:<timestamp>
/v1/some/path?pageSize=500&since=2026-10-22T03:00:00Z
```

These are the four rules people get wrong:

- **The path includes `/v1`.**
- **Query parameters are sorted by name and signed decoded.** The values are not URL-encoded in the signed
  string, but they are URL-encoded in the request line.
- **Content-MD5 only when there is a body.** With a body (POST), add a `Content-MD5` header holding
  `base64(md5(raw body bytes))`. Put the same value on its own line between the two `application/json` lines.
  Without a body that line does not exist; it is not an empty line.
- **Query values must be ASCII.** Thai text, such as a plate, goes in a JSON POST body, never in a query string.

## 4. Paging and polling

Feeds return `{ data, nextCursor, pageSize }`. Pass `nextCursor` back as `cursor` until it is `null`.
To poll, keep the last `nextCursor` you received and resume from it. Do not recompute from `since`, because that
replays the tail on every poll. The cursor format is documented in your OpenAPI document and is stable within `/v1`.

Summary rows (counts per hour or per day) can be revised for a while after you read them. Re-read anything whose
`updated_at` is newer than your copy. A count of zero is not proof that nothing happened: check whether the
source reports that kind of event at all, as described in your contract.

## 5. Errors

Errors are RFC 7807 JSON: `{ type, title, status, detail }`.

| Status | Meaning | What to do |
|---|---|---|
| 400 | A parameter is wrong, or `since` is older than the data held | Read `detail`, fix the request |
| 401 | Missing headers, bad signature, stale timestamp, reused nonce, expired or deactivated credentials | Check the signing rules and your clock; contact the operator for expiry |
| 403 `not-permitted` | That data is not part of your agreement | Contact the operator |
| 429 | Rate limit | Wait for `Retry-After` seconds |
| 503 `query-too-slow` | The query hit the 5-second ceiling | Narrow the time window |

## 6. Compatibility

Inside `/v1` we may add fields, optional parameters and endpoints, so **ignore fields you do not recognise**.
We will not remove or rename a field, change its type or meaning, or change the signing layout inside `/v1`.
