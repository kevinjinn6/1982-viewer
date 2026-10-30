// Hau Ku Shek Ancestral Hall and the Hung Shing / Pai Fung temples, modelled for the analogue view (mockup 2026-10-25,
// ported into the viewer the same day at the author's decision; tools/analogue_view.py installs it).
// Geometry from spec.json (make_spec.py: the 1:1000 sheets' outlines, the 2010 LiDAR roofs, the author's photographs
// of the fronts); surfaces from tex/ (make_textures.py: cut from the author's photographs of 1 Aug 2026, or drawn to
// their measurements). Replaces the flat blocks FP1883 (the hall) and FP583 (the temples) and drops FP1671 / FP1672,
// the hall's two courtyards that the tracing took for buildings (page_src.html leaves them out: HIDE_IDS).
import * as THREE from 'three';

const HERE = new URL('.', import.meta.url).href;
const wait = () => new Promise(r => { const t = () => (window.__dbg && window.viewer && window.viewer.ready) ? r() : setTimeout(t, 200); t(); });
await wait();
const TT = { start: performance.now() }, tick = k => (TT[k] = Math.round(performance.now() - TT.start));   // load timing (window.hallMockup.times)
const { scene } = window.__dbg, { CX, CY, VIEWS, setView } = window.__dbg.est;
const spec = await (await fetch(HERE + 'spec.json')).json();
const P = (E, N, y) => new THREE.Vector3(E - CX, y, CY - N);
const GROUND = scene.children.filter(o => o.name === 'terrain' || o.name === 'ring');
// the hall's front stood just past the map's edge (E 829 280 until 2026-10-26), on the coarse 5 m ground drawn outside
// it, which there lies 0.85 m above the 2010 DTM (forecourt 6.86-6.92 mPD on the long section): its points in front of
// the hall are lowered to the DTM, so the front stands on the measured street. Since the edge moved to E 829 450 the
// forecourt is the model's own ground (the 2010 DTM) and the ring there lies under it; this is kept for a pilot-only or
// older build
{
  const ring = GROUND.find(o => o.name === 'ring'), C = spec.hall.corners;
  const fm = [(C.front_north[0] + C.front_south[0]) / 2, (C.front_north[1] + C.front_south[1]) / 2], STREET_2010 = 6.92;
  if (ring) {
    const pos = ring.geometry.attributes.position; let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const E = pos.getX(i) + CX, N = CY - pos.getZ(i), d = Math.hypot(E - fm[0], N - fm[1]);
      if (d < 16 && pos.getY(i) > STREET_2010) { pos.setY(i, STREET_2010 + (pos.getY(i) - STREET_2010) * Math.max(0, (d - 9) / 7)); n++; }
    }
    pos.needsUpdate = true; ring.geometry.computeVertexNormals(); ring.geometry.computeBoundingSphere(); ring.geometry.computeBoundingBox();
    console.log('hall mockup: ring ground lowered at', n, 'points');
  }
}
// the ground under the two buildings, cut out of the terrain and ring meshes once: a ray against the whole terrain
// (2.5 million triangles) costs ~0.1 s, and the build casts ~500 -- 53 s with the page frozen, before this cut
function cutGround(cE, cN, r) {
  const out = [], v = new THREE.Vector3(), w = new THREE.Vector3(), x = P(cE, cN, 0);
  for (const m of GROUND) {
    m.updateMatrixWorld(); const p = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : p.count, id = j => idx ? idx.getX(j) : j;
    for (let i = 0; i < n; i += 3) {
      v.fromBufferAttribute(p, id(i)).applyMatrix4(m.matrixWorld);
      if (Math.abs(v.x - x.x) > r || Math.abs(v.z - x.z) > r) continue;
      out.push(v.x, v.y, v.z);
      for (const j of [1, 2]) { w.fromBufferAttribute(p, id(i + j)).applyMatrix4(m.matrixWorld); out.push(w.x, w.y, w.z); }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}
const LOCAL = (() => { const h = spec.hall.corners, t = spec.temple.corners, mid = c => Object.values(c).reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  return [cutGround(...mid(h), 40), cutGround(...mid(t), 32)]; })();
const rc = new THREE.Raycaster();
const groundAt = (E, N) => {                                          // the ground the page draws there
  rc.set(P(E, N, 500), new THREE.Vector3(0, -1, 0)); const h = rc.intersectObjects(LOCAL, false)[0];
  return h ? h.point.y : window.__dbg.est.groundAt(E, N);
};
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

tick('ground');
// ---- materials: a texture per surface, tiled by metres (tile = the metres one copy covers)
const loader = new THREE.TextureLoader();
const MAN = await (await fetch(HERE + 'tex/manifest.json')).json();
function tex(name, repeat = true) {
  const t = loader.load(HERE + 'tex/' + name + '.jpg'); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
const M = {}, TILE = {};
const mat = (k, o) => (M[k] = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide }, o)));
for (const [k, file, rough] of [['soffit', 'hall_soffit', 0.95], ['brick', 'hall_brick', 0.9], ['roof', 'hall_roof', 1.0], ['troof', 'temple_roof', 0.55], ['tbrick', 'temple_brick', 0.9],
                                ['ashlar', 'temple_ashlar', 0.85], ['granite', 'hall_steps', 0.85], ['sand', 'hall_base', 0.9]]) {
  mat(k, { map: tex(file), roughness: rough }); TILE[k] = MAN.textures[file].covers_m; M[k].userData.file = file;
}
M.brick.color.setScalar(0.42);                                    // the drawn brick read too light against IMG_5614
for (const k of ['hall_porch_wall', 'hall_frieze', 'hall_ridge', 'hall_pilaster', 'hall_column', 'hall_couplet_l', 'hall_couplet_r', 'hall_board',
                 'temple_hs_front', 'temple_pf_front', 'temple_hs_frieze', 'temple_pf_frieze', 'temple_hs_ridge', 'temple_screen', 'hall_platform',
                 'temple_pillar', 'temple_pillar_base', 'hall_block'])
{ mat(k, { map: tex(k, false), roughness: 0.85 }); M[k].userData.file = k; }
M.roof.envMapIntensity = 0.15;                                        // no sky sheen on the grey tiles
M.hall_ridge.map.wrapS = THREE.RepeatWrapping; M.hall_ridge.map.repeat.set(5.6, 1);   // a 2.2 m stretch, along the ~12.4 m ridge
mat('timber', { color: 0x3a2d24 }); mat('ridge', { color: 0x5f6466, roughness: 0.85 }); mat('tridge', { color: 0x9a4a2c, roughness: 0.7 });
mat('court', { color: 0x8f8d86 }); mat('gstone', { color: 0x5f5c57, roughness: 0.9 });   // the front's grey brackets and struts (IMG_5614, in the porch's shade)
 mat('stone', { color: 0xb9b6ae, roughness: 0.8 }); mat('dark', { color: 0x1d1a18 }); mat('door', { color: 0x2b2522, roughness: 0.7 }); mat('red', { color: 0x8c2c22 });

