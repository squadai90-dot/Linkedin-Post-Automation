# Deploying Unison Content OS on Vercel

This is the exact setup for the deployed app: which variables to set, what each
one turns on, what to do after changing them, how to check the deployment from
inside the app, and what — if anything — you need to change in Canva.

**Short version for an existing deployment:** keep every variable you already
have, add `CANVA_SESSION_SECRET` (recommended), make sure `GROQ_API_KEY` is set
on the server, **redeploy**, then open **Settings → AI → Deployment check**.
Each person presses **Connect Canva** once. Nothing has to change in the Canva
Developer Portal unless you want the automatic "return from Canva" (step 6).

---

## 1. What runs where

| Part | Where it runs | Notes |
|---|---|---|
| The app (`src/`) | Static files built by Vite into `dist/` | No secret is ever in here |
| `api/ai.js` | Vercel function | Groq / Anthropic writing. Holds `GROQ_API_KEY` |
| `api/publish.js`, `api/linkedin.js` | Vercel functions | **Publishing — unchanged by this release** |
| `api/canva.js` | Vercel function | Canva OAuth, templates, designs, uploads, exports |
| `api/image.js` | Vercel function | AI artwork (OpenAI or Google Imagen), optional, paid |
| `api/video.js` | Vercel function | AI footage (Google Veo or Runway), optional, paid |
| `api/workspace.js` | Vercel function | Shared team workspace (Upstash), optional |

**Project settings** (Vercel → Project → Settings → Build & Deployment):

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | 20.x (18.x also works) |

No `vercel.json` is needed. The app is a single page served at `/`, the OAuth
and Canva return addresses are that same page, and Vercel serves `api/*.js` as
functions automatically.

---

## 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**, scope
**Production** (and Preview if you test on preview URLs). Names are exact and
case-sensitive.

### AI writing — needed for research, angles and drafts

| Variable | Required | What it does |
|---|---|---|
| `GROQ_API_KEY` | **Yes** (or Anthropic) | Free key from <https://console.groq.com/keys>. When `api/ai.js` is deployed, the app sends every AI call through it, and **a key typed into the app's Settings is not used** — the server key is. A missing or wrong server key is the most common reason a deployed app "has no AI". |
| `ANTHROPIC_API_KEY` | Optional | Only if you also want Anthropic models. |
| `AI_TIMEOUT_MS` | Optional | Default 55000. |

> **Do not set `VITE_GROQ_API_KEY` on Vercel.** Anything starting with `VITE_`
> is copied into the public JavaScript bundle, where anyone can read it. It is
> for local development only. If a real key was ever put there, rotate it at
> console.groq.com.

### Publishing — existing, leave as they are

| Variable | Required | What it does |
|---|---|---|
| `MAKE_LINKEDIN_WEBHOOK_URL` | Optional | Holds the Make webhook on the server. Without it, the address in Settings is used. |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | Optional | Direct LinkedIn sign-in bridge. |
| `LINKEDIN_API_VERSION`, `PUBLISH_TIMEOUT_MS`, `LINKEDIN_TIMEOUT_MS` | Optional | Tuning. |

Nothing in this release reads, renames or changes these.

### Canva

| Variable | Required for Canva | What it does |
|---|---|---|
| `CANVA_CLIENT_ID` | Yes | From your integration in the Canva Developer Portal. **Unchanged.** |
| `CANVA_CLIENT_SECRET` | Yes | Same. Server only. **Unchanged.** |
| `CANVA_REDIRECT_URI` | Yes | Your Unison address, exactly as registered as a redirect URL on the integration (e.g. `https://your-app.vercel.app/`). **Unchanged.** |
| `CANVA_SESSION_SECRET` | Recommended (new) | A long random string (32+ characters). Encrypts the HttpOnly cookie that holds each person's Canva tokens. If unset, a key is derived from the client secret — which works, but then rotating the client secret signs everyone out of Canva. |
| `CANVA_TIMEOUT_MS` | Optional | Default 30000. |

To make a random value on Windows PowerShell:
`[Convert]::ToBase64String([byte[]](1..32 | % { Get-Random -Maximum 256 }))` — or on any
machine with Node: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

### AI artwork — optional, paid

