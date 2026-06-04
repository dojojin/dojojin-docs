// ============================================================
// DojoJin Tech Dashboard — Shared Constants
// @author    Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license   Proprietary
// ============================================================

// กล้องถือว่า offline ถ้าไม่ได้รับ event/heartbeat ใน 90 วินาที
const OFFLINE_THRESHOLD_SEC = 90;

// SQL fragment กรอง Aggregation events ออก (ใช้ใน stats + summary)
// หมายเหตุ: leading-% pattern → seq scan หลัง time-range filter;
// พอรับได้สำหรับ 24h window แต่ควรวิเคราะห์ index เพิ่มถ้า table โต (Phase 2, F6)
const METRIC_EVENT_FILTER = `event_type NOT LIKE '%Aggregation%'`;

// MQTT ถือว่า healthy ถ้ามี event ใน 5 นาทีล่าสุด
const MQTT_HEALTHY_AGE_SEC = 300;

module.exports = { OFFLINE_THRESHOLD_SEC, METRIC_EVENT_FILTER, MQTT_HEALTHY_AGE_SEC };