// ---- geometry collectors: one mesh per material and building, so a click knows which building it hit
const BUILD = {};
function G(b, k) { const g = (BUILD[b] = BUILD[b] || {}); return (g[k] = g[k] || { p: [], uv: [] }); }
// a quad A B C D (counter-clockwise from outside) with its own uvs
function quad(b, k, A, B, C, D, uA, uB, uC, uD) {
  const g = G(b, k);
  for (const [v, u] of [[A, uA], [B, uB], [C, uC], [A, uA], [C, uC], [D, uD]]) { g.p.push(v.x, v.y, v.z); g.uv.push(u[0], u[1]); }
}
// a vertical wall from ground point a to b, its foot y0 and top y1 (numbers or functions of t in 0..1), tiled by
// material k, or stretched once (whole: true) for a photo of the whole face
function wall(b, k, a, c, y0, y1, o = {}) {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = o.whole ? 1 : Math.max(1, Math.ceil(L / (o.step || 0.5)));
  const f0 = typeof y0 === 'function' ? y0 : () => y0, f1 = typeof y1 === 'function' ? y1 : () => y1, T = TILE[k] || [1, 1];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, p0 = lerp(a, c, t0), p1 = lerp(a, c, t1);
    const A = P(p0[0], p0[1], f0(t0)), B = P(p1[0], p1[1], f0(t1)), C = P(p1[0], p1[1], f1(t1)), D = P(p0[0], p0[1], f1(t0));
    if (o.whole) { const v0 = o.v0 ?? 0, v1 = o.v1 ?? 1; quad(b, k, A, B, C, D, [o.flip ? 1 : 0, v0], [o.flip ? 0 : 1, v0], [o.flip ? 0 : 1, v1], [o.flip ? 1 : 0, v1]); }
    else quad(b, k, A, B, C, D, [t0 * L / T[0], A.y / T[1]], [t1 * L / T[0], B.y / T[1]], [t1 * L / T[0], C.y / T[1]], [t0 * L / T[0], D.y / T[1]]);
  }
}
// a sloping roof plane: eave line e0-e1 at height ye, ridge line r0-r1 at yr; tiles run down the slope
function slope(b, k, e0, e1, ye, r0, r1, yr) {
  const W = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), S = Math.hypot(Math.hypot(r0[0] - e0[0], r0[1] - e0[1]), yr - ye), T = TILE[k];
  quad(b, k, P(e0[0], e0[1], ye), P(e1[0], e1[1], ye), P(r1[0], r1[1], yr), P(r0[0], r0[1], yr), [0, 0], [W / T[0], 0], [W / T[0], S / T[1]], [0, S / T[1]]);
}
// a box on a frame (origin o, unit vectors along u and v on the ground), from y0 to y1; faces tiled by k; face fi
// (0: the c0 side, run a0 -> a1; 3: the a0 side, run c1 -> c0) carries the whole-face material kf, mirrored if flip
function box(b, k, o, u, v, a0, a1, c0, c1, y0, y1, kf, flip, fi = 0) {
  const pt = (a, c, y) => P(o[0] + u[0] * a + v[0] * c, o[1] + u[1] * a + v[1] * c, y);
  const s = [[a0, c0], [a1, c0], [a1, c1], [a0, c1]];
  for (let i = 0; i < 4; i++) {
    const [p, q] = [s[i], s[(i + 1) % 4]], A = pt(p[0], p[1], y0), B = pt(q[0], q[1], y0), C = pt(q[0], q[1], y1), D = pt(p[0], p[1], y1);
    if (kf && (Array.isArray(fi) ? fi.includes(i) : i === fi)) quad(b, kf, A, B, C, D, [flip ? 1 : 0, 0], [flip ? 0 : 1, 0], [flip ? 0 : 1, 1], [flip ? 1 : 0, 1]);
    else { const L = Math.hypot(q[0] - p[0], q[1] - p[1]), T = TILE[k] || [1, 1]; quad(b, k, A, B, C, D, [0, y0 / T[1]], [L / T[0], y0 / T[1]], [L / T[0], y1 / T[1]], [0, y1 / T[1]]); }
  }
  const T = TILE[k] || [1, 1];
  quad(b, k, pt(a0, c0, y1), pt(a1, c0, y1), pt(a1, c1, y1), pt(a0, c1, y1), [a0 / T[0], c0 / T[1]], [a1 / T[0], c0 / T[1]], [a1 / T[0], c1 / T[1]], [a0 / T[0], c1 / T[1]]);
}
// a coping along a sloping wall top: from ground point a (foot at ya) to c (yc), width wd centred on the line, height ht
function coping(b, k, a, c, ya, yc, wd, ht) {
  const d = [c[0] - a[0], c[1] - a[1]], l = Math.hypot(...d), n = [-d[1] / l * wd / 2, d[0] / l * wd / 2];
  const v = (p, y, sg) => P(p[0] + n[0] * sg, p[1] + n[1] * sg, y);
  quad(b, k, v(a, ya + ht, 1), v(c, yc + ht, 1), v(c, yc + ht, -1), v(a, ya + ht, -1), [0, 0], [1, 0], [1, 1], [0, 1]);
  for (const sg of [1, -1]) quad(b, k, v(a, ya, sg), v(c, yc, sg), v(c, yc + ht, sg), v(a, ya + ht, sg), [0, 0], [1, 0], [1, 1], [0, 1]);
}
// an upswept end (a ridge's or a gable coping's): the band's section swept along a quarter curve rising `rise` over
// `run`, from point p (E, N, y) outward along direction d (unit, on the ground), thickness th across, height h
// horn: 'up' rises steeply first and leans over toward d (a gable coping's front end, IMG_5618), 'out' rises ever more
// steeply (a ridge's end); both taper to a point instead of turning upright at full thickness
function curl(b, k, p, d, th0, h, run, rise, steps = 6, horn = null) {
  const n = [-d[1], d[0]];
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, th = horn ? th0 * (1 - 0.65 * t) : th0, hh = h * (1 - (horn ? 0.75 : 0.35) * t);
    const a = horn === 'up' ? run * Math.pow(t, 1.6) : horn ? run * t : run * Math.sin(t * Math.PI / 2);
    const y = p[2] + (horn === 'up' ? rise * Math.pow(t, 0.75) : horn ? rise * t * t : rise * (1 - Math.cos(t * Math.PI / 2)));
    const E = p[0] + d[0] * a, N = p[1] + d[1] * a;
    const cur = [P(E + n[0] * th / 2, N + n[1] * th / 2, y), P(E - n[0] * th / 2, N - n[1] * th / 2, y),
                 P(E - n[0] * th / 2, N - n[1] * th / 2, y + hh), P(E + n[0] * th / 2, N + n[1] * th / 2, y + hh)];
    if (prev) for (let j = 0; j < 4; j++) quad(b, k, prev[j], cur[j], cur[(j + 1) % 4], prev[(j + 1) % 4], [0, 0], [1, 0], [1, 1], [0, 1]);
    prev = cur;
  }
}

