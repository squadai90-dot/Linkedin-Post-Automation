/* Scroll-driven three.js background. Loaded lazily by App. */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { P, S } from "../lib/pointer.js";

/* ---------- scroll-driven 3D pipeline ----------
   Ten stages mapped to the content pipeline. Objects enter from depth,
   hold while their stage is active, then recede. Scroll drives everything;
   nothing spins on its own. Sits behind the UI and never takes pointer events. */

/* ---------- scroll-driven 3D object ----------
   One object, always on screen: a nested gimbal with a faceted core and ten
   markers around the outer ring — one per pipeline stage. Scroll turns the
   whole assembly a single slow 360 and lights the markers as you pass them. */

/* ---------- scroll-driven 3D object ----------
   One object, always on screen: a nested gimbal with a plated core and ten
   markers around the outer ring — one per pipeline stage. Scroll turns the
   whole assembly a single slow 360 and lights the markers as you pass them.
   On the landing it also comes apart: every piece is on its own spring, so
   scrolling down kicks them outward and scrolling up snaps them home with a
   short flare. State is a pure function of scroll position, so it can never
   end up stuck half-broken. */

export function PipelineScene({ theme, level = 1, fragment = false }) {
  const host = useRef(null);
  useEffect(() => {
    const el = host.current;
    if (!el || !level) return;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) { return; }

    const low = window.innerWidth < 820;
    const dark = theme !== "light";
    const W = () => el.clientWidth || window.innerWidth;
    const H = () => el.clientHeight || window.innerHeight;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 1.75));
    renderer.setSize(W(), H());
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping !== undefined) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = dark ? 0.92 : 0.98;
    }
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(dark ? 0x04060a : 0xf1f4f9, 8, 28);
    const camera = new THREE.PerspectiveCamera(36, W() / H(), 0.1, 60);
    camera.position.set(0, 0.35, 8.4);

    const ACC = 0x7c8cff, ACC2 = 0x39d3c7;
    const METAL = dark ? 0x101724 : 0xd2d9e4;

    scene.add(new THREE.AmbientLight(dark ? 0x232c47 : 0xffffff, dark ? 0.4 : 0.8));
    const key = new THREE.DirectionalLight(0xffffff, dark ? 0.95 : 1.05);
    key.position.set(4.5, 7, 6);
    if (!low) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.near = 1; key.shadow.camera.far = 30;
      key.shadow.camera.left = -8; key.shadow.camera.right = 8;
      key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
      key.shadow.bias = -0.0009;
    }
    scene.add(key);
    const RIM = dark ? 2.0 : 1.2;
    const rim = new THREE.PointLight(ACC, RIM, 26); rim.position.set(-6, 2, -3.5); scene.add(rim);
    const fill = new THREE.PointLight(ACC2, dark ? 0.95 : 0.6, 22); fill.position.set(5.5, -2.5, 3); scene.add(fill);

    const geos = [], mats = [];
    const G = (g) => { geos.push(g); return g; };
    const M = (o) => { const m = new THREE.MeshStandardMaterial(o); mats.push(m); return m; };

    const shellMat = M({ color: METAL, metalness: 0.8, roughness: 0.42 });
    const darkMat = M({ color: dark ? 0x0d1320 : 0xc3cbd9, metalness: 0.6, roughness: 0.45 });
    const CORE_EM = dark ? 0.4 : 0.2;
    const coreMat = M({ color: ACC, emissive: ACC, emissiveIntensity: CORE_EM, metalness: 0.45, roughness: 0.34, side: THREE.DoubleSide });
    const litMat = M({ color: ACC2, emissive: ACC2, emissiveIntensity: dark ? 1.15 : 0.4, metalness: 0.4, roughness: 0.25 });
    const dimMat = M({ color: dark ? 0x2b3550 : 0xb6bfd0, metalness: 0.4, roughness: 0.55 });
    const cageMat = M({ color: dark ? 0x8fa0d8 : 0x7d8aa8, wireframe: true, metalness: 0.2, roughness: 0.7, transparent: true, opacity: 0.2 });

    const BASE = low ? 0.66 : 0.9;
    const rig = new THREE.Group();
    rig.position.set(0, -0.85, -1.6);
    rig.scale.setScalar(BASE);
    scene.add(rig);

    const ringA = new THREE.Group(); rig.add(ringA);
    const ringB = new THREE.Group(); rig.add(ringB);
    const ringC = new THREE.Group(); rig.add(ringC);
    const coreG = new THREE.Group(); rig.add(coreG);
    ringB.rotation.set(0, Math.PI / 2, 0.35);
    ringC.rotation.set(1.05, 0, 0.4);

    /* deterministic jitter so the object looks the same on every load */
    let seed = 20260831;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

    const pieces = [];
    const addPiece = (m, dir, opts = {}) => {
      const p = {
        m, mat: opts.mat || null, fade: !!opts.fade,
        baseOpacity: opts.mat ? opts.mat.opacity : 1,
        hx: m.position.x, hy: m.position.y, hz: m.position.z,
        rx: m.rotation.x, ry: m.rotation.y, rz: m.rotation.z,
        dx: dir.x, dy: dir.y, dz: dir.z,
        dist: opts.dist ?? (1.8 + rnd() * 3.0),
        sx: (rnd() - 0.5) * 0.9, sy: (rnd() - 0.5) * 0.9, sz: (rnd() - 0.5) * 0.9,
        k: 0.075 + rnd() * 0.07,     // stiffness — varies so it comes apart in a wave
        damp: 0.80 + rnd() * 0.07,   // under-damped, which is where the overshoot comes from
        cur: 0, v: 0,
      };
      pieces.push(p);
      return p;
    };
    const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };

    const mesh = (geo, mat, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = !low; m.receiveShadow = !low;
      (parent || rig).add(m);
      return m;
    };

    /* three gimbal rings, each broken into eight arcs */
    const SEG = 8, GAPF = 0.8;
    const ringSpec = [[1.5, 0.045, ringA, shellMat], [1.95, 0.032, ringB, shellMat], [2.45, 0.022, ringC, darkMat]];
    ringSpec.forEach(([R, tube, group, mat]) => {
      const arc = (Math.PI * 2 / SEG) * GAPF;
      const geo = G(new THREE.TorusGeometry(R, tube, low ? 6 : 12, low ? 10 : 22, arc));
      for (let i = 0; i < SEG; i++) {
        const start = (i / SEG) * Math.PI * 2;
        const m = mesh(geo, mat, group);
        m.rotation.z = start;
        const mid = start + arc / 2;
        addPiece(m, norm(Math.cos(mid), Math.sin(mid), (rnd() - 0.5) * 0.7), { dist: 1.7 + rnd() * 2.9 });
      }
    });

    /* shattered core — the twenty faces of an icosahedron, each extruded back to
       a shared inner apex. Assembled they form one solid with no seams; apart
       they are clean wedges rather than a pile of loose squares. */
    const srcIco = new THREE.IcosahedronGeometry(0.92, 0);
    const flat = srcIco.index ? srcIco.toNonIndexed() : srcIco;
    const pos = flat.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      const a = [pos[i], pos[i + 1], pos[i + 2]];
      const b = [pos[i + 3], pos[i + 4], pos[i + 5]];
      const c = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const o = [(a[0] + b[0] + c[0]) / 3 * 0.14, (a[1] + b[1] + c[1]) / 3 * 0.14, (a[2] + b[2] + c[2]) / 3 * 0.14];
      const v = [a, b, c, o];
      const tris = [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]];
      const verts = [];
      tris.forEach(([x, y, z]) => verts.push(...v[x], ...v[y], ...v[z]));
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      const cx = (a[0] + b[0] + c[0] + o[0]) / 4, cy = (a[1] + b[1] + c[1] + o[1]) / 4, cz = (a[2] + b[2] + c[2] + o[2]) / 4;
      g.translate(-cx, -cy, -cz);
      g.computeVertexNormals();
      const m = mesh(G(g), coreMat, coreG);
      m.position.set(cx, cy, cz);
      addPiece(m, norm(cx, cy, cz), { dist: 2.1 + rnd() * 3.0 });
    }
    srcIco.dispose();
    if (flat !== srcIco) flat.dispose();
    const cage = mesh(G(new THREE.IcosahedronGeometry(1.02, 0)), cageMat, coreG);
    addPiece(cage, norm(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5), { dist: 1.0, mat: cageMat, fade: true });

    /* ten stage markers riding the outer ring */
    const markerGeo = G(new THREE.BoxGeometry(0.16, 0.16, 0.16));
    const markers = [];
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      const m = mesh(markerGeo, dimMat, ringC);
      m.position.set(Math.cos(ang) * 2.45, Math.sin(ang) * 2.45, 0);
      m.rotation.z = ang;
      markers.push(m);
      addPiece(m, norm(Math.cos(ang), Math.sin(ang), (rnd() - 0.5) * 0.5), { dist: 2.0 + rnd() * 2.6 });
    }

    if (!low) {
      const floorMat = new THREE.ShadowMaterial({ opacity: dark ? 0.4 : 0.16 });
      mats.push(floorMat);
      const floor = new THREE.Mesh(G(new THREE.PlaneGeometry(50, 50)), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -3.4;
      floor.receiveShadow = true;
      scene.add(floor);
    }

    /* ---- animation ---- */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf, cur = 0, mx = 0, my = 0, t = 0, lastLit = -1, flare = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;

      cur += (S.p - cur) * (reduce ? 1 : 0.045);
      const tmx = P.x - 0.5, tmy = P.y - 0.5;
      mx += (tmx - mx) * 0.035;
      my += (tmy - my) * 0.035;
      t += reduce ? 0 : 1;

      const turn = cur * Math.PI * 2;
      const drift = t * 0.00035;
      const f = fragment ? cur : 0;

      /* every piece is a spring chasing its scattered position — the lag gives
         the outward kick going down and the magnetic snap coming back up */
      let vsum = 0;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        p.v += (f * p.dist - p.cur) * p.k;
        p.v *= p.damp;
        p.cur += p.v;
        vsum += p.v < 0 ? -p.v : p.v;
        const d = p.cur;
        p.m.position.set(p.hx + p.dx * d, p.hy + p.dy * d, p.hz + p.dz * d);
        p.m.rotation.set(p.rx + p.sx * d, p.ry + p.sy * d, p.rz + p.sz * d);
        p.m.scale.setScalar(1 - 0.2 * Math.min(1, d / 4.5));
        if (p.fade && p.mat) p.mat.opacity = p.baseOpacity * Math.max(0, 1 - d / 0.9);
      }

      /* pieces arriving home fast = impact */
      const avg = vsum / pieces.length;
      if (f < 0.1 && avg > 0.006) flare = Math.min(1, flare + avg * 5);
      flare *= 0.86;
      rim.intensity = RIM * (1 + flare * 1.8);
      coreMat.emissiveIntensity = CORE_EM * (1 + flare * 1.4);

      rig.rotation.y = turn + drift + mx * 0.32;
      rig.rotation.x = -0.12 + my * 0.16 + Math.sin(turn * 0.5) * 0.06;
      ringA.rotation.z = -turn * 0.55 + drift * 0.6;
      ringB.rotation.x = turn * 0.4 - drift * 0.4;
      ringC.rotation.z = 0.4 + turn * 0.22;
      coreG.rotation.y = -turn * 1.2;
      coreG.rotation.x = turn * 0.6;

      /* pull the cloud back as it opens so nothing sails off screen */
      rig.scale.setScalar(BASE * (1 + Math.sin(cur * Math.PI) * 0.06 - f * 0.2 + flare * 0.05));
      rig.position.set(mx * 0.7, -0.85 - my * 0.5 + Math.sin(cur * Math.PI * 2) * 0.12, -1.6 - f * 4.2);

      const lit = Math.min(9, Math.floor(cur * 10 + 0.0001));
      if (lit !== lastLit) {
        markers.forEach((m, i) => { m.material = i <= lit ? litMat : dimMat; });
        lastLit = lit;
      }

      camera.position.x = mx * 0.4;
      camera.position.y = 0.35 - my * 0.28;
      camera.lookAt(0, -0.6, -1.6);
      renderer.render(scene, camera);
    };
    tick();

    const resize = () => {
      renderer.setSize(W(), H());
      camera.aspect = W() / H();
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
    };
  }, [theme, level, fragment]);

  if (!level) return null;
  return <div ref={host} className="scene3d" style={{ opacity: level }} aria-hidden="true" />;
}