| Variable | What it does |
|---|---|
| `OPENAI_API_KEY` | Turns on **AI artwork** (gpt-image-1, returned as JPEG so it fits Vercel's 4.5 MB response limit). |
| `GOOGLE_API_KEY` | Alternative: Google Imagen. **Also** turns on Veo video (below). |
| `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_USD`, `GOOGLE_IMAGE_MODEL`, `GOOGLE_IMAGE_USD`, `IMAGE_TIMEOUT_MS` | Optional overrides. |

### AI footage — optional, paid

| Variable | What it does |
|---|---|
| `GOOGLE_API_KEY` | Google **Veo** footage (default model `veo-3.1-fast-generate-001`, priced per second, shown before you generate). |
| `RUNWAY_API_KEY` | **Runway** Gen-4 footage — animates the design's opening frame. |
| `GOOGLE_VIDEO_MODEL`, `GOOGLE_VIDEO_USD_SEC`, `RUNWAY_VIDEO_MODEL`, `RUNWAY_VIDEO_USD_SEC`, `RUNWAY_API_VERSION`, `VIDEO_TIMEOUT_MS` | Optional overrides. |

Prices in the app come from these settings, not from the provider. Check them
against the provider's current price list before relying on them for billing.

### Team workspace and security — optional

| Variable | What it does |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `UNISON_WORKSPACE_KEY` | Shared posts and calendar across the team. |
| `UNISON_RELAY_TOKEN` | A shared secret every relay call must carry — **including publishing**. Each person enters it once in **Settings → AI → Deployment check → Relay token**. If you have not set it so far, leave it unset: adding it means anyone who has not entered it can no longer publish through `api/publish.js`. |

---

## 3. After changing any variable: redeploy

Vercel only gives new values to **new** deployments.
**Deployments → the latest Production deployment → ⋯ → Redeploy.** (Untick
"use existing build cache" if offered — not required, but harmless.)

---

## 4. Check the deployment from inside the app

Open the deployed app → **Settings → AI**. The **Deployment check** card at the
top asks every function what it has, without sending any key to the browser:

| Row | Green means | If it is not green |
|---|---|---|
| AI writing | `api/ai.js` answered **and** Groq accepted `GROQ_API_KEY` | "missing" → add the variable and redeploy. "invalid" → the key is set but Groq rejected it — create a new key. |
| Canva | `api/canva.js` answered and the three Canva variables are set | Add them, redeploy. |
| AI artwork / AI footage | A provider key is set | Off is fine — the free renderer and Canva still work. |
| Publishing | `api/publish.js` answered | Unchanged by this release; see README → Publishing. |
| Team workspace | Upstash variables set | Optional. |

"Absent" for a row means that function is not deployed at all.

---

## 5. Canva: can you keep your existing connection?

**Yes — no Canva reconfiguration is required.**

| Item | Changed? |
|---|---|
| Client ID, client secret, variable names | No |
| Redirect URL / OAuth callback (your app address) | No |
| Scopes requested (`design:meta:read`, `design:content:read`, `design:content:write`, `asset:read`, `asset:write`, `brandtemplate:meta:read`, `brandtemplate:content:read`) | No — every new feature uses scopes you already granted |
| Where tokens are kept | **Yes.** Previously in the function's memory, which Vercel discards between requests (so connections were being lost). Now in an encrypted, HttpOnly cookie that only the server can read. |

What this means in practice: after you redeploy, **each person presses
Connect Canva once** (Settings → AI). After that the connection survives
reloads and Vercel cold starts. Disconnect revokes the token at Canva.

**What needs which Canva plan**

| Feature | Plan |
|---|---|
| Open any Unison design in Canva's editor, edit, bring it back | Any plan |
| Pick one of your existing Canva designs and export it (PNG or MP4) | Any plan |
| Your **brand templates**, filled automatically (Autofill) | **Canva Enterprise.** Other accounts get a clear "needs Enterprise" message; everything else keeps working. |

---

## 6. Optional: come back from Canva automatically

Without this, editing in Canva still works: when you are done, return to the
Unison tab and press **Bring back my Canva edits**.

To have Canva's editor send people straight back:

1. Open <https://www.canva.com/developers/integrations> → your integration.
2. Go to **Outside Canva → Configuration**.
3. Turn on **Return navigation**.
4. Set **Return URL** to your Unison address — the same as `CANVA_REDIRECT_URI`
   (Settings → AI shows it with a **Copy** button).
5. Save. If your integration has been submitted for review or made public,
   Canva may ask you to resubmit after a configuration change — check the
   portal's status banner.

When someone then presses **Return** in Canva, they land in Unison, and the
edited design is exported as it stands in Canva — it is never refilled from
Unison's fields, so nothing done in Canva is overwritten.

---

## 7. Vercel limits the app now respects

| Limit | How Unison handles it |
|---|---|
| A function **request** body over 4.5 MB is rejected | Files go to Canva as raw bytes, capped at 4.4 MB. Larger files: open the design in Canva and add them there (the app says so). AI clips larger than that, from Runway, are imported by Canva from the provider's own address instead. |
| A function **response** over 4.5 MB is rejected unless streamed | Canva exports and AI videos are **streamed**, not returned inside JSON. AI artwork is requested as JPEG and refused with an explanation if it would still be too large. |
| Function memory is not shared between requests | Nothing depends on it any more: Canva sessions and the OAuth PKCE verifier live in encrypted cookies. |
| Function duration | Each call is short — long jobs (Canva exports, video generation) are polled. If AI artwork times out on a Hobby plan, raise **Settings → Functions → Max Duration**, or lower `IMAGE_TIMEOUT_MS`. |
| A video attachment over 6 MB cannot be sent from the browser to publishing | Canva video exports are requested at 720p; the app warns before attaching anything larger. |

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "The AI relay is deployed, but GROQ_API_KEY is not set on the server" | Exactly that | Add `GROQ_API_KEY` (Production), redeploy |
| "Groq rejected GROQ_API_KEY" | Key revoked or mistyped | New key at console.groq.com, update, redeploy |
| Research says "Research was not run" for a festival | By design — a greeting does not need sources | Press **Research anyway** if you want it |
| Canva: "Connect Canva first" after it worked before | First visit after this release (sessions moved to a cookie), or the person disconnected | Connect once |
| Canva: "needs Enterprise" on Autofill | Brand templates are Enterprise-only | Use a Unison design + **Edit in Canva**, or **Use one of my Canva designs** |
| Canva returns to the app but nothing happens | Return navigation not set, or the Unison tab was closed | Press **Bring back my Canva edits** |
| "Canva says this design cannot be exported as an MP4" | The chosen design is not a video design | Open it in Canva and make it a video, or choose another |
| AI artwork / footage buttons disabled | No provider key on the server | Optional — add `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `RUNWAY_API_KEY` and redeploy |
