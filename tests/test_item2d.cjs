/* Item 2d (books & records custodian) — extraction must handle BOTH shapes:
 *
 *   populated : 2Hats Consulting B.V.  — name + 3 address lines in the box
 *   EMPTY     : Boating Made Easy Ltd  — box blank, Schedule A begins directly
 *               underneath. The first version of this extractor had no stop
 *               boundary and harvested Schedule A's column headers, producing
 *               B21 = "(b) Number of shares issued and outstanding".
 *
 * An empty 2d box is normal and common (2c is usually empty too), so "reads
 * nothing" is the CORRECT result, not a failure.
 */
const assert = require("assert");
const path = require("path");
const esbuild = require("esbuild");

function load() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src/prototype/wp/carryForward.ts")],
    bundle: true, write: false, format: "cjs", platform: "node", logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const CF = load();

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok:", name); pass++; } catch (e) { console.log("FAILED:", name, "-", e.message); fail++; } };

/* The extraction loop, replayed exactly as carryForward runs it. */
function extract2d(face, faceGeo) {
  const out = { booksPerson: undefined, booksAddress: [] };
  let seen = false;
  for (let ri = 0; ri < face.length; ri++) {
    const r = face[ri];
    if (out.booksPerson || seen) continue;
    if (!CF.isBooksCaptionStart(face, ri, r)) continue;
    seen = true;
    const geoCaption = faceGeo[ri];
    const boxCell = (geoCaption && geoCaption.cells.find((c) => /name and address\s*\(including/i.test(c.text)))
      || (geoCaption && geoCaption.cells[0]);
    const boxX = boxCell ? boxCell.x0 : null;
    const lines = [];
    let started = false;
    for (let j = ri + 1; j <= ri + 12 && j < face.length; j++) {
      const cand = face[j];
      if (cand.page !== r.page) break;
      if (/^schedule\s+[a-z]\b|stock of the foreign corporation/i.test(cand.cells.join(" "))) break;
      const geo = faceGeo[j];
      const cells = geo && boxX !== null
        ? geo.cells.filter((c) => c.x0 >= boxX - 8).map((c) => c.text)
        : cand.cells;
      const first = (cells[0] || "").trim();
      if (!first) continue;
      if (!started && CF.isBooksCaptionText(first)) continue;
      if (!/[A-Za-z]/.test(first) || CF.looksLikeCaption(first)) continue;
      if (CF.isFormStructure(first)) continue;
      started = true;
      lines.push(first);
      if (lines.length >= 4) break;
    }
    if (lines.length) {
      out.booksPerson = lines[0];
      if (lines[1]) out.booksAddress.push(lines[1]);
      if (lines.length > 2) out.booksAddress.push(lines.slice(2).join(", "));
    }
  }
  return out;
}

const mk = (rows) => ({
  face: rows.map((cells) => ({ page: 1, cells })),
  geo: rows.map((cells) => ({ page: 1, cells: cells.map((text, i) => ({ text, x0: 660 + i * 90 })) })),
});

/* ---- case 1: populated box (2Hats) ---- */
const populated = mk([
  ["c Name and address of foreign corporation's statutory or resident agent"],
  ["d Name and address (including corporate department, if applicable) of"],
  ["person (or persons) with custody of the books and records of the foreign"],
  ["corporation, and the location of such books and records, if different"],
  ["WILLIAM M. PHILLIPPE"],
  ["VEERSTRADT 38H"],
  ["AMSTERDAM, SW 1075"],
  ["NETHERLANDS"],
  ["Schedule A  Stock of the Foreign Corporation"],
]);

t("populated box still reads the custodian and every address line", () => {
  const r = extract2d(populated.face, populated.geo);
  assert.strictEqual(r.booksPerson, "WILLIAM M. PHILLIPPE");
  assert.strictEqual(r.booksAddress[0], "VEERSTRADT 38H");
  assert.strictEqual(r.booksAddress[1], "AMSTERDAM, SW 1075, NETHERLANDS");
});

/* ---- case 2: EMPTY box (Boating Made Easy) ---- */
const empty = mk([
  ["c Name and address of foreign corporation's statutory or resident agent"],
  ["in country of incorporation"],
  ["d Name and address (including corporate department, if applicable) of"],
  ["person (or persons) with custody of the books and records of the foreign"],
  ["corporation, and the location of such books and records, if different"],
  ["Schedule A", "Stock of the Foreign Corporation"],
  ["(b) Number of shares issued and outstanding"],
  ["(a) Description of each class of stock"],
  ["(i) Beginning of annual accounting period"],
  ["(ii) End of annual accounting period"],
  ["COMMON", "200.", "200."],
]);

t("EMPTY box reads nothing — no Schedule A header is harvested", () => {
  const r = extract2d(empty.face, empty.geo);
  assert.strictEqual(r.booksPerson, undefined, `leaked: ${r.booksPerson}`);
  assert.deepStrictEqual(r.booksAddress, []);
});

t("the exact reported leak can no longer occur", () => {
  const r = extract2d(empty.face, empty.geo);
  const leaked = [r.booksPerson, ...r.booksAddress].filter(Boolean).join(" | ");
  for (const bad of ["Number of shares", "Description of each class", "accounting period", "COMMON"]) {
    assert.ok(!leaked.includes(bad), `still leaks "${bad}"`);
  }
});

t("form scaffolding is recognised as structure, real names are not", () => {
  for (const s of ["(b) Number of shares issued and outstanding",
                   "(a) Description of each class of stock",
                   "(i) Beginning of annual accounting period",
                   "(ii) End of annual accounting period"]) {
    assert.ok(CF.isFormStructure(s), `should be structure: ${s}`);
  }
  for (const n of ["WILLIAM M. PHILLIPPE", "VEERSTRADT 38H", "AMSTERDAM, SW 1075",
                   "NETHERLANDS", "Wilbur Thompson", "256 NORTH CHURCH ST"]) {
    assert.ok(!CF.isFormStructure(n), `should NOT be structure: ${n}`);
  }
});

t("the scan stops at Schedule A even when the box has one line", () => {
  const oneLine = mk([
    ["d Name and address (including corporate department, if applicable) of"],
    ["person (or persons) with custody of the books and records of the foreign"],
    ["corporation, and the location of such books and records, if different"],
    ["ACME TRUST SERVICES LTD"],
    ["Schedule A  Stock of the Foreign Corporation"],
    ["(a) Description of each class of stock"],
  ]);
  const r = extract2d(oneLine.face, oneLine.geo);
  assert.strictEqual(r.booksPerson, "ACME TRUST SERVICES LTD");
  assert.deepStrictEqual(r.booksAddress, []);
});

/* ---- case 3: SAME box, DIFFERENT line wrap (Martinez / DFRNT Entertainment)
   The caption breaks mid-phrase: "…applicable) of person (or / persons) with
   custody…". The old anchor required "person (or persons) with custody" inside
   ONE row, so this client silently produced three blank cells. ---- */
const otherWrap = mk([
  ["c Name and address of foreign corporation's statutory or resident agent in country"],
  ["d Name and address (including corporate department, if applicable) of person (or"],
  ["persons) with custody of the books and records of the foreign corporation, and"],
  ["the location of such books and records, if different"],
  ["WILLIAM MARTINEZ"],
  ["GOLDCREST EXECUTIVE 2902, JLT CLUSTER"],
  ["DUBAI"],
  ["UNITED ARAB EMIRATES"],
  ["Schedule A  Stock of the Foreign Corporation"],
]);

t("a DIFFERENT line wrap of the same caption still reads the custodian", () => {
  const r = extract2d(otherWrap.face, otherWrap.geo);
  assert.strictEqual(r.booksPerson, "WILLIAM MARTINEZ");
  assert.strictEqual(r.booksAddress[0], "GOLDCREST EXECUTIVE 2902, JLT CLUSTER");
  assert.strictEqual(r.booksAddress[1], "DUBAI, UNITED ARAB EMIRATES");
});

t("2c (statutory agent) is never mistaken for 2d", () => {
  const agentOnly = mk([
    ["c Name and address of foreign corporation's statutory or resident agent"],
    ["in country of incorporation"],
    ["SOME AGENT LTD"],
    ["Schedule A  Stock of the Foreign Corporation"],
  ]);
  const r = extract2d(agentOnly.face, agentOnly.geo);
  assert.strictEqual(r.booksPerson, undefined, `2c leaked into 2d: ${r.booksPerson}`);
});

t("all three real-world layouts agree on whether the box has content", () => {
  assert.ok(extract2d(populated.face, populated.geo).booksPerson, "2Hats wrap");
  assert.ok(extract2d(otherWrap.face, otherWrap.geo).booksPerson, "Martinez wrap");
  assert.strictEqual(extract2d(empty.face, empty.geo).booksPerson, undefined, "empty box");
});

/* ---- case 4: 2c's wrapped tail SHARES the printed row with the 2d caption.
   This is what the real Martinez PDF looks like once rows are extracted — the
   left column carries "…agent in country" and the right column carries the 2d
   caption on the SAME line. Anchoring the match (or the column geometry) to
   the row's first cell fails on every form laid out this way. ---- */
const sharedRow = {
  face: [
    { page: 1, cells: ["gent in country", "d Name and address (including corporate department, if applicable) of person (or"] },
    { page: 1, cells: ["persons) with custody of the books and records of the foreign corporation, and"] },
    { page: 1, cells: ["the location of such books and records, if different"] },
    { page: 1, cells: ["WILLIAM MARTINEZ"] },
    { page: 1, cells: ["GOLDCREST EXECUTIVE 2902, JLT CLUSTER"] },
    { page: 1, cells: ["DUBAI"] },
    { page: 1, cells: ["UNITED ARAB EMIRATES"] },
    { page: 1, cells: ["Schedule A  Stock of the Foreign Corporation"] },
  ],
  geo: [
    { page: 1, cells: [{ text: "gent in country", x0: 120 },
                       { text: "d Name and address (including corporate department, if applicable) of person (or", x0: 660 }] },
    { page: 1, cells: [{ text: "persons) with custody of the books and records of the foreign corporation, and", x0: 668 }] },
    { page: 1, cells: [{ text: "the location of such books and records, if different", x0: 668 }] },
    { page: 1, cells: [{ text: "WILLIAM MARTINEZ", x0: 672 }] },
    { page: 1, cells: [{ text: "GOLDCREST EXECUTIVE 2902, JLT CLUSTER", x0: 672 }] },
    { page: 1, cells: [{ text: "DUBAI", x0: 672 }] },
    { page: 1, cells: [{ text: "UNITED ARAB EMIRATES", x0: 672 }] },
    { page: 1, cells: [{ text: "Schedule A  Stock of the Foreign Corporation", x0: 110 }] },
  ],
};

t("2c tail sharing the 2d caption row still reads the custodian", () => {
  const r = extract2d(sharedRow.face, sharedRow.geo);
  assert.strictEqual(r.booksPerson, "WILLIAM MARTINEZ");
  assert.strictEqual(r.booksAddress[0], "GOLDCREST EXECUTIVE 2902, JLT CLUSTER");
  assert.strictEqual(r.booksAddress[1], "DUBAI, UNITED ARAB EMIRATES");
});

t("the left column never leaks in when the row is shared", () => {
  const r = extract2d(sharedRow.face, sharedRow.geo);
  const all = [r.booksPerson, ...r.booksAddress].join(" | ");
  assert.ok(!/gent in country/i.test(all), `left column leaked: ${all}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
