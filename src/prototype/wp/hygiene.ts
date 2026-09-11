/* Text and number hygiene, shared by the PDF reader and the row pipeline.

   It lives in its own module because pdfText.ts must use it and engine.ts
   imports pdfText.ts — putting it in engine.ts would make the cycle.

   Two problems that look cosmetic and are not.

   A PDF producer writes "oﬃce" with the ffi LIGATURE, a non-breaking space
   between a number and its currency, curly quotes in a caption and an en dash
   where a hyphen belongs. Every one of those is a different code point from the
   ASCII the keyword lexicon is written in, so the caption simply does not
   match, and the row goes to the unmatched list with no visible reason — the
   two strings look identical on screen. Folding them is what lets the lexicon
   stay plain ASCII. C0 control characters are stripped for the same reason,
   except tab, newline and carriage return, which carry structure.

   And a spreadsheet cell holding 0.1 + 0.2 shows 0.30000000000000004 in the
   generated workbook. Two-decimal rounding has to bias by EPSILON on the
   ABSOLUTE value and restore the sign afterwards, or -1.005 and 1.005 round in
   opposite directions. */

const LIGATURES: Record<string, string> = {
  "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
  "\ufb05": "st", "\ufb06": "st",
  "\u00a0": " ",
  "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-",
};

/** Fold typographic look-alikes to ASCII and drop control characters.
    null and undefined pass through untouched — this is called on values whose
    absence is meaningful. */
export function sanitize<T>(value: T): T {
  if (value == null) return value;
  const out = String(value)
    .replace(/[\ufb00-\ufb06\u00a0\u2018\u2019\u201c\u201d\u2013\u2014\u2212]/g, (ch) => LIGATURES[ch] ?? ch)
    // C0 controls and DEL, but never tab (09), LF (0A) or CR (0D).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return out as unknown as T;
}

/** Round to 2 dp, sign-symmetrically. Non-numbers pass through. */
export function r2<T>(value: T): T {
  if (typeof value !== "number" || !isFinite(value)) return value;
  const rounded = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  return (value < 0 ? -rounded : rounded) as unknown as T;
}

/** Accumulate two possibly-absent numbers and round once. Without this, a
    column of twenty contributions carries twenty float errors into the cell. */
export function r2add(a: unknown, b: unknown): number {
  return r2((typeof a === "number" && isFinite(a) ? a : 0) + (typeof b === "number" && isFinite(b) ? b : 0));
}

