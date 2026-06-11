# REF_commands — ai-stack

> คำสั่ง ops ประจำวัน. lookup อย่างเดียว — เหตุผล/ตรรกะอยู่ในไฟล์ LOGIC/ARCH.

---

## Ollama

```bash
ollama list                          # โมเดลที่มี
ollama ps                            # โมเดลที่โหลดอยู่ + GPU/CPU split
ollama run qwen2.5-coder:7b "..."    # แชตเร็ว ๆ จาก CLI
ollama pull <model>                  # ดึงโมเดล (ถ้าค้าง → สงสัย IPv6, GOTCHAS #1)
ollama rm <model>                    # ลบโมเดล
ollama create chinda-mt -f models/ChindaMT-4B.Modelfile   # สร้างจาก Modelfile

# service (host systemd)
sudo systemctl status ollama
sudo systemctl restart ollama
journalctl -u ollama -f              # ดู log (หา 'library=cuda' = เห็น GPU)
```

## Open WebUI (docker compose)

```bash
cd compose
docker compose up -d                 # เปิด
docker compose ps                    # สถานะ
docker compose logs -f openwebui     # log
docker compose down                  # ปิด
docker compose pull && docker compose up -d   # อัปเดต
# เข้าใช้: http://localhost:3000
```

## Continue.dev

```bash
# config อยู่ที่:
~/.continue/config.json
# แก้แล้ว reload: VS Code Command Palette → "Continue: Reload"
```

## OpenClaw (เฟส C ขึ้นไป)

```bash
# gateway service
systemctl --user status openclaw-gateway     # สถานะ
systemctl --user restart openclaw-gateway    # restart (ต้องทำหลังแก้ config)
systemctl --user stop openclaw-gateway       # หยุด

# สถานะจาก CLI
openclaw gateway status                      # port, log path, service file
openclaw doctor                              # ตรวจ config/security ครบ
openclaw doctor --fix                        # แก้อัตโนมัติ (permissions, session dir)

# โมเดล
openclaw models list --provider ollama       # โมเดลที่เห็น
openclaw models set ollama/qwen2.5-coder:7b  # เปลี่ยน default model

# config
openclaw config get <section>                # ดู config section
openclaw config set <key> <value>            # แก้ key (restart gateway หลังแก้)
# config file: ~/.openclaw/openclaw.json
# exec policy: ~/.openclaw/exec-approvals.json

# log
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

# WebChat UI
# เปิด browser → http://127.0.0.1:18789/
```

## 1Password CLI

```bash
eval $(op signin)                                    # login (ต้องการ TTY — ใช้ใน Konsole)
op vault list                                        # ดู vault ที่มี
op item list --tags=ai-stack                         # secrets ทั้งหมดของ project นี้
op item get "ai-stack sudo" --field password         # ดึงค่า field
op document get "ai-stack SSH Private Key (id_ed25519)" > ~/.ssh/id_ed25519   # restore file
# รายละเอียด store/restore ครบ: docs/REF_1password.md
```

## GPU / ระบบ

```bash
nvidia-smi                           # VRAM/อุณหภูมิ/โหลด
nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv
watch -n1 nvidia-smi                 # ดูสด ๆ ตอนรันโมเดล
free -h                              # RAM
df -h /                              # ดิสก์ (โมเดลกินเยอะ)
```

## เน็ต (บังคับ IPv4 — GOTCHAS #1)

```bash
curl -4 -fsS <url>                   # บังคับ IPv4
# rclone: --bind 0.0.0.0
```

---

*ai-stack · REF_commands · init 2026-06-01*
