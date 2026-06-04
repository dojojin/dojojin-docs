# Phase 6.0 Spike — Bosch RAM-Buffer Pre-Alarm Clip Verification

> **Status:** ❌ **Dead-end confirmed 2026-05-08** — kept as historical record.
> **Decision:** Pivot to **Option A — server-side RTSP rolling buffer** for Phase 6.1.

## ❌ Outcome (2026-05-08)

| Step | Result |
|---|---|
| FTP server reachable from camera (port 21) | ✅ Yes — Bosch "Check" passed after switching to port 21 (FW 9.80.106 ignores custom port field) |
| Camera push video clip to FTP | ❌ **Not possible without microSD** |
| Root cause | **Recording Profiles page is locked when no SD card is installed** in the camera. The "Storage target / Destination" cannot be configured to FTP because the entire profile editor refuses to load without local storage |
| Implication | Bosch FLEXIDOME 8100i FW 9.80.106 ties video clip export (alarm pre-record + FTP push) to local SD/iSCSI/VRM storage. The "Maximum Bit Rate [kbps]" field in FTP Account is preserved but unreachable without storage gate |
| Hardware constraint | Owner does not want to require SD cards in every customer camera (cost + per-camera install effort) |

## 🎯 Pivot — Option A (server-side RTSP rolling buffer)

`media-recorder.js` (new process) will:
- Subscribe to each camera's RTSP stream 24/7
- Maintain in-memory rolling buffer (~30 s, ring buffer)
- On MQTT alarm event → dump pre-alarm window + 5 s post-alarm to MP4 via ffmpeg
- Vendor-agnostic, works on any camera with RTSP
- See Phase 6.1 plan in CLAUDE.md / next session

## 📜 Original spike runbook (kept for reference)

> **Goal:** Confirm that **NDE-8704-RL** on **FW 9.80.106** (FLEXIDOME 8100i) can push a pre-alarm clip from its **internal RAM buffer** to FTP when an IVA alarm fires — **without** requiring a microSD card.
>
> **Outcome:** decide whether to proceed to Phase 6.1 (per-camera config + Media page), or fall back to ONVIF Profile G / continuous-streaming alternatives.

---

## ✅ Decision criteria — must answer Yes to all to proceed

- [ ] Camera pushes a video file to FTP within **30 seconds** of an alarm event
- [ ] **No SD card** is required (the recording profile points to "Cloud / FTP" not local storage)
- [ ] Pre/post-alarm duration is **configurable** (target 5–15 s pre, 5 s post)
- [ ] File format is **playable in browser** (MP4 H.264 ideally; .mov/.mkv/.h264 acceptable with transcode)
- [ ] Filename or contents include **camera ID + timestamp** (or alarm ID) so we can join clip → events table
- [ ] Concurrent operation: clip push does **not** drop live MQTT events or crash the camera

---

## 🛠 Setup

### 1. Spike FTP server (on MacBook — IP `192.168.10.6`)

```bash
# one-time install
pip3 install pyftpdlib

# run the server (Terminal 1, leave open during the spike)
cd ~/vigil-platform
python3 tools/ftp-spike-server.py 2121
```

Expected output:
```
────────────────────────────────────────────────────────────
  DojoJin Phase 6.0 Spike FTP Server
────────────────────────────────────────────────────────────
  bind:   0.0.0.0:2121
  user:   bosch
  pass:   spike-2026
  root:   /Users/dojojin/vigil-platform/media-spike
```

### 2. Verify FTP reachability from another machine (sanity check)

```bash
curl -v -u bosch:spike-2026 ftp://192.168.10.6:2121/
```
You should see `230 Login successful` in the FTP server console.

> If the camera can't connect on port 2121, fall back to the standard FTP port 21:
> ```bash
> sudo python3 tools/ftp-spike-server.py 21
> ```

---

## 📷 Camera configuration (Bosch web UI)

URL: `https://192.168.10.3` · login: `service` / `wSS4Bosch!`

> **Tip:** the menu names below are based on Bosch FW 9.x. If a label differs slightly, look for the equivalent.

### Step 1 — Define the FTP target

**Configuration → Network → Network Services → Server Setup → Add**

| Field | Value |
|---|---|
| Type | FTP |
| Host | `192.168.10.6` |
| Port | `2121` |
| Username | `bosch` |
| Password | `spike-2026` |
| Path | `/` (or leave blank) |
| Passive mode | ✅ Yes |

Click **Test** — should return ✅ OK.
On the FTP server console you should see `connect from 192.168.10.3` + `login OK`.

### Step 2 — Recording profile (RAM buffer, no SD)

**Configuration → Recording → Recording Profiles → Profile 1**

| Field | Value |
|---|---|
| Recording mode | **Pre-alarm + Alarm** |
| Pre-alarm time | `10` seconds |
| Post-alarm time | `5` seconds |
| Stream | Stream 1 (main) |
| Storage target | **Cloud / FTP target** (NOT SD card) |
| Pre-alarm storage | **Internal RAM** |

