// Lady Ho Tung Welfare Centre (Main Block, Bungalow, covered walkway, latrine, the longitudinal block) as in Dec 1982.
// Ported from work/mockup/viewer_lhtwc/ on 2026-10-30 (the author: "port into the viewer", HIA dimensions, "faded").
// Geometry from spec.json (viewer_1982/lhtwc/make_spec.py: the HIA's dimensions taken as facts, placed on the sheet
// 2-SE-9B's north-west corner, the 2010 LiDAR heights; ?plan=sheet draws the sheet's own outlines FP2617-FP2619).
// Windows and doors are modelled (frames, leaves, bars, glass, panels), pane layouts read off the author's IMG_5518 and
// IMG_5537; only the name panel over the entrance is a photograph. Surfaces: tex1982/ (the 2026 photos faded, inferred),
// ?look=2026 the photos as taken. Nothing from the HIA's pages is shown (reference-only). Installed by
// tools/analogue_view.py install_lhtwc, which leaves out the plain blocks FP2617, FP2618, FP2619.
import * as THREE from 'three';

const HERE = new URL('.', import.meta.url).href;
const wait = () => new Promise(r => { const t = () => (window.__dbg && window.viewer && window.viewer.ready) ? r() : setTimeout(t, 200); t(); });
await wait();
const T0 = performance.now();
const { scene } = window.__dbg, { CX, CY, VIEWS } = window.__dbg.est;
const spec = await (await fetch(HERE + 'spec.json')).json();
const MAN = await (await fetch(HERE + 'tex/manifest.json')).json();
const Q = new URLSearchParams(location.search);
const PLAN_ID = spec.plans[Q.get('plan')] ? Q.get('plan') : spec.plan_default,   // HIA by default (the author, 2026-10-30)
      PL = spec.plans[PLAN_ID];
const FR = spec.frame;
const EN = (a, b) => [FR.origin[0] + FR.u[0] * a + FR.v[0] * b, FR.origin[1] + FR.u[1] * a + FR.v[1] * b];
const V3 = (a, b, y) => { const [E, N] = EN(a, b); return new THREE.Vector3(E - CX, y, CY - N); };

// ---- the ground, cut once from the terrain meshes around the site (the hall's lesson: never raycast the full terrain
// repeatedly -- 2.5 M triangles, ~0.1 s a ray)
const GROUND = scene.children.filter(o => o.name === 'terrain' || o.name === 'ring');
function cutGround(cE, cN, r) {
  const out = [], v = new THREE.Vector3(), w = new THREE.Vector3(), x = new THREE.Vector3(cE - CX, 0, CY - cN);
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
const LOCAL = [cutGround(...EN(19, -9), 36)];
const rc = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0);
const ground = (a, b) => { const p = V3(a, b, 500); rc.set(p, DOWN); const h = rc.intersectObjects(LOCAL, false)[0];
  return h ? h.point.y : window.__dbg.est.groundAt(...EN(a, b)); };
const TCUT = Math.round(performance.now() - T0);

// ---- materials
const loader = new THREE.TextureLoader();
const M = {}, TILE = {};
// the look (the author, 2026-10-30: "faded"): tex1982/ = the 2026 surfaces faded and weathered (make_textures_1982.py,
// inferred: the 1982 colours are not recorded); ?look=2026 shows the surfaces as photographed
const LOOK = Q.get('look') === '2026' ? '2026' : '1982', TEXDIR = LOOK === '2026' ? 'tex/' : 'tex1982/';
function tex(name, rep) { const t = loader.load(HERE + TEXDIR + name + '.jpg'); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }
const mat = (k, o) => (M[k] = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide }, o)));
// (tiles.jpg and head.jpg are no longer drawn since 2026-11-06: the roof's rolls and the brick heads are modelled)
for (const k of ['render', 'plinth', 'sill']) { mat(k, { map: tex(k, true) }); TILE[k] = MAN.textures[k].covers_m; }
for (const k of ['win_main', 'win_bung', 'win_bung_narrow', 'door_bung', 'door2', 'entrance']) mat(k, { map: tex(k, false), roughness: 0.6 });
const G = MAN.granite_rgb || [144, 134, 124], hex = c => (c[0] << 16) | (c[1] << 8) | c[2];
mat('granite', { color: LOOK === '2026' ? hex(G) : 0x8f877b, roughness: 0.95 });   // 1982: dulled, weathered (inferred)
// (2026-11-06: these two had sat behind the comment above since the port, so the soffits and gutters drew in three's
// default unlit white -- the bright slab under every eave)
mat('soffit', { color: 0x6f7679 }); mat('gutter', { color: 0x5d6466, roughness: 0.6 });
mat('cap', { color: 0x5c6163 }); mat('gable', { color: 0xe6dfcf }); mat('floor', { color: 0x8e5e4c }); mat('court', { color: 0x8a6656 });
mat('ceiling', { color: 0xd9d3c5 }); mat('iron', { color: 0x3a3f43, roughness: 0.5, metalness: 0.4 }); mat('concrete', { color: 0xb7b2a8 });
mat('garage', { color: 0x4a4038 }); mat('band', { color: 0x8f3a2c }); mat('capwhite', { color: 0xece8de }); mat('reveal', { color: 0xcfc6b0 });
mat('pending', { color: 0xa8a49a });
// ---- the roof and the window heads, modelled (2026-11-06, the author: the eaves "should be actually modeled" -- walked
// close, the painted pan-and-roll texture and the window heads cut from the oblique IMG_5537 read as flat strips and
// sloping hoods). Colours: pan and roll = the medians of tex(1982)/tiles.jpg's reddish and grey pixels (themselves the
// medians of IMG_5518's roof, make_textures.py); brick = tex(1982)/sill.jpg's red (the heads are the sills' brick, lit
// face on); joint drawn. Rolls read off IMG_5518 along the Bungalow's north eave (~83 px/m): ~0.3 m apart, ~0.18 m
// wide; the course (0.25 m) and the taper are drawing defaults.
const RC = LOOK === '2026' ? { pan: 0x644142, roll: 0x61605e, brick: 0x78372f, joint: 0xb3a998 } : { pan: 0x4f3c39, roll: 0x4e4c48, brick: 0x5d3630, joint: 0x8f877a };
const ROLL = { pitch: 0.3, course: 0.25, r0: 0.09, r1: 0.08, F: 5 };
{ // the pans between the rolls: their colour, a little shade down the middle of each channel, a lap line every course
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(RC.pan).getHexString(); g.fillRect(0, 0, 64, 64);
  const gr = g.createLinearGradient(0, 0, 64, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 56, 64, 4); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 60, 64, 4);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  mat('pan', { map: t, roughness: 0.8 }); TILE.pan = [ROLL.pitch, ROLL.course];
}
mat('roll', { color: RC.roll, roughness: 0.7 }); mat('brick', { color: RC.brick, roughness: 0.9 }); mat('joint', { color: RC.joint, roughness: 0.95 });
// joinery colours matched to the photo textures (2026-10-30, the author: "match the photo textures more"): rendered on
// the shaded north front beside tex/win_main + door_bung (work/viewer_1982/lhtwc_shots/compare_joinery_*.jpg), the
// first values (sampled straight off the textures) came out bluer and darker -- the sky light on a shaded face -- and
// the glass near-black against the photo's grey panes and amber obscure rows. These base colours are set so the north
// front renders as the photo does (paint halfway, so sunlit faces do not turn beige); glass non-metallic, so it no
// longer mirrors the blue sky. 1982 values follow tex1982/ (the same pixels faded).
const C = LOOK === '2026' ? { paint: 0x8c8c8e, glass: 0x5a5a54, obscure: 0x8c7b62 } : { paint: 0x848074, glass: 0x55534d, obscure: 0x847760 };
mat('paint', { color: C.paint, roughness: 0.75 });
// glass see-through since the interior (2026-10-30): clear panes faint, obscure panes translucent
mat('glass', { color: C.glass, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false });
mat('obscure', { color: C.obscure, roughness: 0.55, transparent: true, opacity: 0.7, depthWrite: false });
// ---- the interior's materials (2026-10-30): drawn colours, tier inferred (no photograph of the interior is the author's;
// the HIA's photos are reference-only). A small emissive term stands in for light bounced indoors -- a rendering aid,
// not a lamp: with the sun and sky alone the rooms under the roof render near black
const imat = (k, c, o = {}) => mat(k, Object.assign({ color: c, emissive: c, emissiveIntensity: 0.2 }, o));
imat('plaster', 0xe2dccd); imat('iceil', 0xd6ccb8); imat('ifloor', 0x9a958b); imat('terrazzo', 0xb4ab9b, { roughness: 0.4 });
imat('skirt', 0x8e8b84); imat('dadocap', 0x2b2e2f, { roughness: 0.3 }); imat('cornice', 0xebe5d6); imat('isill', 0x7b5b3f);
imat('fsur', 0x5f6f66, { roughness: 0.3 }); imat('fhole', 0x151311, { emissiveIntensity: 0 }); imat('hearth', 0x5d5650); imat('mantel', 0x5b3f2b); imat('fibre', 0xcdc4ae);
{ // the glazed dado: white tiles, 0.15 m, grey joints (drawn; the tiles' size is inferred)
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d');
  g.fillStyle = '#efefe9'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#b9b9b2'; g.fillRect(0, 0, 64, 2); g.fillRect(0, 0, 2, 64);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  imat('dado', 0xffffff, { map: t, roughness: 0.25, emissive: 0x7a7a76 }); TILE.dado = [0.15, 0.15];
}

