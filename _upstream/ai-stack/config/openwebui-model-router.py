"""
title: Model Router (ai-stack)
author: dojojin
version: 1.2.0
description: >
  Auto-route คำถามไปยังโมเดลที่เหมาะสมอัตโนมัติ:
  - มีรูปภาพ         → gemma3:4b        (multimodal)
  - โค้ด / debug     → qwen2.5-coder:7b (code specialist)
  - คำนวณ / ตรรกะ    → deepseek-r1:7b   (reasoning)
  - ทั่วไป / ไทย     → qwen3:4b         (general, มี thinking)

  หมายเหตุ: bge-m3 เป็น embedding model สำหรับ RAG — ไม่ได้ route ที่นี่
  (router นี้ route เฉพาะ chat) ตั้งใน Open WebUI → Settings → Documents
  → Embedding Model → bge-m3
"""

import re
import json
import requests
from typing import Generator, Iterator
from pydantic import BaseModel, Field


class Pipe:
    class Valves(BaseModel):
        OLLAMA_BASE_URL: str = Field(
            default="http://host.docker.internal:11434",
            description="Ollama API URL (จาก container → host)"
        )
        SHOW_ROUTING_REASON: bool = Field(
            default=True,
            description="แสดงเหตุผลที่เลือกโมเดลนี้ก่อนตอบ"
        )

    def __init__(self):
        self.type = "pipe"
        self.name = "🔀 Model Router"
        self.valves = self.Valves()

    def _detect_model(self, messages: list) -> tuple[str, str]:
        """
        วิเคราะห์ messages แล้วเลือกโมเดลที่เหมาะสม
        return: (model_name, reason)
        """
        last_msg = messages[-1] if messages else {}
        content = last_msg.get("content", "")

        # --- ตรวจรูปภาพ ---
        if isinstance(content, list):
            has_image = any(
                isinstance(c, dict) and c.get("type") == "image_url"
                for c in content
            )
            if has_image:
                return "gemma3:4b", "🖼️ ตรวจพบรูปภาพ → gemma3:4b (multimodal)"
            # รวม text parts
            text = " ".join(
                c.get("text", "") for c in content
                if isinstance(c, dict) and c.get("type") == "text"
            )
        else:
            text = content

        # --- ตรวจโค้ด (keyword + regex) ---
        CODE_PATTERNS = [
            # syntax markers
            r"```",
            r"\bdef\s+\w+\s*\(",
            r"\bclass\s+\w+",
            r"\bimport\s+\w+",
            r"\bfunction\s*\(",
            r"\bconst\s+\w+\s*=",
            r"\bvar\s+\w+",
            r"\blet\s+\w+",
            # thai code keywords
            r"โค้ด", r"สคริปต์", r"ฟังก์ชัน", r"โปรแกรม",
            r"บัค", r"เออเรอร์", r"debug",
            # common code terms
            r"\berror\b", r"\bbug\b", r"\bfix\b",
            r"\bapi\b", r"\bjson\b", r"\bsql\b",
            r"\bbash\b", r"\bshell\b", r"\bpython\b",
            r"\bjavascript\b", r"\btypescript\b",
        ]

        if any(re.search(p, text, re.IGNORECASE) for p in CODE_PATTERNS):
            return "qwen2.5-coder:7b", "💻 ตรวจพบคำถามเกี่ยวกับโค้ด → qwen2.5-coder:7b"

        # --- ตรวจงานคำนวณ / ตรรกะ (ใช้ reasoning model) ---
        REASONING_PATTERNS = [
            # นิพจน์คณิตศาสตร์ (มีตัวเลข + ตัวดำเนินการ)
            r"\d+\s*[\+\-\*/×÷^%]\s*\d+",
            # thai math/logic keywords
            r"คำนวณ", r"สมการ", r"แก้โจทย์", r"พิสูจน์", r"ตรรกะ",
            r"ทีละขั้น", r"อธิบายเหตุผล", r"คิดเป็นขั้น", r"คณิต",
            # english math/logic keywords
            r"\bsolve\b", r"\bprove\b", r"\bproof\b", r"\bcalculate\b",
            r"\bequation\b", r"\blogic(al)?\b", r"\breasoning\b",
            r"\bstep[\s-]?by[\s-]?step\b", r"\bmath\b", r"\balgebra\b",
        ]

        if any(re.search(p, text, re.IGNORECASE) for p in REASONING_PATTERNS):
            return "deepseek-r1:7b", "🧠 ตรวจพบงานคำนวณ/ตรรกะ → deepseek-r1:7b (reasoning)"

        # --- default: general / Thai ---
        return "qwen3:4b", "💬 คำถามทั่วไป → qwen3:4b"

    def pipe(self, body: dict) -> Generator:
        messages = body.get("messages", [])
        model, reason = self._detect_model(messages)

        # แสดงเหตุผลก่อนตอบ (ถ้าเปิด)
        if self.valves.SHOW_ROUTING_REASON:
            yield f"*{reason}*\n\n"

        # ส่งต่อไป Ollama
        payload = {**body, "model": model, "stream": True}

        try:
            resp = requests.post(
                f"{self.valves.OLLAMA_BASE_URL}/api/chat",
                json=payload,
                stream=True,
                timeout=120,
            )
            resp.raise_for_status()

            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    chunk = data.get("message", {}).get("content", "")
                    if chunk:
                        yield chunk
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue

        except requests.exceptions.RequestException as e:
            yield f"\n\n❌ Router error: {e}\nลองเลือกโมเดลตรง ๆ แทน"
