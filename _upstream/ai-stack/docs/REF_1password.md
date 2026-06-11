# REF_1password — ai-stack

> วิธีเก็บและ restore secrets ผ่าน 1Password CLI (`op`).
> Vault: **Personal** | Tag: **ai-stack**
> ติดตั้ง: `sudo dnf install 1password-cli` (official RPM repo)

---

## Secrets ที่เก็บไว้

| ชื่อ item | ประเภท | ของจริง |
|---|---|---|
| `ai-stack sudo` | Login | sudo password ของ user kiseki |
| `ai-stack OpenClaw Gateway Token` | Password | gateway.auth.token ใน openclaw.json |
| `ai-stack Open WebUI Admin` | Login | admin account ที่ localhost:3000 |
| `ai-stack Cloudflare Tunnel Credentials (f6684909)` | Document | `~/.cloudflared/f6684909...json` |
| `ai-stack SSH Private Key (id_ed25519)` | Document | `~/.ssh/id_ed25519` |
| `ai-stack SSH Public Key (id_ed25519.pub)` | Document | `~/.ssh/id_ed25519.pub` |

---

## คำสั่งพื้นฐาน

```bash
# login (ต้องรันใน terminal จริง ไม่ใช่ script/pipe — GOTCHAS #11)
eval $(op signin)

# ดู vault ที่มี
op vault list

# ดู items ทั้งหมดที่ tag ai-stack
op item list --tags=ai-stack

# ดูค่า item
op item get "ai-stack sudo" --field password
op item get "ai-stack OpenClaw Gateway Token" --field password
```

---

## Restore บนเครื่องใหม่

```bash
eval $(op signin)

# 1) Cloudflare Tunnel credentials
mkdir -p ~/.cloudflared
op document get "ai-stack Cloudflare Tunnel Credentials (f6684909)" \
  > ~/.cloudflared/f6684909-a7d7-4b0e-9d29-2328d52c1135.json
chmod 600 ~/.cloudflared/f6684909-a7d7-4b0e-9d29-2328d52c1135.json

# 2) SSH keys
mkdir -p ~/.ssh && chmod 700 ~/.ssh
op document get "ai-stack SSH Private Key (id_ed25519)" > ~/.ssh/id_ed25519
op document get "ai-stack SSH Public Key (id_ed25519.pub)" > ~/.ssh/id_ed25519.pub
chmod 600 ~/.ssh/id_ed25519
chmod 644 ~/.ssh/id_ed25519.pub

# 3) OpenClaw gateway token (inject เข้า config)
TOKEN=$(op item get "ai-stack OpenClaw Gateway Token" --field password)
# แล้ว set ใน ~/.openclaw/openclaw.json → gateway.auth.token
```

---

## เพิ่ม secret ใหม่ (Phase D)

```bash
# Telegram Bot Token (เมื่อได้จาก BotFather)
op item create \
  --category=password \
  --title="ai-stack Telegram Bot Token" \
  --vault=Personal \
  --tags=ai-stack \
  password="BOT_TOKEN_HERE" \
  notes="ai-stack · Phase D Telegram"

# Claude API Key (เมื่อต้องการ)
op item create \
  --category=password \
  --title="ai-stack Claude API Key" \
  --vault=Personal \
  --tags=ai-stack \
  password="sk-ant-..."
```

---

## ข้อควรระวัง

- `op signin` ต้องการ TTY — รันใน Konsole/Terminal เท่านั้น (GOTCHAS #11)
- ตรวจชื่อ vault ด้วย `op vault list` ก่อนเสมอ (GOTCHAS #12)
- Files (SSH key, credentials JSON) → `op document create` ไม่ใช่ `op item create` (GOTCHAS #13)

---

*ai-stack · REF_1password · 2026-06-03*
