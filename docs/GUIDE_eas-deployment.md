# GUIDE_eas-deployment — Vigil Mobile

> **EAS Build + Credentials + Push (FCM/APNs) deployment guide**
> Living Docs role: `GUIDE_` — how-to for dev/prod build
> Updated 2026-06-01 · สถานะ: projectId ตั้งแล้ว, รอ build รอบแรก

---

## ทำไมต้อง dev build (ไม่ใช่ Expo Go)

4 feature นี้โค้ดพร้อมแล้ว แต่ **Expo Go ทดสอบไม่ได้** — ต้อง dev/prod build:

| Feature | ทำไม Expo Go ไม่ได้ | GOTCHA |
|---|---|---|
| Push delivery | SDK 53+ ถอด remote push ออกจาก Expo Go | #3 |
| Save image → album Android | Expo Go Android block media-library permission | #2 |
| Video playback Android | expo-video ต้อง native module | — |
| App icon badge | ต้อง native notification count | — |

→ build รอบเดียว verify ครบทั้ง 4

---

## สถานะปัจจุบัน (2026-06-01)

| สิ่งที่ทำแล้ว | สถานะ |
|---|---|
| `eas init` — projectId ใน `app.json` | ✅ `e6e8e170-8093-4ce7-a60c-ba49c4b90522` |
| Android permissions ใน `app.json` | ✅ biometric + media-library (8 permissions) |
| eas-cli ติดตั้ง global | ❌ ยัง |
| `eas.json` (build profiles) | ❌ ยัง — สร้างตอน `eas build` ครั้งแรก |
| iOS APNs credentials | ❌ ยัง — ต้อง Apple Developer account |
| Android FCM (`google-services.json`) | ❌ ยัง — ต้อง Firebase project |

---

## Prerequisites

| สิ่งที่ต้องมี | ค่าใช้จ่าย | ใช้สำหรับ |
|---|---|---|
| Expo account (expo.dev) | ฟรี | ทุก build |
| Apple Developer account | $99/ปี | iOS APNs + TestFlight |
| Firebase project | ฟรี | Android FCM |
| M1 MacBook Pro (มีแล้ว) | — | iOS build local ได้ |

---

## ขั้น 1 — ติดตั้ง + Login (ครั้งเดียว)

```bash
npm install -g eas-cli
eas login                          # ใช้ Expo account
cd ~/vigil-mobile
# eas init ทำแล้ว — projectId อยู่ใน app.json
```

---

## ขั้น 2 — สร้าง eas.json (build profiles)

`eas build` ครั้งแรกจะ generate ให้ หรือสร้างเองตามนี้:

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  }
}
```

- **development** — dev client + Metro hot reload (ใช้ทดสอบ 4 feature ข้างบน)
- **preview** — standalone internal (แจก tester ผ่าน link)
- **production** — App Store / Play Store

---

## ขั้น 3 — iOS Credentials (APNs)

```bash
eas credentials --platform ios
# เลือก Development → EAS สร้าง APNs key อัตโนมัติผ่าน Apple Developer Portal
```

EAS จัดการให้อัตโนมัติ (Distribution cert + Provisioning profile + Push key)
ต้อง login Apple Developer account ตอน prompt

---

## ขั้น 4 — Android Credentials (FCM + Keystore)

### A. Firebase (FCM) — สำหรับ push
1. [console.firebase.google.com](https://console.firebase.google.com) → สร้าง project
2. Add Android app → package: `tech.dojojin.vigil`
3. ดาวน์โหลด `google-services.json` → วางที่ `~/vigil-mobile/`
4. เพิ่มใน `app.json` → `expo.android`:
   ```json
   "googleServicesFile": "./google-services.json"
   ```
5. (ห้าม commit `google-services.json` ถ้ามี sensitive — เพิ่มใน `.gitignore`
    แต่ EAS ต้องอ่านได้ → ใช้ EAS Secret หรือ commit ใน private repo)

### B. Keystore
```bash
eas credentials --platform android
# เลือก "Set up a new keystore" → EAS สร้าง + เก็บให้อัตโนมัติ
```

---

## ขั้น 5 — Build

```bash
# Dev build ทั้ง 2 platform
eas build --profile development --platform all

# หรือแยก
eas build --profile development --platform ios
eas build --profile development --platform android
```

build เสร็จ → ดาวน์โหลด `.ipa` / `.apk` จาก link ที่ EAS ให้ →
ติดตั้งบนเครื่องจริง → `npx expo start --dev-client` → scan QR

---

## ขั้น 6 — Verify 4 features

หลังติดตั้ง dev build บนเครื่องจริง:

1. **Push** — Settings → toggle push เปิด → ดู Expo push token ใน log →
   trigger event ฝั่ง backend (`vigil-platform/src/push-sender.js`) → notification เด้ง
2. **Save image Android** — Events → event detail → บันทึกรูปภาพ → เช็ค album "Vigil Image"
3. **Video Android** — Events → clip → ดู Video → playback ได้
4. **App badge** — มี unread notification → badge เลขบน app icon

---

## Backend cross-reference (push delivery)

| งาน | ไฟล์ใน vigil-platform |
|---|---|
| Push hook (trigger จาก event) | `src/alert-engine.js` |
| Push sender (Expo Push API) | `src/push-sender.js` |
| Token registration endpoint | `src/api-server.js` (grep `push-token`) |

mobile side: `src/lib/push.ts` (`registerForPush` / `IS_EXPO_GO` guard — ดู GOTCHAS #3)

---

## Constraints / Gotchas เกี่ยวกับ build

- **`app.json` ต้อง `newArchEnabled: true`** — reanimated v4 บังคับ (Critical Constraint #2)
- **`babel.config.js` ต้องมี `react-native-reanimated/plugin`** — ดู GOTCHAS #9, #10
- Android permissions ถูกเพิ่มใน `app.json` แล้ว (biometric + media) — prebuild จะ gen AndroidManifest ให้
- projectId เป็น public ปลอดภัยที่จะ commit (ไม่ใช่ secret)

---

<sub>Updated 2026-06-01 · EAS deployment plan — รอ build รอบแรก</sub>
