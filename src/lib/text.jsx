/* ---------- text helpers ---------- */

export function locateClaim(full, claim) {
  if (!full || !claim) return null;
  const f = full.toLowerCase();
  const c = claim.toLowerCase().replace(/[.!?]+$/, "").trim();
  const i = f.indexOf(c);
  if (i >= 0) return [i, i + c.length];
  const words = c.split(/[^a-z0-9]+/).filter((w) => w.length > 4);
  if (words.length < 2) return null;
  const parts = full.split(/(?<=[.!?])\s+/);
  let cursor = 0, best = null, bestScore = 0;
  for (const s of parts) {
    const at = full.indexOf(s, cursor);
    if (at === -1) continue;
    cursor = at + s.length;
    const sl = s.toLowerCase();
    const score = words.filter((w) => sl.includes(w)).length;
    if (score > bestScore) { bestScore = score; best = [at, at + s.length]; }
  }
  return bestScore >= Math.max(2, Math.ceil(words.length * 0.45)) ? best : null;
}

export function segments(full, { bold, hl, fold }) {
  const pts = new Set([0, full.length]);
  [bold, hl].forEach((r) => { if (r) { pts.add(Math.max(0, r[0])); pts.add(Math.min(full.length, r[1])); } });
  if (fold > 0 && fold < full.length) pts.add(fold);
  const arr = [...pts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    const isBold = bold && a >= bold[0] && b <= bold[1];
    const isHl = hl && a >= hl[0] && b <= hl[1];
    out.push(
      <span key={a} className={isHl ? "hl" : undefined} style={isBold ? { fontWeight: 700 } : undefined}>
        {full.slice(a, b)}
      </span>
    );
    if (b === fold && b !== full.length) out.push(<span className="fold" key={"f" + b}><i />see more</span>);
  }
  return out;
}

export function diffWords(a = "", b = "") {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: "same", w: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", w: A[i] }); i++; }
    else { out.push({ t: "add", w: B[j] }); j++; }
  }
  while (i < n) out.push({ t: "del", w: A[i++] });
  while (j < m) out.push({ t: "add", w: B[j++] });
  return out;
}
