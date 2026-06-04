# GOTCHAS — Vigil Mobile

Known issues จาก incident จริง — อ่านก่อนแก้ bug

---

## #1 — Android: useSegments()[0] คืน `undefined` + auth gate อย่าพึ่ง segments

**อาการเดิม:** Login สำเร็จแต่ค้างหน้า login บน Android (segments[0] undefined → inAuthGroup false)
**อาการต่อมา:** ใช้ `!inTabsGroup` แล้ว route นอก tabs (เช่น `/settings`) ถูกเด้งกลับ tabs ทันที
**Root cause:** `useSegments()` บน Android ไม่ reliable + auth gate ที่ depend `segments`
จะ re-run ทุก navigation → เด้ง valid route ออก
**แก้ (final):** auth gate **depend แค่ `[user, isReady]`** ไม่ใช่ segments —
redirect เฉพาะ login/logout transition. `if (user) replace('/(tabs)') else replace('/(auth)/login')`.
effect ไม่ re-run ตอน navigate ในเมื่อ user ไม่เปลี่ยน → settings/modal เปิดได้, login redirect ทำงานทั้ง 2 platform
**ไฟล์:** `app/_layout.tsx` — auth gate useEffect
**Reproduced:** 2026-05-30 · Android Expo Go · Expo Router v6 / RN 0.81 / New Architecture

---

## #2 — Save รูปภาพใช้ไม่ได้บน Expo Go (Android)

**อาการ:** กดบันทึกรูปภาพ → iOS ทำงาน, Android กดแล้วไม่เกิดอะไร (เงียบ)
**สาเหตุ:** `MediaLibrary.requestPermissionsAsync()` ถูก reject ทันทีบน **Expo Go Android**
(`ERR_PERMISSIONS` — "Expo Go can no longer provide full access to the media library").
เป็นข้อจำกัดของ Expo Go เอง ไม่ใช่ bug — Android permission requirements เปลี่ยน.
- เพิ่มเติม: `requestPermissionsAsync()` แบบ full ขอ AUDIO ด้วย → ต้อง `(false, ['photo'])` เลี่ยง
**แก้ (UX):** ปุ่ม save แสดง error state ('บันทึกไม่ได้' สีแดง) ไม่เงียบ
**ทางออกจริง:** save ใช้ได้บน **iOS Expo Go + development build เท่านั้น**.
Android save (รวม album "Vigil Image" ผ่าน `createAssetAsync`/`createAlbumAsync`) ต้อง **dev build**
**ไฟล์:** `src/components/EventDetailModal.tsx` — `saveImageToLibrary()`
**Reproduced:** 2026-05-30 · Android Expo Go · expo-media-library 18.2

---

## #3 — expo-notifications throw error overlay ใน Expo Go (SDK 53+)

**อาการ:** กด toggle push → error overlay เด้ง (iOS) / settings ดีดออกเงียบ (Android)
**สาเหตุ:** SDK 53+ ถอด remote push ออกจาก Expo Go → เรียก native API
(`addNotificationResponseReceivedListener`, `getExpoPushTokenAsync`, `setNotificationHandler`) จะ throw
**แก้:** guard ด้วย `IS_EXPO_GO = appOwnership === 'expo' || executionEnvironment === 'storeClient'`
— skip expo-notifications API ทั้งหมดใน Expo Go; `registerForPush` return `no_project` ก่อนเรียก native
**ทางออกจริง:** push ใช้ได้เฉพาะ **dev/prod build + EAS projectId + FCM/APNs**
**ไฟล์:** `src/lib/push.ts`, `app/_layout.tsx`
**Reproduced:** 2026-05-30 · Expo Go SDK 54

---

## #4 — GroupFilter pill clipped — paddingVertical บน ScrollView style ไม่ขยาย frame

**อาการ:** Pill "ทั้งหมด (n)" ถูก clip ครึ่งบน แม้เพิ่ม padding แล้ว (3 attempts)
**Root cause:** `paddingVertical` บน ScrollView `style` ไม่ขยาย frame ของ ScrollView
— React Native คำนวณ height จาก children ไม่รวม padding ใน style
**แก้ (final):** ครอบ ScrollView ด้วย `<View style={{ paddingVertical: 10 }}>` — View คำนวณ height รวม padding เสมอ
**ไฟล์:** `src/components/GroupFilter.tsx`
**Reproduced:** 2026-05-31 · iOS + Android

---

## #5 — Biometric loop — iOS AppState `inactive` trigger จาก biometric UI

**อาการ:** Face ID prompt เด้งซ้ำไม่หยุด หลัง authenticate สำเร็จ
**Root cause:** iOS biometric dialog trigger `AppState → 'inactive'` ก่อน active
code เดิมเช็ค `inactive|background → active` ทำให้ biometric UI เป็น trigger ตัวเอง → loop
**แก้ (final):** เช็คเฉพาะ `prevAppState === 'background' && next === 'active'` — ไม่นับ inactive
**ไฟล์:** `app/_layout.tsx` — AppState listener
**Reproduced:** 2026-05-31 · iOS Simulator + iPhone 17 Pro

