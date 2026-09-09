import { Component } from "react";
import { STORE_KEY } from "../lib/store.js";

/* A runtime error should never leave the team with a blank page. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[unison] render error", error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String(this.state.error?.message || this.state.error || "Unknown error");
    return (
      <div className="unison" data-t="dark" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Something went wrong</div>
          <div className="disp" style={{ fontSize: 26, marginBottom: 10 }}>Unison hit an error it couldn't recover from.</div>
          <div className="u-muted" style={{ fontSize: 13.5, marginBottom: 6 }}>Your saved session is still on this device. Reloading usually fixes it. If it happens again, clear the saved session.</div>
          <div className="mono u-muted" style={{ fontSize: 11.5, wordBreak: "break-word", marginBottom: 16 }}>{msg.slice(0, 300)}</div>
          <div className="row">
            <button className="btn acc" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn" onClick={() => { try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ } window.location.reload(); }}>Clear saved session and reload</button>
          </div>
        </div>
      </div>
    );
  }
}