// ---- geometry collectors: one mesh per (part, material)
const BUILD = {};
const coll = (part, k) => { const g = (BUILD[part] = BUILD[part] || {}); return (g[k] = g[k] || { p: [], uv: [] }); };
function tri(part, k, A, B, C, uA, uB, uC) { const g = coll(part, k); for (const [v, u] of [[A, uA], [B, uB], [C, uC]]) { g.p.push(v.x, v.y, v.z); g.uv.push(u[0], u[1]); } }
function quad(part, k, A, B, C, D, uA = [0, 0], uB = [1, 0], uC = [1, 1], uD = [0, 1]) { tri(part, k, A, B, C, uA, uB, uC); tri(part, k, A, C, D, uA, uC, uD); }
// a convex polygon of local points [a, b, y], uv(p) per vertex
function poly(part, k, pts, uv) { const v = pts.map(p => V3(...p)), u = pts.map(uv); for (let i = 1; i < pts.length - 1; i++) tri(part, k, v[0], v[i], v[i + 1], u[0], u[i], u[i + 1]); }
// a vertical face from local point p to q (a, b), between heights y0 and y1 (numbers), tiled by TILE[k] or stretched once
function face(part, k, p, q, y0, y1, whole = false, off = 0) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 1e-6) return;
  const nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;                             // outward for clockwise walls
  const P0 = [p[0] + nx * off, p[1] + ny * off], Q0 = [q[0] + nx * off, q[1] + ny * off];
  const T = TILE[k] || [1, 1];
  // a whole photo: walls run clockwise, so seen from outside they run right to left -- the image is laid mirrored back
  // wound Q0 -> P0 so the front face looks outward (a back face outward misled the viewer's AO pass: halos by the openings)
  if (whole) quad(part, k, V3(...Q0, y0), V3(...P0, y0), V3(...P0, y1), V3(...Q0, y1), [0, 0], [1, 0], [1, 1], [0, 1]);
  else quad(part, k, V3(...Q0, y0), V3(...P0, y0), V3(...P0, y1), V3(...Q0, y1), [L / T[0], y0 / T[1]], [0, y0 / T[1]], [0, y1 / T[1]], [L / T[0], y1 / T[1]]);
}
// a box on the local frame: a0..a1, b0..b1, y0..y1
function box(part, k, a0, a1, b0, b1, y0, y1) {
  const c = [[a0, b1], [a1, b1], [a1, b0], [a0, b0]];
  for (let i = 0; i < 4; i++) face(part, k, c[i], c[(i + 1) % 4], y0, y1);
  const T = TILE[k] || [1, 1];
  poly(part, k, [[a0, b0, y1], [a1, b0, y1], [a1, b1, y1], [a0, b1, y1]], p => [p[0] / T[0], p[1] / T[1]]);
  poly(part, k, [[a0, b0, y0], [a1, b0, y0], [a1, b1, y0], [a0, b1, y0]], p => [p[0] / T[0], p[1] / T[1]]);
}
// a square tube between two 3D local points (hip and ridge capping, gutters)
function tube(part, k, p, q, w, h) {
  const A = V3(...p), B = V3(...q), d = B.clone().sub(A), up = new THREE.Vector3(0, 1, 0);
  const s = d.clone().cross(up).normalize().multiplyScalar(w / 2), t = s.clone().cross(d).normalize().multiplyScalar(h);
  const c = [A.clone().sub(s), A.clone().add(s), A.clone().add(s).add(t), A.clone().sub(s).add(t)];
  const e = c.map(x => x.clone().add(d));
  for (let i = 0; i < 4; i++) quad(part, k, c[i], c[(i + 1) % 4], e[(i + 1) % 4], e[i]);
}
// ---- smooth meshes with their own normals (2026-11-06: the roof's rolls, the gutters), one per (part, material).
// Points are local [a, b, h]; each triangle is wound to agree with its normals (the local frame is mirrored into the
// scene, and a double-sided material flips the normal of a face seen from its back -- rolls would light inside out)
const SM = {};
const vn = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); }, vx = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const vadd = (...vs) => vs.reduce((p, q) => p.map((x, i) => x + q[i])), vmul = (v, k) => v.map(x => x * k);
function stri(part, k, A, B, C) {
  const P = [A, B, C].map(([p]) => V3(...p)), N = [A, B, C].map(([p, n]) => V3(p[0] + n[0], p[1] + n[1], p[2] + n[2]).sub(V3(...p)).normalize());
  const g = new THREE.Vector3().subVectors(P[1], P[0]).cross(new THREE.Vector3().subVectors(P[2], P[0]));
  const o = g.dot(N[0].clone().add(N[1]).add(N[2])) < 0 ? [0, 2, 1] : [0, 1, 2];
  const c = ((SM[part] = SM[part] || {})[k] = SM[part][k] || { p: [], n: [] });
  for (const i of o) { c.p.push(P[i].x, P[i].y, P[i].z); c.n.push(N[i].x, N[i].y, N[i].z); }
}
// one run of roll tiles up a slope: from P0 on the eave line, plan direction D up the slope, plan length len; each course
// a half-round tapering from r0 to r1, so every lap shows as a step, closed at its lower end. clip(a, b, h) true = this
// point lies under another roof (the Bungalow's overlapping wings): the run stops there
function rollRun(part, P0, D, len, He, s, clip = null) {
  const step = ROLL.course / Math.hypot(1, s), S = vn([D[0], D[1], s]), Hs = [-D[1], D[0], 0];
  let N = vx(Hs, S); if (N[2] < 0) N = vmul(N, -1);
  const axis = d => [P0[0] + D[0] * d, P0[1] + D[1] * d, He + s * d + 0.004], back = vmul(S, -1);
  const ring = (c, r) => { const o = []; for (let j = 0; j <= ROLL.F; j++) { const t = Math.PI * j / ROLL.F, n = vadd(vmul(Hs, Math.cos(t)), vmul(N, Math.sin(t))); o.push([vadd(c, vmul(n, r)), n]); } return o; };
  if (clip && clip(...axis(0.02))) return;
  for (let d0 = 0; d0 < len - 0.02; d0 += step) {
    let d1 = Math.min(d0 + step, len), stop = false;
    if (clip && clip(...axis(d1))) { let lo = d0, hi = d1; for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (clip(...axis(m))) hi = m; else lo = m; } d1 = lo; stop = true; }
    if (d1 - d0 > 0.02) {
      const A = axis(d0), ra = ring(A, ROLL.r0), rb = ring(axis(d1), ROLL.r0 - (ROLL.r0 - ROLL.r1) * (d1 - d0) / step);
      for (let j = 0; j < ROLL.F; j++) { stri(part, 'roll', ra[j], rb[j], rb[j + 1]); stri(part, 'roll', ra[j], rb[j + 1], ra[j + 1]); }
      for (let j = 0; j < ROLL.F; j++) stri(part, 'roll', [A, back], [ra[j][0], back], [ra[j + 1][0], back]);   // the lap
    }
    if (stop) break;
  }
}
// a half-round gutter (A-14) along local p -> q, its lips at height y, run on past both ends by its radius so the
// corners close; replaces the square tube (2026-11-06)
function trough(part, p, q, y, r = 0.08) {
  const D = vn([q[0] - p[0], q[1] - p[1], 0]), Hs = [-D[1], D[0], 0], F = 8;
  const P = [p[0] - D[0] * r, p[1] - D[1] * r, y], Qp = [q[0] + D[0] * r, q[1] + D[1] * r, y];
  const ring = c => { const o = []; for (let j = 0; j <= F; j++) { const t = Math.PI * j / F, n = vadd(vmul(Hs, Math.cos(t)), [0, 0, -Math.sin(t)]); o.push([vadd(c, vmul(n, r)), n]); } return o; };
  const ra = ring(P), rb = ring(Qp);
  for (let j = 0; j < F; j++) { stri(part, 'gutter', ra[j], rb[j], rb[j + 1]); stri(part, 'gutter', ra[j], rb[j + 1], ra[j + 1]); }
  for (const sd of [1, -1]) { const L0 = vadd(P, vmul(Hs, sd * r)), L1 = vadd(Qp, vmul(Hs, sd * r)); tube(part, 'gutter', L0, L1, 0.022, 0.022); }   // the rolled lips
}

