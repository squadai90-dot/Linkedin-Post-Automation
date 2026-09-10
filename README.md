# Unison Content OS

An internal tool for a marketing team to research, draft, fact-check, illustrate,
approve, schedule and publish LinkedIn Company Page posts.

It is a **frontend-only React app**. It runs from any static host — or straight
off your laptop — with no backend and no database. Everything it needs to be
useful is optional and configured in Settings; everything it cannot do, it says
so on screen rather than pretending.

---

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
```

Build and preview the production bundle:

```bash
npm run build
npm run preview    # http://localhost:4173
```

Deploy `dist/` to any static host (Vercel, Netlify, S3, an internal nginx). No
build-time environment variables are required.

### One file, no install

`npm run build:standalone` writes `unison-content-os.html` — the whole app
inlined into a single file. Save it anywhere and double-click it; no server, no
`npm install` at the other end. Everything works, including saved sessions,
because the browser keeps them per file.

The one caveat, which the file states itself when you open it that way: a page
loaded over `file://` sends no origin, so an AI key may be refused. To use one,
serve the folder instead and open the address it prints:

```bash
npx serve .
```

`npm run build:preview` writes the same thing as `preview.html` for a hosted
sandbox, where outbound requests are blocked and file downloads are unavailable.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle on port 4173 |
| `npm run lint` | ESLint over the app, the API routes and the tests |
| `npm test` | Vitest unit tests (91 tests, no network) |
| `npm run test:e2e` | Playwright journey tests against the built app |
| `npm run check` | lint + unit tests + build, in that order |
| `npm run build:standalone` | One self-contained `unison-content-os.html` you can email or double-click |
| `npm run build:preview` | The same file as `preview.html`, for a hosted sandbox |

---

## First run: three things to set up

The dashboard shows a checklist until these are done. Everything works before
they are — you just get sample data and dry runs.

### 1. Your company (Settings → Workspace)

Company name, website, your own name. The name appears in the post preview and
is stamped onto every generated image; your name greets you and signs the
activity log. Nothing here leaves the browser.

### 2. AI (Settings → AI)

The writing, research, evidence and quality engines need a model. There are
three ways to give them one, tried in this order:

