/* Item E: the Groq key across environments.

   Two halves are pinned here: the client's mode selection (evaluated out of
   dist/index.html) and the server proxy's guards (required from the built
   dist-server bundle's source module). */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = fs.readFileSync(path.join(root, "dist", "index.html"), "utf8");
let fails = 0;
const a = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

/* ---------------- client half ------------------------------------------- */

const m = dist.match(/\/\*EN9AIMODE-BEGIN\*\/([\s\S]*?)\/\*EN9AIMODE-END\*\//);
a(!!m, "EN9AIMODE sentinel block present in dist");
if (!m) { process.exit(1); }
eval(m[1]);

// remote, connected, serverHasKey
a(EN9aiMode(true, true, true) === "proxy", "backend up and holding a key -> proxy mode");
a(EN9aiMode(true, true, false) === "personal-on-server", "backend up but no server key -> personal key");
a(EN9aiMode(true, false, true) === "offline", "backend unreachable -> personal key, and said so");
a(EN9aiMode(false, null, false) === "personal", "no backend at all -> personal key");
a(EN9aiMode(true, null, true) === "personal", "before the health check answers, do not assume a proxy");
a(EN9aiMode(false, null, true) === "personal",
  "a stale proxy flag with no backend does not enable proxy mode");
a(new Set([EN9aiMode(true, true, true), EN9aiMode(true, true, false), EN9aiMode(true, false, true), EN9aiMode(false, null, false)]).size === 4,
  "the four situations produce four distinct modes");
["proxy", "personal-on-server", "offline", "personal"].forEach(mo =>
  a(typeof EN9aiModeLabel(mo) === "string" && EN9aiModeLabel(mo).length > 8, `${mo} has a human label`));
a(/Server key/.test(EN9aiModeLabel("proxy")) && /this browser only/.test(EN9aiModeLabel("personal")),
  "the labels distinguish a shared server key from a per-browser one");

/* ---------------- client wiring ----------------------------------------- */

a(dist.includes('EN9useProxy()?Zc()+"/api/ai/chat"'), "the client posts to the proxy when one exists");
a(dist.includes('function EN9groqHeaders(){if(EN9useProxy()){var t={"Content-Type":"application/json"}'),
  "REGRESSION: no Authorization header is built at all in proxy mode");
a(dist.includes('return{"Content-Type":"application/json",Authorization:"Bearer "+te.groq.key}}'),
  "the personal-key path still sends the browser's own key");
a(dist.includes("EN9aiProxy:!!(EN9h&&EN9h.aiProxy)"), "the client learns from /api/health whether a server key exists");
a(dist.includes("function EN9aiReady(){return EN9useProxy()||!!te.groq.key}"),
  "AI features unlock on either key source");
a(!dist.includes("if(!te.groq.key){Ge(\"Add a Groq API key in Settings first\""),
  "REGRESSION: the gates no longer demand a browser key when the server has one");
a(dist.includes('title:"Server key mode \\u2014 active"') && dist.includes('title:"Personal-key mode \\u2014 active"'),
  "Settings states which mode is active");
a(dist.includes("anyone who can reach this deployment can spend that key\\u2019s quota"),
  "Settings states the trade-off plainly rather than implying the proxy is free of risk");
a(dist.includes("Those are throttles, not identity"),
  "Settings does not overclaim what the rate limit and token achieve");
a(dist.includes('EN9useProxy()?"this deployment \\u2192 /api/ai/chat"'), "telemetry names the route in use");

// E4: no build-time injection, and no key of any kind baked in.
a(!/VITE_[A-Z_]*KEY/.test(dist) && !dist.includes("import.meta.env"),
  "E4: no build-time env injection was introduced");
a(!/gsk_[A-Za-z0-9]{10}/.test(dist), "E4: no Groq key is baked into the bundle");
a(!dist.includes("api/ai/chat?key=") && !dist.includes("&key=" + "$"), "the key never appears in a URL");

/* ---------------- server half -------------------------------------------- */

const src = fs.readFileSync(path.join(root, "server", "src", "aiProxy.ts"), "utf8");
a(/Authorization: `Bearer \$\{cfg\.key\}`/.test(src), "the key is attached server-side only");
a(src.includes("text.split(cfg.key).join(\"[redacted]\")"),
  "an upstream body that echoed the key back is scrubbed before reaching the client");
a(src.includes("proxy: !!cfg.key"), "/api/ai/status reports only whether a key exists, never the key");
a(!/return .*cfg\.key[^)]*\}\)/.test(src.replace(/proxy: !!cfg\.key/g, "")), "no route returns the key itself");

