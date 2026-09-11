/* Browser APIs that are perfectly safe on an https origin but throw when the
   page is opened from file:// or rendered inside a sandboxed iframe. Every
   call site goes through here so a restricted host degrades quietly instead
   of filling the console with uncaught SecurityErrors. */

/** History updates are cosmetic — a failure must never interrupt navigation. */
export function safeReplaceState(query: string): void {
  try {
    if (typeof window === "undefined" || !window.history?.replaceState) return;
    // file:// and sandboxed frames reject any history mutation with a SecurityError.
    if (window.location.protocol === "file:") return;
    window.history.replaceState({}, "", query);
  } catch {
    /* opaque origin or blocked history access — navigation still works */
  }
}

/** Printing is blocked in sandboxed frames and unimplemented in some runtimes. */
export function safePrint(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.print !== "function") return false;
    window.print();
    return true;
  } catch {
    return false;
  }
}

/** Object-URL downloads fail in frames without allow-downloads. */
export function safeDownload(blob: Blob, filename: string): boolean {
  try {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
    }, 4000);
    return true;
  } catch {
    return false;
  }
}