1. **Local model (free, private).** If [Ollama](https://ollama.com) is running
   on the same machine, Unison uses it. Set the endpoint and model tag under
   Settings → AI. Web search is not available on this route.
2. **The AI relay** (`api/ai.js`, see *Optional serverless relays* below). When
   deployed, the key lives on the server and nothing is stored in the browser.
3. **A key in this browser.** Paste an Anthropic API key from
   [console.anthropic.com](https://console.anthropic.com). It is kept in this
   browser's `localStorage` under `unison:ai:v1`, never in the saved session and
   never in an export. Calls go straight to `api.anthropic.com`.

> **Be deliberate about option 3.** A key in a browser is visible to anyone with
> access to that browser profile and to any script on the page. Use a key scoped
> to this team, rotate it on a schedule, and prefer options 1 or 2 for shared or
> public deployments.

Model, thinking depth and estimated spend are all on the same tab. Default:
Claude Opus 5 at medium effort. **Test connection** proves it works before you
rely on it.

### 3. Publishing (Settings → LinkedIn)

LinkedIn has no browser-callable posting API, so the post has to leave through
something. Two routes, and they combine:

**Make (recommended, works with no LinkedIn sign-in).** A Make.com scenario owns
the LinkedIn connection. Unison POSTs the finished post to its webhook. Paste the
webhook URL under Settings → LinkedIn. The payload:

```jsonc
{
  "source": "unison-content-os",
  "postId": "p-w-abc123",         // stable per post
  "idempotencyKey": "p-w-abc123", // same value; drop repeats on this
  "postType": "text|image|multi|video|document|poll|article|carousel",
  "content": "the full post text including hashtags",
  "company": "Acme Labs",
  "companyUrn": "urn:li:organization:123",
  "publishMode": "now" | "scheduled",
  "scheduledDate": "2026-09-15",   // null when publishMode is "now"
  "scheduledTime": "09:30",
  "timezone": "Asia/Kolkata",
  "submittedBy": { "name": "Priya Shah", "email": null },
  "media": [{ "kind": "image", "filename": "…", "mimeType": "image/png",
              "data": "<base64>", "altText": "…", "width": 1200, "height": 630 }],
  "poll": { "question": "…", "options": ["…"], "duration": "1 week" }
}
```

Unison marks a post **Published** only when the scenario's Webhook Response says
so — `{"status":"published"}` or a real `urn:li:...`. A bare `200` means
*delivered to Make*, nothing more, and the UI says exactly that. To let the
browser read the reply, set an `Access-Control-Allow-Origin` header on the
Webhook Response module; without it the post still arrives but Unison reports it
as sent-unconfirmed rather than guessing.

**Sign in with LinkedIn (optional, adds identity and Page selection).** Create an
app at [linkedin.com/developers](https://www.linkedin.com/developers/), add this
page's URL as an authorised redirect URL, and paste the Client ID under
Settings → LinkedIn.

A browser can send the user to LinkedIn's consent screen and receive the
authorisation code back. It **cannot** exchange that code for a token — that
needs the Client Secret, which must never sit in a web page. So finish in one of
two ways:

- **Token bridge.** Point Settings → LinkedIn at any URL (a second Make webhook
  is easiest) that performs the exchange. Unison POSTs
  `{"action":"exchange","code":"…","redirect_uri":"…","client_id":"…"}` and
  expects `{"access_token":"…","expires_in":5184000,"profile":{…},"organizations":[…]}`
  back, with an `Access-Control-Allow-Origin` header. It may also receive
  `{"action":"organizations","access_token":"…"}` and return the Pages.
- **Paste a token.** In the LinkedIn developer portal use
  Auth → OAuth 2.0 tools → Token generator, and paste the token into the flow.
  Stored in this browser only.

Without either, sign-in stops at "authorised" and you can still add your Page by
hand (its numeric ID is in the Page admin URL).

---

## What is real and what is not

Nothing in the app claims more than it can prove. This table is the whole truth.

| Area | Real | Not real |
|---|---|---|
| Research and drafting | Live web search when a hosted key is set; sources carry real URLs | Without a key, sources are labelled **placeholders** and the draft is labelled **sample text** |
| Trending stories | Hacker News, free and keyless, real links | Never ranked against your Page's history — tagged "Trending", gap shown as unknown |
| Background reading | Wikipedia, free and keyless | Marked *Background*, tier 3, never used as evidence for a claim |
| Grammar | LanguageTool, free and keyless | Your draft text is sent to `languagetool.org`. Turn it off in Settings → Advanced |
| Holidays | Nager.Date, free and keyless | Country inferred from the chosen timezone |
| Images | Real, downloadable PNG/SVG from brand templates; optionally AI photos via Pollinations | No commercial image model is wired in |
| Video | A real, playable WebM encoded in the browser from the storyboard | Not the output of a video model, and the UI says so |
| Publishing | Real when a Make webhook is set | With nothing connected it is a **dry run**, labelled everywhere |
| Performance | The numbers you enter from LinkedIn analytics, explained by the model | Not pulled automatically — the Make route has no read-back |
| Scheduling | A real date, time and timezone, sent to Make | **A browser cannot run while closed.** A due post is flagged on Home and in Content; you press Publish, or hand it to Make to publish at that time |
| Team list | A local list for reference | Not a login. Roles are documentation, not enforcement |

Sample rows that ship with the app are tagged `sample` and can be removed from
Content. Clearing the saved session (Settings → Publishing) restores them.

---

## Free APIs in use

All keyless, all optional, all fail quietly. Toggle each under
Settings → Advanced.

| Service | Used for | Off by default |
|---|---|---|
| Hacker News (Algolia) | Trending stories in Discover | no |
| Wikipedia | Background source in Research | no |
| LanguageTool | Grammar and spelling on the draft | no |
| Nager.Date | Public-holiday warning when scheduling | no |
| Pollinations | AI photo instead of the brand renderer | **yes** |

---

## Optional serverless relays

`api/ai.js` and `api/publish.js` are Vercel functions. They are **not required** —
the app detects them and adapts. Deploy them if you want keys off the browser:

| Variable | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `api/ai.js` | Holds the AI key server-side |
| `MAKE_LINKEDIN_WEBHOOK_URL` | `api/publish.js` | Holds the webhook server-side |
| `UNISON_RELAY_TOKEN` | both | Optional shared secret; set the same value in the browser under `localStorage["unison:relay-token"]` |

Both answer `GET` with a health check that sends nothing:

```bash
curl https://<your-app>/api/ai        # {"service":"unison-ai-relay",...}
curl https://<your-app>/api/publish   # {"service":"unison-publish-relay",...}
```

The publish relay also de-duplicates by idempotency key on a warm instance.

---

## How the code is laid out

```
src/
  App.jsx              the root component: state, engines, publishing
  main.jsx             entry point, wraps the app in an error boundary
  styles.css           the whole design system
  hooks.js
  lib/
    ai.js              model routing, settings, JSON repair, shape guards
    linkedin.js        connection shape shared by every route
    linkedinAuth.js    browser OAuth, token bridge, Page selection
    publish.js         Make transport, reply reading, publish settings
    freeApis.js        Hacker News, Wikipedia, LanguageTool, holidays, images
    formats.js         post components and which stages each one needs
    brand.js           SVG templates, canvas scenes, rasterising, downloads
    media.js           the media engine and its providers
    dates.js           local dates, week/month grids, timezones, due checks
    image.js           downscaling uploads so they fit browser storage
    store.js           persistence backend and relay token
    text.jsx           claim location, LinkedIn preview segments, word diff
    seed.js, util.js
  components/          chrome, dashboard, workspace, media, views, modals,
                       settings, panels, discover, toasts, error boundary
api/                   two optional Vercel functions
tests/                 Vitest unit tests
e2e/                   Playwright journey tests
```

Notes worth knowing:

- **three.js and mammoth are lazy-loaded.** The ambient 3D scene is off by
  default and its ~510 KB chunk is never fetched until someone turns it on;
  `mammoth` loads on the first `.docx` upload.
- **Storage is quota-aware.** Uploads are downscaled before they are kept. If
  the browser runs out of room, Unison drops rendered media from older posts,
  keeps all the text, and *tells you* — it never fails silently.
- **Every async job is bound to the post it started on.** Opening another draft
  mid-generation discards the stale result instead of writing it to the wrong
  post.

---

## Handover checklist

Run `npm run check` first — lint, 91 unit tests and the build must all pass.
Then walk this by hand with nothing configured:

- [ ] Home shows the setup checklist and honest AI / publishing status
- [ ] Settings opens on all six tabs; company and your name persist
- [ ] Type a topic, tick Poll, press Start → research runs and sources are
      labelled placeholders when no AI key is set
- [ ] Pick an angle → a draft appears, marked sample text, with a live character
      count that includes hashtags
- [ ] Edit the draft → the Evidence panel says the checks are stale and offers
      Re-check
- [ ] Approve → Schedule (works with nothing connected) → Publish now shows
      **Simulated publish — nothing was sent**
- [ ] Calendar shows the post exactly once, marks today, and navigates months
- [ ] Content search and the state filters work; a due post offers Publish now
- [ ] Reload the page → the work is still there and no stage is stuck "running"
- [ ] Insights shows no invented numbers; add metrics to a published post and
      press Explain
- [ ] Settings → Publishing → Export JSON, then Import it back
- [ ] Phone width: the menu reaches every view and nothing scrolls sideways
- [ ] Light theme renders

Then configure an AI key and a Make webhook and repeat the last three steps of
the journey with a real post.

---

## Known limits

- **Nothing runs while the tab is closed.** Scheduling is a reminder plus an
  optional hand-off to Make. If you need unattended publishing, let the Make
  scenario schedule from `scheduledDate`/`scheduledTime`.
- **Storage is per browser, per device.** Two people do not share a queue. Use
  Export/Import to move work, or put the shared state in Make.
- **LinkedIn document posts need a PDF** and **there is no organic carousel
  API.** Unison sends the pages as images and says what the scenario has to do
  with them.
- **Articles cannot be created through the API.** The article travels with the
  post so a scenario can store or route it; LinkedIn publishes the written post.
- **Browser video encoding runs in real time** and caps at about 6 MB for a
  single request.