tick('materials');
// ======================================================================================== the ancestral hall
{
  const h = spec.hall, C = h.corners, L = h.length_m, b = 'hall';
  // (s, w): s metres from the rear wall toward the front, w metres from the axis, north positive; the sheet's four
  // corners pinned (bilinear), so the walls stand on its line
  const edgeN = s => lerp(C.rear_north, C.front_north, s / L), edgeS = s => lerp(C.rear_south, C.front_south, s / L);
  const half = s => Math.hypot(edgeN(s)[0] - edgeS(s)[0], edgeN(s)[1] - edgeS(s)[1]) / 2;
  const H = (s, w) => { const n = edgeN(s), so = edgeS(s), m = lerp(so, n, 0.5); return lerp(m, n, w / half(s)); };
  const ax = (() => { const a = H(0, 0), c = H(L, 0), l = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; })();
  const nv = [-ax[1], ax[0]];                                        // north, across the axis
  // the traced plan is not a rectangle (its rear and front walls lie 3.5 deg apart, and neither is square to the
  // axis), so a line across the hall at s runs along across(s), not nv: ridges, cross walls and doors follow it
  const across = s => { const a = H(s, -half(s)), c = H(s, half(s)), l = Math.hypot(c[0] - a[0], c[1] - a[1]); return [(c[0] - a[0]) / l, (c[1] - a[1]) / l]; };
  const alongAt = s => { const v = across(s); return [v[1], -v[0]]; };   // square to across(s), toward the front
  const street = groundAt(...H(L + 1.5, 0)), gRear = groundAt(...H(0.5, 0)), base = Math.min(street, gRear) - 0.3;
  const F = h.front, Wf = half(L);
  h.halls[2].eave_front[1] = street + F.frieze[1] + 0.12;          // IMG_5614: the tiles' edge just above the frieze (the 2010 roof: within 0.15 m)
  // the roof over s: the halls' slopes, else null
  const roofY = s => { for (const x of h.halls) { const [es, ey] = s < x.ridge_s ? x.eave_back : x.eave_front;
    if ((s - es) * (s - x.ridge_s) <= 0) return x.ridge_mPD - (x.ridge_mPD - ey) * Math.abs(s - x.ridge_s) / Math.abs(es - x.ridge_s); } return null; };
  const courtOf = s => ['west', 'east'].find(k => s >= h.courtyards_from_roofs[k].s[0] - 0.01 && s <= h.courtyards_from_roofs[k].s[1] + 0.01);
  // side walls: tops follow each hall's roof (the gables, 0.25 m above the tiles) and the corridor roofs between
  const RH = h.halls[0], WOK = RH.ridge_mPD + 0.8;
  const wokEar = s => {                                              // a rounded arch from each eave end to the peak
    const [a, b] = RH.s, x = s < RH.ridge_s ? (RH.ridge_s - s) / (RH.ridge_s - a) : (s - RH.ridge_s) / (b - RH.ridge_s);
    const base = (s < RH.ridge_s ? RH.eave_back[1] : RH.eave_front[1]) + 0.35;
    return base + (WOK - base) * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, x), 2.4)), 1 / 2.4);
  };
  const sideTop = s => { if (s >= RH.s[0] - 0.01 && s <= RH.s[1] + 0.01) return wokEar(s);
    const c = courtOf(s); if (c && !h.halls.some(x => s > x.s[0] + 0.01 && s < x.s[1] - 0.01)) return h.corridor_roof_mPD[c][0] + 0.3;
    const r = roofY(s); return r == null ? h.corridor_roof_mPD.east[0] : r + 0.25; };
  for (const sg of [1, -1]) {
    const pts = []; for (let s = 0; s <= L + 1e-6; s += 0.25) pts.push(s);
    for (let i = 0; i < pts.length - 1; i++) {
      const s0 = pts[i], s1 = pts[i + 1], a = H(s0, sg * half(s0)), c = H(s1, sg * half(s1));
      wall(b, 'brick', a, c, base, t => sideTop(s0 + (s1 - s0) * t), { step: 1 });
      wall(b, 'granite', a, c, base, t => groundAt(...lerp(a, c, t)) + 0.45, { step: 1 });
    }
    // the coping along each gable, and its upswept front end on the entrance hall (IMG_5614: the curled corners)
    for (const x of h.halls) {
      const c0 = Math.max(x.s[0], 0) - 0.0, c1 = x.id === 'entrance' ? L : x.s[1];
      for (let s = c0; s < c1 - 1e-6; s += 0.25) {
        const s1 = Math.min(s + 0.25, c1), a = H(s, sg * (half(s) - 0.17)), c = H(s1, sg * (half(s1) - 0.17));
        coping(b, 'ridge', a, c, sideTop(s), sideTop(s1), 0.4, 0.22);
      }
      // the gable coping's front end rises into a horn, leaning back over the gable (IMG_5618, read at ~170 px/m,
      // +-30 %; the Pang hall's gable, AN50, has the same): 0.9 m up, its tip 0.5 m back
      if (x.id === 'entrance') { const p = H(L, sg * (half(L) - 0.17)), bk = [-alongAt(L)[0], -alongAt(L)[1]];
        curl(b, 'ridge', [p[0], p[1], sideTop(L - 0.01)], bk, 0.3, 0.3, 0.5, 0.9, 10, 'up'); }
    }
  }
  // the rear wall and the walls of each hall toward its courtyards, under the eaves (a closed door in the middle: estimated)
  // each wall rises to the underside of the roof it carries (before 2026-10-25 they stopped at the eave height, 0.37 m
  // short of the tiles above them, which overhang the wall)
  wall(b, 'brick', H(0, -half(0)), H(0, half(0)), base, roofY(0) - 0.04, { step: 1 });
  for (const s of [6.0, 10.1, 19.2, 24.3]) {
    const g = groundAt(...H(s, 0));
    wall(b, 'brick', H(s, -half(s)), H(s, half(s)), base, roofY(s) - 0.04, { step: 1 });
    box(b, 'door', H(s, 0), alongAt(s), across(s), -0.06, 0.06, -0.8, 0.8, g + 0.3, g + 2.9);
  }
  // roofs: two slopes per hall, tiles down the slope, from gable to gable
  for (const x of h.halls) {
    for (const [es, ey] of [x.eave_back, x.eave_front]) slope(b, 'roof', H(es, -half(es)), H(es, half(es)), ey, H(x.ridge_s, -half(x.ridge_s)), H(x.ridge_s, half(x.ridge_s)), x.ridge_mPD);
    // the ridge: a band along it; the entrance hall's front face is IMG_5614's ridge, the others plain
    // the ridge band on the slopes' apex line (it ran along nv before 2026-10-25, up to 1.3 m off the apex at its far
    // end). The rear hall's ridge stops against its wok-ear gables; the others sweep up at their ends
    const cr = across(x.ridge_s), r0 = H(x.ridge_s, -half(x.ridge_s) - 0.05), r1 = H(x.ridge_s, half(x.ridge_s) + 0.05), rl = Math.hypot(r1[0] - r0[0], r1[1] - r0[1]);
    box(b, 'ridge', r0, cr, [-cr[1], cr[0]], 0, rl, -0.16, 0.16, x.ridge_mPD - 0.05, x.ridge_mPD + x.ridge_band_m, x.id === 'entrance' ? 'hall_ridge' : null, false);
    // (the entrance hall's, IMG_5618: about 0.7 m up over 0.6 m)
    if (x.id !== 'rear') for (const sg of [1, -1]) { const e = H(x.ridge_s, sg * (half(x.ridge_s) - 0.2)), big = x.id === 'entrance';
      curl(b, 'ridge', [e[0], e[1], x.ridge_mPD + 0.05], [sg * cr[0], sg * cr[1]], 0.3, x.ridge_band_m, big ? 0.6 : 0.55, big ? 0.7 : 0.45, big ? 10 : 6, big ? 'out' : null); }
  }
  // courtyards: paved floor; corridors along both sides, lean-to roofs on granite posts (estimated from the 2010 heights)
  for (const k of ['west', 'east']) {
    const c = h.courtyards_from_roofs[k], [s0, s1] = c.s, [w0, w1] = c.w_from_axis, g = groundAt(...H((s0 + s1) / 2, 0)) + 0.12;
    quad(b, 'court', P(...H(s0, w0), g), P(...H(s1, w0), g), P(...H(s1, w1), g), P(...H(s0, w1), g), [0, 0], [1, 0], [1, 1], [0, 1]);
    const [hi, lo] = h.corridor_roof_mPD[k];
    for (const wi of [w1, w0]) {
      const sg = wi > 0 ? 1 : -1, wall_w = s => sg * half(s), lw = wi - sg * 0.4;
      // the lean-to's underside at (s, w): a straight slope from its low edge (lw, lo - 0.15) up to the side wall (hi)
      const under = (s, w) => lo - 0.15 + (hi - lo + 0.15) * (w - lw) / (wall_w(s) - lw) - 0.04;
      slope(b, 'roof', H(s0, lw), H(s1, lw), lo - 0.15, H(s0, wall_w(s0)), H(s1, wall_w(s1)), hi);
      if (k === 'east') {                                              // a side chamber: its wall to the courtyard, a door in it
        wall(b, 'brick', H(s0, wi), H(s1, wi), base, t => under(s0 + (s1 - s0) * t, wi), { step: 1 });
        const sm = (s0 + s1) / 2; box(b, 'door', H(sm, wi + sg * 0.02), alongAt(sm), across(sm), -0.5, 0.5, -0.04, 0.04, g, g + 2.2);
      } else {                                                         // granite posts under a timber beam that carries the rafters
        const wp = wi + sg * 0.15, bt = s => under(s, wp), BD = 0.24;
        for (let s = s0; s < s1 - 1e-6; s += 0.5) { const s2 = Math.min(s + 0.5, s1);
          box(b, 'timber', H(s, wp), alongAt(s), across(s), 0, s2 - s, -0.09, 0.09, Math.min(bt(s), bt(s2)) - BD, Math.min(bt(s), bt(s2))); }
        for (const s of [s0 + 0.12, (s0 + s1) / 2, s1 - 0.12]) box(b, 'granite', H(s, wp), alongAt(s), across(s), -0.12, 0.12, -0.12, 0.12, g - 0.1, bt(s) - BD);
      }
    }
  }
  // ---- the front (IMG_5614), built on the traced front line itself: a metres along it (south to north, = w), c metres
  // behind it. Before 2026-10-25 these pieces stood square to the axis, which the traced front is not (3.2 deg): the
  // south end stood 0.35 m proud of the gables and the north end 0.35 m inside them, and the south carved beam stopped
  // 0.15 m short of its column. Heights re-measured on IMG_5614 the same day (make_spec.py)
  const O = H(L, 0), fc = across(L), fa = [-alongAt(L)[0], -alongAt(L)[1]];
  const FP = (a, c, y) => P(O[0] + fc[0] * a + fa[0] * c, O[1] + fc[1] * a + fa[1] * c, y);
  const FG = (a, c) => [O[0] + fc[0] * a + fa[0] * c, O[1] + fc[1] * a + fa[1] * c];
  const FB = (k, a0, a1, c0, c1, y0, y1, kf, flip) => box(b, k, O, fc, fa, a0, a1, c0, c1, y0, y1, kf, flip, 0);   // face 0 = the front
  // a triangular bracket under a beam end: along the beam from aRoot to aTip at yTop, down the post to yBot
  const bracket = (k, aRoot, aTip, c0, c1, yTop, yBot) => {
    const pr = [[aRoot, yTop], [aTip, yTop], [aRoot, yBot]];
    for (const c of [c0, c1]) quad(b, k, FP(pr[0][0], c, pr[0][1]), FP(pr[1][0], c, pr[1][1]), FP(pr[2][0], c, pr[2][1]), FP(pr[2][0], c, pr[2][1]), [0, 0], [1, 0], [0, 1], [0, 1]);
    for (let i = 0; i < 3; i++) { const p = pr[i], q = pr[(i + 1) % 3]; quad(b, k, FP(p[0], c0, p[1]), FP(q[0], c0, q[1]), FP(q[0], c1, q[1]), FP(p[0], c1, p[1]), [0, 0], [1, 0], [1, 1], [0, 1]); }
  };
  // a turned piece about the vertical through (a, c): profile [[radius, height], ...] from the bottom
  const turned = (k, a, c, y, prof, n = 10) => {
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < n; i++) {
      const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2, [r0, h0] = prof[j], [r1, h1] = prof[j + 1];
      const v = (r, h, t) => FP(a + r * Math.cos(t), c + r * Math.sin(t), y + h);
      quad(b, k, v(r0, h0, t0), v(r0, h0, t1), v(r1, h1, t1), v(r1, h1, t0), [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    const [rt, ht] = prof[prof.length - 1];
    for (let i = 0; i < n; i++) { const t0 = i / n * Math.PI * 2, t1 = (i + 1) / n * Math.PI * 2;
      quad(b, k, FP(a, c, y + ht), FP(a + rt * Math.cos(t0), c + rt * Math.sin(t0), y + ht), FP(a + rt * Math.cos(t1), c + rt * Math.sin(t1), y + ht), FP(a, c, y + ht), [0, 0], [1, 0], [1, 1], [0, 1]); }
  };
  const Lp = L - F.porch_depth, fl = street + F.porch_floor_h, sp = street + F.side_platform_h, PD = F.porch_depth;
  // the porch has no ceiling (IMG_9053, looking up in the south bay): the roof is open to below -- rafters down the
  // slope and the tiles' undersides between them (the soffit, 0.15 m under the tiles' surface), on purlins along the
  // front, carried at each column line by a beam and short struts. under(c): the soffit's height c metres behind the front
  const RT = 0.15, under = c => roofY(L - c) - RT;
  const Wi = Wf - F.pilaster_w, cwc = F.centre_bay_w / 2 + F.column / 2, CD = F.column / 2 + 0.02;   // pilaster's inner face, column centre: along and behind the front
  for (const sg of [-1, 1]) {
    const A = (p, q) => [Math.min(sg * p, sg * q), Math.max(sg * p, sg * q)];     // a range on this side of the axis
    FB('sand', ...A(Wi, Wf), -0.02, 0.55, base, street + F.frieze[1] + 0.12, 'hall_pilaster', false);
    // the pilaster's head carried on up to the roof's underside (IMG_5618: the sandstone reaches the tiles)
    for (const [p0, p1] of [[[Wi, -0.02], [Wf, -0.02]], [[Wf, -0.02], [Wf, 0.55]], [[Wf, 0.55], [Wi, 0.55]], [[Wi, 0.55], [Wi, -0.02]]])
      wall(b, 'sand', FG(sg * p0[0], p0[1]), FG(sg * p1[0], p1[1]), street + F.frieze[1] + 0.1, t => under(p0[1] + (p1[1] - p0[1]) * t), { step: 1 });
    FB('granite', ...A(Wi, F.centre_bay_w / 2), 0, PD, base, sp, 'hall_platform', false);
    FB('granite', ...A(cwc - F.column / 2, cwc + F.column / 2), CD - F.column / 2, CD + F.column / 2, sp, street + F.frieze[0], 'hall_column', false);
    FB('red', ...A(cwc - 0.185, cwc + 0.185), 0.0, 0.018, sp + 0.2, sp + 2.55, sg < 0 ? 'hall_couplet_l' : 'hall_couplet_r', false);   // on the column's face
    // the side bay's carved beam, pilaster to column, framed into both on the column line (only the south one was
    // photographed square on; the north one repeats it mirrored), a grey bracket under each end; on it the carved
    // block, and on that the bowl-shaped strut that carries the frieze beam (IMG_5614)
    FB('timber', ...A(Wi, cwc), CD - 0.08, CD + 0.08, street + F.boards[0], street + F.boards[1], 'hall_board', sg > 0);
    bracket('gstone', sg * Wi, sg * (Wi - 0.3), CD - 0.05, CD + 0.05, street + F.boards[0], street + F.boards[0] - 0.24);
    bracket('gstone', sg * (cwc + F.column / 2), sg * (cwc + F.column / 2 + 0.28), CD - 0.05, CD + 0.05, street + F.boards[0], street + F.boards[0] - 0.22);
    const am = (Wi + cwc + F.column / 2) / 2;
    FB('timber', ...A(am - 0.37, am + 0.37), CD - 0.1, CD + 0.1, street + F.boards[1], street + F.block[1], 'hall_block', sg > 0);
    const bh = F.frieze[0] - F.block[1];
    turned('gstone', sg * am, CD, street + F.block[1], [[0.09, 0], [0.09, bh * 0.25], [0.2, bh * 0.45], [0.33, bh * 0.75], [0.37, bh]]);
    // the curved beam from the column's head back to the porch's back wall (the dark beam beside each column in
    // IMG_5614; its run and fall are estimated)
    const top = c => street + F.frieze[0] - 0.26 - 0.32 * Math.pow((c - CD) / (PD - CD), 2);
    for (let i = 0; i < 6; i++) { const c0 = CD + (PD - CD) * i / 6, c1 = CD + (PD - CD) * (i + 1) / 6, a0 = sg * cwc - 0.07, a1 = sg * cwc + 0.07, h = 0.24;
      const v = (a, c, y) => FP(a, c, y);
      quad(b, 'timber', v(a0, c0, top(c0)), v(a1, c0, top(c0)), v(a1, c1, top(c1)), v(a0, c1, top(c1)), [0, 0], [1, 0], [1, 1], [0, 1]);
      quad(b, 'timber', v(a0, c0, top(c0) - h), v(a1, c0, top(c0) - h), v(a1, c1, top(c1) - h), v(a0, c1, top(c1) - h), [0, 0], [1, 0], [1, 1], [0, 1]);
      for (const a of [a0, a1]) quad(b, 'timber', v(a, c0, top(c0) - h), v(a, c1, top(c1) - h), v(a, c1, top(c1)), v(a, c0, top(c0)), [0, 0], [1, 0], [1, 1], [0, 1]); }
  }
  FB('granite', -F.centre_bay_w / 2, F.centre_bay_w / 2, 0, PD, base, fl);                                   // the porch floor
  for (let i = 0; i < 3; i++) FB('granite', -F.steps_w / 2, F.steps_w / 2, -F.steps_out * (3 - i) / 3, 0, base, street + F.porch_floor_h * (i + 1) / 3 - 0.02);
  // the porch's back wall: the photo laid square on, south (left in the photo) to north, then brick up to the ceiling;
  // its side walls back to the pilasters
  wall(b, 'hall_porch_wall', FG(-Wi, PD), FG(Wi, PD), fl, fl + F.porch_wall_h, { whole: true });
  wall(b, 'brick', FG(-Wi, PD), FG(Wi, PD), fl + F.porch_wall_h - 0.02, under(PD), { step: 1 });
  for (const sg of [-1, 1]) wall(b, 'brick', FG(sg * Wi, PD), FG(sg * Wi, 0.55), base, t => under(PD + (0.55 - PD) * t), { step: 1 });
  // the carved frieze beam over the front, on the columns' heads (0.51 m deep: their centres are 0.17 m behind the
  // front line). Until 2026-10-25 a flat ceiling sat on it and a dark board closed the front up to the tiles; IMG_9053
  // shows neither
  FB('timber', -Wi, Wi, -0.15, 0.36, street + F.frieze[0], street + F.frieze[1], 'hall_frieze', false);
  // the soffit, from the eave's edge (the 2010 LiDAR: 1.1 m out) back to the porch wall, gable to gable
  { const e = h.halls[2].eave_front[0]; slope(b, 'soffit', H(e, -half(e)), H(e, half(e)), h.halls[2].eave_front[1] - RT, H(Lp, -half(Lp)), H(Lp, half(Lp)), under(PD)); }
  // purlins (0.18 m, dark timber; IMG_9053 shows three across the bay's depth: positions read by eye), the first on the
  // frieze beam; at each column line a beam from behind the frieze beam into the porch wall, and a strut up to each purlin
  const PUR = [0.12, 0.72, 1.32, 1.86], PS = 0.18;
  for (const c of PUR) FB('timber', -Wf, Wf, c - PS / 2, c + PS / 2, under(c) - PS, under(c));
  for (const sg of [-1, 1]) {
    const A = (p, q) => [Math.min(sg * p, sg * q), Math.max(sg * p, sg * q)];
    FB('timber', ...A(cwc - 0.08, cwc + 0.08), 0.36, PD, street + F.frieze[0], street + F.frieze[1]);
    for (const c of PUR) FB('timber', ...A(cwc - 0.06, cwc + 0.06), c - 0.06, c + 0.06, street + F.frieze[1], under(c) - PS + 0.01);
  }
  window.__hallFrame = { H, L, street, ax };
}

tick('hall');
// ======================================================================================== the two temples
{
  const t = spec.temple, C = t.corners, b = 'temple';
  const ux = (() => { const d = [C.front_east[0] - C.front_west[0], C.front_east[1] - C.front_west[1]], l = Math.hypot(...d); return [d[0] / l, d[1] / l]; })();
  const uy = (() => { const d = [C.back_west[0] - C.front_west[0], C.back_west[1] - C.front_west[1]], l = Math.hypot(...d); return [d[0] / l, d[1] / l]; })();
  const T = (x, y) => [C.front_west[0] + ux[0] * x + uy[0] * y, C.front_west[1] + ux[1] * x + uy[1] * y];
  const gF = groundAt(...T(8, -2)), base = Math.min(gF, t.ground_mPD.front) - 0.3, dado = gF + t.dado_h;
  const brickWall = (a, c, top) => { wall(b, 'ashlar', a, c, base, dado, { step: 1 }); wall(b, 'tbrick', a, c, dado, top, { step: 1 }); };
  // a hall: x0..x1 across the front, y0..y1 deep, ridge along x at ridge_y; gable side walls; the front face a photo
  function hall(x0, x1, H, front, frieze, ridgeTex) {
    const [y0, y1] = H.y, ry = H.ridge_y, roof = y => y < ry ? H.ridge_mPD - (H.ridge_mPD - H.eave_front[1]) * (ry - y) / (ry - H.eave_front[0])
                                                       : H.ridge_mPD - (H.ridge_mPD - H.eave_back[1]) * (y - ry) / (H.eave_back[0] - ry);
    // side walls run 0.05 m past each end, closing the 0.1 m slits that the spec's gaps between halls left in them
    for (const x of [x0, x1]) for (let y = y0 - 0.05; y < y1 + 0.05 - 1e-6; y += 0.5) { const ya = y, yb = Math.min(y + 0.5, y1 + 0.05);
      wall(b, 'ashlar', T(x, ya), T(x, yb), base, dado, { step: 1 }); wall(b, 'tbrick', T(x, ya), T(x, yb), dado, s => roof(ya + (yb - ya) * s) + 0.15, { step: 1 }); }
    brickWall(T(x0, y1), T(x1, y1), roof(y1) - 0.04);                  // every wall up to the tiles' underside
    if (front) {
      wall(b, front, T(x0, y0), T(x1, y0), gF, gF + t.front_tex_h, { whole: true });
      wall(b, 'tbrick', T(x0, y0), T(x1, y0), gF + t.front_tex_h, H.eave_front[1], { step: 1 });
      wall(b, frieze, T(x0, y0 - 0.03), T(x1, y0 - 0.03), H.eave_front[1] - 0.32, H.eave_front[1] - 0.02, { whole: true });
      wall(b, 'timber', T(x0, y0), T(x1, y0), H.eave_front[1], roof(y0) - 0.04, { step: 1 });   // eave boards above the frieze
    } else brickWall(T(x0, y0), T(x1, y0), roof(y0) - 0.04);
    for (const [ey, eh] of [H.eave_front, H.eave_back]) slope(b, 'troof', T(x0 - 0.15, ey), T(x1 + 0.15, ey), eh, T(x0 - 0.15, ry), T(x1 + 0.15, ry), H.ridge_mPD);
    box(b, 'tridge', T(x0 - 0.15, ry), ux, uy, 0, x1 - x0 + 0.3, -0.13, 0.13, H.ridge_mPD - 0.05, H.ridge_mPD + 0.32, ridgeTex, false);
    for (const [x, d] of [[x0 + 0.05, [-ux[0], -ux[1]]], [x1 - 0.05, ux]]) { const e = T(x, ry); curl(b, 'tridge', [e[0], e[1], H.ridge_mPD], d, 0.26, 0.3, 0.6, 0.55); }
    // the gables' copings sweep up at the front (IMG_5665)
    if (front) for (const x of [x0, x1]) { const e = T(x, y0); curl(b, 'tridge', [e[0], e[1], roof(y0) + 0.15], [-uy[0], -uy[1]], 0.26, 0.22, 0.55, 0.6); }
  }
  const HS = t.hung_shing, PF = t.pai_fung;
  hall(HS.x[0], HS.x[1], HS.front_hall, 'temple_hs_front', 'temple_hs_frieze', 'temple_hs_ridge');
  hall(HS.x[0], HS.x[1], HS.main_hall, null, null, null);
  hall(PF.x[0], PF.x[1], PF.front_hall, 'temple_pf_front', 'temple_pf_frieze', 'temple_hs_ridge');
  hall(t.rear_range.x[0], t.rear_range.x[1], t.rear_range, null, null, null);
  // Pai Fung's courtyard (open), its corridors along both sides
  { const c = PF.courtyard, g = groundAt(...T((c.x[0] + c.x[1]) / 2, (c.y[0] + c.y[1]) / 2)) + 0.12;
    quad(b, 'court', P(...T(c.x[0], c.y[0]), g), P(...T(c.x[1], c.y[0]), g), P(...T(c.x[1], c.y[1]), g), P(...T(c.x[0], c.y[1]), g), [0, 0], [1, 0], [1, 1], [0, 1]);
    for (const [xi, xo] of [[c.x[0], PF.x[0]], [c.x[1], PF.x[1]]]) { brickWall(T(xo, c.y[0] - 0.1), T(xo, c.y[1] + 0.1), 11.3);
      slope(b, 'troof', T(xi, c.y[0]), T(xi, c.y[1]), 11.0, T(xo, c.y[0]), T(xo, c.y[1]), 11.45); } }
  // the passage: granite pillars, the relief screen wall at the back, granite steps up to it
  const Ps = t.passage;
  for (const x of Ps.pillars_x) { const q = T(x, 0.35);
    box(b, 'stone', q, ux, uy, -0.25, 0.25, -0.25, 0.25, gF - 0.2, gF + 0.62, 'temple_pillar_base', false, 0);
    box(b, 'stone', q, ux, uy, -0.17, 0.17, -0.17, 0.17, gF + 0.62, gF + Ps.pillar_h, 'temple_pillar', false, [0, 1, 2, 3]); }
  wall(b, 'temple_screen', T(Ps.x[0] + 0.1, Ps.screen_y), T(Ps.x[1] - 0.1, Ps.screen_y), gF + 0.4, gF + 0.4 + Ps.screen_h, { whole: true });
  box(b, 'troof', T(Ps.x[0] + 0.05, Ps.screen_y), ux, uy, 0, Ps.x[1] - Ps.x[0] - 0.1, -0.25, 0.25, gF + 0.4 + Ps.screen_h, gF + 0.4 + Ps.screen_h + 0.3);
  box(b, 'court', T(Ps.x[0], Ps.screen_y + 0.25), ux, uy, 0, Ps.x[1] - Ps.x[0], 0, t.rear_range.y[0] - Ps.screen_y - 0.25, gF + 2.75, gF + 2.95);   // the kitchen's roof
  for (let i = 0; i < 3; i++) box(b, 'granite', T(Ps.x[0], 1.6 + i * 0.7), ux, uy, 0, Ps.x[1] - Ps.x[0], 0, 4.0 - 1.6 - i * 0.7 + 0.2, base, gF + 0.13 * (i + 1));
}

tick('temples');
// ---- objects as photographed on 1 Aug 2026, modelled: the hall's two lanterns (IMG_5614: about 0.85 m across, in
// the side bays) and the two incense burners in front of the temples (IMG_5665: a bronze tripod cauldron under a
// gilt canopy on a red hexagonal plinth). Not in the 1982 evidence: whether they, or others like them, stood there then
// is not known. Sizes read off the photos to about +-20 %
const OBJ = new THREE.Group(); OBJ.name = 'objects_2026';
const red = new THREE.MeshStandardMaterial({ color: 0xc42a1f, roughness: 0.55, emissive: 0x2a0503 });
const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14a, roughness: 0.4, metalness: 0.7 });
const bronze = new THREE.MeshStandardMaterial({ color: 0x8d6b3a, roughness: 0.45, metalness: 0.65 });
const plinth = new THREE.MeshStandardMaterial({ color: 0xd9735c, roughness: 0.85 });
const yel = new THREE.MeshStandardMaterial({ color: 0xe8b52c, roughness: 0.7 });
function lantern(pos, d, cordTop) {
  const g = new THREE.Group(), r = d / 2, prof = [];
  for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + Math.PI * i / 16; prof.push(new THREE.Vector2(Math.max(0.16 * r, r * Math.cos(a)), 0.78 * r * Math.sin(a))); }
  g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 24), red));
  for (const y of [0.78 * r, -0.78 * r]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * r, 0.2 * r, 0.06, 16), gold); c.position.y = y; g.add(c); }
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.04, 0.32, 10), yel); t.position.y = -0.78 * r - 0.19; g.add(t);
  if (cordTop) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, cordTop - pos.y - 0.78 * r, 4), gold); c.position.y = (cordTop - pos.y + 0.78 * r) / 2; g.add(c); }
  g.position.copy(pos); OBJ.add(g);
}
function burner(E, N, y, rot) {
  const g = new THREE.Group();
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.14, 6), plinth); hex.position.y = 0.07; g.add(hex);
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3, l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.7, 8), bronze);
    l.position.set(Math.cos(a) * 0.3, 0.49, Math.sin(a) * 0.3); g.add(l); }
  const prof = []; for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + Math.PI * 0.85 * i / 12; prof.push(new THREE.Vector2(0.42 * Math.cos(a) + 0.02, 0.32 * Math.sin(a))); }
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), bronze); pot.position.y = 1.12; g.add(pot);
  for (const sg of [1, -1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 12), bronze); h.position.set(sg * 0.47, 1.25, 0); h.rotation.y = Math.PI / 2; g.add(h); }
  for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + i * Math.PI / 2, p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.85, 6), gold);
    p.position.set(Math.cos(a) * 0.36, 1.78, Math.sin(a) * 0.36); g.add(p); }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.42, 4, 1, true), gold); roof.position.y = 2.38; roof.rotation.y = Math.PI / 4; g.add(roof);
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), gold); fin.position.y = 2.66; g.add(fin);
  g.position.copy(P(E, N, y)); g.rotation.y = rot; OBJ.add(g);
}
{ const { H, L, street } = window.__hallFrame, F = spec.hall.front;
  for (const sg of [-1, 1]) { const q = H(L - 1.0, sg * 3.4); lantern(P(q[0], q[1], street + 3.42), 0.85, street + F.frieze[0] - 0.05); } }
{ const t = spec.temple.corners, ux = [t.front_east[0] - t.front_west[0], t.front_east[1] - t.front_west[1]], uy = [t.back_west[0] - t.front_west[0], t.back_west[1] - t.front_west[1]];
  const lx = Math.hypot(...ux), ly = Math.hypot(...uy), T = (x, y) => [t.front_west[0] + ux[0] / lx * x + uy[0] / ly * y, t.front_west[1] + ux[1] / lx * x + uy[1] / ly * y];
  for (const [x, y] of [[1.35, -2.5], [16.05, -2.8]]) { const q = T(x, y); burner(q[0], q[1], groundAt(q[0], q[1]), 0); } }
