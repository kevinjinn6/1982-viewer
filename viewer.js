/* viewer.js -- walkable reconstruction of Kwu Tung North around December 1982 (viewer_1982),
 * prototype stage 1: 2D map on the 1982 photograph, ground-level walk in 3D, provenance on click.
 *
 * Plain script: no modules, no libraries, nothing fetched from outside this folder. Everything
 * lives in one closure; the only global is window.viewer (state and test hooks, at the end).
 * The key map in the corner of the walk is keymap.js (window.KeyMap1982), shared with the
 * analogue view; without it the viewer runs as before, with no key map.
 *
 * Data contract (written by viewer_1982/build_viewer.py into data/):
 *   scene.json        terrain grid, photo bounds, settings, counts
 *   terrain.bin       Float32 little-endian heights (mPD), ny rows x nx columns, row 0 = north edge
 *   ortho_1982.jpg    DOP1000-1982 covering ortho.bounds exactly, row 0 = north
 *   features.geojson  EPSG:2326; every feature carries id, layer, kind, tier, epoch, source,
 *                     source_date, check_status, notes (buildings also base_m, top_m, height_*)
 *
 * Coordinates. The data are EPSG:2326 metres (E, N) and mPD heights. Everything drawn uses one
 * local frame anchored at the terrain grid's north-west corner (x0, y1):
 *     X = E - x0      metres east
 *     Y = mPD         metres up (absolute; 8-30 m here, no precision issue)
 *     Z = y1 - N      metres south
 * Right-handed with Y up, so north is -Z. Terrain vertex (column i, row j) sits at
 * X = i * cell, Z = j * cell. Subtracting x0 / y1 keeps every Float32 coordinate under ~1 km.
 * The 2D map uses the same X / Z (screen x = east, screen y = south): north is up.
 * Heading is degrees clockwise from north: forward = (sin h, 0, -cos h), right = (cos h, 0, sin h).
 * Ground height at a point is bilinear between the four surrounding vertices (the contract);
 * the drawn terrain splits each cell into two triangles along its NE-SW diagonal, and draped
 * layers are clipped to exactly those triangles so they never sink into the ground.
 */
