import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

window.addEventListener('error', e => showErr('JS error: ' + e.message));
window.addEventListener('unhandledrejection', e => showErr('Async error: ' + e.reason));

// ─── Renderer ────────────────────────────────────────────────────────────────
const wrap = document.getElementById('cv');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x0f1117);
wrap.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.06;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(6, 10, 6);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x5577ff, 0.35);
fill.position.set(-5, -4, -5);
scene.add(fill);

const grid  = new THREE.GridHelper(16, 32, 0x2d3748, 0x1e2230);
const axGrp = new THREE.Group();
scene.add(grid, axGrp);

function makeAxisLine(dx, dy, dz, color, len = 8) {
  const pts = [new THREE.Vector3(0,0,0), new THREE.Vector3(dx,dy,dz).normalize().multiplyScalar(len)];
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
}
axGrp.add(makeAxisLine(1,0,0,0xff5555), makeAxisLine(0,1,0,0x55ff55), makeAxisLine(0,0,1,0x5555ff));

const solidGrp  = new THREE.Group();
const diskGrp   = new THREE.Group();
const curveGrp  = new THREE.Group();
const markerGrp = new THREE.Group();
scene.add(solidGrp, diskGrp, curveGrp, markerGrp);

// ─── Resize ───────────────────────────────────────────────────────────────────
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(resize).observe(wrap);
(function loop() { requestAnimationFrame(loop); orbit.update(); renderer.render(scene, camera); })();

// ─── Helpers ─────────────────────────────────────────────────────────────────
function disposeGroup(grp) {
  grp.traverse(obj => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material.dispose();
    }
  });
  while (grp.children.length) grp.remove(grp.children[0]);
}

function interpR(xs, rs, t) {
  if (!xs || !rs || rs.length === 0) return 0;
  const n = xs.length;
  const i = Math.max(0, Math.min(n-1, Math.round((t - xs[0]) / (xs[n-1] - xs[0]) * (n-1))));
  return rs[i] ?? 0;
}

