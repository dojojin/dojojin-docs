# i18n Dedicated Pass — Group 1 Frontend Debt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all hardcoded Thai/English dynamic strings in 5 dashboard page files into `dashboard/i18n.js` so Thai↔English switching works completely.

**Architecture:** File-by-file sequential (approach A from design). Each task modifies one page file + adds any new i18n keys required, then commits both together. New keys (`common.error`, `ar.noUsers`, `ar.checkingQuota`) are all added in Task 1 and reused in subsequent tasks. `_APP_*` dicts in page-snapshots.js are excluded — they already have their own `{th, en}` local struct.

**Tech Stack:** Vanilla JS, `dashboard/i18n.js` flat-key dict, `I18N.t(key)` helper already in scope on all pages.

---

## Files Modified

| File | Changes |
|---|---|
| `dashboard/i18n.js` | Add 3 new keys: `common.error`, `ar.noUsers`, `ar.checkingQuota` (th + en) |
| `dashboard/page-alerts.js` | 7 string migrations (lines 123, 198, 269, 379, 406, 580, 606) |
| `dashboard/page-user-mgmt.js` | 4 string migrations (lines 146, 286, 389, 397) |
| `dashboard/page-map-settings.js` | 2 string migrations (lines 255, 292) |
| `dashboard/page-categories.js` | 1 string migration (line 292) |
| `dashboard/page-camera-settings.js` | 1 string migration (line 1057) |

---

## Task 1: Add new i18n keys + migrate page-alerts.js

**Files:**
- Modify: `dashboard/i18n.js:402` (th common block)
- Modify: `dashboard/i18n.js:636` (th ar block)
- Modify: `dashboard/i18n.js:1135` (en common block)
- Modify: `dashboard/i18n.js:1369` (en ar block)
- Modify: `dashboard/page-alerts.js:123,198,269,379,406,580,606`

- [ ] **Step 1: Add `common.error` to i18n.js th block (line 402)**

Find line 402 in `dashboard/i18n.js`:
```
'common.saveFailed':'บันทึกไม่สำเร็จ: ','common.deleteFailed':'ลบไม่สำเร็จ: ',
```
Change to:
```
'common.saveFailed':'บันทึกไม่สำเร็จ: ','common.deleteFailed':'ลบไม่สำเร็จ: ','common.error':'ข้อผิดพลาด: ',
```

- [ ] **Step 2: Add `ar.noUsers` + `ar.checkingQuota` to i18n.js th block (line 636)**

Find line 636 in `dashboard/i18n.js`:
```
'ar.testOk':'ส่งทดสอบสำเร็จ — ตรวจ LINE ของคุณ','ar.testFail':'ส่งไม่สำเร็จ: ','ar.configSaved':'บันทึก config สำเร็จ',
```
Change to:
```
'ar.testOk':'ส่งทดสอบสำเร็จ — ตรวจ LINE ของคุณ','ar.testFail':'ส่งไม่สำเร็จ: ','ar.configSaved':'บันทึก config สำเร็จ','ar.noUsers':'ยังไม่มีผู้ใช้','ar.checkingQuota':'กำลังตรวจสอบ quota…',
```

- [ ] **Step 3: Add `common.error` to i18n.js en block (line 1135)**

Find line 1135 in `dashboard/i18n.js`:
```
'common.saveFailed':'Failed to save: ','common.deleteFailed':'Failed to delete: ',
```
Change to:
```
'common.saveFailed':'Failed to save: ','common.deleteFailed':'Failed to delete: ','common.error':'Error: ',
```

- [ ] **Step 4: Add `ar.noUsers` + `ar.checkingQuota` to i18n.js en block (line 1369)**

Find line 1369 in `dashboard/i18n.js`:
```
'ar.testOk':'Test message sent — check your LINE','ar.testFail':'Send failed: ','ar.configSaved':'Config saved',
```
Change to:
```
'ar.testOk':'Test message sent — check your LINE','ar.testFail':'Send failed: ','ar.configSaved':'Config saved','ar.noUsers':'No users yet','ar.checkingQuota':'Checking quota…',
```

- [ ] **Step 5: Migrate page-alerts.js line 123**

Find:
```js
} catch (e) { alert('Delete error: ' + e.message); }
```
Change to:
```js
} catch (e) { alert(I18N.t('common.deleteFailed') + e.message); }
```

- [ ] **Step 6: Migrate page-alerts.js line 198**

Find:
```js
checklistEl.innerHTML = `<div style="color:var(--dim);font-size:11px;padding:6px">ยังไม่มีผู้ใช้</div>`;
```
Change to:
```js
checklistEl.innerHTML = `<div style="color:var(--dim);font-size:11px;padding:6px">${I18N.t('ar.noUsers')}</div>`;
```

- [ ] **Step 7: Migrate page-alerts.js line 269**

Find:
```js
} catch (e) { alert('Save error: ' + e.message); }
```
(the one inside `saveRuleEditor`)

Change to:
```js
} catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
```

- [ ] **Step 8: Migrate page-alerts.js line 379**

Find (inside alert log clear function):
```js
} catch (e) {
    alert('Error: ' + e.message);
  }
```
Change to:
```js
} catch (e) {
    alert(I18N.t('common.error') + e.message);
  }
```

- [ ] **Step 9: Migrate page-alerts.js line 406**

Find:
```js
el.innerHTML = `<div style="font-size:10px;color:var(--dim)">กำลังตรวจสอบ quota…</div>`;
```
Change to:
```js
el.innerHTML = `<div style="font-size:10px;color:var(--dim)">${I18N.t('ar.checkingQuota')}</div>`;
```

