# Dahua HTTP API V3.37 — Section Map (for Vigil ingester)

> Role: `REF_` · Companion to `docs/vendor/Dahua_HTTP_API_3.37.pdf` (780p, 2023-09-04).
> **This is the authoritative spec for the whole Dahua ANPR path** — the "ITC /
> Intelligent Traffic API" we long wanted is **Chapter 10** of this book.
> Supersedes the generic legacy `DAHUA_IPC_HTTP_API_V1.00x` doc for ingest work.
> Added 2026-07-17.

## Section → our code

| PDF § (page) | What it specifies | Our code |
|---|---|---|
| **4.4.3 Subscribe to Snapshot** (p64) | `snapManager.cgi?action=attachFileProc` — `channel` (-1=all), `heartbeat` [1–60] **default 5**, `Flags[0]=Event`, `Events[]`. Response = multipart: `text/plain` metadata part + `image/jpeg` binary part per event. | `src/ingesters/dahua-cgi.js` (snapManager URI, `SNAP_SAFE_CODES`, plate cutout, zombie watchdog) |
| **10.1.1 [Event] TrafficJunction** (p516) | ANPR event, field-for-field: `EventBaseInfo.{Code,Action=Pulse,Index}`, `TrafficCar.{PlateNumber,PlateColor,VehicleColor,Country,RecNo,BoundingBox}`, `Vehicle.{Text=brand,SubText,SubBrand,BrandYear,BoundingBox}`, `Lane`, `Speed`, `CommInfo.Seat[].{Type,SafeBelt,SunShade,Status[],ShadePos}` | `src/ingesters/dahua-protocol.js` `parseDahuaTrafficJunction` |
| 4.9.17 Subscribe to Event Message (p176) | `eventManager.cgi?action=attach` (event stream) | `dahua-cgi.js` eventManager |
| 4.6.8–4.6.12 Device info (p111) | `getDeviceType` / `getSystemInfo` / `getSerialNo` | auto-model-detect (planned) |
| 4.6.26 Device Online/Offline (p126) · 4.6.28 Connection test / TcpTest (p128) · 4.6.29 Channel Online Status | liveness | edge monitoring |
| 4.13.9 ANPR Report Data Upload (p242) | camera push-mode ANPR | likely the team's NetSDK/HCP path |
| Ch.10.3 Traffic BlockList/AllowList · 10.7 Vehicle Manager · PlateNumberLib | on-camera plate watchlist | (we match server-side today) |

## Confirms our implementation is correct
- snapManager subscription + multipart parse — matches 4.4.3 exactly.
- `heartbeat=5` default is the basis of the zombie-stale watchdog (byte ~every 5s ⇒ >20s stale = dead).
- `no_seatbelt` column (migration 073) ← `Seat[].SafeBelt=WithoutSafeBelt`.
- TrafficJunction field parse ← 10.1.1.

## Unused fields / features (opportunities — not scheduled)
- **Driver distraction:** `CommInfo.Seat[].Status[] = "Smoking" | "Calling"` — same event we already ingest → cheap new alert (like `no_helmet` / `no_seatbelt`).
- Extra attributes: `Seat[].SunShade`, `TrafficCar.Country`.
- Traffic events we don't subscribe: **TrafficRetrograde** (wrong-way), **TrafficOverSpeed/UnderSpeed**, **TrafficParking** (illegal parking), **TrafficJam**, **TrafficPedestrian**.
- **On-camera watchlist** (10.3 + 10.7 + PlateNumberLib download) — push our watchlist to the camera for on-device matching (relates to HCP/CIB forwarding).
