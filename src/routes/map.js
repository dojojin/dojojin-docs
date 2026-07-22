// ============================================================
// Vigil Platform — Map Tile Cache Routes
// @author Prakasit Rochanavipart (Dojo-mAn)
// @copyright (c) 2025-2026 Prakasit Rochanavipart. All Rights Reserved.
// @license Proprietary
// ============================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');

const MAP_CACHE_DIR  = path.join(__dirname, '../..', 'map-cache');
const MAP_AREAS_FILE = path.join(__dirname, '../..', 'map-areas.json');

// ============================================================
// Map Tile Cache + Area Management Routes
// Routes: POST /api/map/estimate, /api/map/download, /api/map/cancel
//         GET  /api/map/progress, /api/map/areas
//         DELETE /api/map/areas/:areaId, /api/map/cache
//         GET  /api/map/tiles/mapbox/:style/:z/:x/:y.png
//         GET  /tiles/:provider/:style/:z/:x/:y.png  (public, no auth)
//         GET  /tiles/:style/:z/:x/:y.png            (public, backward compat)
// Auth: /api/map/* gated by requireAdminForWrites in api-server.js (line 566)
//       /tiles/* is in PUBLIC_PREFIXES — no auth required
// ============================================================

module.exports = function mapRoutes(app, pool, { getMapboxToken, routeError }) {

  // Ensure cache dir exists at startup
  if (!fs.existsSync(MAP_CACHE_DIR)) fs.mkdirSync(MAP_CACHE_DIR, { recursive: true });

  // ─── Module-level state ───────────────────────────────────

  const mapDownloadState = {
    active: false,
    total: 0,
    done: 0,
    failed: 0,
    current: '',
    area: null,
    startedAt: null,
    finishedAt: null,
    errors: [],
    cancelled: false,
  };

  let _mapAreasCache = null, _mapAreasMtime = 0;

  // ─── File-based area store ────────────────────────────────

  function loadMapAreas() {
    try {
      const mtime = fs.existsSync(MAP_AREAS_FILE) ? fs.statSync(MAP_AREAS_FILE).mtimeMs : 0;
      if (mtime !== _mapAreasMtime) {
        _mapAreasCache = mtime ? JSON.parse(fs.readFileSync(MAP_AREAS_FILE, 'utf8')) : { areas: [] };
        _mapAreasMtime = mtime;
      }
      return _mapAreasCache || { areas: [] };
    } catch (e) { return { areas: [] }; }
  }

  function saveMapAreas(data) {
    try {
      fs.writeFileSync(MAP_AREAS_FILE, JSON.stringify(data, null, 2));
      _mapAreasMtime = 0; // invalidate cache
      return true;
    } catch (e) { return false; }
  }

  if (!fs.existsSync(MAP_AREAS_FILE)) saveMapAreas({ areas: [] });

  // ─── Tile math helpers ────────────────────────────────────

  function lonToTileX(lon, z) { return Math.floor((lon + 180) / 360 * Math.pow(2, z)); }
  function latToTileY(lat, z) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));
  }

  // Bounds + limits for map tile cache jobs. A compromised admin session or
  // operator typo could otherwise start a multi-TB world-scale download.
  const MAP_TILE_LIMITS = {
    MAX_TILES: 500000,             // ≈7.5GB at ~15KB/tile per style/provider
    MIN_ZOOM: 0, MAX_ZOOM: 22,
    MIN_LAT: -85, MAX_LAT: 85,     // Web Mercator usable range
    MIN_LNG: -180, MAX_LNG: 180,
  };

  // Returns error message string if invalid, or null if OK.
  function validateMapBounds(bbox, zoomMin, zoomMax) {
    if (!bbox || typeof bbox !== 'object') return 'bbox required (north, south, east, west)';
    const { north, south, east, west } = bbox;
    for (const [k, v] of [['north', north], ['south', south], ['east', east], ['west', west]]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `bbox.${k} must be a finite number`;
    }
    if (north < MAP_TILE_LIMITS.MIN_LAT || north > MAP_TILE_LIMITS.MAX_LAT
        || south < MAP_TILE_LIMITS.MIN_LAT || south > MAP_TILE_LIMITS.MAX_LAT) {
      return `latitude out of range [${MAP_TILE_LIMITS.MIN_LAT}, ${MAP_TILE_LIMITS.MAX_LAT}]`;
    }
    if (east < MAP_TILE_LIMITS.MIN_LNG || east > MAP_TILE_LIMITS.MAX_LNG
        || west < MAP_TILE_LIMITS.MIN_LNG || west > MAP_TILE_LIMITS.MAX_LNG) {
      return `longitude out of range [${MAP_TILE_LIMITS.MIN_LNG}, ${MAP_TILE_LIMITS.MAX_LNG}]`;
    }
    if (north <= south) return 'bbox.north must be greater than bbox.south';
    const zmin = parseInt(zoomMin, 10);
    const zmax = parseInt(zoomMax, 10);
    if (!Number.isFinite(zmin) || !Number.isFinite(zmax)) return 'zoomMin/zoomMax must be integers';
    if (zmin < MAP_TILE_LIMITS.MIN_ZOOM || zmax > MAP_TILE_LIMITS.MAX_ZOOM) {
      return `zoom out of range [${MAP_TILE_LIMITS.MIN_ZOOM}, ${MAP_TILE_LIMITS.MAX_ZOOM}]`;
    }
    if (zmin > zmax) return 'zoomMin must be <= zoomMax';
    return null;
  }

  function calculateTiles(bbox, zoomMin, zoomMax) {
    const { north, south, east, west } = bbox;
    let total = 0;
    const perZoom = {};
    for (let z = zoomMin; z <= zoomMax; z++) {
      const xMin = lonToTileX(west, z);
      const xMax = lonToTileX(east, z);
      const yMin = latToTileY(north, z);
      const yMax = latToTileY(south, z);
      const count = (xMax - xMin + 1) * (yMax - yMin + 1);
      perZoom[z] = count;
      total += count;
    }
    return { total, perZoom };
  }

  function estimateSize(tileCount) {
    const bytesPerTile = 15 * 1024; // 15 KB average
    return tileCount * bytesPerTile;
  }

  // ─── Tile download helpers ────────────────────────────────

  function downloadTile(url, destPath) {
    return new Promise((resolve) => {
      if (fs.existsSync(destPath)) return resolve({ skipped: true });
      fs.mkdirSync(path.dirname(destPath), { recursive: true });

      const lib = url.startsWith('https') ? require('https') : http;
      const req = lib.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'BoschCCTVDashboard/4.1 (offline cache)' }
      }, (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ error: `HTTP ${res.statusCode}` });
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            fs.writeFileSync(destPath, Buffer.concat(chunks));
            resolve({ ok: true, size: chunks.reduce((s, c) => s + c.length, 0) });
          } catch (e) { resolve({ error: e.message }); }
        });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    });
  }

  // Download tiles in area (background job)
  async function downloadAreaTiles(area) {
    const { bbox, zoomMin, zoomMax, styles, providers = ['carto'] } = area;

    // Build tile server matrix: [provider][style] = array of base URLs
    const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
    const tileServers = {
      carto: {
        streets: ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager`),
        light:   ['a','b','c'].map(s => `https://${s}.basemaps.cartocdn.com/light_all`),
      },
      mapbox: MAPBOX_TOKEN ? {
        streets: ['mapbox/streets-v12'],   // 1 server only — token rate limit
        light:   ['mapbox/light-v11'],
      } : null,
    };

    const buildUrl = (provider, style, z, x, y, serverIdx) => {
      if (provider === 'mapbox') {
        const styleId = tileServers.mapbox[style][0];
        return `https://api.mapbox.com/styles/v1/${styleId}/tiles/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;
      }
      const servers = tileServers.carto[style];
      return `${servers[serverIdx % servers.length]}/${z}/${x}/${y}.png`;
    };

    const validProviders = providers.filter(p => tileServers[p]);
    if (validProviders.length === 0) {
      console.error('No valid providers selected (mapbox needs MAPBOX_TOKEN in .env)');
      return;
    }

    const calc = calculateTiles(bbox, zoomMin, zoomMax);
    mapDownloadState.active = true;
    mapDownloadState.cancelled = false;
    mapDownloadState.total = calc.total * styles.length * validProviders.length;
    mapDownloadState.done = 0;
    mapDownloadState.failed = 0;
    mapDownloadState.area = area;
    mapDownloadState.startedAt = new Date().toISOString();
    mapDownloadState.finishedAt = null;
    mapDownloadState.errors = [];

    for (const provider of validProviders) {
      if (mapDownloadState.cancelled) break;
      for (const style of styles) {
        if (mapDownloadState.cancelled) break;
        if (!tileServers[provider][style]) continue;

        for (let z = zoomMin; z <= zoomMax; z++) {
          if (mapDownloadState.cancelled) break;
          const xMin = lonToTileX(bbox.west, z);
          const xMax = lonToTileX(bbox.east, z);
          const yMin = latToTileY(bbox.north, z);
          const yMax = latToTileY(bbox.south, z);

          // Concurrent downloads — Mapbox 4, Carto 8
          const concurrency = provider === 'mapbox' ? 4 : 8;
          const tiles = [];
          for (let x = xMin; x <= xMax; x++) {
            for (let y = yMin; y <= yMax; y++) {
              tiles.push({ x, y, z });
            }
          }

          let serverIdx = 0;
          for (let i = 0; i < tiles.length; i += concurrency) {
            if (mapDownloadState.cancelled) break;
            const batch = tiles.slice(i, i + concurrency);
            await Promise.all(batch.map(async (t) => {
              if (mapDownloadState.cancelled) return;
              const url = buildUrl(provider, style, t.z, t.x, t.y, serverIdx++);
              const dest = path.join(MAP_CACHE_DIR, provider, style, String(t.z), String(t.x), `${t.y}.png`);
              mapDownloadState.current = `${provider} ${style} z${t.z} ${t.x}/${t.y}`;
              const result = await downloadTile(url, dest);
              if (result.error) {
                mapDownloadState.failed++;
                if (mapDownloadState.errors.length < 50) {
                  mapDownloadState.errors.push({
                    tile: `${provider}/${style}/${t.z}/${t.x}/${t.y}`,
                    error: result.error,
                  });
                }
              }
              mapDownloadState.done++;
            }));
          }
        }
      }
    }

    mapDownloadState.active = false;
    mapDownloadState.finishedAt = new Date().toISOString();
    mapDownloadState.current = mapDownloadState.cancelled ? 'cancelled' : 'completed';
    console.log(`🗺️  Map cache download ${mapDownloadState.current}: ${mapDownloadState.done}/${mapDownloadState.total} tiles (${mapDownloadState.failed} failed)`);
  }

  // ─── Routes ───────────────────────────────────────────────

  // API: Calculate tile count + size estimate
  app.post('/api/map/estimate', (req, res) => {
    try {
      const { bbox, zoomMin = 8, zoomMax = 16, styles = ['streets', 'light'], providers = ['carto'] } = req.body;
      const boundsErr = validateMapBounds(bbox, zoomMin, zoomMax);
      if (boundsErr) return res.status(400).json({ error: boundsErr });

      const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
      const validProviders = providers.filter(p => p === 'carto' || (p === 'mapbox' && MAPBOX_TOKEN));

      const calc = calculateTiles(bbox, zoomMin, zoomMax);
      const totalTiles = calc.total * styles.length * validProviders.length;
      res.json({
        bbox,
        zoomRange: [zoomMin, zoomMax],
        styles,
        providers: validProviders,
        tilesPerStyle: calc.total,
        totalTiles,
        estimatedSize: estimateSize(totalTiles),
        perZoom: calc.perZoom,
        mapboxAvailable: !!MAPBOX_TOKEN,
      });
    } catch (e) { routeError(res, e, 'POST /api/map/estimate'); }
  });

  // API: Start download (background)
  app.post('/api/map/download', (req, res) => {
    if (mapDownloadState.active) {
      return res.status(409).json({ error: 'Download already in progress' });
    }
    const { name, bbox, zoomMin = 8, zoomMax = 16, styles = ['streets', 'light'], providers = ['carto'] } = req.body;
    const boundsErr = validateMapBounds(bbox, zoomMin, zoomMax);
    if (boundsErr) return res.status(400).json({ error: boundsErr });

    // Cap total tile count BEFORE background job to prevent disk-fill on oversized bbox
    const MAPBOX_TOKEN_CHECK = process.env.MAPBOX_TOKEN || '';
    const validProvidersForCount = (providers || []).filter(p => p === 'carto' || (p === 'mapbox' && MAPBOX_TOKEN_CHECK));
    const calc = calculateTiles(bbox, zoomMin, zoomMax);
    const totalTiles = calc.total * (styles?.length || 1) * (validProvidersForCount.length || 1);
    if (totalTiles > MAP_TILE_LIMITS.MAX_TILES) {
      return res.status(400).json({
        error: `Too many tiles (${totalTiles.toLocaleString()}). Max allowed: ${MAP_TILE_LIMITS.MAX_TILES.toLocaleString()}. Reduce bbox or zoom range.`,
        totalTiles, maxTiles: MAP_TILE_LIMITS.MAX_TILES,
      });
    }

    const area = {
      id: `area_${Date.now()}`,
      name: name || 'Unnamed Area',
      bbox, zoomMin, zoomMax, styles, providers,
      createdAt: new Date().toISOString(),
    };

    const data = loadMapAreas();
    data.areas.push(area);
    saveMapAreas(data);

    downloadAreaTiles(area).catch(err => {
      console.error('Download error:', err);
      mapDownloadState.active = false;
    });

    res.json({ success: true, area });
  });

  // API: Get download progress
  app.get('/api/map/progress', (req, res) => {
    res.json({
      ...mapDownloadState,
      progressPercent: mapDownloadState.total > 0
        ? (mapDownloadState.done / mapDownloadState.total * 100).toFixed(1)
        : 0,
    });
  });

  // API: Cancel download
  app.post('/api/map/cancel', (req, res) => {
    mapDownloadState.cancelled = true;
    res.json({ success: true });
  });

  // API: List saved areas + cache stats
  app.get('/api/map/areas', (req, res) => {
    const areas = loadMapAreas().areas || [];
    let totalSize = 0;
    let totalTiles = 0;
    try {
      const styles = fs.readdirSync(MAP_CACHE_DIR).filter(f => fs.statSync(path.join(MAP_CACHE_DIR, f)).isDirectory());
      for (const style of styles) {
        const styleDir = path.join(MAP_CACHE_DIR, style);
        const walker = (dir) => {
          let size = 0, count = 0;
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const fp = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const sub = walker(fp);
                size += sub.size; count += sub.count;
              } else {
                size += fs.statSync(fp).size;
                count++;
              }
            }
          } catch {}
          return { size, count };
        };
        const stat = walker(styleDir);
        totalSize += stat.size;
        totalTiles += stat.count;
      }
    } catch {}
    res.json({ areas, cacheSize: totalSize, cachedTiles: totalTiles });
  });

  // API: Delete saved area record
  app.delete('/api/map/areas/:areaId', (req, res) => {
    const data = loadMapAreas();
    data.areas = (data.areas || []).filter(a => a.id !== req.params.areaId);
    saveMapAreas(data);
    res.json({ success: true });
  });

  // API: Clear entire tile cache
  app.delete('/api/map/cache', (req, res) => {
    try {
      if (fs.existsSync(MAP_CACHE_DIR)) {
        fs.rmSync(MAP_CACHE_DIR, { recursive: true, force: true });
        fs.mkdirSync(MAP_CACHE_DIR, { recursive: true });
      }
      res.json({ success: true });
    } catch (e) { routeError(res, e, 'DELETE /api/map/cache'); }
  });

  // SEC-017: Mapbox tile proxy — keeps token server-side; auth-gated (under /api middleware).
  // Cache-check first (reuses MAP_CACHE_DIR/mapbox/style/z/x/y.png from download worker).
  // On cache miss: fetch from Mapbox with server-side MAPBOX_TOKEN, write cache, return PNG.
  app.get('/api/map/tiles/mapbox/:style/:z/:x/:y.png', async (req, res) => {
    const { style, z, x, y } = req.params;
    if (!/^[a-z_]+$/.test(style) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return res.status(400).end();
    }
    const MAPBOX_TOKEN = await getMapboxToken();
    if (!MAPBOX_TOKEN) return res.status(503).json({ error: 'mapbox_not_configured' });

    const cachePath = path.join(MAP_CACHE_DIR, 'mapbox', style, z, x, `${y}.png`);
    if (fs.existsSync(cachePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(cachePath);
    }

    const styleId = style === 'light' ? 'mapbox/light-v11' : 'mapbox/streets-v12';
    const upstreamUrl = `https://api.mapbox.com/styles/v1/${styleId}/tiles/${z}/${x}/${y}@2x?access_token=${MAPBOX_TOKEN}`;

    try {
      const result = await new Promise((resolve) => {
        require('https').get(upstreamUrl, { timeout: 10000, headers: { 'User-Agent': 'VigilDashboard/1.5' } }, (upstream) => {
          if (upstream.statusCode !== 200) {
            upstream.resume();
            return resolve({ error: upstream.statusCode });
          }
          const chunks = [];
          upstream.on('data', c => chunks.push(c));
          upstream.on('end', () => {
            const buf = Buffer.concat(chunks);
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, buf);
            resolve({ buf });
          });
        }).on('error', e => resolve({ error: e.message }));
      });

      if (result.error) return res.status(502).end();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.end(result.buf);
    } catch (e) {
      res.status(500).end();
    }
  });

  // Static serve cached tiles
  // Format: /tiles/{provider}/{style}/{z}/{x}/{y}.png  (e.g. /tiles/carto/streets/15/...)
  // Public — isPublicAsset('/tiles/') passes; no auth required.
  app.get('/tiles/:provider/:style/:z/:x/:y.png', (req, res) => {
    const { provider, style, z, x, y } = req.params;
    if (!/^[a-z_]+$/.test(provider) || !/^[a-z_]+$/.test(style) ||
        !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return res.status(400).end();
    }
    const filePath = path.join(MAP_CACHE_DIR, provider, style, z, x, `${y}.png`);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(filePath);
    } else {
      res.status(404).end();
    }
  });

  // Backward compat: /tiles/{style}/{z}/{x}/{y}.png → carto provider
  app.get('/tiles/:style/:z/:x/:y.png', (req, res) => {
    const { style, z, x, y } = req.params;
    if (!/^[a-z_]+$/.test(style) || !/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) {
      return res.status(400).end();
    }
    let filePath = path.join(MAP_CACHE_DIR, 'carto', style, z, x, `${y}.png`);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(MAP_CACHE_DIR, style, z, x, `${y}.png`);
    }
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(filePath);
    } else {
      res.status(404).end();
    }
  });

};