---

## #6 — Android Expo Go URL ต้องใช้ 10.0.2.2 ไม่ใช่ 127.0.0.1

**อาการ:** `exp://127.0.0.1:8081` ใน Expo Go Android emulator → spinning ไม่โหลด
แม้ตั้ง `adb reverse tcp:8081 tcp:8081` แล้ว
**Root cause:** Android emulator ใช้ `10.0.2.2` เป็น alias ของ host localhost
`127.0.0.1` หมายถึง emulator ตัวเอง ไม่ใช่ host machine
**แก้:** ใช้ `exp://10.0.2.2:8081` เสมอบน Android emulator — ไม่ต้องพึ่ง adb reverse
**Reproduced:** 2026-05-31 · Android Emulator (Pixel API 35)

---

## #7 — iOS modal-over-modal: pageSheet ชน modal route

**อาการ:** กด event row ใน Camera Detail (modal route) → EventDetailModal ไม่เด้ง / dismiss ทั้งคู่
**Root cause:** `camera/[id].tsx` เปิดเป็น modal route (`presentation: 'modal'`)
การ stack `presentationStyle="pageSheet"` ซ้อนกันบน iOS ≤15 ไม่ทำงาน
**แก้:** ใช้ `presentationStyle="fullScreen"` สำหรับ EventDetailModal ที่เรียกจากใน Camera Detail
**ไฟล์:** `app/camera/[id].tsx`, `src/components/CameraDetailContent.tsx`
**Reproduced:** 2026-06-01 · iOS 26.4 (iPhone 17 Pro)

---

## #8 — Android i18n ไม่สลับภาษา — New Architecture concurrent render

**อาการ:** สลับ English ใน Settings → iOS เปลี่ยน, Android ยังเป็นไทย
**Root cause:** `useI18n()` hook เดิมทำ `i18n.locale = locale` ระหว่าง render (side effect)
New Architecture (Fabric/Concurrent) บน Android render components พร้อมกัน →
components ต่างๆ overwrite `i18n.locale` singleton กัน → ค่าไม่ consistent
**แก้ (final):** ส่ง locale เข้า `i18n.t()` โดยตรงทุก call แทนการ mutate singleton
```ts
return useCallback(
  (key, options) => i18n.t(key, { locale, ...options }),
  [locale],
);
```
**ไฟล์:** `src/i18n/useI18n.ts`
**Reproduced:** 2026-06-01 · Android Emulator + New Architecture (`newArchEnabled: true`)

---

## #9 — react-native-reanimated v4 ต้องการ react-native-worklets

**อาการ:** ลง `react-native-reanimated ~4.1.1` แล้ว → import `react-native-reanimated/plugin` ใน babel crash
`Cannot find module 'react-native-worklets/plugin'`
**Root cause:** reanimated v4 แยก worklets engine เป็น package แยก (`react-native-worklets`)
`react-native-reanimated/plugin/index.js` เป็นแค่ re-export จาก `react-native-worklets/plugin`
**แก้:** `npx expo install react-native-worklets` ก่อนสร้าง `babel.config.js`
**babel.config.js ที่ถูก:**
```js
module.exports = {
  presets: ['babel-preset-expo'],
  plugins: ['react-native-reanimated/plugin'],
};
```
**ไฟล์:** `babel.config.js`, `package.json`
**Reproduced:** 2026-06-01 · Expo SDK 54 + reanimated 4.1.7

---

## #10 — Metro stale cache หลังแก้ babel.config.js

**อาการ:** แก้ babel.config.js แล้ว reload → transform cache เดิม → reanimated ยังไม่ทำงาน
**Root cause:** Metro ที่รันอยู่ (background process) cache transforms ไว้
`npx expo start --clear &` ที่รันซ้ำเป็น no-op ถ้า port 8081 ยังถูกใช้อยู่ → Metro เก่า process ยังรัน
**แก้:** kill pid Metro เก่าก่อน (`kill <pid>`) แล้ว `npx expo start --clear`
**หมายเหตุ:** babel.config.js เปลี่ยน = transform เปลี่ยน = ต้อง `--clear` เสมอ
**Reproduced:** 2026-06-01

---

## #11 — GestureHandlerRootView ต้องมี flex:1

**อาการ:** ครอบ `<GestureHandlerRootView>` แล้วแอปแสดงหน้าจอว่าง (blank screen)
**Root cause:** `GestureHandlerRootView` ค่า default คือ `flex: 0` → ไม่ขยายเต็มหน้าจอ
**แก้:** `<GestureHandlerRootView style={{ flex: 1 }}>`
**ไฟล์:** `app/_layout.tsx`
**Reproduced:** 2026-06-01 · iOS + Android

---