// a box along a wall: at(s) is the wall's line, (nx, ny) its outward normal; s0..s1 along it, d0..d1 out of it
const obox = (at, nx, ny) => (part, k, s0, s1, y0, y1, d0, d1) => {
  const P = (s, d) => { const p = at(s); return [p[0] + nx * d, p[1] + ny * d]; }, v = (p, y) => V3(p[0], p[1], y);
  const a = P(s0, d1), b = P(s1, d1), c = P(s1, d0), e = P(s0, d0);
  quad(part, k, v(b, y0), v(a, y0), v(a, y1), v(b, y1));                       // front
  quad(part, k, v(a, y0), v(e, y0), v(e, y1), v(a, y1)); quad(part, k, v(c, y0), v(b, y0), v(b, y1), v(c, y1));   // ends
  quad(part, k, v(a, y1), v(e, y1), v(c, y1), v(b, y1)); quad(part, k, v(e, y0), v(a, y0), v(b, y0), v(c, y0));   // top, bottom
};
// ---- windows and doors, modelled (2026-10-30: the photographs laid flat in the openings read skewed -- IMG_5537 is
// oblique -- so the joinery is built: frame, transom, leaves, glazing bars, glass, raised panels). Pane layouts read off
// the author's photos; depths and bar widths are drawing defaults (inferred). Depth d: 0 = wall face, the reveal -0.12.
const J = {
  win_main: { fan: 0.31, fanGrid: [4, 2], leaves: 2, grid: [2, 4], obscure: 2, src: 'IMG_5537: fanlight 4 x 2 over two casements of 2 x 4, obscure glass in the lower two rows' },
  win5: { fan: 0.22, fanGrid: [4, 1], leaves: 2, grid: [2, 3], obscure: 1, src: 'IMG_5518: fanlight over two casements of square panes, obscure glass below' },
  win6: { fan: 0.2, fanGrid: [1, 1], leaves: 1, grid: [2, 4], obscure: 1, src: 'IMG_5518: the narrow one-leaf window' },
  win_small: { fan: 0, leaves: 1, grid: [2, 2], obscure: 2, src: 'inferred: a high toilet window, obscure glass' },
  door: { fan: 0.17, fanGrid: [3, 1], leaves: 1, grid: [3, 2], obscure: 1, panel: 0.55, panels: 2, src: 'IMG_5518: fanlight of 3, a leaf glazed 3 x 2 over two tall panels' },
  door2: { fan: 0.2, fanGrid: [4, 1], leaves: 2, grid: [2, 4], obscure: 0, panel: 0.12, panels: 1, src: 'IMG_5537 (the entrance doors, A-04): glazed double doors with a fanlight' },
  entrance: { fan: 0.27, fanGrid: [4, 2], leaves: 2, grid: [2, 4], obscure: 0, panel: 0.06, panels: 0, src: 'IMG_5537: fanlight 4 x 2, glazed double doors' },
  idoor: { fan: 0.17, fanGrid: [3, 1], leaves: 1, grid: [3, 2], obscure: 1, panel: 0.55, panels: 2, src: 'inferred: as the external door (IMG_5518)' },
  idoor2: { fan: 0.2, fanGrid: [4, 1], leaves: 2, grid: [2, 4], obscure: 0, panel: 0.12, panels: 1, src: 'inferred: as the entrance doors' },
  pdoor: { fan: 0, leaves: 1, grid: [1, 1], obscure: 0, panel: 0.95, panels: 2, src: "inferred: a panelled hardwood door in the 6 ft partition (1948 memo: 'two hardwood doors completed with locks')" },
};
function joinery(part, ob, s0, s1, y0, y1, j, open = false, T = 0.3) {
  const F = 0.065, FD = [-0.115, -0.05], LD = [-0.105, -0.07], BD = [-0.1, -0.078], G = -0.095, BW = 0.026, LW = 0.05;
  ob(part, 'paint', s0, s0 + F, y0, y1, ...FD); ob(part, 'paint', s1 - F, s1, y0, y1, ...FD);
  ob(part, 'paint', s0 + F, s1 - F, y1 - F, y1, ...FD); ob(part, 'paint', s0 + F, s1 - F, y0, y0 + F, ...FD);
  const x0 = s0 + F, x1 = s1 - F, z0 = y0 + F, z1 = y1 - F;
  const glaze = (a0, a1, b0, b1, cols, rows, obsc) => {        // glass, obscure rows, glazing bars
    ob(part, 'glass', a0, a1, b0, b1, G - 0.004, G);
    if (obsc) ob(part, 'obscure', a0, a1, b0, b0 + (b1 - b0) * obsc / rows, G - 0.003, G + 0.001);
    for (let c = 1; c < cols; c++) { const s = a0 + (a1 - a0) * c / cols; ob(part, 'paint', s - BW / 2, s + BW / 2, b0, b1, ...BD); }
    for (let r = 1; r < rows; r++) { const y = b0 + (b1 - b0) * r / rows; ob(part, 'paint', a0, a1, y - BW / 2, y + BW / 2, ...BD); }
  };
  let top = z1;
  if (j.fan) {                                                 // the fanlight and the transom under it
    const yt = z1 - (z1 - z0) * j.fan;
    ob(part, 'paint', x0, x1, yt - 0.04, yt + 0.04, FD[0], FD[1] + 0.012);
    glaze(x0, x1, yt + 0.04, z1, j.fanGrid[0], j.fanGrid[1], 0);
    top = yt - 0.04;
  }
  const lw = (x1 - x0) / j.leaves;
  if (open) {                                                  // the leaves stand open, swung 90 deg inward against the reveal (2026-10-30)
    for (let i = 0; i < j.leaves; i++) {
      const sh = i === 0 ? x0 + 0.004 : x1 - 0.049, sA = sh, sB = sh + 0.045, dA = -T - lw + 0.01, dB = -T;   // hinge at the jamb
      ob(part, 'paint', sA, sB, z0, top, dA, dA + LW); ob(part, 'paint', sA, sB, z0, top, dB - LW, dB);
      ob(part, 'paint', sA, sB, top - LW, top, dA + LW, dB - LW); ob(part, 'paint', sA, sB, z0, z0 + LW * 1.6, dA + LW, dB - LW);
      let g0 = z0 + LW * 1.6;
      if (j.panel) { const pt = z0 + (top - z0) * j.panel; ob(part, 'paint', sA + 0.008, sB - 0.008, g0, pt + LW / 2, dA + LW, dB - LW); g0 = pt + LW / 2; }
      ob(part, 'glass', sA + 0.02, sB - 0.02, g0, top - LW, dA + LW, dB - LW);
      for (let r = 1; r < j.grid[1]; r++) { const y = g0 + (top - LW - g0) * r / j.grid[1]; ob(part, 'paint', sA + 0.01, sB - 0.01, y - BW / 2, y + BW / 2, dA + LW, dB - LW); }
    }
    return;
  }
  for (let i = 0; i < j.leaves; i++) {                         // each leaf: its frame, a panel below, glass above
    const a0 = x0 + lw * i + 0.004, a1 = x0 + lw * (i + 1) - 0.004;
    ob(part, 'paint', a0, a0 + LW, z0, top, ...LD); ob(part, 'paint', a1 - LW, a1, z0, top, ...LD);
    ob(part, 'paint', a0 + LW, a1 - LW, top - LW, top, ...LD); ob(part, 'paint', a0 + LW, a1 - LW, z0, z0 + LW * 1.6, ...LD);
    let g0 = z0 + LW * 1.6;
    if (j.panel) {
      const pt = z0 + (top - z0) * j.panel;
      ob(part, 'paint', a0 + LW, a1 - LW, g0, pt, LD[0], -0.09);                  // the panel's ground
      ob(part, 'paint', a0 + LW, a1 - LW, pt - LW / 2, pt + LW / 2, ...LD);       // the lock rail
      const n = j.panels, pw = (a1 - a0 - 2 * LW) / Math.max(n, 1);
      for (let p = 0; p < n; p++) ob(part, 'paint', a0 + LW + pw * p + 0.06, a0 + LW + pw * (p + 1) - 0.06, g0 + 0.07, pt - LW / 2 - 0.07, -0.09, -0.074);   // raised panels
      g0 = pt + LW / 2;
    }
    glaze(a0 + LW, a1 - LW, g0, top - LW, j.grid[0], j.grid[1], j.obscure || 0);
  }
}

// ---- the interior's helpers (2026-10-30). A face on a wall line at(s) (direction u, normal n = (-uy, ux)), `off`
// metres along n, looking along +n (fs = 1) or -n (fs = -1): its front face toward the room it bounds (a back face
// toward the viewer misleads the AO pass, see face())
function nface(part, k, at, n, off, s0, s1, y0, y1, fs) {
  if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return;
  const P = s => { const p = at(s); return [p[0] + n[0] * off, p[1] + n[1] * off]; }, A = P(s0), B = P(s1), T = TILE[k] || [1, 1];
  const uA = [s0 / T[0], y0 / T[1]], uB = [s1 / T[0], y0 / T[1]], uC = [s1 / T[0], y1 / T[1]], uD = [s0 / T[0], y1 / T[1]];
  if (fs > 0) quad(part, k, V3(...B, y0), V3(...A, y0), V3(...A, y1), V3(...B, y1), uB, uA, uD, uC);
  else quad(part, k, V3(...A, y0), V3(...B, y0), V3(...B, y1), V3(...A, y1), uA, uB, uC, uD);
}
// rooms (plan coordinates, filled in below) for the dado test and the click panel
const ROOMS = [];
const roomAt = (a, b) => ROOMS.find(r => a >= r.r[0] && a <= r.r[1] && b >= r.r[2] && b <= r.r[3]);
// collision: wall segments in plan coordinates, [a0, b0, a1, b1, half-thickness]
const SEG = [];
// a finished interior face: plaster with holes (openings), cement skirting, the glazed dado where the room has one,
// the cornice under the ceiling. holes: [{s0, s1, y0, y1}] along the line
// (the dado only on original masonry: the 1948 fibreboard and the undated partitions get none -- Fig 21 shows the 1948
// partition plain beside the tiled walls)
function finishedFace(part, at, n, off, fs, sA, sB, holes, slab, top, ceil, mk = 'plaster', dadoOK = true) {
  const hs = holes.filter(h => h.s1 > sA && h.s0 < sB).sort((x, y) => x.s0 - y.s0), pieces = [];
  let s = sA;
  for (const h of hs) { pieces.push([s, Math.max(s, h.s0), slab, top]); pieces.push([Math.max(sA, h.s0), Math.min(sB, h.s1), slab, h.y0]); pieces.push([Math.max(sA, h.s0), Math.min(sB, h.s1), h.y1, top]); s = Math.max(s, h.s1); }
  pieces.push([s, sB, slab, top]);
  const probe = (sm) => { const p = at(sm); return roomAt(p[0] + n[0] * (off + fs * 0.35), p[1] + n[1] * (off + fs * 0.35)); };
  for (const [s0, s1, y0, y1] of pieces) {
    if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) continue;
    nface(part, mk, at, n, off, s0, s1, y0, y1, fs);
    if (y0 <= slab + 1e-3) nface(part, 'skirt', at, n, off + fs * 0.012, s0, s1, slab, Math.min(y1, slab + 0.15), fs);
    if (y1 >= ceil - 1e-3 && top >= ceil - 1e-3) nface(part, 'cornice', at, n, off + fs * 0.02, s0, s1, Math.max(y0, ceil - 0.15), ceil, fs);
    if (dadoOK && y0 < slab + 1.22 && y1 > slab + 0.15) for (let a = s0; a < s1 - 1e-3; a += 0.6) {    // the dado, piece by piece, where the room has one
      const b = Math.min(s1, a + 0.6), r = probe((a + b) / 2);
      if (!r || !r.dado) continue;
      nface(part, 'dado', at, n, off + fs * 0.006, a, b, Math.max(y0, slab + 0.15), Math.min(y1, slab + 1.17), fs);
      if (y1 > slab + 1.17) nface(part, 'dadocap', at, n, off + fs * 0.009, a, b, slab + 1.17, Math.min(y1, slab + 1.22), fs);
    }
  }
}
// the reveal of a hole through a wall from depth dA to dB (negative = inward), plaster sides and head, a timber sill
function revealThrough(part, at, n, s0, s1, y0, y1, dA, dB, sill, k = 'plaster') {
  const v = (s, d, y) => { const p = at(s); return V3(p[0] + n[0] * d, p[1] + n[1] * d, y); };
  quad(part, k, v(s0, dA, y0), v(s0, dA, y1), v(s0, dB, y1), v(s0, dB, y0)); quad(part, k, v(s1, dB, y0), v(s1, dB, y1), v(s1, dA, y1), v(s1, dA, y0));
  quad(part, k, v(s0, dA, y1), v(s1, dA, y1), v(s1, dB, y1), v(s0, dB, y1));
  if (sill) { const ob = obox(at, n[0], n[1]); ob(part, 'isill', s0 - 0.05, s1 + 0.05, y0 - 0.04, y0, dB - 0.04, dA); }
  else if (y0 > 0) quad(part, k, v(s0, dB, y0), v(s1, dB, y0), v(s1, dA, y0), v(s0, dA, y0));
}
const segAlong = (at, n, off, s0, s1, r) => { if (s1 - s0 < 0.05) return; const A = at(s0), B = at(s1); SEG.push([A[0] + n[0] * off, A[1] + n[1] * off, B[0] + n[0] * off, B[1] + n[1] * off, r]); };