(() => {
  'use strict';

  // ?author on the address (2026-10-27): the author's working tools are shown (CSS .author-only), the record opens in full
  // and the first-visit card is skipped. Without it the page is the visitor's: nothing is removed, only hidden.
  const AUTHOR = new URLSearchParams(location.search).has('author');
  const INTRO_KEY = 'ktn1982.intro.v1';   // localStorage: the first-visit card was dismissed in this browser

  // ================================================================== constants
  // Confidence tiers (viewer_1982/CLAUDE.md section 6), from the Okabe-Ito set. Chosen by the user
  // on 2026-10-16 (option D of work/mockup/viewer_tiers/): inferred vermillion and rule-based yellow,
  // so that sourced and inferred stay apart in protan and deutan vision as 2D fills over the photo,
  // which the first palette (inferred #CC79A7, rule-based #E69F00) did not. Checked by
  // scripts/check_colours.py (viewer section), which reads TIERS, FILL_ALPHA and WALL_MIX from here.
  const TIERS = {
    'sourced':    { n: 1, hex: '#0072B2', label: 'Sourced',    def: 'its presence in Dec 1982 is shown in a dated source, such as a sheet footprint confirmed on the photo' },
    'rule-based': { n: 2, hex: '#F0E442', label: 'Rule-based', def: 'derived from a written rule by lot type (height_rules.md)' },
    'inferred':   { n: 3, hex: '#D55E00', label: 'Inferred',   def: 'its presence in Dec 1982 is not shown by a dated source: a guess, or a sheet outline the photo cannot confirm (each record says why); always flagged' },
    'analogue':   { n: 4, hex: '#009E73', label: 'Analogue',   def: 'informed by photos from other villages; never evidence for a specific building' },
  };
  const FILL_ALPHA = 0.38;         // 2D building fills over the photo (outlines are opaque)
  const WALL_MIX = 0.70;           // 3D solids: this much tier colour, the rest WALL_GREY
  const PENDING_HEX = '#FFFFFF';   // features not in the model (pending confirmation; absent in Dec 1982), 2D outline only
  const ABSENT = 'absent in Dec 1982';   // on a sheet, but the author's check found nothing on the Dec 1982 photo
  const notInModelText = (rec) => rec.props.status === ABSENT
    ? 'absent in Dec 1982 (the author\'s check): not in the model'
    : 'pending confirmation: not in the 1982 model';
  const STREAM_CORE = 'rgba(8,20,40,0.65)';   // the dark core that tells a watercourse from a lane (2D and 3D)
  const NO_TIER = { n: 0, hex: '#8C8C8C', label: 'No valid tier', def: 'tier missing or not one of the four: flagged' };
  const PAT = { plain: 0, bands: 1, stripes: 2 };
  // height_tier -> wall/roof pattern; anything else (missing, analogue, typo) draws as stripes
  const HEIGHT_PATTERN = { 'sourced': PAT.plain, 'rule-based': PAT.bands, 'inferred': PAT.stripes };
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

  // How each layer is drawn. Widths and heights here are VIEWER DEFAULTS, used only where a
  // feature carries no value of its own; the info panel then says so, and solids drawn at a
  // default height get the inferred-height stripes.
  const LAYER_STYLE = {
    buildings:    { kind: 'building', order: 50 },
    landuse:      { kind: 'drape', lift: 0.05, alpha: 0.28, width: 1.0, order: 10 },   // alphas: the photo stays readable underneath
    lanes:        { kind: 'drape', lift: 0.07, alpha: 0.42, width: 2.5, order: 20 },
    streams:      { kind: 'drape', lift: 0.09, alpha: 0.50, width: 1.5, order: 30 },
    walls:        { kind: 'wall', thickness: 0.25, height: 1.8, order: 40 },
    fences:       { kind: 'fence', height: 1.2, postEvery: 2.5, order: 41 },
    trees:        { kind: 'tree', height: 6.0, crown: 2.0, lift: 0.06, alpha: 0.28, order: 8 },   // canopy areas drape; single trees stand (height a viewer default)
    landcover:    { kind: 'drape', lift: 0.04, alpha: 0.28, width: 1.0, order: 6 },
    spot_heights: { kind: 'marker', order: 70 },
    piles:        { kind: 'drape', lift: 0.12, alpha: 0.65, width: 1.0, order: 45 },   // 2026-10-26: a low marker on the ground
  };
  const GENERIC_STYLE = { kind: 'generic', lift: 0.08, alpha: 0.40, width: 1.0, order: 15 };
  // walls and fences without a height_m: a narrow draped line (see buildRecords)
  const FLAT_LINE_STYLE = { kind: 'drape', lift: 0.10, alpha: 0.75, width: 0.35, order: 40 };

  const TERRAIN_PICK = 0xFFFFFE;   // pick id of the ground; features are 1..N; sky and the filler beyond the data are 0
  const WALKER_R = 0.3;            // walker's collision radius, m
  const STAND_OFF = 2.0;           // a click on a footprint puts the walker this far outside it, m
  const EDGE_KEEP = 0.5;           // the walker stays this far inside the terrain extent, m
  const CLICK_SLOP = 4;            // px of pointer travel that still counts as a click
  const FOV_Y = 60, NEAR = 0.1, FAR = 2000;
  const OVERLAY_W = 1530, OVERLAY_H = 992;             // "Frame for overlay": the Street View canvas, px (viewpoints.json VP01)
  const LIGHT = norm3([0.45, 0.8, 0.4]);              // direction towards the light: high, from the south-east
  const SKY_HORIZON = [0.86, 0.885, 0.90], SKY_ZENITH = [0.58, 0.69, 0.80];
  const FOG_DENSITY = 0.0032;                          // exp2 fog: ~10 % at 100 m, ~65 % at 320 m
  const WALL_GREY = [0.85, 0.85, 0.85];                // solids: WALL_MIX tier colour + the rest this grey
  const LOOK_DRAG = 0.25, LOOK_LOCK = 0.12;            // degrees of turn per pixel (drag / pointer lock)
  const TURN_RATE = 90;                                // deg/s, Q / E
  const RUN = 3;                                       // Shift multiplies the walking speed
  const MAP_MAX_SCALE = 40;                            // px per metre (the photo is 0.2 m per pixel)
  const SKIRT_M = 1500;                                // flat filler beyond the terrain, m
  const STRIDE = 17;                                   // floats per mesh vertex (see Mesh)
  const DEV_NOTE = 'Development build (--dev): the footprints may come from a working file outside viewer_1982/, so treat every feature here as development data.';
  const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  // ================================================================== state
  const viewer = { ready: false, loadMs: null, mode: 'map', errors: [] };
  window.viewer = viewer;

  let ui = null;               // DOM references
  let scene = null;            // scene.json
  let T = null;                // terrain (makeTerrain)
  let photo = null;            // the 1982 photograph (HTMLImageElement)
  let finishImgs = [];         // the wall finish textures (scene.finishes, kind wall-texture, at most 2), null where one failed to load
  let PR = null;               // photo rectangle in world X/Z: {x0, z0, w, h}
  let pilot = [];              // pilot boundary as world polygons [[ring, ...], ...]
  let eyeH = 1.6, walkSpeed = 1.4;
  let eyeVP = null;            // eye height (m) set by a fixed viewpoint or the hash (z=); walking on returns to eyeH
  let hfovSet = null;          // horizontal field of view (deg) from a viewpoint, the hash (fov=) or the FOV control; null = FOV_Y vertical
  let viewpoints = [];         // data/viewpoints.json: fixed viewpoints matched to a reference photo (VP01, ...)
  const recs = [];             // feature records, recs[fid - 1]
  const byId = new Map();      // feature id -> record
  const skipped = [];          // features that could not be drawn, with the reason
  let mapRecs = [];            // records in 2D drawing order
  const pendingRecs = [];      // status "pending confirmation": not the 1982 model; 2D outlines on request
  let showPending = false;
  let hotspots = [];           // data/hotspots.json: photo hotspots (2D map), each {E, N, x, z, ...}
  let photoCtx = null, PRC = null;   // the wider, coarser 1982 photo behind the map (context only)
  let waterImg = null, WR = null;    // the land-cover map (ponds, plots, hard ground) and its world rectangle (scene.water, since 2026-10-18)
  let detailImgs = null;             // close-range ground grain and water normals (scene.ground_detail)
  let stamp = '';                    // the build stamp, so a rebuild is never served from the cache
  let keymap = null;           // keymap.js: the key map in the corner of the walk
  const HOTSPOT_TYPES = {
    'field-today': { mark: 'F', label: 'Field photo, the site today', note: 'the author\'s own photograph of this place now; it shows the present, not 1982' },
    'analogue':    { mark: 'A', label: 'Analogue photo', note: 'from another village: informs materials and form only, never evidence for a specific 1982 building' },
    'archival':    { mark: 'H', label: 'Archival photo', note: 'a dated historical photograph' },
  };
  let drapedRecs = [];         // records with a draped part, topmost (highest lift) first
  let edgeGrid = null, bldGrid = null, edges = null;   // collision index (building outlines)
  const walker = { x: 0, z: 0, heading: 0, pitch: 0, placed: false };
  let selected = null;         // {type: 'feature', rec} | {type: 'terrain', x, z, y}
  let infoFieldsNow = null;    // the label -> value pairs on show in the info panel
  const keys = new Set();      // KeyboardEvent.code of every key held down
  let shiftHeld = false;
  let fps = 0, fpsFrames = 0, fpsT0 = 0, lastT = 0, lastStatus = 0, statusText = '';
  let needsResize = true, lockReleasedAt = -1e9, hintTimer = 0, loaded = false;
  const G = { gl: null, lost: false, broken: false, layers: [], stats: {} };   // WebGL resources
  const MV = { s: 1, cx: 0, cz: 0, w: 1, h: 1, dpr: 1, ctx: null, dirty: true, cursor: null, patterns: null, patDpr: 0, pilotPath: null };   // 2D map view

  // ================================================================== error capture
  window.addEventListener('error', (ev) => noteError(ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => noteError(ev.reason));

  function errText(e) {
    if (e instanceof Error) return e.message || String(e);
    if (typeof e === 'string') return e;
    try { return JSON.stringify(e) || String(e); } catch (err) { return String(e); }
  }
  function noteError(e) {
    const msg = errText(e);
    viewer.errors.push(msg);
    const box = document.getElementById('error');
    if (box) { box.hidden = false; box.textContent = 'Error: ' + msg; }
  }

  // ================================================================== small helpers
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrap360 = (d) => ((d % 360) + 360) % 360;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const headingOf = (dx, dz) => wrap360(deg(Math.atan2(dx, -dz)));   // world X/Z direction -> degrees from north
  function num(v) { const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return typeof x === 'number' && Number.isFinite(x) ? x : null; }
  function hexRgb(hex) { const h = hex.replace('#', ''); return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255); }
  function mixRgb(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgba(hex, a) { const c = hexRgb(hex); return `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`; }
  function fmtValue(v) {
    if (v === undefined) return 'MISSING';
    if (v === null) return 'null';
    if (v === '') return '""';   // an empty string, shown as such rather than as a blank cell
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  const toWorld = (E, N) => [E - T.x0, T.y1 - N];
  const toEN = (X, Z) => [X + T.x0, T.y1 - Z];
  function epochLabel() {
    // "Dec 1982" from the photo's YYYY-MM when it is in the scene's epoch, else the epoch itself
    const m = /^(\d{4})-(\d{2})$/.exec((scene.ortho && scene.ortho.source_date) || '');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (m && m[1] === String(scene.epoch) && +m[2] >= 1 && +m[2] <= 12) return months[+m[2] - 1] + ' ' + m[1];
    return String(scene.epoch || '');
  }

  // ================================================================== 2D geometry
  // Rings are flat arrays [x0, z0, x1, z1, ...] in world X/Z without the closing duplicate.
  function ringArea(r) {   // shoelace, positive when counter-clockwise in (x right, z up) terms
    let s = 0;
    for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) s += r[j] * r[i + 1] - r[i] * r[j + 1];
    return s / 2;
  }
  function pointInRing(x, z, r) {
    let inside = false;
    for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
      const xi = r[i], zi = r[i + 1], xj = r[j], zj = r[j + 1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function pointInPoly(x, z, poly) {   // even-odd over the outer ring and its holes
    let inside = false;
    for (const r of poly) if (pointInRing(x, z, r)) inside = !inside;
    return inside;
  }
  function pointInPolys(x, z, polys) { for (const p of polys) if (pointInPoly(x, z, p)) return true; return false; }
  function closestOnSeg(px, pz, ax, az, bx, bz, out) {   // writes the closest point to out, returns squared distance
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t, qz = az + dz * t;
    out[0] = qx; out[1] = qz;
    return (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
  }
  function nearestOnPolys(px, pz, polys) {   // nearest point on any ring: {d, x, z}
    const tmp = [0, 0];
    let best = Infinity, bx = px, bz = pz;
    for (const poly of polys) for (const r of poly) {
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
        const d2 = closestOnSeg(px, pz, r[j], r[j + 1], r[i], r[i + 1], tmp);
        if (d2 < best) { best = d2; bx = tmp[0]; bz = tmp[1]; }
      }
    }
    return { d: Math.sqrt(best), x: bx, z: bz };
  }
  function distToLine(px, pz, line) {
    const tmp = [0, 0];
    let best = Infinity;
    if (line.length === 2) return Math.hypot(px - line[0], pz - line[1]);
    for (let i = 0; i + 3 < line.length; i += 2) best = Math.min(best, closestOnSeg(px, pz, line[i], line[i + 1], line[i + 2], line[i + 3], tmp));
    return Math.sqrt(best);
  }
  function polysBBox(polys) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const poly of polys) for (const r of poly) for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
    }
    return Number.isFinite(x0) ? [x0, z0, x1, z1] : null;
  }

  // ================================================================== earcut
  // Polygon triangulation by ear clipping with hole bridging: a trimmed transcription of
  // Mapbox's earcut 2.2 (ISC licence, (c) Mapbox), 2D only and without its z-order hash
  // (footprints here have at most a few hundred vertices). data = [x0, y0, x1, y1, ...],
  // holeIndices = the vertex index at which each hole starts. Returns 3 vertex indices per triangle.
  function earcut(data, holeIndices) {
    const hasHoles = holeIndices && holeIndices.length;
    const outerLen = hasHoles ? holeIndices[0] * 2 : data.length;
    let outer = ecList(data, 0, outerLen, true);
    const tris = [];
    if (!outer || outer.next === outer.prev) return tris;
    if (hasHoles) outer = ecHoles(data, holeIndices, outer);
    ecLinked(outer, tris, 0);
    return tris;
  }
  function EcNode(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.steiner = false; }
  function ecInsert(i, x, y, last) {
    const p = new EcNode(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function ecRemove(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function ecSignedArea(data, start, end) {
    let sum = 0;
    for (let i = start, j = end - 2; i < end; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; }
    return sum;
  }
  function ecList(data, start, end, clockwise) {
    let last = null;
    if (clockwise === ecSignedArea(data, start, end) > 0) {
      for (let i = start; i < end; i += 2) last = ecInsert(i / 2, data[i], data[i + 1], last);
    } else {
      for (let i = end - 2; i >= start; i -= 2) last = ecInsert(i / 2, data[i], data[i + 1], last);
    }
    if (last && ecEquals(last, last.next)) { ecRemove(last); last = last.next; }
    return last;
  }
  function ecEquals(a, b) { return a.x === b.x && a.y === b.y; }
  function ecArea(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function ecFilter(start, end) {
    if (!start) return start;
    if (!end) end = start;
    let p = start, again;
    do {
      again = false;
      if (!p.steiner && (ecEquals(p, p.next) || ecArea(p.prev, p, p.next) === 0)) {
        ecRemove(p);
        p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function ecLinked(ear, tris, pass) {
    if (!ear) return;
    let stop = ear;
    while (ear.prev !== ear.next) {
      const prev = ear.prev, next = ear.next;
      if (ecIsEar(ear)) {
        tris.push(prev.i, ear.i, next.i);
        ecRemove(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) ecLinked(ecFilter(ear), tris, 1);
        else if (pass === 1) ecLinked(ecCure(ecFilter(ear), tris), tris, 2);
        else if (pass === 2) ecSplit(ear, tris);
        break;
      }
    }
  }
  function ecInTri(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) &&
      (ax - px) * (by - py) >= (bx - px) * (ay - py) &&
      (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function ecIsEar(ear) {
    const a = ear.prev, b = ear, c = ear.next;
    if (ecArea(a, b, c) >= 0) return false;
    const x0 = Math.min(a.x, b.x, c.x), y0 = Math.min(a.y, b.y, c.y), x1 = Math.max(a.x, b.x, c.x), y1 = Math.max(a.y, b.y, c.y);
    let p = c.next;
    while (p !== a) {
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 &&
        ecInTri(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && ecArea(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function ecCure(start, tris) {
    let p = start;
    do {
      const a = p.prev, b = p.next.next;
      if (!ecEquals(a, b) && ecIntersects(a, p, p.next, b) && ecLocallyInside(a, b) && ecLocallyInside(b, a)) {
        tris.push(a.i, p.i, b.i);
        ecRemove(p); ecRemove(p.next);
        p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return ecFilter(p);
  }
  function ecSplit(start, tris) {
    let a = start;
    do {
      let b = a.next.next;
      while (b !== a.prev) {
        if (a.i !== b.i && ecValidDiagonal(a, b)) {
          let c = ecSplitPolygon(a, b);
          a = ecFilter(a, a.next); c = ecFilter(c, c.next);
          ecLinked(a, tris, 0); ecLinked(c, tris, 0);
          return;
        }
        b = b.next;
      }
      a = a.next;
    } while (a !== start);
  }
  function ecHoles(data, holeIndices, outer) {
    const queue = [];
    for (let i = 0; i < holeIndices.length; i++) {
      const start = holeIndices[i] * 2, end = i < holeIndices.length - 1 ? holeIndices[i + 1] * 2 : data.length;
      const list = ecList(data, start, end, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      queue.push(ecLeftmost(list));
    }
    queue.sort((a, b) => a.x - b.x);
    for (const h of queue) outer = ecHole(h, outer);
    return outer;
  }
  function ecHole(hole, outer) {
    const bridge = ecBridge(hole, outer);
    if (!bridge) return outer;
    const bridgeReverse = ecSplitPolygon(bridge, hole);
    const filtered = ecFilter(bridge, bridge.next);
    ecFilter(bridgeReverse, bridgeReverse.next);
    return outer === bridge ? filtered : outer;
  }
  function ecBridge(hole, outer) {   // David Eberly's hole-to-outer bridge
    let p = outer, m = null, qx = -Infinity;
    const hx = hole.x, hy = hole.y;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        const x = p.x + ((hy - p.y) * (p.next.x - p.x)) / (p.next.y - p.y);
        if (x <= hx && x > qx) {
          qx = x;
          m = p.x < p.next.x ? p : p.next;
          if (x === hx) return m;
        }
      }
      p = p.next;
    } while (p !== outer);
    if (!m) return null;
    const stop = m, mx = m.x, my = m.y;
    let tanMin = Infinity;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x &&
        ecInTri(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        const tan = Math.abs(hy - p.y) / (hx - p.x);
        if (ecLocallyInside(p, hole) &&
          (tan < tanMin || (tan === tanMin && (p.x > m.x || (p.x === m.x && ecSectorContainsSector(m, p)))))) {
          m = p; tanMin = tan;
        }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function ecSectorContainsSector(m, p) { return ecArea(m.prev, m, p.prev) < 0 && ecArea(p.next, m, m.next) < 0; }
  function ecLeftmost(start) {
    let p = start, l = start;
    do { if (p.x < l.x || (p.x === l.x && p.y < l.y)) l = p; p = p.next; } while (p !== start);
    return l;
  }
  function ecValidDiagonal(a, b) {
    return a.next.i !== b.i && a.prev.i !== b.i && !ecIntersectsPolygon(a, b) &&
      ((ecLocallyInside(a, b) && ecLocallyInside(b, a) && ecMiddleInside(a, b) &&
        (ecArea(a.prev, a, b.prev) || ecArea(a, b.prev, b))) ||
        (ecEquals(a, b) && ecArea(a.prev, a, a.next) > 0 && ecArea(b.prev, b, b.next) > 0));
  }
  function ecSign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function ecOnSegment(p, q, r) { return q.x <= Math.max(p.x, r.x) && q.x >= Math.min(p.x, r.x) && q.y <= Math.max(p.y, r.y) && q.y >= Math.min(p.y, r.y); }
  function ecIntersects(p1, q1, p2, q2) {
    const o1 = ecSign(ecArea(p1, q1, p2)), o2 = ecSign(ecArea(p1, q1, q2));
    const o3 = ecSign(ecArea(p2, q2, p1)), o4 = ecSign(ecArea(p2, q2, q1));
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && ecOnSegment(p1, p2, q1)) return true;
    if (o2 === 0 && ecOnSegment(p1, q2, q1)) return true;
    if (o3 === 0 && ecOnSegment(p2, p1, q2)) return true;
    if (o4 === 0 && ecOnSegment(p2, q1, q2)) return true;
    return false;
  }
  function ecIntersectsPolygon(a, b) {
    let p = a;
    do {
      if (p.i !== a.i && p.next.i !== a.i && p.i !== b.i && p.next.i !== b.i && ecIntersects(p, p.next, a, b)) return true;
      p = p.next;
    } while (p !== a);
    return false;
  }
  function ecLocallyInside(a, b) {
    return ecArea(a.prev, a, a.next) < 0
      ? ecArea(a, b, a.next) >= 0 && ecArea(a, a.prev, b) >= 0
      : ecArea(a, b, a.prev) < 0 || ecArea(a, a.next, b) < 0;
  }
  function ecMiddleInside(a, b) {
    let p = a, inside = false;
    const px = (a.x + b.x) / 2, py = (a.y + b.y) / 2;
    do {
      if ((p.y > py) !== (p.next.y > py) && p.next.y !== p.y && px < ((p.next.x - p.x) * (py - p.y)) / (p.next.y - p.y) + p.x) inside = !inside;
      p = p.next;
    } while (p !== a);
    return inside;
  }
  function ecSplitPolygon(a, b) {
    const a2 = new EcNode(a.i, a.x, a.y), b2 = new EcNode(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a;
    a2.next = an; an.prev = a2;
    b2.next = a2; a2.prev = b2;
    bp.next = b2; b2.prev = bp;
    return b2;
  }
  // polygon (outer ring + holes) -> flat triangle coordinates [ax, az, bx, bz, cx, cz, ...]
  function polyTris(poly) {
    const flat = [], holes = [];
    poly.forEach((r, k) => { if (k) holes.push(flat.length / 2); for (const c of r) flat.push(c); });
    const idx = earcut(flat, holes), out = [];
    for (const i of idx) out.push(flat[2 * i], flat[2 * i + 1]);
    return out;
  }

  // ================================================================== uniform grid index
  class Grid {
    constructor(w, h, cell) {
      this.cell = cell;
      this.nx = Math.max(1, Math.ceil(w / cell) + 1);
      this.ny = Math.max(1, Math.ceil(h / cell) + 1);
      this.cells = new Array(this.nx * this.ny);
    }
    ix(x) { return clamp(Math.floor(x / this.cell), 0, this.nx - 1); }
    iz(z) { return clamp(Math.floor(z / this.cell), 0, this.ny - 1); }
    insert(x0, z0, x1, z1, item) {
      for (let j = this.iz(z0), j1 = this.iz(z1); j <= j1; j++) {
        for (let i = this.ix(x0), i1 = this.ix(x1); i <= i1; i++) (this.cells[j * this.nx + i] ||= []).push(item);
      }
    }
    at(x, z) { return this.cells[this.iz(z) * this.nx + this.ix(x)] || Grid.EMPTY; }
  }
  Grid.EMPTY = [];

  // ================================================================== terrain
  function makeTerrain(info, buf) {
    const nx = info.nx | 0, ny = info.ny | 0, cell = Number(info.cell_m);
    if (!(nx >= 2 && ny >= 2 && cell > 0)) throw new Error('scene.json: terrain nx / ny / cell_m missing or invalid');
    if (buf.byteLength !== nx * ny * 4) throw new Error(`terrain.bin is ${buf.byteLength} bytes; scene.json says ${nx} x ${ny} Float32 (${nx * ny * 4} bytes)`);
    let z;
    if (LITTLE_ENDIAN) z = new Float32Array(buf);
    else { const dv = new DataView(buf); z = new Float32Array(nx * ny); for (let k = 0; k < z.length; k++) z[k] = dv.getFloat32(4 * k, true); }
    for (let k = 0; k < z.length; k++) if (!Number.isFinite(z[k])) throw new Error('terrain.bin holds a non-finite height at index ' + k);
    const W = (nx - 1) * cell, H = (ny - 1) * cell;
    return {
      nx, ny, cell, W, H, z, x0: Number(info.x0), y1: Number(info.y1),
      inside: (X, Z) => X >= 0 && Z >= 0 && X <= W && Z <= H,
      bilinear(X, Z) {   // the contract's ground height
        const c = clamp(X / cell, 0, nx - 1), r = clamp(Z / cell, 0, ny - 1);
        const i = Math.min(c | 0, nx - 2), j = Math.min(r | 0, ny - 2), fx = c - i, fy = r - j, o = j * nx + i;
        return (z[o] * (1 - fx) + z[o + 1] * fx) * (1 - fy) + (z[o + nx] * (1 - fx) + z[o + nx + 1] * fx) * fy;
      },
      surface(X, Z) {    // the height of the DRAWN terrain: each cell split along its NE-SW diagonal
        const c = clamp(X / cell, 0, nx - 1), r = clamp(Z / cell, 0, ny - 1);
        const i = Math.min(c | 0, nx - 2), j = Math.min(r | 0, ny - 2), fx = c - i, fy = r - j, o = j * nx + i;
        return fx + fy <= 1 ? z[o] + (z[o + 1] - z[o]) * fx + (z[o + nx] - z[o]) * fy
          : z[o + nx + 1] + (z[o + nx] - z[o + nx + 1]) * (1 - fx) + (z[o + 1] - z[o + nx + 1]) * (1 - fy);
      },
    };
  }

  // ================================================================== features -> records
  function buildRecords(fc) {
    const feats = fc && Array.isArray(fc.features) ? fc.features : null;
    if (!feats) throw new Error('features.geojson is not a FeatureCollection');
    feats.forEach((f, k) => {
      const p = (f && f.properties) || {};
      const id = p.id !== undefined && p.id !== null && p.id !== '' ? String(p.id) : null;
      const label = id || `(feature #${k + 1}, no id)`;
      if (!f || !f.geometry) { skipped.push({ id: label, why: 'no geometry' }); return; }
      const layer = p.layer ? String(p.layer) : '(no layer)';
      const rec = {
        fid: 0, id: label, idMissing: !id, layer, props: p, geomType: f.geometry.type,
        tierKey: own(TIERS, p.tier) ? p.tier : null, tier: own(TIERS, p.tier) ? TIERS[p.tier] : NO_TIER,
        unchecked: p.check_status !== 'checked by eye',
        style: own(LAYER_STYLE, layer) ? LAYER_STYLE[layer] : GENERIC_STYLE,
        polys: [], lines: [], points: [], bbox: null, defaults: {}, heightPattern: PAT.plain, path: null,
      };
      // A wall or fence with no height in the data is drawn on the ground, not raised to a viewer
      // default: the sheets give no wall or fence heights, and only buildings have a placeholder.
      // a pond keeps its tier colour but lighter, so the water surface drawn on the ground under it reads (2026-10-18)
      // the river's open water (2026-10-29, traced off the Dec 1982 photo) the same way
      if (layer === 'landcover' && (p.kind === 'pond' || p.kind === 'river (water surface)')) rec.style = Object.assign({}, rec.style, { alpha: 0.12 });
      if ((rec.style.kind === 'wall' || rec.style.kind === 'fence') && !(num(p.height_m) > 0)) {
        rec.style = Object.assign({}, FLAT_LINE_STYLE, { order: rec.style.order });
        rec.flatNoHeight = true;
      }
      addGeometry(rec, f.geometry);
      if (!rec.polys.length && !rec.lines.length && !rec.points.length) { skipped.push({ id: label, why: 'no usable coordinates' }); return; }
      if (byId.has(rec.id)) { rec.id = `${rec.id} (duplicate #${k + 1})`; rec.idDuplicate = true; }
      // On the Aug 1983 sheet and not confirmed on the Dec 1982 photo (CLAUDE.md 5: flagged, not
      // included, until confirmed): kept out of the model -- no 3D, no collision, no counts --
      // and drawn on the 2D map only as an outline when asked for.
      if (p.status && p.status !== 'in model') {
        rec.pending = true;
        rec.bbox = featureBBox(rec);
        pendingRecs.push(rec);
        byId.set(rec.id, rec);
        return;
      }
      rec.fid = recs.length + 1;
      rec.bbox = featureBBox(rec);
      deriveDims(rec);
      recs.push(rec);
      byId.set(rec.id, rec);
    });
    mapRecs = recs.slice().sort((a, b) => (a.style.order - b.style.order) || (a.fid - b.fid));
    const liftOf = (r) => r.style.lift || GENERIC_STYLE.lift;
    drapedRecs = recs.filter((r) => (r.lines.length && r.style.kind !== 'wall' && r.style.kind !== 'fence') ||
      (r.polys.length && !['building', 'wall', 'fence'].includes(r.style.kind))).sort((a, b) => (liftOf(b) - liftOf(a)) || (b.fid - a.fid));
  }
  function addGeometry(rec, g) {
    const pt = (c) => (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) ? toWorld(c[0], c[1]) : null);
    const coords = (cs, isRing) => {
      const out = [];
      for (const c of Array.isArray(cs) ? cs : []) {
        const w = pt(c);
        if (!w) continue;
        const n = out.length;
        if (n && out[n - 2] === w[0] && out[n - 1] === w[1]) continue;   // consecutive duplicate
        out.push(w[0], w[1]);
      }
      // a ring's closing duplicate is implied; a closed LineString keeps it (it is a loop)
      if (isRing && out.length >= 4 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
      return out;
    };
    const poly = (cs) => {
      const rings = (Array.isArray(cs) ? cs : []).map((r) => coords(r, true));
      if (!rings.length || rings[0].length < 6) return;
      rec.polys.push(rings.filter((r, k) => k === 0 || r.length >= 6));
    };
    const line = (cs) => { const l = coords(cs, false); if (l.length >= 4) rec.lines.push(l); };
    switch (g.type) {
      case 'Polygon': poly(g.coordinates); break;
      case 'MultiPolygon': for (const c of g.coordinates || []) poly(c); break;
      case 'LineString': line(g.coordinates); break;
      case 'MultiLineString': for (const c of g.coordinates || []) line(c); break;
      case 'Point': { const w = pt(g.coordinates); if (w) rec.points.push(w); break; }
      case 'MultiPoint': for (const c of g.coordinates || []) { const w = pt(c); if (w) rec.points.push(w); } break;
      case 'GeometryCollection': for (const gg of g.geometries || []) addGeometry(rec, gg); break;
      default: break;
    }
  }
  function featureBBox(rec) {
    let b = polysBBox(rec.polys) || [Infinity, Infinity, -Infinity, -Infinity];
    const grow = (x, z) => { b = [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)]; };
    for (const l of rec.lines) for (let i = 0; i < l.length; i += 2) grow(l[i], l[i + 1]);
    for (const p of rec.points) grow(p[0], p[1]);
    return b;
  }
  // Heights, widths and patterns. A value the data lack is filled from LAYER_STYLE and recorded
  // in rec.defaults, so the info panel can say it is the viewer's, not the data's.
  function deriveDims(rec) {
    const p = rec.props, st = rec.style, d = rec.defaults;
    const val = (key, dflt) => { const v = num(p[key]); if (v !== null && v > 0) return v; d[key] = dflt; return dflt; };
    if (st.kind === 'building') {
      let base = num(p.base_m), top = num(p.top_m);
      if (base === null || top === null || !(top > base)) {
        let lo = Infinity, hi = -Infinity;
        for (const poly of rec.polys) for (let i = 0; i < poly[0].length; i += 2) {
          const g = T.bilinear(poly[0][i], poly[0][i + 1]);
          lo = Math.min(lo, g); hi = Math.max(hi, g);
        }
        const h = num(p.height_m) !== null && num(p.height_m) > 0 ? num(p.height_m) : (num(scene.placeholder_height_m) || 3);
        base = lo; top = hi + h;
        d.base_m = +base.toFixed(2); d.top_m = +top.toFixed(2);
      }
      rec.base = base; rec.top = top;
      rec.heightPattern = own(HEIGHT_PATTERN, p.height_tier) ? HEIGHT_PATTERN[p.height_tier] : PAT.stripes;
      const wfi = wallFinishes().findIndex((f) => f.texture === p.finish_texture);
      rec.finishIdx = p.finish_texture && wfi >= 0 && finishImgs[wfi] ? wfi + 1 : 0;   // 1 or 2: which wall texture; 0 none
      rec.finish = rec.finishIdx > 0;
      rec.finishAnalogue = rec.finish && wallFinishes()[wfi].appearance_tier === 'analogue';
      // roof from the Dec 1982 photo: the image of this roof lies roof_photo_shift_m [dE, dN] from the footprint
      const rs = Array.isArray(p.roof_photo_shift_m) ? p.roof_photo_shift_m.map(num) : null;
      rec.roofShift = p.roof_finish && rs && rs.length === 2 && rs.every((v) => v !== null) ? [rs[0], -rs[1]] : null;
      // pitched roof (roof_forms.json, tools/roof_geom.py): faces [[E, N, z], ...] -> world; walls rise to the lowest plane over them
      rec.roofFaces = null; rec.roofPlanes = null;
      if (Array.isArray(p.roof_faces) && p.roof_faces.length && rec.polys.length === 1) {
        const fw = p.roof_faces.map((f) => f.map(([E, N, y]) => { const [x, z] = toWorld(num(E), num(N)); return [x, num(y), z]; }));
        if (fw.every((f) => f.length >= 3 && f.every((q) => q.every(Number.isFinite)))) {
          rec.roofFaces = fw;
          rec.roofPlanes = fw.map(([a, b, c]) => {   // y = pa * x + pb * z + pc through three corners
            const det = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
            const pa = ((b[1] - a[1]) * (c[2] - a[2]) - (c[1] - a[1]) * (b[2] - a[2])) / det;
            const pb = ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / det;
            return [pa, pb, a[1] - pa * a[0] - pb * a[2]];
          });
        }
      }
      return;
    }
    if (st.kind === 'wall' || st.kind === 'fence' || st.kind === 'tree') {
      rec.h = val('height_m', st.height);
      if (st.kind === 'tree') rec.crown = val('crown_radius_m', st.crown);
      rec.heightPattern = d.height_m !== undefined ? PAT.stripes : (own(HEIGHT_PATTERN, p.height_tier) ? HEIGHT_PATTERN[p.height_tier] : PAT.plain);
    }
    if (rec.lines.length && st.kind !== 'wall' && st.kind !== 'fence') rec.width = val('width_m', st.width || GENERIC_STYLE.width);
  }

  // ================================================================== collision index
  // Only building footprints block the walker (exteriors only). Walls, fences and trees do not:
  // their gaps and gates are not mapped, so blocking them could trap the walker.
  function buildCollision() {
    edgeGrid = new Grid(T.W, T.H, 4);
    bldGrid = new Grid(T.W, T.H, 8);
    const e = [];
    const pad = WALKER_R + 0.1;
    for (const rec of recs) {
      if (rec.layer !== 'buildings' || !rec.polys.length) continue;
      bldGrid.insert(rec.bbox[0], rec.bbox[1], rec.bbox[2], rec.bbox[3], rec);
      for (const poly of rec.polys) for (const r of poly) {
        for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
          const k = e.length / 4;
          e.push(r[j], r[j + 1], r[i], r[i + 1]);
          edgeGrid.insert(Math.min(r[j], r[i]) - pad, Math.min(r[j + 1], r[i + 1]) - pad, Math.max(r[j], r[i]) + pad, Math.max(r[j + 1], r[i + 1]) + pad, k);
        }
      }
    }
    edges = Float64Array.from(e);
  }
  function buildingAt(x, z) {
    for (const rec of bldGrid.at(x, z)) {
      const b = rec.bbox;
      if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && pointInPolys(x, z, rec.polys)) return rec;
    }
    return null;
  }
  function clearance(x, z) {   // distance to the nearest building edge, exact up to WALKER_R + 0.1
    const tmp = [0, 0];
    let best = Infinity;
    for (const k of edgeGrid.at(x, z)) best = Math.min(best, closestOnSeg(x, z, edges[4 * k], edges[4 * k + 1], edges[4 * k + 2], edges[4 * k + 3], tmp));
    return Math.sqrt(best);
  }
  function inWalkArea(x, z) { return x >= EDGE_KEEP && z >= EDGE_KEEP && x <= T.W - EDGE_KEEP && z <= T.H - EDGE_KEEP; }
  function isFree(x, z) { return inWalkArea(x, z) && !buildingAt(x, z) && clearance(x, z) >= WALKER_R - 1e-6; }
  // push a circle of WALKER_R out of every building edge it overlaps; [x, z, ok]
  function pushOut(x, z) {
    const tmp = [0, 0];
    for (let it = 0; it < 6; it++) {
      let bd2 = WALKER_R * WALKER_R, qx = 0, qz = 0, hit = false;
      for (const k of edgeGrid.at(x, z)) {
        const d2 = closestOnSeg(x, z, edges[4 * k], edges[4 * k + 1], edges[4 * k + 2], edges[4 * k + 3], tmp);
        if (d2 < bd2) { bd2 = d2; qx = tmp[0]; qz = tmp[1]; hit = true; }
      }
      if (!hit) return [x, z, true];
      const d = Math.sqrt(bd2);
      if (d < 1e-9) return [x, z, false];
      const s = (WALKER_R + 1e-4) / d;
      x = qx + (x - qx) * s; z = qz + (z - qz) * s;
    }
    return [x, z, clearance(x, z) >= WALKER_R - 1e-3];
  }
  // Move by (dx, dz) in steps of at most 0.1 m (well under WALKER_R, so no edge can be crossed
  // in one step); each step is pushed out of the walls, which makes the walker slide along them.
  function moveWalker(dx, dz) {
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) return;
    leaveViewpoint();   // a fixed viewpoint's eye height holds only where it stands
    const n = Math.max(1, Math.ceil(len / 0.1));
    for (let k = 0; k < n; k++) {
      let x = clamp(walker.x + dx / n, EDGE_KEEP, T.W - EDGE_KEEP), z = clamp(walker.z + dz / n, EDGE_KEEP, T.H - EDGE_KEEP);
      const r = pushOut(x, z);
      if (!r[2]) break;
      x = clamp(r[0], EDGE_KEEP, T.W - EDGE_KEEP); z = clamp(r[1], EDGE_KEEP, T.H - EDGE_KEEP);
      if (buildingAt(x, z)) break;
      walker.x = x; walker.z = z;
    }
  }
  // nearest point where the walker may stand: rings of growing radius around (x, z)
  function nearestFree(x, z, ok = isFree) {
    x = clamp(x, EDGE_KEEP, T.W - EDGE_KEEP); z = clamp(z, EDGE_KEEP, T.H - EDGE_KEEP);
    if (ok(x, z)) return [x, z];
    for (let r = 0.1; r <= 80; r += r < 3 ? 0.1 : 0.5) {   // the first free point, clockwise from north, on the smallest ring
      const n = Math.min(360, Math.max(12, Math.ceil((2 * Math.PI * r) / 0.1)));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 2 * Math.PI, px = x + r * Math.sin(a), pz = z - r * Math.cos(a);
        if (ok(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }
  // The point nearest the click that is STAND_OFF outside the footprint and free to stand on,
  // with the heading that faces the footprint's nearest outline point.
  function standOff(rec, cx, cz) {
    const D = STAND_OFF + 0.02;
    let best = null, bestD = Infinity;
    const valid = (px, pz) => isFree(px, pz) && !pointInPolys(px, pz, rec.polys) && nearestOnPolys(px, pz, rec.polys).d >= STAND_OFF - 1e-3;
    const consider = (px, pz) => {
      const d = Math.hypot(px - cx, pz - cz);
      if (d < bestD && valid(px, pz)) { best = [px, pz]; bestD = d; }
    };
    for (const poly of rec.polys) poly.forEach((r, k) => {
      const sg = (k === 0 ? 1 : -1) * (ringArea(r) > 0 ? 1 : -1);   // outward normal = sg * (dz, -dx)
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
        const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        const ox = (sg * dz / l) * D, oz = (-sg * dx / l) * D, steps = Math.max(1, Math.ceil(l / 0.25));
        for (let t = 0; t <= steps; t++) consider(ax + (dx * t) / steps + ox, az + (dz * t) / steps + oz);
      }
    });
    if (!best) {
      const p = nearestFree(cx, cz, valid);
      if (valid(p[0], p[1])) best = p;
    }
    if (!best) best = nearestFree(cx, cz);
    const q = nearestOnPolys(best[0], best[1], rec.polys);
    return { x: best[0], z: best[1], heading: headingOf(q.x - best[0], q.z - best[1]) };
  }

  // ================================================================== meshes (CPU side)
  // One vertex = 14 floats: position (3), normal (3), colour rgba (4), feature id (1),
  // style (3: height pattern 0/1/2, unchecked 0/1, unlit 0/1).
  class Mesh {
    constructor() { this.v = new Float32Array(STRIDE * 1024); this.nv = 0; this.i = new Uint32Array(3072); this.ni = 0; }
    vert(x, y, z, nx, ny, nz, s) {
      if ((this.nv + 1) * STRIDE > this.v.length) { const v = new Float32Array(this.v.length * 2); v.set(this.v); this.v = v; }
      const o = this.nv * STRIDE, v = this.v;
      v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = nx; v[o + 4] = ny; v[o + 5] = nz;
      v[o + 6] = s.r; v[o + 7] = s.g; v[o + 8] = s.b; v[o + 9] = s.a; v[o + 10] = s.fid;
      v[o + 11] = s.pattern; v[o + 12] = s.unchecked; v[o + 13] = s.unlit; v[o + 14] = s.finish || 0;
      v[o + 15] = s.sx || 0; v[o + 16] = s.sz || 0;
      return this.nv++;
    }
    tri(a, b, c) {
      if (this.ni + 3 > this.i.length) { const i = new Uint32Array(this.i.length * 2); i.set(this.i); this.i = i; }
      this.i[this.ni++] = a; this.i[this.ni++] = b; this.i[this.ni++] = c;
    }
    quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  }
  function vstyle(rec, kind) {
    const c = hexRgb(rec.tier.hex), u = rec.unchecked ? 1 : 0;
    if (kind === 'solid') { const m = mixRgb(c, WALL_GREY, 1 - WALL_MIX); return { r: m[0], g: m[1], b: m[2], a: 1, fid: rec.fid, pattern: rec.heightPattern, unchecked: u, unlit: 0, finish: (rec.finishIdx || 0) + (rec.roofShift ? 4 : 0), sx: rec.roofShift ? rec.roofShift[0] : 0, sz: rec.roofShift ? rec.roofShift[1] : 0 }; }
    if (kind === 'glass') return { r: c[0], g: c[1], b: c[2], a: 0.35, fid: rec.fid, pattern: 0, unchecked: u, unlit: 1 };
    return { r: c[0], g: c[1], b: c[2], a: rec.style.alpha || GENERIC_STYLE.alpha, fid: rec.fid, pattern: 0, unchecked: u, unlit: 1 };
  }
  // vertical quad from (ax, az) to (bx, bz); bottoms y0a / y0b, tops y1a / y1b; normal (nx, 0, nz)
  function face(m, ax, az, bx, bz, y0a, y0b, y1a, y1b, nx, nz, s) {
    const a = m.vert(ax, y0a, az, nx, 0, nz, s), b = m.vert(bx, y0b, bz, nx, 0, nz, s);
    const c = m.vert(bx, y1b, bz, nx, 0, nz, s), d = m.vert(ax, y1a, az, nx, 0, nz, s);
    m.quad(a, b, c, d);
  }
  function addPrism(m, poly, y0, y1, s) {   // a building: walls of every ring, flat roof
    poly.forEach((r, k) => {
      const sg = (k === 0 ? 1 : -1) * (ringArea(r) > 0 ? 1 : -1);
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
        const ax = r[j], az = r[j + 1], bx = r[i], bz = r[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        face(m, ax, az, bx, bz, y0, y0, y1, y1, (sg * dz) / l, (-sg * dx) / l, s);
      }
    });
    const tris = polyTris(poly);
    for (let t = 0; t < tris.length; t += 6) {
      m.tri(m.vert(tris[t], y1, tris[t + 1], 0, 1, 0, s), m.vert(tris[t + 2], y1, tris[t + 3], 0, 1, 0, s), m.vert(tris[t + 4], y1, tris[t + 5], 0, 1, 0, s));
    }
    return tris;
  }
  // a building under a pitched roof: walls of every ring up to the lowest roof plane over each point (so the
  // gable ends rise to the ridge), in pieces of at most 0.5 m; then the roof faces as given
  function addPitched(m, poly, rec, s) {
    const y0 = rec.base, eav = rec.top, P = rec.roofPlanes;
    const yAt = (x, z) => { let y = Infinity; for (const [a, b, c] of P) y = Math.min(y, a * x + b * z + c); return Math.max(eav, y); };
    poly.forEach((r, k) => {
      const sg = (k === 0 ? 1 : -1) * (ringArea(r) > 0 ? 1 : -1);
      for (let i = 0, n = r.length, j = n - 2; i < n; j = i, i += 2) {
        const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az, l = Math.hypot(dx, dz);
        if (l < 1e-6) continue;
        const steps = Math.max(1, Math.ceil(l / 0.5)), nx = (sg * dz) / l, nz = (-sg * dx) / l;
        for (let t = 0; t < steps; t++) {
          const px = ax + (dx * t) / steps, pz = az + (dz * t) / steps, qx = ax + (dx * (t + 1)) / steps, qz = az + (dz * (t + 1)) / steps;
          face(m, px, pz, qx, qz, y0, y0, yAt(px, pz), yAt(qx, qz), nx, nz, s);
        }
      }
    });
    for (const f of rec.roofFaces) {
      const [a, b, c] = f;
      let n = norm3(cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
      if (n[1] < 0) n = [-n[0], -n[1], -n[2]];
      const v = f.map((q) => m.vert(q[0], q[1], q[2], n[0], n[1], n[2], s));
      for (let i = 1; i + 1 < v.length; i++) m.tri(v[0], v[i], v[i + 1]);
    }
  }
  function addBox(m, cx, cz, hw, y0, y1, s) {   // axis-aligned square prism (posts, trunks, pins)
    const x0 = cx - hw, x1 = cx + hw, z0 = cz - hw, z1 = cz + hw;
    face(m, x0, z1, x1, z1, y0, y0, y1, y1, 0, 1, s);
    face(m, x1, z0, x0, z0, y0, y0, y1, y1, 0, -1, s);
    face(m, x1, z1, x1, z0, y0, y0, y1, y1, 1, 0, s);
    face(m, x0, z0, x0, z1, y0, y0, y1, y1, -1, 0, s);
    m.quad(m.vert(x0, y1, z0, 0, 1, 0, s), m.vert(x1, y1, z0, 0, 1, 0, s), m.vert(x1, y1, z1, 0, 1, 0, s), m.vert(x0, y1, z1, 0, 1, 0, s));
  }
  function addFrustum(m, cx, cz, r0, r1, y0, y1, sides, s) {   // tree crown: n-gon, narrower at the top
    const tilt = (r0 - r1) / Math.max(1e-6, y1 - y0);
    const at = (k, r) => [cx + r * Math.cos((k / sides) * 2 * Math.PI), cz + r * Math.sin((k / sides) * 2 * Math.PI)];
    for (let k = 0; k < sides; k++) {
      const am = ((k + 0.5) / sides) * 2 * Math.PI, n = norm3([Math.cos(am), tilt, Math.sin(am)]);
      const p0 = at(k, r0), p1 = at(k + 1, r0), q0 = at(k, r1), q1 = at(k + 1, r1);
      m.quad(m.vert(p0[0], y0, p0[1], n[0], n[1], n[2], s), m.vert(p1[0], y0, p1[1], n[0], n[1], n[2], s),
        m.vert(q1[0], y1, q1[1], n[0], n[1], n[2], s), m.vert(q0[0], y1, q0[1], n[0], n[1], n[2], s));
    }
    for (const [y, r, ny] of [[y1, r1, 1], [y0, r0, -1]]) {
      const c = m.vert(cx, y, cz, 0, ny, 0, s);
      for (let k = 0; k < sides; k++) {
        const a = at(k, r), b = at(k + 1, r);
        m.tri(c, m.vert(a[0], y, a[1], 0, ny, 0, s), m.vert(b[0], y, b[1], 0, ny, 0, s));
      }
    }
  }
  function addDiamond(m, cx, cy, cz, r, s) {   // octahedron marker
    const eq = [[cx + r, cy, cz], [cx, cy, cz + r], [cx - r, cy, cz], [cx, cy, cz - r]];
    for (const apex of [[cx, cy + r, cz], [cx, cy - r, cz]]) {
      for (let k = 0; k < 4; k++) {
        const a = eq[k], b = eq[(k + 1) % 4];
        let n = norm3(cross3([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]]));
        const mid = [(a[0] + b[0] + apex[0]) / 3 - cx, (a[1] + b[1] + apex[1]) / 3 - cy, (a[2] + b[2] + apex[2]) / 3 - cz];
        if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) n = [-n[0], -n[1], -n[2]];
        m.tri(m.vert(a[0], a[1], a[2], n[0], n[1], n[2], s), m.vert(b[0], b[1], b[2], n[0], n[1], n[2], s), m.vert(apex[0], apex[1], apex[2], n[0], n[1], n[2], s));
      }
    }
  }
  // thin wall along a polyline, following the ground: pieces of at most 2 m, sunk 0.3 m
  function addWallLine(m, line, thick, height, s) {
    const hw = thick / 2;
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k], az = line[k + 1], bx = line[k + 2], bz = line[k + 3], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      const nx = dz / l, nz = -dx / l, ox = nx * hw, oz = nz * hw, pieces = Math.max(1, Math.ceil(l / 2));
      for (let p = 0; p < pieces; p++) {
        const x0 = ax + (dx * p) / pieces, z0 = az + (dz * p) / pieces, x1 = ax + (dx * (p + 1)) / pieces, z1 = az + (dz * (p + 1)) / pieces;
        const g0 = T.bilinear(x0, z0), g1 = T.bilinear(x1, z1);
        const b0 = g0 - 0.3, b1 = g1 - 0.3, t0 = g0 + height, t1 = g1 + height;
        face(m, x0 + ox, z0 + oz, x1 + ox, z1 + oz, b0, b1, t0, t1, nx, nz, s);
        face(m, x1 - ox, z1 - oz, x0 - ox, z0 - oz, b1, b0, t1, t0, -nx, -nz, s);
        m.quad(m.vert(x0 + ox, t0, z0 + oz, 0, 1, 0, s), m.vert(x1 + ox, t1, z1 + oz, 0, 1, 0, s), m.vert(x1 - ox, t1, z1 - oz, 0, 1, 0, s), m.vert(x0 - ox, t0, z0 - oz, 0, 1, 0, s));
        if (p === 0) face(m, x0 - ox, z0 - oz, x0 + ox, z0 + oz, b0, b0, t0, t0, -dx / l, -dz / l, s);
        if (p === pieces - 1) face(m, x1 + ox, z1 + oz, x1 - ox, z1 - oz, b1, b1, t1, t1, dx / l, dz / l, s);
      }
    }
  }
  // fence: posts at every vertex and every ~2.5 m, and a translucent band between them
  function addFence(mSolid, mGlass, line, height, postEvery, s, sg) {
    let carry = 0;
    const post = (x, z) => { const g = T.bilinear(x, z); addBox(mSolid, x, z, 0.05, g - 0.1, g + height, s); };
    post(line[0], line[1]);
    for (let k = 0; k + 3 < line.length; k += 2) {
      const ax = line[k], az = line[k + 1], bx = line[k + 2], bz = line[k + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-6) continue;
      for (let d = postEvery - carry; d < l - 0.3; d += postEvery) post(ax + ((bx - ax) * d) / l, az + ((bz - az) * d) / l);
      carry = (carry + l) % postEvery;
      post(bx, bz);
      const pieces = Math.max(1, Math.ceil(l / 2)), nx = (bz - az) / l, nz = -(bx - ax) / l;
      for (let p = 0; p < pieces; p++) {
        const x0 = ax + ((bx - ax) * p) / pieces, z0 = az + ((bz - az) * p) / pieces, x1 = ax + ((bx - ax) * (p + 1)) / pieces, z1 = az + ((bz - az) * (p + 1)) / pieces;
        const g0 = T.bilinear(x0, z0), g1 = T.bilinear(x1, z1);
        face(mGlass, x0, z0, x1, z1, g0 + 0.15, g1 + 0.15, g0 + height * 0.92, g1 + height * 0.92, nx, nz, sg);
      }
    }
  }
  function addTree(m, x, z, height, crown, s) {
    const g = T.bilinear(x, z);
    addBox(m, x, z, 0.15, g - 0.2, g + height * 0.45, s);
    addFrustum(m, x, z, crown, crown * 0.72, g + height * 0.35, g + height, 8, s);
  }
  function addMarker(m, x, z, s) {   // spot heights and other points: a pin with a diamond
    const g = T.bilinear(x, z);
    addBox(m, x, z, 0.03, g - 0.1, g + 0.62, s);
    addDiamond(m, x, g + 0.8, z, 0.2, s);
  }
  // A ribbon along a polyline as flat triangles: a quad per segment and an octagon at every
  // vertex (round joins and caps). Overlaps are harmless: each draped layer is drawn through
  // the stencil, so no pixel is blended twice.
  function ribbonTris(line, w) {
    const hw = w / 2, out = [], n = line.length / 2;
    for (let k = 0; k + 1 < n; k++) {
      const ax = line[2 * k], az = line[2 * k + 1], bx = line[2 * k + 2], bz = line[2 * k + 3], l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-6) continue;
      const px = (-(bz - az) / l) * hw, pz = ((bx - ax) / l) * hw;
      out.push(ax + px, az + pz, bx + px, bz + pz, bx - px, bz - pz, ax + px, az + pz, bx - px, bz - pz, ax - px, az - pz);
    }
    const R = hw / Math.cos(Math.PI / 8);   // octagon whose inscribed circle is the half-width
    for (let k = 0; k < n; k++) {
      const cx = line[2 * k], cz = line[2 * k + 1];
      for (let a = 0; a < 8; a++) {
        const a0 = ((a + 0.5) / 8) * 2 * Math.PI, a1 = ((a + 1.5) / 8) * 2 * Math.PI;
        out.push(cx, cz, cx + R * Math.cos(a0), cz + R * Math.sin(a0), cx + R * Math.cos(a1), cz + R * Math.sin(a1));
      }
    }
    return out;
  }
  // Drape flat triangles on the terrain exactly: each is clipped to the terrain's own triangles
  // (cell split NE-SW), so every output vertex lies on the drawn surface (+ lift).
  function drapeTris(m, tris, lift, s) {
    const c = T.cell, nx = T.nx, z = T.z, maxI = T.nx - 2, maxJ = T.ny - 2;
    for (let t = 0; t + 5 < tris.length; t += 6) {
      const ax = tris[t], az = tris[t + 1], bx = tris[t + 2], bz = tris[t + 3], cx = tris[t + 4], cz = tris[t + 5];
      const ori = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (!(Math.abs(ori) > 1e-10)) continue;
      if (Math.max(ax, bx, cx) < 0 || Math.min(ax, bx, cx) > T.W || Math.max(az, bz, cz) < 0 || Math.min(az, bz, cz) > T.H) continue;
      const sg = ori > 0 ? 1 : -1;
      const inT = (px, pz) => sg * ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) >= 0 &&
        sg * ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) >= 0 && sg * ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) >= 0;
      const i0 = clamp(Math.floor(Math.min(ax, bx, cx) / c), 0, maxI), i1 = clamp(Math.floor(Math.max(ax, bx, cx) / c), 0, maxI);
      const j0 = clamp(Math.floor(Math.min(az, bz, cz) / c), 0, maxJ), j1 = clamp(Math.floor(Math.max(az, bz, cz) / c), 0, maxJ);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x0 = i * c, x1 = x0 + c, z0 = j * c, z1 = z0 + c, o = j * nx + i;
          const hA = z[o] + lift, hB = z[o + 1] + lift, hC = z[o + nx] + lift, hD = z[o + nx + 1] + lift;
          if (inT(x0, z0) && inT(x1, z0) && inT(x0, z1) && inT(x1, z1)) {   // the whole cell is inside
            const A = m.vert(x0, hA, z0, 0, 1, 0, s), B = m.vert(x1, hB, z0, 0, 1, 0, s), C = m.vert(x0, hC, z1, 0, 1, 0, s), D = m.vert(x1, hD, z1, 0, 1, 0, s);
            m.tri(A, C, B); m.tri(B, C, D);
            continue;
          }
          for (let w = 0; w < 2; w++) {
            const tv = w === 0 ? [x0, z0, x0, z1, x1, z0] : [x1, z0, x0, z1, x1, z1];
            let poly = [ax, az, bx, bz, cx, cz];
            for (let e = 0; e < 3 && poly.length >= 6; e++) poly = clipHalf(poly, tv[2 * e], tv[2 * e + 1], tv[(2 * e + 2) % 6], tv[(2 * e + 3) % 6]);
            if (poly.length < 6) continue;
            const base = m.nv;
            for (let k = 0; k < poly.length; k += 2) {
              const fx = (poly[k] - x0) / c, fz = (poly[k + 1] - z0) / c;
              const h = w === 0 ? hA + (hB - hA) * fx + (hC - hA) * fz : hD + (hC - hD) * (1 - fx) + (hB - hD) * (1 - fz);
              m.vert(poly[k], h, poly[k + 1], 0, 1, 0, s);
            }
            for (let k = 1; k + 1 < poly.length / 2; k++) m.tri(base, base + k, base + k + 1);
          }
        }
      }
    }
  }
  // keep the part of convex polygon `poly` inside edge a->b of a cell triangle (both cell
  // triangles are clockwise in X / Z, so inside means cross(b - a, p - a) <= 0)
  function clipHalf(poly, ax, az, bx, bz) {
    const out = [], n = poly.length / 2;
    for (let k = 0; k < n; k++) {
      const px = poly[2 * k], pz = poly[2 * k + 1], q = (k + 1) % n, qx = poly[2 * q], qz = poly[2 * q + 1];
      const dp = -((bx - ax) * (pz - az) - (bz - az) * (px - ax)), dq = -((bx - ax) * (qz - az) - (bz - az) * (qx - ax));
      if (dp >= 0) out.push(px, pz);
      if (dp >= 0 !== dq >= 0) { const t = dp / (dp - dq); out.push(px + (qx - px) * t, pz + (qz - pz) * t); }
    }
    return out;
  }
  const closeRing = (r) => r.concat([r[0], r[1]]);

  // every layer -> {solid, drape, glass} meshes; one draw call per layer and kind
  function buildMeshes() {
    const L = new Map();
    let roofErr = 0;
    for (const rec of recs) {
      const st = rec.style;
      if (!L.has(rec.layer)) L.set(rec.layer, { layer: rec.layer, solid: new Mesh(), drape: new Mesh(), glass: new Mesh(), lift: st.lift || GENERIC_STYLE.lift });
      const b = L.get(rec.layer), S = vstyle(rec, 'solid'), D = vstyle(rec, 'drape'), lift = st.lift || GENERIC_STYLE.lift;
      for (const poly of rec.polys) {
        if (st.kind === 'building' && rec.roofFaces) addPitched(b.solid, poly, rec, S);
        else if (st.kind === 'building') {
          const tris = addPrism(b.solid, poly, rec.base, rec.top, S);
          let a = 0;
          for (let t = 0; t < tris.length; t += 6) a += Math.abs((tris[t + 2] - tris[t]) * (tris[t + 5] - tris[t + 1]) - (tris[t + 4] - tris[t]) * (tris[t + 3] - tris[t + 1])) / 2;
          const want = poly.reduce((acc, r, k) => acc + (k ? -1 : 1) * Math.abs(ringArea(r)), 0);
          if (want > 0) roofErr = Math.max(roofErr, Math.abs(a - want) / want);
        } else if (st.kind === 'wall') for (const r of poly) addWallLine(b.solid, closeRing(r), st.thickness, rec.h, S);
        else if (st.kind === 'fence') for (const r of poly) addFence(b.solid, b.glass, closeRing(r), rec.h, st.postEvery, S, vstyle(rec, 'glass'));
        else drapeTris(b.drape, polyTris(poly), lift, D);
      }
      for (const line of rec.lines) {
        if (st.kind === 'wall') addWallLine(b.solid, line, st.thickness, rec.h, S);
        else if (st.kind === 'fence') addFence(b.solid, b.glass, line, rec.h, st.postEvery, S, vstyle(rec, 'glass'));
        else {
          if (rec.layer === 'streams') drapeTris(b.drape, ribbonTris(line, 0.35 * (rec.width || GENERIC_STYLE.width)), lift, { r: 0.03, g: 0.08, b: 0.16, a: 0.65, fid: rec.fid, pattern: 0, unchecked: D.unchecked, unlit: 1 });
          drapeTris(b.drape, ribbonTris(line, rec.width || GENERIC_STYLE.width), lift, D);
        }
      }
      for (const pt of rec.points) {
        if (st.kind === 'tree') addTree(b.solid, pt[0], pt[1], rec.h, rec.crown, S);
        else addMarker(b.solid, pt[0], pt[1], S);
      }
    }
    G.stats.roofAreaMaxRelError = roofErr;
    return [...L.values()].sort((a, b) => a.lift - b.lift);
  }
  function pilotMesh() {   // white line on the ground along the pilot boundary (orientation only, not pickable)
    const m = new Mesh(), s = { r: 1, g: 1, b: 1, a: 0.6, fid: 0, pattern: 0, unchecked: 0, unlit: 1 };
    for (const poly of pilot) for (const r of poly) drapeTris(m, ribbonTris(closeRing(r), 0.25), 0.10, s);
    return m;
  }

  // ================================================================== WebGL
  const SHADERS = {
    terrainVS: `#version 300 es
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec3 aNormal;
      uniform mat4 uViewProj;
      out vec3 vPos;
      out vec3 vNormal;
      void main() { vPos = aPos; vNormal = aNormal; gl_Position = uViewProj * vec4(aPos, 1.0); }`,
    terrainFS: `#version 300 es
      precision highp float;
      in vec3 vPos;
      in vec3 vNormal;
      uniform sampler2D uPhoto;
      uniform vec4 uPhotoRect;      // world x0, z0 of the photo's NW corner; 1 / width, 1 / height
      uniform vec3 uLight;
      uniform vec3 uEye;
      uniform vec3 uFog;
      uniform float uFogDensity;
      uniform float uOutside;       // 1 for the flat filler beyond the data extent
      uniform sampler2D uDetail;    // the same photo at its own 0.1 m, 3 x 3 tiles round the walker (scene.ortho_tiles)
      uniform vec4 uDetailRect;     // world x0, z0 of the detail's NW corner; 1 / width, 1 / height
      uniform float uDetailOn;
      uniform sampler2D uWater;     // the sourced land cover (scene.water): r ponds, g cultivated plots, b lanes and yards
      uniform sampler2D uDetGrass;  // close-range grain by land cover (scene.ground_detail, analogue, tone removed)
      uniform sampler2D uDetSoil;
      uniform sampler2D uDetHard;
      uniform sampler2D uWaterN;    // ripple normals for the ponds
      uniform vec3 uDetTile;        // grass, soil, hard: metres per repeat
      uniform vec2 uDetFade;        // the grain fades out between these distances from the eye
      uniform float uDetOn;
      uniform vec4 uWaterRect;
      uniform float uWaterOn;
      uniform vec3 uSkyH;
      uniform vec3 uSkyZ;
      uniform float uTime;
      out vec4 outColor;
      void main() {
        vec2 uv = (vPos.xz - uPhotoRect.xy) * uPhotoRect.zw;
        float inPhoto = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * (1.0 - uOutside);
        vec3 photo = texture(uPhoto, clamp(uv, 0.0, 1.0)).rgb;
        // near the walker: the photo at 0.1 m, faded into the 0.2 m overview over the outer 8 % of the window
        vec2 duv = (vPos.xz - uDetailRect.xy) * uDetailRect.zw;
        vec2 de = min(duv, 1.0 - duv);
        float fd = uDetailOn * smoothstep(0.0, 0.08, min(de.x, de.y)) * (1.0 - uOutside);
        photo = mix(photo, texture(uDetail, clamp(duv, 0.0, 1.0)).rrr, fd);
        vec3 base = mix(vec3(0.60, 0.62, 0.62), photo, inPhoto);
        // the photograph carries its own 1982 light and shadow: the lamp only hints at the relief
        float diff = max(dot(normalize(vNormal), uLight), 0.0);
        vec3 col = base * (0.78 + 0.30 * diff);
        vec2 wuv = (vPos.xz - uWaterRect.xy) * uWaterRect.zw;
        vec3 cls = uWaterOn * (1.0 - uOutside) * texture(uWater, clamp(wuv, 0.0, 1.0)).rgb;
        float dist = distance(vPos, uEye);
        // close-range grain by the sourced land cover, over the photo's own tone (scene.ground_detail: analogue)
        float gf = uDetOn * (1.0 - smoothstep(uDetFade.x, uDetFade.y, dist)) * inPhoto * (1.0 - cls.r);
        if (gf > 0.001) {
          float gg = texture(uDetGrass, vPos.xz / uDetTile.x).r, gs = texture(uDetSoil, vPos.xz / uDetTile.y).r, gh = texture(uDetHard, vPos.xz / uDetTile.z).r;
          float g = mix(mix(gg, gs, cls.g), gh, cls.b);
          col *= mix(1.0, 0.45 + 1.1 * g, 0.55 * gf);
        }
        // the ponds: still water over the photo's own tone, reflecting the sky (a drawing choice: scene.water)
        float w = cls.r;
        if (w > 0.01) {
          vec2 q1 = vPos.xz / 6.0 + vec2(0.010, 0.006) * uTime, q2 = vPos.xz / 9.5 - vec2(0.007, 0.011) * uTime;
          vec3 t1 = texture(uWaterN, q1).rgb * 2.0 - 1.0, t2 = texture(uWaterN, q2).rgb * 2.0 - 1.0;
          vec3 n = normalize(vec3((t1.x + t2.x) * 0.06, 1.0, (t1.y + t2.y) * 0.06));
          vec3 v = normalize(uEye - vPos);
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 sky = mix(uSkyH, uSkyZ, clamp(r.y * 1.4, 0.0, 1.0));
          float spec = pow(max(dot(r, uLight), 0.0), 180.0) * 0.6;
          vec3 wcol = mix(base * 0.72, sky, clamp(fres * 0.9, 0.0, 0.85)) + spec;
          col = mix(col, wcol, w);
        }
        float d = distance(vPos, uEye) * uFogDensity;
        outColor = vec4(mix(col, uFog, 1.0 - exp(-d * d)), 1.0);
      }`,
    meshVS: `#version 300 es
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec3 aNormal;
      layout(location = 2) in vec4 aColor;
      layout(location = 3) in float aFid;
      layout(location = 4) in vec4 aStyle;
      layout(location = 5) in vec2 aShift;
      uniform mat4 uViewProj;
      out vec3 vPos;
      out vec3 vNormal;
      out vec4 vColor;
      flat out float vFid;
      flat out vec4 vStyle;
      flat out vec2 vShift;
      void main() {
        vPos = aPos; vNormal = aNormal; vColor = aColor; vFid = aFid; vStyle = aStyle; vShift = aShift;
        gl_Position = uViewProj * vec4(aPos, 1.0);
      }`,
    meshFS: `#version 300 es
      precision highp float;
      in vec3 vPos;
      in vec3 vNormal;
      in vec4 vColor;
      flat in float vFid;
      flat in vec4 vStyle;          // x: height pattern (0 plain, 1 bands, 2 stripes); y: unchecked; z: unlit; w: finish bits (1 wall texture, 2 roof from the 1982 photo)
      flat in vec2 vShift;          // roof from the photo: where its image lies, relative to the footprint (world x, z, metres)
      uniform sampler2D uPhoto;     // the Dec 1982 photograph, as on the terrain
      uniform vec4 uPhotoRect;
      uniform sampler2D uFinish;    // wall finish 1 (scene.finishes, first wall texture), tiled in world metres
      uniform vec2 uFinishTile;     // its tile size in metres (along the wall or east, up or south)
      uniform sampler2D uFinish2;   // wall finish 2
      uniform vec2 uFinishTile2;
      uniform vec4 uFinishTint2;    // rgb + amount: wall finish 2 drawn toward this colour (the analogue tier)
      uniform vec3 uLight;
      uniform vec3 uEye;
      uniform vec3 uFog;
      uniform float uFogDensity;
      uniform float uSelected;
      uniform float uTime;
      out vec4 outColor;
      // The patterns are drawn in world space, so they stay fixed to the surface as you move,
      // but their period is a power of two of a metre chosen from the screen-space derivative
      // and blended with the next level: stripes and dots keep about the same fine size on
      // screen at 1 m and at 200 m instead of turning into blobs close up. px = target period
      // in pixels. The antialiasing width comes from the unscaled derivative, so the level
      // changing inside a pixel quad leaves no seam.
      float stripe1(float u, float w, float duty) {          // u in periods; stripes centred on integers
        float d = abs(fract(u + 0.5) - 0.5);
        return 1.0 - smoothstep(0.5 * duty - w, 0.5 * duty + w, d);
      }
      float stripes(float x, float px, float duty) {         // x in metres across the stripes
        float fw = max(fwidth(x), 1e-6), lev = log2(fw * px), l0 = floor(lev), k0 = exp2(-l0), k1 = 0.5 * k0;
        return mix(stripe1(x * k0, fw * k0, duty), stripe1(x * k1, fw * k1, duty), lev - l0);
      }
      float dot1(vec2 u, float w, float r) {                 // u in periods; dots centred on integers
        float d = length(fract(u + 0.5) - 0.5);
        return 1.0 - smoothstep(r - w, r + w, d);
      }
      float dots(vec2 q, float px, float r) {                // q in metres
        vec2 f2 = fwidth(q);
        float fw = max(max(f2.x, f2.y), 1e-6), lev = log2(fw * px), l0 = floor(lev), k0 = exp2(-l0), k1 = 0.5 * k0;
        return mix(dot1(q * k0, fw * k0, r), dot1(q * k1, fw * k1, r), lev - l0);
      }
      void main() {
        vec3 n = normalize(vNormal);
        bool horiz = abs(n.y) > 0.6;
        // pattern coordinates in metres: plan (x, z) on roofs and the ground; (along the wall, height) on walls
        vec2 q = horiz ? vPos.xz : vec2(dot(vPos.xz, normalize(vec2(-n.z, n.x))), vPos.y);
        // archival finish: the texture replaces the tier colour on the walls and roof of the buildings it is
        // recorded for (matching_register.json, finishes); the tier stays in the info panel and on the 2D map
        // w = wall finish (0 none, 1 or 2) + 4 if the roof is drawn from the Dec 1982 photo
        float wi = mod(vStyle.w, 4.0);
        bool rp = horiz && vStyle.w > 3.5;                       // this roof as photographed in Dec 1982
        bool fin = !rp && wi > 0.5;
        vec2 puv = (vPos.xz + vShift - uPhotoRect.xy) * uPhotoRect.zw;
        vec2 fuv = vec2(q.x, -q.y);
        vec3 col = rp ? texture(uPhoto, clamp(puv, 0.0, 1.0)).rgb
          : wi > 1.5 ? mix(texture(uFinish2, fuv / uFinishTile2).rgb, uFinishTint2.rgb, uFinishTint2.a)
          : fin ? texture(uFinish, fuv / uFinishTile).rgb : vColor.rgb;
        if (vStyle.x > 1.5) col *= 1.0 - 0.24 * stripes((q.x + q.y) * 0.70711, 15.0, 0.42);   // inferred height: diagonal stripes
        else if (vStyle.x > 0.5) col *= 1.0 - 0.24 * stripes(q.y, 12.0, 0.36);              // rule-based height: horizontal bands
        if (vStyle.y > 0.5) col = mix(col, fin ? vec3(0.3) : vec3(1.0), 0.42 * dots(q, 7.0, 0.17));   // unchecked: fine dot stipple (dark on a white finish)
        float lit = vStyle.z > 0.5 ? 1.0 : rp ? 0.78 + 0.30 * max(dot(n, uLight), 0.0) : 0.62 + 0.45 * max(dot(n, uLight), 0.0);   // the photo carries its own 1982 light, as on the terrain
        col *= lit;
        if (abs(vFid - uSelected) < 0.5) col = mix(col, vec3(1.0), 0.32 + 0.12 * sin(uTime * 4.0));
        float d = distance(vPos, uEye) * uFogDensity;
        outColor = vec4(mix(col, uFog, 1.0 - exp(-d * d)), vColor.a);
      }`,
    pickVS: `#version 300 es
      layout(location = 0) in vec3 aPos;
      layout(location = 3) in float aFid;
      uniform mat4 uViewProj;
      flat out float vFid;
      void main() { vFid = aFid; gl_Position = uViewProj * vec4(aPos, 1.0); }`,
    pickFS: `#version 300 es
      precision highp float;
      flat in float vFid;
      out vec4 outColor;
      void main() {
        float id = floor(vFid + 0.5);
        outColor = vec4(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0), 255.0) / 255.0;
      }`,
    skyVS: `#version 300 es
      out vec2 vNdc;
      void main() {
        vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
        vNdc = p;
        gl_Position = vec4(p, 0.0, 1.0);
      }`,
    skyFS: `#version 300 es
      precision highp float;
      in vec2 vNdc;
      uniform vec3 uForward;
      uniform vec3 uRight;
      uniform vec3 uUp;
      uniform vec2 uTan;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      out vec4 outColor;
      void main() {
        vec3 d = normalize(uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);
        outColor = vec4(mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.55)), 1.0);
      }`,
  };

  function compile(gl, type, src, name) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`${name}: ${gl.getShaderInfoLog(sh)}`);
    return sh;
  }
  function program(gl, vs, fs, name) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name + ' vertex shader'));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name + ' fragment shader'));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`${name} program: ${gl.getProgramInfoLog(p)}`);
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u: new Proxy(u, { get: (o, k) => (k in o ? o[k] : null) }) };   // optimised-away uniforms -> null (a no-op)
  }

  function setupGL() {
    const gl = ui.gl.getContext('webgl2', { antialias: true, stencil: true, depth: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) {
      noteError('WebGL2 is not available in this browser: the 3D walk cannot run (the 2D map still works).');
      ui.btnWalk.disabled = true;
      return false;
    }
    G.gl = gl;
    ui.gl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.lost = true; hint('The graphics context was lost; waiting for the browser to restore it.', 0); });
    ui.gl.addEventListener('webglcontextrestored', () => { createGPU(); G.lost = false; hint('Graphics restored.', 2500); });
    const t0 = performance.now();
    G.cpu = { terrain: terrainMesh(), skirt: skirtMesh(), layers: buildMeshes(), pilot: pilotMesh() };
    G.stats.meshMs = Math.round(performance.now() - t0);
    createGPU();
    return true;
  }
  function terrainMesh() {
    const { nx, ny, cell, z } = T, v = new Float32Array(nx * ny * 6);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const o = j * nx + i, k = o * 6;
        const hx = (z[j * nx + Math.min(i + 1, nx - 1)] - z[j * nx + Math.max(i - 1, 0)]) / ((Math.min(i + 1, nx - 1) - Math.max(i - 1, 0)) * cell);
        const hz = (z[Math.min(j + 1, ny - 1) * nx + i] - z[Math.max(j - 1, 0) * nx + i]) / ((Math.min(j + 1, ny - 1) - Math.max(j - 1, 0)) * cell);
        const n = norm3([-hx, 1, -hz]);
        v[k] = i * cell; v[k + 1] = z[o]; v[k + 2] = j * cell; v[k + 3] = n[0]; v[k + 4] = n[1]; v[k + 5] = n[2];
      }
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let p = 0;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;   // NW, NE, SW, SE: split along NE-SW, as drapeTris assumes
        idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
    }
    return { v, idx };
  }
  function skirtMesh() {   // the terrain's edge continued flat for SKIRT_M, so the horizon is not a void
    const { nx, ny, cell, z } = T, ring = [];
    for (let i = 0; i < nx; i++) ring.push([i, 0]);
    for (let j = 1; j < ny; j++) ring.push([nx - 1, j]);
    for (let i = nx - 2; i >= 0; i--) ring.push([i, ny - 1]);
    for (let j = ny - 2; j > 0; j--) ring.push([0, j]);
    const v = new Float32Array(ring.length * 2 * 6), idx = [];
    ring.forEach(([i, j], k) => {
      const x = i * cell, zz = j * cell, h = z[j * nx + i];
      const ox = (i === 0 ? -1 : i === nx - 1 ? 1 : 0) * SKIRT_M, oz = (j === 0 ? -1 : j === ny - 1 ? 1 : 0) * SKIRT_M;
      v.set([x, h, zz, 0, 1, 0, x + ox, h, zz + oz, 0, 1, 0], k * 12);
      const a = 2 * k, b = 2 * ((k + 1) % ring.length);
      idx.push(a, a + 1, b + 1, a, b + 1, b);
    });
    return { v, idx: Uint32Array.from(idx) };
  }
  function createGPU() {
    const gl = G.gl;
    G.progTerrain = program(gl, SHADERS.terrainVS, SHADERS.terrainFS, 'terrain');
    G.progMesh = program(gl, SHADERS.meshVS, SHADERS.meshFS, 'mesh');
    G.progPick = program(gl, SHADERS.pickVS, SHADERS.pickFS, 'pick');
    G.progSky = program(gl, SHADERS.skyVS, SHADERS.skyFS, 'sky');
    G.skyVAO = gl.createVertexArray();
    G.terrain = uploadPN(G.cpu.terrain);
    G.skirt = uploadPN(G.cpu.skirt);
    G.layers = G.cpu.layers.map((L) => ({ layer: L.layer, lift: L.lift, solid: uploadMesh(L.solid), drape: uploadMesh(L.drape), glass: uploadMesh(L.glass) }));
    G.pilot = uploadMesh(G.cpu.pilot);
    G.stats.triangles = { terrain: G.cpu.terrain.idx.length / 3 };
    for (const L of G.cpu.layers) G.stats.triangles[L.layer] = (L.solid.ni + L.drape.ni + L.glass.ni) / 3;
    // the photograph, mipmapped, with anisotropic filtering for the grazing view at eye height
    let src = photo;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (photo.naturalWidth > max || photo.naturalHeight > max) {
      const k = max / Math.max(photo.naturalWidth, photo.naturalHeight), c = document.createElement('canvas');
      c.width = Math.floor(photo.naturalWidth * k); c.height = Math.floor(photo.naturalHeight * k);
      c.getContext('2d').drawImage(photo, 0, 0, c.width, c.height);
      src = c;
    }
    G.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, G.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);   // image row 0 (north) -> v = 0, as the shader expects
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    // the archival finish, tiled (repeat) in world metres on the walls and roofs that carry it
    G.finishTex = finishImgs.map(() => null);
    finishImgs.forEach((img, i) => {
      if (!img) return;
      const t = G.finishTex[i] = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    });
    G.pick = null;   // offscreen pick target, made at the canvas size on first use
    // the ponds' water mask (scene.water) and the streamed 0.1 m photo (scene.ortho_tiles), since 2026-10-18
    if (waterImg) {
      G.waterTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.waterTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, waterImg);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    if (detailImgs) {
      G.detTex = {};
      for (const [k, img] of Object.entries(detailImgs)) {
        if (!img) continue;
        const t = G.detTex[k] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      }
    }
    if (scene.ortho_tiles) {
      const OT = scene.ortho_tiles, c = document.createElement('canvas');
      c.width = c.height = 3 * OT.px;
      G.detail = { tex: gl.createTexture(), canvas: c, ctx: c.getContext('2d'), key: null, ready: false, rect: null, imgs: new Map(), token: 0 };
      gl.bindTexture(gl.TEXTURE_2D, G.detail.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const aniso2 = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso2) gl.texParameterf(gl.TEXTURE_2D, aniso2.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, gl.getParameter(aniso2.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }
  }
  function updateDetail() {   // the 3 x 3 tiles of the 0.1 m photo round the walker; reloaded when the walker enters another tile
    const D = G.detail, OT = scene.ortho_tiles;
    if (!D || viewer.mode !== 'walk') return;
    const ox = OT.x0 - T.x0, oz = T.y1 - OT.y1;     // the tiles' NW corner in world metres (0, 0 when they start at the terrain's)
    const ci = Math.floor((walker.x - ox) / OT.size_m), cj = Math.floor((walker.z - oz) / OT.size_m), key = ci + ',' + cj;
    if (key === D.key) return;
    D.key = key; const token = ++D.token;
    const want = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) want.push([ci + di, cj + dj, di + 1, dj + 1]);
    Promise.all(want.map(([i, j]) => {
      if (i < 0 || j < 0 || i >= OT.nx || j >= OT.ny) return Promise.resolve(null);
      const k = i + '_' + j;
      if (!D.imgs.has(k)) D.imgs.set(k, loadImage(`${OT.dir}${k}.jpg?b=${stamp}`).catch(() => null));
      return D.imgs.get(k);
    })).then((imgs) => {
      if (token !== D.token) return;              // the walker has moved on
      const ctx = D.ctx, n = OT.px;
      ctx.fillStyle = 'rgb(128,128,128)'; ctx.fillRect(0, 0, 3 * n, 3 * n);
      imgs.forEach((im, k) => { if (im) ctx.drawImage(im, want[k][2] * n, want[k][3] * n, n, n); });
      const gl = G.gl;
      gl.bindTexture(gl.TEXTURE_2D, D.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, D.canvas);
      gl.generateMipmap(gl.TEXTURE_2D);
      D.rect = { x0: ox + (ci - 1) * OT.size_m, z0: oz + (cj - 1) * OT.size_m, w: 3 * OT.size_m };
      D.ready = true;
      if (D.imgs.size > 60) for (const k2 of [...D.imgs.keys()].slice(0, D.imgs.size - 40)) D.imgs.delete(k2);   // keep the cache bounded
    });
  }
  function uploadPN({ v, idx }) {   // position + normal (terrain, skirt)
    const gl = G.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length };
  }
  function uploadMesh(m) {
    if (!m || !m.ni) return null;
    const gl = G.gl, vao = gl.createVertexArray(), S = STRIDE * 4;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, m.v.subarray(0, m.nv * STRIDE), gl.STATIC_DRAW);
    [[0, 3, 0], [1, 3, 12], [2, 4, 24], [3, 1, 40], [4, 4, 44], [5, 2, 60]].forEach(([loc, n, off]) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, S, off);
    });
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.i.subarray(0, m.ni), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: m.ni };
  }
  function drawElems(obj) {
    const gl = G.gl;
    gl.bindVertexArray(obj.vao);
    gl.drawElements(gl.TRIANGLES, obj.count, gl.UNSIGNED_INT, 0);
  }

  // ---------------------------------------------------------------- camera
  const M4 = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, fwd, up) {   // view matrix from the eye, a unit forward and a unit up
      const z = [-fwd[0], -fwd[1], -fwd[2]], x = norm3(cross3(up, z)), y = cross3(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]), -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]), -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
    },
    mul(a, b) {   // column-major a * b
      const o = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        o[i * 4 + j] = s;
      }
      return o;
    },
  };
  function eyeNow() { return eyeVP !== null ? eyeVP : eyeH; }
  // vertical field of view (deg) at this aspect: hfovSet keeps the horizontal one, whatever the window's shape
  function fovYDeg(aspect) { return hfovSet !== null ? 2 * Math.atan(Math.tan(rad(hfovSet) / 2) / aspect) * 180 / Math.PI : FOV_Y; }
  function camera() {
    const gl = G.gl, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const yaw = rad(walker.heading), pitch = rad(walker.pitch);
    const fwd = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const right = norm3(cross3(fwd, [0, 1, 0])), up = cross3(right, fwd);
    const eye = [walker.x, T.bilinear(walker.x, walker.z) + eyeNow(), walker.z];
    const aspect = w / Math.max(1, h), fy = rad(fovYDeg(aspect)), tanY = Math.tan(fy / 2);
    const viewProj = M4.mul(M4.perspective(fy, aspect, NEAR, FAR), M4.lookAt(eye, fwd, up));
    return { eye, fwd, right, up, viewProj, tan: [tanY * aspect, tanY], w, h };
  }

  // ---------------------------------------------------------------- frame
  function render3D(timeS) {
    const gl = G.gl, cam = camera();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cam.w, cam.h);
    gl.disable(gl.SCISSOR_TEST); gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.clearColor(SKY_HORIZON[0], SKY_HORIZON[1], SKY_HORIZON[2], 1);
    gl.clearDepth(1); gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    let P = G.progSky;
    gl.useProgram(P.p);
    gl.uniform3fv(P.u.uForward, cam.fwd); gl.uniform3fv(P.u.uRight, cam.right); gl.uniform3fv(P.u.uUp, cam.up);
    gl.uniform2fv(P.u.uTan, cam.tan); gl.uniform3fv(P.u.uHorizon, SKY_HORIZON); gl.uniform3fv(P.u.uZenith, SKY_ZENITH);
    gl.bindVertexArray(G.skyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // terrain, then the filler beyond it
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    P = G.progTerrain;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tex); gl.uniform1i(P.u.uPhoto, 0);
    gl.uniform4f(P.u.uPhotoRect, PR.x0, PR.z0, 1 / PR.w, 1 / PR.h);
    gl.uniform3fv(P.u.uLight, LIGHT); gl.uniform3fv(P.u.uEye, cam.eye); gl.uniform3fv(P.u.uFog, SKY_HORIZON); gl.uniform1f(P.u.uFogDensity, FOG_DENSITY);
    updateDetail();
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, G.detail && G.detail.ready ? G.detail.tex : G.tex); gl.uniform1i(P.u.uDetail, 3);
    const DR = G.detail && G.detail.ready ? G.detail.rect : null;
    gl.uniform4f(P.u.uDetailRect, DR ? DR.x0 : 0, DR ? DR.z0 : 0, DR ? 1 / DR.w : 1, DR ? 1 / DR.w : 1); gl.uniform1f(P.u.uDetailOn, DR ? 1 : 0);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, G.waterTex || G.tex); gl.uniform1i(P.u.uWater, 4);
    gl.uniform4f(P.u.uWaterRect, WR ? WR.x0 : 0, WR ? WR.z0 : 0, WR ? 1 / WR.w : 1, WR ? 1 / WR.h : 1); gl.uniform1f(P.u.uWaterOn, G.waterTex && WR ? 1 : 0);
    gl.uniform3fv(P.u.uSkyH, SKY_HORIZON); gl.uniform3fv(P.u.uSkyZ, SKY_ZENITH); gl.uniform1f(P.u.uTime, timeS);
    const GD = G.detTex;
    [['uDetGrass', 'grass', 5], ['uDetSoil', 'soil', 6], ['uDetHard', 'hard', 7], ['uWaterN', 'water_normal', 8]].forEach(([u, k, unit]) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, (GD && GD[k]) || G.tex); gl.uniform1i(P.u[u], unit);
    });
    const GDM = scene.ground_detail && scene.ground_detail.maps;
    gl.uniform3f(P.u.uDetTile, GDM && GDM.grass ? GDM.grass.tile_m : 2, GDM && GDM.soil ? GDM.soil.tile_m : 2, GDM && GDM.hard ? GDM.hard.tile_m : 1.5);
    gl.uniform2f(P.u.uDetFade, 8, 30); gl.uniform1f(P.u.uDetOn, GD && GD.grass ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(P.u.uOutside, 0); drawElems(G.terrain);
    gl.uniform1f(P.u.uOutside, 1); drawElems(G.skirt);
    // solids (buildings, walls, posts, trees, markers)
    P = G.progMesh;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);
    gl.uniform3fv(P.u.uLight, LIGHT); gl.uniform3fv(P.u.uEye, cam.eye); gl.uniform3fv(P.u.uFog, SKY_HORIZON); gl.uniform1f(P.u.uFogDensity, FOG_DENSITY);
    gl.uniform1f(P.u.uSelected, selected && selected.type === 'feature' ? selected.rec.fid : -1);
    gl.uniform1f(P.u.uTime, timeS);
    const WF = wallFinishes(), ft = (WF[0] && WF[0].tile_m) || [2, 1], ft2 = (WF[1] && WF[1].tile_m) || [2, 1];
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, (G.finishTex && G.finishTex[0]) || G.tex); gl.uniform1i(P.u.uFinish, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, (G.finishTex && G.finishTex[1]) || G.tex); gl.uniform1i(P.u.uFinish2, 2);
    gl.uniform2f(P.u.uFinishTile, num(ft[0]) || 2, num(ft[1]) || 1); gl.uniform2f(P.u.uFinishTile2, num(ft2[0]) || 2, num(ft2[1]) || 1);
    const tint2 = WF[1] && WF[1].appearance_tier === 'analogue' && TIERS.analogue ? hexRgb(TIERS.analogue.hex) : [0, 0, 0];
    gl.uniform4f(P.u.uFinishTint2, tint2[0], tint2[1], tint2[2], WF[1] && WF[1].appearance_tier === 'analogue' ? ANALOGUE_TINT : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, G.tex); gl.uniform1i(P.u.uPhoto, 0); gl.uniform4f(P.u.uPhotoRect, PR.x0, PR.z0, 1 / PR.w, 1 / PR.h);
    for (const L of G.layers) if (L.solid) drawElems(L.solid);
    // translucent: draped layers (lowest lift first), each through the stencil so overlapping
    // pieces of one layer are blended once; then fence bands
    gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    let k = 0;
    for (const d of [...G.layers.map((L) => L.drape), G.pilot]) {
      if (!d) continue;
      k++;
      gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.polygonOffset(-1, -2 * k);
      drawElems(d);
    }
    gl.disable(gl.STENCIL_TEST); gl.disable(gl.POLYGON_OFFSET_FILL);
    for (const L of G.layers) if (L.glass) drawElems(L.glass);
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  // ---------------------------------------------------------------- GPU picking
  // Feature ids (1..N), TERRAIN_PICK for the ground, 0 for sky / filler, drawn into an offscreen
  // RGBA8 target (no antialiasing, no blending) and read back one pixel. Returns the raw id.
  function gpuPick(px, py) {
    const gl = G.gl, cam = camera();
    if (!G.pick || G.pick.w !== cam.w || G.pick.h !== cam.h) {
      if (G.pick) { gl.deleteFramebuffer(G.pick.fb); gl.deleteRenderbuffer(G.pick.c); gl.deleteRenderbuffer(G.pick.d); }
      const fb = gl.createFramebuffer(), c = gl.createRenderbuffer(), d = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, cam.w, cam.h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, cam.w, cam.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('pick framebuffer incomplete: 0x' + status.toString(16));
      G.pick = { fb, c, d, w: cam.w, h: cam.h };
    }
    px = clamp(Math.floor(px), 0, cam.w - 1); py = clamp(Math.floor(py), 0, cam.h - 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, G.pick.fb);
    gl.viewport(0, 0, cam.w, cam.h);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(px, py, 1, 1);
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = G.progPick;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uViewProj, false, cam.viewProj);
    gl.vertexAttrib1f(3, TERRAIN_PICK); drawElems(G.terrain);   // attribute 3 is not an array in these VAOs:
    gl.vertexAttrib1f(3, 0); drawElems(G.skirt);                // the constant value is the id
    gl.enable(gl.POLYGON_OFFSET_FILL);
    let k = 0;
    for (const L of G.layers) { if (!L.drape) continue; k++; gl.polygonOffset(-1, -2 * k); drawElems(L.drape); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    for (const L of G.layers) { if (L.solid) drawElems(L.solid); if (L.glass) drawElems(L.glass); }
    const px4 = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px4);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    return px4[0] + px4[1] * 256 + px4[2] * 65536;
  }
  function clientToBuffer(clientX, clientY) {
    const r = ui.gl.getBoundingClientRect(), gl = G.gl;
    return [((clientX - r.left) / r.width) * gl.drawingBufferWidth, ((r.bottom - clientY) / r.height) * gl.drawingBufferHeight];
  }
  // where the ray through a viewport point meets the ground (CPU march over the height field)
  function rayGround(clientX, clientY) {
    const r = ui.gl.getBoundingClientRect(), cam = camera();
    const sx = ((clientX - r.left) / r.width) * 2 - 1, sy = 1 - ((clientY - r.top) / r.height) * 2;
    const d = norm3([0, 1, 2].map((i) => cam.fwd[i] + cam.right[i] * sx * cam.tan[0] + cam.up[i] * sy * cam.tan[1]));
    const above = (t) => { const x = cam.eye[0] + d[0] * t, z = cam.eye[2] + d[2] * t; return cam.eye[1] + d[1] * t - T.surface(x, z); };
    let t0 = 0;
    for (let t = 0.05; t < FAR; t += Math.max(0.05, t * 0.01)) {
      if (above(t) <= 0) {
        let a = t0, b = t;
        for (let it = 0; it < 30; it++) { const m = (a + b) / 2; if (above(m) > 0) a = m; else b = m; }
        const x = cam.eye[0] + d[0] * b, z = cam.eye[2] + d[2] * b;
        return T.inside(x, z) ? { x, z, y: T.bilinear(x, z) } : null;
      }
      t0 = t;
    }
    return null;
  }
  // pick at a viewport point in the walk view: feature id, 'terrain' or null (+ the selection)
  function identifyAt(clientX, clientY, doSelect = true) {
    if (!G.gl || G.lost) return null;
    const [bx, by] = clientToBuffer(clientX, clientY);
    const raw = gpuPick(bx, by);
    let result = null;
    if (raw === TERRAIN_PICK) {
      // A draped feature is lifted a few centimetres off the ground, so a ray at a grazing angle
      // can pass under its edge and reach the ground. A ground hit inside a draped footprint is
      // therefore given to that feature, as seen from above.
      const g = rayGround(clientX, clientY), d = g && drapedAt(g.x, g.z);
      if (d) { result = d.id; if (doSelect) selectRec(d); }
      else { result = 'terrain'; if (doSelect) selectTerrain(g); }
    } else if (raw > 0 && raw <= recs.length) {
      result = recs[raw - 1].id;
      if (doSelect) selectRec(recs[raw - 1]);
    } else if (doSelect) clearSelection();
    return result;
  }
  // the topmost draped feature (highest lift first) whose footprint holds the ground point
  function drapedAt(x, z) {
    for (const rec of drapedRecs) {
      const b = rec.bbox, pad = (rec.width || 0) / 2;
      if (x < b[0] - pad || x > b[2] + pad || z < b[1] - pad || z > b[3] + pad) continue;
      const k = rec.style.kind;
      if (k !== 'building' && k !== 'wall' && k !== 'fence' && rec.polys.length && pointInPolys(x, z, rec.polys)) return rec;
      if (k !== 'wall' && k !== 'fence') for (const l of rec.lines) if (distToLine(x, z, l) <= pad) return rec;
    }
    return null;
  }
  function identifyAtCentre() {
    const r = ui.gl.getBoundingClientRect();
    return identifyAt(r.left + r.width / 2, r.top + r.height / 2);
  }

  // ================================================================== walking
  function updateWalker(dt) {
    let f = 0, s = 0, turn = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (keys.has('KeyE')) turn += 1;
    if (keys.has('KeyQ')) turn -= 1;
    if (turn) walker.heading = wrap360(walker.heading + turn * TURN_RATE * dt);
    if (f || s) {
      const run = shiftHeld || keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = walkSpeed * (run ? RUN : 1) * dt, l = Math.hypot(f, s), h = rad(walker.heading);
      f /= l; s /= l;
      moveWalker((f * Math.sin(h) + s * Math.cos(h)) * speed, (-f * Math.cos(h) + s * Math.sin(h)) * speed);
    }
  }
  function look(dYaw, dPitch) {
    walker.heading = wrap360(walker.heading + dYaw);
    walker.pitch = clamp(walker.pitch - dPitch, -80, 80);
  }
  // eye: eye height above the ground for a fixed viewpoint (the walk's own height when omitted)
  function enterWalk(x, z, heading, pitch, eye) {
    if (!G.gl) { hint('The 3D walk needs WebGL2, which this browser does not provide.', 4000); return; }
    walker.x = x; walker.z = z; walker.heading = wrap360(heading || 0); walker.pitch = clamp(pitch || 0, -80, 80); walker.placed = true;
    if (eye === undefined || eye === null) leaveViewpoint(); else eyeVP = eye;
    setMode('walk');
  }
  // the analogue view (output/viewer_1982/analogue/, tools/analogue_view.py) and back: the position and heading
  // travel in the URL hash as #E=..&N=..&h=.. (EPSG:2326 metres, degrees from grid north); since 2026-10-24 also
  // z= (eye height above the ground, m), p= (pitch, deg up) and fov= (horizontal field of view, deg) -- a fixed viewpoint's
  // camera (viewpoints.json); the links between the views carry them while one is in use
  function hashExtras() {
    return (eyeVP !== null ? '&z=' + eyeVP + '&p=' + +walker.pitch.toFixed(2) : '') + (hfovSet !== null ? '&fov=' + hfovSet : '');
  }
  function openAnalogue() {
    const st = viewer.state(), at = (st.E != null && walker.placed) ? '#E=' + st.E.toFixed(1) + '&N=' + st.N.toFixed(1) + '&h=' + Math.round(st.heading_deg) + hashExtras() : '';
    location.href = 'analogue/index.html' + (AUTHOR ? '?author' : '') + at;
  }
  function startFromHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (!q.has('E') || !q.has('N')) return;
    const E = +q.get('E'), N = +q.get('N'), h = +(q.get('h') || 0);
    if (viewer.groundAt(E, N) == null) return;
    const z = q.has('z') ? num(q.get('z')) : null, fov = q.has('fov') ? num(q.get('fov')) : null;
    if (fov !== null) setHfov(fov);
    viewer.jumpTo(E, N, h, num(q.get('p')) || 0, z !== null && z > 0 && z <= 50 ? z : undefined);
  }
  // ---------------------------------------------------------------- fixed viewpoints (viewpoints.json, since 2026-10-24)
  // A camera matched to a reference photo: its position, heading, pitch, eye height and horizontal field of view.
  // Choosing one stops the walk where it is (keys released, mouse-look off); walking on keeps the field of view.
  function setHfov(v) {
    hfovSet = v === null || v === undefined ? null : clamp(v, 10, 120);
    syncFov(true);
  }
  function syncFov(force) {
    if (!ui.fov || (!force && document.activeElement === ui.fov)) return;
    ui.fov.value = G.gl ? +hfovDeg().toFixed(1) : '';
  }
  function leaveViewpoint() {
    eyeVP = null;
    if (ui.vpSel && ui.vpSel.value) ui.vpSel.value = '';
  }
  function goToViewpoint(id) {
    const v = viewpoints.find((q) => q.id === id);
    if (!v || !loaded) return false;
    if (viewer.groundAt(v.E, v.N) == null) { hint(`${v.id} lies outside the terrain of this build.`, 4000); if (ui.vpSel) ui.vpSel.value = ''; return false; }
    if (document.pointerLockElement) document.exitPointerLock();
    setHfov(num(v.hfov_deg));
    const eye = num(v.eye_m);
    viewer.jumpTo(v.E, v.N, num(v.heading_deg) || 0, num(v.pitch_deg) || 0, eye !== null && eye > 0 ? eye : undefined);
    if (ui.vpSel) ui.vpSel.value = v.id;
    hint(`${v.label}: eye ${eyeNow()} m above the ground, pitch ${num(v.pitch_deg) || 0}°, field of view ${+hfovDeg().toFixed(1)}° across. ` +
      `Walking is paused; walking on returns the eye to ${eyeH} m.`, 8000);
    return true;
  }
  function walkHere() {   // the Walk button: back to the walker, or into the pilot zone the first time
    if (!loaded) return;
    if (walker.placed) { enterWalk(walker.x, walker.z, walker.heading, walker.pitch, eyeVP); return; }
    const p = nearestFree(walker.x, walker.z);
    enterWalk(p[0], p[1], 0, 0);
  }

  // ================================================================== modes
  function setMode(m) {
    viewer.mode = m;
    document.body.dataset.mode = m;
    ui.btnMap.setAttribute('aria-pressed', String(m === 'map'));
    ui.btnWalk.setAttribute('aria-pressed', String(m === 'walk'));
    hideTooltip();
    keys.clear();
    if (m === 'map') {
      if (document.pointerLockElement) document.exitPointerLock();
      ui.hint.hidden = true;
      if (walker.placed) {   // keep the walker in view
        const [sx, sy] = worldToScreen(walker.x, walker.z);
        if (sx < 40 || sy < 40 || sx > MV.w - 40 || sy > MV.h - 40) { MV.cx = walker.x; MV.cz = walker.z; }
      }
      MV.dirty = true;
    } else {
      hint('W A S D or arrow keys to walk, Shift to run · drag to look · click to identify · M for the map · H for help', 7000);
    }
  }

  // ================================================================== 2D map
  function worldToScreen(X, Z) { return [(X - MV.cx) * MV.s + MV.w / 2, (Z - MV.cz) * MV.s + MV.h / 2]; }
  function screenToWorld(x, y) { return [(x - MV.w / 2) / MV.s + MV.cx, (y - MV.h / 2) / MV.s + MV.cz]; }
  function clientToMap(clientX, clientY) { const r = ui.map.getBoundingClientRect(); return screenToWorld(clientX - r.left, clientY - r.top); }
  function minScale() { const w = PRC ? PRC.w : T.W, h = PRC ? PRC.h : T.H; return Math.min(MV.w / w, MV.h / h) * 0.6; }
  function fitMap() {
    const bb = polysBBox(pilot) || [0, 0, T.W, T.H], pad = 36;
    MV.s = clamp(Math.min((MV.w - 2 * pad) / (bb[2] - bb[0]), (MV.h - 2 * pad) / (bb[3] - bb[1])), minScale(), MAP_MAX_SCALE);
    MV.cx = (bb[0] + bb[2]) / 2; MV.cz = (bb[1] + bb[3]) / 2;
    MV.dirty = true;
  }
  function zoomMap(factor, sx, sy) {
    if (!loaded) return;
    const [X, Z] = screenToWorld(sx, sy);
    MV.s = clamp(MV.s * factor, minScale(), MAP_MAX_SCALE);
    MV.cx = X - (sx - MV.w / 2) / MV.s; MV.cz = Z - (sy - MV.h / 2) / MV.s;
    MV.dirty = true;
  }
  function buildPaths() {
    const ringPath = (path, r, close) => {
      path.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
      if (close) path.closePath();
    };
    for (const rec of recs.concat(pendingRecs)) {
      const fill = new Path2D(), stroke = new Path2D();
      for (const poly of rec.polys) for (const r of poly) ringPath(fill, r, true);
      for (const l of rec.lines) ringPath(stroke, l, false);
      rec.path = { fill, stroke, hasFill: rec.polys.length > 0, hasLine: rec.lines.length > 0 };
    }
    MV.pilotPath = new Path2D();
    for (const poly of pilot) for (const r of poly) ringPath(MV.pilotPath, r, true);
  }
  function mapPatterns(dpr) {
    if (MV.patterns && MV.patDpr === dpr) return MV.patterns;
    const n = Math.round(7 * dpr), lw = Math.max(1, 1.2 * dpr);
    const tile = (draw) => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      g.strokeStyle = g.fillStyle = 'rgba(15,15,15,0.55)';
      g.lineWidth = lw;
      draw(g);
      return MV.ctx.createPattern(c, 'repeat');
    };
    MV.patterns = {
      [PAT.stripes]: tile((g) => { g.beginPath(); for (const o of [-n, 0, n]) { g.moveTo(o, n); g.lineTo(o + n, 0); } g.stroke(); }),
      [PAT.bands]: tile((g) => g.fillRect(0, 0, n, lw)),
    };
    MV.patDpr = dpr;
    return MV.patterns;
  }
  function drawMap() {
    MV.dirty = false;
    const ctx = MV.ctx, dpr = MV.dpr, k = dpr * MV.s, px = 1 / MV.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#2a2d30';
    ctx.fillRect(0, 0, ui.map.width, ui.map.height);
    ctx.setTransform(k, 0, 0, k, dpr * (MV.w / 2 - MV.cx * MV.s), dpr * (MV.h / 2 - MV.cz * MV.s));
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (photoCtx) {   // the wider photo is context only: dimmed, outside the model's extent
      ctx.globalAlpha = 0.55; ctx.drawImage(photoCtx, PRC.x0, PRC.z0, PRC.w, PRC.h); ctx.globalAlpha = 1;
    }
    ctx.drawImage(photo, PR.x0, PR.z0, PR.w, PR.h);
    const [vx0, vz0] = screenToWorld(0, 0), [vx1, vz1] = screenToWorld(MV.w, MV.h);
    const pats = mapPatterns(dpr), patM = new DOMMatrix([1 / k, 0, 0, 1 / k, 0, 0]);
    for (const p of Object.values(pats)) p.setTransform(patM);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const rec of mapRecs) {
      const b = rec.bbox, grow = (rec.crown || rec.width || 1) + 10 * px;
      if (b[2] + grow < vx0 || b[0] - grow > vx1 || b[3] + grow < vz0 || b[1] - grow > vz1) continue;
      drawFeature2D(ctx, rec, px, pats);
    }
    if (showPending) for (const rec of pendingRecs) drawPending2D(ctx, rec, px);
    // pilot boundary: white under a dark dash
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3.6 * px; ctx.stroke(MV.pilotPath);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.4 * px; ctx.setLineDash([9 * px, 5 * px]); ctx.stroke(MV.pilotPath);
    ctx.setLineDash([]);
    if (selected && selected.type === 'feature') {
      const rec = selected.rec;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * px;
      outline2D(ctx, rec, px);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * px;
      outline2D(ctx, rec, px);
    }
    // screen-space overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (selected && selected.type === 'terrain' && selected.x !== undefined) {
      const [sx, sy] = worldToScreen(selected.x, selected.z);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7); ctx.stroke();
    }
    for (const h of hotspots) drawHotspot(ctx, h);
    if (walker.placed) drawWalker(ctx);
    drawScaleBar(ctx);
    drawNorth(ctx);
  }
  function drawFeature2D(ctx, rec, px, pats) {
    const c = rec.tier.hex, dash = rec.unchecked ? [4 * px, 3 * px] : [];
    const st = rec.style;
    if (rec.path.hasFill) {
      if (st.kind === 'wall' || st.kind === 'fence') {
        ctx.strokeStyle = c; ctx.lineWidth = Math.max(st.kind === 'wall' ? 0.25 : 0.1, 2 * px); ctx.setLineDash(dash); ctx.stroke(rec.path.fill);
      } else {
        ctx.fillStyle = rgba(c, st.kind === 'building' ? FILL_ALPHA : st.alpha || 0.3);
        ctx.fill(rec.path.fill, 'evenodd');
        if (st.kind === 'building' && pats[rec.heightPattern]) { ctx.fillStyle = pats[rec.heightPattern]; ctx.fill(rec.path.fill, 'evenodd'); }
        ctx.strokeStyle = c; ctx.lineWidth = 1.4 * px; ctx.setLineDash(dash); ctx.stroke(rec.path.fill);
      }
    }
    if (rec.path.hasLine) {
      const w = st.kind === 'wall' ? Math.max(st.thickness, 2.2 * px) : st.kind === 'fence' ? 1.6 * px : Math.max(rec.width || 1, 2 * px);
      ctx.strokeStyle = rgba(c, st.kind === 'drape' || st.kind === 'generic' ? 0.75 : 1);
      ctx.lineWidth = w;
      if (rec.unchecked) {   // dashed = unchecked; butt caps keep wide dashes from merging into beads
        ctx.lineCap = 'butt';
        ctx.setLineDash([Math.max(8 * px, w * 1.6), Math.max(5 * px, w * 0.9)]);
      } else ctx.setLineDash([]);
      ctx.stroke(rec.path.stroke);
      if (rec.layer === 'streams') {   // a dark core, so a watercourse never reads as a lane
        ctx.strokeStyle = STREAM_CORE; ctx.lineWidth = Math.max(w * 0.35, 1 * px);
        ctx.stroke(rec.path.stroke);
      }
      ctx.lineCap = 'round';
    }
    for (const p of rec.points) {
      ctx.setLineDash(dash);
      if (st.kind === 'tree') {
        ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(rec.crown, 3 * px), 0, 2 * Math.PI);
        ctx.fillStyle = rgba(c, 0.35); ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = 1.4 * px; ctx.stroke();
      } else {
        const r = 4.5 * px;
        ctx.beginPath(); ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]); ctx.closePath();
        ctx.fillStyle = c; ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 * px; ctx.stroke();
        const v = num(rec.props.value_m);
        if (v !== null && MV.s > 1.5) {
          ctx.setLineDash([]);
          ctx.font = `${11 * px}px system-ui, sans-serif`;
          ctx.lineWidth = 3 * px; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.fillStyle = '#fff';
          ctx.strokeText(v.toFixed(1), p[0] + 6 * px, p[1] - 5 * px); ctx.fillText(v.toFixed(1), p[0] + 6 * px, p[1] - 5 * px);
        }
      }
    }
    ctx.setLineDash([]);
  }
  // pending confirmation: a thin white outline over a dark one, dotted, no fill -- not a tier colour,
  // because the feature is not part of the model
  function drawPending2D(ctx, rec, px) {
    const pass = (col, w, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash);
      if (rec.path.hasFill) ctx.stroke(rec.path.fill);
      if (rec.path.hasLine) ctx.stroke(rec.path.stroke);
      for (const p of rec.points) { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5 * px, 0, 2 * Math.PI); ctx.stroke(); }
    };
    ctx.lineCap = 'butt';
    pass('rgba(0,0,0,0.85)', 3 * px, []);
    pass(PENDING_HEX, 1.5 * px, rec.props.status === ABSENT ? [7 * px, 4 * px] : [2 * px, 2.5 * px]);   // dashes: gone by Dec 1982; dots: pending
    ctx.setLineDash([]); ctx.lineCap = 'round';
  }
  function outline2D(ctx, rec, px) {
    if (rec.path.hasFill) ctx.stroke(rec.path.fill);
    if (rec.path.hasLine) ctx.stroke(rec.path.stroke);
    for (const p of rec.points) { ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(rec.crown || 0, 7 * px), 0, 2 * Math.PI); ctx.stroke(); }
  }
  function drawWalker(ctx) {   // where the walker stands, the way they face, and the 60-degree view
    const [sx, sy] = worldToScreen(walker.x, walker.z), h = rad(walker.heading), half = rad(FOV_Y / 2), L = 44;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, L, h - Math.PI / 2 - half, h - Math.PI / 2 + half);   // canvas angles: 0 = east, clockwise
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.sin(h) * 22, sy - Math.cos(h) * 22);
    ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 6.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.stroke();
  }
  function drawHotspot(ctx, h) {   // screen space: accuracy circle, view direction, a lettered mark
    const [sx, sy] = worldToScreen(h.x, h.z), sel = selected && selected.type === 'hotspot' && selected.h === h;
    if (sx < -200 || sy < -200 || sx > MV.w + 200 || sy > MV.h + 200) return;
    const acc = num(h.accuracy_m);
    if (acc) {
      ctx.beginPath(); ctx.arc(sx, sy, acc * MV.s, 0, 2 * Math.PI);
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    }
    const hd = num(h.heading);
    if (hd !== null) {
      const a = rad(hd), half = rad(25), L = 34;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.arc(sx, sy, L, a - Math.PI / 2 - half, a - Math.PI / 2 + half); ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(sx, sy, sel ? 11 : 9, 0, 2 * Math.PI);
    ctx.fillStyle = '#111'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = sel ? '#ffd400' : '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((HOTSPOT_TYPES[h.type] || { mark: '?' }).mark, sx, sy + 0.5);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  function hotspotAt(X, Z) {
    for (const h of hotspots) { const [sx, sy] = worldToScreen(h.x, h.z), [qx, qy] = worldToScreen(X, Z); if (Math.hypot(sx - qx, sy - qy) <= 11) return h; }
    return null;
  }
  function drawScaleBar(ctx) {
    const target = 110 / MV.s;
    let L = 1;
    for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s <= target) L = s;
    const w = L * MV.s, x = 14, y = MV.h - 20;
    ctx.fillStyle = 'rgba(20,22,24,0.72)'; ctx.fillRect(x - 6, y - 16, w + 54, 28);
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = '#000'; ctx.fillRect(x, y, w / 2, 4);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 3);
    ctx.fillStyle = '#fff'; ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${L} m`, x + w + 6, y + 5);
  }
  function drawNorth(ctx) {
    const x = MV.w - 26, y = 22;
    ctx.fillStyle = 'rgba(20,22,24,0.72)'; ctx.beginPath(); ctx.arc(x, y + 6, 17, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 8); ctx.lineTo(x, y + 4); ctx.lineTo(x - 6, y + 8); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('N', x, y + 19); ctx.textAlign = 'start';
  }
  // topmost feature under a map point: last drawn first (points and lines above fills)
  function hitTest2D(X, Z) {
    const tol = 6 / MV.s;
    const order = showPending ? mapRecs.concat(pendingRecs) : mapRecs;
    for (let n = order.length - 1; n >= 0; n--) {
      const rec = order[n], b = rec.bbox, grow = (rec.crown || rec.width || 0) + tol;
      if (X < b[0] - grow || X > b[2] + grow || Z < b[1] - grow || Z > b[3] + grow) continue;
      for (const p of rec.points) if (Math.hypot(X - p[0], Z - p[1]) <= Math.max(rec.crown || 0, tol)) return rec;
      for (const l of rec.lines) if (distToLine(X, Z, l) <= Math.max((rec.width || rec.style.thickness || 0) / 2, tol)) return rec;
      if (rec.polys.length) {
        if (rec.style.kind === 'wall' || rec.style.kind === 'fence' || rec.pending) { if (nearestOnPolys(X, Z, rec.polys).d <= tol || (rec.pending && pointInPolys(X, Z, rec.polys))) return rec; }
        else if (pointInPolys(X, Z, rec.polys)) return rec;
      }
    }
    return null;
  }
  // What a single click on the map does (also viewer.mapClickAt). On a footprint: select the
  // building and stand STAND_OFF outside it, facing it. Elsewhere: select what was hit, if
  // anything, and stand at the point facing north. identifyOnly (Shift-click): no walk.
  function mapClick(X, Z, identifyOnly) {
    const hs = hotspotAt(X, Z);
    if (hs) { selected = { type: 'hotspot', h: hs }; renderInfo(); MV.dirty = true; return; }   // a photo, never a walk
    const b = buildingAt(X, Z);
    const hit = b || hitTest2D(X, Z);
    if (hit && hit.pending) { selectRec(hit); if (identifyOnly) return; }
    if (identifyOnly) {
      if (hit) selectRec(hit); else selectTerrain(T.inside(X, Z) ? { x: X, z: Z, y: T.bilinear(X, Z) } : null);
      return;
    }
    if (b) {
      selectRec(b);
      const s = standOff(b, X, Z);
      enterWalk(s.x, s.z, s.heading, 0);
      return;
    }
    if (hit) selectRec(hit); else clearSelection();
    const p = nearestFree(X, Z);
    enterWalk(p[0], p[1], 0, 0);
  }

  // ================================================================== selection and the info panel
  function selectRec(rec) { selected = { type: 'feature', rec }; renderInfo(); MV.dirty = true; }
  function selectTerrain(point) { selected = Object.assign({ type: 'terrain' }, point || {}); renderInfo(); MV.dirty = true; }
  function clearSelection() { selected = null; renderInfo(); MV.dirty = true; }
  function selectedId() { return !selected ? null : selected.type === 'terrain' ? 'terrain' : selected.type === 'hotspot' ? selected.h.id : selected.rec.id; }

  const PRIMARY = ['id', 'layer', 'kind', 'status', 'tier', 'tier_reason', 'epoch', 'source', 'source_ids', 'source_date', 'check_status'];
  const HEIGHT_KEYS = ['height_m', 'height_tier', 'height_source', 'height_source_date', 'height_reason'];
  const RUIN_KEYS = ['ruin_form', 'ruin_source', 'ruin_photo'];
  // the archival finish (matching_register.json `finishes`): what the walls show, and where it comes from
  const FINISH_KEYS = ['finish', 'finish_tier', 'finish_source', 'finish_source_ids', 'finish_source_date', 'finish_match', 'finish_note', 'archival_matches'];
  const ANALOGUE_TINT = 0.30;   // an analogue wall texture is drawn this far toward the analogue tier colour (CLAUDE.md 6: never mistaken for evidence)
  function wallFinishes() { return ((scene && Array.isArray(scene.finishes) && scene.finishes) || []).filter((f) => f.kind === 'wall-texture').slice(0, 2); }
  function finishOf() { return wallFinishes()[0] || {}; }
  function roofPhotoOf() { return (scene && Array.isArray(scene.finishes) && scene.finishes.find((f) => f.kind === 'roof-photo')) || {}; }
  // the roof's form, read off the Dec 1982 photo (roof_forms.json), and its drawing defaults
  const ROOF_FORM_KEYS = ['roof_form', 'roof_ridge', 'roof_falls_to', 'roof_form_tier', 'roof_form_check_status', 'roof_form_confidence',
    'roof_form_source', 'roof_form_source_ids', 'roof_form_source_date', 'roof_form_readers', 'roof_pitch_deg', 'roof_pitch_tier',
    'roof_pitch_source', 'roof_eaves_m', 'roof_ridge_m', 'roof_note'];
  const ROOF_GEOMETRY_KEYS = ['roof_faces', 'roof_rect', 'roof_ridge_dir', 'roof_fall_dir', 'roof_span_m'];   // drawn, not listed
  const ROOF_KEYS = ['roof_finish', 'roof_finish_source', 'roof_finish_source_ids', 'roof_finish_source_date', 'roof_photo_shift_m', 'roof_photo_shift_basis'];
  // the record's plain summary above the folded full record (2026-10-27): how sure, from what, and why. Falsy lines are skipped.
  function setPlain(lines) {
    ui.infoPlain.textContent = '';
    for (const l of lines) {
      if (!l) continue;
      const p = document.createElement('p');
      if (l.cls) p.className = l.cls;
      if (l.swatch !== undefined) { const sw = document.createElement('span'); sw.className = 'sw ' + l.swatch; if (l.color) sw.style.setProperty('--c', l.color); p.appendChild(sw); }
      p.appendChild(document.createTextNode(l.text));
      ui.infoPlain.appendChild(p);
    }
  }
  // a source line for the summary: without the working copies' paths and SOURCES.md references (the full record keeps them)
  function plainSource(s) {
    let t = String(s).replace(/,?\s*georeferenced copy \S+/g, '');
    for (let i = 0; i < 3; i++) t = t.replace(/\s*\([^()]*(\/|SOURCES\.md)[^()]*\)/g, '');
    return t.replace(/geometry and type: /g, 'outline, ').replace(/existence: /g, 'standing in Dec 1982, ').replace(/\s+([;,])/g, '$1').trim();
  }
  function renderInfo() {
    ui.info.hidden = !selected;
    syncSide();
    if (!selected) { infoFieldsNow = null; return; }
    const F = {};
    ui.infoMain.textContent = '';
    ui.infoMore.textContent = '';
    ui.infoLater.textContent = '';
    ui.infoLaterH.hidden = true;
    const add = (table, label, value, opt = {}) => {
      const tr = document.createElement('tr'), th = document.createElement('th'), td = document.createElement('td');
      th.scope = 'row'; th.textContent = label;
      if (opt.swatch) { const sw = document.createElement('span'); sw.className = 'sw ' + opt.swatch; if (opt.color) sw.style.setProperty('--c', opt.color); td.appendChild(sw); }
      // opt.href: the value is a link to a source's own page (a citation: reference-only, nothing of it shown here)
      const v = document.createElement(opt.href ? 'a' : 'span'); v.className = 'v'; v.textContent = value; td.appendChild(v);
      if (opt.href) { v.href = opt.href; v.target = '_blank'; v.rel = 'noopener'; }
      if (opt.note) { const n = document.createElement('span'); n.className = 'note'; n.textContent = opt.note; td.appendChild(n); }
      if (opt.cls) tr.className = opt.cls;
      tr.append(th, td);
      table.appendChild(tr);
      F[label] = value;
    };
    ui.infoFig.hidden = true;
    if (selected.type === 'hotspot') {
      const h = selected.h, ty = HOTSPOT_TYPES[h.type] || { label: h.type, note: '' };
      ui.infoTitle.textContent = `${ty.label}: ${h.filename}`;
      ui.infoSub.textContent = h.type === 'analogue' ? 'ANALOGUE -- not evidence for any building in the pilot' : 'photo hotspot';
      F.heading = ui.infoTitle.textContent;
      ui.infoImg.src = h.image; ui.infoImg.alt = h.caption || h.filename;
      ui.infoCap.textContent = h.caption || '';
      ui.infoFig.hidden = !h.image;
      setPlain([{ cls: 'lead', text: ty.label + (h.date ? ', ' + fmtValue(h.date) : '') },
        num(h.accuracy_m) !== null && { text: `Placed to within about ${Math.round(num(h.accuracy_m))} m (the dashed circle on the map)` },
        { cls: h.type === 'analogue' ? 'warn' : 'why', text: ty.note }]);
      add(ui.infoMain, 'id', h.id);
      add(ui.infoMain, 'type', h.type, { note: ty.note, cls: h.type === 'analogue' ? 'warn' : '' });
      add(ui.infoMain, 'taken', fmtValue(h.date));
      add(ui.infoMain, 'file', fmtValue(h.filename), { note: 'record in photos/index.geojson' });
      if (h.rights) add(ui.infoMain, 'rights', fmtValue(h.rights), { note: h.placeholder ? 'not shown in the public build' : '' });
      if (h.placeholder && h.url) add(ui.infoMain, 'source page', h.citation || h.url, { href: h.url, note: 'the image is shown on its own page' });
      add(ui.infoMain, 'position E, N (EPSG:2326)', `${num(h.E).toFixed(1)}, ${num(h.N).toFixed(1)}`);
      add(ui.infoMain, 'accuracy_m', fmtValue(h.accuracy_m), { note: 'radius of the dashed circle' });
      add(ui.infoMain, 'position_quality', fmtValue(h.position_quality));
      add(ui.infoMain, 'position_source', fmtValue(h.position_source));
      if (num(h.heading) !== null) add(ui.infoMain, 'heading', `${Math.round(num(h.heading))}° from N`, { note: 'camera direction from the photo\'s metadata' });
      if (num(h.dist_to_pilot_m) !== null) add(ui.infoMain, 'distance to the pilot', `${Math.round(num(h.dist_to_pilot_m))} m`);
      for (const k of ['saw', 'use', 'why', 'difference', 'source_ids', 'approved'])
        if (h[k] !== undefined && h[k] !== null && h[k] !== '') add(ui.infoMore, k === 'saw' ? 'noted on site (saw)' : k, fmtValue(h[k]));
      ui.infoMoreH.hidden = !ui.infoMore.children.length;
      infoFieldsNow = F;
      return;
    }
    if (selected.type === 'terrain') {
      const t = scene.terrain, o = scene.ortho, tier = TIERS[t.tier] || NO_TIER;
      ui.infoTitle.textContent = 'Ground surface (terrain)';
      ui.infoSub.textContent = 'The ground model, with the December 1982 photograph draped on it';
      F.heading = ui.infoTitle.textContent;
      setPlain([{ cls: 'lead', swatch: '', color: tier.hex, text: (TIERS[t.tier] ? tier.label : 'No tier') + (t.check_status === 'checked by eye' ? ' · checked by eye' : '') },
        t.source && { text: 'Sources: ' + plainSource(fmtValue(t.source)) },
        { cls: 'why', text: t.tier_reason || t.tier_note || tier.def }]);
      add(ui.infoMain, 'id', 'terrain');
      add(ui.infoMain, 'layer', 'terrain');
      add(ui.infoMain, 'tier', fmtValue(t.tier), { note: t.tier_reason || t.tier_note || tier.def });
      add(ui.infoMain, 'epoch', fmtValue(scene.epoch), { note: 'the epoch shown; the ground model itself was measured on source_date' });
      add(ui.infoMain, 'source', fmtValue(t.source));
      add(ui.infoMain, 'source_date', fmtValue(t.source_date));
      if (t.check_status) add(ui.infoMain, 'check_status', fmtValue(t.check_status), t.check_status === 'checked by eye' ? {} : { swatch: 'dots', color: '#777', note: 'not yet checked by eye by the author' });
      else add(ui.infoMain, 'check_status', 'not recorded', { cls: 'warn', note: 'scene.json records no check status for the ground' });
      if (t.spot_height_check) {
        const s = t.spot_height_check;
        add(ui.infoMain, 'against the sheets', `median ${s.median_m >= 0 ? '+' : ''}${s.median_m} m over ${s.n} spot heights, ${s.within_1m} within 1 m`,
          { note: s.reading + (s.outliers && s.outliers.length ? '; off by more than 2 m: ' + s.outliers.join('; ') : '') });
      }
      add(ui.infoMain, 'photo source', fmtValue(o.source));
      add(ui.infoMain, 'photo source_date', fmtValue(o.source_date));
      add(ui.infoMain, 'photo tier', fmtValue(o.tier));
      if (selected.x !== undefined) {
        const [E, N] = toEN(selected.x, selected.z);
        add(ui.infoMain, 'point E (EPSG:2326)', E.toFixed(1));
        add(ui.infoMain, 'point N (EPSG:2326)', N.toFixed(1));
        add(ui.infoMain, 'point ground (mPD)', selected.y.toFixed(2));
      }
      const shown = new Set(['tier', 'tier_note', 'tier_reason', 'source', 'source_date', 'file']);
      for (const [key, v] of Object.entries(t)) if (!shown.has(key)) add(ui.infoMore, key, fmtValue(v));
      for (const [key, v] of Object.entries(o)) if (!['source', 'source_date', 'tier', 'file'].includes(key)) add(ui.infoMore, 'photo ' + key, fmtValue(v));
      ui.infoMoreH.hidden = false;
      infoFieldsNow = F;
      return;
    }
    const rec = selected.rec, p = rec.props, isB = rec.style.kind === 'building';
    ui.infoTitle.textContent = String(p.name || p.kind || rec.id);
    ui.infoSub.textContent = `${rec.layer} · ${rec.geomType}` + (rec.idMissing ? ' · this feature has no id' : '') + (rec.idDuplicate ? ' · duplicate id' : '');
    F.heading = ui.infoTitle.textContent;
    const missing = (k) => p[k] === undefined || p[k] === null || p[k] === '';
    const heightWords = p.height_rule === 'ruin-footing' ? 'a ruin\'s broken footing, after photos of cleared plots' : rec.heightPattern === PAT.stripes ? 'a placeholder, not a measurement' :
      rec.heightPattern === PAT.bands ? 'from a written rule' : p.height_rule === 'ndsm-2010' ? 'measured by LiDAR in 2010-11, assumed unchanged since 1982' : 'from a dated source';
    setPlain([{ cls: 'lead', swatch: '', color: rec.tier.hex, text: (rec.tierKey ? rec.tier.label : 'No tier') + (rec.unchecked ? ' · not yet checked by eye' : ' · checked by eye') },
      rec.pending && { cls: 'warn', text: p.status === ABSENT ? 'Not in the 1982 model: drawn on a survey sheet, but nothing stood there on the December 1982 photograph.'
        : 'Not in the 1982 model: on a survey sheet dated after the photograph, and not confirmed on it.' },
      !missing('source') && { text: 'Sources: ' + plainSource(fmtValue(p.source)) },
      isB && !missing('height_m') && { text: `Height ${fmtValue(p.height_m)} m: ${heightWords}` },
      { cls: 'why', text: missing('tier_reason') ? (rec.tierKey ? rec.tier.def : NO_TIER.def) : fmtValue(p.tier_reason) }]);
    for (const key of PRIMARY) {
      const value = key === 'id' ? rec.id : fmtValue(p[key]);
      const opt = {};
      if (key === 'tier') Object.assign(opt, { swatch: 'tier', color: rec.tier.hex, note: rec.tierKey ? `tier ${rec.tier.n} of 4: ${rec.tier.def}` : NO_TIER.def });
      if (key === 'check_status' && rec.unchecked) Object.assign(opt, { swatch: 'dots', color: '#777', note: p.check_status === 'unchecked' ? 'not yet checked by eye by the author' : 'not "checked by eye": drawn as unchecked' });
      if (key === 'status' && rec.pending) Object.assign(opt, { cls: 'warn', note: p.status === ABSENT
        ? 'not part of the 1982 model: drawn on the sheet, but the author found no structure on the Dec 1982 photo -- gone by then, or never built as drawn'
        : 'not part of the 1982 model: on the Aug 1983 sheet, not confirmed on the Dec 1982 photo (CLAUDE.md 5). A check by eye can bring it in.' });
      if (key === 'source_ids') opt.note = 'rows of viewer_1982/source_log.csv';
      if (key === 'id' ? rec.idMissing : (missing(key) && !(key === 'height_source_date'))) opt.cls = opt.cls || 'warn';
      add(ui.infoMain, key, value, opt);
    }
    if (isB) {
      for (const key of HEIGHT_KEYS) {
        const opt = {};
        let value = fmtValue(p[key]);
        if (key === 'height_m' && rec.defaults.top_m !== undefined) value += ' (no base_m / top_m in the data: drawn from the terrain)';
        if (key === 'height_tier') {
          const cls = rec.heightPattern === PAT.stripes ? 'stripes' : rec.heightPattern === PAT.bands ? 'bands' : 'plain';
          Object.assign(opt, { swatch: cls, color: '#9a9a9a', note: p.height_rule === 'ruin-footing' ? 'analogue: a ruin\'s broken footing after the author\'s photos of cleared plots (ruins.json), not a measurement' :
            rec.heightPattern === PAT.stripes ? `placeholder ${placeholderText()} m, not a measurement` : rec.heightPattern === PAT.bands ? 'from a written rule' :
            p.height_rule === 'ndsm-2010' ? 'measured Dec 2010 - Jan 2011 on the same building (LiDAR), assumed unchanged since 1982' : 'from a dated source' });
        }
        if (key === 'height_source_date' && missing(key)) continue;
        if (missing(key)) opt.cls = 'warn';
        add(ui.infoMain, key, value, opt);
      }
      // a ruin on the sheet (ruins.json, 2026-10-26): listed only where the build marked one
      if (p.ruin) for (const key of RUIN_KEYS) if (!missing(key)) add(ui.infoMain, key, fmtValue(p[key]), {});
    }
    if (isB && p.finish) {
      for (const key of FINISH_KEYS) {
        if (missing(key)) continue;
        const opt = {};
        if (key === 'finish') Object.assign(opt, { swatch: 'plain', color: rec.finishAnalogue ? TIERS.analogue.hex : '#e9e7e2', note: rec.finish ? (rec.finishAnalogue ? 'drawn on its walls in 3D, tinted as the analogue tier: not this structure\'s wall' : 'drawn on its walls in 3D') : 'the texture did not load: drawn in the tier colour' });
        if (key === 'finish_tier' && p.finish_tier === 'analogue') Object.assign(opt, { cls: 'warn', note: TIERS.analogue.def });
        if (key === 'finish_source_ids') opt.note = 'rows of viewer_1982/source_log.csv';
        if (key === 'archival_matches') opt.note = 'matches in viewer_1982/matching_register.json';
        add(ui.infoMain, key, fmtValue(p[key]), opt);
      }
      const wf = wallFinishes().find((f) => f.texture === p.finish_texture);
      if (wf && wf.drawn_with) add(ui.infoMain, 'finish drawn with', wf.drawn_with, { note: `${scene.edition || 'class'} build; rights: ${wf.rights || 'not recorded'}` });
    }
    // photographs cited for facts and never shown (reference-only): the estate blocks' window and door rule (FN05)
    if (isB && /^Block \d+/.test(String(p.name || ''))) {
      for (const r of (scene.references || [])) {
        add(ui.infoMain, 'reference (not shown)', `${r.label} (${r.date})`, { href: r.url,
          note: `${r.rights}: facts taken for the analogue view's windows and doors (${r.facts}); the photograph is not shown, follow the link to its own page` });
        add(ui.infoMore, `copyright of ${r.record}`, r.copyright || 'not recorded');
      }
    }
    if (isB && p.roof_finish) {
      for (const key of ROOF_KEYS) {
        if (missing(key)) continue;
        const opt = {};
        if (key === 'roof_finish') Object.assign(opt, { swatch: 'photo', note: 'the roof in 3D shows the Dec 1982 photograph of itself; the walls are not recorded' });
        if (key === 'roof_finish_source_ids') opt.note = 'rows of viewer_1982/source_log.csv';
        if (key === 'roof_photo_shift_m') opt.note = 'east, north: where the roof\'s image lies on the photo, relative to the footprint (the lean)';
        add(ui.infoMain, key, fmtValue(p[key]), opt);
      }
    }
    if (isB && p.roof_form) {
      for (const key of ROOF_FORM_KEYS) {
        if (missing(key)) continue;
        const opt = {};
        if (key === 'roof_form') opt.note = rec.roofFaces ? 'drawn in 3D: read off the Dec 1982 photo by two readers' : 'drawn flat';
        if (key === 'roof_form_check_status' && p[key] !== 'checked by eye') opt.cls = 'warn';
        if (key === 'roof_pitch_deg' || key === 'roof_pitch_tier') Object.assign(opt, { cls: 'warn', note: 'a drawing default, not a measurement' });
        if (key === 'roof_form_source_ids') opt.note = 'rows of viewer_1982/source_log.csv';
        add(ui.infoMain, key, fmtValue(p[key]), opt);
      }
    }
    if (rec.flatNoHeight) add(ui.infoMain, 'drawn', 'on the ground', { note: 'the sheets give no height for walls or fences, so none is invented' });
    const shown = new Set(PRIMARY.concat(isB ? HEIGHT_KEYS.concat(p.finish ? FINISH_KEYS : [], p.roof_finish ? ROOF_KEYS : [], p.roof_form ? ROOF_FORM_KEYS : [], ROOF_GEOMETRY_KEYS) : []));
    for (const [key, dv] of Object.entries(rec.defaults)) {
      if (isB && (key === 'base_m' || key === 'top_m')) continue;
      add(ui.infoMain, key, `${dv} (viewer default; in the data: ${p[key] === undefined ? 'absent' : fmtValue(p[key])})`, { cls: 'warn' });
      shown.add(key);
    }
    ui.infoLater.textContent = '';
    const later = p.later_context && typeof p.later_context === 'object' ? p.later_context : null;
    ui.infoLaterH.hidden = !later;
    if (later) for (const [key, v] of Object.entries(later)) add(ui.infoLater, key, fmtValue(v));
    shown.add('later_context');
    let more = 0;
    for (const [key, v] of Object.entries(p)) {
      if (shown.has(key)) continue;
      add(ui.infoMore, key, fmtValue(v));
      more++;
    }
    ui.infoMoreH.hidden = more === 0;
    infoFieldsNow = F;
  }
  function placeholderText() { const v = num(scene.placeholder_height_m); return v === null ? '?' : Number.isInteger(v) ? v.toFixed(1) : String(v); }

  // ================================================================== legend, titles, status
  function setupTexts() {
    const title = String(scene.title || 'Kwu Tung North, 1982').replace(/\s--\s/g, ' – ');
    ui.title.textContent = title;
    document.title = title;
    if (scene.dev_build) {
      ui.devBadge.hidden = false;
      ui.devBadge.title = DEV_NOTE;
    }
    buildLegend();
  }
  function buildLegend() {
    const L = ui.legendBody;
    L.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const item = (list, swCls, color, label, desc, count) => {
      const li = el('li');
      const sw = el('span', 'sw ' + swCls);
      if (color) sw.style.setProperty('--c', color);
      li.appendChild(sw);
      const t = el('div', 'txt');
      const head = el('span', 'lab', label);
      t.appendChild(head);
      if (count !== undefined) t.appendChild(el('span', 'count', String(count)));
      if (desc) t.appendChild(el('span', 'desc', desc));
      li.appendChild(t);
      list.appendChild(li);
    };
    const count = (fn) => { const c = {}; for (const r of recs) { const k = fn(r); c[k] = (c[k] || 0) + 1; } return c; };
    const byTier = count((r) => r.tierKey || 'none'), byLayer = count((r) => r.layer);
    const unchecked = recs.filter((r) => r.unchecked).length;
    L.appendChild(el('h3', null, 'Colour: confidence tier'));
    let ul = el('ul', 'legend-list');
    for (const [key, t] of Object.entries(TIERS)) item(ul, 'tier', t.hex, `${t.n} ${t.label}`, t.def, byTier[key] || 0);
    if (byTier.none) item(ul, 'tier', NO_TIER.hex, NO_TIER.label, NO_TIER.def, byTier.none);
    L.appendChild(ul);
    L.appendChild(el('h3', null, 'Pattern: building height'));
    ul = el('ul', 'legend-list');
    const byH = count((r) => r.style.kind === 'building' ? (r.props.height_tier || 'none') : null);
    item(ul, 'plain', '#9a9a9a', 'Plain: sourced height', 'measured: the 2010/11 LiDAR on the same building (the 15 estate blocks and one refuse collection point); none of the 1981/83 sheets records a height', byH.sourced || 0);
    item(ul, 'bands', '#9a9a9a', 'Horizontal bands: rule-based height', 'a written rule in height_rules.md', byH['rule-based'] || 0);
    item(ul, 'stripes', '#9a9a9a', `Diagonal stripes: inferred height`, `placeholder ${placeholderText()} m, not a measurement`, byH.inferred || 0);
    L.appendChild(ul);
    const fin = finishOf();
    if (fin.texture) {
      L.appendChild(el('h3', null, 'Finish (3D): archival'));
      ul = el('ul', 'legend-list');
      wallFinishes().forEach((wf, i) => {
        const these = recs.filter((r) => r.finishIdx === i + 1), an = wf.appearance_tier === 'analogue';
        item(ul, 'plain', an ? TIERS.analogue.hex : '#e9e7e2', an ? `Walls: ${wf.finish}` : `White render, ${fmtValue(wf.source_date).slice(0, 4)} photograph`,
          `${wf.drawn_with ? 'Drawn with ' + wf.drawn_with + '. ' : ''}${wf.source} Match: ${wf.match}. ${wf.note} In place of the tier colour on these walls (presence tier: ${[...new Set(these.map((r) => r.tierKey || 'none'))].join(', ') || 'none'}); the 2D map keeps the tier colours.`, these.length);
      });
      L.appendChild(ul);
    }
    const rpf = roofPhotoOf(), nRoof = recs.filter((r) => r.roofShift).length;
    if (rpf.finish) {
      if (!fin.texture) L.appendChild(el('h3', null, 'Finish (3D): archival'));
      ul = el('ul', 'legend-list');
      item(ul, 'photo', null, 'Roof: the Dec 1982 photograph of that roof', `${rpf.source}. On every building the photo shows (tier sourced). ${rpf.note}`, nRoof);
      L.appendChild(ul);
    }
    L.appendChild(el('h3', null, 'Shape: what kind of feature'));
    ul = el('ul', 'legend-list');
    item(ul, 'shape-bld', '#9a9a9a', 'Building', 'filled outline (2D), block (3D)', byLayer.buildings || 0);
    item(ul, 'shape-lane', '#9a9a9a', 'Lane, track, footpath', 'a plain ribbon on the ground', byLayer.lanes || 0);
    item(ul, 'shape-stream', '#9a9a9a', 'Watercourse', 'a ribbon with a dark core (the sheets draw it as a line with flow arrows)', byLayer.streams || 0);
    item(ul, 'shape-fence', '#9a9a9a', 'Fence, gate, wall', 'a thin line on the ground: the sheets give no height', (byLayer.fences || 0) + (byLayer.walls || 0));
    item(ul, 'shape-area', '#9a9a9a', 'Labelled area, slope', 'a pale area or a thin line', (byLayer.landuse || 0) + (byLayer.slopes || 0));
    if (byLayer.trees || byLayer.landcover) item(ul, 'shape-tree', '#9a9a9a', 'Tree cover, trees', 'traced off the 1982 photo', (byLayer.trees || 0) + (byLayer.landcover || 0));
    item(ul, 'shape-point', '#9a9a9a', 'Pole, lamp, well, tank; spot height', 'a diamond; spot heights carry their value in mPD', (byLayer.symbols || 0) + (byLayer.spot_heights || 0));
    L.appendChild(ul);
    L.appendChild(el('h3', null, 'Checking'));
    ul = el('ul', 'legend-list');
    item(ul, 'dots', '#9a9a9a', 'Fine dots (3D), dashed outline (2D)', 'Unchecked: not yet checked by eye by the author', unchecked);
    item(ul, 'plain solid-outline', '#9a9a9a', 'No dots, solid outline', 'Checked by eye', recs.length - unchecked);
    item(ul, 'selected', null, 'Pulsing light / white outline', 'the selected feature');
    L.appendChild(ul);
    L.appendChild(el('h3', null, 'Not in the 1982 model'));
    ul = el('ul', 'legend-list');
    const pend = {}, gone = pendingRecs.filter((r) => r.props.status === ABSENT);
    for (const r of pendingRecs) if (r.props.status !== ABSENT) pend[r.layer] = (pend[r.layer] || 0) + 1;
    const shownTxt = showPending ? ' (shown)' : ' (hidden)';
    item(ul, 'pending', null, 'Pending confirmation' + shownTxt,
      'on the Aug 1983 sheet, not confirmed on the Dec 1982 photo: ' + (Object.entries(pend).map(([k, v]) => `${k} ${v}`).join(', ') || 'none') +
      '. Dotted white outlines on the 2D map only.', pendingRecs.length - gone.length);
    if (gone.length) item(ul, 'absent', null, 'Absent in Dec 1982' + shownTxt,
      'drawn on the 1981 sheet, but the author\'s check found no structure on the Dec 1982 photo: dashed white outlines on the 2D map only.', gone.length);
    ul.appendChild(el('li', 'note-li', 'The button "Not in the model" (U) shows them.'));
    L.appendChild(ul);
    L.appendChild(el('h3', null, 'Ground and photograph'));
    ul = el('ul', 'legend-list');
    item(ul, 'photo', null, 'Photograph: tier ' + fmtValue(scene.ortho.tier), fmtValue(scene.ortho.source) +
      (scene.ortho_tiles ? `. Walking, the ground round you is the same photo at its own ${fmtValue(scene.ortho_tiles.px_m)} m` : ''));
    if (scene.water) item(ul, 'water', null, scene.water.rivers ? 'Ponds and river: water surface' : 'Ponds: water surface',
      `${fmtValue(scene.water.ponds)} ponds of the model, where the sheets and the photo put them` +
      (scene.water.rivers ? `; the Sheung Yue's open water where the Dec 1982 photo puts it (traced by two tracers; the 1980 sheets draw it up to 20 m away at the meanders, and their lines stay as the watercourse layer)` : '') + '. ' +
      'The still, sky-reflecting surface over the photo\'s own tone is a drawing choice, and so is its level (no source gives the 1982 water level)');
    if (scene.ground_detail) item(ul, 'ground', null, 'Ground close up: generic grain (analogue)', 'Within about 30 m of you, a fine grain by the sourced land cover ' +
      '(cultivated plots: soil; lanes and yards: gravel; elsewhere: grass) is laid over the 1982 photo, whose tones it keeps. It is not a record of the 1982 surface');
    item(ul, 'ground', null, 'Ground model under it: tier ' + fmtValue(scene.terrain.tier), `${fmtValue(scene.terrain.source)}. ${scene.terrain.tier_reason || scene.terrain.tier_note || ''}` +
      (scene.terrain.patch ? ` ${scene.terrain.patch.summary}` : ''));
    item(ul, 'pilot', null, scene.extension ? 'Zone boundaries: the pilot and the extension' : 'Pilot zone boundary',
      '2D: white and dark dashed line; 3D: white line on the ground' + (scene.extension ? `. The extension (${fmtValue(scene.extension.area_ha)} ha: Kwu Tung village, the Shek Tsai Leng sauce yards, fields and fish ponds, the rest of the Dills Corner estate, the north-east hill) is ${fmtValue(scene.extension.status)}: ` +
        (scene.extension.edges ? `its edges are ${fmtValue(scene.extension.edges)}` : 'its edges were drawn on the 1982 photo, not surveyed') : ''));
    item(ul, 'outside', null, 'Beyond the data extent', 'flat grey filler in 3D, not data');
    if (hotspots.length) item(ul, 'hotspot', null, 'Photo hotspot', 'a camera mark with its view direction; click it for the photo, its date and position accuracy', hotspots.length);
    L.appendChild(ul);
    if (scene.credit) {
      L.appendChild(el('h3', null, 'Sources and credit'));
      L.appendChild(el('p', 'build', scene.credit));
      for (const c of (scene.credits_more || [])) L.appendChild(el('p', 'build', c));
      if (scene.edition_note) L.appendChild(el('p', 'build', scene.edition_note));
      // restricted-only items (CLAUDE.md 13): shown with credit in the local build; cited with a link in the public one
      const cites = (scene.restricted || []).filter((r, i, a) => a.findIndex((s) => s.url === r.url) === i).map((r) => ({ label: r.citation, url: r.url,
        how: scene.edition === 'public' ? `cited, not shown: drawn with ${r.stand_in}` : 'surfaces cut from it are shown in this local build only' }))
        .concat((scene.references || []).map((r) => ({ label: `${r.label} (${r.date})`, url: r.url, how: 'cited for the estate blocks\' windows and doors, not shown' })));
      const byUrl = new Map();   // one line per source page, saying everything this build does with it
      for (const c of cites) { const g = byUrl.get(c.url); if (g) g.how.push(c.how); else byUrl.set(c.url, { label: c.label, how: [c.how] }); }
      for (const [url, c] of byUrl) {
        const p = el('p', 'build'), a = el('a', null, c.label);
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        p.append(a, document.createTextNode(`: ${c.how.join('; ')}.`));
        L.appendChild(p);
      }
    }
    L.appendChild(el('h3', 'author-only', 'In this build'));
    const p = el('p', 'build author-only');
    const layers = Object.entries(byLayer).map(([k, v]) => `${k} ${v}`).join(', ');
    p.textContent = `${recs.length} features in the 1982 model (${layers || 'none'}); ${pendingRecs.length} not in it (pending confirmation, or absent in Dec 1982). Built ${scene.built || '?'}.` +
      (skipped.length ? ` ${skipped.length} not drawn (no usable geometry).` : '') +
      (Array.isArray(scene.missing_fields) && scene.missing_fields.length ? ` ${scene.missing_fields.length} required fields missing (build check).` : '');
    L.appendChild(p);
    if (scene.dev_build) L.appendChild(el('p', 'build dev', 'DEVELOPMENT DATA. ' + DEV_NOTE));
  }
  function syncSide() {
    const show = !ui.info.hidden || !ui.legend.hidden;
    if (ui.side.hidden === show) { ui.side.hidden = !show; needsResize = true; }
  }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function updateStatus() {
    if (!T) return;
    let X, Z, who = '';
    if (viewer.mode === 'walk') { X = walker.x; Z = walker.z; }
    else if (MV.cursor) { [X, Z] = MV.cursor; who = 'cursor '; }
    else if (walker.placed) { X = walker.x; Z = walker.z; who = 'walker '; }
    else { X = MV.cx; Z = MV.cz; who = 'map centre '; }
    const [E, N] = toEN(X, Z), inside = T.inside(X, Z), parts = [];
    parts.push(`${who}E ${E.toFixed(1)}  N ${N.toFixed(1)} (EPSG:2326)`);
    parts.push(inside ? `ground ${T.bilinear(X, Z).toFixed(2)} mPD` : 'ground: outside the terrain');
    if (viewer.mode === 'walk') parts.push(`eye ${(T.bilinear(X, Z) + eyeNow()).toFixed(2)} mPD`);
    syncFov(false);
    parts.push(viewer.mode === 'walk' || walker.placed ? `heading ${pad3(Math.round(walker.heading) % 360)}° from N` : 'heading —');
    if (viewer.mode === 'walk') parts.push(`pitch ${Math.round(walker.pitch)}°`);
    parts.push(`Epoch: ${epochLabel()}`);
    if (viewer.mode === 'walk') parts.push(`${Math.round(fps)} fps`);
    if (scene.dev_build) parts.push('DEVELOPMENT DATA');
    const text = parts.join('   ·   ');
    if (text !== statusText) { ui.status.textContent = text; statusText = text; }
  }
  function hint(text, ms = 4000) {
    ui.hint.textContent = text;
    ui.hint.hidden = false;
    ui.hint.classList.remove('fade');
    clearTimeout(hintTimer);
    if (ms > 0) hintTimer = setTimeout(() => ui.hint.classList.add('fade'), ms);
  }
  function showTooltip(rec, clientX, clientY) {
    const r = ui.view.getBoundingClientRect();
    ui.tooltip.textContent = `${rec.props.name || rec.props.kind || rec.id} · ` + (rec.pending ? notInModelText(rec) : (rec.tierKey || 'no valid tier'));
    ui.tooltip.hidden = false;
    const w = ui.tooltip.offsetWidth;
    ui.tooltip.style.left = `${Math.min(clientX - r.left + 14, r.width - w - 6)}px`;
    ui.tooltip.style.top = `${clientY - r.top + 16}px`;
  }
  function hideTooltip() { if (ui) ui.tooltip.hidden = true; }

  // ================================================================== input
  function bindUI() {
    ui.btnMap.addEventListener('click', () => { if (viewer.mode !== 'map') setMode('map'); });
    ui.btnWalk.addEventListener('click', walkHere);
    ui.btnLook.addEventListener('click', togglePointerLock);
    ui.btnLegend.addEventListener('click', () => {
      ui.legend.hidden = !ui.legend.hidden;
      ui.btnLegend.setAttribute('aria-pressed', String(!ui.legend.hidden));
      syncSide();
    });
    ui.btnHelp.addEventListener('click', () => toggleHelp());
    ui.btnPending.addEventListener('click', togglePending);
    ui.btnShot.addEventListener('click', () => screenshot());
    if (ui.btnOverlay) ui.btnOverlay.addEventListener('click', () => overlayFrame());
    if (ui.vpSel) ui.vpSel.addEventListener('change', () => { const id = ui.vpSel.value; ui.vpSel.blur(); if (id) goToViewpoint(id); });
    if (ui.fov) {
      ui.fov.addEventListener('input', () => { const v = num(ui.fov.value); if (v !== null && v >= 10 && v <= 120) hfovSet = v; });
      ui.fov.addEventListener('change', () => { setHfov(ui.fov.value.trim() === '' ? null : num(ui.fov.value) === null ? hfovSet : num(ui.fov.value)); ui.fov.blur(); });
    }
    if (ui.btnKeymap) ui.btnKeymap.addEventListener('click', toggleKeymap);
    const btnAnalogue = document.getElementById('btn-analogue');
    if (btnAnalogue) btnAnalogue.addEventListener('click', openAnalogue);
    ui.helpClose.addEventListener('click', () => toggleHelp(false));
    ui.infoClose.addEventListener('click', clearSelection);
    ui.zoomIn.addEventListener('click', () => zoomMap(1.5, MV.w / 2, MV.h / 2));
    ui.zoomOut.addEventListener('click', () => zoomMap(1 / 1.5, MV.w / 2, MV.h / 2));
    // buttons should not keep the focus: Space would press them again while walking
    for (const b of document.querySelectorAll('button')) b.addEventListener('pointerup', () => b.blur());
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => { keys.clear(); shiftHeld = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); shiftHeld = false; } });
    document.addEventListener('pointerlockchange', () => {
      const on = document.pointerLockElement === ui.gl;
      if (!on) lockReleasedAt = performance.now();
      ui.crosshair.hidden = !on;
      ui.btnLook.setAttribute('aria-pressed', String(on));
      if (on) hint('Mouse-look on: move the mouse to look, click to identify at the crosshair, Esc to release', 5000);
    });
    document.addEventListener('pointerlockerror', () => hint('Mouse-look is not available here; drag to look instead.', 4000));
    new ResizeObserver(() => { needsResize = true; }).observe(ui.view);
    bindMapInput();
    bindWalkInput();
  }
  function codeOf(e) {
    if (e.code) return e.code;
    const k = (e.key || '').toLowerCase();
    return /^[a-z]$/.test(k) ? 'Key' + k.toUpperCase() : e.key;
  }
  const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target === ui.fov || e.target === ui.vpSel) return;   // typing a field of view or picking a viewpoint, not walking
    const code = codeOf(e);
    shiftHeld = e.shiftKey;
    if (viewer.mode === 'walk' && WALK_KEYS.has(code)) { keys.add(code); e.preventDefault(); }
    if (e.repeat) return;
    if (code === 'Escape') {
      if (ui.intro && !ui.intro.hidden) { closeIntro(); return; }
      if (!ui.help.hidden) { toggleHelp(false); return; }
      if (document.pointerLockElement || performance.now() - lockReleasedAt < 250) return;   // that Esc released the mouse
      if (viewer.mode === 'walk') setMode('map');
      return;
    }
    if (code === 'KeyM') { if (viewer.mode === 'walk') setMode('map'); return; }
    if (code === 'KeyL') { togglePointerLock(); return; }
    if (code === 'KeyU') { togglePending(); return; }
    if (code === 'KeyK') { toggleKeymap(); return; }
    if (code === 'KeyP') { screenshot(); return; }
    if (code === 'KeyH' || e.key === '?') { toggleHelp(); return; }
    if (viewer.mode === 'map' && (e.key === '+' || e.key === '=')) zoomMap(1.5, MV.w / 2, MV.h / 2);
    if (viewer.mode === 'map' && (e.key === '-' || e.key === '_')) zoomMap(1 / 1.5, MV.w / 2, MV.h / 2);
  }
  function onKeyUp(e) {
    shiftHeld = e.shiftKey;
    keys.delete(codeOf(e));
  }
  function toggleKeymap() {
    if (!keymap) { hint('The key map is not available (keymap.js did not load).', 3500); return; }
    const on = keymap.toggle();
    ui.btnKeymap.setAttribute('aria-pressed', String(on));
    if (on && viewer.mode === 'map') hint('The key map shows in the walk, top right.', 3000);
  }
  function hfovDeg() { const a = ui.gl.width / Math.max(1, ui.gl.height); return 2 * Math.atan(Math.tan(rad(fovYDeg(a)) / 2) * a) * 180 / Math.PI; }
  function drawKeymap() {
    if (!keymap) return;
    const [E, N] = toEN(walker.x, walker.z);
    keymap.draw(E, N, walker.heading, hfovDeg());
  }
  // the key map as drawn, for screenshots of the walk: where it sits over the 3D view, in device pixels
  function keymapPlacement() {
    if (!keymap || !keymap.shown || !ui.keymap.clientWidth) return null;
    const v = ui.view.getBoundingClientRect(), k = ui.keymap.getBoundingClientRect(), dpr = MV.dpr || 1;
    return { x: (k.left - v.left) * dpr, y: (k.top - v.top) * dpr, w: k.width * dpr, h: k.height * dpr };
  }
  function togglePending() {
    showPending = !showPending;
    ui.btnPending.setAttribute('aria-pressed', String(showPending));
    buildLegend();
    MV.dirty = true;
    if (showPending && viewer.mode === 'walk') hint('Features not in the model are drawn on the 2D map only (M).', 3500);
  }

  // ---------------------------------------------------------------- screenshot export (CLAUDE.md 8 item 5)
  // The view as it is, with a band below carrying the GIS information -- position in EPSG:2326,
  // view direction, epoch, build, export time, the tier key and the credit -- and the same as JSON
  // in a PNG tEXt chunk (keyword "viewer_1982"), so the numbers survive without OCR.
  const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function pngWithText(buf, keyword, text) {
    const src = new Uint8Array(buf), ascii = text.replace(/[^\x20-\x7e]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    const data = new TextEncoder().encode(keyword + '\0' + ascii);
    const chunk = new Uint8Array(12 + data.length), dv = new DataView(chunk.buffer);
    dv.setUint32(0, data.length);
    chunk.set([116, 69, 88, 116], 4);   // "tEXt"
    chunk.set(data, 8);
    dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    const at = 8 + 25;                    // after the signature and IHDR (13 bytes of data + 12)
    const out = new Uint8Array(src.length + chunk.length);
    out.set(src.subarray(0, at)); out.set(chunk, at); out.set(src.subarray(at), at + chunk.length);
    return out;
  }
  function viewMeta() {
    const m = { crs: 'EPSG:2326 (HK1980 Grid), heights mPD', epoch: scene.epoch, epoch_note: 'reconstruction of about December 1982; photo DOP1000-1982 (Dec 1982), sheets 2-SE-9B (Jan 1981) and 2-SE-4D (Aug 1983)',
      build: scene.built, exported: new Date().toISOString(), mode: viewer.mode, selected: selectedId(), pending_shown: showPending,
      key_map: viewer.mode === 'walk' && !!keymapPlacement() ? { shown: true, zoom: keymap.zoom, north: 'up' } : { shown: false },
      viewer: 'viewer_1982 prototype -- unchecked and inferred elements are not evidence', edition: scene.edition || 'class', credit: scene.credit || '' };
    if (viewer.mode === 'walk') {
      const [E, N] = toEN(walker.x, walker.z), g = T.bilinear(walker.x, walker.z), asp = ui.gl.width / Math.max(1, ui.gl.height);
      Object.assign(m, { E: +E.toFixed(2), N: +N.toFixed(2), ground_mPD: +g.toFixed(2), eye_mPD: +(g + eyeNow()).toFixed(2), eye_height_m: eyeNow(),
        heading_deg_from_grid_north: +(((walker.heading % 360) + 360) % 360).toFixed(1), pitch_deg: +walker.pitch.toFixed(1),
        fov_vertical_deg: +fovYDeg(asp).toFixed(1), fov_horizontal_deg: +(2 * Math.atan(Math.tan(rad(fovYDeg(asp)) / 2) * asp) * 180 / Math.PI).toFixed(1),
        viewpoint: (ui.vpSel && ui.vpSel.value) || null });
    } else {
      const [E0, N1] = toEN(...screenToWorld(0, 0)), [E1, N0] = toEN(...screenToWorld(MV.w, MV.h)), [cE, cN] = toEN(MV.cx, MV.cz);
      Object.assign(m, { E: +cE.toFixed(2), N: +cN.toFixed(2), map_bounds: [+E0.toFixed(1), +N0.toFixed(1), +E1.toFixed(1), +N1.toFixed(1)],
        metres_per_css_px: +(1 / MV.s).toFixed(4), north: 'up' });
    }
    return m;
  }
  function localStamp() {   // the user's local time, for file names (meta.exported stays UTC)
    const d = new Date(), z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
  }
  function screenshot(download = true) {
    if (!loaded) return null;
    const walk = viewer.mode === 'walk' && G.gl && !G.lost;
    if (walk) { render3D(performance.now() / 1000); drawKeymap(); } else drawMap();
    const src = walk ? ui.gl : ui.map, dpr = MV.dpr || 1, W = src.width, H = src.height;
    const meta = viewMeta(), fs = Math.round(12 * dpr), lh = Math.round(fs * 1.45), pad = Math.round(10 * dpr);
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = `${fs}px system-ui, sans-serif`;
    const wrap = (text, w) => { const out = []; let line = ''; for (const word of String(text).split(' ')) { const t = line ? line + ' ' + word : word; if (g.measureText(t).width > w && line) { out.push(line); line = word; } else line = t; } if (line) out.push(line); return out; };
    const lines = [];
    lines.push(['b', `${scene.title || 'Kwu Tung North, December 1982'} -- prototype: unchecked and inferred elements are not evidence`]);
    if (walk) lines.push(['', `Eye at E ${meta.E.toFixed(1)}  N ${meta.N.toFixed(1)} (EPSG:2326, HK1980 Grid), ground ${meta.ground_mPD.toFixed(2)} mPD, eye ${meta.eye_mPD.toFixed(2)} mPD; facing ${pad3(Math.round(meta.heading_deg_from_grid_north) % 360)}° from grid north, pitch ${Math.round(meta.pitch_deg)}°; field of view ${meta.fov_horizontal_deg}° x ${meta.fov_vertical_deg}°`]);
    else lines.push(['', `Map centre E ${meta.E.toFixed(1)}  N ${meta.N.toFixed(1)} (EPSG:2326, HK1980 Grid), north up; view E ${meta.map_bounds[0]}-${meta.map_bounds[2]}, N ${meta.map_bounds[1]}-${meta.map_bounds[3]}; ${meta.metres_per_css_px} m per pixel at 1x`]);
    lines.push(['', `Epoch ${epochLabel()}: ${meta.epoch_note}. Build ${scene.built || '?'}; exported ${meta.exported}` + (meta.selected ? `; selected ${meta.selected}` : '') + (showPending ? '; features pending confirmation shown as white dotted outlines' : '')]);
    lines.push(['key', '']);
    for (const l of wrap(scene.credit_short || scene.credit || '', W - 2 * pad)) lines.push(['s', l]);   // the short credit on every export (CSDI terms)
    const wrapped = [];
    for (const [k, t] of lines) { if (k === 'key' || k === 's') wrapped.push([k, t]); else for (const l of wrap(t, W - 2 * pad)) wrapped.push([k, l]); }
    const band = pad * 2 + wrapped.length * lh;
    c.width = W; c.height = H + band;
    g.drawImage(src, 0, 0);
    const kp = walk ? keymapPlacement() : null;   // the view as it is: the key map too, where it is on screen
    if (kp) {
      g.drawImage(ui.keymap, kp.x, kp.y, kp.w, kp.h);
      g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = dpr; g.strokeRect(kp.x + dpr / 2, kp.y + dpr / 2, kp.w - dpr, kp.h - dpr);
    }
    g.fillStyle = '#16181a'; g.fillRect(0, H, W, band);
    let y = H + pad + fs;
    for (const [k, t] of wrapped) {
      g.font = `${k === 'b' ? 'bold ' : ''}${k === 's' ? Math.round(fs * 0.85) : fs}px system-ui, sans-serif`;
      g.fillStyle = k === 's' ? '#b9bec3' : '#f2f3f4';
      if (k === 'key') {
        let x = pad;
        for (const t2 of Object.values(TIERS)) { g.fillStyle = t2.hex; g.fillRect(x, y - fs + 2, fs, fs - 2); g.fillStyle = '#f2f3f4'; g.fillText(t2.label, x + fs + 4, y); x += fs + 14 + g.measureText(t2.label).width; }
        g.fillText(`colour = confidence tier; diagonal stripes = placeholder height ${placeholderText()} m; dots / dashed outline = unchecked`, x + 6, y);
      } else g.fillText(t, pad, y);
      y += lh;
    }
    const name = `kwutung1982_${viewer.mode}_E${Math.round(meta.E)}_N${Math.round(meta.N)}` + (walk ? `_h${pad3(Math.round(meta.heading_deg_from_grid_north) % 360)}` : '') +
      `_${localStamp()}.png`;
    const result = { name, width: c.width, height: c.height, meta };
    if (!download) { result.dataURL = c.toDataURL('image/png'); return result; }
    c.toBlob(async (blob) => {
      if (!blob) { hint('The screenshot could not be made in this browser.', 4000); return; }
      const bytes = pngWithText(await blob.arrayBuffer(), 'viewer_1982', JSON.stringify(meta));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      hint(`Saved ${name}: the view with its position (EPSG:2326), direction, epoch and credit`, 4000);
    }, 'image/png');
    return result;
  }
  // "Frame for overlay" (2026-10-24): the walk view alone at OVERLAY_W x OVERLAY_H px, the size of the Street View
  // canvas of viewpoints.json VP01 -- no band, key map, crosshair or hint -- to lay over the reference frame. The
  // horizontal field of view is the screen's (the frame's shape changes only how much shows above and below); the
  // position, direction and field of view travel in the PNG's text chunk, as in screenshot().
  function overlayFrame(download = true) {
    if (!loaded) return null;
    if (viewer.mode !== 'walk' || !G.gl || G.lost) { hint('The overlay frame is taken in the walk: choose a viewpoint, or click the map first.', 4000); return null; }
    const cv = ui.gl, w0 = cv.width, h0 = cv.height, hf0 = hfovSet, sel0 = selected, out = document.createElement('canvas');
    let meta;
    if (hfovSet === null) hfovSet = hfovDeg();   // the screen's horizontal field of view, for this frame only
    cv.width = OVERLAY_W; cv.height = OVERLAY_H;
    try {
      selected = null;                            // no selection highlight in the frame
      render3D(performance.now() / 1000);
      meta = Object.assign(viewMeta(), { frame: 'overlay', frame_px: [OVERLAY_W, OVERLAY_H], key_map: { shown: false } });   // fields of view at the frame's shape
      out.width = OVERLAY_W; out.height = OVERLAY_H;
      out.getContext('2d').drawImage(cv, 0, 0);
    } finally {
      selected = sel0; hfovSet = hf0; cv.width = w0; cv.height = h0;   // the next frame draws the screen again
    }
    const name = `kwutung1982_overlay_${meta.viewpoint ? meta.viewpoint + '_' : ''}E${Math.round(meta.E)}_N${Math.round(meta.N)}_h${pad3(Math.round(meta.heading_deg_from_grid_north) % 360)}` +
      `_${OVERLAY_W}x${OVERLAY_H}_${localStamp()}.png`;
    const result = { name, width: OVERLAY_W, height: OVERLAY_H, meta };
    if (!download) { result.dataURL = out.toDataURL('image/png'); return result; }
    out.toBlob(async (blob) => {
      if (!blob) { hint('The overlay frame could not be made in this browser.', 4000); return; }
      const bytes = pngWithText(await blob.arrayBuffer(), 'viewer_1982', JSON.stringify(meta));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      hint(`Saved ${name}: ${OVERLAY_W} x ${OVERLAY_H} px, field of view ${meta.fov_horizontal_deg}° x ${meta.fov_vertical_deg}°, no interface on it`, 4000);
    }, 'image/png');
    return result;
  }
  // the first-visit card: shown once per browser (storage can be blocked: then it shows each time), never in author mode
  function setupIntro() {
    if (!ui.intro) return;
    let seen = false;
    try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch (e) { /* blocked storage: show it */ }
    ui.intro.hidden = AUTHOR || seen;
    ui.introClose.addEventListener('click', closeIntro);
    ui.introHelp.addEventListener('click', () => { closeIntro(); toggleHelp(true); });
  }
  function closeIntro() {
    ui.intro.hidden = true;
    try { localStorage.setItem(INTRO_KEY, '1'); } catch (e) { /* not remembered */ }
  }
  function toggleHelp(show) {
    ui.help.hidden = show === undefined ? !ui.help.hidden : !show;
  }
  function togglePointerLock() {
    if (viewer.mode !== 'walk') { hint('Mouse-look works in the walk view: click the map to walk first.', 3500); return; }
    if (document.pointerLockElement === ui.gl) { document.exitPointerLock(); return; }
    try {
      const r = ui.gl.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => hint('The browser refused mouse-look here; drag to look instead.', 4000));
    } catch (err) {
      hint('Mouse-look is not available here; drag to look instead.', 4000);
    }
  }
  function bindMapInput() {
    const c = ui.map;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || viewer.mode !== 'map') return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: MV.cx, cz: MV.cz, moved: false, shift: e.shiftKey };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (viewer.mode !== 'map') return;
      const [X, Z] = clientToMap(e.clientX, e.clientY);
      MV.cursor = [X, Z];
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > CLICK_SLOP) drag.moved = true;
        if (drag.moved) {
          MV.cx = drag.cx - (e.clientX - drag.x) / MV.s;
          MV.cz = drag.cz - (e.clientY - drag.y) / MV.s;
          MV.dirty = true;
          hideTooltip();
          return;
        }
      }
      const hs = hotspotAt(X, Z);
      const hit = hs ? null : hitTest2D(X, Z);
      if (hs) showTooltip({ props: { name: `${(HOTSPOT_TYPES[hs.type] || {}).label || 'Photo'}: ${hs.filename}` }, id: hs.id, tierKey: hs.date }, e.clientX, e.clientY);
      else if (hit) showTooltip(hit, e.clientX, e.clientY); else hideTooltip();
      c.style.cursor = hit || hs ? 'pointer' : '';
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const click = !drag.moved && e.type === 'pointerup', shift = drag.shift || e.shiftKey;
      drag = null;
      c.classList.remove('dragging');
      if (click && loaded) { const [X, Z] = clientToMap(e.clientX, e.clientY); mapClick(X, Z, shift); }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => { MV.cursor = null; hideTooltip(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.0015;
      zoomMap(Math.exp(-e.deltaY * unit), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
  }
  function bindWalkInput() {
    const c = ui.gl;
    let drag = null;
    c.addEventListener('pointerdown', (e) => {
      if (viewer.mode !== 'walk' || e.button !== 0) return;
      if (document.pointerLockElement === c) { identifyAtCentre(); return; }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
      c.classList.add('dragging');
    });
    c.addEventListener('pointermove', (e) => {
      if (viewer.mode !== 'walk') return;
      if (document.pointerLockElement === c) { look(e.movementX * LOOK_LOCK, e.movementY * LOOK_LOCK); return; }
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
      drag.lx = e.clientX; drag.ly = e.clientY;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > CLICK_SLOP) drag.moved = true;
      if (drag.moved) look(dx * LOOK_DRAG, dy * LOOK_DRAG);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const click = !drag.moved && e.type === 'pointerup';
      drag = null;
      c.classList.remove('dragging');
      if (click) identifyAt(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ================================================================== resize and the frame loop
  function resizeAll() {
    needsResize = false;
    const r = ui.view.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const keep = MV.w > 1 ? screenToWorld(MV.w / 2, MV.h / 2) : null;
    MV.w = w; MV.h = h; MV.dpr = dpr;
    ui.map.width = Math.round(w * dpr); ui.map.height = Math.round(h * dpr);
    if (keep) { MV.cx = keep[0]; MV.cz = keep[1]; }
    MV.dirty = true;
    ui.gl.width = Math.round(w * dpr); ui.gl.height = Math.round(h * dpr);
  }
  function frame(t) {
    requestAnimationFrame(frame);
    if (G.broken) return;
    const dt = Math.min(0.1, Math.max(0, (t - lastT) / 1000));
    lastT = t;
    try {
      if (needsResize) resizeAll();
      if (viewer.mode === 'walk' && G.gl && !G.lost) {
        updateWalker(dt);
        render3D(t / 1000);
        drawKeymap();
        fpsFrames++;
        if (t - fpsT0 >= 1000) { fps = (fpsFrames * 1000) / (t - fpsT0); fpsFrames = 0; fpsT0 = t; }
      } else {
        fpsFrames = 0; fpsT0 = t;
        if (MV.dirty) drawMap();
      }
      if (t - lastStatus > 100) { lastStatus = t; updateStatus(); }
      if (!viewer.ready && viewer.loadMs === null && G.warm) {   // one full frame after the warm-up render
        viewer.ready = true;
        viewer.loadMs = Math.round(performance.now());
        ui.loading.hidden = true;
      }
    } catch (e) {
      G.broken = true;
      noteError(e);
    }
  }

  // ================================================================== start-up
  function grabUI() {
    const $ = (id) => document.getElementById(id);
    return {
      title: $('title'), devBadge: $('dev-badge'), btnMap: $('btn-map'), btnWalk: $('btn-walk'), btnLook: $('btn-look'),
      btnLegend: $('btn-legend'), btnHelp: $('btn-help'), view: $('view'), map: $('map'), gl: $('gl'), zoomIn: $('zoom-in'),
      zoomOut: $('zoom-out'), crosshair: $('crosshair'), tooltip: $('tooltip'), hint: $('hint'), loading: $('loading'),
      help: $('help'), helpClose: $('help-close'), side: $('side'), info: $('info'), infoTitle: $('info-title'),
      infoSub: $('info-sub'), infoMain: $('info-main'), infoMore: $('info-more'), infoMoreH: $('info-more-h'),
      infoClose: $('info-close'), legend: $('legend'), legendBody: $('legend-body'), status: $('status'),
      infoLater: $('info-later'), infoLaterH: $('info-later-h'), btnPending: $('btn-pending'), btnShot: $('btn-shot'),
      infoFig: $('info-fig'), infoImg: $('info-img'), infoCap: $('info-cap'), btnKeymap: $('btn-keymap'), keymap: $('keymap'),
      vpSel: $('vp-select'), fov: $('fov'), btnOverlay: $('btn-overlay'),
      infoPlain: $('info-plain'), infoFull: $('info-full'), intro: $('intro'), introClose: $('intro-close'), introHelp: $('intro-help'),
    };
  }
  async function getData(url, kind) {
    const res = await fetch(url, { cache: 'no-cache' });   // revalidate: a rebuild is never hidden by a cached copy
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return kind === 'json' ? res.json() : res.arrayBuffer();
  }
  async function loadImage(url) {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try { await img.decode(); } catch (e) { throw new Error(`${url}: the photograph could not be loaded or decoded`); }
    return img;
  }
  function checkScene(sc) {
    const need = (cond, what) => { if (!cond) throw new Error('scene.json: ' + what); };
    need(sc && sc.terrain && sc.ortho, 'terrain or ortho section missing');
    for (const k of ['nx', 'ny', 'cell_m', 'x0', 'y0', 'x1', 'y1']) need(Number.isFinite(Number(sc.terrain[k])), `terrain.${k} missing`);
    need(Array.isArray(sc.ortho.bounds) && sc.ortho.bounds.length === 4 && sc.ortho.bounds.every(Number.isFinite), 'ortho.bounds missing');
    need(sc.terrain.file && sc.ortho.file, 'terrain.file or ortho.file missing');
  }
  function geomPolys(g) {   // scene.pilot (GeoJSON Polygon / MultiPolygon) -> world polygons
    const rec = { polys: [], lines: [], points: [] };
    if (g) addGeometry(rec, g);
    return rec.polys;
  }
  async function start() {
    ui = grabUI();
    document.body.classList.toggle('author', AUTHOR);
    if (ui.infoFull) ui.infoFull.open = AUTHOR;
    bindUI();
    setupIntro();
    try {
      scene = await getData('data/scene.json', 'json');
      checkScene(scene);
      stamp = encodeURIComponent(scene.built || '');
      const WF = wallFinishes();
      waterImg = scene.water ? await loadImage(`${scene.water.file}?b=${stamp}`).catch((e) => { noteError(e); return null; }) : null;
      if (scene.ground_detail && scene.ground_detail.maps) {
        detailImgs = {};
        for (const [k, m] of Object.entries(scene.ground_detail.maps)) detailImgs[k] = await loadImage(`${m.file}?b=${stamp}`).catch(() => null);
      }
      const [tbuf, fc, img, hsj, imgCtx, vpj, ...finImgs] = await Promise.all([
        getData(scene.terrain.file, 'bin'),
        getData('data/features.geojson', 'json'),
        loadImage(`${scene.ortho.file}?b=${stamp}`),
        scene.hotspots_file ? getData(scene.hotspots_file, 'json').catch((e) => { noteError(e); return null; }) : null,
        scene.ortho_context ? loadImage(`${scene.ortho_context.file}?b=${stamp}`).catch((e) => { noteError(e); return null; }) : null,
        getData('data/viewpoints.json', 'json').catch(() => null),   // optional: no file, no viewpoint list
        ...WF.map((wf) => (wf.file ? loadImage(`${wf.file}?b=${stamp}`).catch((e) => { noteError(e); return null; }) : null)),
      ]);
      finishImgs = finImgs;
      eyeH = num(scene.settings && scene.settings.eye_height_m) || 1.6;
      walkSpeed = num(scene.settings && scene.settings.walk_speed_m_s) || 1.4;
      T = makeTerrain(scene.terrain, tbuf);
      photo = img;
      const b = scene.ortho.bounds;
      PR = { x0: b[0] - T.x0, z0: T.y1 - b[3], w: b[2] - b[0], h: b[3] - b[1] };
      if (scene.water) { const wb = scene.water.bounds; WR = { x0: wb[0] - T.x0, z0: T.y1 - wb[3], w: wb[2] - wb[0], h: wb[3] - wb[1] }; }
      pilot = geomPolys(scene.pilot);
      // the extension (2026-10-18), drawn with the same line: its boundary as proposed, overlapping the pilot's
      if (scene.extension && scene.extension.geometry) pilot = pilot.concat(geomPolys(scene.extension.geometry));
      if (imgCtx) { const cb = scene.ortho_context.bounds; photoCtx = imgCtx; PRC = { x0: cb[0] - T.x0, z0: T.y1 - cb[3], w: cb[2] - cb[0], h: cb[3] - cb[1] }; }
      hotspots = (hsj && Array.isArray(hsj.hotspots) ? hsj.hotspots : []).filter((h) => num(h.E) !== null && num(h.N) !== null)
        .map((h) => { const [x, z] = toWorld(num(h.E), num(h.N)); return Object.assign({}, h, { x, z }); });
      viewpoints = (vpj && Array.isArray(vpj.viewpoints) ? vpj.viewpoints : []).filter((v) => v && v.id && num(v.E) !== null && num(v.N) !== null);
      if (ui.vpSel) { for (const v of viewpoints) ui.vpSel.add(new Option(v.label || v.id, v.id)); ui.vpSel.hidden = !viewpoints.length; }
      if (window.KeyMap1982 && ui.keymap) {
        try {
          keymap = window.KeyMap1982.create({
            canvas: ui.keymap, photo: img, photoBounds: scene.ortho.bounds,
            context: imgCtx, contextBounds: imgCtx ? scene.ortho_context.bounds : null,
            fit: [T.x0, T.y1 - T.H, T.x0 + T.W, T.y1], pilot: scene.pilot,
            footprints: (fc.features || []).filter((f) => f.properties && f.properties.layer === 'buildings' && (f.properties.status || 'in model') === 'in model')
              .map((f) => ({ geometry: f.geometry, hex: (own(TIERS, f.properties.tier) ? TIERS[f.properties.tier] : NO_TIER).hex })),
            // a click moves the walker there, keeping the heading and looking level (the author, 2026-10-25: arriving
            // pitched at the ground is disorientating); inside a footprint, to the nearest free spot
            onClick: (E, N) => { if (viewer.mode === 'walk' && viewer.groundAt(E, N) != null) viewer.jumpTo(E, N, walker.heading, 0); },
            title: 'Key map: where you stand on the December 1982 photo, north up. Click to go there; scroll to zoom; M for the full map; K hides it',
          });
        } catch (e) { noteError(e); keymap = null; }
      }
      if (ui.btnKeymap) { ui.btnKeymap.setAttribute('aria-pressed', String(!!keymap && keymap.shown)); ui.btnKeymap.disabled = !keymap; }
      buildRecords(fc);
      buildCollision();
      buildPaths();
      setupTexts();
      MV.ctx = ui.map.getContext('2d');
      resizeAll();
      fitMap();
      const bb = polysBBox(pilot) || [0, 0, T.W, T.H];
      walker.x = (bb[0] + bb[2]) / 2; walker.z = (bb[1] + bb[3]) / 2;
      setMode('map');
      if (setupGL()) {
        render3D(0);   // warm-up: compiles, uploads and draws one 3D frame (in the hidden canvas)
        const err = G.gl.getError();
        if (err !== G.gl.NO_ERROR) noteError('WebGL error after the first frame: 0x' + err.toString(16));
        G.warm = true;
      }
      drawMap();
      loaded = true;
      requestAnimationFrame(frame);
      startFromHash();
    } catch (e) {
      noteError(e);
      ui.loading.textContent = 'The viewer could not start: ' + errText(e);
      ui.loading.classList.add('failed');
    }
  }

  // ================================================================== window.viewer: state and test hooks
  Object.assign(viewer, {
    // current walker / view state; E, N in EPSG:2326 metres, heights in mPD
    state() {
      if (!T) return { mode: viewer.mode, E: null, N: null, ground_m: null, eye_m: null, heading_deg: walker.heading, pitch_deg: walker.pitch, selected_id: selectedId(), fps };
      const [E, N] = toEN(walker.x, walker.z), g = T.bilinear(walker.x, walker.z);
      return { mode: viewer.mode, E, N, ground_m: g, eye_m: g + eyeNow(), heading_deg: walker.heading, pitch_deg: walker.pitch, selected_id: selectedId(), fps: Math.round(fps * 10) / 10, placed: walker.placed,
        eye_height_m: eyeNow(), hfov_deg: G.gl ? hfovDeg() : null, viewpoint: (ui.vpSel && ui.vpSel.value) || null };
    },
    // exactly what a single click at that map point does
    mapClickAt(E, N) { const [X, Z] = toWorld(E, N); if (viewer.mode !== 'map') setMode('map'); mapClick(X, Z, false); return viewer.state(); },
    // into the walk at (E, N), facing heading_deg (kept if omitted), pitch_deg optional (0);
    // a point inside a footprint or against a wall moves to the nearest free spot; eye_m (optional) is a fixed
    // viewpoint's eye height above the ground, until the walker moves
    jumpTo(E, N, heading_deg, pitch_deg, eye_m) {
      const [X, Z] = toWorld(E, N), p = nearestFree(X, Z);
      enterWalk(p[0], p[1], heading_deg === undefined ? walker.heading : heading_deg, pitch_deg || 0, eye_m);
      return viewer.state();
    },
    // a fixed viewpoint of data/viewpoints.json by id, as the dropdown does; the ids listed
    goToViewpoint(id) { return goToViewpoint(id); },
    viewpointIds() { return viewpoints.map((v) => v.id); },
    // horizontal field of view in degrees, as the FOV control sets it (null: the default, FOV_Y vertical)
    setFov(deg) { setHfov(deg === null ? null : num(deg)); return hfovSet; },
    // the "Frame for overlay" as it would be saved (no download): {name, width, height, meta, dataURL}
    overlayFrame() { return overlayFrame(false); },
    // 2D map view: centre on (E, N), optionally at px_per_m; returns the view
    mapView(E, N, px_per_m) {
      if (!loaded) return null;
      if (E !== undefined && N !== undefined) { const [X, Z] = toWorld(E, N); MV.cx = X; MV.cz = Z; }
      if (px_per_m !== undefined) MV.s = clamp(px_per_m, minScale(), MAP_MAX_SCALE);
      MV.dirty = true;
      const [cE, cN] = toEN(MV.cx, MV.cz);
      return { E: cE, N: cN, px_per_m: MV.s };
    },
    // ground height (mPD, bilinear) at (E, N); null outside the terrain
    groundAt(E, N) { if (!T) return null; const [X, Z] = toWorld(E, N); return T.inside(X, Z) ? T.bilinear(X, Z) : null; },
    // client (viewport CSS px) position of a map point, for real-click tests
    mapScreenOf(E, N) {
      const [X, Z] = toWorld(E, N), [sx, sy] = worldToScreen(X, Z), r = ui.map.getBoundingClientRect();
      return [r.left + sx, r.top + sy];
    },
    // identify the feature under a viewport point, as a click does (the info panel opens unless doSelect is false):
    // walk view -> GPU pick: feature id, 'terrain' or null; map view -> the 2D hit or null
    pickAt(clientX, clientY, doSelect = true) {
      if (viewer.mode === 'walk') return identifyAt(clientX, clientY, doSelect);
      const [X, Z] = clientToMap(clientX, clientY), hit = hitTest2D(X, Z);
      if (hit && doSelect) selectRec(hit);
      return hit ? hit.id : null;
    },
    select(id) {
      if (id === 'terrain') { selectTerrain(null); return true; }
      const rec = byId.get(String(id));
      if (!rec) return false;
      selectRec(rec);
      return true;
    },
    infoFields() { return infoFieldsNow ? Object.assign({}, infoFieldsNow) : null; },
    // the screenshot as it would be saved (no download): {name, width, height, meta, dataURL}
    screenshot() { return screenshot(false); },
    setPending(on) { if (!!on !== showPending) togglePending(); return showPending; },
    hotspotIds() { return hotspots.map((h) => h.id); },
    selectHotspot(id) { const h = hotspots.find((q) => q.id === id); if (!h) return false; selected = { type: 'hotspot', h }; renderInfo(); MV.dirty = true; return true; },
    // self-check of the draping: every draped vertex against the drawn terrain + its layer's lift (metres)
    drapeCheck() {
      if (!G.cpu) return null;
      const out = {};
      for (const L of G.cpu.layers) {
        const m = L.drape;
        if (!m.nv) continue;
        let worst = 0, sum = 0;
        for (let k = 0; k < m.nv; k++) {
          const o = k * STRIDE, d = Math.abs(m.v[o + 1] - (T.surface(m.v[o], m.v[o + 2]) + L.lift));
          worst = Math.max(worst, d); sum += d;
        }
        out[L.layer] = { vertices: m.nv, max_dev_m: worst, mean_dev_m: sum / m.nv, lift_m: L.lift };
      }
      return out;
    },
    // read-only figures for checks: counts, triangles, triangulation error, skipped features
    diagnostics() {
      const by = (fn) => recs.reduce((o, r) => { const k = fn(r); o[k] = (o[k] || 0) + 1; return o; }, {});
      return {
        features: recs.length, pending: pendingRecs.length, hotspots: hotspots.length, by_layer: by((r) => r.layer), by_tier: by((r) => r.tierKey || 'none'),
        by_check_status: by((r) => String(r.props.check_status)), skipped: skipped.slice(),
        triangles: G.stats.triangles || null, roof_area_max_rel_error: G.stats.roofAreaMaxRelError, mesh_ms: G.stats.meshMs,
        webgl2: !!G.gl, canvas: G.gl ? [G.gl.drawingBufferWidth, G.gl.drawingBufferHeight] : null,
      };
    },
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
