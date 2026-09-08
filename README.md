# Unison Content OS — working deployment

One React app, two serverless functions:

    Browser (Vite/React app)
      ├── /api/ai       → Anthropic Messages API   (holds ANTHROPIC_API_KEY)
      └── /api/publish  → Make webhook → LinkedIn  (holds MAKE_LINKEDIN_WEBHOOK_URL)

The frontend never holds a key and never calls Make or Anthropic directly in
production; it probes both endpoints on load and shows an honest status in
Settings → Connections.

## Deploy (Vercel)

1. Push this folder to a Git repo (or `vercel` from the folder).
2. Import it in Vercel — it is auto-detected as a Vite project; the `api/`
   folder becomes the two functions automatically. No vercel.json needed.
3. Set Environment Variables:
   - `ANTHROPIC_API_KEY`  — from console.anthropic.com. Without it, the app
     still runs; AI features degrade to their built-in sample fallbacks.
   - `MAKE_LINKEDIN_WEBHOOK_URL` — already defaults to your current webhook;
     set it anyway so it can be rotated without a code change.
4. Deploy. Open the site, Settings → Connections should read
   "Publishing service: Connected".

## Run locally

    npm install
    npx vercel dev        # serves the app AND /api/* with your env vars

`npm run dev` (plain Vite) also works but has no /api routes: AI calls use
fallbacks unless a local Ollama is running at localhost:11434, and publishing
attempts the direct browser route.

## Verify publishing without posting junk

    curl https://<your-app>/api/publish            # health, sends nothing
    curl https://<your-app>/api/ai                 # health, sends nothing

Then create a real post in the app and press Publish now. A 2xx from Make
shows as "Sent to Make"; it flips to "Published" only when your scenario's
Webhook Response returns {"status":"published", ...} or you confirm manually.

## Notes

- Sessions persist in the browser (localStorage) per device.
- The video encoder outputs WebM from a canvas; media payloads are capped at
  4 MB in the client and 8 MB at the functions (Vercel Hobby caps bodies at
  4.5 MB platform-wide).
- Local models: if Ollama runs on localhost:11434 with the models named in
  MODEL_REGISTRY, those capabilities route locally; otherwise everything
  routes to the hosted model through /api/ai.