// Exercise the guards through the compiled bundle's own logic.
const ts = require("child_process");
const outFile = path.join(require("os").tmpdir(), "en9_aiproxy_test.cjs");
ts.execFileSync(path.join(root, "node_modules", ".bin", "esbuild"),
  [path.join(root, "server", "src", "aiProxy.ts"), "--bundle", "--platform=node", "--format=cjs",
   "--log-level=error", "--outfile=" + outFile]);
const P = require(outFile);

// origin allow-listing
a(P.originAllowed(undefined, "app.example.com", []) === true, "a same-origin request (no Origin header) is allowed");
a(P.originAllowed("https://app.example.com", "app.example.com", []) === true, "matching Origin and Host is allowed");
a(P.originAllowed("https://evil.example.com", "app.example.com", []) === false,
  "another site cannot relay through the proxy");
a(P.originAllowed("https://evil.example.com", "app.example.com", ["https://evil.example.com"]) === true,
  "an explicitly allow-listed origin is permitted");
a(P.originAllowed("not a url", "app.example.com", []) === false, "a malformed Origin is refused, not crashed on");

// rate limiting
const cfg = { perMin: 3, perDay: 5 };
let store = new Map();
let now = 1e12;
a([1, 2, 3].every(() => P.rateCheck("1.1.1.1", cfg, now, store).ok), "requests under the minute limit pass");
let r = P.rateCheck("1.1.1.1", cfg, now, store);
a(!r.ok && r.scope === "minute" && r.retryAfter === 60, "the fourth request in a minute is refused with a wait");
a(P.rateCheck("2.2.2.2", cfg, now, store).ok, "the limit is per IP, not global");
a(P.rateCheck("1.1.1.1", cfg, now + 61_000, store).ok, "the minute window rolls");
store = new Map();
for (let i = 0; i < 5; i++) P.rateCheck("3.3.3.3", cfg, now + i * 61_000, store);
r = P.rateCheck("3.3.3.3", cfg, now + 6 * 61_000, store);
a(!r.ok && r.scope === "day", "the daily cap catches a slow drip that evades the minute limit");
store = new Map([["old", { minute: [], day: [now - 90_000_000] }]]);
P.sweepBuckets(now, store);
a(store.size === 0, "dead IP buckets are swept so the process does not grow forever");

// request validation
const vcfg = P.readProxyConfig({ GROQ_API_KEY: "gsk_test", AI_MAX_TOKENS: "4000" });
a(vcfg.key === "gsk_test" && vcfg.models.length >= 1, "config reads the key and a model allow-list");
a(P.readProxyConfig({}).key === "" , "no env key means no proxy");
const good = { messages: [{ role: "user", content: "hi" }], model: vcfg.models[0], max_tokens: 1000 };
a(P.validateChatBody(good, vcfg).ok, "a well-formed request passes");
a(P.validateChatBody({ messages: [] }, vcfg).ok === false, "an empty request is refused");
a(P.validateChatBody({ messages: [{ role: "user", content: 5 }] }, vcfg).ok === false, "non-string content is refused");
a(P.validateChatBody({ ...good, model: "some-other-model" }, vcfg).ok === false,
  "the proxy cannot be pointed at an arbitrary model");