OBJ.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.hall = 'objects'; } });
scene.add(OBJ);

// ---- meshes, picking, views
const INFO = {
  hall: { title: spec.hall.name, src: Object.assign({}, spec.hall.src, {
            layout: 'three halls, two courtyards; side chambers at the front courtyard; a two-storey rear hall with wok-ear (鑊耳) gables (S50 EIA record DM01, 2012; S51 government description, 2003)',
            'wok-ear gables': 'shape from S51; their height is estimated (0.8 m above the ridge): the 2010 LiDAR reads the wall tops 0.35 m above it, its 0.5 m cells mixing the thin wall with the roof',
            'porch and front': "framing from the author's IMG_5614 (front), IMG_9053 (the porch roof from below: no ceiling, rafters and tiles on purlins) and IMG_5618 (the corner: the gable's horn, the ridge's curled ends); purlin positions, bracket and strut shapes and the beams back from the columns estimated. Cross-checked against the Pang ancestral hall, Fanling Wai (AN49, AN50: analogue, not evidence for this hall)",
            restorations: 'restored in 1992 and 2001 (S52): tiles and bricks replaced, doors repainted, carvings restored. The surfaces here are after both; in 1982 the hall would have looked older and more worn' }),
          extra: spec.hall.note_west_courtyard },
  temple: { title: spec.temple.name, src: Object.assign({}, spec.temple.src, {
            layout: 'two temples, each two halls with a courtyard (Hung Shing\'s covered by its altars), linked by a kitchen built in the 1960s (S50, S53); Pai Fung moved here in 1937',
            '1982 walls': 'a 1964 renovation plastered much of the walls (S53): in 1982 they may have been plastered, not the bare brick photographed in 2026' }) },
  objects: { title: 'Lantern / incense burner, as photographed in 2026', src: { what: "modelled after the author's IMG_5614 (the hall's two lanterns) and IMG_5665 (the temples' two incense burners), 1 Aug 2026; sizes read off the photos to about +-20 %", '1982': 'not in the 1982 evidence: whether these, or others like them, stood here then is not known' } },
};
const group = new THREE.Group(); group.name = 'hall_mockup';
for (const [bname, mats] of Object.entries(BUILD)) for (const [k, g] of Object.entries(mats)) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M[k]); m.castShadow = m.receiveShadow = true; m.userData.hall = bname; group.add(m);
}
scene.add(group);
// ---- the look: the surfaces as photographed in 2026, or aged to an inferred 1982 (tex1982/, make_textures_1982.py:
// paint faded and carvings worn before the 1992 / 2001 restorations, S52; the temples' brick under the 1964 plaster,
// S53). The 2026 lanterns and burners are hidden in the 1982 look: nothing says they stood there then
const COL26 = {}, COL82 = { red: 0x6e3b31, tridge: 0x7d5444, ridge: 0x4f5254, court: 0x7a786f, timber: 0x30271f };
let LOOK = '2026';
function setLook(look) {
  LOOK = look;
  for (const [k, m] of Object.entries(M)) {
    if (k in COL82) { COL26[k] = COL26[k] ?? m.color.getHex(); m.color.setHex(look === '1982' ? COL82[k] : COL26[k]); }
    const f = m.userData.file; if (!f) continue;
    m.userData.t26 = m.userData.t26 || m.map;
    if (look === '1982' && !m.userData.t82) {
      const t = loader.load(HERE + 'tex1982/' + f + '.jpg'), o = m.userData.t26; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      t.wrapS = o.wrapS; t.wrapT = o.wrapT; t.repeat.copy(o.repeat); t.offset.copy(o.offset); m.userData.t82 = t;
    }
    m.map = look === '1982' ? m.userData.t82 : m.userData.t26; m.needsUpdate = true;
  }
  OBJ.visible = look !== '1982';
}
const SURF = {
  '2026': "cut from the author's photographs of 1 Aug 2026: this building as it is today, after its restorations; its 1982 surfaces are not recorded",
  '1982': "INFERRED 1982 look: the 2026 photographs aged by what the sources say -- paint faded and carvings worn before the 1992 / 2001 restorations (S52); on the temples, the brick under the plaster of the 1964 renovation (S53). Which walls were plastered, and how far the paint had faded, is not known: the amounts are a judgement. No photograph from before 1992 has been seen",
};
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
(window.__pickExtra = window.__pickExtra || []).push(ray => {
  const hit = ray.intersectObjects([group, OBJ], true)[0]; if (!hit) return null;
  const I = INFO[hit.object.userData.hall];
  return { d: hit.distance, html: `<b>${esc(I.title)}</b> <span class="tag t-sourced">plan and heights sourced</span><table>` +
    Object.entries(I.src).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') +
    (hit.object.userData.hall === 'objects' ? '' : `<tr><td>surfaces</td><td>${esc(SURF[LOOK])}</td></tr>`) +
    (I.extra ? `<tr><td>note</td><td>${esc(I.extra)}</td></tr>` : '') + `</table>` };
});
// views: square on to the hall's front at eye height, and from above
{
  const { H, L } = window.__hallFrame, hf = H(L + 16, 0), hc = H(L, 0), ha = H(L * 0.35 - 14, -34);
  const bear = (a, c) => (THREE.MathUtils.radToDeg(Math.atan2(c[0] - a[0], c[1] - a[1])) + 360) % 360;
  // the dropdown's entries are in views.json (2026-10-25: grouped; of the temples only Pai Fung's front, centred); the
  // hall's two take their exact camera from the frame here, label and group kept from views.json
  const aim = (v) => { const o = VIEWS.find(x => x.id === v.id); if (o) Object.assign(o, v, { label: o.label, group: o.group }); else VIEWS.push(v); };
  aim({ id: 'hall_front', label: 'Hau Ku Shek Ancestral Hall', E: hf[0], N: hf[1], bearing: bear(hf, hc), hfov: 62, eye_m: 1.6, pitch: 4 });
  aim({ id: 'hall_air', label: 'Hau Ku Shek Ancestral Hall, from above', E: ha[0], N: ha[1], bearing: bear(ha, H(L / 2, 0)), hfov: 55, eye_m: 0, y_mPD: 34, pitch: -34 });
}
// which look (the author, 2026-10-25): the floating bar of view buttons and the "Surfaces" button are gone -- the views
// are in the dropdown -- and the toolbar's "2026 additions (not 1982)" switch chooses the look: on, the buildings as
// photographed in 2026 with their lanterns and burners; off (the default), the inferred 1982 look. ?look=2026 starts on
{
  const sw = document.getElementById('o_2026');
  if (new URLSearchParams(location.search).get('look') === '2026' && sw) sw.checked = true;
  setLook(sw && sw.checked ? '2026' : '1982');
  if (sw) sw.addEventListener('change', () => setLook(sw.checked ? '2026' : '1982'));
}
tick('end');
window.hallMockup = { ready: true, meshes: group.children.length, times: TT, tris: group.children.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0) };
console.log('hall mockup:', group.children.length, 'meshes');
