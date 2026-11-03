-- ============================================================
-- Vigil Platform — Fix vec_dot() performance (migration 131 regression)
-- @author    Prakasit Rochanavipart (Dojo-mAn)
-- @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
-- @license   Proprietary
-- ------------------------------------------------------------
-- migration 131's vec_dot() — `SELECT sum(a[i]*b[i]) FROM generate_subscripts(a,1)`
-- — is a SQL-language function whose body is a subquery. Postgres re-plans and
-- re-executes that subquery (including the generate_subscripts() set-returning
-- function) on every single row it's called against. Fine at the 1-row scale
-- it was tested at; at real production volume (~20k face_embeddings rows) the
-- search query measured 100.4s (EXPLAIN ANALYZE, 2026-08-10) — long enough to
-- trip the Cloudflare tunnel's timeout, surfacing to users as a bare
-- "signal is aborted without reason" with no server-side error logged at all
-- (the request never got a chance to fail on the Postgres side; the tunnel
-- killed the connection first).
--
-- Same dot product, implemented as a plain PL/pgSQL loop instead of a SQL
-- subquery — no per-row subquery executor/planner overhead. Same 20k-row
-- query: 861ms. Verified byte-identical output against the old function
-- before swapping (spot-checked self-similarity on real rows).
-- ============================================================

CREATE OR REPLACE FUNCTION vec_dot(a real[], b real[]) RETURNS real AS $$
DECLARE
  s real := 0;
  n int := array_length(a, 1);
BEGIN
  FOR i IN 1..n LOOP
    s := s + a[i] * b[i];
  END LOOP;
  RETURN s;
END;
$$ LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE;