// ---- walls with openings. A wall runs p -> q (clockwise round the building: its outer face on the left of travel,
// the normal (-db, da)); openings [kind, t0, t1, 'open'?] in metres on Fig 15, scaled by L / Lfig. IN (the interior,
// 2026-10-30): {T, ceil, sA, sB} draws the wall's inner face T metres in, from sA to sB along it, and its collision line
function wallWithOpenings(part, p, q, Lfig, opens, slab, top, plinthH, KIND, IN = null) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L, sc = L / Lfig;
  const at = t => [p[0] + ux * t, p[1] + uy * t], foot = slab - 0.45, n = [-uy, ux];
  const os = opens.map(([k, t0, t1, o]) => [k, t0 * sc, t1 * sc, o === 'open']).sort((x, y) => x[1] - y[1]);
  let t = 0;
  // the plinth band and the render above it on one plane (a plinth face standing proud by 1 cm gave the viewer's AO
  // pass halos round every opening)
  const pl = slab + plinthH;
  const solid = (t0, t1, y0, y1) => { if (t1 - t0 < 1e-3 || y1 - y0 < 1e-3) return;
    if (y0 < pl) face(part, 'plinth', at(t0), at(t1), y0, Math.min(y1, pl));
    if (y1 > pl) face(part, 'render', at(t0), at(t1), Math.max(y0, pl), y1); };
  const holes = [], T = IN ? IN.T : 0.3, R = 0.12;
  let cs = 0;                                                          // collision: the wall's line, broken at open doors
  for (const [k, t0, t1, open] of os) {
    const K = KIND[k], c = (t0 + t1) / 2;
    let a0 = t0, a1 = t1, y0 = slab + K.y[0], y1 = slab + K.y[1];
    if (k === 'gap') {                                                 // an opening with no door: the wall stops (Fig 15)
      solid(t, a0, foot, top);
      if (IN) { holes.push({ s0: a0, s1: a1, y0: slab, y1: slab + IN.ceil }); revealThrough(part, at, n, a0, a1, slab, slab + IN.ceil, 0, -T, false, 'render'); }
      if (IN) segAlong(at, n, -T / 2, cs, a0, T / 2 + 0.2); cs = a1; t = a1; continue;
    }
    if (k === 'entrance') { a0 = c - 1.42; a1 = c + 1.42; }
    solid(t, a0, foot, top);
    solid(a0, a1, y1, top);                                            // above the opening
    if (K.y[0] > 0) solid(a0, a1, foot, y0);                           // below a window
    const ob = obox(at, -uy, ux);
    if (k === 'entrance') {                                            // the granite doorcase stands 0.1 m proud, modelled
      const PW = 0.6, top = slab + (K.open_h || 3.2);                           // pilasters 0.6 m (IMG_5537 rectified), opening 3.2 m
      ob(part, 'granite', a0, a0 + PW, slab, top, -R, 0.1); ob(part, 'granite', a1 - PW, a1, slab, top, -R, 0.1);
      ob(part, 'granite', a0 - 0.04, a1 + 0.04, top, top + 0.12, -R, 0.14);         // the lintel's projecting band
      ob(part, 'granite', a0, a1, top + 0.12, y1 - 0.1, -R, 0.1);
      ob(part, 'granite', a0 - 0.06, a1 + 0.06, y1 - 0.1, y1, -R, 0.16);             // the cornice
      // the name panel: the only part still a photograph (lettering), the band of IMG_5537 above the lintel
      { const P = at(a0 + 0.08), Qq = at(a1 - 0.08), d = 0.101, nx = -uy, ny = ux, [v0, v1] = K.panel_v || [0.685, 0.935];
        quad(part, 'entrance', V3(Qq[0] + nx * d, Qq[1] + ny * d, top + 0.2), V3(P[0] + nx * d, P[1] + ny * d, top + 0.2),
             V3(P[0] + nx * d, P[1] + ny * d, y1 - 0.14), V3(Qq[0] + nx * d, Qq[1] + ny * d, y1 - 0.14), [0.03, v0], [0.97, v0], [0.97, v1], [0.03, v1]); }
      joinery(part, ob, a0 + PW, a1 - PW, slab, top, J.entrance, open, T);
      if (IN) { holes.push({ s0: a0 + PW, s1: a1 - PW, y0: slab, y1: top }); revealThrough(part, at, n, a0 + PW, a1 - PW, slab, top, -R, -T, false); }
      if (IN && open) { segAlong(at, n, -T / 2, cs, a0 + PW, T / 2 + 0.2); cs = a1 - PW; }
    } else {
      if (K.tex && J[k]) joinery(part, ob, a0, a1, y0, y1, J[k], open, T);
      else if (K.tex) face(part, K.tex, at(a0), at(a1), y0, y1, true, -R);
      else {                                                           // drawn: timber battened garage doors
        face(part, 'garage', at(a0), at(a1), y0, y1, true, -R);
        const n = Math.round((a1 - a0) / 0.16);
        for (let i = 1; i < n; i++) { const s = a0 + (a1 - a0) * i / n; face(part, 'cap', at(s - 0.01), at(s + 0.01), y0, y1, true, -R + 0.005); }
      }
      // reveals: sides, head, sill-side
      const nx = -uy, ny = ux;
      for (const e of [a0, a1]) { const P1 = at(e); quad(part, 'reveal', V3(P1[0], P1[1], y0), V3(P1[0] - nx * R, P1[1] - ny * R, y0), V3(P1[0] - nx * R, P1[1] - ny * R, y1), V3(P1[0], P1[1], y1)); }
      { const A = at(a0), B = at(a1);
        quad(part, 'reveal', V3(A[0], A[1], y1), V3(B[0], B[1], y1), V3(B[0] - nx * R, B[1] - ny * R, y1), V3(A[0] - nx * R, A[1] - ny * R, y1));
        if (K.y[0] > 0) quad(part, 'reveal', V3(A[0], A[1], y0), V3(B[0], B[1], y0), V3(B[0] - nx * R, B[1] - ny * R, y0), V3(A[0] - nx * R, A[1] - ny * R, y0)); }
      if (K.sill) {                                                    // the red brick sill, 0.17 m deep, standing 0.06 m out
        const A = at(a0 - 0.08), B = at(a1 + 0.08);
        const lo = y0 - 0.17, d = 0.08;
        face(part, 'sill', A, B, lo, y0, false, d);
        quad(part, 'band', V3(A[0] + nx * d, A[1] + ny * d, y0), V3(B[0] + nx * d, B[1] + ny * d, y0), V3(B[0], B[1], y0), V3(A[0], A[1], y0));
      }
      // the brick head, modelled (2026-11-06; was IMG_5537's strip laid flat, whose baked underside read as a sloping
      // hood): a soldier course 0.03 m proud, joints 1 cm back, 0.2 m past the opening each side. Height 0.28 m = the
      // head's 60 px at the window's own scale in IMG_5537 (2.5 m over 532 px); brick 65 mm + 10 mm joint, drawn
      if (K.head) { const H = 0.28, s0 = a0 - 0.2, s1 = a1 + 0.2, nb = Math.round((s1 - s0) / 0.075), bw = (s1 - s0) / nb;
        ob(part, 'joint', s0, s1, y1, y1 + H, 0, 0.02);
        for (let i = 0; i < nb; i++) ob(part, 'brick', s0 + i * bw + 0.005, s0 + (i + 1) * bw - 0.005, y1, y1 + H - 0.01, 0, 0.03); }
      if (IN) { holes.push({ s0: a0, s1: a1, y0, y1 }); revealThrough(part, at, n, a0, a1, y0, y1, -R, -T, K.y[0] > 0); }
      if (IN && open) { segAlong(at, n, -T / 2, cs, a0, T / 2 + 0.2); cs = a1; }
    }
    t = a1;
  }
  solid(t, L, foot, top);
  if (IN) {
    finishedFace(part, at, n, -T, -1, IN.sA, L - IN.sB, holes, slab, slab + IN.ceil, slab + IN.ceil);
    segAlong(at, n, -T / 2, cs, L, T / 2 + 0.2);
  }
}
// an interior wall (2026-10-30): both faces finished, end caps, door openings through it with their doors (open or
// closed), a top if it stops below the ceiling (the 1948 partition). w: the spec's entry, already mapped to the plan
function interiorWall(part, w, slab, ceil, KIND) {
  const [p, q] = w.line, L = Math.hypot(q[0] - p[0], q[1] - p[1]), u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], n = [-u[1], u[0]];
  const at = s => [p[0] + u[0] * s, p[1] + u[1] * s], t = w.t, top = w.h === 'ceiling' ? slab + ceil : slab + w.h;
  const mk = w.status === '1948' ? 'fibre' : 'plaster', holes = [], n0 = SEG.length;
  const front = s => { const a = at(s); return [a[0] + n[0] * t / 2, a[1] + n[1] * t / 2]; };
  let cs = 0;
  for (const [k, s0, s1, st] of w.opens.slice().sort((x, y) => x[1] - y[1])) {
    const K = KIND[k], y1 = Math.min(top, slab + K.y[1]);
    holes.push({ s0, s1, y0: slab, y1 });
    revealThrough(part, at, n, s0, s1, slab, y1, t / 2, -t / 2, false, mk);
    joinery(part, obox(front, n[0], n[1]), s0, s1, slab, y1, J[k], st === 'open', t);
    if (st === 'open') { segAlong(at, n, 0, cs, s0, t / 2 + 0.2); cs = s1; }
  }
  segAlong(at, n, 0, cs, L, t / 2 + 0.2);
  const dok = w.status === 'original' || w.t >= 0.2;            // masonry, not the fibreboard or the thin partitions
  finishedFace(part, at, n, t / 2, 1, 0, L, holes, slab, top, slab + ceil, mk, dok);
  finishedFace(part, at, n, -t / 2, -1, 0, L, holes, slab, top, slab + ceil, mk, dok);
  for (const s of [0, L]) { const A = at(s); quad(part, mk, V3(A[0] + n[0] * t / 2, A[1] + n[1] * t / 2, slab), V3(A[0] - n[0] * t / 2, A[1] - n[1] * t / 2, slab), V3(A[0] - n[0] * t / 2, A[1] - n[1] * t / 2, top), V3(A[0] + n[0] * t / 2, A[1] + n[1] * t / 2, top)); }
  if (part === 'int_u') for (let i = n0; i < SEG.length; i++) SEG[i][5] = 'u';   // undated: no collision while hidden
  if (top < slab + ceil - 0.01) { const A = at(0), B = at(L); quad(part, mk, V3(A[0] + n[0] * t / 2, A[1] + n[1] * t / 2, top), V3(B[0] + n[0] * t / 2, B[1] + n[1] * t / 2, top), V3(B[0] - n[0] * t / 2, B[1] - n[1] * t / 2, top), V3(A[0] - n[0] * t / 2, A[1] - n[1] * t / 2, top)); }
}
// a chimney breast floor to ceiling and its fireplaces (B-02, D-01: tiling, surround, grate, hearth, mantel shelf; sizes
// inferred). box [a0, a1, b0, b1] in plan, or corner: three points (the diagonal first)
function breast(part, B, slab, ceil, FS) {
  const fire = (at, n, s0, s1) => {             // a fireplace on the face at(s), s0..s1, looking along n
    const c = (s0 + s1) / 2, w = Math.min(FS.surround_w, s1 - s0 - 0.1) / 2, ob = obox(at, n[0], n[1]), [ow, oh] = FS.opening;
    ob(part, 'fsur', c - w, c + w, slab, slab + FS.surround_h, 0, 0.04);                       // the tiled surround
    ob(part, 'fhole', c - ow / 2, c + ow / 2, slab + 0.06, slab + oh, -0.02, 0.045);            // the grate's opening
    ob(part, 'mantel', c - w - 0.1, c + w + 0.1, slab + FS.mantel_h, slab + FS.mantel_h + 0.06, 0, 0.2);   // the mantel shelf
    ob(part, 'hearth', c - FS.hearth[0] / 2, c + FS.hearth[0] / 2, slab, slab + 0.03, 0, FS.hearth[1]);    // the hearth
  };
  const y0 = slab, y1 = slab + ceil;
  if (B.box) {
    const [a0, a1, b0, b1] = B.box, sides = { n: [[a0, b1], [a1, b1]], e: [[a1, b1], [a1, b0]], s: [[a1, b0], [a0, b0]], w: [[a0, b0], [a0, b1]] };   // clockwise: n = (-uy, ux) outward
    for (const [k, [p, q]] of Object.entries(sides)) {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]), u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L], n = [-u[1], u[0]], at = s => [p[0] + u[0] * s, p[1] + u[1] * s];
      nface(part, 'plaster', at, n, 0, 0, L, y0, y1, 1); nface(part, 'skirt', at, n, 0.012, 0, L, y0, y0 + 0.15, 1);
      if (B.fires.some(f => f[0] === k)) fire(at, n, 0, L);
      SEG.push([p[0], p[1], q[0], q[1], 0.2]);
    }
  } else {
    const [p, q, r] = B.corner, L = Math.hypot(q[0] - p[0], q[1] - p[1]), u = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    let n = [-u[1], u[0]]; if ((r[0] - p[0]) * n[0] + (r[1] - p[1]) * n[1] > 0) n = [-n[0], -n[1]];       // away from the corner
    const at = s => [p[0] + u[0] * s, p[1] + u[1] * s], fs = (n[0] === -u[1] && n[1] === u[0]) ? 1 : -1;
    nface(part, 'plaster', at, [-u[1], u[0]], 0, 0, L, y0, y1, fs); nface(part, 'skirt', at, [-u[1], u[0]], 0.012 * fs, 0, L, y0, y0 + 0.15, fs);
    fire(at, n, 0, L);
    SEG.push([p[0], p[1], q[0], q[1], 0.2]);
  }
}

