// ============================================================
// Vigil Mobile — Type Definitions
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 DojoJin Tech. All Rights Reserved.
// @license Proprietary
// ============================================================

export interface Camera {
  camera_id: string;
  camera_name: string;
  ip_address: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  group_id?: number;
  group_name?: string;
  vendor?: string;          // bosch / hikvision / dahua / onvif (lowercase)
  last_seen?: string;
  status: 'online' | 'offline';
  alert_count_today?: number;
  has_iva?: boolean;
  recording?: boolean;
  sd_status?: string;
  notes?: string;
}

export interface CameraGroup {
  id: number;
  name: string;
  camera_count: number;
}

export interface CameraStats {
  total: number;
  online: number;
  offline: number;
  alerts_today: number;
}

export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  must_change_password: boolean;
}

export interface LoginPayload {
  username: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  token: string;
  user: User;
}

export interface ApiError {
  error: string;
  code?: string;
}

export interface StatsKpi {
  total_events:       number;
  alerts:             number;
  persons:            number;
  vehicles:           number;
  traffic_violations: number;
}

export interface CategoryStat {
  id:          number;
  name:        string;
  icon:        string;        // emoji (data จาก DB)
  color:       string;        // hex
  kind:        string;
  is_builtin:  boolean;
  sort_order:  number;
  count:       number;
  prev_count:  number;
  change_pct:  number | null; // null = no baseline (prev=0, cur>0)
}

export interface TopRule {
  rule_name:    string;
  count:        number;
  cameras_seen: number;
}

export interface TimelineBucket {
  bucket: string;   // ISO timestamp
  total:  number;
  alerts: number;
}

export interface TimelinePoint {
  bucket: string;   // ISO timestamp
  count:  number;
}

export interface TimelineSeries {
  category: { id: number; name: string; icon: string; color: string; kind: string; sort_order: number };
  points:   TimelinePoint[];
}

export interface VigilFace {
  id: number;
  event_time: string;
  camera_id: string;
  snapshot?:      string;   // face crop filename
  snapshot_full?: string;   // full-frame filename
  age?:           string;
  age_group?:     string;
  gender?:        'male' | 'female' | string;
  expression?:    string;
  glass?:         'yes' | 'no' | string;
  mask?:          'yes' | 'no' | string;
  hat?:           'yes' | 'no' | string;
  face_score?:    string;
  clip_file?:     string;
  clip_status?:   'pending' | 'done' | 'error';
}

export interface VigilEvent {
  id: number;
  camera_id: string;
  camera_name?: string;
  event_type: string;
  event_state?: string;
  event_time: string;
  location?: string;
  rule_name?: string;
  object_class?: string;
  likelihood?: number;       // 0-1 → แสดงเป็น % (× 100)
  speed?: number;            // m/s
  snapshot_file?: string;
  snapshot_source?: string;
  has_snapshot?: boolean;
  clip_file?: string;
  clip_status?: 'pending' | 'done' | 'error';
  clip_duration_sec?: number;
  raw_json?: Record<string, unknown>;
}
