/* keymap.js -- the key map in the top-right corner of the walk (viewer_1982): where the walker
 * stands on the December 1982 photograph, north up, with the way they face and the field of view.
 *
 * Shared by the evidence view (viewer.js) and the analogue view (analogue/index.html, built from
 * tools/photoreal_mockup.html by tools/analogue_view.py). Plain script, no libraries, nothing
 * fetched: the host passes the images it has already loaded (data/ortho_1982.jpg and
 * data/ortho_1982_context.jpg, written by build_viewer.py). The only global is window.KeyMap1982.
 *
 * Everything here is EPSG:2326 metres (E, N) and degrees clockwise from grid north, so it does not
 * depend on either view's local frame. Zoom 1 shows the whole terrain extent and stays still (a key
 * plan: the walker can never leave it); zooms 2 and 4 follow the walker, held inside that extent.
 * The wheel over the map zooms; a click calls the host's onClick(E, N) with the clicked point in
 * EPSG:2326, and both views move the walker there, keeping the heading (2026-10-18; it used to open the
 * full map in the evidence view and step the zoom in the analogue view). A click outside the terrain
 * extent does nothing. K (bound by the host) shows or hides it; the choice is remembered per browser,
 * shared by both views.
 */
(() => {
  'use strict';
  const BASE_M_PX = 0.5;        // the baked background, metres per pixel (the context photo's own resolution)
  const ZOOMS = [1, 2, 4];
  const PAD = 0.04;             // zoom 1: this much of the extent's span left round it
  const CONE_PX = 30;           // radius of the view cone, CSS px
  const PREF = 'viewer_1982.keymap';   // localStorage: '0' hidden, anything else shown

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function readPref() { try { return window.localStorage.getItem(PREF) !== '0'; } catch (e) { return true; } }
  function writePref(on) { try { window.localStorage.setItem(PREF, on ? '1' : '0'); } catch (e) { /* private window: not remembered */ } }
  function rgba(hex, a) {
    const h = String(hex || '#ffffff').replace('#', '');
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  function ringsOf(g) {   // GeoJSON Polygon / MultiPolygon -> [ring, ...] (holes drawn even-odd)
    if (!g) return [];
    if (g.type === 'Polygon') return g.coordinates;
    if (g.type === 'MultiPolygon') return [].concat(...g.coordinates);
    return [];
  }
  function niceLength(target) {
    let L = 1;
    for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (s <= target) L = s;
    return L;
  }

  /* o = {
   *   canvas,                         the <canvas> to draw in (its CSS size decides the map's size)
   *   photo, photoBounds,             the Dec 1982 photo and its [E0, N0, E1, N1]
   *   context, contextBounds,         optional: the wider, coarser photo behind it (dimmed, as on the 2D map)
   *   fit,                            [E0, N0, E1, N1] the walker can never leave (the terrain extent)
   *   pilot,                          GeoJSON Polygon / MultiPolygon of the pilot zone
   *   footprints,                     optional [{geometry, hex}]: building outlines in the host's colours
   *   onClick,                        optional: onClick(E, N) on a click inside `fit`, EPSG:2326 (default: the next zoom)
   *   title,                          optional: the tooltip
   * } */
  function create(o) {
    const cv = o.canvas, ctx = cv.getContext('2d');
    let overlays = [];            // setOverlays: the host's polygons
    const fit = o.fit.map(Number);
    const B = o.contextBounds ? [Math.min(o.contextBounds[0], fit[0]), Math.min(o.contextBounds[1], fit[1]),
      Math.max(o.contextBounds[2], fit[2]), Math.max(o.contextBounds[3], fit[3])] : o.photoBounds.slice();
    const pilotRings = ringsOf(o.pilot);
    let zi = 0, last = '', shown = readPref(), at = null;
    cv.hidden = !shown;

    // the background, baked once: context photo dimmed, the photo, the footprints
    const base = document.createElement('canvas');
    base.width = Math.ceil((B[2] - B[0]) / BASE_M_PX); base.height = Math.ceil((B[3] - B[1]) / BASE_M_PX);
    {
      const g = base.getContext('2d'), put = (img, b) => g.drawImage(img, (b[0] - B[0]) / BASE_M_PX, (B[3] - b[3]) / BASE_M_PX,
        (b[2] - b[0]) / BASE_M_PX, (b[3] - b[1]) / BASE_M_PX);
      g.fillStyle = '#2a2d30'; g.fillRect(0, 0, base.width, base.height);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      if (o.context && o.contextBounds) { g.globalAlpha = 0.55; put(o.context, o.contextBounds); g.globalAlpha = 1; }
      if (o.photo) put(o.photo, o.photoBounds);
      g.lineJoin = 'round';
      for (const f of o.footprints || []) {
        const p = new Path2D();
        for (const r of ringsOf(f.geometry)) {
          r.forEach(([E, N], i) => (i ? p.lineTo : p.moveTo).call(p, (E - B[0]) / BASE_M_PX, (B[3] - N) / BASE_M_PX));
          p.closePath();
        }
        g.fillStyle = rgba(f.hex, 0.42); g.fill(p, 'evenodd');
        g.strokeStyle = rgba(f.hex, 0.95); g.lineWidth = 1.6; g.stroke(p);
      }
    }

    function view(S) {   // css px per metre and the centre, for the walker at `at`
      const z = ZOOMS[zi], span = Math.max(fit[2] - fit[0], fit[3] - fit[1]);
      const s = (S / (span * (1 + 2 * PAD))) * z, half = S / 2 / s;
      let cE = (fit[0] + fit[2]) / 2, cN = (fit[1] + fit[3]) / 2;
      if (z > 1 && at) {
        cE = fit[2] - fit[0] > 2 * half ? clamp(at.E, fit[0] + half, fit[2] - half) : cE;
        cN = fit[3] - fit[1] > 2 * half ? clamp(at.N, fit[1] + half, fit[3] - half) : cN;
      }
      return { s, half, cE, cN };
    }

    function draw(E, N, heading, hfov) {
      if (Number.isFinite(E) && Number.isFinite(N)) at = { E, N, heading: heading || 0, hfov: hfov || 60 };
      if (!shown || !at) return;
      const S = cv.clientWidth, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!S) return;
      const key = [at.E.toFixed(2), at.N.toFixed(2), at.heading.toFixed(1), at.hfov.toFixed(1), zi, S, dpr].join();
      if (key === last) return;
      last = key;
      const W = Math.round(S * dpr);
      if (cv.width !== W || cv.height !== W) { cv.width = W; cv.height = W; }
      const v = view(S), toS = (e, n) => [(e - v.cE) * v.s + S / 2, (v.cN - n) * v.s + S / 2];
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#2a2d30'; ctx.fillRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      const sx = (v.cE - v.half - B[0]) / BASE_M_PX, sy = (B[3] - v.cN - v.half) / BASE_M_PX, sw = (2 * v.half) / BASE_M_PX;
      ctx.drawImage(base, sx, sy, sw, sw, 0, 0, S, S);
      // pilot zone: white under a dark dash, as on the 2D map
      const pp = new Path2D();
      for (const r of pilotRings) { r.forEach(([e, n], i) => { const [x, y] = toS(e, n); (i ? pp.lineTo : pp.moveTo).call(pp, x, y); }); pp.closePath(); }
      ctx.lineJoin = 'round';
      ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2.6; ctx.stroke(pp);
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke(pp); ctx.setLineDash([]);
      // the host's overlays (setOverlays): fills first, then outlines over a dark halo so they read on the grey photo
      for (const pass of ['fill', 'stroke']) for (const ov of overlays) {
        if (!ov[pass]) continue;
        const op = new Path2D();
        for (const poly of ov.polys || []) for (const r of poly) {
          r.forEach(([e, n], i) => { const [x, y] = toS(e, n); (i ? op.lineTo : op.moveTo).call(op, x, y); }); op.closePath();
        }
        if (pass === 'fill') { ctx.fillStyle = ov.fill; ctx.fill(op, 'evenodd'); continue; }
        if (ov.halo !== false) { ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = (ov.width || 1.5) + 2; ctx.stroke(op); }
        ctx.strokeStyle = ov.stroke; ctx.lineWidth = ov.width || 1.5; ctx.stroke(op);
      }
      // the walker: the field of view, the heading, the spot
      const [wx, wy] = toS(at.E, at.N), h = at.heading * Math.PI / 180, half = (at.hfov / 2) * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(wx, wy);
      ctx.arc(wx, wy, CONE_PX, h - Math.PI / 2 - half, h - Math.PI / 2 + half);   // canvas angles: 0 = east, clockwise
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.42)'; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + Math.sin(h) * 16, wy - Math.cos(h) * 16);
      ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
      ctx.beginPath(); ctx.arc(wx, wy, 5, 0, 2 * Math.PI);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#111'; ctx.stroke();
      // north (the map is always north up) and a scale bar
      ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(20,22,24,0.78)'; ctx.beginPath(); ctx.arc(15, 17, 11, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(19, 15); ctx.lineTo(11, 15); ctx.closePath(); ctx.fill();
      ctx.fillText('N', 15, 21.5);
      const L = niceLength((S * 0.32) / v.s), w = L * v.s, x = 9, y = S - 10;
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.font = '10px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(20,22,24,0.78)'; ctx.fillRect(x - 4, y - 12, w + 12 + ctx.measureText(`${L} m`).width, 18);
      ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, 3);
      ctx.fillStyle = '#000'; ctx.fillRect(x, y, w / 2, 3);
      ctx.fillStyle = '#fff'; ctx.fillText(`${L} m`, x + w + 5, y + 3.5);
    }

    function zoomBy(dir) {
      const n = clamp(zi + (dir > 0 ? 1 : -1), 0, ZOOMS.length - 1);
      if (n !== zi) { zi = n; last = ''; draw(); }
      return ZOOMS[zi];
    }
    function cycleZoom() { zi = (zi + 1) % ZOOMS.length; last = ''; draw(); return ZOOMS[zi]; }
    function setShown(on) {
      shown = !!on; cv.hidden = !shown; writePref(shown); last = '';
      if (shown) draw();
      return shown;
    }

    cv.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); zoomBy(-e.deltaY); }, { passive: false });
    cv.addEventListener('pointerdown', (e) => e.stopPropagation());
    // the clicked point in EPSG:2326, from the view as last drawn; null outside the terrain extent
    function pointAt(e) {
      const S = cv.clientWidth;
      if (!S) return null;
      const r = cv.getBoundingClientRect(), v = view(S);
      const E = v.cE + (e.clientX - r.left - S / 2) / v.s, N = v.cN - (e.clientY - r.top - S / 2) / v.s;
      return E >= fit[0] && E <= fit[2] && N >= fit[1] && N <= fit[3] ? [E, N] : null;
    }
    cv.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!o.onClick) { cycleZoom(); return; }
      const p = pointAt(e);
      if (p) o.onClick(p[0], p[1]);
    });
    cv.style.cursor = o.onClick ? 'crosshair' : '';
    cv.title = o.title || 'Key map: where you stand on the December 1982 photo, north up. Click to go there; scroll to zoom; K hides it';

    return {
      draw, zoomBy, cycleZoom, setShown,
      // [{polys: [[ring, hole, ...], ...] in E, N; fill: css colour; stroke: css colour; width: px; halo: false}], drawn over the
      // photo and the pilot zone, under the walker (2026-10-21: the analogue view's story puts each chapter's layers here); [] clears
      setOverlays(list) { overlays = Array.isArray(list) ? list : []; last = ''; draw(); },
      toggle() { return setShown(!shown); },
      get shown() { return shown; },
      get zoom() { return ZOOMS[zi]; },
      redraw() { last = ''; draw(); },
      canvas: cv,
    };
  }

  window.KeyMap1982 = { create };
})();