// ---- a hip roof over a rectangle (eave edges ea0..ea1 x eb1..eb0, eave height He, pitch s); gable_m > 0 makes it a
// hip-and-gable (歇山): the end slopes stop at a vertical gable G metres under the ridge. Ridge along the longer side
function hipRoof(part, ea0, ea1, eb1, eb0, He, s, G = 0, curl = false, clip = null) {
  const alongA = (ea1 - ea0) >= (eb0 - eb1);
  // work in (x along the ridge, y across), then map back
  const X0 = alongA ? ea0 : eb1, X1 = alongA ? ea1 : eb0, Y0 = alongA ? eb1 : ea0, Y1 = alongA ? eb0 : ea1;
  const toL = (x, y, h) => alongA ? [x, y, h] : [y, x, h];
  const hd = (Y1 - Y0) / 2, yc = (Y0 + Y1) / 2, Hr = He + s * hd, d = (Hr - G - He) / s, w = G / s;
  const r0 = X0 + d, r1 = X1 - d, cosp = Math.cos(Math.atan(s)), T = TILE.pan;
  // the roll tiles (2026-11-06): on the pitch's grid in local metres, as the pans' texture is, so lap lines and steps
  // agree. A run stops 0.1 m short of a hip (under its capping) and 0.05 m short of the ridge or the gable's foot
  const grid = (lo, hi) => { const o = []; for (let k = Math.ceil((lo + 0.12) / ROLL.pitch); k * ROLL.pitch <= hi - 0.12; k++) o.push(k * ROLL.pitch); return o; };
  for (const sg of [1, -1]) for (const x of grid(X0, X1)) {           // the long slopes: hips near the ends, else the ridge
    const e = Math.min(x - X0, X1 - x), len = e < d ? e - 0.1 : hd - 0.05;
    const [a, b] = toL(x, sg > 0 ? Y1 : Y0, 0), [da, db] = toL(0, -sg, 0);
    if (len > 0.05) rollRun(part, [a, b], [da, db], len, He, s, clip);
  }
  for (const sg of [-1, 1]) for (const y of grid(Y0, Y1)) {           // the ends: hips, or the gable's foot
    const e = Math.min(y - Y0, Y1 - y), len = e < d ? e - 0.1 : d - 0.05;
    const [a, b] = toL(sg < 0 ? X0 : X1, y, 0), [da, db] = toL(-sg, 0, 0);
    if (len > 0.05) rollRun(part, [a, b], [da, db], len, He, s, clip);
  }
  const uvA = p => { const q = alongA ? p : [p[1], p[0]]; return [q[0] / T[0], (Math.abs(q[1] - yc) > hd - 1e-6 ? 0 : (hd - Math.abs(q[1] - yc)) / cosp / T[1])]; };
  const slopeUV = side => p => { const q = alongA ? p : [p[1], p[0]]; return [q[0] / T[0], (hd - Math.abs(q[1] - yc)) / cosp / T[1]]; };
  const endUV = side => p => { const q = alongA ? p : [p[1], p[0]]; return [q[1] / T[0], (side < 0 ? q[0] - X0 : X1 - q[0]) / cosp / T[1]]; };
  for (const sg of [1, -1]) {                                          // the two long slopes
    const ye = sg > 0 ? Y1 : Y0;
    const pts = [toL(X0, ye, He), toL(X1, ye, He), toL(r1, yc + sg * w, Hr - G), toL(r1, yc, Hr), toL(r0, yc, Hr), toL(r0, yc + sg * w, Hr - G)];
    poly(part, 'pan', sg > 0 ? pts : pts.slice().reverse(), slopeUV(sg));
  }
  for (const sg of [-1, 1]) {                                          // the two ends
    const xe = sg < 0 ? X0 : X1, xr = sg < 0 ? r0 : r1;
    poly(part, 'pan', [toL(xe, Y0, He), toL(xe, Y1, He), toL(xr, yc + w, Hr - G), toL(xr, yc - w, Hr - G)], endUV(sg));
    if (G > 0) {                                                       // the gable, its circular moulding, its verges
      poly(part, 'gable', [toL(xr, yc + w, Hr - G), toL(xr, yc - w, Hr - G), toL(xr, yc, Hr)], () => [0, 0]);
      const c = V3(...toL(xr + sg * 0.03, yc, Hr - G * 0.45)), disc = new THREE.Mesh(new THREE.CircleGeometry(Math.min(0.32, w * 0.3), 24), M.capwhite);
      disc.position.copy(c); const nrm = V3(...toL(xr + sg, yc, 0)).sub(V3(...toL(xr, yc, 0))).normalize(); disc.lookAt(c.clone().add(nrm)); EXTRA.push([part, disc]);
      for (const sy of [1, -1]) tube(part, 'cap', toL(xr, yc + sy * w, Hr - G), toL(xr, yc, Hr), 0.16, 0.12);
    }
    for (const sy of [1, -1]) tube(part, 'cap', toL(xe, sy > 0 ? Y1 : Y0, He), toL(xr, yc + sy * w, Hr - G), 0.2, 0.14);   // hips
  }
  tube(part, 'cap', toL(r0 - (G > 0 ? 0.15 : 0), yc, Hr), toL(r1 + (G > 0 ? 0.15 : 0), yc, Hr), 0.32, spec.main.cap_m);   // ridge
  if (curl) for (const sg of [-1, 1]) {                                // curled-up ridge ends (A-07): 0.35 m up over 0.45 m, drawn
    const xr = sg < 0 ? r0 - 0.15 : r1 + 0.15;
    let prev = toL(xr, yc, Hr);
    for (let i = 1; i <= 5; i++) { const t = i / 5, nx = xr + sg * 0.45 * Math.sin(t * Math.PI / 2), h = Hr + 0.35 * (1 - Math.cos(t * Math.PI / 2));
      const cur = toL(nx, yc, h); tube(part, 'cap', prev, cur, 0.3 * (1 - 0.5 * t), spec.main.cap_m * (1 - 0.4 * t)); prev = cur; }
  }
  // the roof's height at a local point (for chimneys)
  return { Hr, d, w, r0, r1, yc, alongA, at: (a, b) => { const x = alongA ? a : b, y = alongA ? b : a;
    let h = Hr - s * Math.abs(y - yc); const de = Math.min(x - X0, X1 - x); if (de < d) h = Math.min(h, He + s * de); return h; } };
}
// eave soffit ring, gutters along the eave edges
function soffit(part, outer, inner, y) {
  const [oa0, oa1, ob1, ob0] = outer, [ia0, ia1, ib1, ib0] = inner;
  for (const [p, q, r, s] of [[[oa0, ob0], [oa1, ob0], [ia1, ib0], [ia0, ib0]], [[oa1, ob0], [oa1, ob1], [ia1, ib1], [ia1, ib0]],
                              [[oa1, ob1], [oa0, ob1], [ia0, ib1], [ia1, ib1]], [[oa0, ob1], [oa0, ob0], [ia0, ib0], [ia0, ib1]]])
    poly(part, 'soffit', [[...p, y], [...q, y], [...r, y], [...s, y]], () => [0, 0]);
}
const gutterRect = (part, a0, a1, b1, b0, y) => { for (const [p, q] of [[[a0, b0], [a1, b0]], [[a1, b0], [a1, b1]], [[a1, b1], [a0, b1]], [[a0, b1], [a0, b0]]]) trough(part, p, q, y - 0.02); };
function chimney(part, a, b, base, top, w) {
  box(part, 'render', a - w / 2, a + w / 2, b - w / 2, b + w / 2, base, top - 0.75);
  box(part, 'band', a - w / 2 - 0.03, a + w / 2 + 0.03, b - w / 2 - 0.03, b + w / 2 + 0.03, top - 0.75, top - 0.45);   // red brick band (A-09)
  box(part, 'capwhite', a - w / 2, a + w / 2, b - w / 2, b + w / 2, top - 0.45, top - 0.06);
  box(part, 'cap', a - w / 2 - 0.06, a + w / 2 + 0.06, b - w / 2 - 0.06, b + w / 2 + 0.06, top - 0.06, top);
}
const EXTRA = [];

