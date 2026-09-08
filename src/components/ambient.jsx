import { useEffect, useRef } from "react";
import { P, S } from "../lib/pointer.js";

/* ============================================================
   AMBIENT
   ============================================================ */

export function Glow({ style }) { return <div className="glow" style={style} />; }

export function CursorField({ theme }) {
  const blob = useRef(null), ring = useRef(null);
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    let bx = P.px, by = P.py, rx = P.px, ry = P.py, raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      bx += (P.px - bx) * 0.055; by += (P.py - by) * 0.055;
      rx += (P.px - rx) * 0.2; ry += (P.py - ry) * 0.2;
      if (blob.current) blob.current.style.transform = `translate3d(${bx - 220}px,${by - 220}px,0)`;
      if (ring.current) ring.current.style.transform = `translate3d(${rx - 13}px,${ry - 13}px,0)`;
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (<><div ref={blob} className="cursor-blob" data-t={theme} /><div ref={ring} className="cursor-ring" /></>);
}


export function Mark({ size = 26 }) {
  const outer = useRef(null), inner = useRef(null), dot = useRef(null);
  useEffect(() => {
    let a = 0, b = 0, raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const target = S.p * 260 + (P.x - 0.5) * 26;
      a += (target - a) * 0.08; b += (-target * 0.7 - b) * 0.08;
      outer.current?.setAttribute("transform", `rotate(${a} 24 24)`);
      inner.current?.setAttribute("transform", `rotate(${b} 24 24)`);
      dot.current?.setAttribute("r", String(4 + Math.sin(a / 40) * 0.9));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="mark-svg" aria-hidden="true">
      <defs>
        <linearGradient id="ug" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" /><stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <g ref={outer}>
        <path d="M24 4 A20 20 0 0 1 44 24" fill="none" stroke="url(#ug)" strokeWidth="4" strokeLinecap="round" />
        <path d="M24 44 A20 20 0 0 1 4 24" fill="none" stroke="url(#ug)" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g ref={inner}>
        <path d="M24 13 A11 11 0 0 1 35 24" fill="none" stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" opacity="0.9" />
      </g>
      <circle ref={dot} cx="24" cy="24" r="4" fill="url(#ug)" />
    </svg>
  );
}
