/* Every exception carries a stable id.
 *
 * An id-less rv({...}) is given a fresh uid() on each run. Everything the
 * reviewer does to an exception — dismiss it, sign it off, edit its value,
 * write a policy rule against it — is keyed on that id, so re-processing the
 * entity resurrected every item the reviewer had already cleared, with no way
 * to tell the two apart. 14 of the 55 call sites in store.ts were like this.
 *
 * Ids must also be derived from the THING, not from its position in a list:
 * `ledger-cash-paid-<index>` moves every sign-off onto the wrong payment the
 * moment a row is inserted above it.
 */
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const a = (c, m) => { if (!c) { console.error("FAIL:", m); fail++; } else { console.log("ok:", m); pass++; } };

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "src", "prototype", "wp", "store.ts"), "utf8");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");

/** Every rv({ … }) object literal in the source, balanced-brace scanned. */
function rvCalls(text) {
  const out = [];
  const re = /\brv\(\{/g;
  let m;
  while ((m = re.exec(text))) {
    let i = m.end !== undefined ? m.end : re.lastIndex;
    i -= 1;                       // land on the "{"
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    out.push({ body: text.slice(i, j + 1), line: text.slice(0, m.index).split("\n").length });
  }
  return out;
}

/** A literal `id:` at the top level of the object (not nested in a target/prov). */
function hasTopLevelId(body) {
  let depth = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (depth === 1 && body.startsWith("id:", k)) return true;
  }
  return false;
}

const calls = rvCalls(src);
a(calls.length >= 55, `store.ts has the full set of rv() call sites (${calls.length})`);
const missing = calls.filter((c) => !hasTopLevelId(c.body));
a(missing.length === 0,
  missing.length ? `rv() without an id at store.ts:${missing.map((m) => m.line).join(", :")}` : "every rv() in store.ts carries a literal id");

/* The ids the round-5 review named. Present in BOTH trees, because a reviewer
   signing off in the shipped app must find the same item after a re-process. */
const IDS = [
  "doc-unreadable-", "doc-note-", "doc-unclassified-", "doc-current-year-return-",
  "doc-zero-rows-", "cf-dup-", "cf-wrong-entity-", "cf-unnamed-block-",
  "rp-routed-", "pool-overflow-", "dupe-page-",
  "ledger-unparsed", "ledger-cash-paid-", "ledger-no-avg-rate",
];
for (const id of IDS) {
  a(src.includes(`id: \`${id}`) || src.includes(`id: "${id}"`), `src raises ${id}`);
  a(dist.includes(`id:\`${id}`) || dist.includes(`id:"${id}"`), `dist raises ${id}`);
}

// Position-derived ids are the bug, not the fix.
a(!/id: `ledger-cash-paid-\$\{[a-z]+\}`/.test(src), "the cash-paid id is not a bare list index");
a(src.includes("id: `ledger-cash-paid-${c.date}-${c.amount}`"), "the cash-paid id is keyed on the payment");
a(dist.includes("id:`ledger-cash-paid-${m.date}-${m.amount}`"), "dist keys the cash-paid id on the payment too");

// A derived item's dismissal tombstone must be cleared once its cause is gone.
for (const id of ["mapping-language", "no-lines-mapped"]) {
  a(new RegExp(`"${id}",`).test(src.slice(src.indexOf("const DERIVED_IDS"), src.indexOf("const DERIVED_IDS") + 500)),
    `src DERIVED_IDS covers ${id}`);
  a(dist.includes(`"fx-currency-unconfirmed","no-lines-mapped","mapping-language"`), `dist DERIVED_IDS covers ${id}`);
}

// A category no policy rule can name is a category no reviewer can suppress.
for (const c of ["tie-out", "entity-scope"]) {
  a(src.includes(`"${c}"`), `src ReviewItem category union includes ${c}`);
  a(dist.includes(`"consistency","process","tie-out","entity-scope"`), `dist policy dropdown offers ${c}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