// ============================================================================================ the Main Block
{
  const m = PL.main, S = spec.main, slab = S.slab_mPD, W = m.W, E0 = S.eave_out_m;
  const fs = s => s * W / 19.77, fb = b => b * (m.colb / -13.635);           // the HIA's metres in this plan
  const eave = [-E0, W + E0, m.colb - E0, E0], He = S.eave_mPD, hd = (eave[3] - eave[2]) / 2, s = (S.ridge_mPD - He) / hd;
  const roofUnder = d => He + s * d - 0.16;                            // the tiles' underside d metres in from the eave edge
  // floor: the slab and its granite edge (the verandah's edge stones, A-10)
  box('main', 'plinth', 0, W, m.colb, 0, Math.min(ground(0, 0), ground(W, m.colb)) - 0.4, slab);
  poly('main', 'floor', [[0, m.colb, slab + 0.004], [W, m.colb, slab + 0.004], [W, 0, slab + 0.004], [0, 0, slab + 0.004]], () => [0, 0]);   // verandah tiles (A-16; their 1982 colour unknown)
  for (const [p, q] of [[[0, m.colb], [W, m.colb]], [[W, m.colb], [W, -m.dne]], [[0, -m.dnw], [0, m.colb]]]) face('main', 'granite', p, q, slab - 0.5, slab + 0.01, false, 0.005);
  // walls: the sheet's T (or the HIA's), clockwise; the north rooms' walls rise to the tiles, the core's to the verandah ceiling
  const KIND = spec.kinds, O = S.openings, top0 = roofUnder(E0);
  const walls = [['N', [0, 0], [W, 0], top0], ['E1', [W, 0], [W, -m.dne], top0], ['SEn', [W, -m.dne], [m.c1, -m.dne], slab + S.ceiling_h],
                 ['E2', [m.c1, -m.dne], [m.c1, m.cb], slab + S.ceiling_h], ['S', [m.c1, m.cb], [m.c0, m.cb], slab + S.ceiling_h],
                 ['W2', [m.c0, m.cb], [m.c0, -m.dnw], slab + S.ceiling_h], ['SWn', [m.c0, -m.dnw], [0, -m.dnw], slab + S.ceiling_h], ['W1', [0, -m.dnw], [0, 0], top0]];
  // the interior (2026-10-30): each wall's inner face 0.3 m in (CAD), from corner to corner -- shortened by the thickness
  // at a convex corner, lengthened at a re-entrant one
  const IM = spec.interior.main, TT = IM.wall_t, verts = walls.map(w => w[1]);
  const convex = i => { const a = verts[(i + verts.length - 1) % verts.length], b = verts[i], c = verts[(i + 1) % verts.length];
    return ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 0; };
  walls.forEach(([id, p, q, top], i) => wallWithOpenings('main', p, q, O[id][0], O[id][1], slab, top, S.plinth_h, KIND,
    { T: TT, ceil: IM.ceiling_h, sA: convex(i) ? TT : -TT, sB: convex((i + 1) % walls.length) ? TT : -TT }));
  const MI = (a, b) => [fs(a), b * (m.cb / -11.835)];                 // the inventory's HIA metres -> this plan
  for (const r of IM.rooms) ROOMS.push(Object.assign({}, r, { block: 'Main Block', r: [MI(r.r[0], 0)[0], MI(r.r[1], 0)[0], MI(0, r.r[2])[1], MI(0, r.r[3])[1]] }));
  for (const w of IM.walls) { const ww = Object.assign({}, w, { line: w.line.map(([a, b]) => MI(a, b)) });
    interiorWall(w.status === 'undated' ? 'int_u' : w.status === '1948' ? 'int_48' : 'int_main', ww, slab, IM.ceiling_h, KIND); }
  for (const B of IM.breasts) breast('fire', B.box ? Object.assign({}, B, { box: [MI(B.box[0], 0)[0], MI(B.box[1], 0)[0], MI(0, B.box[2])[1], MI(0, B.box[3])[1]] })
                                               : Object.assign({}, B, { corner: B.corner.map(([a, b]) => MI(a, b)) }), slab, IM.ceiling_h, IM.fire_size);
  // floors and the timber ceiling over the rooms (the north range and the core); the Watchman Room's terrazzo (B-10)
  { const dn = Math.max(m.dnw, m.dne), y = slab + 0.008, yc = slab + IM.ceiling_h - 0.002;
    for (const r of [[0, W, -dn, 0], [m.c0, m.c1, m.cb, -dn]]) {
      poly('int_main', 'ifloor', [[r[0], r[2], y], [r[1], r[2], y], [r[1], r[3], y], [r[0], r[3], y]], () => [0, 0]);
      poly('int_main', 'iceil', [[r[0], r[3], yc], [r[1], r[3], yc], [r[1], r[2], yc], [r[0], r[2], yc]], () => [0, 0]);
    }
    const wr = ROOMS.find(x => x.floor === 'terrazzo'); if (wr) poly('int_main', 'terrazzo', [[wr.r[0], wr.r[2], y + 0.002], [wr.r[1], wr.r[2], y + 0.002], [wr.r[1], wr.r[3], y + 0.002], [wr.r[0], wr.r[3], y + 0.002]], () => [0, 0]);
  }
  // the colonnade: 14 square columns (HIA p87), the beam on them, and the frieze from the beam up to the tiles
  const cw = S.column_w / 2, cols = [];
  for (const a of S.columns.south_a) cols.push([fs(a), m.colb + cw]);
  for (const b of S.columns.west_b) if (fb(b) < -m.dnw - 0.3) cols.push([cw, fb(b)]);
  for (const b of S.columns.east_b) if (fb(b) < -m.dne - 0.3) cols.push([W - cw, fb(b)]);
  for (const [a, b] of cols) { box('main', 'render', a - cw, a + cw, b - cw, b + cw, slab, slab + S.column_h); box('main', 'plinth', a - cw - 0.01, a + cw + 0.01, b - cw - 0.01, b + cw + 0.01, slab, slab + S.plinth_h); }
  for (const [p, q] of [[[W, m.colb], [0, m.colb]], [[0, m.colb], [0, -m.dnw]], [[W, -m.dne], [W, m.colb]]]) {
    face('main', 'render', p, q, slab + S.column_h, top0, false, 0);                  // beam + frieze, outer face
    face('main', 'render', p, q, slab + S.column_h, slab + S.ceiling_h + 0.02, false, -S.column_w);   // (the beam's inner face)
  }
  // beam soffits over the column lines
  poly('main', 'render', [[0, m.colb, slab + S.column_h], [W, m.colb, slab + S.column_h], [W, m.colb + S.column_w, slab + S.column_h], [0, m.colb + S.column_w, slab + S.column_h]], () => [0, 0]);
  // the verandah's timber ceiling (A-12) at 4.0 m
  const yc = slab + S.ceiling_h;
  for (const r of [[0, W, m.colb, m.cb], [0, m.c0, m.cb, -m.dnw], [m.c1, W, m.cb, -m.dne]]) poly('main', 'ceiling', [[r[0], r[2], yc], [r[1], r[2], yc], [r[1], r[3], yc], [r[0], r[3], yc]], () => [0, 0]);
  // eaves: the battened soffit (A-08), the gutter (A-14), the hip-and-gable roof (A-07)
  soffit('main', eave, [0, W, m.colb, 0], He - 0.04);
  gutterRect('main', ...eave, He);
  const R = hipRoof('main', eave[0], eave[1], eave[2], eave[3], He, s, S.gable_m, true);
  for (const c of S.chimneys) chimney('main', c.a, c.b, R.at(c.a, c.b) - 0.4, c.top, c.w);
  window.__lhtwcMain = { s, pitch_deg: +(Math.atan(s) * 180 / Math.PI).toFixed(1), ridge: R.Hr, ridge_a: [R.r0, R.r1], gable_a: R.d, eave };
}

