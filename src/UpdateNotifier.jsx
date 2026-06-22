import { useState, useEffect } from "react";

/**
 * UpdateNotifier
 *
 * Drop this anywhere inside your App component.
 * It listens to Electron's auto-updater events via window.electronAPI
 * and shows a non-intrusive banner at the bottom of the screen.
 *
 * Usage inside App.jsx:
 *   import UpdateNotifier from './UpdateNotifier.jsx';
 *   ...
 *   return (
 *     <div>
 *       ...your existing JSX...
 *       <UpdateNotifier />
 *     </div>
 *   );
 */
export default function UpdateNotifier() {
  const [state, setState] = useState("idle");
  // idle | available | downloading | downloaded | error | not-available
  const [info,  setInfo]  = useState({});
  const [progress, setProgress] = useState(0);

  const isElectron = typeof window !== "undefined" && window.electronAPI?.isElectron;

  useEffect(() => {
    if (!isElectron) return;

    const api = window.electronAPI;

    api.onUpdateAvailable(d => {
      setState("available");
      setInfo(d);
    });

    api.onUpdateNotAvailable(() => {
      // Only show briefly if user manually checked
      if (state === "checking") {
        setState("not-available");
        setTimeout(() => setState("idle"), 3000);
      }
    });

    api.onUpdateDownloadProgress(d => {
      setState("downloading");
      setProgress(d.percent);
    });

    api.onUpdateDownloaded(d => {
      setState("downloaded");
      setInfo(d);
    });

    api.onUpdateError(d => {
      setState("error");
      setInfo(d);
      setTimeout(() => setState("idle"), 6000);
    });

    return () => api.removeUpdateListeners();
  }, [isElectron]);

  if (!isElectron || state === "idle") return null;

  // ── Styles ────────────────────────────────────────────────────────────────
  const bar = {
    position:   "fixed",
    bottom:     0,
    left:       0,
    right:      0,
    zIndex:     9999,
    display:    "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding:    "12px 24px",
    fontSize:   "13px",
    fontFamily: "'DM Sans', sans-serif",
    boxShadow:  "0 -2px 16px rgba(0,0,0,0.15)",
    gap:        16,
  };

  const btnBase = {
    border:        "none",
    borderRadius:  6,
    padding:       "7px 16px",
    fontSize:      "12px",
    fontWeight:    700,
    cursor:        "pointer",
    whiteSpace:    "nowrap",
    flexShrink:    0,
  };

  // ── Available ─────────────────────────────────────────────────────────────
  if (state === "available") return (
    <div style={{ ...bar, background: "#1A2332", color: "white" }}>
      <div style={{ display:"flex", alignItems:"center", gap: 12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#5BA4CF" strokeWidth="2">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
          <polyline points="17 6 23 6 23 12"/>
        </svg>
        <div>
          <strong style={{ color:"#A8CDED" }}>
            Update available — v{info.version}
          </strong>
          <span style={{ color:"rgba(255,255,255,.6)", marginLeft: 8 }}>
            A new version is ready to download.
          </span>
        </div>
      </div>
      <div style={{ display:"flex", gap: 8 }}>
        <button style={{ ...btnBase, background:"transparent", color:"rgba(255,255,255,.5)",
          border:"1px solid rgba(255,255,255,.2)" }}
          onClick={() => setState("idle")}>
          Later
        </button>
        <button style={{ ...btnBase, background:"#3A7FB5", color:"white" }}
          onClick={() => { window.electronAPI.downloadUpdate(); setState("downloading"); }}>
          Download Update
        </button>
      </div>
    </div>
  );

  // ── Downloading ───────────────────────────────────────────────────────────
  if (state === "downloading") return (
    <div style={{ ...bar, background: "#1A2332", color: "white", flexDirection:"column",
      alignItems:"stretch", gap: 6 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ color:"#A8CDED", fontWeight:700 }}>Downloading update…</span>
        <span style={{ color:"rgba(255,255,255,.6)", fontSize:12 }}>{progress}%</span>
      </div>
      <div style={{ background:"rgba(255,255,255,.1)", borderRadius:4, height:6, overflow:"hidden" }}>
        <div style={{ background:"#3A7FB5", height:"100%", width:`${progress}%`,
          transition:"width .3s ease", borderRadius:4 }} />
      </div>
    </div>
  );

  // ── Downloaded — ready to install ─────────────────────────────────────────
  if (state === "downloaded") return (
    <div style={{ ...bar, background: "#1A3D22", color: "white" }}>
      <div style={{ display:"flex", alignItems:"center", gap: 12 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#2E9E6B" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div>
          <strong style={{ color:"#6EFFC7" }}>
            v{info.version} ready to install
          </strong>
          <span style={{ color:"rgba(255,255,255,.6)", marginLeft: 8 }}>
            Restart now to apply the update.
          </span>
        </div>
      </div>
      <div style={{ display:"flex", gap: 8 }}>
        <button style={{ ...btnBase, background:"transparent", color:"rgba(255,255,255,.5)",
          border:"1px solid rgba(255,255,255,.2)" }}
          onClick={() => setState("idle")}>
          Later (installs on next close)
        </button>
        <button style={{ ...btnBase, background:"#2E9E6B", color:"white" }}
          onClick={() => window.electronAPI.installUpdate()}>
          Restart & Install
        </button>
      </div>
    </div>
  );

  // ── Up to date ────────────────────────────────────────────────────────────
  if (state === "not-available") return (
    <div style={{ ...bar, background: "#1A3D22", color: "white", justifyContent:"center" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="#2E9E6B" strokeWidth="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span style={{ color:"#6EFFC7", fontWeight:700, marginLeft:8 }}>
        You're on the latest version.
      </span>
    </div>
  );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (state === "error") return (
    <div style={{ ...bar, background: "#3D1A1A", color: "white" }}>
      <div style={{ display:"flex", alignItems:"center", gap: 12 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="#FF8080" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span style={{ color:"#FFB3B3" }}>
          Update check failed: {info.message}
        </span>
      </div>
      <button style={{ ...btnBase, background:"transparent", color:"rgba(255,255,255,.5)",
        border:"1px solid rgba(255,255,255,.2)" }}
        onClick={() => setState("idle")}>✕</button>
    </div>
  );

  return null;
}