let capped = P.validateChatBody({ ...good, max_tokens: 999999 }, vcfg);
a(capped.ok && capped.body.max_tokens === 4000, "max_tokens is capped so one caller cannot drain the quota");
let big = P.validateChatBody({ messages: [{ role: "user", content: "x".repeat(300000) }] }, vcfg);
a(!big.ok && big.status === 413, "an oversized prompt is refused with 413, not forwarded");
let passthru = P.validateChatBody({ ...good, response_format: { type: "json_object" }, reasoning_effort: "low" }, vcfg);
a(passthru.ok && passthru.body.response_format && passthru.body.reasoning_effort === "low",
  "the parameters the app actually needs are passed through");
a(P.validateChatBody({ ...good, temperature: 99 }, vcfg).body.temperature === 2, "temperature is clamped");

/* ---------------- server wiring ------------------------------------------ */

const idx = fs.readFileSync(path.join(root, "server", "src", "index.ts"), "utf8");
a(idx.includes("registerAiProxy(app, aiCfg)"), "the proxy route is registered on the server");
a(idx.includes("aiProxy: !!aiCfg.key"), "health advertises proxy availability");
a(idx.includes("X-AI-Proxy-Token"), "the token header is allowed through CORS");
a(fs.existsSync(path.join(root, "dist-server", "server.cjs")), "the server bundle is built");
const bundle = fs.readFileSync(path.join(root, "dist-server", "server.cjs"), "utf8");
a(bundle.includes("/api/ai/chat"), "the built server bundle contains the proxy route");
a(!/gsk_[A-Za-z0-9]{10}/.test(bundle), "no key is baked into the server bundle either");

/* ---------------- hardening (S1-S6): the defences must actually defend ---- */

// S4: a mistyped limit fails CLOSED (falls back to the default), never open.
let hcfg = P.readProxyConfig({ GROQ_API_KEY: "k", AI_RATE_PER_MIN: "abc", AI_RATE_PER_DAY: "-5" });
a(hcfg.perMin === 20 && hcfg.perDay === 2000, "non-numeric / negative rate limits fall back to defaults (never NaN-disable)");
a(P.readProxyConfig({ AI_RATE_PER_MIN: "7" }).perMin === 7, "a valid numeric limit is honored");

// S2: X-Forwarded-For is ignored unless TRUST_PROXY=1.
a(P.readProxyConfig({}).trustProxy !== true, "XFF is not trusted by default");
a(P.readProxyConfig({ TRUST_PROXY: "1" }).trustProxy === true, "TRUST_PROXY=1 opts in to XFF");
const proxySrc = fs.readFileSync(path.join(root, "server", "src", "aiProxy.ts"), "utf8");
a(proxySrc.includes("cfg.trustProxy") && proxySrc.includes('? ((req.headers["x-forwarded-for"]'),
  "the route reads XFF only behind the trustProxy flag");

// S3: the bucket map is bounded.
{
  const store = new Map();
  const cfg3 = { perMin: 100, perDay: 1000 };
  for (let i = 0; i < P.MAX_BUCKETS + 50; i++) P.rateCheck("ip" + i, cfg3, Date.now(), store);
  a(store.size <= P.MAX_BUCKETS, "spoofed identities cannot grow the bucket map without bound");
}

// S5: response_format shapes are allow-listed.
let rf = P.validateChatBody({ messages: [{ role: "user", content: "x" }], response_format: { type: "text", evil: 1 } }, vcfg);
a(rf.ok && !rf.body.response_format, "an unknown response_format shape is dropped, not forwarded");
let rf2 = P.validateChatBody({ messages: [{ role: "user", content: "x" }], reasoning_effort: "extreme" }, vcfg);
a(rf2.ok && !rf2.body.reasoning_effort, "an unknown reasoning_effort is dropped");

// S6: our origin only ever serves JSON.
a(proxySrc.includes('ct.includes("application/json") ? ct : "application/json"'),
  "a non-JSON upstream content-type is not reflected on our origin");

// S1: keyed-but-tokenless deployments warn loudly at boot.
a(proxySrc.includes("NO AI_PROXY_TOKEN"), "open-relay configuration warns at registration");

if (fails) { console.error(`${fails} FAILURE(S)`); process.exit(1); }
console.log("ALL AI-KEY TESTS PASSED");
