-- ============================================================
-- Migration 101 — tunnel + Tailscale connectivity on metrics_host
-- @author Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license Proprietary
-- ============================================================
-- Stored as 0/1 (not BOOLEAN) so the same avg()-over-bucket trick used for
-- everything else in this table works unchanged: avg(tunnel_up) over a bucket
-- is "% of that window the tunnel was up", not just its last sampled value.
--
-- tunnel_up: is this machine's own cloudflared systemd unit active — sampled
-- locally per source (central samples itself; each edge samples itself and
-- rides it on the same heartbeat that already carries storage_json).
--
-- tailscale_up: is this machine reachable on the tailnet — sampled centrally
-- ONLY. Central's own `tailscale status --json` already reports every peer's
-- Online state in one call, so edges do not self-report this; central writes
-- a row per known site (source-tagged) off its own single sample. Rows may
-- therefore exist for a site with only tailscale_up set and every other
-- column null — the reader treats that as normal, not a data gap.
ALTER TABLE metrics_host
  ADD COLUMN IF NOT EXISTS tunnel_up    SMALLINT,
  ADD COLUMN IF NOT EXISTS tailscale_up SMALLINT;
