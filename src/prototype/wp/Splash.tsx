"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";

export function Splash() {
  const [gone, setGone] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setGone(true), 1050);
    const t2 = setTimeout(() => setRemoved(true), 1650);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (removed) return null;

  return (
    <div className={gone ? "splash gone" : "splash"} aria-hidden="true">
      <div className="splash-bg">
        <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
          <g stroke="#24406b" strokeWidth="1" fill="none" opacity=".75">
            <path d="M0 120H1200M0 240H1200M0 360H1200M0 480H1200M0 600H1200" />
            <path d="M200 0V700M400 0V700M600 0V700M800 0V700M1000 0V700" />
          </g>
          <path
            d="M120 520 280 400 400 440 560 300 720 340 880 210 1060 250"
            fill="none" stroke="#3dd7b5" strokeWidth="1.6" strokeOpacity=".55"
          />
          <g fill="#3dd7b5" opacity=".85">
            <circle cx="280" cy="400" r="3" /><circle cx="560" cy="300" r="3" />
            <circle cx="880" cy="210" r="3" /><circle cx="1060" cy="250" r="3" />
          </g>
          <g fill="#1b3358" opacity=".8">
            <rect x="140" y="150" width="110" height="140" rx="6" />
            <rect x="950" y="420" width="110" height="140" rx="6" />
          </g>
          <g stroke="#2c4c7d" strokeWidth="4" strokeLinecap="round">
            <path d="M160 178h62M160 198h46M160 218h70M970 448h62M970 468h46M970 488h70" />
          </g>
        </svg>
      </div>
      <div className="splash-inner">
        <BrandMark size={62} />
        <strong>5471 Work Paper</strong>
        <span className="splash-rule" />
        <em>AI workpaper automation</em>
      </div>
    </div>
  );
}
