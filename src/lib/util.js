/* Small shared helpers. */
export const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const pad = (n) => String(n).padStart(2, "0");
export const tierLabel = (t) => ["", "Primary", "High-quality secondary", "Industry", "Discovery only"][t] || "Unclassified";
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
export const LI_LIMIT = 3000;
export const LI_FOLD = 210;
