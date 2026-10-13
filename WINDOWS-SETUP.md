# Running Unison Content OS on Windows

Written for someone who has not run a developer tool before. Every step says
what you should see, so you can tell whether it worked.

---

## 1. Install Node.js (once)

1. Go to <https://nodejs.org> and download the **LTS** version.
2. Run the installer and accept the defaults.
3. Open **PowerShell** — press `Windows`, type `powershell`, press Enter.
4. Check it worked:

   ```powershell
   node --version
   npm --version
   ```

   You should see two version numbers, e.g. `v22.11.0` and `10.9.0`. If you see
   *"not recognized"*, close PowerShell, open it again, and retry — the
   installer's change to your PATH needs a fresh window.

---

## 2. Open the project folder

Unzip `Unison-Content-OS-Final-Project.zip`. In PowerShell, move into the
folder it created — adjust the path to wherever you unzipped it:

```powershell
cd "$HOME\Downloads\Unison-Content-OS"
```

Check you are in the right place:

```powershell
dir package.json
```

If it lists the file, you are in the right folder. If it says it cannot find
it, you are one level too high or too low — try `dir` to see what is around you.

---

## 3. Install the project's dependencies (once, ~2 minutes)

```powershell
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`. It ends with a
line like `added 379 packages`. A few `npm warn` lines are normal.

> If `npm ci` complains that the lockfile is out of sync, use `npm install`
> instead. Both work; `npm ci` is just stricter.

---

## 4. Run it

```powershell
npm run dev
```

You will see:

```
VITE v5.4.11  ready in 420 ms
➜  Local:   http://localhost:5173/
```

Hold `Ctrl` and click that address, or paste it into your browser. Unison opens.

**To stop it:** click back on the PowerShell window and press `Ctrl + C`.

---

## 5. What works without any setup

- Writing posts, choosing angles, the draft editor and approval flow
- The **post image** in the Media step: festival, launch and milestone
  designs drawn by Unison to choose from, with quick edits (words, colours,
  background, your own picture, crop, layout, type) — all in the browser, no
  key needed
- Storyboard video, rendered and encoded in your browser
- Polls, the calendar, Content history, drafts
- Everything saves in your browser automatically

With no AI configured, nothing is invented to fill the gap: research shows **no
sources** and says why; a festival greeting, launch or milestone gets a
labelled template that states no facts; anything else starts as **your own
topic, word for word**, for you to write. Each case is labelled on screen.

---

## 6. Turning features on

### Groq — AI writing (free)

1. Get a key at <https://console.groq.com/keys>.
2. In Unison: **Settings → AI**, paste it into the key box, press **Save**.
3. Press **Test connection**. It should reply within a couple of seconds.

The key is stored in that browser only. It never enters a saved session or an
export. **Anyone who can open a build made with `VITE_GROQ_API_KEY` set can read
that key** — so for anything shared, use the server route below instead.

### OpenAI or Google — AI artwork (paid)

These must be on a **server**, never in the browser. They need the project
deployed with its `api/` folder (Vercel, Netlify Functions or any Node host):

```
OPENAI_API_KEY=...        # images
GOOGLE_API_KEY=...        # images and Veo video
RUNWAY_API_KEY=...        # video
```

Running only `npm run dev` on your own machine, there is no server, so the AI
artwork button stays disabled and says why. That is correct, not a fault.

### Canva — edit designs in Canva, bring them back (any Canva plan)

1. Create an integration at <https://www.canva.com/developers/integrations>
   (or use the one you already have — nothing in it needs to change).
2. Add your Unison address as an **authorised redirect URL**.
3. Deploy the project so `api/canva.js` is running. **Canva cannot be connected
   from `npm run dev` alone** — OAuth needs a backend.
4. Set on the server, then redeploy:

   ```
   CANVA_CLIENT_ID=...
   CANVA_CLIENT_SECRET=...
   CANVA_REDIRECT_URI=https://your-address/
   CANVA_SESSION_SECRET=...   # recommended: any long random string
   ```

5. In Unison: **Settings → AI → Connect Canva**. Each person does this once.

Then, in the Media step: **Edit in Canva** opens the design in Canva's editor;
**Bring back my Canva edits** fetches it as it now stands; **Use one of my
Canva designs** brings in anything from your account. Optional: turn on
*Return navigation* in the Developer Portal so Canva sends you straight back —
see [VERCEL-SETUP.md](VERCEL-SETUP.md), step 6.

Filling your **brand templates** automatically (Autofill) is a Canva
**Enterprise** feature. On other accounts Canva returns 403 and Unison says so;
everything else above still works.

For local development only, the three values can be typed into Settings and
held in the server's memory — gone when it restarts. On a deployed instance
that is refused unless `UNISON_RELAY_TOKEN` is set.

---

## 7. Testing before you deploy

```powershell
npm run lint        # code checks
npm test            # unit and integration tests
npm run build       # production build
npm run test:e2e    # full browser tests (slower, about 6 minutes)
```

