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
- Branded images from Unison's own layouts, and the **Design from a template**
  panel using those layouts
- Storyboard video, rendered and encoded in your browser
- Polls, the calendar, Content history, drafts
- Everything saves in your browser automatically

With nothing configured, AI text is labelled **sample text** and sources are
labelled **placeholders**. That labelling is deliberate — it never pretends.

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

### Canva — brand template designs (needs Canva Enterprise)

1. Create an integration at <https://www.canva.com/developers/integrations>.
2. Add your Unison address as an **authorised redirect URL**.
3. Deploy the project so `api/canva.js` is running. **Canva cannot be connected
   from `npm run dev` alone** — OAuth needs a backend.
4. Set on the server:

   ```
   CANVA_CLIENT_ID=...
   CANVA_CLIENT_SECRET=...
   CANVA_REDIRECT_URI=https://your-address/
   ```

5. In Unison: **Settings → AI → Connect Canva**.

For local development only, the same three values can be typed into Settings
and held **in the server's memory** — gone when it restarts. On a deployed
instance that is refused unless `UNISON_RELAY_TOKEN` is set, so nobody can point
your relay at their own Canva account.

Brand templates and autofill are Canva **Enterprise** features. On a free or
ordinary paid account, Canva returns 403 and Unison shows you Canva's message.

---

## 7. Testing before you deploy

```powershell
npm run lint        # code checks
npm test            # unit and integration tests
npm run build       # production build
npm run test:e2e    # full browser tests (slower, ~4 minutes)
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
| A post says **sample text** | No AI key configured. Settings → AI. |