// ============================================================================================ the Bungalow
{
  const g = PL.bung, S = spec.bung, slab = S.slab_mPD, He = S.eave_mPD, EO = S.eave_out_m, EC = S.eave_court_m;
  const s = Math.tan(23 * Math.PI / 180);                                 // HIA p90: 23 deg along the U-shaped roof
  const fx = a => a * (g.a1 - g.a0) / 12.7;
  box('bung', 'plinth', g.a0, g.a1, g.b1, g.b0, Math.min(ground(g.a0, g.b0), ground(g.a1, g.b1)) - 0.4, slab);
  poly('bung', 'court', [[g.a0, g.cb1, slab + 0.005], [g.ca1, g.cb1, slab + 0.005], [g.ca1, g.cb0, slab + 0.005], [g.a0, g.cb0, slab + 0.005]], p => [0, 0]);
  const KIND = spec.kinds, O = S.openings, out = He + s * EO - 0.16, cin = He + s * EC - 0.16, cw = slab + S.court_wall_h;
  const walls = [['N', [g.a0, g.b0], [g.a1, g.b0], out], ['E', [g.a1, g.b0], [g.a1, g.b1], out], ['S', [g.a1, g.b1], [g.a0, g.b1], out],
                 ['Ws', [g.a0, g.b1], [g.a0, g.cb1], out], ['CWo', [g.a0, g.cb1], [g.a0, g.cb0], cw], ['Wn', [g.a0, g.cb0], [g.a0, g.b0], out],
                 ['cN', [g.ca1, g.cb0], [g.a0 + 0.26, g.cb0], cin], ['cE', [g.ca1, g.cb1], [g.ca1, g.cb0], cin], ['cS', [g.a0 + 0.26, g.cb1], [g.ca1, g.cb1], cin],
                 ['CWi', [g.a0 + 0.26, g.cb0], [g.a0 + 0.26, g.cb1], cw]];
  // the interior (2026-10-30): inner faces 0.4 m in (0.26 for the court walls; HIA p. 90), explicit corner by corner
  const IB = spec.interior.bung, TO = IB.wall_t, TC = IB.court_t, CE = IB.ceiling_h;
  const INB = { N: [TO, TO, TO], E: [TO, TO, TO], S: [TO, TO, TO], Ws: [TO, TO, TC], Wn: [TO, TC, TO], cN: [TC, 0, TO - TC], cE: [TC, -TC, -TC], cS: [TC, TO - TC, 0] };
  for (const [id, p, q, top] of walls) wallWithOpenings('bung', p, q, O[id][0], O[id][1], slab, top, S.plinth_h, KIND,
    INB[id] ? { T: INB[id][0], ceil: CE, sA: INB[id][1], sB: INB[id][2] } : null);
  const BI = (a, b) => [g.a0 + a * (g.a1 - g.a0) / 12.7, g.b0 + b * (g.b0 - g.b1) / 13.8];   // the inventory's HIA metres -> this plan
  for (const r of IB.rooms) ROOMS.push(Object.assign({}, r, { block: 'Bungalow', r: [BI(r.r[0], 0)[0], BI(r.r[1], 0)[0], BI(0, r.r[2])[1], BI(0, r.r[3])[1]] }));
  for (const w of IB.walls) interiorWall(w.status === 'undated' ? 'int_u' : 'int_bung', Object.assign({}, w, { line: w.line.map(([a, b]) => BI(a, b)) }), slab, CE, KIND);
  for (const B of IB.breasts) breast('fire', Object.assign({}, B, { box: [BI(B.box[0], 0)[0], BI(B.box[1], 0)[0], BI(0, B.box[2])[1], BI(0, B.box[3])[1]] }), slab, CE, spec.interior.main.fire_size);
  { const y = slab + 0.008, yc = slab + CE - 0.002;
    for (const r of [[g.a0, g.a1, g.cb0, g.b0], [g.a0, g.a1, g.b1, g.cb1], [g.ca1, g.a1, g.cb1, g.cb0]]) {
      poly('int_bung', 'ifloor', [[r[0], r[2], y], [r[1], r[2], y], [r[1], r[3], y], [r[0], r[3], y]], () => [0, 0]);
      poly('int_bung', 'iceil', [[r[0], r[3], yc], [r[1], r[3], yc], [r[1], r[2], yc], [r[0], r[2], yc]], () => [0, 0]);
    } }
  poly('bung', 'render', [[g.a0, g.cb1, cw], [g.a0 + 0.26, g.cb1, cw], [g.a0 + 0.26, g.cb0, cw], [g.a0, g.cb0, cw]], () => [0, 0]);   // its coping
  // the U-shaped hipped roof as three overlapping hip roofs (equal pitch: where they overlap, the higher one is the roof)
  const wings = { north: [g.a0 - EO, g.a1 + EO, g.cb0 - EC, g.b0 + EO], south: [g.a0 - EO, g.a1 + EO, g.b1 - EO, g.cb1 + EC], east: [g.ca1 - EC, g.a1 + EO, g.b1 - EO, g.b0 + EO] };
  const RR = {};
  // a point is under another wing where that wing's roof stands higher (equal pitch: its height is He + s x the distance
  // to its nearest eave), so each wing's rolls stop at the valleys
  const wingH = (r, a, b) => (a < r[0] || a > r[1] || b < r[2] || b > r[3]) ? -Infinity : He + s * Math.min(a - r[0], r[1] - a, b - r[2], r[3] - b);
  for (const [k, r] of Object.entries(wings)) RR[k] = hipRoof('bung', ...r, He, s, 0, false,
    (a, b, h) => Object.entries(wings).some(([j, o]) => j !== k && wingH(o, a, b) > h + 0.01));
  for (const [k, r] of Object.entries(wings)) poly('bung', 'soffit', [[r[0], r[2], He - 0.04], [r[1], r[2], He - 0.04], [r[1], r[3], He - 0.04], [r[0], r[3], He - 0.04]], () => [0, 0]);
  gutterRect('bung', g.a0 - EO, g.a1 + EO, g.b1 - EO, g.b0 + EO, He);
  for (const [p, q] of [[[g.a0 - EO, g.cb0 - EC], [g.ca1 - EC, g.cb0 - EC]], [[g.ca1 - EC, g.cb0 - EC], [g.ca1 - EC, g.cb1 + EC]], [[g.ca1 - EC, g.cb1 + EC], [g.a0 - EO, g.cb1 + EC]]])
    trough('bung', p, q, He - 0.02);
  // the court's four cast-iron posts on concrete plinths (C-10), under the purlin at the overhang's edge
  for (const af of S.posts.a_from_west) for (const b of [g.cb0 - S.posts.from_wall_m, g.cb1 + S.posts.from_wall_m]) {
    const a = g.a0 + fx(af);
    box('bung', 'concrete', a - 0.13, a + 0.13, b - 0.13, b + 0.13, slab, slab + 0.3);
    box('bung', 'iron', a - 0.055, a + 0.055, b - 0.055, b + 0.055, slab + 0.3, He - 0.04);
  }
  for (const c of S.chimneys) { const R = RR[c.wing], b = R.yc; chimney('bung', c.a, b, R.Hr - 0.5, c.top, c.w); }
}

// ============================================================================================ walkway, latrine, pending block
{
  const w = PL.walkway, S = spec.walkway, slab = spec.main.slab_mPD, top = S.top_mPD;
  box('walkway', 'concrete', w.a0 + 0.2, w.a1 - 0.05, w.b1, w.b0, top - S.slab_m, top);
  poly('walkway', 'floor', [[w.a0, w.b1, slab - 0.01], [w.a1, w.b1, slab - 0.01], [w.a1, w.b0, slab - 0.01], [w.a0, w.b0, slab - 0.01]], () => [0, 0]);
  for (const f of S.columns_frac) for (const b of [w.b0 - 0.15, w.b1 + 0.15]) { const a = w.a0 + (w.a1 - w.a0) * f; box('walkway', 'render', a - 0.15, a + 0.15, b - 0.15, b + 0.15, slab, top - S.slab_m); }
}
{
  const L = PL.latrine, S = spec.latrine, slab = spec.main.slab_mPD, top = slab + S.h_m;
  const a0 = Math.min(...L.map(p => p[0])), a1 = Math.max(...L.map(p => p[0])), b0 = Math.max(...L.map(p => p[1])), b1 = Math.min(...L.map(p => p[1]));
  const lw = a1 - a0;
  wallWithOpenings('latrine', [a0, b0], [a1, b0], lw, [['door', lw * S.door_frac[0], lw * S.door_frac[1]]], slab, top, 0.5, spec.kinds);
  for (const [p, q] of [[[a1, b0], [a1, b1]], [[a1, b1], [a0, b1]], [[a0, b1], [a0, b0]]]) wallWithOpenings('latrine', p, q, 1, [], slab, top, 0.5, spec.kinds);
  box('latrine', 'concrete', a0 - 0.12, a1 + 0.12, b1 - 0.12, b0 + 0.12, top, top + 0.15);
}
const PEND = new THREE.Group(); PEND.name = 'lhtwc_pending';
{
  const S = spec.longblock, slab = 15.25, [a0, a1] = S.a, [b0, b1] = S.b;
  box('longblock', 'render', a0, a1, b1, b0, ground((a0 + a1) / 2, (b0 + b1) / 2) - 0.3, slab + S.h_m);   // in since 2026-10-30
  box('longblock', 'concrete', a0 - 0.12, a1 + 0.12, b1 - 0.12, b0 + 0.12, slab + S.h_m, slab + S.h_m + 0.15);   // flat slab, as the latrine's (inferred)
}