// ─── Geometry ─────────────────────────────────────────────────────────────────
function buildRevSurface(xs, rs, axis, rSeg = 60) {
  const aSeg = xs.length - 1;
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= aSeg; i++) {
    const t = xs[i], r = Math.max(0, rs[i]);
    for (let j = 0; j <= rSeg; j++) {
      const theta = 2 * Math.PI * j / rSeg;
      const c = Math.cos(theta), s = Math.sin(theta);
      if (axis === 'x') { pos.push(t,r*c,r*s); nor.push(0,c,s); }
      else               { pos.push(r*c,t,r*s); nor.push(c,0,s); }
    }
  }
  for (let i = 0; i < aSeg; i++) {
    for (let j = 0; j < rSeg; j++) {
      const a0=i*(rSeg+1)+j, b0=a0+1, c0=(i+1)*(rSeg+1)+j, d0=c0+1;
      idx.push(a0,c0,b0, b0,c0,d0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function buildCap(outerR, innerR, pos, axis, flip) {
  const g = new THREE.RingGeometry(Math.max(0, innerR), Math.max(0.001, outerR), 60);
  if (axis === 'x') { g.rotateY(flip ? -Math.PI/2 : Math.PI/2); g.translate(pos,0,0); }
  else              { g.rotateX(flip ?  Math.PI/2 : -Math.PI/2); g.translate(0,pos,0); }
  return g;
}

function buildOneDisk(pos, R, r, thick, axis, color) {
  const grp = new THREE.Group();
  const oGeo = new THREE.CylinderGeometry(R, R, thick, 48);
  if (axis === 'x') oGeo.rotateZ(Math.PI / 2);
  const oMesh = new THREE.Mesh(oGeo, new THREE.MeshPhongMaterial({ color, transparent:true, opacity:0.7, shininess:60, side:THREE.DoubleSide }));
  if (axis === 'x') oMesh.position.x = pos; else oMesh.position.y = pos;
  grp.add(oMesh);
  if (r > 0.005) {
    const iGeo = new THREE.CylinderGeometry(r*1.01, r*1.01, thick*1.02, 48);
    if (axis === 'x') iGeo.rotateZ(Math.PI / 2);
    const iMesh = new THREE.Mesh(iGeo, new THREE.MeshPhongMaterial({ color: 0x0f1117 }));
    if (axis === 'x') iMesh.position.x = pos; else iMesh.position.y = pos;
    grp.add(iMesh);
    const rGeo = new THREE.RingGeometry(r, r+0.008, 48);
    if (axis === 'x') { rGeo.rotateY(Math.PI/2); rGeo.translate(pos,0,0); }
    else              { rGeo.rotateX(-Math.PI/2); rGeo.translate(0,pos,0); }
    grp.add(new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({ color:0xf6ad55, side:THREE.DoubleSide })));
  }
  return grp;
}

function buildCurve(xs, ys, axis, color) {
  const pts = xs.map((t, i) => axis === 'x' ? new THREE.Vector3(t,ys[i],0) : new THREE.Vector3(ys[i],t,0));
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
}

// ─── State ────────────────────────────────────────────────────────────────────
let S = null;
const DISK_PALETTE = [0x3182ce, 0x38a169, 0xd69e2e, 0x9f7aea, 0xdd6b20, 0x00b5d8];

// ─── Scene ────────────────────────────────────────────────────────────────────
function buildScene() {
  if (!S) return;
  disposeGroup(solidGrp); disposeGroup(diskGrp); disposeGroup(curveGrp); disposeGroup(markerGrp);
  const { xs, outer_r, inner_r, axis, a, b } = S;

  if (document.getElementById('chkSolid').checked) {
    const oGeo = buildRevSurface(xs, outer_r, axis);
    solidGrp.add(new THREE.Mesh(oGeo, new THREE.MeshPhongMaterial({ color:0x4299e1, transparent:true, opacity:0.28, side:THREE.FrontSide, shininess:90 })));
    solidGrp.add(new THREE.Mesh(oGeo, new THREE.MeshBasicMaterial({ color:0x63b3ed, wireframe:true, transparent:true, opacity:0.07 })));
    const capMat = new THREE.MeshPhongMaterial({ color:0x4299e1, transparent:true, opacity:0.45, side:THREE.DoubleSide });
    solidGrp.add(new THREE.Mesh(buildCap(outer_r[0], inner_r?inner_r[0]:0, a, axis, false), capMat));
    solidGrp.add(new THREE.Mesh(buildCap(outer_r[outer_r.length-1], inner_r?inner_r[inner_r.length-1]:0, b, axis, true), capMat));
    if (inner_r) {
      solidGrp.add(new THREE.Mesh(buildRevSurface(xs, inner_r, axis), new THREE.MeshPhongMaterial({ color:0xf6ad55, transparent:true, opacity:0.28, side:THREE.BackSide, shininess:80 })));
    }
  }

  if (document.getElementById('chkDisks').checked) {
    const n = parseInt(document.getElementById('nSlider').value);
    const dx = (b - a) / n;
    for (let i = 0; i < n; i++) {
      const t = a + (i + 0.5) * dx;
      diskGrp.add(buildOneDisk(t, Math.max(0.001, interpR(xs,outer_r,t)), inner_r?Math.max(0,interpR(xs,inner_r,t)):0, dx*0.85, axis, DISK_PALETTE[i%DISK_PALETTE.length]));
    }
  }

  if (document.getElementById('chkCurve').checked) {
    curveGrp.add(buildCurve(xs, outer_r, axis, 0xff6b6b));
    if (inner_r) curveGrp.add(buildCurve(xs, inner_r, axis, 0xf6ad55));
  }

  updateMarker();
}

// ─── Marker ───────────────────────────────────────────────────────────────────
function updateMarker() {
  if (!S) return;
  disposeGroup(markerGrp);
  const { xs, outer_r, inner_r, a, b, axis } = S;
  const t = a + (b - a) * document.getElementById('xSlider').value / 100;
  document.getElementById('xDisp').textContent     = t.toFixed(3);
  document.getElementById('xbarLabel').textContent = `Sección en ${axis} =`;

  const R = interpR(xs, outer_r, t);
  const r = inner_r ? interpR(xs, inner_r, t) : 0;
  document.getElementById('rLabel2').textContent     = `R(${axis}=${t.toFixed(3)}) =`;
  document.getElementById('rDisp').textContent       = R.toFixed(5) + ' u';
  document.getElementById('rInnerLabel').textContent = `r(${axis}=${t.toFixed(3)}) =`;
  document.getElementById('rInnerDisp').textContent  = r.toFixed(5) + ' u';
  document.getElementById('areaDisp').textContent    = (Math.PI * (R*R - r*r)).toFixed(5) + ' u²';

  const rGeo = new THREE.RingGeometry(Math.max(0,r), Math.max(0.001,R), 64);
  if (axis === 'x') { rGeo.rotateY(Math.PI/2); rGeo.translate(t,0,0); }
  else              { rGeo.rotateX(-Math.PI/2); rGeo.translate(0,t,0); }
  markerGrp.add(new THREE.Mesh(rGeo, new THREE.MeshBasicMaterial({ color:0xffd700, side:THREE.DoubleSide, transparent:true, opacity:0.85 })));

  const addLine = (p1, p2, color) => markerGrp.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1,p2]), new THREE.LineBasicMaterial({ color })));
  const origin  = axis==='x' ? new THREE.Vector3(t,0,0) : new THREE.Vector3(0,t,0);
  const innerPt = axis==='x' ? new THREE.Vector3(t,r,0) : new THREE.Vector3(r,t,0);
  const outerPt = axis==='x' ? new THREE.Vector3(t,R,0) : new THREE.Vector3(R,t,0);
  if (r > 0.001) { addLine(origin,innerPt,0xf6ad55); addLine(innerPt,outerPt,0x4299e1); }
  else           { addLine(origin,outerPt,0x4299e1); }
  addLine(axis==='x'?new THREE.Vector3(t,-0.12,0):new THREE.Vector3(-0.12,t,0),
          axis==='x'?new THREE.Vector3(t, 0.12,0):new THREE.Vector3( 0.12,t,0), 0xffd700);
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function calculate() {
  document.getElementById('errMsg').classList.add('hidden');
  const goBtn = document.getElementById('go');
  goBtn.textContent = 'Calculando…'; goBtn.disabled = true;
  try {
    const body = {
      method: document.querySelector('.tab.active').dataset.m,
      axis:   document.querySelector('.axis-pill.active').dataset.axis,
      f: document.getElementById('fIn').value.trim(),
      g: document.getElementById('gIn').value.trim(),
      a: parseFloat(document.getElementById('aIn').value),
      b: parseFloat(document.getElementById('bIn').value),
      n: parseInt(document.getElementById('nSlider').value),
    };
    if (isNaN(body.a) || isNaN(body.b)) { showErr('Intervalo inválido'); return; }
    if (!body.f) { showErr('Ingresa f(x)'); return; }

    const resp = await fetch('/api/calc', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const text = await resp.text();
    let res;
    try { res = JSON.parse(text); } catch { showErr('Error del servidor (HTTP ' + resp.status + '): ' + text.slice(0,300)); return; }
    if (res.error) { showErr(res.error); return; }

    S = res;
    buildScene();
    document.getElementById('formulaDisp').innerHTML = res.formula;
    document.getElementById('volDisp').textContent   = res.volume.toFixed(6) + ' u³';
    document.getElementById('volPi').textContent     = res.volume_pi.toFixed(6) + ' π u³';
    document.getElementById('rInnerRow').classList.toggle('hidden', !res.inner_r);
    document.getElementById('legInner').classList.toggle('hidden',  !res.inner_r);
    document.getElementById('info').classList.remove('hidden');
    document.getElementById('xbar').classList.remove('hidden');

    const mid = (res.a+res.b)/2, span = res.b-res.a;
    if (res.axis === 'x') { camera.position.set(mid+span, span*0.9, span*1.6); orbit.target.set(mid,0,0); }
    else                  { camera.position.set(span*1.2, mid+span, span*1.6); orbit.target.set(0,mid,0); }
    orbit.update();
  } finally {
    goBtn.textContent = 'Calcular y Visualizar'; goBtn.disabled = false;
  }
}

// ─── UI wiring ────────────────────────────────────────────────────────────────
document.getElementById('go').addEventListener('click', calculate);

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('gRow').classList.toggle('hidden', tab.dataset.m === 'disk');
}));
document.getElementById('gRow').classList.add('hidden');

document.querySelectorAll('.axis-pill').forEach(pill => pill.addEventListener('click', () => {
  document.querySelectorAll('.axis-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  const v = pill.dataset.axis;
  document.getElementById('fLabel').textContent        = `R(${v}) = f(${v}) — radio exterior`;
  document.getElementById('gLabel').textContent        = `r(${v}) = g(${v}) — radio interior`;
  document.getElementById('intervalLabel').textContent = `Intervalo en ${v}: [a, b]`;
}));

document.getElementById('nSlider').addEventListener('input', e => {
  document.getElementById('nVal').textContent = e.target.value;
  if (S) buildScene();
});

['chkSolid','chkDisks','chkCurve'].forEach(id => document.getElementById(id).addEventListener('change', () => { if (S) buildScene(); }));
document.getElementById('chkAxes').addEventListener('change', e => { grid.visible = axGrp.visible = e.target.checked; });
document.getElementById('xSlider').addEventListener('input', updateMarker);

function showErr(msg) {
  const el = document.getElementById('errMsg');
  el.textContent = msg;
  el.classList.remove('hidden');
}
