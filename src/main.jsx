import { createRoot } from "react-dom/client";
import UnisonContentOS from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { captureRedirect, captureReturn } from "./lib/canva.js";
import "./styles.css";

/* Canva redirects its OAuth pop-up back to this same page. That window only
   has to hand the authorization code to the window that opened it and close,
   so it never mounts the app — booting a second copy of Unison in a pop-up
   would fight over the saved session. The code is useless on its own: the
   PKCE verifier it has to be paired with never leaves the server. */
/* A return from Canva's editor lands here too, with a correlation state in
   the address. It is noted and the address cleaned before the app mounts;
   the design panel picks it up and fetches the edited design. */
captureReturn();

if (!captureRedirect()) {
  createRoot(document.getElementById("root")).render(
    <ErrorBoundary>
      <UnisonContentOS />
    </ErrorBoundary>
  );
}