> If you don't see "Cloud / FTP" as a storage target option here, the camera may require the export to be configured under "Alarm Connections" instead (see Step 3). Try both.

### Step 3 — Wire IVA rule → recording trigger → FTP export

**Configuration → Alarm → Alarm Sources**

- Add: **VCA / IVA event** → select existing rule **"Crossing line 1"**

**Configuration → Alarm → Alarm Connections**

| Field | Value |
|---|---|
| Trigger source | VCA event ("Crossing line 1") above |
| Action | **Export pre-alarm clip via FTP** (or "Recording Profile 1 → FTP target") |
| Clip target | The FTP server defined in Step 1 |

Save / Apply.

---

## 🧪 Test scenarios

### Test A — single trigger
1. Walk in front of the camera once to fire "Crossing line 1"
2. Watch the FTP console for **30 s**
3. Note the time-to-arrival

### Test B — burst (3 events ~5 s apart)
1. Walk back and forth 3 times
2. Should receive 3 separate clips (or 1 longer one — observe behaviour)
3. Check whether the camera deduplicates / merges

### Test C — duration tuning
1. Change Pre-alarm time to `5` then `15` then back to `10`
2. Trigger after each change
3. Confirm clip duration changes accordingly

### Test D — no SD (if you have a camera without SD, otherwise skip)
1. Repeat Test A on a SD-less camera if available
2. If ALL clips arrive, RAM-only path is confirmed for the fleet

---

## 📋 Findings (fill in and report back)

```
=== Phase 6.0 Spike Findings ===
Date:                 2026-05-__
Camera:               NDE-8704-RL @ 192.168.10.3 (FW 9.80.106)
FTP server:           macOS @ 192.168.10.6:2121

Test A — single trigger
  File arrived?            ☐ Yes  ☐ No
  Time-to-file (s):        ___
  Filename pattern:        ___________________________
  File size (MB):          ___
  File format:             ___ (run: file media-spike/<f>)
  Duration (s):            ___ (run: ffprobe media-spike/<f>)
  Pre-alarm visible?       ☐ Yes  ☐ No
  Post-alarm visible?      ☐ Yes  ☐ No
  Browser playback?        ☐ Yes  ☐ No

Test B — burst
  # of clips received:     ___
  Behaviour:               ☐ separate  ☐ merged  ☐ deduplicated

Test C — duration tuning
  5 s setting → ___ s actual
  15 s setting → ___ s actual

Test D — no-SD camera (if available)
  Result:                  ☐ Same as A  ☐ Failed  ☐ Skipped

Quirks / errors observed:
  __________________________________________________________
  __________________________________________________________
```

Useful commands for inspecting clips:
```bash
file       media-spike/<filename>
ffprobe    media-spike/<filename>            # duration, codec, resolution
ffplay     media-spike/<filename>            # quick playback (if installed)
ls -lah    media-spike/                      # size + timestamps
```

---

## 🚦 Decision matrix

| Result | Next step |
|---|---|
| **All ✅** | Proceed to Phase 6.1 — DB columns, camera-edit UI, `mqtt-subscriber` clip-link logic, Media page |
| **Most ✅, but no FTP push from RAM** | Try Bosch RCP+ direct API push instead of FTP — defer ~2 days |
| **No clips arrive at all** | Spike alternative: pull live RTSP and clip-on-alarm with ffmpeg server-side (heavier infra, but vendor-agnostic) |
| **Camera crashes / drops MQTT** | Halt — escalate to Bosch firmware support, document and consider firmware upgrade |

---

## 🧹 Cleanup after spike

```bash
# stop the FTP server: Ctrl+C in Terminal 1

# inspect / export clips for review (NOT auto-deleted)
ls -la media-spike/

# wipe the spike folder when done analysing
rm -rf media-spike/*

# also remove the camera-side FTP target + alarm connection in Bosch web UI
# (otherwise it will keep pushing clips even after the spike server stops)
```

---

## 📌 Notes for Phase 6.1 implementation (after spike succeeds)

Already agreed:
- Per-camera columns: `enable_clip_capture` (default **false**), `clip_pre_sec` (default 10), `clip_post_sec` (default 5)
- Per-camera columns: `enable_snapshot` (default true), `enable_vca_overlay` (default true)
- `clip_retention_days` system setting — **default 30** (per owner's decision 2026-05-08), range 1–90
- `events` columns: `clip_file`, `clip_duration_sec`, `clip_status` (`pending`/`done`/`failed`)
- Clip storage path: `media/` (parallel to `snapshots/`); served by Express static
- Linking strategy: filename or alarm ID + ±5 s timestamp window joined to `events`

Open questions to resolve from spike findings:
1. Does the camera embed alarm ID in clip filename? If yes, use that; else timestamp + camera_id matching
2. Latency from event to clip — affects whether to update `events.clip_status='pending'` immediately (assume done within 30s) or use polling
3. Concurrent clip uploads — does the camera serialize or push in parallel?
