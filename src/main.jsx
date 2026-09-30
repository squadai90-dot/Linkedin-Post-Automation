import { createRoot } from "react-dom/client";
import UnisonContentOS from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { captureRedirect } from "./lib/canva.js";
import "./styles.css";

/* Canva redirects its OAuth pop-up back to this same page. That window only
   has to hand the authorization code to the window that opened it and close,
   so it never mounts the app — booting a second copy of Unison in a pop-up
   would fight over the saved session. The code is useless on its own: the
   PKCE verifier it has to be paired with never leaves the server. */
if (!captureRedirect()) {
  createRoot(document.getElementById("root")).render(
    <ErrorBoundary>
      <UnisonContentOS />
    </ErrorBoundary>
  );
}