- [ ] **Step 10: Migrate page-alerts.js line 580**

Find (inside `testRecipient`):
```js
} catch (e) { alert('Error: ' + e.message); }
```
Change to:
```js
} catch (e) { alert(I18N.t('common.error') + e.message); }
```

- [ ] **Step 11: Migrate page-alerts.js line 606**

Find (inside `saveLineConfig`):
```js
} catch (e) { alert('Save error: ' + e.message); }
```
Change to:
```js
} catch (e) { alert(I18N.t('common.saveFailed') + e.message); }
```

- [ ] **Step 12: Syntax check**

```bash
node --check dashboard/i18n.js && node --check dashboard/page-alerts.js
```
Expected: no output (both pass)

- [ ] **Step 13: Commit**

```bash
git add dashboard/i18n.js dashboard/page-alerts.js
git commit -m "fix(i18n): localize page-alerts dynamic strings"
```

---

## Task 2: Migrate page-user-mgmt.js

**Files:**
- Modify: `dashboard/page-user-mgmt.js:146,286,389,397`

All 4 hits are `alert('Error: ' + e.message)` in catch blocks. No new i18n keys needed — `common.error` added in Task 1.

- [ ] **Step 1: Replace all 4 occurrences**

In `dashboard/page-user-mgmt.js`, replace every instance of:
```js
alert('Error: ' + e.message);
```
with:
```js
alert(I18N.t('common.error') + e.message);
```

There are exactly 4 occurrences at lines 146, 286, 389, 397.

- [ ] **Step 2: Syntax check**

```bash
node --check dashboard/page-user-mgmt.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add dashboard/page-user-mgmt.js
git commit -m "fix(i18n): localize page-user-mgmt error messages"
```

---

## Task 3: Migrate page-map-settings.js

**Files:**
- Modify: `dashboard/page-map-settings.js:255,292`

Both are `alert('Error: ' + e.message)` catch blocks. No new keys needed.

- [ ] **Step 1: Replace both occurrences**

In `dashboard/page-map-settings.js`, replace every instance of:
```js
alert('Error: ' + e.message);
```
with:
```js
alert(I18N.t('common.error') + e.message);
```

There are exactly 2 occurrences at lines 255 and 292.

- [ ] **Step 2: Syntax check**

```bash
node --check dashboard/page-map-settings.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add dashboard/page-map-settings.js
git commit -m "fix(i18n): localize page-map-settings error messages"
```

---

## Task 4: Migrate page-categories.js

**Files:**
- Modify: `dashboard/page-categories.js:292`

One occurrence of `alert('Error: ' + e.message)`. No new keys needed.

- [ ] **Step 1: Replace the occurrence**

In `dashboard/page-categories.js` at line 292, replace:
```js
} catch (e) { alert('Error: ' + e.message); }
```
with:
```js
} catch (e) { alert(I18N.t('common.error') + e.message); }
```

- [ ] **Step 2: Syntax check**

```bash
node --check dashboard/page-categories.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add dashboard/page-categories.js
git commit -m "fix(i18n): localize page-categories error messages"
```

---

## Task 5: Migrate page-camera-settings.js

**Files:**
- Modify: `dashboard/page-camera-settings.js:1057`

One hardcoded `'Error'` fallback string.

- [ ] **Step 1: Replace the occurrence**

In `dashboard/page-camera-settings.js` at line 1057, replace:
```js
if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || 'Error'); return; }
```
with:
```js
if (!r.ok) { const e = await r.json().catch(() => ({})); alert(e.error || I18N.t('common.loadFailedShort')); return; }
```

(`common.loadFailedShort` = th: 'โหลดไม่สำเร็จ' / en: 'Load failed' — already exists in i18n.js)

- [ ] **Step 2: Syntax check**

```bash
node --check dashboard/page-camera-settings.js
```
Expected: no output

- [ ] **Step 3: Commit**

```bash
git add dashboard/page-camera-settings.js
git commit -m "fix(i18n): localize page-camera-settings error fallback"
```

---

## Task 6: Reproduce

Verify all touched pages handle language switching correctly.

- [ ] **Step 1: Open Alerts page, switch Thai → English → Thai**

Navigate to the Alerts page. In the LINE Config section, check the quota widget loading state (briefly visible on page load or network throttle). Verify:
- Thai: `กำลังตรวจสอบ quota…`
- English: `Checking quota…`

In the Rule editor, expand "Send to Users" checklist with no users in system. Verify:
- Thai: `ยังไม่มีผู้ใช้`
- English: `No users yet`

- [ ] **Step 2: Trigger error alerts on Alerts page**

Force a save error (disconnect network, try to save a rule). Verify alert prefix changes language:
- Thai: `บันทึกไม่สำเร็จ: …`
- English: `Failed to save: …`

- [ ] **Step 3: Open Users page, switch language**

Navigate to User Management. Force an error (disconnect network → try to load users). Verify alert:
- Thai: `ข้อผิดพลาด: …`
- English: `Error: …`

- [ ] **Step 4: Check for `undefined` or raw key strings**

While on each touched page (Alerts, Users, Map Settings, Categories, Camera Settings), scan the DOM for visible text containing `undefined` or a bare i18n key pattern like `common.error`. None should be visible.

- [ ] **Step 5: Mobile responsive check (≤768px)**

Open DevTools → 375px width. Navigate through Alerts and Users pages. Verify no layout breaks from the text changes (most are alert() calls which are native browser dialogs — no layout impact).