> Run the browser tests with **`npm run test:e2e`**, not `npx playwright test`.
> Vite bakes `VITE_*` variables into the build, so if you have a real key in
> `.env.local` the bundle starts up already configured and the tests that check
> Unison admits it is unconfigured fail for a reason unrelated to the code.
> `npm run test:e2e` rebuilds with those variables blanked first.

A single file you can email or open without installing anything:

```powershell
npm run build:standalone
```

That writes `unison-content-os.html`. It contains no API key.

---

## 8. If something goes wrong

| What you see | What it means |
|---|---|
| `npm : The term 'npm' is not recognized` | Node.js is not installed, or PowerShell was open before you installed it. Close it, open it again. |
| `Cannot find module` after unzipping | You skipped `npm ci`. Run it. |
| `EADDRINUSE: address already in use` | Something else is on that port. Stop the other window, or run `npm run dev -- --port 5174`. |
| The AI artwork button is greyed out | No server, or no key on it. Expected with `npm run dev`. |
| Canva says *"No backend is deployed here"* | Correct for a local run or the standalone file. Canva needs `api/canva.js`. |
| The draft says it is **only your topic** | No AI was reachable. On your own machine: Settings → AI. Deployed: set `GROQ_API_KEY` on the server and redeploy (see VERCEL-SETUP.md). |
| Settings → AI → **Deployment check** shows a red row | That server variable is missing or wrong. The row names it and says what to do. |
| Canva says *"Connect Canva first"* | Each person connects once — Settings → AI → Connect Canva. |

---

## 9. Multi-Page publishing: test, preview, push

Everything here runs on your machine or on a **preview** deployment. Nothing
here touches production. It needs Git ([git-scm.com](https://git-scm.com))
and Python 3 ([python.org](https://www.python.org)) as well as Node.js.

### Get the branch

```powershell
git clone https://github.com/squadai90-dot/Linkedin-Post-Automation.git
cd Linkedin-Post-Automation
git checkout claude/website-review-improvements-ndtwl3
npm ci
```

### Run every check

```powershell
npm run lint
npm test
npm run build
npx vitest run tests/unified-matrix.test.js tests/unified-blueprints.test.js
```

The last line runs the 56-combination matrix and the blueprint checks alone.
You should see `Tests  94 passed`.

Browser tests: `npm run test:e2e` uses a shell syntax that Windows does not
understand. Run these three lines instead. They set the `.env.local` file
aside, so no real key ends up in the test build, and then put it back.

```powershell
if (Test-Path .env.local) { Rename-Item .env.local .env.local.off }
npx playwright install chromium
npx vite build; npx playwright test; if (Test-Path .env.local.off) { Rename-Item .env.local.off .env.local }
```

The browser tests end with `passed`, and the mobile copies of desktop-only
tests show as `skipped`.

### Check the blueprints are the generated ones

```powershell
python make\unified\generate.py
python make\unified\generate.py --profile test
git status --short make\unified
```

`git status` printing nothing means the committed blueprints are exactly
what the generator produces.

### Start the app

```powershell
npm run dev
```

Open <http://localhost:5173>. `npm run dev` has no server functions, so the
Page picker stays hidden. That is expected. To see it locally, use
`npx vercel dev` with the two variables below in `.env.local`. Point the
webhook at the **test** webhook only.

### Push the branch to the UX test project and get a preview

The test project lives in a different repository. This adds it as a second
remote and pushes the branch there under a new branch name. Nothing is
merged, and nothing goes to production.

```powershell
git remote add uxtest https://github.com/drashtirmakwana15-rgb/unison-content-os-ux-test.git
git fetch uxtest
git push uxtest claude/website-review-improvements-ndtwl3:multi-page-unified
```

If Vercel is connected to that repository, it builds a **Preview** for the
branch `multi-page-unified`. Before using it:

1. In Vercel → the test project → Settings → Environment Variables, add
   these for the **Preview** environment only:
   - `LINKEDIN_DESTINATIONS`: the three Pages, as in MULTI-ACCOUNT.md §5.
   - `MAKE_MULTI_WEBHOOK_URL`: the address of the **test** webhook
     *Unison LinkedIn Publisher - Multi Account Test Webhook*. Copy it from
     Make → Webhooks. Never paste the production one here.
   - `GROQ_API_KEY`: already used by the app for writing.
2. Redeploy the preview (Deployments → the preview → ⋯ → Redeploy).
3. Check the preview runs this code:
   - In Vercel, the deployment's commit must equal the output of
     `git rev-parse --short HEAD`.
   - Opening `https://<preview-address>/api/destinations` must show
     `"service":"unison-destinations"`, `"enabled":true` and the three
     Pages. It must not show any webhook address.
   - Open the preview → Settings → LinkedIn: *Pages you can publish to*
     lists the three Pages.

Do **not** run `vercel --prod` and do not promote the preview. Production
deploys only through CUTOVER.md, after your approval.

### Commit your own changes, if you make any

```powershell
git add -A
git commit -m "Describe the change"
git push origin claude/website-review-improvements-ndtwl3
```
