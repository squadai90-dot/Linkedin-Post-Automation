import { useState, useEffect } from "react";

/* ---------- hooks ---------- */

export function useNarrow(bp = 1120) {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(`(max-width:${bp}px)`);
    const h = () => setN(m.matches);
    h();
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, [bp]);
  return n;
}
