import { useEffect } from "react";

/* Transient feedback. Every notify() call lands here for a few seconds and in
   the notifications drawer permanently, so nothing the app says is missed. */

function Toast({ t, dismiss }) {
  useEffect(() => {
    const h = setTimeout(() => dismiss(t.id), t.ms || 4500);
    return () => clearTimeout(h);
  }, [t.id, t.ms, dismiss]);
  return (
    <div className={"toast " + (t.tone || "")} role="status">
      <span className="toast-text">{t.text}</span>
      {t.action && (
        <button className="btn sm" onClick={() => { t.action.onClick(); dismiss(t.id); }}>{t.action.label}</button>
      )}
      <button className="toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
    </div>
  );
}

export function Toasts({ items, dismiss }) {
  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.slice(-3).map((t) => <Toast key={t.id} t={t} dismiss={dismiss} />)}
    </div>
  );
}