// ---- meshes, picking
const INFO = {
  main: { title: 'Lady Ho Tung Welfare Centre, Main Block (1932-34)', tier: 'sourced plan and heights; ' + (LOOK === '2026' ? '2026 surfaces' : 'surfaces inferred (2026 photos, faded)') },
  bung: { title: 'Lady Ho Tung Welfare Centre, Bungalow (1932-34)', tier: 'sourced plan and heights; ' + (LOOK === '2026' ? '2026 surfaces' : 'surfaces inferred (2026 photos, faded)') },
  walkway: { title: 'Covered walkway between the blocks', tier: 'sourced existence; height inferred' },
  latrine: { title: 'Latrine at the rear of the Main Block (built 1957-61)', tier: 'sourced (sheet FP2617 + Dec 1982 photo); height and roof inferred' },
  int_main: { title: 'Interior: original fabric (1933)', tier: 'sourced, bracketed 1933-2016; finishes partly inferred' },
  int_bung: { title: 'Interior: original fabric (1933)', tier: 'sourced, bracketed 1933-2016; finishes partly inferred' },
  int_48: { title: 'Interior: the 1948 police ward partition (fibreboard, 6 ft)', tier: 'sourced (1948 memo); its 1982 presence bracketed 1948-2016' },
  int_u: { title: 'Interior: an UNDATED partition (in the 2016 survey, never dated)', tier: 'inferred: may be later than 1982 (?undated=0 leaves these out)' },
  fire: { title: 'Interior: chimney breast and fireplace (original)', tier: 'sourced (position, 1933-2016); sizes and tiling inferred' },
  longblock: { title: 'The "longitudinal block" behind the Main Block', tier: 'existence sourced (Dec 1982 photo, two readings; HIA: on the 1985 aerial); size +-1 m, height and roof inferred' },
};
const SRC = {
  main: { plan: spec.src.sheet + (PLAN_ID === 'hia' ? ' -- drawn here at the HIA\'s CAD dimensions (?plan=hia)' : ''), 'verandah, openings': spec.src.hia, heights: spec.src.lidar + '; slab +15.30 mPD from the HIA CAD', surfaces: LOOK === '2026' ? spec.tiers.surfaces : 'inferred: the author\'s 2026 photos faded and weathered for 1982 (make_textures_1982.py); the 1982 colours are not recorded', 'windows, doors': 'modelled; pane layouts from IMG_5537 / IMG_5518, depths and bar widths drawing defaults (inferred)', drawn: spec.tiers.drawn },
  bung: { plan: spec.src.sheet, 'court, posts, openings': spec.src.hia, heights: 'HIA CAD section D-D (+15.33 slab, eave ~3.35 m, ridge ~4.5 m), IMG_5518', surfaces: LOOK === '2026' ? spec.tiers.surfaces : 'inferred: the 2026 photos faded for 1982', '1982 photo': 'hipped U-roof, two chimneys, the court\'s west wall seen as a lit line' },
  walkway: { what: spec.walkway.src },
  int_main: { plan: spec.interior.rule, walls: 'load-bearing on the HIA\'s Figs 30 / 36, or exterior', finishes: Object.values(spec.interior.finishes).map(f => f.what + ' (' + f.tier + ')').join('; '), surfaces: 'drawn colours, inferred: no photograph of the interior is the author\'s; the HIA\'s are reference-only and never shown' },
  int_bung: { plan: spec.interior.rule, ceiling: spec.interior.bung.ceiling.src, surfaces: 'drawn colours, inferred' },
  int_48: { source: spec.interior.main.walls.find(w => w.status === '1948').src, 'left out': 'its upper part up to the ceiling (seen in 2016): undated' },
  int_u: { source: 'HIA Fig 15 (2016); not load-bearing; the HIA records no date for it', why: 'drawn so the rooms read as in 2016; it may be later than Dec 1982' },
  fire: { source: 'HIA Fig 15 (breasts), CDE B-02 / D-01 (fireplaces, original), the chimneys on the 2010 LiDAR and the Dec 1982 photo', sizes: spec.interior.main.fire_size.src },
  latrine: { what: spec.latrine.src },
  longblock: { what: spec.longblock.src, status: spec.longblock.status },
};
const group = new THREE.Group(); group.name = 'lhtwc';
const UND = new THREE.Group(); UND.name = 'lhtwc_undated';   // the undated partitions (?undated=0 hides them)
for (const [part, mats] of Object.entries(BUILD)) for (const [k, gg] of Object.entries(mats)) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(gg.p, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(gg.uv, 2));
  geo.computeVertexNormals();
  const mm = new THREE.Mesh(geo, M[k]); mm.castShadow = mm.receiveShadow = true; mm.userData.lhtwc = part; mm.userData.mat = k;
  (part === 'longblock' ? PEND : part === 'int_u' ? UND : group).add(mm);
}
for (const [part, mats] of Object.entries(SM)) for (const [k, gg] of Object.entries(mats)) {   // rolls, gutters (own normals)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(gg.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(gg.n, 3));
  const mm = new THREE.Mesh(geo, M[k]); mm.castShadow = mm.receiveShadow = true; mm.userData.lhtwc = part; mm.userData.mat = k;
  (part === 'longblock' ? PEND : group).add(mm);
}
for (const [part, o] of EXTRA) { o.userData.lhtwc = part; group.add(o); }
scene.add(group); scene.add(PEND); scene.add(UND);
UND.visible = Q.get('undated') !== '0';
PEND.visible = Q.get('pending') !== '0';   // in since 2026-10-30: a second reading of the photo agrees (spec.longblock)
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
(window.__pickExtra = window.__pickExtra || []).push(ray => {
  const hit = ray.intersectObjects([group].concat(PEND.visible ? [PEND] : [], UND.visible ? [UND] : []), true)[0]; if (!hit) return null;
  const k = hit.object.userData.lhtwc, I = INFO[k];
  // the room the hit lies in (Fig 15's names), for anything inside
  const E = hit.point.x + CX, N = CY - hit.point.z, la = (E - FR.origin[0]) * FR.u[0] + (N - FR.origin[1]) * FR.u[1], lb = (E - FR.origin[0]) * FR.v[0] + (N - FR.origin[1]) * FR.v[1];
  const room = k.startsWith('int') || k === 'fire' ? roomAt(la, lb) : null;
  return { d: hit.distance, html: `<b>${esc(I.title)}</b> <span class="tag ${k === 'longblock' ? 't-inferred' : 't-sourced'}">${esc(I.tier)}</span><table>` +
    (room ? `<tr><td>room</td><td>${esc(room.block + ': ' + room.name)} (Fig 15's name, the clinic's at its closing in 2005; its use in Dec 1982 is not recorded)</td></tr>` : '') +
    Object.entries(SRC[k]).map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('') + `</table>` };
});

// ---- views (added to the dropdown under their own group)
{
  const bear = (p, q) => (THREE.MathUtils.radToDeg(Math.atan2(q[0] - p[0], q[1] - p[1])) + 360) % 360;
  const m = PL.main, b = PL.bung;
  const mk = (id, label, from, to, o = {}) => { const [E, N] = EN(...from); return Object.assign({ id, label, E, N, bearing: bear(EN(...from), EN(...to)), hfov: 62, eye_m: 1.6, pitch: 3, group: 'lhtwc' }, o); };
  const vs = [
    mk('lhtwc_north', 'Main Block, the entrance front (north)', [9.8, 16], [9.8, -5]),
    mk('lhtwc_ne', 'Both blocks from the north-east', [44, 14], [20, -6], { hfov: 70 }),
    mk('lhtwc_south', 'The verandah and the latrine (south)', [3, -27], [12, -8], { hfov: 70 }),
    mk('lhtwc_court', 'The Bungalow court, from its west door', [27.0, -6.8], [36, -6.8], { hfov: 85, pitch: 8 }),
    mk('lhtwc_bsouth', 'Bungalow, the south front', [31, -24], [31, -10]),
    mk('lhtwc_air', 'From above (south-west)', [-14, -34], [18, -7], { hfov: 55, eye_m: 0, y_mPD: 40, pitch: -30 }),
    // inside (2026-10-30): eye 1.6 m over the floor slab
    mk('lhtwc_in_hall', 'Inside: the waiting hall, from the entrance', [9.7, -0.9], [3.0, -6.2], { hfov: 80, eye_m: 0, y_mPD: spec.main.slab_mPD + 1.6, pitch: -2 }),
    mk('lhtwc_in_ward', 'Inside: the 1948 police ward (consultation room)', [14.1, -0.9], [10.7, -4.0], { hfov: 80, eye_m: 0, y_mPD: spec.main.slab_mPD + 1.6, pitch: -4 }),
    mk('lhtwc_in_treat', 'Inside: the treatment room and its fireplace', [7.0, -10.6], [13.2, -8.6], { hfov: 80, eye_m: 0, y_mPD: spec.main.slab_mPD + 1.6, pitch: -3 }),
    mk('lhtwc_in_bsit', 'Inside: the Bungalow, sitting room A', [b.a0 + 4.95, b.b0 - 0.75], [b.a0 + 7.2, b.b0 - 2.3], { hfov: 90, eye_m: 0, y_mPD: spec.bung.slab_mPD + 1.6, pitch: -3 }),
  ];
  const og = document.createElement('optgroup'); og.label = 'Lady Ho Tung Welfare Centre';
  for (const v of vs) { VIEWS.push(v); og.appendChild(new Option(v.label, v.id)); }
  { const [E, N] = EN(19, -9); VIEWS.push({ id: 'lhtwc_top', label: 'top (check against the 1982 photo)', E, N, bearing: 0, hfov: 24, eye_m: 0, y_mPD: 175, pitch: -89.5, group: 'lhtwc_check' }); }   // not in the dropdown
  document.getElementById('view').appendChild(og);
}
// ---- walking into it (2026-10-30): the page's own wall test reads the plain footprints, which this building replaces,
// so nothing stopped a walker at these walls. A walking step (camera.position.set, under 2 m) that would cross a wall
// of the centre, or come within 0.2 m of it, is refused here; open doors and the lobby are gaps in the walls' lines
{
  const W2 = SEG.map(([a0, b0, a1, b1, r, f]) => { const [E0, N0] = EN(a0, b0), [E1, N1] = EN(a1, b1); return [E0 - CX, CY - N0, E1 - CX, CY - N1, r, f]; });
  const dseg = (x, z, s) => { const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
    return Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t); };
  const cross = (x0, z0, x1, z1, s) => { const d = (x1 - x0) * (s[3] - s[1]) - (z1 - z0) * (s[2] - s[0]); if (Math.abs(d) < 1e-12) return false;
    const t = ((s[0] - x0) * (s[3] - s[1]) - (s[1] - z0) * (s[2] - s[0])) / d, u = ((s[0] - x0) * (z1 - z0) - (s[1] - z0) * (x1 - x0)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1; };
  const [cE, cN] = EN(19, -7), cx = cE - CX, cz = CY - cN;
  const blocked = (x0, z0, x1, z1) => { if (Math.hypot(x1 - cx, z1 - cz) > 45) return false;
    for (const s of W2) { if (s[5] === 'u' && !UND.visible) continue;
      if (cross(x0, z0, x1, z1, s)) return true; const d1 = dseg(x1, z1, s); if (d1 < s[4] && d1 < dseg(x0, z0, s)) return true; }
    return false; };
  const pos = window.__dbg.camera.position, set0 = THREE.Vector3.prototype.set;
  pos.set = function (x, y, z) { const dx = x - this.x, dz = z - this.z;
    if (dx * dx + dz * dz < 4 && (dx || dz) && blocked(this.x, this.z, x, z)) return set0.call(this, this.x, y, this.z);
    return set0.call(this, x, y, z); };
  window.__lhtwcWalls = { segments: W2.length, blocked };
}
// a check of the plan (shots only): hide the roofs and ceilings, lhtwc.lid(false)
const LID = ['pan', 'roll', 'iceil', 'ceiling', 'soffit', 'cap', 'gable', 'gutter', 'capwhite', 'band', 'render', 'concrete'];
window.lhtwc = { ready: true, lid: on => { for (const g of [group, UND, PEND]) g.traverse(o => { if (o.isMesh && (LID.includes(o.userData.mat) && (o.userData.mat !== 'render' || o.userData.lhtwc === 'main' && false))) o.visible = on; }); }, plan: PLAN_ID, meshes: group.children.length, tris: [group, UND, PEND].reduce((n, g) => n + g.children.reduce((m, o) => m + Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3), 0), 0),
  ms: { cut: TCUT, total: Math.round(performance.now() - T0) }, undated: () => UND.visible, setUndated: v => { UND.visible = !!v; }, walls: SEG.length, main: window.__lhtwcMain, pending: () => PEND.visible, setPending: v => { PEND.visible = !!v; } };
console.log('lhtwc:', window.lhtwc);
