import { useState, useEffect, useCallback, useRef, useMemo } from "react";

/* ═══════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════ */
const T = {
  blue:       "#5BA4CF",
  blueDark:   "#3A7FB5",
  blueLight:  "#A8CDED",
  bluePale:   "#EAF4FB",
  white:      "#FFFFFF",
  offWhite:   "#F7F8FA",
  gray50:     "#F2F3F5",
  gray100:    "#E4E6EA",
  gray200:    "#C8CDD6",
  gray300:    "#A0A8B5",
  gray400:    "#8B93A3",
  gray500:    "#6B7585",
  gray700:    "#3A3F4A",
  black:      "#0F1117",
  ink:        "#1A1D24",
  success:    "#2E9E6B",
  danger:     "#D94040",
  warning:    "#D97B00",
};

/* ═══════════════════════════════════════════════════════════
   INDEXED DB
═══════════════════════════════════════════════════════════ */
const DB = (() => {
  let db = null;

  const open = () => new Promise((res, rej) => {
    if (db) return res(db);
    const req = indexedDB.open("AqsaHotelDB", 3);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      // invoices, clients, users — all keyed by "id"
      ["invoices","clients","users"].forEach(s => {
        if (!d.objectStoreNames.contains(s))
          d.createObjectStore(s, { keyPath: "id" });
      });
      // settings — keyed by "key" (because we store {key, value} objects)
      if (d.objectStoreNames.contains("settings")) d.deleteObjectStore("settings");
      d.createObjectStore("settings", { keyPath: "key" });
      // audit — no keyPath, autoIncrement integer key
      if (d.objectStoreNames.contains("audit")) d.deleteObjectStore("audit");
      d.createObjectStore("audit", { autoIncrement: true });
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror   = e => rej(e);
  });

  const tx = (store, mode = "readonly") =>
    db.transaction(store, mode).objectStore(store);

  const getAll = store => open().then(() => new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  }));

  const put = (store, obj) => open().then(() => new Promise((res, rej) => {
    const r = tx(store, "readwrite").put(obj);
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  }));

  const del = (store, id) => open().then(() => new Promise((res, rej) => {
    const r = tx(store, "readwrite").delete(id);
    r.onsuccess = () => res();
    r.onerror   = e => rej(e);
  }));

  // settings store uses keyPath:"key" so we store {key, value}
  const getSetting = key => open().then(() => new Promise((res, rej) => {
    const r = tx("settings").get(key);
    r.onsuccess = e => res(e.target.result ? e.target.result.value : null);
    r.onerror   = e => rej(e);
  }));

  const setSetting = (key, value) => put("settings", { key, value });

  // audit store has no keyPath — use add() so IDB assigns integer key
  const addAudit = (action, user) => open().then(() => new Promise((res, rej) => {
    const r = tx("audit", "readwrite").add({
      action,
      user: user || "system",
      timestamp: new Date().toISOString()
    });
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => { console.warn("audit write skipped:", e); res(null); };
  }));

  const getAllAudit = () => open().then(() => new Promise((res, rej) => {
    const r = tx("audit").getAll();
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e);
  }));

  return { getAll, put, del, getSetting, setSetting, open, addAudit, getAllAudit };
})();

/* ═══════════════════════════════════════════════════════════
   CRYPTO
═══════════════════════════════════════════════════════════ */
async function hashPw(pass) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pass + "AqsaSalt2025"));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
const fmt = n => (+n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const today = () => new Date().toISOString().split("T")[0];
const dueDate = () => new Date(Date.now()+30*864e5).toISOString().split("T")[0];
const uid = () => `id_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const genKey = () => { const s=()=>Math.random().toString(36).slice(2,7).toUpperCase(); return `AQ-${s()}-${s()}-${s()}`; };

/* Month name helpers */
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTHS_EN_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

/* Gregorian → Hijri using browser's built-in Intl (Umm al-Qura / Saudi official).
   Returns e.g. "١٥ رجب ١٤٤٦ هـ"  */
const fmtHijri = (dateStr) => {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    // Use noon UTC to avoid date-shift from timezone
    const dt = new Date(Date.UTC(y, m - 1, d, 12));
    const parts = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
      day: "numeric", month: "long", year: "numeric",
      timeZone: "Asia/Riyadh",
    }).formatToParts(dt);
    const day   = parts.find(p => p.type === "day")?.value   || "";
    const month = parts.find(p => p.type === "month")?.value || "";
    const year  = parts.find(p => p.type === "year")?.value  || "";
    return `${day} ${month} ${year} هـ`;
  } catch {
    // Fallback: transliterated Gregorian in Arabic numerals
    const [y, m, d] = dateStr.split("-").map(Number);
    const toAr = n => String(n).replace(/\d/g, c => "٠١٢٣٤٥٦٧٨٩"[c]);
    return `${toAr(d)} ${MONTHS_AR[m-1]} ${toAr(y)}`;
  }
};

/* fmtDate("2025-01-15")        → "15 Jan 2025"
   fmtDate("2025-01-15","full") → "15 January 2025" */
const fmtDate = (dateStr, style="en") => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts.map(Number);
  const mi = m - 1;
  if (style === "full") return `${d} ${MONTHS_EN_FULL[mi]} ${y}`;
  return `${d} ${MONTHS_EN[mi]} ${y}`;
};
/* 3-letter uppercase month abbreviation from a YYYY-MM-DD string, for invoice numbers */
const monthAbbr = (dateStr) => {
  const m = parseInt((dateStr||today()).split("-")[1], 10);
  return MONTHS_EN[m-1]?.toUpperCase() || "JAN";
};

/* Invoice number format builder */
const INV_FORMATS = [
  { id:"branch-year-seq",     label:"BR-YYYY-NNNN",     example:"MK-2025-0001" },
  { id:"branch-mon-year-seq", label:"BR-MMM-YYYY-NNNN", example:"MK-JAN-2025-0001" },
  { id:"inv-year-seq",        label:"INV-YYYY-NNNN",    example:"INV-2025-0001" },
  { id:"inv-mon-year-seq",    label:"INV-MMM-YYYY-NNNN",example:"INV-JAN-2025-0001" },
  { id:"year-slash-seq",      label:"YYYY/NNNN",        example:"2025/0001" },
  { id:"prefix-seq",          label:"PREFIX-NNNN",      example:"AQ-0001" },
  { id:"seq-only",            label:"NNNN",             example:"0001" },
];

function buildInvNumber(formatId, branch, seq, customPrefix, issueDate) {
  const y = new Date().getFullYear();
  const n = String(seq).padStart(4,"0");
  const br = branch==="madinah" ? "MD" : "MK";
  const mon = monthAbbr(issueDate); // e.g. "JAN"
  switch(formatId) {
    case "branch-year-seq":     return `${br}-${y}-${n}`;
    case "branch-mon-year-seq": return `${br}-${mon}-${y}-${n}`;
    case "inv-year-seq":        return `INV-${y}-${n}`;
    case "inv-mon-year-seq":    return `INV-${mon}-${y}-${n}`;
    case "year-slash-seq":      return `${y}/${n}`;
    case "prefix-seq":          return `${(customPrefix||"AQ").toUpperCase()}-${n}`;
    case "seq-only":            return n;
    default:                    return `${br}-${y}-${n}`;
  }
}

/* Extract the trailing numeric sequence from an invoice number string.
   Works for all formats: MK-2025-0042 → 42, INV-2025-0003 → 3, AQ-0007 → 7 */
function extractSeq(numStr) {
  if (!numStr) return 0;
  const parts = numStr.replace(/\//g,"-").split("-");
  const last = parts[parts.length-1];
  const n = parseInt(last, 10);
  return isNaN(n) ? 0 : n;
}

/* Return the next seq number by scanning all saved invoices AND the stored
   high-water mark. The high-water mark ensures deleted invoice numbers are
   never reused — it only ever moves forward, never back. */
function nextSeqFor(invoices, formatId, branch, customPrefix, hwm=0, issueDate) {
  const y = new Date().getFullYear();
  const br = branch==="madinah" ? "MD" : "MK";
  const mon = monthAbbr(issueDate); // e.g. "JAN" — for month-scoped formats
  const relevant = (invoices||[]).filter(inv=>{
    if (!inv.number) return false;
    // Only count numbers that match the same format/prefix/branch/year(/month)
    switch(formatId) {
      case "branch-year-seq":     return inv.number.startsWith(`${br}-${y}-`);
      case "branch-mon-year-seq": return inv.number.startsWith(`${br}-${mon}-${y}-`);
      case "inv-year-seq":        return inv.number.startsWith(`INV-${y}-`);
      case "inv-mon-year-seq":    return inv.number.startsWith(`INV-${mon}-${y}-`);
      case "year-slash-seq":      return inv.number.startsWith(`${y}/`);
      case "prefix-seq":          return inv.number.startsWith(`${(customPrefix||"AQ").toUpperCase()}-`);
      case "seq-only":            return /^\d+$/.test(inv.number);
      default:                    return inv.number.startsWith(`${br}-${y}-`);
    }
  });
  const maxFromInvoices = relevant.reduce((m,inv)=>Math.max(m, extractSeq(inv.number)), 0);
  // Always pick the higher of: current invoices max OR stored high-water mark
  // This prevents reuse of sequence numbers from deleted invoices
  return Math.max(maxFromInvoices, hwm) + 1;
}

/* Stacks Gregorian (EN) date over Hijri (AR) date — used in all display spots */
function DateBoth({ dateStr, enSize=13, arSize=11, color="#000", arColor=null }) {
  if (!dateStr) return null;
  return (
    <span style={{ display:"inline-flex", flexDirection:"column", lineHeight:1.4 }}>
      <span style={{ fontSize:enSize, color }}>{fmtDate(dateStr)}</span>
      <span style={{ fontSize:arSize, color:arColor??color,
        fontFamily:"'Noto Naskh Arabic',serif", direction:"rtl" }}>
        {fmtHijri(dateStr)}
      </span>
    </span>
  );
}

function buildZatcaQR({ sellerName, vatNumber, timestamp, total, vatTotal }) {
  const tlv = (tag, val) => { const enc = new TextEncoder().encode(val); return [tag, enc.length, ...enc]; };
  const bytes = [...tlv(1,sellerName),...tlv(2,vatNumber),...tlv(3,timestamp),...tlv(4,total),...tlv(5,vatTotal)];
  return btoa(String.fromCharCode(...bytes));
}

/* ═══════════════════════════════════════════════════════════
   STYLES (CSS-in-JS object helpers)
═══════════════════════════════════════════════════════════ */
const css = {
  // Layout
  flex: (gap=0,align="center",justify="flex-start") => ({ display:"flex",alignItems:align,justifyContent:justify,gap }),
  col:  (gap=0) => ({ display:"flex",flexDirection:"column",gap }),
  grid: (cols,gap=12) => ({ display:"grid",gridTemplateColumns:cols,gap }),

  // Cards
  card: { background:T.white, border:`1px solid ${T.gray100}`, borderRadius:8, padding:"1.5rem", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" },
  cardSm: { background:T.white, border:`1px solid ${T.gray100}`, borderRadius:8, padding:"1rem", boxShadow:"0 1px 3px rgba(0,0,0,0.05)" },

  // Typography
  h1: { fontSize:"1.6rem", fontWeight:700, color:T.ink, fontFamily:"'DM Serif Display',Georgia,serif", letterSpacing:".01em" },
  h2: { fontSize:"1.1rem", fontWeight:600, color:T.ink, letterSpacing:".01em" },
  label: { fontSize:".7rem", fontWeight:600, letterSpacing:".1em", textTransform:"uppercase", color:T.gray500 },
  body: { fontSize:".875rem", color:T.gray700 },
  small: { fontSize:".75rem", color:T.gray500 },

  // Inputs
  input: {
    background:T.white, border:`1px solid ${T.gray200}`, borderRadius:6,
    padding:".55rem .8rem", fontSize:".875rem", color:T.ink,
    outline:"none", width:"100%", fontFamily:"inherit",
    transition:"border-color .15s",
  },

  // Buttons
  btnPrimary: {
    background:T.blue, color:T.white, border:"none", borderRadius:6,
    padding:".55rem 1.2rem", fontSize:".8rem", fontWeight:600,
    letterSpacing:".05em", textTransform:"uppercase", cursor:"pointer",
    display:"inline-flex", alignItems:"center", gap:6,
    transition:"background .15s, transform .1s",
  },
  btnSecondary: {
    background:T.white, color:T.gray700, border:`1px solid ${T.gray200}`,
    borderRadius:6, padding:".5rem 1.1rem", fontSize:".8rem", fontWeight:500,
    cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6,
    transition:"border-color .15s",
  },
  btnDanger: {
    background:T.danger, color:T.white, border:"none", borderRadius:6,
    padding:".5rem 1rem", fontSize:".8rem", fontWeight:600, cursor:"pointer",
    display:"inline-flex", alignItems:"center", gap:6,
  },
  iconBtn: {
    background:"none", border:"none", cursor:"pointer", padding:6,
    borderRadius:6, color:T.gray500, display:"inline-flex", alignItems:"center",
    transition:"background .12s, color .12s",
  },
};

/* ═══════════════════════════════════════════════════════════
   GLOBAL STYLES (injected once)
═══════════════════════════════════════════════════════════ */
const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600&family=Noto+Naskh+Arabic:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body,#root{height:100%;background:#F2F3F5;font-family:'DM Sans',sans-serif;color:#1A1D24}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:#F2F3F5}
::-webkit-scrollbar-thumb{background:#C8CDD6;border-radius:3px}
input:focus{border-color:#5BA4CF!important;box-shadow:0 0 0 3px rgba(91,164,207,.15)!important}
select:focus{border-color:#5BA4CF!important;outline:none}
textarea:focus{border-color:#5BA4CF!important;outline:none}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes spin{to{transform:rotate(360deg)}}
.fade-up{animation:fadeUp .25s ease both}
.fade-in{animation:fadeIn .2s ease both}
@media print{
  .no-print{display:none!important}
  body{background:white;margin:0;padding:0}
  @page{size:A4 portrait;margin:10mm}
}
`;

/* ═══════════════════════════════════════════════════════════
   MINI COMPONENTS
═══════════════════════════════════════════════════════════ */
function Badge({ type, children }) {
  const styles = {
    paid:    { background:"#E8F5EF", color:"#1E7A4A", border:"1px solid #A8DBC0" },
    unpaid:  { background:"#FDECEA", color:"#B52E2E", border:"1px solid #F5C0C0" },
    admin:   { background:T.bluePale, color:T.blueDark, border:`1px solid ${T.blueLight}` },
    staff:   { background:T.gray50, color:T.gray700, border:`1px solid ${T.gray200}` },
    makkah:  { background:"#F0F4FF", color:"#3054B5", border:"1px solid #B8CBF5" },
    madinah: { background:"#F5F0FF", color:"#5A3BB5", border:"1px solid #CBB8F5" },
  };
  return (
    <span style={{ ...styles[type]||styles.staff, fontSize:".67rem", fontWeight:700, letterSpacing:".08em",
      textTransform:"uppercase", padding:"2px 8px", borderRadius:20, whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
}

function Toast({ toasts }) {
  return (
    <div style={{ position:"fixed",bottom:"1.5rem",right:"1.5rem",zIndex:9999,display:"flex",flexDirection:"column",gap:8 }}>
      {toasts.map(t => (
        <div key={t.id} className="fade-up" style={{
          background:T.white, border:`1px solid ${T.gray100}`,
          borderLeft:`3px solid ${t.type==="error"?T.danger:t.type==="success"?T.success:T.blue}`,
          padding:".7rem 1rem", borderRadius:6, fontSize:".82rem", color:T.ink,
          boxShadow:"0 4px 16px rgba(0,0,0,0.1)", maxWidth:300,
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

function Modal({ open, onClose, title, children, footer, wide }) {
  if (!open) return null;
  return (
    <div className="fade-in" style={{ position:"fixed",inset:0,zIndex:800,background:"rgba(15,17,23,.5)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem" }}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="fade-up" style={{ background:T.white, borderRadius:10, width:"100%",
        maxWidth:wide?720:500, maxHeight:"90vh", overflowY:"auto",
        boxShadow:"0 20px 60px rgba(0,0,0,0.2)", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"1.25rem 1.5rem", borderBottom:`1px solid ${T.gray100}`,
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span style={{ fontSize:"1rem", fontWeight:700, color:T.ink, fontFamily:"'DM Serif Display',serif" }}>{title}</span>
          <button style={css.iconBtn} onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ padding:"1.5rem", flex:1 }}>{children}</div>
        {footer && <div style={{ padding:"1rem 1.5rem", borderTop:`1px solid ${T.gray100}`, display:"flex", gap:8, justifyContent:"flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

function Confirm({ open, title, msg, onOk, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={<>
        <button style={css.btnSecondary} onClick={onClose}>Cancel</button>
        <button style={css.btnDanger} onClick={()=>{onClose();onOk();}}>Confirm Delete</button>
      </>}>
      <p style={{ color:T.gray700, lineHeight:1.7, fontSize:".875rem" }}>{msg}</p>
    </Modal>
  );
}

function FormGroup({ label, children }) {
  return (
    <div style={css.col(5)}>
      <label style={css.label}>{label}</label>
      {children}
    </div>
  );
}

function Input({ ...props }) {
  return <input style={css.input} {...props} />;
}

function Select({ children, ...props }) {
  return (
    <select style={{ ...css.input, appearance:"none", cursor:"pointer",
      backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B7585' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
      backgroundRepeat:"no-repeat", backgroundPosition:"right 10px center" }} {...props}>
      {children}
    </select>
  );
}

/* KPI Card */
function KpiCard({ label, value, sub, icon, color }) {
  return (
    <div style={{ ...css.card, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute",top:0,left:0,right:0,height:3,background:color||T.blue,borderRadius:"8px 8px 0 0" }} />
      <div style={css.flex(0,"flex-start","space-between")}>
        <div>
          <div style={{ ...css.label, marginBottom:10 }}>{label}</div>
          <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.7rem", color:T.ink, lineHeight:1 }}>{value}</div>
          {sub && <div style={{ fontSize:".72rem", color:T.gray500, marginTop:6 }}>{sub}</div>}
        </div>
        <div style={{ width:40,height:40,borderRadius:8,background:T.bluePale,
          display:"flex",alignItems:"center",justifyContent:"center",color:T.blue, flexShrink:0 }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/* Section heading */
function SectionHead({ en, ar }) {
  return (
    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:16 }}>
      <div style={{ width:3,height:18,background:T.blue,borderRadius:2 }} />
      <span style={{ fontSize:".7rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",color:T.blue }}>{en}</span>
      {ar && <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:".85rem",color:T.gray500,direction:"rtl" }}>{ar}</span>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HEADER
═══════════════════════════════════════════════════════════ */
function Header({ user, lang, setLang, online, onSync, onNav, page, onLogout, invoices, onExportExcel }) {
  const p = user?.permissions || {};
  const isAdmin = user?.role === "admin";
  const can = (k) => isAdmin || !!p[k];

  const navItems = [
    { id:"dashboard", label:"Dashboard", ar:"لوحة التحكم" },
    { id:"invoices",  label:"Invoices",  ar:"الفواتير" },
    ...(can("createInvoice") ? [{ id:"new", label:"New Invoice", ar:"فاتورة جديدة" }] : []),
    ...(can("manageClients") ? [{ id:"clients", label:"Clients", ar:"العملاء" }] : []),
    ...(can("viewReports")   ? [{ id:"reports",  label:"Reports",  ar:"التقارير" }] : []),
    ...(can("accessSettings")? [{ id:"settings", label:"Settings", ar:"الإعدادات" }] : []),
  ];

  /* Shortcuts — only shown if user has permission */
  const shortcuts = [
    ...(can("createInvoice") ? [{
      id:"new", label:"New Invoice", ar:"فاتورة جديدة",
      color:"#6EFFC7", bg:"rgba(46,158,107,.25)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    }] : []),
    {
      id:"invoices", label:"All Invoices", ar:"الفواتير",
      color:"#A8CDED", bg:"rgba(91,164,207,.25)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    },
    ...(can("manageClients") ? [{
      id:"clients", label:"Clients", ar:"العملاء",
      color:"#C4B5FD", bg:"rgba(139,92,246,.25)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
    }] : []),
    ...(can("viewReports") ? [{
      id:"reports", label:"Reports", ar:"التقارير",
      color:"#FCD34D", bg:"rgba(217,123,0,.25)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    }] : []),
    ...(can("exportData") ? [{
      id:"export", label:"Export Excel", ar:"تصدير",
      color:"#86EFAC", bg:"rgba(46,158,107,.2)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    }] : []),
    ...(can("accessSettings") ? [{
      id:"settings", label:"Settings", ar:"الإعدادات",
      color:"rgba(255,255,255,.7)", bg:"rgba(255,255,255,.12)",
      icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
    }] : []),
  ];

  const handleShortcut = (id) => {
    if (id === "export") { if(onExportExcel) onExportExcel(); return; }
    onNav(id);
  };

  return (
    <header style={{
      background:`linear-gradient(135deg, ${T.blueDark} 0%, ${T.blue} 60%, ${T.blueLight} 100%)`,
      boxShadow:"0 2px 12px rgba(58,127,181,.25)", position:"sticky", top:0, zIndex:100,
    }}>
      {/* Top row */}
      <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 1.5rem",
        display:"flex", alignItems:"center", justifyContent:"space-between", height:58 }}>
        {/* Brand */}
        <div style={css.flex(10)}>
          <div style={{ width:36,height:36,background:"rgba(255,255,255,.15)",borderRadius:8,
            display:"flex",alignItems:"center",justifyContent:"center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.1rem", color:"white", letterSpacing:".04em", lineHeight:1 }}>
              AQSA INVOICE
            </div>
            <div style={{ fontFamily:"'Noto Naskh Arabic',serif", fontSize:".72rem", color:"rgba(255,255,255,.75)", lineHeight:1.3 }}>
              نظام الفواتير الفندقي
            </div>
          </div>
        </div>

        {/* Right controls */}
        <div style={css.flex(12)}>
          {/* Online indicator */}
          <div style={css.flex(6,"center")}>
            <div style={{ width:7,height:7,borderRadius:"50%",
              background:online?"#6EFFC7":"rgba(255,255,255,.4)",
              boxShadow:online?"0 0 6px #6EFFC7":"none" }} />
            <span style={{ fontSize:".72rem", color:"rgba(255,255,255,.8)" }}>{online?"Online":"Offline"}</span>
            <button onClick={onSync} style={{ ...css.iconBtn, color:"rgba(255,255,255,.8)" }} title="Sync">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          </div>
          {/* Lang */}
          <div style={{ display:"flex",background:"rgba(255,255,255,.15)",borderRadius:20,padding:2 }}>
            {["en","ar"].map(l => (
              <button key={l} onClick={()=>setLang(l)} style={{
                padding:"3px 10px", borderRadius:18, border:"none", cursor:"pointer",
                fontSize:".72rem", fontWeight:700, letterSpacing:".06em", textTransform:"uppercase",
                background:lang===l?"white":"transparent",
                color:lang===l?T.blueDark:"rgba(255,255,255,.85)",
                transition:"all .15s",
              }}>{l==="en"?"EN":"ع"}</button>
            ))}
          </div>
          {/* User */}
          <div style={css.flex(8)}>
            <div style={{ width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,.2)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:".8rem",fontWeight:700,color:"white" }}>
              {(user?.name||"U")[0].toUpperCase()}
            </div>
            <div style={{ display:"flex",flexDirection:"column" }}>
              <span style={{ fontSize:".8rem",fontWeight:600,color:"white",lineHeight:1 }}>{user?.name}</span>
              <span style={{ fontSize:".65rem",color:"rgba(255,255,255,.7)",textTransform:"capitalize" }}>{user?.role}</span>
            </div>
            <button onClick={onLogout} style={{ ...css.iconBtn, color:"rgba(255,255,255,.8)" }} title="Sign out">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
                <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Nav row */}
      <div style={{ background:"rgba(0,0,0,.08)", borderTop:"1px solid rgba(255,255,255,.12)" }}>
        <div style={{ maxWidth:1400, margin:"0 auto", padding:"0 1.5rem", display:"flex", gap:2 }}>
          {navItems.map(n => (
            <button key={n.id} onClick={()=>onNav(n.id)} style={{
              padding:".55rem 1rem", border:"none", cursor:"pointer",
              fontSize:".78rem", fontWeight:600, letterSpacing:".04em",
              background:page===n.id?"rgba(255,255,255,.15)":"transparent",
              color:page===n.id?"white":"rgba(255,255,255,.75)",
              borderBottom:`2px solid ${page===n.id?"white":"transparent"}`,
              transition:"all .15s", display:"flex", alignItems:"center", gap:5,
              whiteSpace:"nowrap",
            }}>
              {lang==="ar" ? n.ar : n.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

/* ═══════════════════════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════════════════════ */
function Footer({ company, lang }) {
  return (
    <footer style={{
      background:`linear-gradient(135deg, ${T.blueDark}, ${T.blue})`,
      borderTop:`1px solid ${T.blueLight}`,
      padding:"1rem 1.5rem", marginTop:"auto",
    }}>
      <div style={{ maxWidth:1400, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={css.flex(16)}>
          <span style={{ fontFamily:"'DM Serif Display',serif", fontSize:".9rem", color:"white", letterSpacing:".05em" }}>
            {company?.companyEn || company?.companyAr || ""}
          </span>
          <span style={{ fontFamily:"'Noto Naskh Arabic',serif", fontSize:".85rem", color:"rgba(255,255,255,.75)" }}>
            {company?.companyAr || "فنادق الأقصى"}
          </span>
        </div>
        <div style={css.flex(20)}>
          {["Makkah Branch مكة","Madinah Branch المدينة","VAT: "+((company?.vatNumber||"").slice(0,10)+"...")].map((t,i) => (
            <span key={i} style={{ fontSize:".7rem", color:"rgba(255,255,255,.7)" }}>{t}</span>
          ))}
        </div>
        <div style={{ fontSize:".7rem", color:"rgba(255,255,255,.6)", letterSpacing:".08em" }}>
          © {new Date().getFullYear()}
        </div>
      </div>
    </footer>
  );
}


/* ═══════════════════════════════════════════════════════════
   LOGIN PAGE
═══════════════════════════════════════════════════════════ */
function LoginPage({ onLogin }) {
  const [email,   setEmail]   = useState("");
  const [pass,    setPass]    = useState("");
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");
  const [mode,    setMode]    = useState("login"); // "login" | "reset"
  const [resetSent, setResetSent] = useState(false);
  const [showPass,  setShowPass]  = useState(false);

  // friendly Firebase error messages
  const friendly = (code) => {
    switch(code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":   return "Invalid email or password.";
      case "auth/user-disabled":    return "This account has been disabled. Contact your admin.";
      case "auth/too-many-requests":return "Too many failed attempts. Please wait a moment.";
      case "auth/network-request-failed": return "No internet connection. Check your network.";
      default: return "Sign in failed. Please try again.";
    }
  };

  const submit = async () => {
    setLoading(true); setErr(""); setResetSent(false);
    try {
      if (mode === "reset") {
        try {
          const { sendPasswordResetEmail } = await import("firebase/auth");
          const { auth } = await import("./firebase/firebase.js");
          await sendPasswordResetEmail(auth, email);
          setResetSent(true);
        } catch {
          setErr("Password reset is only available when Firebase is configured.");
        }
      } else {
        const ok = await onLogin(email, pass);
        if (!ok) setErr("Invalid email or password.");
      }
    } catch(e) {
      setErr(friendly(e.code));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", background:`linear-gradient(160deg, ${T.bluePale} 0%, ${T.gray50} 50%, white 100%)`,
      display:"flex", alignItems:"center", justifyContent:"center", padding:"1rem" }}>
      <style>{GLOBAL_CSS}</style>
      <div className="fade-up" style={{ width:"100%", maxWidth:420, background:T.white,
        borderRadius:12, boxShadow:"0 20px 60px rgba(58,127,181,.15)", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ background:`linear-gradient(135deg,${T.blueDark},${T.blue})`, padding:"2rem 2rem 1.5rem" }}>
          <div style={{ textAlign:"center" }}>
            <div style={{ width:56,height:56,borderRadius:12,background:"rgba(255,255,255,.15)",
              margin:"0 auto 12px",display:"flex",alignItems:"center",justifyContent:"center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.6">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
            </div>
            <div style={{ fontFamily:"'DM Serif Display',serif",fontSize:"1.5rem",color:"white",letterSpacing:".06em" }}>
              AQSA INVOICE
            </div>
            <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:".9rem",color:"rgba(255,255,255,.8)",marginTop:4 }}>
              نظام إدارة الفواتير الفندقي
            </div>
            <div style={{ fontSize:".65rem",letterSpacing:".18em",textTransform:"uppercase",color:"rgba(255,255,255,.65)",marginTop:6 }}>
              {mode==="reset" ? "Password Reset · إعادة تعيين كلمة المرور" : "Makkah · Madinah"}
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:"2rem" }}>
          <div style={css.col(14)}>

            {/* Reset sent confirmation */}
            {resetSent && (
              <div style={{ fontSize:".8rem",color:T.success,background:"#E8F5EF",padding:".65rem .85rem",borderRadius:6,lineHeight:1.6 }}>
                ✓ Password reset link sent to <strong>{email}</strong>. Check your inbox.
              </div>
            )}

            {/* Error */}
            {err && (
              <div style={{ fontSize:".8rem",color:T.danger,background:"#FDECEA",padding:".5rem .75rem",borderRadius:6 }}>{err}</div>
            )}

            {/* Email */}
            <FormGroup label="Email Address · البريد الإلكتروني">
              <Input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="admin@hotel.sa" autoFocus />
            </FormGroup>

            {/* Password — only in login mode */}
            {mode==="login" && (
              <FormGroup label="Password · كلمة المرور">
                <div style={{ position:"relative" }}>
                  <Input type={showPass?"text":"password"} value={pass}
                    onChange={e=>setPass(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&submit()}
                    placeholder="••••••••"
                    style={{ ...css.input, paddingRight:38 }} />
                  <button type="button" onClick={()=>setShowPass(v=>!v)}
                    style={{ position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",
                      background:"none",border:"none",cursor:"pointer",color:T.gray400,padding:2 }}>
                    {showPass
                      ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/></svg>
                      : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                  </button>
                </div>
                <div style={{ textAlign:"right",marginTop:4 }}>
                  <span style={{ fontSize:".72rem",color:T.blue,cursor:"pointer",fontWeight:600 }}
                    onClick={()=>{ setMode("reset"); setErr(""); setResetSent(false); }}>
                    Forgot password?
                  </span>
                </div>
              </FormGroup>
            )}

            {/* Submit button */}
            <button onClick={submit} disabled={loading}
              style={{ ...css.btnPrimary, width:"100%", justifyContent:"center", padding:".75rem",
                opacity:loading?.7:1, cursor:loading?"not-allowed":"pointer" }}>
              {loading
                ? (mode==="reset"?"Sending…":"Signing in…")
                : (mode==="reset"?"Send Reset Link · إرسال الرابط":"Sign In · تسجيل الدخول")}
            </button>

            {/* Back to login link */}
            {mode==="reset" && (
              <div style={{ textAlign:"center",marginTop:4 }}>
                <span style={{ fontSize:".78rem",color:T.blue,cursor:"pointer",fontWeight:600 }}
                  onClick={()=>{ setMode("login"); setErr(""); setResetSent(false); }}>
                  ← Back to Sign In
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD PAGE
═══════════════════════════════════════════════════════════ */
function Dashboard({ invoices, onNav, lang, settings, onNav: navTo }) {
  const totalRev  = invoices.reduce((s,i)=>s+i.grandTotal,0);
  const totalVat  = invoices.reduce((s,i)=>s+i.vatTotal,0);
  const outstanding = invoices.filter(i=>i.status==="unpaid").reduce((s,i)=>s+i.grandTotal,0);
  const unpaid    = invoices.filter(i=>i.status==="unpaid").length;

  // Check if backup is due
  const backupSchedule = settings?.backupSchedule || "manual";
  const lastBackup     = settings?.lastBackupAt   || null;
  const backupDue = (() => {
    if (backupSchedule === "manual" || !lastBackup) return false;
    const diffDays = (Date.now() - new Date(lastBackup)) / (1000*60*60*24);
    return (backupSchedule==="daily"&&diffDays>=1)||(backupSchedule==="weekly"&&diffDays>=7)||(backupSchedule==="monthly"&&diffDays>=30);
  })();
  const neverBacked = backupSchedule !== "manual" && !lastBackup;
  const paid      = invoices.filter(i=>i.status==="paid").length;
  const recent    = [...invoices].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,8);

  // Monthly data
  const months=[]; const revData=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    months.push(d.toLocaleString("default",{month:"short"}));
    revData.push(invoices.filter(inv=>inv.issueDate?.startsWith(key)).reduce((s,i)=>s+i.grandTotal,0));
  }
  const maxRev = Math.max(...revData,1);

  const t = (en,ar) => lang==="ar"?ar:en;

  return (
    <div className="fade-up" style={css.col(24)}>

      {/* ── Backup due notification banner ── */}
      {(backupDue || neverBacked) && (
        <div style={{ background:"#FFF8E0",border:"1px solid #F5DFA0",borderRadius:10,padding:"12px 18px",
          display:"flex",alignItems:"center",gap:12 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B87800" strokeWidth="2" style={{flexShrink:0}}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700,color:"#7A5200",fontSize:".85rem" }}>
              {neverBacked ? "No backup yet" : `${backupSchedule.charAt(0).toUpperCase()+backupSchedule.slice(1)} backup overdue`}
            </div>
            <div style={{ fontSize:".72rem",color:"#9A6800",marginTop:1 }}>
              {neverBacked
                ? `You have ${invoices.length} invoices with no backup. Go to Settings → Backup to export.`
                : `Last backup: ${new Date(lastBackup).toLocaleDateString("en-SA",{day:"2-digit",month:"short",year:"numeric"})}. Create a backup to keep your data safe.`}
            </div>
          </div>
          <button style={{ ...css.btnSecondary,fontSize:".75rem",padding:".4rem .9rem",borderColor:"#B87800",color:"#7A5200",flexShrink:0 }}
            onClick={()=>onNav("settings")}>
            Go to Backup →
          </button>
        </div>
      )}

      {/* KPIs */}
      <div style={css.grid("repeat(4,1fr)",16)}>
        <KpiCard label={t("Total Revenue","إجمالي الإيرادات")}
          value={<><span style={{fontSize:"1rem",color:T.blue}}>SAR </span>{fmt(totalRev)}</>}
          sub={t("All invoices","جميع الفواتير")} color={T.blue}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>} />
        <KpiCard label={t("VAT Collected","ضريبة القيمة المضافة")}
          value={<><span style={{fontSize:"1rem",color:T.gray500}}>SAR </span>{fmt(totalVat)}</>}
          sub="15% Rate" color={T.gray300}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>} />
        <KpiCard label={t("Total Invoices","إجمالي الفواتير")}
          value={invoices.length}
          sub={`${paid} ${t("paid","مدفوع")} · ${unpaid} ${t("unpaid","غير مدفوع")}`} color={T.success}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>} />
        <KpiCard label={t("Outstanding","مبالغ معلقة")}
          value={<><span style={{fontSize:"1rem",color:T.danger}}>SAR </span>{fmt(outstanding)}</>}
          sub={`${unpaid} ${t("unpaid invoices","فاتورة غير مدفوعة")}`} color={T.danger}
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>} />
      </div>

      <div style={css.grid("2fr 1fr",16)}>
        {/* Bar chart */}
        <div style={css.card}>
          <SectionHead en="Monthly Revenue (SAR)" ar="الإيرادات الشهرية" />
          <div style={{ display:"flex",alignItems:"flex-end",gap:10,height:160,paddingBottom:8 }}>
            {months.map((m,i) => (
              <div key={m} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                <div style={{ width:"100%", borderRadius:"4px 4px 0 0",
                  height:Math.max(4, (revData[i]/maxRev)*140),
                  position:"relative", overflow:"hidden",
                  background:`linear-gradient(180deg, ${T.blueLight}, ${T.blue})`,
                  transition:"height .4s ease" }}>
                  {revData[i]>0 && <div style={{ position:"absolute",bottom:2,width:"100%",
                    textAlign:"center",fontSize:".55rem",color:"white",fontWeight:700 }}>
                    {(revData[i]/1000).toFixed(0)}k
                  </div>}
                </div>
                <span style={{ fontSize:".65rem", color:T.gray500 }}>{m}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Donut-style status */}
        <div style={css.card}>
          <SectionHead en="Invoice Status" ar="حالة الفواتير" />
          <div style={{ display:"flex",flexDirection:"column",gap:12 }}>
            {[
              { label:t("Paid","مدفوع"), count:paid, color:T.success },
              { label:t("Unpaid","غير مدفوع"), count:unpaid, color:T.danger },
              { label:t("Makkah","مكة"), count:invoices.filter(i=>i.branch==="makkah").length, color:T.blue },
              { label:t("Madinah","المدينة"), count:invoices.filter(i=>i.branch==="madinah").length, color:T.blueLight },
            ].map(item => (
              <div key={item.label}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                  <span style={{ fontSize:".78rem",color:T.gray700 }}>{item.label}</span>
                  <span style={{ fontSize:".78rem",fontWeight:700,color:T.ink }}>{item.count}</span>
                </div>
                <div style={{ height:6,background:T.gray100,borderRadius:3,overflow:"hidden" }}>
                  <div style={{ height:"100%",borderRadius:3,background:item.color,
                    width:`${invoices.length?(item.count/invoices.length)*100:0}%`,
                    transition:"width .5s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent invoices */}
      <div style={css.card}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <SectionHead en="Recent Invoices" ar="آخر الفواتير" />
          <button style={css.btnSecondary} onClick={()=>onNav("invoices")}>
            {t("View All","عرض الكل")}
          </button>
        </div>
        <InvoiceTable invoices={recent} onNav={onNav} compact lang={lang} />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INVOICE TABLE (shared)
═══════════════════════════════════════════════════════════ */
function InvoiceTable({ invoices, onToggleStatus, onDelete, onEdit, onPreview, onReceiptVoucher, onCreditInv, compact, lang, user }) {
  const isAdmin = user?.role==="admin";
  const can = (k) => isAdmin || !!(user?.permissions?.[k]);
  const t=(en,ar)=>lang==="ar"?ar:en;
  if (!invoices.length) return (
    <div style={{ textAlign:"center",padding:"3rem",color:T.gray300 }}>
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{marginBottom:12}}>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
      </svg>
      <div style={{fontSize:".875rem"}}>No invoices found</div>
    </div>
  );
  return (
    <div style={{ overflowX:"auto" }}>
      <table style={{ width:"100%",borderCollapse:"collapse",fontSize:".82rem" }}>
        <thead>
          <tr style={{ borderBottom:`2px solid ${T.gray100}` }}>
            {[t("Invoice #","#"),t("Client","العميل"),t("Branch","الفرع"),
              t("Date","التاريخ"),t("Total","المجموع"),t("Received","المستلم"),t("Status","الحالة"),
              ...(!compact?[t("Actions","إجراءات")]:[])
            ].map((h,i)=>(
              <th key={i} style={{ padding:".6rem .75rem",textAlign:"left",fontWeight:700,
                fontSize:".67rem",letterSpacing:".1em",textTransform:"uppercase",color:T.gray500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoices.map(inv => (
            <tr key={inv.id} style={{ borderBottom:`1px solid ${T.gray100}`, transition:"background .1s",
              background: inv.type==="credit" ? "#FFFAFA" : "transparent" }}
              onMouseEnter={e=>e.currentTarget.style.background=inv.type==="credit"?"#FFF0F0":T.gray50}
              onMouseLeave={e=>e.currentTarget.style.background=inv.type==="credit"?"#FFFAFA":"transparent"}>
              <td style={{ padding:".65rem .75rem",fontWeight:700,color:inv.type==="credit"?T.danger:T.blue,fontFamily:"'DM Sans',monospace" }}>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  {inv.number}
                  {inv.type==="credit" && <span style={{ fontSize:".6rem",fontWeight:700,padding:"1px 6px",borderRadius:10,background:"#FFF0F0",color:T.danger,border:`1px solid #F5C0C0`,letterSpacing:".06em" }}>CREDIT</span>}
                </div>
                {inv.originalInvNumber && <div style={{ fontSize:".65rem",color:T.gray500,marginTop:1 }}>↩ {inv.originalInvNumber}</div>}
                {/* Created/Updated by audit trail */}
                {inv.createdBy && (
                  <div style={{ fontSize:".6rem",color:T.gray400,marginTop:2,display:"flex",alignItems:"center",gap:3 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                    {inv.createdBy.split("@")[0]}
                    {inv.updatedBy && inv.updatedBy!==inv.createdBy && (
                      <span style={{ color:T.blue }}> · ✏ {inv.updatedBy.split("@")[0]}</span>
                    )}
                  </div>
                )}
              </td>
              <td style={{ padding:".65rem .75rem" }}>
                <div style={{ fontWeight:500,color:T.ink }}>{inv.clientNameEn}</div>
                {inv.clientNameAr && <div style={{ fontSize:".7rem",color:T.gray500,fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl" }}>{inv.clientNameAr}</div>}
              </td>
              <td style={{ padding:".65rem .75rem" }}><Badge type={inv.branch}>{inv.branch}</Badge></td>
              <td style={{ padding:".65rem .75rem",color:T.gray500,fontSize:".78rem" }}><DateBoth dateStr={inv.issueDate} enSize={12} arSize={10} color={T.gray500} /></td>
              <td style={{ padding:".65rem .75rem",fontWeight:700,color:inv.type==="credit"?T.danger:inv.type==="receipt"?T.success:T.ink }}>
                {inv.type==="credit" && <span style={{ marginRight:1 }}>−</span>}
                {inv.type==="receipt" && <span style={{ marginRight:1 }}>✓</span>}
                <span style={{ fontSize:".7rem",color:T.gray400,marginRight:2 }}>SAR</span>{fmt(inv.grandTotal)}
              </td>
              <td style={{ padding:".65rem .75rem" }}>
                {inv.type!=="credit" ? (
                  <div>
                    <div style={{ fontWeight:700,fontSize:".82rem",color:(inv.amountPaid||0)>0?T.success:T.gray300 }}>
                      <span style={{ fontSize:".7rem",color:T.gray400,marginRight:2 }}>SAR</span>{fmt(inv.amountPaid||0)}
                    </div>
                    {(inv.amountPaid||0)>0 && inv.grandTotal>(inv.amountPaid||0) && (
                      <div style={{ fontSize:".65rem",color:T.danger,marginTop:1 }}>
                        Bal: SAR {fmt(inv.grandTotal-(inv.amountPaid||0))}
                      </div>
                    )}
                  </div>
                ) : <span style={{ color:T.gray300,fontSize:".75rem" }}>—</span>}
              </td>
              <td style={{ padding:".65rem .75rem" }}><Badge type={inv.status}>{inv.status}</Badge></td>
              {!compact && (
                <td style={{ padding:".65rem .75rem" }}>
                  <div style={css.flex(4)}>
                    {onPreview && <button style={css.iconBtn} onClick={()=>onPreview(inv.id)} title="Preview"
                      onMouseEnter={e=>{e.currentTarget.style.background=T.bluePale;e.currentTarget.style.color=T.blue}}
                      onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=T.gray500}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    </button>}
                    {can("createInvoice") && onEdit && !inv.type && <button style={css.iconBtn} onClick={()=>onEdit(inv.id)} title="Edit"
                      onMouseEnter={e=>{e.currentTarget.style.background=T.bluePale;e.currentTarget.style.color=T.blue}}
                      onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=T.gray500}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>}
                    {can("createInvoice") && onReceiptVoucher && !inv.type && <button style={{ ...css.iconBtn,color:T.success }} onClick={()=>onReceiptVoucher(inv)} title="Issue Receipt Voucher"
                      onMouseEnter={e=>{e.currentTarget.style.background="#E8F5EF";}}
                      onMouseLeave={e=>{e.currentTarget.style.background="none";}}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/><polyline points="9 9 10 9 11 9"/></svg>
                    </button>}

                    {can("markPaid") && onToggleStatus && !inv.type && <button style={{ ...css.iconBtn,color:inv.status==="paid"?T.success:T.danger }} onClick={()=>onToggleStatus(inv.id)} title="Toggle status"
                      onMouseEnter={e=>e.currentTarget.style.background=T.gray100}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>}
                    {can("deleteInvoice") && onDelete && <button style={{ ...css.iconBtn,color:T.danger }} onClick={()=>onDelete(inv.id)} title="Delete"
                      onMouseEnter={e=>e.currentTarget.style.background="#FDECEA"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INVOICES LIST PAGE
═══════════════════════════════════════════════════════════ */
function InvoicesPage({ invoices, onToggleStatus, onDelete, onEdit, onPreview, onNav, onExportExcel, onSaveInvoice, clients, settings, lang, user }) {
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const [branchF, setBranchF] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [receiptFor, setReceiptFor] = useState(null);
  const [creditFor,  setCreditFor]  = useState(null);
  const t=(en,ar)=>lang==="ar"?ar:en;

  // ── Listen for native menu filter commands ────────────────────────────────
  useEffect(()=>{
    const handler = (e) => {
      const f = e.detail;
      if (f.clear)   { setStatusF(""); setBranchF(""); return; }
      if (f.status)  setStatusF(f.status);
      if (f.branch)  setBranchF(f.branch);
    };
    window.addEventListener('aqsa-menu-filter', handler);
    return () => window.removeEventListener('aqsa-menu-filter', handler);
  }, []);

  const filtered = invoices.filter(inv => {
    const q = search.toLowerCase();
    const statusMatch = !statusF
      || (statusF === "credit" ? inv.type === "credit" : inv.status === statusF && inv.type !== "credit");
    return (!q || inv.number.toLowerCase().includes(q) || (inv.clientNameEn||"").toLowerCase().includes(q) || (inv.clientNameAr||"").includes(q))
      && statusMatch
      && (!branchF || inv.branch===branchF)
      && (!dateFrom || (inv.issueDate||"") >= dateFrom)
      && (!dateTo   || (inv.issueDate||"") <= dateTo);
  });

  return (
    <div className="fade-up" style={css.col(20)}>
      <div style={css.flex(0,"center","space-between")}>
        <div>
          <h1 style={css.h1}>{t("Invoices","الفواتير")}</h1>
          <p style={{ ...css.small,marginTop:4 }}>{t("Manage all hotel invoices","إدارة جميع فواتير الفندق")}</p>
        </div>
        <div style={css.flex(10)}>
          <button style={css.btnSecondary} onClick={onExportExcel}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            {t("Export Excel","تصدير Excel")}
          </button>
          <button style={css.btnPrimary} onClick={()=>onNav("new")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t("New Invoice","فاتورة جديدة")}
          </button>
        </div>
      </div>

      {/* Search + filters row */}
      <div style={css.flex(10,"center","flex-start")}>
        <div style={{ position:"relative",flex:1,maxWidth:360 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.gray300} strokeWidth="2"
            style={{ position:"absolute",left:10,top:"50%",transform:"translateY(-50%)" }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <Input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder={t("Search invoices...","بحث في الفواتير...")}
            style={{ ...css.input, paddingLeft:32 }} />
        </div>
        <Select value={statusF} onChange={e=>setStatusF(e.target.value)} style={{ ...css.input,maxWidth:180 }}>
          <option value="">{t("All Status","كل الحالات")}</option>
          <option value="paid">{t("Paid","مدفوع")}</option>
          <option value="unpaid">{t("Unpaid","غير مدفوع")}</option>
          <option value="credit">{t("Credit Invoice","فاتورة دائنة")}</option>
        </Select>
        <Select value={branchF} onChange={e=>setBranchF(e.target.value)} style={{ ...css.input,maxWidth:180 }}>
          <option value="">{t("All Branches","كل الفروع")}</option>
          <option value="makkah">{t("Makkah","مكة المكرمة")}</option>
          <option value="madinah">{t("Madinah","المدينة المنورة")}</option>
        </Select>
        <span style={{ fontSize:".78rem",color:T.gray500,whiteSpace:"nowrap" }}>{filtered.length} {t("results","نتيجة")}</span>
      </div>

      {/* Date range bar */}
      <div style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
        background:T.bluePale,border:`1px solid ${T.blueLight}`,borderRadius:10 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.blue} strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <span style={{ fontSize:".75rem",fontWeight:600,color:T.blue,whiteSpace:"nowrap" }}>{t("Date Range","نطاق التاريخ")}</span>
        <div style={{ display:"flex",alignItems:"center",gap:8,flex:1 }}>
          <Input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
            style={{ ...css.input,fontSize:".78rem",maxWidth:160,padding:".35rem .65rem" }} />
          <span style={{ fontSize:".75rem",color:T.gray400 }}>→</span>
          <Input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
            style={{ ...css.input,fontSize:".78rem",maxWidth:160,padding:".35rem .65rem" }} />
        </div>
        {(dateFrom||dateTo) && (
          <button onClick={()=>{setDateFrom("");setDateTo("");}}
            style={{ ...css.btnSecondary,fontSize:".72rem",padding:".3rem .75rem",color:T.danger,borderColor:T.danger }}>
            ✕ {t("Clear","مسح")}
          </button>
        )}
        {(dateFrom||dateTo) && (
          <span style={{ fontSize:".72rem",color:T.blue,fontWeight:600,whiteSpace:"nowrap" }}>
            {filtered.length} {t("in range","في النطاق")}
          </span>
        )}
      </div>

      <div style={css.card}>
        <InvoiceTable invoices={filtered} onToggleStatus={onToggleStatus}
          onDelete={onDelete} onEdit={onEdit} onPreview={onPreview}
          onReceiptVoucher={inv=>setReceiptFor(inv)}
          onCreditInv={inv=>setCreditFor(inv)}
          user={user} lang={lang} />
      </div>

      {receiptFor && (
        <ReceiptVoucherModal
          inv={receiptFor}
          settings={settings}
          clients={clients}
          onSave={(updated, receiptRecord)=>{
            onSaveInvoice(updated);
            if(receiptRecord) onSaveInvoice(receiptRecord);
            setReceiptFor(null);
          }}
          onClose={()=>setReceiptFor(null)}
        />
      )}

      {creditFor && (
        <CreditInvoiceModal
          originalInv={creditFor}
          settings={settings}
          clients={clients}
          onSave={inv=>{ onSaveInvoice(inv); setCreditFor(null); }}
          onClose={()=>setCreditFor(null)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INVOICE FORM PAGE
═══════════════════════════════════════════════════════════ */
function InvoiceFormPage({ editData, clients, settings, invoices, onSave, onSaveClient, onCancel, lang, user }) {
  const isAdmin = user?.role === "admin";
  const canCredit = isAdmin || !!(user?.permissions?.issueCreditInv);
  const t=(en,ar)=>lang==="ar"?ar:en;

  // Collect unique recent descriptions (EN + AR pairs) from past invoices (most recent first)
  const recentDescs = useMemo(()=>{
    if (!invoices?.length) return [];
    const seen = new Set();
    const results = [];
    [...invoices].sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""))
      .forEach(inv=>(inv.items||[]).forEach(it=>{
        const en = (it.descEn||"").trim();
        const ar = (it.descAr||"").trim();
        if (en && !seen.has(en)) { seen.add(en); results.push({ en, ar }); }
      }));
    return results.slice(0, 30);
  }, [invoices]);
  const [savedInvoice, setSavedInvoice] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [creditFor,   setCreditFor]   = useState(null);
  const [numFormat, setNumFormat] = useState("branch-year-seq");
  const [customPrefix, setCustomPrefix] = useState("AQ");
  const [showFormatPicker, setShowFormatPicker] = useState(false);
  const [showMoveModal, setShowMoveModal]   = useState(false);
  const [moveTarget, setMoveTarget]         = useState(""); // client id or "new"
  const [moveNewName, setMoveNewName]       = useState("");
  const [recentDescOpen,   setRecentDescOpen]   = useState(null); // EN dropdown
  const [recentDescArOpen, setRecentDescArOpen] = useState(null); // AR dropdown
  const [form, setForm] = useState({
    number: editData?.number || "",
    issueDate: editData?.issueDate || today(),
    branch: editData?.branch || (() => {
      try {
        if (settings?.defaultBranch) return settings.defaultBranch;
        const bs = JSON.parse(settings?.branches||"null");
        return bs?.[0]?.id || "makkah";
      } catch { return "makkah"; }
    })(),
    status: editData?.status || "unpaid",
    clientSelect: editData?.linkedClientId || "",
    clientNameEn: editData?.clientNameEn || "",
    clientNameAr: editData?.clientNameAr || "",
    clientVat: editData?.clientVat || "",
    clientAddress: editData?.clientAddress || "",
    clientContact: editData?.clientContact || "",
    clientEmail: editData?.clientEmail || "",
    clientPhone: editData?.clientPhone || "",
    notes: editData?.notes || `Thank you for choosing ${settings?.companyEn||"our hotel"}.`,
    remark: editData?.remark || "",
    amountPaid: editData?.amountPaid || 0,
    creditAmount: editData?.creditAmount || 0,
    creditNote: editData?.creditNote || "",
    items: editData?.items || [
      { id:uid(),descEn:"",descAr:"",qty:1,unitPrice:0,vatPct:15 },
      { id:uid(),descEn:"",descAr:"",qty:1,unitPrice:0,vatPct:15 },
    ],
  });

  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const fillClient = id => {
    if (!id) return;
    const c = clients.find(c=>c.id===id);
    if (!c) return;
    setForm(f=>({...f,clientSelect:id,clientNameEn:c.nameEn||"",clientNameAr:c.nameAr||"",clientVat:c.vat||"",clientAddress:c.address||"",clientContact:c.email||c.phone||"",clientEmail:c.email||"",clientPhone:c.phone||""}));
  };

  const setItem = (idx,k,v) => setF("items",form.items.map((it,i)=>i===idx?{...it,[k]:v}:it));
  const addItem = () => setF("items",[...form.items,{id:uid(),descEn:"",descAr:"",qty:1,unitPrice:0,vatPct:15}]);
  const delItem = idx => setF("items",form.items.filter((_,i)=>i!==idx));

  const totals = form.items.reduce((acc,it)=>{
    const base = (it.qty||0)*(it.unitPrice||0);
    const vat  = base*(it.vatPct||15)/100;
    return { sub:acc.sub+base, vat:acc.vat+vat };
  },{ sub:0,vat:0 });

  const [submitting, setSubmitting] = useState(false);

  // ── Auto-generate invoice number from real data ──────────────────────────
  useEffect(()=>{
    if (editData?.number) return; // keep existing number when editing
    // Read the stored high-water mark so deleted invoice numbers are never reused
    DB.getSetting("invSeqHWM").then(hwm => {
      const seq = nextSeqFor(invoices, numFormat, form.branch, customPrefix, +(hwm||0), form.issueDate);
      const candidate = buildInvNumber(numFormat, form.branch, seq, customPrefix, form.issueDate);
      setF("number", candidate);
    });
  // Use `invoices` (not `invoices?.length`) so the effect re-runs when any
  // invoice is added or removed — not just when the count changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[form.branch, form.issueDate, numFormat, customPrefix, invoices]);

  const submit = () => {
    if (submitting) return;
    if (!form.clientNameEn.trim()) { alert("Please select or enter a client name."); return; }
    if (!form.number.trim())       { alert("Invoice number is required."); return; }

    // ── Uniqueness check: block if another invoice already has this number ──
    const duplicate = (invoices||[]).find(i=>
      i.number === form.number && i.id !== (editData?.id || "__new__")
    );
    if (duplicate) {
      alert(`Invoice number "${form.number}" already exists (${duplicate.issueDate}).\nPlease change the number before saving.`);
      return;
    }

    setSubmitting(true);
    const items = form.items.map(it=>({
      ...it,
      lineTotal: +((it.qty||0)*(it.unitPrice||0)*(1+(it.vatPct||15)/100)).toFixed(2)
    }));
    // Strip clientSelect from the persisted record — only linkedClientId is the
    // canonical client link. Keeping clientSelect alive causes invBelongsToClient
    // priority-2 to match the wrong client when the two fields drift apart.
    const { clientSelect: _dropdownId, ...formRest } = form;
    // Resolve client ID: dropdown selection first, then existing editData link,
    // then fallback to VAT match, then name match.  This ensures invoices typed
    // manually (without choosing from dropdown) still get a hard client ID link
    // instead of falling through to fragile name/VAT matching in the ledger.
    const resolvedClientId =
      form.clientSelect ||
      editData?.linkedClientId ||
      (clients?.find(c =>
        form.clientNameEn?.trim() && c.nameEn?.trim() &&
        form.clientNameEn.trim().toLowerCase() === c.nameEn.trim().toLowerCase() &&
        (!form.clientAddress?.trim() || !c.address?.trim() ||
          form.clientAddress.trim().toLowerCase() === c.address.trim().toLowerCase())
      )?.id) || "";
    const built = { ...editData, ...formRest, items,
      linkedClientId: resolvedClientId,
      clientSelect: "",   // explicitly blank so legacy priority-2 never fires
      subtotal:+totals.sub.toFixed(2),
      vatTotal:+totals.vat.toFixed(2),
      creditAmount:+(form.creditAmount||0),
      creditNote: form.creditNote||"",
      grandTotal:+(totals.sub+totals.vat-(+form.creditAmount||0)).toFixed(2),
      amountPaid:+(form.amountPaid||0),
    };
    setSavedInvoice(built);
    // Pre-fill "move to client" modal — prefer exact ID match, then VAT, then name.
    // This is only a UI pre-selection hint; the actual link is set by doMoveToClient.
    const match = clients.find(c=>
      (built.linkedClientId && built.linkedClientId === c.id) ||
      (built.clientNameEn?.trim() && c.nameEn?.trim() &&
        built.clientNameEn.trim().toLowerCase() === c.nameEn.trim().toLowerCase() &&
        (!built.clientAddress?.trim() || !c.address?.trim() ||
          built.clientAddress.trim().toLowerCase() === c.address.trim().toLowerCase()))
    );
    if (match) setMoveTarget(match.id);
    else { setMoveTarget("new"); setMoveNewName(built.clientNameEn); }
    onSave(built);
    setTimeout(()=>setSubmitting(false), 2000); // release lock after 2s
  };

  const doMoveToClient = () => {
    if (!savedInvoice || !onSaveClient) return;
    let client;
    if (moveTarget==="new") {
      client = {
        id: uid(),
        nameEn: moveNewName || savedInvoice.clientNameEn,
        nameAr: savedInvoice.clientNameAr||"",
        vat:    savedInvoice.clientVat||"",
        email:  savedInvoice.clientEmail||savedInvoice.clientContact||"",
        phone:  savedInvoice.clientPhone||"",
        address:"",
        accessKey: genKey(),
      };
    } else {
      client = clients.find(c=>c.id===moveTarget);
    }
    if (!client) return;
    onSaveClient(client);
    // Update the invoice: set linkedClientId and blank out legacy clientSelect
    // so invBelongsToClient never matches via the stale priority-2 path.
    onSave({...savedInvoice, linkedClientId: client.id, clientSelect: "", clientNameEn: client.nameEn});
    setShowMoveModal(false);
  };

  return (
    <div className="fade-up" style={css.col(20)}>
      <div style={css.flex(0,"center","space-between")}>
        <div>
          <h1 style={css.h1}>{editData ? t("Edit Invoice","تعديل الفاتورة") : t("New Invoice","فاتورة جديدة")}</h1>
        </div>
        <div style={css.flex(10)}>
          <button style={css.btnSecondary} onClick={onCancel}>{t("Cancel","إلغاء")}</button>
          {savedInvoice && (
            <button style={{ ...css.btnSecondary, borderColor:T.blue, color:T.blue }} onClick={()=>setShowPreview(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              {t("Print Invoice","طباعة الفاتورة")}
            </button>
          )}
          {savedInvoice && canCredit && (
            <button style={{ ...css.btnSecondary, borderColor:T.danger, color:T.danger }} onClick={()=>setCreditFor(savedInvoice)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              {t("Issue Credit Note","إصدار إشعار دائن")}
            </button>
          )}
          <button style={{ ...css.btnPrimary, opacity:submitting?0.7:1, cursor:submitting?"not-allowed":"pointer" }}
            onClick={submit} disabled={submitting}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            {submitting ? t("Saving…","جاري الحفظ…") : t("Save Invoice","حفظ الفاتورة")}
          </button>
        </div>
      </div>

      {savedInvoice && (
        <div style={{ background:"#E8F5EF", border:"1px solid #A8DBC0", borderRadius:8, padding:".9rem 1.25rem",
          display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={css.flex(10)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.success} strokeWidth="2.5">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span style={{ fontSize:".875rem", fontWeight:600, color:"#1E7A4A" }}>
              {t("Invoice saved successfully","تم حفظ الفاتورة بنجاح")} — {savedInvoice.number}
            </span>
          </div>
          <div style={css.flex(8)}>
            <button style={{ ...css.btnSecondary,borderColor:"#1E7A4A",color:"#1E7A4A",fontSize:".78rem" }} onClick={()=>setShowMoveModal(true)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
              {t("Move to Client","ربط بعميل")}
            </button>
            <button style={{ ...css.btnPrimary, background:T.success }} onClick={()=>setShowPreview(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              {t("Print / Preview","طباعة / معاينة")}
            </button>
          </div>
        </div>
      )}

      {/* Move to Client Modal */}
      {showMoveModal && savedInvoice && (
        <Modal open title={t("Move Invoice to Client","ربط الفاتورة بعميل")} onClose={()=>setShowMoveModal(false)}
          footer={<>
            <button style={css.btnSecondary} onClick={()=>setShowMoveModal(false)}>Cancel</button>
            <button style={css.btnPrimary} onClick={doMoveToClient}
              disabled={moveTarget==="new"?!moveNewName.trim():!moveTarget}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              {moveTarget==="new" ? t("Create & Link Client","إنشاء وربط العميل") : t("Link to Client","ربط بالعميل")}
            </button>
          </>}>
          <div style={css.col(16)}>
            {/* Invoice info strip */}
            <div style={{ background:T.bluePale,border:`1px solid ${T.blueLight}`,borderRadius:8,padding:"10px 14px",fontSize:".82rem",color:T.blueDark }}>
              <strong>{savedInvoice.number}</strong> · {savedInvoice.clientNameEn} · SAR {fmt(savedInvoice.grandTotal)}
            </div>

            {/* Choose existing or new */}
            <div>
              <div style={{ ...css.label,marginBottom:10 }}>Select Client</div>
              <div style={css.col(8)}>
                {/* New client option */}
                <label style={{ display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:8,cursor:"pointer",
                  border:`1px solid ${moveTarget==="new"?T.blue:T.gray100}`,
                  background:moveTarget==="new"?T.bluePale:"white",transition:"all .12s" }}>
                  <input type="radio" checked={moveTarget==="new"} onChange={()=>setMoveTarget("new")}
                    style={{ accentColor:T.blue,width:14,height:14,flexShrink:0 }} />
                  <div>
                    <div style={{ fontSize:".82rem",fontWeight:600,color:T.ink }}>➕ Create New Client</div>
                    <div style={{ fontSize:".72rem",color:T.gray500 }}>Register as a new client in the system</div>
                  </div>
                </label>

                {/* Existing clients */}
                {clients.length>0 && (
                  <div style={{ borderTop:`1px solid ${T.gray100}`,paddingTop:8 }}>
                    <div style={{ fontSize:".7rem",fontWeight:700,color:T.gray500,textTransform:"uppercase",letterSpacing:".1em",marginBottom:8 }}>Or link to existing client</div>
                    <div style={{ maxHeight:200,overflowY:"auto",display:"flex",flexDirection:"column",gap:6 }}>
                      {clients.map(c=>(
                        <label key={c.id} style={{ display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:8,cursor:"pointer",
                          border:`1px solid ${moveTarget===c.id?T.blue:T.gray100}`,
                          background:moveTarget===c.id?T.bluePale:"white",transition:"all .12s" }}>
                          <input type="radio" checked={moveTarget===c.id} onChange={()=>setMoveTarget(c.id)}
                            style={{ accentColor:T.blue,width:14,height:14,flexShrink:0 }} />
                          <div style={{ flex:1,minWidth:0 }}>
                            <div style={{ fontSize:".82rem",fontWeight:600,color:T.ink,display:"flex",alignItems:"center",gap:6 }}>
                              <span style={{ width:24,height:24,borderRadius:6,background:T.blue,color:"white",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:".75rem",fontWeight:700,flexShrink:0 }}>
                                {(c.nameEn||"?")[0]}
                              </span>
                              {c.nameEn}
                            </div>
                            {c.vat && <div style={{ fontSize:".68rem",color:T.gray400,marginTop:1 }}>VAT: {c.vat}</div>}
                          </div>
                          {c.accessKey && <span style={{ fontSize:".6rem",padding:"2px 6px",borderRadius:6,background:"#E8F5EF",color:T.success,border:"1px solid #A8DBC0",whiteSpace:"nowrap" }}>Has Key</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* New client name input */}
            {moveTarget==="new" && (
              <div style={{ background:T.gray50,borderRadius:8,padding:"12px 14px",border:`1px solid ${T.gray100}` }}>
                <div style={{ ...css.label,marginBottom:8 }}>New Client Details</div>
                <div style={css.col(10)}>
                  <FormGroup label="Client Name (EN)">
                    <Input value={moveNewName} onChange={e=>setMoveNewName(e.target.value)}
                      placeholder={savedInvoice.clientNameEn||"Client name"} />
                  </FormGroup>
                  <div style={{ fontSize:".72rem",color:T.gray400 }}>
                    VAT, phone, and email will be copied from the invoice. A unique access key will be generated automatically.
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {showPreview && savedInvoice && (
        <InvoicePreview inv={savedInvoice} settings={settings} onClose={()=>setShowPreview(false)} />
      )}

      {creditFor && (
        <CreditInvoiceModal
          originalInv={creditFor}
          settings={settings}
          clients={clients}
          onSave={inv=>{ onSave(inv); setCreditFor(null); }}
          onClose={()=>setCreditFor(null)}
        />
      )}

      <div style={css.card}>
        <SectionHead en="Invoice Details" ar="تفاصيل الفاتورة" />
        <div style={css.grid("repeat(3,1fr)",14)}>
          <FormGroup label={t("Invoice Number","رقم الفاتورة")}>
            {(() => {
              const isDup = !!(invoices||[]).find(i=>i.number===form.number && i.id!==(editData?.id||"__new__"));
              return (<>
                <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                  <Input value={form.number} readOnly style={{ ...css.input,opacity:.7,fontWeight:700,letterSpacing:1,flex:1,
                    borderColor:isDup?T.danger:undefined,boxShadow:isDup?`0 0 0 2px ${T.danger}22`:undefined }} />
                  <button type="button" onClick={()=>setShowFormatPicker(v=>!v)}
                    style={{ ...css.btnSecondary, whiteSpace:"nowrap", flexShrink:0, fontSize:".72rem", padding:".45rem .85rem" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    Format
                  </button>
                </div>
                {isDup && (
                  <div style={{ fontSize:".68rem",color:T.danger,fontWeight:600,marginTop:4,display:"flex",alignItems:"center",gap:4 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    Duplicate number — this invoice number already exists
                  </div>
                )}
              </>);
            })()}
            {showFormatPicker && (
              <div style={{ marginTop:8,background:T.white,border:`1px solid ${T.gray200}`,
                borderRadius:8,padding:"12px 14px",boxShadow:"0 4px 16px rgba(0,0,0,0.1)" }}>
                <div style={{ fontSize:".67rem",fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",
                  color:T.gray500,marginBottom:10 }}>Select Format</div>
                <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                  {INV_FORMATS.map(f=>(
                    <label key={f.id} style={{ display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                      padding:"7px 10px",borderRadius:6,
                      background:numFormat===f.id?T.bluePale:"transparent",
                      border:`1px solid ${numFormat===f.id?T.blueLight:T.gray100}`,
                      transition:"all .12s" }}>
                      <input type="radio" name="invfmt" value={f.id}
                        checked={numFormat===f.id}
                        onChange={()=>setNumFormat(f.id)}
                        style={{ accentColor:T.blue }} />
                      <div>
                        <div style={{ fontSize:".8rem",fontWeight:600,color:T.ink }}>{f.label}</div>
                        <div style={{ fontSize:".7rem",color:T.gray500 }}>e.g. {f.id==="prefix-seq"
                          ? `${(customPrefix||"AQ").toUpperCase()}-0001`
                          : f.example}</div>
                      </div>
                    </label>
                  ))}
                </div>
                {numFormat==="prefix-seq" && (
                  <div style={{ marginTop:10 }}>
                    <label style={css.label}>Custom Prefix</label>
                    <Input value={customPrefix} onChange={e=>setCustomPrefix(e.target.value.slice(0,6))}
                      placeholder="AQ" maxLength={6}
                      style={{ ...css.input,marginTop:5,textTransform:"uppercase",fontWeight:700,letterSpacing:2,width:120 }} />
                  </div>
                )}
                <button type="button" onClick={()=>setShowFormatPicker(false)}
                  style={{ ...css.btnPrimary,marginTop:12,fontSize:".72rem",padding:".4rem .9rem" }}>
                  Apply
                </button>
              </div>
            )}
          </FormGroup>
          <FormGroup label={t("Issue Date","تاريخ الإصدار")}>
            <Input type="date" value={form.issueDate} onChange={e=>setF("issueDate",e.target.value)} />
          </FormGroup>
          <FormGroup label={t("Branch","الفرع")}>
            {(() => {
              let branches = [];
              try { branches = JSON.parse(settings?.branches||"null") || []; } catch {}
              if (!branches.length) branches = [
                { id:"makkah",  nameEn:"Makkah",  nameAr:"مكة المكرمة" },
                { id:"madinah", nameEn:"Madinah", nameAr:"المدينة المنورة" },
              ];
              return (
                <div>
                  <Select value={form.branch} onChange={e=>setF("branch",e.target.value)}>
                    {branches.map(br=>(
                      <option key={br.id} value={br.id}>{br.nameEn}{br.nameAr?` / ${br.nameAr}`:""}</option>
                    ))}
                  </Select>
                  <div style={{ marginTop:5,fontSize:".68rem",color:T.gray400 }}>
                    Manage branches in{" "}
                    <span style={{ color:T.blue,cursor:"pointer",textDecoration:"underline" }}
                      onClick={()=>{ /* navigate to settings handled by onCancel flow */ window.dispatchEvent(new CustomEvent("nav-settings-branches")); }}>
                      Settings → Branches
                    </span>
                  </div>
                </div>
              );
            })()}
          </FormGroup>
          <FormGroup label={t("Status","الحالة")}>
            <Select value={form.status} onChange={e=>setF("status",e.target.value)}>
              <option value="unpaid">{t("Unpaid","غير مدفوع")}</option>
              <option value="paid">{t("Paid","مدفوع")}</option>
            </Select>
          </FormGroup>
          <FormGroup label={t("Remark","ملاحظة للعميل")}>
            <Input value={form.remark} onChange={e=>setF("remark",e.target.value)}
              placeholder={t("e.g. Payment due in 30 days…","مثال: يُرجى السداد خلال ٣٠ يوماً…")}
              maxLength={200}
              style={{ ...css.input, fontSize:".82rem" }} />
          </FormGroup>
        </div>
      </div>

      {/* Client */}
      <div style={css.card}>
        <SectionHead en="Client Information" ar="معلومات العميل" />
        <div style={{ marginBottom:14 }}>
          <FormGroup label={t("Select Existing Client","اختر عميلاً محفوظاً")}>
            <Select value={form.clientSelect} onChange={e=>fillClient(e.target.value)}>
              <option value="">— {t("New / Manual Entry","إدخال يدوي")} —</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.nameEn}{c.nameAr?` / ${c.nameAr}`:""}</option>)}
            </Select>
          </FormGroup>
        </div>
        <div style={css.grid("1fr 1fr",14)}>
          <FormGroup label={t("Client Name (EN)","الاسم بالإنجليزية")}>
            <Input value={form.clientNameEn} onChange={e=>setF("clientNameEn",e.target.value)} placeholder="Client name" />
          </FormGroup>
          <FormGroup label={t("Client Name (AR)","الاسم بالعربية")}>
            <Input value={form.clientNameAr} onChange={e=>setF("clientNameAr",e.target.value)} dir="rtl" style={{...css.input,fontFamily:"'Noto Naskh Arabic',serif"}} placeholder="اسم العميل" />
          </FormGroup>
          <FormGroup label={t("VAT Number","الرقم الضريبي")}>
            <Input value={form.clientVat} onChange={e=>setF("clientVat",e.target.value)} placeholder="3XXXXXXXXXXXXXXXXXXX" />
          </FormGroup>
          <FormGroup label={t("Client Address","عنوان العميل")}>
            <Input value={form.clientAddress} onChange={e=>setF("clientAddress",e.target.value)} placeholder={t("City, Region, Postal Code","المدينة، المنطقة، الرمز البريدي")} />
          </FormGroup>
          <FormGroup label={t("Email","البريد الإلكتروني")}>
            <Input type="email" value={form.clientEmail} onChange={e=>setF("clientEmail",e.target.value)} placeholder="email@domain.com" />
          </FormGroup>
          <FormGroup label={t("Phone","الهاتف")}>
            <Input value={form.clientPhone} onChange={e=>setF("clientPhone",e.target.value)} placeholder="+966..." />
          </FormGroup>
        </div>
      </div>

      {/* Items */}
      <div style={css.card}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
          <SectionHead en="Line Items" ar="بنود الفاتورة" />
          <button style={css.btnSecondary} onClick={addItem}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            {t("Add Item","إضافة بند")}
          </button>
        </div>

        {/* Items header */}
        <div style={{ display:"grid",gridTemplateColumns:"3fr 1fr 1.2fr 1fr 1.2fr 36px",gap:8,
          padding:".4rem .5rem",marginBottom:4 }}>
          {[t("Description","الوصف"),t("Qty","الكمية"),t("Unit Price","سعر الوحدة"),t("VAT %","ضريبة %"),t("Total","المجموع"),""].map((h,i)=>(
            <div key={i} style={{ fontSize:".65rem",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:T.gray500 }}>{h}</div>
          ))}
        </div>

        <div style={css.col(8)}>
          {form.items.map((item,idx) => {
            const base  = (item.qty||0)*(item.unitPrice||0);
            const total = base*(1+(item.vatPct||15)/100);
            return (
              <div key={item.id} style={{ display:"grid",gridTemplateColumns:"3fr 1fr 1.2fr 1fr 1.2fr 36px",gap:8,
                padding:".4rem .5rem",background:idx%2===0?T.gray50:"transparent",borderRadius:6 }}>
                <div style={{ position:"relative" }}>
                  <div style={css.col(4)}>
                    {/* EN field + recent dropdown */}
                    <div style={{ position:"relative" }}>
                      <Input value={item.descEn} onChange={e=>setItem(idx,"descEn",e.target.value)}
                        onFocus={()=>{ setRecentDescOpen(idx); setRecentDescArOpen(null); }}
                        onBlur={()=>setTimeout(()=>setRecentDescOpen(null),180)}
                        placeholder={t("Description (EN)","الوصف بالإنجليزية")}
                        style={{...css.input,fontSize:".8rem",padding:".4rem .6rem"}} />
                      {recentDescOpen===idx && recentDescs.length>0 && (
                        <div style={{ position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:200,
                          background:"white",border:`1px solid ${T.gray200}`,borderRadius:8,
                          boxShadow:"0 8px 24px rgba(0,0,0,.12)",maxHeight:200,overflowY:"auto" }}>
                          <div style={{ padding:"6px 10px",fontSize:".6rem",fontWeight:700,letterSpacing:".1em",
                            textTransform:"uppercase",color:T.gray400,borderBottom:`1px solid ${T.gray100}`,
                            position:"sticky",top:0,background:"white" }}>🕐 Recent — EN</div>
                          {recentDescs
                            .filter(d=>!item.descEn || d.en.toLowerCase().includes(item.descEn.toLowerCase()))
                            .map((d,di)=>(
                            <button key={di} onMouseDown={()=>{
                                setItem(idx,"descEn",d.en);
                                if(d.ar) setItem(idx,"descAr",d.ar);
                                setRecentDescOpen(null);
                              }}
                              style={{ display:"block",width:"100%",textAlign:"left",padding:"7px 12px",
                                fontSize:".78rem",color:T.ink,background:"none",border:"none",cursor:"pointer",
                                borderBottom:di<recentDescs.length-1?`1px solid ${T.gray50}`:"none",
                                transition:"background .1s" }}
                              onMouseEnter={e=>e.currentTarget.style.background=T.bluePale}
                              onMouseLeave={e=>e.currentTarget.style.background="none"}>
                              <div style={{fontWeight:500}}>{d.en}</div>
                              {d.ar && <div style={{fontFamily:"'Noto Naskh Arabic',serif",fontSize:".7rem",color:T.gray400,direction:"rtl",marginTop:1}}>{d.ar}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* AR field + recent dropdown */}
                    <div style={{ position:"relative" }}>
                      <Input value={item.descAr} onChange={e=>setItem(idx,"descAr",e.target.value)}
                        onFocus={()=>{ setRecentDescArOpen(idx); setRecentDescOpen(null); }}
                        onBlur={()=>setTimeout(()=>setRecentDescArOpen(null),180)}
                        placeholder="الوصف بالعربي" dir="rtl"
                        style={{...css.input,fontSize:".8rem",padding:".4rem .6rem",fontFamily:"'Noto Naskh Arabic',serif"}} />
                      {recentDescArOpen===idx && recentDescs.filter(d=>d.ar).length>0 && (
                        <div style={{ position:"absolute",top:"calc(100% + 4px)",left:0,right:0,zIndex:200,
                          background:"white",border:`1px solid ${T.gray200}`,borderRadius:8,
                          boxShadow:"0 8px 24px rgba(0,0,0,.12)",maxHeight:200,overflowY:"auto" }}>
                          <div style={{ padding:"6px 10px",fontSize:".6rem",fontWeight:700,letterSpacing:".1em",
                            textTransform:"uppercase",color:T.gray400,borderBottom:`1px solid ${T.gray100}`,
                            position:"sticky",top:0,background:"white",direction:"rtl",
                            fontFamily:"'Noto Naskh Arabic',serif" }}>🕐 الأوصاف الأخيرة</div>
                          {recentDescs
                            .filter(d=>d.ar && (!item.descAr || d.ar.includes(item.descAr)))
                            .map((d,di,arr)=>(
                            <button key={di} onMouseDown={()=>{
                                setItem(idx,"descAr",d.ar);
                                if(d.en) setItem(idx,"descEn",d.en);
                                setRecentDescArOpen(null);
                              }}
                              style={{ display:"block",width:"100%",textAlign:"right",padding:"7px 12px",
                                fontSize:".78rem",color:T.ink,background:"none",border:"none",cursor:"pointer",
                                borderBottom:di<arr.length-1?`1px solid ${T.gray50}`:"none",
                                transition:"background .1s",direction:"rtl" }}
                              onMouseEnter={e=>e.currentTarget.style.background=T.bluePale}
                              onMouseLeave={e=>e.currentTarget.style.background="none"}>
                              <div style={{fontFamily:"'Noto Naskh Arabic',serif",fontWeight:500}}>{d.ar}</div>
                              {d.en && <div style={{fontSize:".7rem",color:T.gray400,direction:"ltr",textAlign:"left",marginTop:1}}>{d.en}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <Input type="number" min="1" value={item.qty} onChange={e=>setItem(idx,"qty",+e.target.value)} style={{...css.input,textAlign:"center",padding:".4rem .4rem",fontSize:".82rem"}} />
                <Input type="number" min="0" step="0.01" value={item.unitPrice||""} onChange={e=>setItem(idx,"unitPrice",+e.target.value)} placeholder="0.00" style={{...css.input,padding:".4rem .6rem",fontSize:".82rem"}} />
                <Input type="number" min="0" max="100" value={item.vatPct} onChange={e=>setItem(idx,"vatPct",+e.target.value)} style={{...css.input,textAlign:"center",padding:".4rem .4rem",fontSize:".82rem"}} />
                <div style={{ display:"flex",alignItems:"center",fontSize:".82rem",fontWeight:700,color:T.blue }}>
                  {fmt(total)}
                </div>
                <button onClick={()=>delItem(idx)} style={{ ...css.iconBtn,color:T.danger,padding:4 }}
                  onMouseEnter={e=>e.currentTarget.style.background="#FDECEA"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals + Notes */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr auto",gap:16,alignItems:"start" }}>
        <div style={css.card}>
          <SectionHead en="Notes" ar="ملاحظات" />
          <textarea value={form.notes} onChange={e=>setF("notes",e.target.value)}
            rows={4} style={{ ...css.input,resize:"vertical",lineHeight:1.7 }} />
        </div>
        <div style={{ ...css.card,minWidth:280 }}>
          <SectionHead en="Totals" ar="الإجماليات" />
          <div style={css.col(10)}>
            {[
              [t("Subtotal","المجموع الفرعي"), fmt(totals.sub), T.gray700],
              [t("VAT (15%)","ضريبة ١٥٪"), fmt(totals.vat), T.gray700],
            ].map(([label,val,color])=>(
              <div key={label} style={{ display:"flex",justifyContent:"space-between",fontSize:".875rem",color }}>
                <span>{label}</span><span>SAR {val}</span>
              </div>
            ))}
            {/* Credit entry */}
            <div style={{ borderTop:`1px solid ${T.gray100}`,paddingTop:10 }}>
              <div style={{ ...css.label,marginBottom:6 }}>{t("Credit / Discount","خصم / ائتمان")}</div>
              <Input type="number" min="0" step="0.01" value={form.creditAmount||""} onChange={e=>setF("creditAmount",+e.target.value)}
                placeholder="0.00" style={{ ...css.input,fontSize:".82rem",marginBottom:6 }} />
              <Input value={form.creditNote} onChange={e=>setF("creditNote",e.target.value)}
                placeholder={t("Credit note / reason","سبب الخصم")} style={{ ...css.input,fontSize:".8rem" }} />
            </div>
            <div style={{ height:1,background:T.gray100 }} />
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:"1.05rem",fontWeight:700,color:T.blue }}>
              <span>{t("TOTAL DUE","الإجمالي المستحق")}</span>
              <span>SAR {fmt(totals.sub+totals.vat-(+form.creditAmount||0))}</span>
            </div>
            {/* Amount Received */}
            <div style={{ borderTop:`1px solid ${T.gray100}`,paddingTop:10,marginTop:2 }}>
              <div style={{ ...css.label,marginBottom:6,color:T.success }}>{t("Amount Received","المبلغ المستلم")}</div>
              <Input type="number" min="0" step="0.01" value={form.amountPaid||""} onChange={e=>setF("amountPaid",+e.target.value)}
                placeholder="0.00" style={{ ...css.input,fontSize:".82rem",borderColor:T.success,marginBottom:6 }} />
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:".95rem",fontWeight:700,
              color:(totals.sub+totals.vat-(+form.creditAmount||0)-(+form.amountPaid||0))<=0?T.success:T.danger }}>
              <span>{t("BALANCE DUE","الرصيد المستحق")}</span>
              <span>SAR {fmt(Math.max(0, totals.sub+totals.vat-(+form.creditAmount||0)-(+form.amountPaid||0)))}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   CREDIT INVOICE MODAL
═══════════════════════════════════════════════════════════ */
function CreditInvoiceModal({ originalInv, settings, clients, onSave, onClose, previewOnly }) {
  const company = settings||{};
  const branch  = originalInv?.branch||"makkah";
  const branchObj = (() => {
    try { const bs=JSON.parse(settings?.branches||"null")||[]; return bs.find(b=>b.id===branch)||null; } catch { return null; }
  })();
  const addr = branchObj?.address || (branch==="madinah" ? company.madinahAddress : company.makkahAddress) || "";

  // ── READ-ONLY PREVIEW of an already-saved credit invoice ─────────────────
  // When previewOnly is set we just render the saved credit for printing.
  // We must NOT show the "Issue Credit" form or any Save button — doing so
  // would let the user accidentally create a second credit against the same
  // original invoice.
  // ── READ-ONLY PREVIEW: delegate to InvoicePreview with docType="credit" ───
  if (previewOnly) {
    return (
      <InvoicePreview
        inv={previewOnly}
        settings={settings}
        allInvoices={[]}
        onClose={onClose}
        docType="credit"
      />
    );
  }
  // ── END READ-ONLY PREVIEW ─────────────────────────────────────────────────

  const [form, setForm] = useState({
    creditNumber: `CR-${originalInv?.number||""}`,
    issueDate: today(),
    reason: "",
    items: (originalInv?.items||[]).map(it=>({...it, id:uid(), creditQty: it.qty, creditUnit: it.unitPrice })),
  });
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));
  const setItem = (idx,k,v) => setF("items", form.items.map((it,i)=>i===idx?{...it,[k]:v}:it));

  const totals = form.items.reduce((acc,it)=>{
    const inclusive = (it.creditQty||0)*(it.creditUnit||0);  // amount entered = incl. VAT
    const base = +(inclusive / 1.15).toFixed(2);             // excl. VAT
    const vat  = +(inclusive - base).toFixed(2);             // VAT portion
    return {sub: acc.sub+base, vat: acc.vat+vat, grand: acc.grand+inclusive};
  },{sub:0, vat:0, grand:0});

  const [preview, setPreview] = useState(false);
  const qrRef = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  // Stable ID — uid() must NOT be called in the render body because every
  // re-render would produce a new value, causing duplicate DB records.
  const creditIdRef = useRef(uid());

  // Resolve the client ID even when the original invoice was saved without one
  // (manually typed name, or created before linkedClientId existed).
  const resolvedClientId =
    originalInv?.linkedClientId ||
    originalInv?.clientSelect ||
    (clients?.find(c =>
      c.nameEn?.trim() && originalInv?.clientNameEn?.trim() &&
      c.nameEn.trim().toLowerCase() === originalInv.clientNameEn.trim().toLowerCase() &&
      (!originalInv?.clientAddress?.trim() || !c.address?.trim() ||
        originalInv.clientAddress.trim().toLowerCase() === c.address.trim().toLowerCase())
    )?.id) || "";

  // Resolve client address from original invoice or from clients list
  const resolvedClient = clients?.find(c => c.id === resolvedClientId);

  const creditInv = {
    id: creditIdRef.current,
    type: "credit",
    originalInvId: originalInv?.id,
    originalInvNumber: originalInv?.number,
    number: form.creditNumber,
    issueDate: form.issueDate,
    branch: originalInv?.branch,
    status: "paid",
    // Resolved client ID — never empty when original invoice has a matching client
    linkedClientId: resolvedClientId,
    clientNameEn:  originalInv?.clientNameEn,
    clientNameAr:  originalInv?.clientNameAr,
    clientVat:     originalInv?.clientVat,
    clientAddress: originalInv?.clientAddress || resolvedClient?.address || "",
    clientEmail:   originalInv?.clientEmail   || resolvedClient?.email   || "",
    clientPhone:   originalInv?.clientPhone   || resolvedClient?.phone   || "",
    reason: form.reason,
    items: form.items.map(it=>({
      ...it,
      qty: it.creditQty,
      unitPrice: +(it.creditUnit / 1.15).toFixed(2),        // excl-VAT — matches regular invoice format
      lineTotal: +((it.creditQty||0)*(it.creditUnit||0)).toFixed(2), // incl-VAT total
    })),
    subtotal: +totals.sub.toFixed(2),
    vatTotal: +totals.vat.toFixed(2),
    grandTotal: +totals.grand.toFixed(2),
    notes: form.reason,
  };

  const zatcaStr = buildZatcaQR({
    sellerName: company.companyEn||company.companyAr||"",
    vatNumber:  company.vatNumber||"",
    timestamp:  form.issueDate+"T00:00:00Z",
    total:      creditInv.grandTotal.toFixed(2),
    vatTotal:   creditInv.vatTotal.toFixed(2),
  });

  useEffect(()=>{
    if (!preview) return;
    const renderQR = () => {
      if (!qrRef.current) return;
      qrRef.current.innerHTML = "";
      new window.QRCode(qrRef.current, { text:zatcaStr, width:100, height:100, correctLevel:window.QRCode?.CorrectLevel?.M });
      setTimeout(()=>{ const c=qrRef.current?.querySelector("canvas"); if(c) setQrDataUrl(c.toDataURL("image/png")); },200);
    };
    if (!window.QRCode) {
      const s=document.createElement("script");
      s.src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload=renderQR; document.head.appendChild(s);
    } else { renderQR(); }
  },[preview, zatcaStr]);

  const printCredit = () => {
    const content = document.getElementById("credit-print-area").innerHTML;
    const w = window.open("","_blank");
    w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
    <title>Credit Invoice ${creditInv.number}</title>
    <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
    <style>*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}html,body{width:210mm;background:white;font-family:'DM Sans',sans-serif;color:#000;font-size:12pt}@page{size:A4 portrait;margin:12mm}table{border-collapse:collapse;width:100%}img{max-width:100%;display:block}</style>
    </head><body>${content}<script>setTimeout(()=>{window.print();window.close();},600);<\/script></body></html>`);
    w.document.close();
  };

  if (preview) return (
    <Modal open title={`Credit Entry — ${creditInv.number}`} onClose={()=>setPreview(false)} wide
      footer={<>
        <button style={css.btnSecondary} onClick={()=>setPreview(false)}>Back</button>
        <button style={{ ...css.btnPrimary,background:T.danger }} onClick={()=>{ onSave({...creditInv,subtotal:totals.sub,vatTotal:totals.vat,grandTotal:totals.grand}); onClose(); }}>
          Save Credit Entry
        </button>
        <button style={{ ...css.btnPrimary,background:"#8B3030" }} onClick={printCredit}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Save & Print
        </button>
      </>}>

      <div id="credit-print-area" style={{ background:"white",color:"#000",padding:"28px 36px",fontFamily:"'DM Sans',sans-serif",border:"1px solid #E4E6EA",borderRadius:6,width:"100%",maxWidth:794,margin:"0 auto" }}>

        {/* Title bar — mirrors receipt voucher exactly, red scheme */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,paddingBottom:16,borderBottom:"2px solid #D94040" }}>
          <div>
            <div style={{ fontSize:24,fontFamily:"'DM Serif Display',serif",color:"#D94040",fontWeight:700,letterSpacing:1 }}>CREDIT ENTRY</div>
            <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:15,color:"#555",marginTop:3 }}>إشعار دائن</div>
          </div>
          <div style={{ display:"flex",alignItems:"flex-start",gap:16 }}>
            <div style={{ textAlign:"right",fontSize:13,color:"#111",lineHeight:2 }}>
              <div><span style={{color:"#555"}}>Credit No.: </span><strong>{creditInv.number}</strong></div>
              <div style={{lineHeight:1.2}}><span style={{color:"#555"}}>Date: </span><DateBoth dateStr={creditInv.issueDate} enSize={13} arSize={11} /></div>
              <div><span style={{color:"#555"}}>Ref. Invoice: </span><strong>{originalInv?.number}</strong></div>
              <div><span style={{color:"#555"}}>Branch: </span>{branchObj?.nameEn||branch}</div>
            </div>
            {/* ZATCA QR code */}
            <div style={{ textAlign:"center",flexShrink:0 }}>
              <div ref={qrRef} style={{ display:"none" }} />
              {qrDataUrl
                ? <img src={qrDataUrl} alt="ZATCA QR" width={90} height={90} style={{ border:"1px solid #F5C0C0",padding:2,borderRadius:4 }}/>
                : <div style={{ width:90,height:90,border:"1px solid #F5C0C0",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#F5C0C0" }}>QR…</div>}
              <div style={{ fontSize:7,color:"#aaa",marginTop:2,letterSpacing:.5 }}>ZATCA QR</div>
            </div>
          </div>
        </div>

        {/* Issued to — mirrors "Received from" strip */}
        <div style={{ background:"#FFF0F0",border:"1px solid #F5C0C0",borderRadius:6,padding:"14px 18px",marginBottom:20,fontSize:14 }}>
          <span style={{color:"#555"}}>Issued to / صادر إلى: </span>
          <strong>{creditInv.clientNameEn}</strong>
          {creditInv.clientNameAr && <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,marginRight:6,direction:"rtl" }}> / {creditInv.clientNameAr}</span>}
          {creditInv.clientVat && <span style={{ fontSize:12,color:"#555",marginLeft:12 }}>VAT: {creditInv.clientVat}</span>}
          {creditInv.clientAddress && <div style={{ fontSize:12,color:"#555",marginTop:4 }}>{creditInv.clientAddress}</div>}
        </div>

        {/* Reason strip — shown only if filled */}
        {form.reason && (
          <div style={{ background:"#FFF8F0",border:"1px solid #F5D9A0",borderLeft:"3px solid #D97B00",borderRadius:4,padding:"10px 14px",marginBottom:20,fontSize:13,color:"#7A4B00" }}>
            <strong>Reason / السبب: </strong>{form.reason}
          </div>
        )}

        {/* Line items table — same structure as receipt voucher amount table */}
        <table style={{ width:"100%",borderCollapse:"collapse",marginBottom:20,border:"1px solid #E4E6EA" }}>
          <thead>
            <tr style={{ background:"#FFF0F0" }}>
              {["Description / الوصف","Qty / الكمية","Unit Price excl. VAT (SAR)","Total incl. VAT (SAR)"].map((h,i)=>(
                <th key={i} style={{ padding:"9px 12px",textAlign:i>0?"right":"left",fontSize:11,letterSpacing:1,textTransform:"uppercase",color:"#D94040",fontWeight:700,borderBottom:"1px solid #F5C0C0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(creditInv.items||[]).map((it,i)=>(
              <tr key={i} style={{ borderBottom:"1px solid #F2F3F5",background:i%2===0?"white":"#FAFBFC" }}>
                <td style={{ padding:"11px 12px" }}>
                  <div style={{ fontSize:13,color:"#000",fontWeight:600 }}>{it.descEn}</div>
                  {it.descAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:12,color:"#333",direction:"rtl",marginTop:1 }}>{it.descAr}</div>}
                </td>
                <td style={{ padding:"11px 12px",textAlign:"right",fontSize:13 }}>{it.qty}</td>
                <td style={{ padding:"11px 12px",textAlign:"right",fontSize:13 }}>{fmt(it.unitPrice)}</td>
                <td style={{ padding:"11px 12px",fontSize:15,fontWeight:800,color:"#D94040",textAlign:"right" }}>SAR {fmt(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Summary box — mirrors receipt voucher summary, red scheme */}
        <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:24 }}>
          <div style={{ minWidth:280,borderRadius:6,overflow:"hidden",border:"1px solid #E4E6EA" }}>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 14px",borderBottom:"1px solid #E4E6EA" }}>
              <span style={{color:"#555"}}>Original Invoice Total</span>
              <span>SAR {fmt(originalInv?.grandTotal||0)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 14px",borderBottom:"1px solid #E4E6EA" }}>
              <span style={{color:"#555"}}>Subtotal (excl. VAT)</span>
              <span>SAR {fmt(totals.sub)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 14px",borderBottom:"1px solid #F5C0C0",color:"#555" }}>
              <span>VAT (15%) / ضريبة القيمة المضافة</span>
              <span>SAR {fmt(totals.vat)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,color:"#D94040",padding:"10px 14px",background:"#FFF0F0" }}>
              <span>Credit Total (incl. VAT)</span>
              <span>SAR {fmt(totals.grand)}</span>
            </div>
          </div>
        </div>

        {/* Signatures — identical to receipt voucher */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:24,marginTop:32,paddingTop:16,borderTop:"1px solid #E4E6EA" }}>
          {["Prepared By / أُعدّ بواسطة","Approved By / اعتمد","Received By / استُلم بواسطة"].map(lbl=>(
            <div key={lbl} style={{ textAlign:"center" }}>
              <div style={{ height:48,borderBottom:"1px solid #111",marginBottom:8 }} />
              <div style={{ fontSize:11,color:"#555",letterSpacing:.5 }}>{lbl}</div>
            </div>
          ))}
        </div>

        {/* Footer — identical to receipt voucher */}
        <div style={{ marginTop:24,paddingTop:12,borderTop:"1px solid #E4E6EA",display:"flex",justifyContent:"space-between",fontSize:10,color:"#aaa",letterSpacing:1,textTransform:"uppercase" }}>
          <span>{company.companyEn||company.companyAr||""} · {addr||""}</span>
          {company.vatNumber && <span>VAT: {company.vatNumber}</span>}
        </div>

      </div>
    </Modal>
  );

  return (
    <Modal open title="Issue Credit Entry" onClose={onClose} wide
      footer={<>
        <button style={css.btnSecondary} onClick={onClose}>Cancel</button>
        <button style={{ ...css.btnSecondary,borderColor:T.danger,color:T.danger }} onClick={()=>setPreview(true)}>
          Preview
        </button>
        <button style={{ ...css.btnPrimary,background:T.danger }} onClick={()=>{ onSave(creditInv); onClose(); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
          Save Credit Entry
        </button>
      </>}>
      <div style={css.col(16)}>
        <div style={{ background:"#FFF0F0",border:"1px solid #F5C0C0",borderRadius:6,padding:".75rem 1rem",fontSize:".82rem",color:"#B52E2E" }}>
          Issuing credit invoice against: <strong>{originalInv?.number}</strong> — {originalInv?.clientNameEn}
        </div>
        <div style={css.grid("1fr 1fr",12)}>
          <FormGroup label="Credit Invoice Number">
            <Input value={form.creditNumber} onChange={e=>setF("creditNumber",e.target.value)} />
          </FormGroup>
          <FormGroup label="Issue Date">
            <Input type="date" value={form.issueDate} onChange={e=>setF("issueDate",e.target.value)} />
          </FormGroup>
        </div>
        <FormGroup label="Reason for Credit">
          <Input value={form.reason} onChange={e=>setF("reason",e.target.value)} placeholder="e.g. Overcharge correction, service not delivered…" />
        </FormGroup>
        {/* Items */}
        <div>
          <div style={{ ...css.label,marginBottom:8 }}>Credit Line Items</div>
          <div style={{ display:"grid",gridTemplateColumns:"3fr 1fr 1.5fr 1.3fr",gap:8,padding:".3rem .4rem",marginBottom:4 }}>
            {["Description","Qty","Unit Price","Total"].map((h,i)=>(
              <div key={i} style={{ fontSize:".63rem",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:T.gray500 }}>{h}</div>
            ))}
          </div>
          <div style={css.col(8)}>
            {form.items.map((item,idx)=>{
              const base=(item.creditQty||0)*(item.creditUnit||0);
              return (
                <div key={item.id} style={{ display:"grid",gridTemplateColumns:"3fr 1fr 1.5fr 1.3fr",gap:8,padding:".35rem .4rem",background:idx%2===0?T.gray50:"transparent",borderRadius:5 }}>
                  <div style={{ fontSize:".8rem",color:T.ink,display:"flex",alignItems:"center" }}>{item.descEn||item.descAr}</div>
                  <Input type="number" min="0" value={item.creditQty} onChange={e=>setItem(idx,"creditQty",+e.target.value)} style={{...css.input,textAlign:"center",padding:".35rem .4rem",fontSize:".8rem"}} />
                  <Input type="number" min="0" step="0.01" value={item.creditUnit||""} onChange={e=>setItem(idx,"creditUnit",+e.target.value)} style={{...css.input,padding:".35rem .5rem",fontSize:".8rem"}} />
                  <div style={{ display:"flex",alignItems:"center",fontSize:".82rem",fontWeight:700,color:T.danger }}>{fmt(base)}</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* Summary */}
        <div style={{ display:"flex",justifyContent:"flex-end" }}>
          <div style={{ minWidth:260,background:T.gray50,borderRadius:6,overflow:"hidden",border:`1px solid ${T.gray100}` }}>
            <div style={{ display:"flex",justifyContent:"space-between",padding:"8px 12px",fontSize:".82rem",color:T.gray700,borderBottom:`1px solid ${T.gray100}` }}>
              <span>Subtotal (excl. VAT)</span><span>SAR {fmt(totals.sub)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",padding:"8px 12px",fontSize:".82rem",color:T.gray700,borderBottom:`1px solid ${T.gray100}` }}>
              <span>VAT (15%)</span><span>SAR {fmt(totals.vat)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",padding:"10px 12px",fontSize:"1rem",fontWeight:700,color:T.danger,background:"#FFF0F0" }}>
              <span>Credit Total (incl. VAT)</span><span>SAR {fmt(totals.grand)}</span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   RECEIPT VOUCHER MODAL
═══════════════════════════════════════════════════════════ */
function ReceiptVoucherModal({ inv, settings, clients, onSave, onClose }) {
  const company = settings || {};
  const branch  = inv?.branch || "makkah";
  const addr    = branch === "madinah" ? company.madinahAddress : company.makkahAddress;
  const rvNum   = `RV-${inv?.number || ""}-${Date.now().toString().slice(-4)}`;
  const remaining = Math.max(0, (inv?.grandTotal || 0) - (inv?.amountPaid || 0));

  const [form, setForm] = useState({
    rvNumber:      rvNum,
    date:          today(),
    paymentMethod: "cash",
    referenceNo:   "",
    amountReceived: remaining,
    notes:         "",
  });
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [preview, setPreview] = useState(false);

  const newAmountPaid = (inv?.amountPaid || 0) + (form.amountReceived || 0);
  const newBalance    = Math.max(0, (inv?.grandTotal || 0) - newAmountPaid);
  const fullyPaid     = newBalance <= 0;

  const handleSave = () => {
    const txn = {
      id: uid(), type:"receipt", date:form.date, number:form.rvNumber,
      amount:+(form.amountReceived||0), paymentMethod:form.paymentMethod,
      referenceNo:form.referenceNo, notes:form.notes,
    };
    const updated = {
      ...inv,
      amountPaid: +newAmountPaid.toFixed(2),
      status: fullyPaid ? "paid" : "unpaid",
      updatedAt: new Date().toISOString(),
      transactions: [...(inv.transactions||[]), txn],
    };
    // Resolve the client ID even when the original invoice has none
    // (e.g. manually-typed invoice saved before linkedClientId existed).
    const resolvedReceiptClientId =
      inv.linkedClientId ||
      inv.clientSelect ||
      (clients?.find(c =>
        c.nameEn?.trim() && inv?.clientNameEn?.trim() &&
        c.nameEn.trim().toLowerCase() === inv.clientNameEn.trim().toLowerCase() &&
        (!inv?.clientAddress?.trim() || !c.address?.trim() ||
          inv.clientAddress.trim().toLowerCase() === c.address.trim().toLowerCase())
      )?.id) || "";

    // Also save a standalone receipt voucher record for the invoices list
    const receiptRecord = {
      id: uid(), type:"receipt",
      number: form.rvNumber,
      issueDate: form.date,
      branch: inv.branch,
      linkedInvId: inv.id,
      linkedInvNumber: inv.number,
      // Use resolved ID so the receipt always appears under the correct client
      linkedClientId: resolvedReceiptClientId,
      clientNameEn: inv.clientNameEn,
      clientNameAr: inv.clientNameAr,
      clientVat: inv.clientVat,
      paymentMethod: form.paymentMethod,
      referenceNo: form.referenceNo,
      notes: form.notes,
      grandTotal: +(form.amountReceived||0),
      status: "paid",
    };
    onSave(updated, receiptRecord);
  };

  const printReceipt = () => {
    const content = document.getElementById("rv-print-area").innerHTML;
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Receipt Voucher ${form.rvNumber}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:210mm;background:white;font-family:'DM Sans',sans-serif;color:#000;font-size:13pt}
    @page{size:A4 portrait;margin-top:55mm;margin-left:14mm;margin-right:14mm;margin-bottom:12mm}
    body{padding:0}
    table{border-collapse:collapse;width:100%}
  </style>
</head>
<body>
  ${content}
  <script>window.onload=function(){setTimeout(function(){window.print();window.close();},600);};<\/script>
</body>
</html>`);
    w.document.close();
  };

  if (preview) return (
    <Modal open title={`Receipt Voucher — ${form.rvNumber}`} onClose={()=>setPreview(false)} wide
      footer={<>
        <button style={css.btnSecondary} onClick={()=>setPreview(false)}>Back</button>
        <button style={{ ...css.btnPrimary, background:T.success }} onClick={()=>{ handleSave(); printReceipt(); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Save & Print Receipt
        </button>
      </>}>

      <div id="rv-print-area" style={{ background:"white",color:"#000",padding:"28px 36px",fontFamily:"'DM Sans',sans-serif",border:"1px solid #E4E6EA",borderRadius:6,width:"100%",maxWidth:794,margin:"0 auto" }}>

        {/* Title bar */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,paddingBottom:16,borderBottom:"2px solid #2E9E6B" }}>
          <div>
            <div style={{ fontSize:24,fontFamily:"'DM Serif Display',serif",color:"#2E9E6B",fontWeight:700,letterSpacing:1 }}>RECEIPT VOUCHER</div>
            <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:15,color:"#555",marginTop:3 }}>سند قبض</div>
          </div>
          <div style={{ textAlign:"right",fontSize:13,color:"#111",lineHeight:2 }}>
            <div><span style={{color:"#555"}}>Receipt No.: </span><strong>{form.rvNumber}</strong></div>
            <div><span style={{color:"#555"}}>Date: </span>{form.date}</div>
            <div><span style={{color:"#555"}}>Ref. Invoice: </span><strong>{inv?.number}</strong></div>
            <div><span style={{color:"#555"}}>Branch: </span>{branch==="madinah"?"Madinah / المدينة":"Makkah / مكة"}</div>
          </div>
        </div>

        {/* Received from */}
        <div style={{ background:"#F0FBF5",border:"1px solid #A8DBC0",borderRadius:6,padding:"14px 18px",marginBottom:20,fontSize:14 }}>
          <span style={{color:"#555"}}>Received from / استُلم من: </span>
          <strong>{inv?.clientNameEn}</strong>
          {inv?.clientNameAr && <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,marginRight:6,direction:"rtl" }}> / {inv?.clientNameAr}</span>}
        </div>

        {/* Amount table */}
        <table style={{ width:"100%",borderCollapse:"collapse",marginBottom:20,border:"1px solid #E4E6EA" }}>
          <thead>
            <tr style={{ background:"#E8F5EF" }}>
              {["Description / البيان","Payment Method / طريقة الدفع","Reference No.","Amount (SAR)"].map((h,i)=>(
                <th key={i} style={{ padding:"9px 12px",textAlign:i===3?"right":"left",fontSize:11,letterSpacing:1,textTransform:"uppercase",color:"#1E7A4A",fontWeight:700,borderBottom:"1px solid #A8DBC0" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding:"11px 12px",fontSize:13 }}>Payment for Invoice {inv?.number}</td>
              <td style={{ padding:"11px 12px",fontSize:13,textTransform:"capitalize" }}>{form.paymentMethod.replace("-"," ")}</td>
              <td style={{ padding:"11px 12px",fontSize:13,color:"#555" }}>{form.referenceNo||"—"}</td>
              <td style={{ padding:"11px 12px",fontSize:15,fontWeight:800,color:"#1E7A4A",textAlign:"right" }}>SAR {fmt(form.amountReceived)}</td>
            </tr>
          </tbody>
        </table>

        {/* Summary */}
        <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:24 }}>
          <div style={{ minWidth:280,borderRadius:6,overflow:"hidden",border:"1px solid #E4E6EA" }}>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 14px",borderBottom:"1px solid #E4E6EA" }}>
              <span style={{color:"#555"}}>Invoice Total</span><span>SAR {fmt(inv?.grandTotal)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:13,padding:"8px 14px",borderBottom:"1px solid #E4E6EA" }}>
              <span style={{color:"#555"}}>Previously Received</span><span>SAR {fmt(inv?.amountPaid||0)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:15,fontWeight:700,color:"#1E7A4A",padding:"10px 14px",background:"#E8F5EF",borderBottom:"1px solid #A8DBC0" }}>
              <span>Amount Received Now</span><span>SAR {fmt(form.amountReceived)}</span>
            </div>
            <div style={{ display:"flex",justifyContent:"space-between",fontSize:14,fontWeight:700,padding:"10px 14px",color:newBalance>0?"#B52E2E":"#1E7A4A",background:newBalance>0?"#FDECEA":"#E8F5EF" }}>
              <span>Remaining Balance / الرصيد المتبقي</span><span>SAR {fmt(newBalance)}</span>
            </div>
          </div>
        </div>

        {form.notes && (
          <div style={{ background:"#EAF4FB",borderLeft:"3px solid #5BA4CF",padding:"10px 14px",fontSize:13,color:"#111",marginBottom:24,borderRadius:4 }}>{form.notes}</div>
        )}

        {/* Signatures */}
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:24,marginTop:32,paddingTop:16,borderTop:"1px solid #E4E6EA" }}>
          {["Prepared By / أُعدّ بواسطة","Received By / استُلم بواسطة","Authorized By / اعتمد"].map(lbl=>(
            <div key={lbl} style={{ textAlign:"center" }}>
              <div style={{ height:48,borderBottom:"1px solid #111",marginBottom:8 }} />
              <div style={{ fontSize:11,color:"#555",letterSpacing:.5 }}>{lbl}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ marginTop:24,paddingTop:12,borderTop:"1px solid #E4E6EA",display:"flex",justifyContent:"space-between",fontSize:10,color:"#aaa",letterSpacing:1,textTransform:"uppercase" }}>
          <span>{company.companyEn||company.companyAr||""} · {addr||""}</span>
          {company.vatNumber && <span>VAT: {company.vatNumber}</span>}
        </div>

      </div>
    </Modal>
  );

  return (
    <Modal open title="Issue Receipt Voucher" onClose={onClose}
      footer={<>
        <button style={css.btnSecondary} onClick={onClose}>Cancel</button>
        <button style={{ ...css.btnSecondary,borderColor:T.success,color:T.success }} onClick={()=>setPreview(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          Preview & Print
        </button>
        <button style={{ ...css.btnPrimary, background:T.success }} onClick={handleSave}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Save Receipt
        </button>
      </>}>

      <div style={css.col(16)}>
        {/* Invoice info strip */}
        <div style={{ background:T.bluePale,border:`1px solid ${T.blueLight}`,borderRadius:8,padding:"10px 14px" }}>
          <div style={{ fontSize:".72rem",fontWeight:700,color:T.gray500,letterSpacing:".1em",textTransform:"uppercase",marginBottom:4 }}>Invoice Reference</div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
            <div>
              <span style={{ fontWeight:700,color:T.blue,fontSize:".9rem" }}>{inv?.number}</span>
              <span style={{ color:T.gray500,fontSize:".82rem",marginLeft:8 }}>{inv?.clientNameEn}</span>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:".82rem",color:T.gray500 }}>Invoice Total: <strong style={{color:T.ink}}>SAR {fmt(inv?.grandTotal)}</strong></div>
              <div style={{ fontSize:".78rem",color:remaining>0?T.danger:T.success,marginTop:2 }}>
                {remaining>0 ? `Outstanding: SAR ${fmt(remaining)}` : "✓ Fully Paid"}
              </div>
            </div>
          </div>
        </div>

        <div style={css.grid("1fr 1fr",14)}>
          <FormGroup label="Receipt Number"><Input value={form.rvNumber} onChange={e=>setF("rvNumber",e.target.value)} /></FormGroup>
          <FormGroup label="Date"><Input type="date" value={form.date} onChange={e=>setF("date",e.target.value)} /></FormGroup>
          <FormGroup label="Payment Method">
            <Select value={form.paymentMethod} onChange={e=>setF("paymentMethod",e.target.value)}>
              <option value="cash">Cash / نقداً</option>
              <option value="bank-transfer">Bank Transfer / تحويل بنكي</option>
              <option value="cheque">Cheque / شيك</option>
              <option value="credit-card">Credit Card / بطاقة ائتمان</option>
              <option value="other">Other / أخرى</option>
            </Select>
          </FormGroup>
          <FormGroup label="Reference / Cheque No."><Input value={form.referenceNo} onChange={e=>setF("referenceNo",e.target.value)} placeholder="Transfer ref, cheque no…" /></FormGroup>
        </div>

        <FormGroup label="Amount Received (SAR)">
          <Input type="number" min="0" step="0.01" value={form.amountReceived||""} onChange={e=>setF("amountReceived",+e.target.value)}
            style={{ ...css.input, fontSize:"1.1rem", fontWeight:700, color:T.success, borderColor:T.success }} />
        </FormGroup>

        {/* Live summary */}
        <div style={{ background:T.gray50,borderRadius:8,padding:"12px 16px",border:`1px solid ${T.gray100}` }}>
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:".82rem",color:T.gray700,marginBottom:6 }}>
            <span>After this payment — Balance Due:</span>
            <strong style={{ color:newBalance>0?T.danger:T.success }}>SAR {fmt(newBalance)}</strong>
          </div>
          {fullyPaid && <div style={{ fontSize:".78rem",color:T.success,fontWeight:600 }}>✓ Invoice will be marked as Fully Paid</div>}
        </div>

        <FormGroup label="Notes / ملاحظات">
          <textarea value={form.notes} onChange={e=>setF("notes",e.target.value)}
            rows={2} placeholder="Optional notes…"
            style={{ ...css.input, resize:"vertical", fontFamily:"inherit" }} />
        </FormGroup>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   SHARED INVOICE RENDER HELPERS (used by all 3 templates)
═══════════════════════════════════════════════════════════ */
function InvItemsTable(inv, headBg, headBorder, headColor, darkMode=false, minimal=false) {
  const rowBg = (i) => {
    if (minimal) return i%2===0?"white":"#FAFBFC";
    if (darkMode) return i%2===0?"white":"#F7F8FA";
    return i%2===0?"white":"#FAFBFC";
  };
  return (
    <table style={{ width:"100%",borderCollapse:"collapse",marginBottom:24 }}>
      <thead>
        <tr style={{ background: minimal?"transparent":headBg, borderBottom:`2px solid ${headBorder}` }}>
          {["Description / الوصف","Qty","Unit Price excl. VAT","VAT %","Total incl. VAT"].map((h,i)=>(
            <th key={i} style={{ padding:"10px 12px",textAlign:i>0?"right":"left",
              fontSize:11,letterSpacing:1,textTransform:"uppercase",
              color: minimal?"#000":headColor,fontWeight:700,
              borderBottom: minimal?`1px solid #000`:"none" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(inv.items||[]).map((it,i)=>(
          <tr key={i} style={{ borderBottom:`1px solid ${minimal?"#E4E6EA":"#E4E6EA"}`,background:rowBg(i) }}>
            <td style={{ padding:"11px 12px" }}>
              <div style={{ fontSize:14,color:"#000" }}>{it.descEn}</div>
              {it.descAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:13,color:"#333",direction:"rtl",marginTop:2 }}>{it.descAr}</div>}
            </td>
            <td style={{ padding:"11px 12px",textAlign:"right",fontSize:14,color:"#000" }}>{it.qty}</td>
            <td style={{ padding:"11px 12px",textAlign:"right",fontSize:14,color:"#000" }}>{fmt(it.unitPrice)}</td>
            <td style={{ padding:"11px 12px",textAlign:"right",fontSize:14,color:"#000" }}>{it.vatPct||15}%</td>
            <td style={{ padding:"11px 12px",textAlign:"right",fontSize:14,fontWeight:700,color:darkMode?"#1A2332":"#000" }}>{fmt(it.lineTotal)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InvTotalsBlock(inv, totalBg, totalColor) {
  return (
    <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:24 }}>
      <div style={{ minWidth:300,borderRadius:6,overflow:"hidden",border:"1px solid #E4E6EA" }}>
        {[["Subtotal / المجموع",fmt(inv.subtotal)],["VAT 15% / ضريبة",fmt(inv.vatTotal)]].map(([l,v])=>(
          <div key={l} style={{ display:"flex",justifyContent:"space-between",fontSize:14,color:"#000",padding:"9px 14px",borderBottom:"1px solid #E4E6EA",background:"#F7F8FA" }}>
            <span>{l}</span><span>SAR {v}</span>
          </div>
        ))}
        {inv.creditAmount>0 && (
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:14,color:"#1E7A4A",padding:"9px 14px",borderBottom:"1px solid #E4E6EA",background:"#F0FBF5" }}>
            <span>Credit{inv.creditNote?` — ${inv.creditNote}`:""} / ائتمان</span>
            <span>− SAR {fmt(inv.creditAmount)}</span>
          </div>
        )}
        <div style={{ display:"flex",justifyContent:"space-between",padding:"11px 14px",fontSize:17,fontWeight:700,color:totalColor,background:totalBg }}>
          <span>TOTAL DUE / الإجمالي</span>
          <span>SAR {fmt(inv.grandTotal)}</span>
        </div>
        {inv.amountPaid>0 && (
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:14,color:"#1E7A4A",padding:"9px 14px",borderBottom:"1px solid #E4E6EA",background:"#F0FBF5" }}>
            <span>Amount Received / المبلغ المستلم</span>
            <span style={{fontWeight:700}}>SAR {fmt(inv.amountPaid)}</span>
          </div>
        )}
        {inv.amountPaid>0 && (
          <div style={{ display:"flex",justifyContent:"space-between",padding:"11px 14px",fontSize:16,fontWeight:700,
            color:inv.grandTotal-inv.amountPaid<=0?"#1E7A4A":"#D94040",
            background:inv.grandTotal-inv.amountPaid<=0?"#E8F5EF":"#FDECEA" }}>
            <span>BALANCE DUE / الرصيد المستحق</span>
            <span>SAR {fmt(Math.max(0,inv.grandTotal-inv.amountPaid))}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function InvNotes(inv) {
  if (!inv.notes) return null;
  return (
    <div style={{ background:"#EAF4FB",borderLeft:"3px solid #5BA4CF",padding:"10px 14px",
      fontSize:13,color:"#111",marginBottom:24,borderRadius:4,lineHeight:1.8 }}>
      {inv.notes}
    </div>
  );
}

function InvFooter(inv, company, addr) {
  return (
    <div className="inv-footer" style={{ borderTop:"2px solid #E4E6EA",paddingTop:12,marginTop:8 }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:10,letterSpacing:1.5,textTransform:"uppercase",color:"#A8CDED" }}>
        <span>{company.companyEn||company.companyAr||""} · Excellence in Hospitality</span>
        <span style={{ color:"#000",fontSize:10,letterSpacing:1,fontWeight:700 }}>
          {company.crNumber && `CR: ${company.crNumber}`}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   INVOICE PREVIEW (ZATCA Phase 1 compliant)
═══════════════════════════════════════════════════════════ */
function InvoicePreview({ inv, settings, allInvoices, onClose, docType="invoice" }) {
  const isCredit = docType === "credit";
  const qrRef  = useRef(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [tab, setTab] = useState("invoice"); // "invoice" | "transactions"
  const company  = settings||{};
  const tpl      = settings?.invoiceTemplate || "classic";

  // All linked receipts and credit notes
  const linkedTxns = (allInvoices||[]).filter(r=>
    r.linkedInvId===inv.id || r.originalInvId===inv.id
  ).sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));
  const txnsEmbedded = inv.transactions || [];

  // Resolve branch address from dynamic branches list or fall back to legacy fields
  const branchObj = (() => {
    try {
      const bs = JSON.parse(settings?.branches||"null") || [];
      return bs.find(b=>b.id===inv.branch) || null;
    } catch { return null; }
  })();
  const addr = branchObj?.address ||
    (inv.branch==="madinah" ? company.madinahAddress : company.makkahAddress) || "";

  /* ── ZATCA Phase-1 TLV QR string ──
     Tag 1 = Seller name  Tag 2 = VAT reg no
     Tag 3 = Timestamp    Tag 4 = Invoice total (incl. VAT)
     Tag 5 = VAT amount
  */
  const zatcaStr = buildZatcaQR({
    sellerName: company.companyEn||company.companyAr||"",
    vatNumber:  company.vatNumber||"",
    timestamp:  (inv.issueDate||today())+"T00:00:00Z",
    total:      (inv.grandTotal||0).toFixed(2),
    vatTotal:   (inv.vatTotal||0).toFixed(2),
  });

  /* Render QR into hidden div, then extract canvas → data URL */
  useEffect(()=>{
    const loadAndRender = () => {
      if (!qrRef.current) return;
      qrRef.current.innerHTML = "";
      if (!window.QRCode) {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
        s.onload = () => renderQR();
        document.head.appendChild(s);
      } else {
        renderQR();
      }
    };

    const renderQR = () => {
      if (!qrRef.current) return;
      qrRef.current.innerHTML = "";
      new window.QRCode(qrRef.current, {
        text: zatcaStr,
        width: 120, height: 120,
        correctLevel: window.QRCode.CorrectLevel.M,
      });
      /* Extract canvas data URL for printing */
      setTimeout(()=>{
        const canvas = qrRef.current?.querySelector("canvas");
        if (canvas) setQrDataUrl(canvas.toDataURL("image/png"));
      }, 200);
    };

    loadAndRender();
  }, [zatcaStr]);

  const [letterhead, setLetterhead] = useState(false);
  const [colorMode,  setColorMode]  = useState("color"); // "color" | "bw"

  /* ── Print ─────────────────────────────────────────────────────────── */
  const printIt = () => {
    const content = document.getElementById("inv-print-area").innerHTML;

    const colorCss = colorMode === "bw" ? `
      /* ── Black & White ── */
      * { color: #000 !important; background: white !important;
          border-color: #aaa !important; box-shadow: none !important; }
      img { filter: grayscale(100%) !important; }
      [style*="background"] { background: white !important; }
    ` : `
      /* ── Full Colour — force browser to print backgrounds and colours ── */
      * { -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
          color-adjust: exact !important; }
    `;

    const lhCss = letterhead ? `
      .inv-co-header { display: none !important; }
      .inv-lh-addr   { display: none !important; }
      .inv-footer     { display: none !important; }
      header, footer  { display: none !important; }
      @page { margin-top: 52mm; margin-left: 14mm; margin-right: 14mm; margin-bottom: 10mm; }
    ` : `
      header, footer  { display: none !important; }
      @page { size: A4 portrait; margin: 12mm; }
    `;

    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html lang="en"><head>
  <meta charset="UTF-8"/>
  <title>Invoice ${inv.number}</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    html,body{width:210mm;background:white;font-family:'DM Sans',sans-serif;color:#000;font-size:13pt}
    body{padding:0}table{border-collapse:collapse;width:100%}img{max-width:100%;display:block}
    ${lhCss}
    ${colorCss}
  </style></head><body>
  ${content}
  <script>window.onload=function(){setTimeout(function(){window.print();window.close();},600);};<\/script>
</body></html>`);
    w.document.close();
  };

  /* ── shared section label style ── */
  const secLabel = { fontSize:10,letterSpacing:2,textTransform:"uppercase",
    color:"#5BA4CF",marginBottom:6,fontWeight:700 };

  return (
    <Modal open title={`${isCredit?"Credit Note":"Invoice"} ${inv.number}`} onClose={onClose} wide
      footer={<>
        <button style={css.btnSecondary} onClick={onClose}>Close</button>
        <button style={{ ...css.btnSecondary, borderColor:tab==="transactions"?T.blue:"transparent", color:tab==="transactions"?T.blue:T.gray700, background:tab==="transactions"?T.bluePale:"transparent" }}
          onClick={()=>setTab(t=>t==="transactions"?"invoice":"transactions")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Transactions {(linkedTxns.length+txnsEmbedded.length)>0 && `(${linkedTxns.length+txnsEmbedded.length})`}
        </button>

        {/* ── Print options ── */}
        <div style={{ display:"flex",alignItems:"center",gap:6,padding:"4px 10px",
          background:T.gray50,borderRadius:8,border:`1px solid ${T.gray100}` }}>
          {/* Letterhead toggle */}
          <span style={{ fontSize:".68rem",color:T.gray500,fontWeight:600,whiteSpace:"nowrap" }} title="Hides company header, seller box and footer — for pre-printed letterhead paper">Letterhead</span>
          <button onClick={()=>setLetterhead(v=>!v)} style={{
            width:34,height:18,borderRadius:9,border:"none",cursor:"pointer",
            background:letterhead?T.blue:T.gray200,position:"relative",transition:"background .2s",flexShrink:0
          }}>
            <div style={{ width:14,height:14,borderRadius:7,background:"white",
              position:"absolute",top:2,left:letterhead?18:2,transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,.2)" }}/>
          </button>
          <div style={{ width:1,height:16,background:T.gray200,margin:"0 2px" }}/>
          {/* Color mode */}
          <span style={{ fontSize:".68rem",color:T.gray500,fontWeight:600,whiteSpace:"nowrap" }}>Print</span>
          {[["color","🎨 Color"],["bw","⬛ B&W"]].map(([m,lbl])=>(
            <button key={m} onClick={()=>setColorMode(m)}
              style={{ fontSize:".65rem",padding:"3px 8px",borderRadius:6,border:"none",cursor:"pointer",fontWeight:700,
                background:colorMode===m?T.blue:"transparent",color:colorMode===m?"white":T.gray500,transition:"all .15s" }}>
              {lbl}
            </button>
          ))}
        </div>

        <button style={css.btnPrimary} onClick={printIt}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print / Save PDF
        </button>
      </>}>

      {/* ── Transaction History Panel ── */}
      {tab==="transactions" && (
        <div style={{ width:"100%",maxWidth:794,margin:"0 auto",background:"white",border:"1px solid #E4E6EA",borderRadius:6,padding:"24px 28px" }}>
          <div style={{ fontSize:16,fontWeight:700,color:T.ink,marginBottom:4 }}>Transaction History</div>
          <div style={{ fontSize:".75rem",color:T.gray500,marginBottom:18 }}>All receipts and credit entries linked to invoice {inv.number}</div>

          {/* Summary bar */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:20 }}>
            {[
              ["Invoice Total","SAR "+fmt(inv.grandTotal),T.blue,T.bluePale],
              ["Total Received","SAR "+fmt(inv.amountPaid||0),T.success,"#E8F5EF"],
              ["Balance Due","SAR "+fmt(Math.max(0,(inv.grandTotal||0)-(inv.amountPaid||0))),(inv.grandTotal||0)>(inv.amountPaid||0)?T.danger:T.success,(inv.grandTotal||0)>(inv.amountPaid||0)?"#FDECEA":"#E8F5EF"],
            ].map(([l,v,col,bg])=>(
              <div key={l} style={{ background:bg,borderRadius:8,padding:"12px 16px",border:`1px solid ${col}22` }}>
                <div style={{ fontSize:".67rem",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:col,marginBottom:4 }}>{l}</div>
                <div style={{ fontSize:"1.05rem",fontWeight:700,color:col }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Linked records */}
          {linkedTxns.length===0 && txnsEmbedded.length===0 ? (
            <div style={{ textAlign:"center",padding:"32px 0",color:T.gray400,fontSize:".82rem" }}>
              No transactions recorded yet
            </div>
          ) : (
            <div style={css.col(8)}>
              {[...linkedTxns].map(rec=>(
                <div key={rec.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"12px 16px",border:`1px solid ${rec.type==="receipt"?T.success+"44":T.danger+"44"}`,
                  borderRadius:8,background:rec.type==="receipt"?"#F0FBF5":"#FFF8F8" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <div style={{ width:36,height:36,borderRadius:8,background:rec.type==="receipt"?T.success:T.danger,
                      display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      {rec.type==="receipt"
                        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>}
                    </div>
                    <div>
                      <div style={{ fontSize:".82rem",fontWeight:700,color:T.ink }}>
                        {rec.type==="receipt"?"Receipt Voucher":"Credit Entry"} — {rec.number}
                      </div>
                      <div style={{ fontSize:".72rem",color:T.gray500,marginTop:2 }}>
                        <><DateBoth dateStr={rec.issueDate} enSize={12} arSize={10} color={T.gray500} />{" "}{rec.paymentMethod && `· ${rec.paymentMethod.replace("-"," ")}`} {rec.referenceNo && `· Ref: ${rec.referenceNo}`}</>
                      </div>
                      {rec.notes && <div style={{ fontSize:".7rem",color:T.gray400,marginTop:1,fontStyle:"italic" }}>{rec.notes}</div>}
                    </div>
                  </div>
                  <div style={{ textAlign:"right",flexShrink:0 }}>
                    <div style={{ fontSize:"1rem",fontWeight:700,color:rec.type==="receipt"?T.success:T.danger }}>
                      {rec.type==="receipt"?"+":"-"} SAR {fmt(rec.grandTotal)}
                    </div>
                  </div>
                </div>
              ))}
              {txnsEmbedded.filter(t=>!linkedTxns.find(r=>r.number===t.number)).map(txn=>(
                <div key={txn.id} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"12px 16px",border:`1px solid ${T.success}44`,borderRadius:8,background:"#F0FBF5" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <div style={{ width:36,height:36,borderRadius:8,background:T.success,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div>
                      <div style={{ fontSize:".82rem",fontWeight:700,color:T.ink }}>Receipt — {txn.number}</div>
                      <div style={{ fontSize:".72rem",color:T.gray500,marginTop:2 }}>
                        {txn.date} {txn.paymentMethod && `· ${txn.paymentMethod}`}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize:"1rem",fontWeight:700,color:T.success }}>+ SAR {fmt(txn.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── A4 preview area ── */}
      <div id="inv-print-area" style={{
        background:"white", color:"#1A1400", padding: tpl==="modern" ? 0 : "32px 36px",
        fontFamily:"'DM Sans',sans-serif", position:"relative",
        border:"1px solid #E4E6EA", borderRadius:6,
        width:"100%", maxWidth:794, margin:"0 auto",
        minHeight:1000, overflow:"hidden",
        display: tab==="transactions" ? "none" : "block",
      }}>

        {/* ── PAID watermark ── */}
        {inv.status==="paid" && (
          <div style={{ position:"absolute",top:"40%",left:"50%",
            transform:"translate(-50%,-50%) rotate(-28deg)",fontSize:88,fontWeight:700,
            letterSpacing:12,color:"rgba(46,158,107,.05)",textTransform:"uppercase",
            pointerEvents:"none",userSelect:"none",whiteSpace:"nowrap",zIndex:0 }}>
            PAID
          </div>
        )}

        {/* ══════════════════════════════════════
            TEMPLATE: CLASSIC BLUE (default)
        ══════════════════════════════════════ */}
        {tpl==="classic" && (<>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:28 }}>
            <div className="inv-co-header" style={{ display:"flex",flexDirection:"column",gap:4 }}>
              {company.logoDataUrl && <img src={company.logoDataUrl} alt="Logo" style={{ maxHeight:72,maxWidth:190,objectFit:"contain",marginBottom:4 }}/>}
              <div style={{ fontSize:company.logoDataUrl?18:24,fontFamily:"'DM Serif Display',serif",color:"#3A7FB5",letterSpacing:2,fontWeight:700 }}>{company.companyEn||company.companyAr||""}</div>
              {company.companyAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:15,color:"#333",direction:"rtl" }}>{company.companyAr}</div>}
            </div>
            <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:12 }}>
              <div><div ref={qrRef} style={{ display:"none" }} />{qrDataUrl?<img src={qrDataUrl} alt="ZATCA QR" width={100} height={100} style={{ border:"1px solid #E4E6EA",borderRadius:4,padding:3 }}/>:<div style={{ width:100,height:100,border:"1px solid #E4E6EA",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#aaa" }}>Loading QR…</div>}</div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:26,fontFamily:"'DM Serif Display',serif",color:"#3A7FB5",fontWeight:700,letterSpacing:1 }}>{isCredit?"CREDIT NOTE":"INVOICE"}</div>
                <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:15,color:"#6B5A2A",marginTop:2 }}>{isCredit?"إشعار دائن":"فاتورة ضريبية"}</div>
                <div style={{ fontSize:14,color:"#111",marginTop:10,lineHeight:2.1 }}>
                  <div><span style={{color:"#555"}}>{isCredit?"Credit No.:":"Invoice No.:"} </span><strong>{inv.number}</strong></div>
                  <div style={{lineHeight:1.2,marginBottom:2}}><span style={{color:"#555"}}>Issue Date: </span><DateBoth dateStr={inv.issueDate} enSize={13} arSize={11} /></div>
                  <div><span style={{color:"#555"}}>Branch: </span>{branchObj?.nameEn||inv.branch}</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ height:3,background:"linear-gradient(90deg,#3A7FB5,#A8CDED,transparent)",marginBottom:24,borderRadius:2 }}/>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginBottom:28 }}>
            {[
              ["FROM / من", <div className="inv-seller-box"><div style={{ fontSize:16,fontWeight:700 }}>{company.companyEn||company.companyAr||""}</div>{company.companyAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{company.companyAr}</div>}<div style={{ fontSize:13,marginTop:6,lineHeight:2 }}>{company.vatNumber&&<div>VAT: <strong>{company.vatNumber}</strong></div>}{addr&&<div>{addr}</div>}</div></div>],
              ["BILLED TO / فاتورة إلى", <><div style={{ fontSize:16,fontWeight:700 }}>{inv.clientNameEn}</div>{inv.clientNameAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{inv.clientNameAr}</div>}<div style={{ fontSize:13,marginTop:6,lineHeight:2 }}>{inv.clientVat&&<div>VAT: <strong>{inv.clientVat}</strong></div>}{inv.clientAddress&&<div>{inv.clientAddress}</div>}</div></>],
            ].map(([lbl,body])=>(
              <div key={lbl} style={{ background:"#F7F8FA",padding:"14px 16px",borderRadius:6,borderLeft:"3px solid #5BA4CF" }}>
                <div style={{ fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#5BA4CF",marginBottom:6,fontWeight:700 }}>{lbl}</div>
                {body}
              </div>
            ))}
          </div>
          {InvItemsTable(inv, "#EAF4FB","#5BA4CF","#3A7FB5")}
          {InvTotalsBlock(inv, "#EAF4FB","#3A7FB5")}
          {InvNotes(inv)}
          {InvFooter(inv, company, addr)}
        </>)}

        {/* ══════════════════════════════════════
            TEMPLATE: MODERN DARK HEADER
        ══════════════════════════════════════ */}
        {tpl==="modern" && (<>
          {/* Dark header band */}
          <div className="inv-co-header" style={{ background:"#1A2332",padding:"24px 36px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:0 }}>
            <div>
              {company.logoDataUrl
                ? <img src={company.logoDataUrl} alt="Logo" style={{ maxHeight:52,maxWidth:160,objectFit:"contain",marginBottom:8,filter:"brightness(0) invert(1)",opacity:.9 }}/>
                : <div style={{ fontSize:24,fontFamily:"'DM Serif Display',serif",color:"white",letterSpacing:2,fontWeight:700,marginBottom:4 }}>{company.companyEn||company.companyAr||""}</div>}
              {company.companyAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,color:"rgba(255,255,255,.6)",direction:"rtl" }}>{company.companyAr}</div>}
            </div>
            <div style={{ display:"flex",flexDirection:"column",alignItems:"flex-end",gap:12 }}>
              <div style={{ background:"rgba(255,255,255,.08)",padding:6,borderRadius:6 }}>
                <div ref={qrRef} style={{ display:"none" }} />
                {qrDataUrl?<img src={qrDataUrl} alt="ZATCA QR" width={90} height={90} style={{ display:"block",borderRadius:3 }}/>:<div style={{ width:90,height:90,background:"rgba(255,255,255,.1)",borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"rgba(255,255,255,.4)" }}>QR…</div>}
              </div>
            </div>
          </div>
          {/* Title strip */}
          <div style={{ background:"#252F3E",padding:"10px 36px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:28 }}>
            <div>
              <span style={{ fontSize:22,fontFamily:"'DM Serif Display',serif",color:"white",letterSpacing:1,fontWeight:700 }}>{isCredit?"CREDIT NOTE":"INVOICE"}</span>
              <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,color:"rgba(255,255,255,.6)",marginLeft:12 }}>{isCredit?"إشعار دائن":"فاتورة ضريبية"}</span>
            </div>
            <div style={{ display:"flex",gap:20,fontSize:13,color:"rgba(255,255,255,.8)" }}>
              <div><span style={{color:"rgba(255,255,255,.5)"}}>No.: </span><strong style={{color:"white"}}>{inv.number}</strong></div>
              <div style={{lineHeight:1.2}}><span style={{color:"rgba(255,255,255,.5)"}}>Date: </span><DateBoth dateStr={inv.issueDate} enSize={13} arSize={11} color="white" /></div>
              <div><span style={{color:"rgba(255,255,255,.5)"}}>Branch: </span>{branchObj?.nameEn||inv.branch}</div>
            </div>
          </div>
          {/* Body */}
          <div style={{ padding:"0 36px 32px" }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginBottom:28 }}>
              {[
                ["FROM / من","#1A2332", <><div style={{ fontSize:16,fontWeight:700 }}>{company.companyEn||company.companyAr||""}</div>{company.companyAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{company.companyAr}</div>}<div style={{ fontSize:13,marginTop:6,lineHeight:2 }}>{company.vatNumber&&<div>VAT: <strong>{company.vatNumber}</strong></div>}{addr&&<div>{addr}</div>}</div></>],
                ["BILLED TO / فاتورة إلى","#1A2332",<><div style={{ fontSize:16,fontWeight:700 }}>{inv.clientNameEn}</div>{inv.clientNameAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{inv.clientNameAr}</div>}<div style={{ fontSize:13,marginTop:6,lineHeight:2 }}>{inv.clientVat&&<div>VAT: <strong>{inv.clientVat}</strong></div>}{inv.clientAddress&&<div>{inv.clientAddress}</div>}</div></>],
              ].map(([lbl,col,body])=>(
                <div key={lbl} style={{ background:"#F7F8FA",padding:"14px 16px",borderRadius:6,borderBottom:`3px solid ${col}` }}
                  className={lbl.startsWith("FROM")?"inv-seller-box":undefined}>
                  <div style={{ fontSize:10,letterSpacing:2,textTransform:"uppercase",color:col,marginBottom:6,fontWeight:700 }}>{lbl}</div>
                  {body}
                </div>
              ))}
            </div>
            {InvItemsTable(inv,"#1A2332","#1A2332","#1A2332", true)}
            {InvTotalsBlock(inv,"#1A2332","#1A2332")}
            {InvNotes(inv)}
            {InvFooter(inv, company, addr)}
          </div>
        </>)}

        {/* ══════════════════════════════════════
            TEMPLATE: MINIMAL CLEAN
        ══════════════════════════════════════ */}
        {tpl==="minimal" && (<>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,paddingBottom:16,borderBottom:"2px solid #000" }}>
            <div className="inv-co-header">
              {company.logoDataUrl && <img src={company.logoDataUrl} alt="Logo" style={{ maxHeight:60,maxWidth:160,objectFit:"contain",marginBottom:8 }}/>}
              <div style={{ fontSize:company.logoDataUrl?16:22,fontFamily:"'DM Serif Display',serif",color:"#000",letterSpacing:1,fontWeight:700 }}>{company.companyEn||company.companyAr||""}</div>
              {company.companyAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,color:"#444",direction:"rtl",marginTop:2 }}>{company.companyAr}</div>}
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ marginBottom:10 }}>
                <div ref={qrRef} style={{ display:"none" }} />
                {qrDataUrl?<img src={qrDataUrl} alt="ZATCA QR" width={90} height={90} style={{ display:"block",marginLeft:"auto",border:"1px solid #ccc",padding:2 }}/>:<div style={{ width:90,height:90,border:"1px solid #ccc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#aaa",marginLeft:"auto" }}>QR…</div>}
              </div>
              <div style={{ fontSize:28,fontFamily:"'DM Serif Display',serif",color:"#000",fontWeight:700,letterSpacing:1 }}>{isCredit?"CREDIT NOTE":"INVOICE"}</div>
              <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:15,color:"#444",marginTop:2 }}>{isCredit?"إشعار دائن":"فاتورة ضريبية"}</div>
              <div style={{ fontSize:13,color:"#000",marginTop:10,lineHeight:2 }}>
                <div><span style={{color:"#666"}}>No.: </span><strong>{inv.number}</strong></div>
                <div style={{lineHeight:1.2,marginBottom:2}}><span style={{color:"#666"}}>Date: </span><DateBoth dateStr={inv.issueDate} enSize={13} arSize={11} /></div>
                <div><span style={{color:"#666"}}>Branch: </span>{branchObj?.nameEn||inv.branch}</div>
              </div>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:24,marginBottom:24 }}>
            {[
              ["FROM / من",<><div style={{ fontSize:15,fontWeight:700 }}>{company.companyEn||company.companyAr||""}</div>{company.companyAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{company.companyAr}</div>}<div style={{ fontSize:12,marginTop:4,lineHeight:1.8,color:"#333" }}>{company.vatNumber&&<div>VAT: {company.vatNumber}</div>}{addr&&<div>{addr}</div>}</div></>],
              ["BILLED TO / فاتورة إلى",<><div style={{ fontSize:15,fontWeight:700 }}>{inv.clientNameEn}</div>{inv.clientNameAr&&<div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,direction:"rtl",marginTop:2 }}>{inv.clientNameAr}</div>}<div style={{ fontSize:12,marginTop:4,lineHeight:1.8,color:"#333" }}>{inv.clientVat&&<div>VAT: {inv.clientVat}</div>}{inv.clientAddress&&<div>{inv.clientAddress}</div>}</div></>],
            ].map(([lbl,body])=>(
              <div key={lbl} style={{ paddingTop:4 }}
                className={lbl.startsWith("FROM")?"inv-seller-box":undefined}>
                <div style={{ fontSize:10,letterSpacing:2,textTransform:"uppercase",color:"#000",marginBottom:6,fontWeight:700,borderBottom:"1px solid #000",paddingBottom:4 }}>{lbl}</div>
                {body}
              </div>
            ))}
          </div>
          {InvItemsTable(inv,"#000","#000","#000",false,true)}
          {InvTotalsBlock(inv,"#F2F3F5","#000")}
          {InvNotes(inv)}
          {InvFooter(inv, company, addr)}
        </>)}

        {/* ══════════════════════════════════════
            TEMPLATE: SAUDI ZATCA OFFICIAL
        ══════════════════════════════════════ */}
        {tpl==="zatca" && (<>

          {/* 3-column header: Logo | Company EN | Company AR */}
          <table className="inv-co-header" style={{ width:"100%",borderCollapse:"collapse",marginBottom:0,border:"none" }}>
            <tbody><tr>
              <td style={{ border:"none",width:110,verticalAlign:"middle",textAlign:"center",paddingRight:12 }}>
                {company.logoDataUrl
                  ? <img src={company.logoDataUrl} alt="Logo" style={{ maxHeight:80,maxWidth:100,objectFit:"contain",margin:"0 auto" }}/>
                  : <div style={{ width:70,height:70,border:"2px solid #ccc",borderRadius:35,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto",fontSize:26,fontWeight:700,color:"#3A7FB5" }}>{(company.companyEn||"A")[0]}</div>}
                {company.companySubtitle && <div style={{ fontSize:10,color:"#666",marginTop:4,textAlign:"center" }}>{company.companySubtitle}</div>}
              </td>
              <td style={{ border:"none",textAlign:"center",verticalAlign:"middle",padding:"0 12px" }}>
                {company.companyEn && <div style={{ fontSize:20,fontWeight:700,letterSpacing:1,color:"#000",lineHeight:1.4 }}>{company.companyEn}</div>}
                {company.companySubtitleEn && <div style={{ fontSize:13,color:"#333",marginTop:2 }}>{company.companySubtitleEn}</div>}
              </td>
              <td style={{ border:"none",textAlign:"right",verticalAlign:"middle",paddingLeft:12,direction:"rtl" }}>
                <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:20,fontWeight:700,color:"#000",lineHeight:1.4 }}>{company.companyAr||"فندق الأقصى"}</div>
                {company.crNumber && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:12,color:"#000",marginTop:6,fontWeight:700 }}>
                  {`س.ت: ${company.crNumber}`}
                </div>}
              </td>
            </tr></tbody>
          </table>

          {/* Divider + Title + Remark */}
          <div className="inv-co-header" style={{ borderTop:"2px solid #000",borderBottom:"1px solid #000",margin:"12px 0",padding:"5px 12px",display:"flex",alignItems:"center" }}>
            <div style={{ flex:1,minWidth:0 }}>
              {inv.remark && (
                <div style={{ display:"inline-block",border:"1px solid #C8A000",borderRadius:3,
                  padding:"3px 8px",background:"#FFFBE6",maxWidth:220 }}>
                  <div style={{ fontSize:8,fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",
                    color:"#A07800",lineHeight:1.2,marginBottom:1 }}>
                    REMARK / <span style={{ fontFamily:"'Noto Naskh Arabic',serif" }}>ملاحظة</span>
                  </div>
                  <div style={{ fontSize:10,color:"#000",lineHeight:1.4 }}>{inv.remark}</div>
                </div>
              )}
            </div>
            <div style={{ textAlign:"center",flex:"0 0 auto",padding:"0 16px" }}>
              <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:16,fontWeight:700,color:"#000" }}>{isCredit?"إشعار دائن":"فاتورة ضريبية"}</div>
              <div style={{ fontSize:14,fontWeight:700,color:"#000",letterSpacing:2 }}>{isCredit?"Credit Note":"Tax Invoice"}</div>
            </div>
            <div style={{ flex:1 }} />
          </div>

          {/* Invoice info + QR */}
          <div style={{ display:"flex",gap:16,marginBottom:14 }}>
            <table style={{ flex:1,borderCollapse:"collapse",border:"none",fontSize:12 }}>
              <tbody>
                {[
                  ["Invoice Number",isCredit?"رقم إشعار الدائن :":"رقم الفاتورة :",inv.number],
                  ["Issue Date","تاريخ الإصدار :",<DateBoth dateStr={inv.issueDate} enSize={12} arSize={10} />],
                  ["Branch","الفرع :",(branchObj?.nameEn||inv.branch)+(branchObj?.nameAr?` / ${branchObj.nameAr}`:"")],
                  ["Status","الحالة :",inv.status==="paid"?"Paid / مدفوع":"Unpaid / غير مدفوع"],
                ].map(([en,ar,val])=>(
                  <tr key={en}>
                    <td style={{ border:"none",padding:"4px 8px 4px 0",fontWeight:700,color:"#000",minWidth:140 }}>{en}</td>
                    <td style={{ border:"none",padding:"4px 8px",color:"#000",fontWeight:600 }}>{val}</td>
                    <td style={{ border:"none",padding:"4px 0 4px 8px",fontFamily:"'Noto Naskh Arabic',serif",color:"#000",textAlign:"right",direction:"rtl",fontSize:13 }}>{ar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign:"center",flexShrink:0 }}>
              <div ref={qrRef} style={{ display:"none" }} />
              {qrDataUrl
                ? <img src={qrDataUrl} alt="ZATCA QR" width={110} height={110} style={{ border:"1px solid #ccc",padding:2 }}/>
                : <div style={{ width:110,height:110,border:"1px solid #ccc",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#999" }}>QR…</div>}
              <div style={{ fontSize:8,color:"#999",marginTop:2 }}>ZATCA QR</div>
            </div>
          </div>

          {/* Seller / Buyer bilingual grid */}
          <table className="inv-seller-box" style={{ width:"100%",borderCollapse:"collapse",marginBottom:14,border:"1px solid #ccc",fontSize:12 }}>
            <thead>
              <tr style={{ background:"#f0f0f0" }}>
                <th style={{ textAlign:"center",padding:"5px 8px",width:"50%",border:"1px solid #ccc" }}>
                  <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:13 }}>المورد</span> / Seller
                </th>
                <th style={{ textAlign:"center",padding:"5px 8px",width:"50%",border:"1px solid #ccc" }}>
                  <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:13 }}>العميل</span> / Buyer
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Name","الاسم :",company.companyEn||(company.companyAr||""),"الاسم :",inv.clientNameEn||(inv.clientNameAr||"")],
                ["Address","العنوان :",addr||"—","العنوان :",inv.clientAddress||"—"],
                ["VAT Number","الرقم الضريبي :",company.vatNumber||"—","الرقم الضريبي :",inv.clientVat||"—"],
              ].map(([label,arL,selVal,arR,buyVal])=>(
                <tr key={label}>
                  <td style={{ border:"1px solid #ccc",padding:"5px 8px" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <span style={{ fontWeight:700,color:"#000",minWidth:50 }}>{label}</span>
                      <span style={{ color:"#000",flex:1,textAlign:"center" }}>{selVal}</span>
                      <span style={{ fontFamily:"'Noto Naskh Arabic',serif",color:"#000",direction:"rtl",fontSize:12 }}>{arL}</span>
                    </div>
                  </td>
                  <td style={{ border:"1px solid #ccc",padding:"5px 8px" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <span style={{ fontWeight:700,color:"#000",minWidth:50 }}>{label}</span>
                      <span style={{ color:"#000",flex:1,textAlign:"center" }}>{buyVal}</span>
                      <span style={{ fontFamily:"'Noto Naskh Arabic',serif",color:"#000",direction:"rtl",fontSize:12 }}>{arR}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 8-Column ZATCA Items Table */}
          <table style={{ width:"100%",borderCollapse:"collapse",marginBottom:14,fontSize:10 }}>
            <thead>
              <tr style={{ background:"#f0f0f0" }}>
                {[
                  {en:"Nature of goods or services",ar:"تفاصيل السلع أو الخدمات",w:"22%"},
                  {en:"Unit price",ar:"سعر الوحدة",w:"9%"},
                  {en:"Quantity",ar:"الكمية",w:"7%"},
                  {en:"Taxable Amount",ar:"المبلغ الخاضع للضريبة",w:"12%"},
                  {en:"Discount",ar:"خصومات",w:"8%"},
                  {en:"Tax Rate",ar:"نسبة الضريبة",w:"8%"},
                  {en:"Tax Amount",ar:"مبلغ ضريبة",w:"9%"},
                  ...(!isCredit ? [{en:"Item Subtotal (Including VAT)",ar:"المجموع شاملة القيمة المضافة",w:"15%"}] : []),
                ].map((h,i)=>(
                  <th key={i} style={{ border:"1px solid #aaa",padding:"5px 4px",textAlign:"center",verticalAlign:"middle",width:h.w }}>
                    <div style={{ fontSize:9,fontWeight:700,color:"#000",lineHeight:1.3 }}>{h.en}</div>
                    <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:9,color:"#000",lineHeight:1.3,direction:"rtl" }}>{h.ar}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(inv.items||[]).map((it,i)=>{
                const base   = (it.qty||0)*(it.unitPrice||0);
                const disc   = 0;
                const taxable= base - disc;
                const vat    = +(taxable*(it.vatPct||15)/100).toFixed(2);
                const total  = +(taxable+vat).toFixed(2);
                return (
                  <tr key={i} style={{ background:i%2===0?"white":"#fafafa" }}>
                    <td style={{ border:"1px solid #ccc",padding:"6px 6px" }}>
                      <div style={{ fontSize:11,color:"#000",fontWeight:600 }}>{it.descEn}</div>
                      {it.descAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:11,color:"#333",direction:"rtl",marginTop:1 }}>{it.descAr}</div>}
                    </td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>{fmt(it.unitPrice)}</td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>{it.qty}</td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>{fmt(taxable)}</td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>0.00</td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>{it.vatPct||15}.00</td>
                    <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11 }}>{fmt(vat)}</td>
                    {!isCredit && <td style={{ border:"1px solid #ccc",padding:"6px 4px",textAlign:"center",fontSize:11,fontWeight:700 }}>{fmt(total)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Bilingual Totals */}
          <div style={{ display:"flex",justifyContent:"flex-end",marginBottom:14 }}>
            <table style={{ borderCollapse:"collapse",minWidth:400,fontSize:12 }}>
              <tbody>
                {[
                  ["Total (Excluding VAT)","الإجمالي (غير شاملة القيمة المضافة)",fmt(inv.subtotal)],
                  ["Discount","مجموع الخصومات","0.00"],
                  ["Total Taxable Amount (Excluding VAT)","الإجمالي الخاضع للضريبة",fmt(inv.subtotal)],
                  ["Total VAT","مجموع ضريبة القيمة المضافة",fmt(inv.vatTotal)],
                ].map(([en,ar,val])=>(
                  <tr key={en}>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontWeight:600,color:"#000",background:"#fafafa" }}>{en}</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",textAlign:"center",color:"#000",minWidth:80 }}>{val}</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl",color:"#000",fontSize:13,background:"#fafafa" }}>{ar}</td>
                  </tr>
                ))}
                {inv.creditAmount>0 && (
                  <tr>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontWeight:600,color:"#1E7A4A",background:"#f0fbf5" }}>Credit / ائتمان</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",textAlign:"center",color:"#1E7A4A" }}>− {fmt(inv.creditAmount)}</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl",color:"#1E7A4A",background:"#f0fbf5" }}>الائتمان</td>
                  </tr>
                )}
                <tr style={{ background:"#000" }}>
                  <td style={{ border:"1px solid #000",padding:"8px 10px",fontWeight:700,color:"white",fontSize:13 }}>Total Amount Due</td>
                  <td style={{ border:"1px solid #000",padding:"8px 10px",textAlign:"center",color:"white",fontWeight:700,fontSize:14 }}>{fmt(inv.grandTotal)}</td>
                  <td style={{ border:"1px solid #000",padding:"8px 10px",fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl",color:"white",fontWeight:700,fontSize:13 }}>إجمالي المبلغ المستحق</td>
                </tr>
                {inv.amountPaid>0 && <>
                  <tr style={{ background:"#E8F5EF" }}>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontWeight:600,color:"#1E7A4A" }}>Amount Received</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",textAlign:"center",color:"#1E7A4A",fontWeight:700 }}>{fmt(inv.amountPaid)}</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl",color:"#1E7A4A",background:"#E8F5EF" }}>المبلغ المستلم</td>
                  </tr>
                  <tr style={{ background:inv.grandTotal-inv.amountPaid<=0?"#E8F5EF":"#FDECEA" }}>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontWeight:700,color:inv.grandTotal-inv.amountPaid<=0?"#1E7A4A":"#B52E2E" }}>Balance Due</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",textAlign:"center",fontWeight:700,color:inv.grandTotal-inv.amountPaid<=0?"#1E7A4A":"#B52E2E" }}>{fmt(Math.max(0,inv.grandTotal-inv.amountPaid))}</td>
                    <td style={{ border:"1px solid #ccc",padding:"5px 10px",fontFamily:"'Noto Naskh Arabic',serif",direction:"rtl",color:inv.grandTotal-inv.amountPaid<=0?"#1E7A4A":"#B52E2E" }}>الرصيد المستحق</td>
                  </tr>
                </>}
              </tbody>
            </table>
          </div>

          {/* Amount in Arabic words */}
          {(() => {
            const toArabicWords = (n) => {
              if(!n||n<=0) return "صفر ريال سعودي";
              const ones=["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة","أحد عشر","اثنا عشر","ثلاثة عشر","أربعة عشر","خمسة عشر","ستة عشر","سبعة عشر","ثمانية عشر","تسعة عشر"];
              const tens=["","","عشرون","ثلاثون","أربعون","خمسون","ستون","سبعون","ثمانون","تسعون"];
              const hundreds=["","مائة","مئتان","ثلاثمائة","أربعمائة","خمسمائة","ستمائة","سبعمائة","ثمانمائة","تسعمائة"];
              const below1000=(num)=>{
                if(!num)return"";
                const parts=[];
                const h=Math.floor(num/100);
                if(h)parts.push(hundreds[h]);
                const r=num%100;
                if(r>=20)parts.push(tens[Math.floor(r/10)]+(r%10?" و"+ones[r%10]:""));
                else if(r)parts.push(ones[r]);
                return parts.join(" و");
              };
              const int=Math.floor(n), dec=Math.round((n-int)*100), parts=[];
              const mil=Math.floor(int/1000000);
              if(mil)parts.push(mil===1?"مليون":mil===2?"مليونان":mil<=10?below1000(mil)+" ملايين":below1000(mil)+" مليون");
              const thou=Math.floor((int%1000000)/1000);
              if(thou)parts.push(thou===1?"ألف":thou===2?"ألفان":thou<=10?below1000(thou)+" آلاف":thou<=99?below1000(thou)+" ألفًا":below1000(thou)+" ألف");
              const rem=int%1000;
              if(rem)parts.push(below1000(rem));
              let w=parts.join(" و")+" ريال سعودي";
              if(dec)w+=" و"+(dec<20?ones[dec]:tens[Math.floor(dec/10)]+(dec%10?" و"+ones[dec%10]:""))+" هللة";
              return "فقط "+w.trim()+" لا غير";
            };
            return (
              <div style={{ border:"1px solid #ccc",padding:"8px 14px",marginBottom:16,background:"#fafafa",textAlign:"center" }}>
                <span style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:14,fontWeight:700,color:"#000",direction:"rtl" }}>
                  {toArabicWords(inv.grandTotal)}
                </span>
              </div>
            );
          })()}

          {/* Notes */}
          {inv.notes && (
            <div style={{ border:"1px solid #ccc",padding:"8px 12px",marginBottom:8,background:"#f9f9f9",borderLeft:"3px solid #3A7FB5",fontSize:12 }}>
              <strong>Notes / ملاحظات: </strong>{inv.notes}
            </div>
          )}


          {/* Footer */}
          <div className="inv-footer" style={{ borderTop:"1px solid #ccc",paddingTop:8 }} />

        </>)}

      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   CLIENTS PAGE
═══════════════════════════════════════════════════════════ */
function ClientsPage({ clients, invoices, onSave, onDelete, onPreview, lang }) {
  const [modal, setModal]       = useState(false);
  const [editing, setEditing]   = useState(null);
  const [search, setSearch]     = useState("");
  const [delId, setDelId]       = useState(null);
  const [selected, setSelected] = useState(null);
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo,   setLedgerTo]   = useState("");
  const t=(en,ar)=>lang==="ar"?ar:en;

  // ── Listen for native menu "Add New Client" command ───────────────────────
  useEffect(()=>{
    const handler = () => openModal();
    window.addEventListener('aqsa-menu-add-client', handler);
    return () => window.removeEventListener('aqsa-menu-add-client', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [form, setForm] = useState({ nameEn:"",nameAr:"",vat:"",phone:"",email:"",address:"" });
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));

  const openModal = (c=null) => { setEditing(c); setForm(c||{nameEn:"",nameAr:"",vat:"",phone:"",email:"",address:""}); setModal(true); };
  const save = () => { if(!form.nameEn.trim())return; onSave({...(editing||{}),id:editing?.id||uid(),...form}); setModal(false); };

  const filtered = clients.filter(c=>!search||(c.nameEn||"").toLowerCase().includes(search.toLowerCase())||(c.nameAr||"").includes(search));

  /* ── Client-invoice matching helper ─────────────────────────────────────
     Priority order — strict, stops at first decisive match:
       1. inv.linkedClientId — hard ID link set on save (most reliable)
       2. inv.clientSelect   — legacy field name for the same ID link
       3. clientVat          — only when BOTH sides are non-empty
       4. clientNameEn       — ONLY used for truly old invoices that have
                               no ID link AND no VAT on either side. Exact
                               case-sensitive match required.
     Guards against "" === "" on VAT, and against name collisions when a
     client is selected from the dropdown (which now always sets linkedClientId).
  */
  const invBelongsToClient = (inv, c) => {
    // ── Priority 1: linkedClientId is the single source of truth ──────────
    // If the invoice has a hard ID link, ONLY that link is authoritative.
    // We must NOT also check clientSelect / VAT / name — doing so causes
    // invoices to appear in multiple clients' ledgers.
    if (inv.linkedClientId) return inv.linkedClientId === c.id;

    // ── Priority 2: legacy clientSelect field ─────────────────────────────
    // Old invoices saved before the linkedClientId field existed may still
    // carry only clientSelect. Only use it when linkedClientId is absent.
    if (inv.clientSelect && inv.clientSelect.trim())
      return inv.clientSelect === c.id;

    // ── Priority 3: name + address match ─────────────────────────────────
    // Match by client name (case-insensitive). If both sides also have an
    // address, the address must match too — prevents false positives when
    // two clients share the same name but are at different locations.
    if (inv.clientNameEn?.trim() && c.nameEn?.trim()) {
      const nameMatch = inv.clientNameEn.trim().toLowerCase() === c.nameEn.trim().toLowerCase();
      if (nameMatch) {
        const invAddr = inv.clientAddress?.trim().toLowerCase();
        const cAddr   = c.address?.trim().toLowerCase();
        if (!invAddr || !cAddr) return true;       // address missing on one side — name alone sufficient
        return invAddr === cAddr;
      }
    }

    // ── Priority 4: Arabic name fallback ─────────────────────────────────
    if (inv.clientNameAr?.trim() && c.nameAr?.trim())
      return inv.clientNameAr.trim() === c.nameAr.trim();

    return false;
  };

  // Regular invoices only (for total billed calculation)
  const clientInvoices = (c) => (invoices||[]).filter(inv=>
    invBelongsToClient(inv, c)
    && inv.type !== "credit"
    && inv.type !== "receipt"   // receipts already in invoice.amountPaid
  ).sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));

  // ALL transactions for ledger display (invoices + credits + receipts)
  const clientAllTransactions = (c) => (invoices||[]).filter(inv=>
    invBelongsToClient(inv, c)
    // include all types: regular invoices, credit invoices, and receipt vouchers
  ).sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));

  const clientStats = (c) => {
    const invs    = clientInvoices(c);
    const credits = (invoices||[]).filter(inv=>
      invBelongsToClient(inv, c)
      && inv.type === "credit"
    );
    const receipts = (invoices||[]).filter(inv=>
      invBelongsToClient(inv, c)
      && inv.type === "receipt"
    );
    const total       = invs.reduce((s,i)=>s+i.grandTotal, 0);
    const creditTotal = credits.reduce((s,i)=>s+(i.grandTotal||0), 0);
    const receiptTotal= receipts.reduce((s,i)=>s+(i.grandTotal||i.amountPaid||0), 0);
    // BUG FIX: avoid double-counting payments.
    // When a Receipt Voucher is saved it BOTH updates inv.amountPaid AND creates a
    // standalone receipt record. Summing both counts the same money twice.
    // Solution: for any invoice that has a linked standalone receipt record,
    // trust the receipt records (receiptTotal) and ignore amountPaid on the invoice.
    const invoicesWithReceipts = new Set(receipts.map(r=>r.linkedInvId).filter(Boolean));
    const paidOnInv   = invs.reduce((s,i)=>
      s + (invoicesWithReceipts.has(i.id) ? 0 : (i.amountPaid||0)), 0);
    const received    = paidOnInv + creditTotal + receiptTotal;
    const balanceDue  = Math.max(0, total - received);
    return { count:invs.length, total, received, balanceDue, creditTotal, receiptTotal };
  };

  const ledgerInvsAll = selected ? clientAllTransactions(selected) : [];
  const ledgerInvs    = ledgerInvsAll.filter(inv=>
    (!ledgerFrom || (inv.issueDate||"") >= ledgerFrom) &&
    (!ledgerTo   || (inv.issueDate||"") <= ledgerTo)
  );
  const ledgerStats  = selected ? clientStats(selected) : {};

  // Filtered-range stats (for the date range print)
  const rangeStats = {
    total:    ledgerInvs.filter(i=>!i.type||i.type==="").reduce((s,i)=>s+i.grandTotal, 0),
    received: (()=>{
      // BUG FIX: same double-count guard as clientStats.
      const rangeReceipts = ledgerInvs.filter(i=>i.type==="receipt");
      const rangeCredits  = ledgerInvs.filter(i=>i.type==="credit");
      const rangeInvIds   = new Set(rangeReceipts.map(r=>r.linkedInvId).filter(Boolean));
      const paidOnRangeInv = ledgerInvs
        .filter(i=>!i.type||i.type==="")
        .reduce((s,i)=>s+(rangeInvIds.has(i.id)?0:(i.amountPaid||0)), 0);
      return paidOnRangeInv
           + rangeCredits.reduce((s,i)=>s+(i.grandTotal||0), 0)
           + rangeReceipts.reduce((s,i)=>s+(i.grandTotal||i.amountPaid||0), 0);
    })(),
    get balanceDue(){ return Math.max(0,this.total-this.received); }
  };

  // Avatar color palette
  const avatarColors = ["#3A7FB5","#2E9E6B","#D97B00","#8B5CF6","#D94040","#0891B2"];
  const avatarColor  = (c) => avatarColors[(c.nameEn||"A").charCodeAt(0)%avatarColors.length];

  return (
    <div className="fade-up" style={css.col(20)}>
      {/* ── Header ── */}
      <div style={css.flex(0,"center","space-between")}>
        <div>
          <h1 style={css.h1}>{t("Clients","العملاء")}</h1>
          <p style={{ ...css.small,marginTop:4,color:T.gray500 }}>
            {filtered.length} {t("client","عميل")}{filtered.length!==1&&lang!=="ar"?"s":""} · {(invoices||[]).length} {t("total invoices","فاتورة إجمالية")}
          </p>
        </div>
        <button style={css.btnPrimary} onClick={()=>openModal()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          {t("Add Client","إضافة عميل")}
        </button>
      </div>

      {/* ── Search ── */}
      <div style={{ position:"relative",maxWidth:360 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.gray300} strokeWidth="2"
          style={{ position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",pointerEvents:"none" }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <Input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder={t("Search clients…","بحث في العملاء…")} style={{...css.input,paddingLeft:34}} />
      </div>

      {/* ── Two-panel layout ── */}
      <div style={{ display:"grid",gridTemplateColumns:selected?"360px 1fr":"1fr",gap:20,alignItems:"start" }}>

        {/* ── CLIENT LIST ── */}
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {!filtered.length && (
            <div style={{ textAlign:"center",padding:"3rem",color:T.gray300 }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{marginBottom:10}}>
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
              </svg>
              <div style={{fontSize:".85rem"}}>No clients found</div>
            </div>
          )}

          {filtered.map(c=>{
            const stats    = clientStats(c);
            const isSel    = selected?.id===c.id;
            const color    = avatarColor(c);
            return (
              <div key={c.id} onClick={()=>setSelected(isSel?null:c)}
                style={{ background:"white",borderRadius:12,border:`1.5px solid ${isSel?T.blue:T.gray100}`,
                  padding:"14px 16px",cursor:"pointer",transition:"all .15s",
                  boxShadow:isSel?`0 0 0 3px ${T.blue}22,0 4px 16px rgba(91,164,207,.15)`:"0 1px 4px rgba(0,0,0,.05)" }}
                onMouseEnter={e=>{ if(!isSel){e.currentTarget.style.borderColor=T.blueLight;e.currentTarget.style.boxShadow=`0 4px 16px rgba(91,164,207,.12)`;} }}
                onMouseLeave={e=>{ if(!isSel){e.currentTarget.style.borderColor=T.gray100;e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.05)";} }}>

                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  {/* Avatar */}
                  <div style={{ width:42,height:42,borderRadius:12,flexShrink:0,
                    background:isSel?color:`${color}18`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:"1rem",fontWeight:800,color:isSel?"white":color,
                    transition:"all .15s" }}>
                    {(c.nameEn||"?")[0].toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontWeight:700,color:T.ink,fontSize:".88rem",
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.nameEn}</div>
                    {c.nameAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:".72rem",
                      color:T.gray500,direction:"rtl",marginTop:1 }}>{c.nameAr}</div>}
                    <div style={{ display:"flex",gap:8,marginTop:3,flexWrap:"wrap" }}>
                      {c.vat   && <span style={{ fontSize:".65rem",color:T.gray400,background:T.gray50,padding:"1px 6px",borderRadius:4 }}>VAT {c.vat.slice(0,8)}…</span>}
                      {c.phone && <span style={{ fontSize:".65rem",color:T.gray400 }}>📞 {c.phone}</span>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display:"flex",gap:3,flexShrink:0 }} onClick={e=>e.stopPropagation()}>
                    <button style={css.iconBtn} title="Edit" onClick={()=>openModal(c)}
                      onMouseEnter={e=>{e.currentTarget.style.background=T.bluePale;e.currentTarget.style.color=T.blue}}
                      onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=T.gray500}}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button style={{ ...css.iconBtn,color:T.danger }} title="Delete" onClick={()=>setDelId(c.id)}
                      onMouseEnter={e=>e.currentTarget.style.background="#FDECEA"}
                      onMouseLeave={e=>e.currentTarget.style.background="none"}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                    </button>
                  </div>
                </div>

                {/* Stats bar */}
                {stats.count>0 ? (
                  <div style={{ marginTop:12,paddingTop:10,borderTop:`1px solid ${isSel?T.blueLight:T.gray100}`,
                    display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,textAlign:"center" }}>
                    {[
                      ["Invoices", stats.count, T.ink],
                      ["Received", `SAR ${fmt(stats.received)}`, T.success],
                      ["Balance Due", `SAR ${fmt(stats.balanceDue)}`, stats.balanceDue>0?T.danger:T.gray300],
                    ].map(([label,val,col])=>(
                      <div key={label}>
                        <div style={{ fontSize:".58rem",textTransform:"uppercase",letterSpacing:".1em",color:T.gray400,marginBottom:2 }}>{label}</div>
                        <div style={{ fontSize:".78rem",fontWeight:700,color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop:8,fontSize:".7rem",color:T.gray300,fontStyle:"italic" }}>No invoices yet — click to view</div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── LEDGER PANEL ── */}
        {selected && (
          <div style={css.col(14)}>
            {/* Client header card */}
            <div style={{ background:`linear-gradient(135deg,${T.blueDark},${T.blue})`,borderRadius:14,padding:"20px 24px",color:"white" }}>
              <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16 }}>
                <div style={{ display:"flex",gap:14,alignItems:"center" }}>
                  <div style={{ width:52,height:52,borderRadius:14,background:"rgba(255,255,255,.2)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:"1.4rem",fontWeight:800,color:"white",flexShrink:0 }}>
                    {(selected.nameEn||"?")[0].toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize:"1.1rem",fontWeight:700 }}>{selected.nameEn}</div>
                    {selected.nameAr && <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:".85rem",color:"rgba(255,255,255,.75)",direction:"rtl",marginTop:2 }}>{selected.nameAr}</div>}
                    <div style={{ display:"flex",gap:12,marginTop:5,flexWrap:"wrap" }}>
                      {selected.vat   && <span style={{ fontSize:".7rem",color:"rgba(255,255,255,.75)" }}>VAT: {selected.vat}</span>}
                      {selected.phone && <span style={{ fontSize:".7rem",color:"rgba(255,255,255,.75)" }}>📞 {selected.phone}</span>}
                      {selected.email && <span style={{ fontSize:".7rem",color:"rgba(255,255,255,.75)" }}>✉ {selected.email}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={()=>setSelected(null)} style={{ ...css.iconBtn,color:"rgba(255,255,255,.7)" }}
                  onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.15)"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>

              {/* Stat pills */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10 }}>
                {[
                  ["Total Billed",   `SAR ${fmt(ledgerStats.total)}`,       "rgba(255,255,255,.9)","rgba(255,255,255,.12)"],
                  ["Received",       `SAR ${fmt(ledgerStats.received)}`,    "#6EFFC7","rgba(46,158,107,.25)"],
                  ["Credits Applied",`SAR ${fmt(ledgerStats.creditTotal||0)}`,"#FFB3B3","rgba(217,64,64,.2)"],
                  ["Balance Due",    `SAR ${fmt(ledgerStats.balanceDue)}`,  ledgerStats.balanceDue>0?"#FFB3B3":"#6EFFC7",ledgerStats.balanceDue>0?"rgba(217,64,64,.25)":"rgba(46,158,107,.25)"],
                ].map(([label,val,col,bg])=>(
                  <div key={label} style={{ background:bg,borderRadius:10,padding:"10px 12px" }}>
                    <div style={{ fontSize:".6rem",textTransform:"uppercase",letterSpacing:".12em",color:"rgba(255,255,255,.6)",marginBottom:4 }}>{label}</div>
                    <div style={{ fontSize:".85rem",fontWeight:700,color:col }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transaction table */}
            <div style={{ background:"white",borderRadius:14,border:`1px solid ${T.gray100}`,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,.04)" }}>
              <div style={{ padding:"12px 20px 8px",borderBottom:`1px solid ${T.gray100}` }}>
                {/* Header row */}
                <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                    <div style={{ fontWeight:700,color:T.ink,fontSize:".9rem" }}>Transaction History</div>
                    <span style={{ fontSize:".72rem",color:T.gray400,background:T.gray50,padding:"3px 10px",borderRadius:20,border:`1px solid ${T.gray100}` }}>
                      {ledgerInvs.length} record{ledgerInvs.length!==1?"s":""}
                      {(ledgerFrom||ledgerTo) && <span style={{color:T.blue}}> (filtered)</span>}
                    </span>
                  </div>
                  <button style={{ ...css.btnSecondary,fontSize:".72rem",padding:".35rem .85rem",gap:6 }}
                    onClick={()=>{
                      const rows = ledgerInvs.map(inv=>`
                        <tr style="border-bottom:1px solid #eee">
                          <td style="padding:6px 10px;font-family:monospace;color:#3A7FB5">${inv.number}</td>
                          <td style="padding:6px 10px">${inv.issueDate ? `<span style="display:inline-flex;flex-direction:column;line-height:1.4"><span>${fmtDate(inv.issueDate)}</span><span style="font-family:serif;font-size:10px;direction:rtl;color:#666">${fmtHijri(inv.issueDate)}</span></span>` : ""}</td>
                          <td style="padding:6px 10px;text-align:right;font-weight:700">SAR ${fmt(inv.grandTotal)}</td>
                          <td style="padding:6px 10px;text-align:right;color:#2E9E6B">SAR ${fmt(inv.amountPaid||0)}</td>
                          <td style="padding:6px 10px;text-align:right;color:${inv.grandTotal-(inv.amountPaid||0)>0?"#D94040":"#2E9E6B"}">SAR ${fmt(Math.max(0,inv.grandTotal-(inv.amountPaid||0)))}</td>
                          <td style="padding:6px 10px;text-transform:capitalize">${inv.status||""}</td>
                        </tr>`).join("");
                      const w=window.open("","_blank");
                      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
                        <title>Statement — ${selected?.nameEn||""}</title>
                        <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11pt;padding:18px}
                        table{border-collapse:collapse;width:100%}th{background:#1A2332;color:white;padding:8px 10px;text-align:left}
                        @page{size:A4 landscape;margin:10mm}</style></head><body>
                        <div style="margin-bottom:16px">
                          <div style="font-size:18pt;font-weight:700">${selected?.nameEn||""} — Account Statement</div>
                          ${selected?.nameAr?`<div style="font-family:serif;font-size:14pt;direction:rtl;margin-top:2px">${selected.nameAr}</div>`:""}
                          ${(ledgerFrom||ledgerTo)?`<div style="font-size:10pt;color:#555;margin-top:6px">Period: ${ledgerFrom||"All"} → ${ledgerTo||"Today"}</div>`:""}
                          <div style="font-size:10pt;color:#555;margin-top:2px">Printed: ${new Date().toLocaleDateString()}</div>
                        </div>
                        <table><thead><tr>
                          <th>Invoice #</th><th>Date</th>
                          <th style="text-align:right">Total (SAR)</th>
                          <th style="text-align:right">Received (SAR)</th>
                          <th style="text-align:right">Balance (SAR)</th>
                          <th>Status</th>
                        </tr></thead><tbody>${rows}</tbody>
                        <tfoot><tr style="background:#f5f5f5;font-weight:700;border-top:2px solid #333">
                          <td colspan="2" style="padding:8px 10px">TOTAL — ${ledgerInvs.length} records</td>
                          <td style="padding:8px 10px;text-align:right">SAR ${fmt(rangeStats.total)}</td>
                          <td style="padding:8px 10px;text-align:right;color:#2E9E6B">SAR ${fmt(rangeStats.received)}</td>
                          <td style="padding:8px 10px;text-align:right;color:${rangeStats.balanceDue>0?"#D94040":"#2E9E6B"}">SAR ${fmt(rangeStats.balanceDue)}</td>
                          <td></td>
                        </tr></tfoot></table>
                        <script>window.onload=function(){setTimeout(function(){window.print();window.close();},500);};<\/script>
                      </body></html>`);
                      w.document.close();
                    }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                    Print Statement
                  </button>
                </div>
                {/* Date range filter */}
                <div style={{ display:"flex",alignItems:"center",gap:8,padding:"7px 10px",background:T.bluePale,borderRadius:7,border:`1px solid ${T.blueLight}` }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.blue} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  <span style={{ fontSize:".65rem",fontWeight:700,color:T.blue,whiteSpace:"nowrap" }}>Date Range</span>
                  <Input type="date" value={ledgerFrom} onChange={e=>setLedgerFrom(e.target.value)} style={{ ...css.input,fontSize:".7rem",maxWidth:135,padding:".28rem .5rem" }} />
                  <span style={{ fontSize:".65rem",color:T.gray400 }}>→</span>
                  <Input type="date" value={ledgerTo}   onChange={e=>setLedgerTo(e.target.value)}   style={{ ...css.input,fontSize:".7rem",maxWidth:135,padding:".28rem .5rem" }} />
                  {(ledgerFrom||ledgerTo) && (
                    <button onClick={()=>{setLedgerFrom("");setLedgerTo("");}}
                      style={{ ...css.btnSecondary,fontSize:".62rem",padding:".22rem .6rem",color:T.danger,borderColor:T.danger }}>
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {ledgerInvs.length===0 ? (
                <div style={{ textAlign:"center",padding:"3rem",color:T.gray300 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{marginBottom:8}}>
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  </svg>
                  <div style={{fontSize:".83rem"}}>No invoices yet</div>
                </div>
              ) : (
                <>
                  {/* Table head */}
                  <div style={{ display:"grid",gridTemplateColumns:"60px 1fr 86px 110px 80px 72px 32px",
                    gap:8,padding:"8px 20px",background:T.gray50,borderBottom:`1px solid ${T.gray100}` }}>
                    {["Type","Invoice","Date","Amount","Status","Branch",""].map((h,i)=>(
                      <div key={i} style={{ fontSize:".62rem",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:T.gray500 }}>{h}</div>
                    ))}
                  </div>

                  {/* Rows */}
                  <div>
                    {ledgerInvs.map((inv,idx)=>{
                      const isCredit  = inv.type === "credit";
                      const isReceipt = inv.type === "receipt";
                      const rowBg     = isCredit ? "#FFF5F5" : isReceipt ? "#F0FFF7" : idx%2===0 ? "white" : T.gray50;
                      const rowBorder = isCredit ? `3px solid ${T.danger}` : isReceipt ? `3px solid ${T.success}` : "3px solid transparent";
                      const hoverBg   = isCredit ? "#FFE8E8" : isReceipt ? "#D8F7EA" : T.bluePale;
                      return (
                      <div key={inv.id}
                        style={{ display:"grid",gridTemplateColumns:"60px 1fr 86px 110px 80px 72px 32px",
                          gap:8,padding:"11px 20px",alignItems:"center",
                          background:rowBg,borderBottom:`1px solid ${T.gray100}`,
                          transition:"background .1s",borderLeft:rowBorder }}
                        onMouseEnter={e=>e.currentTarget.style.background=hoverBg}
                        onMouseLeave={e=>e.currentTarget.style.background=rowBg}>

                        {/* Type badge column */}
                        <div>
                          {isCredit && (
                            <span style={{ fontSize:".58rem",padding:"2px 6px",borderRadius:6,
                              background:"#FFF0F0",color:T.danger,border:`1px solid #F5C0C0`,fontWeight:700,whiteSpace:"nowrap" }}>CREDIT</span>
                          )}
                          {isReceipt && (
                            <span style={{ fontSize:".58rem",padding:"2px 6px",borderRadius:6,
                              background:"#E8F5EF",color:T.success,border:`1px solid #A8DBC0`,fontWeight:700,whiteSpace:"nowrap" }}>RECEIPT</span>
                          )}
                          {!isCredit && !isReceipt && (
                            <span style={{ fontSize:".58rem",padding:"2px 6px",borderRadius:6,
                              background:T.bluePale,color:T.blueDark,border:`1px solid ${T.blueLight}`,fontWeight:700,whiteSpace:"nowrap" }}>INVOICE</span>
                          )}
                        </div>

                        <div>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <span style={{ fontWeight:700,fontSize:".82rem",fontFamily:"monospace",
                              color:isCredit?T.danger:isReceipt?T.success:T.blue }}>{inv.number}</span>
                          </div>
                          {isCredit  && <div style={{ fontSize:".62rem",color:T.danger,marginTop:2,fontWeight:600 }}>↩ Ref: {inv.originalInvNumber||"—"}</div>}
                          {isReceipt && <div style={{ fontSize:".62rem",color:T.success,marginTop:2,fontWeight:600 }}>✓ Payment received</div>}
                          {!isCredit && !isReceipt && inv.originalInvNumber && <div style={{ fontSize:".62rem",color:T.gray400 }}>↩ {inv.originalInvNumber}</div>}
                        </div>

                        <div style={{ fontSize:".75rem",color:T.gray500 }}><DateBoth dateStr={inv.issueDate} enSize={12} arSize={10} color={T.gray500} /></div>

                        <div style={{ fontWeight:700,fontSize:".82rem" }}>
                          {isCredit
                            ? <span style={{ color:T.danger }}>− SAR {fmt(inv.grandTotal)}</span>
                            : isReceipt
                              ? <span style={{ color:T.success }}>+ SAR {fmt(inv.grandTotal||inv.amountPaid||0)}</span>
                              : <span style={{ color:T.ink }}>SAR {fmt(inv.grandTotal)}</span>}
                        </div>

                        <div>
                          {isCredit
                            ? <span style={{ fontSize:".65rem",padding:"2px 7px",borderRadius:8,background:"#FFF0F0",color:T.danger,border:`1px solid #F5C0C0`,fontWeight:600 }}>Credit</span>
                            : isReceipt
                              ? <span style={{ fontSize:".65rem",padding:"2px 7px",borderRadius:8,background:"#E8F5EF",color:T.success,border:`1px solid #A8DBC0`,fontWeight:600 }}>Received</span>
                              : <Badge type={inv.status}>{inv.status}</Badge>}
                        </div>

                        <div><Badge type={inv.branch}>{inv.branch==="makkah"?"MK":"MD"}</Badge></div>

                        <div>
                          {onPreview && (
                            <button style={css.iconBtn} onClick={()=>onPreview(inv.id)} title="View"
                              onMouseEnter={e=>{e.currentTarget.style.background=T.bluePale;e.currentTarget.style.color=T.blue}}
                              onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=T.gray500}}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      );
                    })}
                  </div>

                  {/* Ledger footer */}
                  <div style={{ display:"grid",gridTemplateColumns:"60px 1fr 86px 110px 80px 72px 32px",
                    gap:8,padding:"12px 20px",background:T.gray50,borderTop:`2px solid ${T.gray100}` }}>
                    <div style={{ fontSize:".7rem",fontWeight:700,color:T.gray500,textTransform:"uppercase",letterSpacing:".08em",gridColumn:"1/3",display:"flex",alignItems:"center" }}>Net Balance</div>
                    <div>
                      <div style={{ fontWeight:800,fontSize:".88rem",color:T.ink }}>SAR {fmt(ledgerStats.total)}</div>
                      <div style={{ fontSize:".6rem",color:T.gray400,marginTop:1 }}>total billed</div>
                    </div>
                    <div style={{ gridColumn:"4/7" }}>
                      <div style={{ fontSize:".65rem",color:T.success,fontWeight:600 }}>✓ Receipts: SAR {fmt(ledgerStats.receiptTotal||0)}</div>
                      <div style={{ fontSize:".65rem",color:T.danger,fontWeight:600 }}>− Credits: SAR {fmt(ledgerStats.creditTotal||0)}</div>
                      <div style={{ fontSize:".65rem",color:T.success,fontWeight:700,marginTop:2 }}>✓ Total Received: SAR {fmt(ledgerStats.received)}</div>
                      <div style={{ fontSize:".65rem",color:ledgerStats.balanceDue>0?T.danger:T.success,fontWeight:700 }}>
                        {ledgerStats.balanceDue>0 ? `✗ Balance Due: SAR ${fmt(ledgerStats.balanceDue)}` : "✓ Fully Settled"}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal open={modal} onClose={()=>setModal(false)} title={editing?"Edit Client":"Add Client"}
        footer={<>
          <button style={css.btnSecondary} onClick={()=>setModal(false)}>Cancel</button>
          <button style={css.btnPrimary} onClick={save}>Save Client</button>
        </>}>
        <div style={css.col(14)}>
          <div style={css.grid("1fr 1fr",12)}>
            <FormGroup label="Name (EN)"><Input value={form.nameEn} onChange={e=>setF("nameEn",e.target.value)} placeholder="Company name" /></FormGroup>
            <FormGroup label="الاسم (AR)"><Input value={form.nameAr} onChange={e=>setF("nameAr",e.target.value)} dir="rtl" style={{...css.input,fontFamily:"'Noto Naskh Arabic',serif"}} /></FormGroup>
            <FormGroup label="VAT Number"><Input value={form.vat} onChange={e=>setF("vat",e.target.value)} placeholder="3XXXXXXXXXXXXXXXXXXX" /></FormGroup>
            <FormGroup label="Phone"><Input value={form.phone} onChange={e=>setF("phone",e.target.value)} placeholder="+966…" /></FormGroup>
            <FormGroup label="Email"><Input type="email" value={form.email} onChange={e=>setF("email",e.target.value)} /></FormGroup>
            <FormGroup label="Address"><Input value={form.address} onChange={e=>setF("address",e.target.value)} /></FormGroup>
          </div>
        </div>
      </Modal>

      <Confirm open={!!delId} title="Delete Client" msg="Delete this client? Their invoices will remain." onClose={()=>setDelId(null)} onOk={()=>{onDelete(delId);if(selected?.id===delId)setSelected(null);setDelId(null);}} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   REPORTS PAGE
═══════════════════════════════════════════════════════════ */
function ReportsPage({ invoices, onExport, lang }) {
  const [period, setPeriod] = useState("month");
  const [branch, setBranch] = useState("all");
  const t=(en,ar)=>lang==="ar"?ar:en;
  const now = new Date();

  let filtered = invoices;
  if (branch!=="all") filtered=filtered.filter(i=>i.branch===branch);
  if (period==="month") {
    const k=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    filtered=filtered.filter(i=>i.issueDate?.startsWith(k));
  } else if (period==="quarter") {
    const q=Math.floor(now.getMonth()/3);
    filtered=filtered.filter(i=>{if(!i.issueDate)return false;const d=new Date(i.issueDate);return d.getFullYear()===now.getFullYear()&&Math.floor(d.getMonth()/3)===q;});
  } else if (period==="year") {
    filtered=filtered.filter(i=>i.issueDate?.startsWith(now.getFullYear()+""));
  }

  const rev=filtered.reduce((s,i)=>s+i.grandTotal,0);
  const vat=filtered.reduce((s,i)=>s+i.vatTotal,0);
  const mk =invoices.filter(i=>i.branch==="makkah").reduce((s,i)=>s+i.grandTotal,0);
  const md =invoices.filter(i=>i.branch==="madinah").reduce((s,i)=>s+i.grandTotal,0);
  const total=mk+md||1;

  const months=[]; const revData=[];
  for(let i=5;i>=0;i--){
    const d=new Date(); d.setMonth(d.getMonth()-i);
    const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    months.push(d.toLocaleString("default",{month:"short"}));
    revData.push(invoices.filter(inv=>inv.issueDate?.startsWith(k)&&(branch==="all"||inv.branch===branch)).reduce((s,i)=>s+i.grandTotal,0));
  }
  const maxRev=Math.max(...revData,1);

  return (
    <div className="fade-up" style={css.col(24)}>
      <div style={css.flex(0,"center","space-between")}>
        <div>
          <h1 style={css.h1}>{t("Reports","التقارير")}</h1>
          <p style={{ ...css.small,marginTop:4 }}>{t("Financial analytics","التحليلات المالية")}</p>
        </div>
        <button style={css.btnSecondary} onClick={onExport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          {t("Export Excel","تصدير Excel")}
        </button>
      </div>

      <div style={css.flex(12)}>
        <Select value={period} onChange={e=>setPeriod(e.target.value)} style={{...css.input,maxWidth:180}}>
          <option value="month">{t("This Month","هذا الشهر")}</option>
          <option value="quarter">{t("This Quarter","هذا الربع")}</option>
          <option value="year">{t("This Year","هذه السنة")}</option>
          <option value="all">{t("All Time","كل الوقت")}</option>
        </Select>
        <Select value={branch} onChange={e=>setBranch(e.target.value)} style={{...css.input,maxWidth:180}}>
          <option value="all">{t("All Branches","كل الفروع")}</option>
          <option value="makkah">{t("Makkah","مكة")}</option>
          <option value="madinah">{t("Madinah","المدينة")}</option>
        </Select>
      </div>

      <div style={css.grid("repeat(3,1fr)",16)}>
        {[
          [t("Period Revenue","إيرادات الفترة"),<><span style={{fontSize:".9rem",color:T.blue}}>SAR </span>{fmt(rev)}</>],
          [t("VAT Collected","الضريبة المحصلة"),<><span style={{fontSize:".9rem",color:T.gray500}}>SAR </span>{fmt(vat)}</>],
          [t("Invoices Issued","فواتير صادرة"),filtered.length],
        ].map(([l,v])=>(
          <div key={l} style={css.card}>
            <div style={css.label}>{l}</div>
            <div style={{ fontFamily:"'DM Serif Display',serif",fontSize:"1.7rem",color:T.ink,marginTop:10,lineHeight:1 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={css.grid("2fr 1fr",16)}>
        <div style={css.card}>
          <SectionHead en="Revenue by Month" ar="الإيرادات الشهرية" />
          <div style={{ display:"flex",alignItems:"flex-end",gap:10,height:180,paddingBottom:8 }}>
            {months.map((m,i)=>(
              <div key={m} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:6 }}>
                <div style={{ width:"100%",borderRadius:"4px 4px 0 0",
                  height:Math.max(4,(revData[i]/maxRev)*160),
                  background:`linear-gradient(180deg,${T.blueLight},${T.blue})`,transition:"height .4s ease" }} />
                <span style={{ fontSize:".65rem",color:T.gray500 }}>{m}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={css.card}>
          <SectionHead en="Branch Split" ar="توزيع الفروع" />
          <div style={css.col(16)}>
            {[{label:t("Makkah","مكة"),val:mk,color:T.blue},{label:t("Madinah","المدينة"),val:md,color:T.blueLight}].map(b=>(
              <div key={b.label}>
                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                  <span style={css.body}>{b.label}</span>
                  <span style={{ fontWeight:700,color:T.ink,fontSize:".875rem" }}>SAR {fmt(b.val)}</span>
                </div>
                <div style={{ height:8,background:T.gray100,borderRadius:4,overflow:"hidden" }}>
                  <div style={{ height:"100%",borderRadius:4,background:b.color,width:`${(b.val/total)*100}%`,transition:"width .5s ease" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   SETTINGS PAGE
═══════════════════════════════════════════════════════════ */
function SettingsPage({ settings, users, invoices, clients, onSaveSettings, onSaveUser, onDeleteUser, currentUser, onExportBackup, onImportBackup, lang }) {
  const [tab, setTab] = useState("company");
  const [form, setForm] = useState({ companyEn:"",companyAr:"",vatNumber:"",crNumber:"",makkahAddress:"",madinahAddress:"",logoDataUrl:"", ...settings });
  const setF = (k,v) => setForm(f=>({...f,[k]:v}));
  const t=(en,ar)=>lang==="ar"?ar:en;

  // Branches state — seeded from settings or defaults
  const defaultBranches = [
    { id:"makkah", nameEn:"Makkah", nameAr:"مكة المكرمة", address: settings?.makkahAddress||"", city:"Makkah" },
    { id:"madinah",nameEn:"Madinah",nameAr:"المدينة المنورة",address:settings?.madinahAddress||"",city:"Madinah"},
  ];
  const [branches, setBranches] = useState(()=>{
    try { return JSON.parse(settings?.branches||"null") || defaultBranches; } catch { return defaultBranches; }
  });
  const setBranch = (idx,k,v) => setBranches(b=>b.map((br,i)=>i===idx?{...br,[k]:v}:br));
  const addBranch  = () => setBranches(b=>[...b,{id:uid(),nameEn:"",nameAr:"",address:"",city:""}]);
  const delBranch  = idx => setBranches(b=>b.filter((_,i)=>i!==idx));
  const saveBranches = () => {
    const updated = {...form, branches:JSON.stringify(branches),
      makkahAddress: branches.find(b=>b.id==="makkah")?.address||form.makkahAddress,
      madinahAddress:branches.find(b=>b.id==="madinah")?.address||form.madinahAddress,
    };
    onSaveSettings(updated);
  };

  const [userModal, setUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [uForm, setUForm] = useState({ name:"",email:"",password:"",role:"staff",branch:"makkah" });
  const setU = (k,v) => setUForm(f=>({...f,[k]:v}));
  const [delUserId, setDelUserId] = useState(null);

  useEffect(()=>{ setForm(f=>({...f,...settings})); },[settings]);

  const openUserModal = u => { setEditingUser(u||null); setUForm(u?{...u,password:""}:{name:"",email:"",password:"",role:"staff",branch:"makkah",permissions:{createInvoice:true,viewReports:false,manageClients:true,accessSettings:false,deleteInvoice:false,exportData:false,markPaid:false,issueCreditInv:false}}); setUserModal(true); };

  const tabs = [
    { id:"company",  label:t("Company","الشركة") },
    { id:"branches", label:t("Branches","الفروع") },
    { id:"invoice",  label:t("Invoice","الفاتورة") },
    { id:"users",    label:t("Users","المستخدمون") },
    { id:"backup",   label:t("Backup","النسخ الاحتياطي") },
  ];

  return (
    <div className="fade-up" style={css.col(20)}>
      <h1 style={css.h1}>{t("Settings","الإعدادات")}</h1>

      <div style={css.grid("200px 1fr",20)}>
        {/* Tab nav */}
        <div style={css.col(4)}>
          {tabs.map(tb=>(
            <button key={tb.id} onClick={()=>setTab(tb.id)} style={{
              display:"flex",alignItems:"center",gap:8,width:"100%",
              padding:".65rem .9rem",borderRadius:6,border:"none",cursor:"pointer",
              fontSize:".82rem",fontWeight:600,textAlign:"left",
              background:tab===tb.id?T.bluePale:"transparent",
              color:tab===tb.id?T.blue:T.gray700,
              transition:"all .12s",
            }}>
              {tb.label}
            </button>
          ))}
        </div>

        {/* Panels */}
        <div>
          {/* Company */}
          {tab==="company" && (
            <div style={css.card}>
              <div style={{ ...css.h2,marginBottom:20 }}>{t("Company Information","معلومات الشركة")}</div>
              <div style={css.col(14)}>
                <div style={css.grid("1fr 1fr",14)}>
                  <FormGroup label={t("Company Name (EN)","اسم الشركة (إنجليزي)")}><Input value={form.companyEn||""} onChange={e=>setF("companyEn",e.target.value)} /></FormGroup>
                  <FormGroup label={t("Company Name (AR)","اسم الشركة (عربي)")}><Input value={form.companyAr||""} onChange={e=>setF("companyAr",e.target.value)} dir="rtl" style={{...css.input,fontFamily:"'Noto Naskh Arabic',serif"}} /></FormGroup>
                  <FormGroup label="VAT Number"><Input value={form.vatNumber||""} onChange={e=>setF("vatNumber",e.target.value)} placeholder="3XXXXXXXXXXXXXXXXXXX" /></FormGroup>
                  <FormGroup label="CR Number"><Input value={form.crNumber||""} onChange={e=>setF("crNumber",e.target.value)} /></FormGroup>
                  <FormGroup label={t("Makkah Address","عنوان مكة")}><Input value={form.makkahAddress||""} onChange={e=>setF("makkahAddress",e.target.value)} /></FormGroup>
                  <FormGroup label={t("Madinah Address","عنوان المدينة")}><Input value={form.madinahAddress||""} onChange={e=>setF("madinahAddress",e.target.value)} /></FormGroup>
                </div>
                <FormGroup label={t("Company Logo","شعار الشركة")}>
                  <input type="file" accept="image/*" onChange={e=>{
                    const f=e.target.files[0]; if(!f) return;
                    const r=new FileReader(); r.onload=ev=>setF("logoDataUrl",ev.target.result); r.readAsDataURL(f);
                  }} style={{ fontSize:".82rem",color:T.gray700 }} />
                  {form.logoDataUrl && <img src={form.logoDataUrl} alt="logo" style={{ maxHeight:56,marginTop:8,border:`1px solid ${T.gray100}`,borderRadius:4,padding:4 }} />}
                </FormGroup>
                <button style={css.btnPrimary} onClick={()=>onSaveSettings(form)}>
                  {t("Save Settings","حفظ الإعدادات")}
                </button>
              </div>
            </div>
          )}

          {/* Branches */}
          {tab==="branches" && (
            <div style={css.col(16)}>
              {/* ── Default Branch ── */}
              <div style={css.card}>
                <div style={{ ...css.h2,marginBottom:4 }}>{t("Default Branch","الفرع الافتراضي")}</div>
                <div style={{ fontSize:".78rem",color:T.gray500,marginBottom:14,lineHeight:1.6 }}>
                  This branch is pre-selected when creating a new invoice. Only admins can change this.
                </div>
                <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                  <Select
                    value={form.defaultBranch || branches[0]?.id || ""}
                    onChange={e=>setF("defaultBranch", e.target.value)}
                    style={{ ...css.input, maxWidth:300, fontWeight:600 }}>
                    {branches.map(br=>(
                      <option key={br.id} value={br.id}>{br.nameEn}{br.nameAr?` / ${br.nameAr}`:""}</option>
                    ))}
                  </Select>
                  <button style={css.btnPrimary} onClick={()=>onSaveSettings(form)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>
                    {t("Save Default","حفظ الافتراضي")}
                  </button>
                  {form.defaultBranch && (
                    <div style={{ display:"flex",alignItems:"center",gap:6,fontSize:".75rem",color:T.success,fontWeight:600 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      Default: {branches.find(b=>b.id===form.defaultBranch)?.nameEn || form.defaultBranch}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Branch List ── */}
              <div style={css.card}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
                <div>
                  <div style={css.h2}>{t("Branch Management","إدارة الفروع")}</div>
                  <div style={{ fontSize:".78rem",color:T.gray500,marginTop:4 }}>Add, edit or remove hotel branches. These appear as options when creating invoices.</div>
                </div>
                <button style={css.btnPrimary} onClick={addBranch}>
                  + {t("Add Branch","إضافة فرع")}
                </button>
              </div>
              <div style={css.col(12)}>
                {branches.map((br,idx)=>{
                  const isDefault = (form.defaultBranch||branches[0]?.id) === br.id;
                  return (
                  <div key={br.id} style={{ background:isDefault?T.bluePale:T.gray50,border:`1px solid ${isDefault?T.blueLight:T.gray100}`,borderRadius:10,padding:"16px 18px",position:"relative" }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <span style={{ fontSize:16 }}>🏨</span>
                        <span style={{ fontSize:".82rem",fontWeight:700,color:T.ink }}>{br.nameEn||`Branch ${idx+1}`}</span>
                        {isDefault && <span style={{ fontSize:".6rem",padding:"2px 8px",borderRadius:10,background:T.blue,color:"white",fontWeight:700,letterSpacing:.5 }}>DEFAULT</span>}
                      </div>
                      <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                        {!isDefault && (
                          <button style={{ ...css.btnSecondary,fontSize:".7rem",padding:".3rem .75rem",color:T.blue,borderColor:T.blueLight }}
                            onClick={()=>{ setF("defaultBranch",br.id); onSaveSettings({...form,defaultBranch:br.id}); }}>
                            Set as Default
                          </button>
                        )}
                        {br.id!=="makkah" && br.id!=="madinah" && (
                          <button style={{ ...css.iconBtn,color:T.danger }} onClick={()=>delBranch(idx)}
                            onMouseEnter={e=>e.currentTarget.style.background="#FDECEA"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={css.grid("1fr 1fr",12)}>
                      <FormGroup label="Branch Name (EN)">
                        <Input value={br.nameEn} onChange={e=>setBranch(idx,"nameEn",e.target.value)} placeholder="e.g. Makkah Branch" disabled={br.id==="makkah"||br.id==="madinah"} />
                      </FormGroup>
                      <FormGroup label="Branch Name (AR)">
                        <Input value={br.nameAr} onChange={e=>setBranch(idx,"nameAr",e.target.value)} placeholder="مثال: فرع مكة" dir="rtl"
                          style={{...css.input,fontFamily:"'Noto Naskh Arabic',serif"}} disabled={br.id==="makkah"||br.id==="madinah"} />
                      </FormGroup>
                      <FormGroup label="City">
                        <Input value={br.city} onChange={e=>setBranch(idx,"city",e.target.value)} placeholder="e.g. Makkah" />
                      </FormGroup>
                      <FormGroup label="Branch ID (used in invoices)">
                        <Input value={br.id} disabled style={{ ...css.input,background:T.gray100,color:T.gray500,cursor:"not-allowed" }} />
                      </FormGroup>
                      <FormGroup label="Full Address" style={{ gridColumn:"1/-1" }}>
                        <Input value={br.address} onChange={e=>setBranch(idx,"address",e.target.value)} placeholder="Street, Building, Postal Code" />
                      </FormGroup>
                    </div>
                  </div>
                  );
                })}
                <button style={css.btnPrimary} onClick={saveBranches}>
                  {t("Save Branches","حفظ الفروع")}
                </button>
              </div>
              </div>
            </div>
          )}

          {/* ── Invoice Templates ── */}
          {tab==="invoice" && (() => {
            const tpl = form.invoiceTemplate || "classic";
            const setTpl = v => setF("invoiceTemplate", v);
            const templates = [
              {
                id: "classic",
                name: "Classic Blue",
                nameAr: "الكلاسيكي الأزرق",
                desc: "Trusted professional layout. Logo left, QR right, blue accent. Ideal for hotels & corporate clients.",
                preview: (
                  <div style={{ background:"white",border:"1px solid #E4E6EA",borderRadius:6,padding:"10px 12px",fontSize:10,fontFamily:"monospace",color:"#222",minHeight:120 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                      <div>
                        <div style={{ width:40,height:8,background:"#3A7FB5",borderRadius:2,marginBottom:3 }}/>
                        <div style={{ width:60,height:5,background:"#E4E6EA",borderRadius:2,marginBottom:2 }}/>
                        <div style={{ width:50,height:5,background:"#E4E6EA",borderRadius:2 }}/>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ width:28,height:28,background:"#EAF4FB",borderRadius:3,marginLeft:"auto",marginBottom:3 }}/>
                        <div style={{ width:36,height:5,background:"#3A7FB5",borderRadius:2,marginBottom:2 }}/>
                        <div style={{ width:30,height:4,background:"#E4E6EA",borderRadius:2 }}/>
                      </div>
                    </div>
                    <div style={{ height:2,background:"#3A7FB5",marginBottom:6,borderRadius:1 }}/>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:6 }}>
                      {[0,1].map(i=><div key={i} style={{ background:"#F7F8FA",padding:"4px 5px",borderRadius:3,borderLeft:"2px solid #5BA4CF" }}>
                        <div style={{ width:"100%",height:4,background:"#E4E6EA",borderRadius:1,marginBottom:2 }}/><div style={{ width:"70%",height:3,background:"#E4E6EA",borderRadius:1 }}/>
                      </div>)}
                    </div>
                    <div style={{ height:3,background:"#EAF4FB",borderRadius:1,marginBottom:3 }}/>
                    {[0,1,2].map(i=><div key={i} style={{ height:2,background:"#F2F3F5",borderRadius:1,marginBottom:2 }}/>)}
                    <div style={{ display:"flex",justifyContent:"flex-end",marginTop:4 }}>
                      <div style={{ width:70,background:"#EAF4FB",padding:"3px 5px",borderRadius:3 }}>
                        <div style={{ height:3,background:"#3A7FB5",borderRadius:1 }}/>
                      </div>
                    </div>
                  </div>
                )
              },
              {
                id: "modern",
                name: "Modern Dark Header",
                nameAr: "الحديث بالرأسية الداكنة",
                desc: "Bold dark header band with company name. Clean white body. Sharp, contemporary look for luxury properties.",
                preview: (
                  <div style={{ background:"white",border:"1px solid #E4E6EA",borderRadius:6,overflow:"hidden",fontSize:10,minHeight:120 }}>
                    <div style={{ background:"#1A2332",padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div>
                        <div style={{ width:50,height:7,background:"white",borderRadius:2,marginBottom:3,opacity:.9 }}/>
                        <div style={{ width:35,height:4,background:"rgba(255,255,255,.4)",borderRadius:2 }}/>
                      </div>
                      <div style={{ width:24,height:24,background:"rgba(255,255,255,.15)",borderRadius:3 }}/>
                    </div>
                    <div style={{ padding:"8px 12px" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",marginBottom:5 }}>
                        <div style={{ width:40,height:5,background:"#1A2332",borderRadius:2 }}/>
                        <div style={{ width:30,height:5,background:"#E4E6EA",borderRadius:2 }}/>
                      </div>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:5 }}>
                        {[0,1].map(i=><div key={i} style={{ background:"#F7F8FA",padding:"4px 5px",borderRadius:3,borderBottom:"2px solid #1A2332" }}>
                          <div style={{ width:"80%",height:4,background:"#E4E6EA",borderRadius:1,marginBottom:2 }}/><div style={{ width:"60%",height:3,background:"#E4E6EA",borderRadius:1 }}/>
                        </div>)}
                      </div>
                      <div style={{ height:2,background:"#1A2332",borderRadius:1,marginBottom:3 }}/>
                      {[0,1,2].map(i=><div key={i} style={{ height:2,background:"#F2F3F5",borderRadius:1,marginBottom:2 }}/>)}
                      <div style={{ display:"flex",justifyContent:"flex-end",marginTop:4 }}>
                        <div style={{ width:70,background:"#1A2332",padding:"3px 5px",borderRadius:3 }}>
                          <div style={{ height:3,background:"rgba(255,255,255,.7)",borderRadius:1 }}/>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              },
              {
                id: "minimal",
                name: "Minimal Clean",
                nameAr: "النظيف المبسط",
                desc: "Ultra-clean, no background blocks. Black & white with a single accent line. Best for printing and archiving.",
                preview: (
                  <div style={{ background:"white",border:"1px solid #E4E6EA",borderRadius:6,padding:"10px 12px",fontSize:10,minHeight:120 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5,paddingBottom:5,borderBottom:"2px solid #000" }}>
                      <div>
                        <div style={{ width:55,height:7,background:"#000",borderRadius:1,marginBottom:3 }}/>
                        <div style={{ width:40,height:3,background:"#999",borderRadius:1,marginBottom:2 }}/>
                        <div style={{ width:35,height:3,background:"#999",borderRadius:1 }}/>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ width:24,height:24,background:"#F2F3F5",borderRadius:2,marginLeft:"auto",marginBottom:2 }}/>
                        <div style={{ width:30,height:4,background:"#000",borderRadius:1,marginBottom:2 }}/>
                        <div style={{ width:25,height:3,background:"#ccc",borderRadius:1 }}/>
                      </div>
                    </div>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:5 }}>
                      {[0,1].map(i=><div key={i} style={{ padding:"3px 0" }}>
                        <div style={{ width:"80%",height:4,background:"#222",borderRadius:1,marginBottom:2 }}/><div style={{ width:"60%",height:3,background:"#ccc",borderRadius:1 }}/>
                      </div>)}
                    </div>
                    <div style={{ height:1,background:"#000",marginBottom:3 }}/>
                    {[0,1,2].map(i=><div key={i} style={{ height:2,background:"#F2F3F5",borderRadius:1,marginBottom:2 }}/>)}
                    <div style={{ display:"flex",justifyContent:"flex-end",marginTop:4 }}>
                      <div style={{ width:70,borderTop:"1px solid #000",paddingTop:3 }}>
                        <div style={{ height:3,background:"#222",borderRadius:1 }}/>
                      </div>
                    </div>
                  </div>
                )
              },
              {
                id: "zatca",
                name: "Saudi ZATCA Official",
                nameAr: "النموذج الرسمي السعودي",
                desc: "Full ZATCA-compliant table layout: 8-column items, bilingual seller/buyer grid, Arabic amount in words. Matches official Saudi Tax Authority format.",
                preview: (
                  <div style={{ background:"white",border:"1px solid #ccc",borderRadius:4,overflow:"hidden",fontSize:9,minHeight:120 }}>
                    {/* Mini header 3-col */}
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 8px",borderBottom:"2px solid #000" }}>
                      <div style={{ width:20,height:20,border:"1px solid #ccc",borderRadius:10 }}/>
                      <div style={{ textAlign:"center" }}>
                        <div style={{ width:50,height:5,background:"#000",borderRadius:1,margin:"0 auto 2px" }}/>
                        <div style={{ width:38,height:3,background:"#555",borderRadius:1,margin:"0 auto 2px" }}/>
                        <div style={{ width:30,height:3,background:"#000",borderRadius:1,margin:"0 auto" }}/>
                      </div>
                      <div style={{ width:22,height:22,border:"1px solid #ccc" }}/>
                    </div>
                    {/* Title strip */}
                    <div style={{ background:"#f0f0f0",padding:"3px 6px",textAlign:"center",borderBottom:"1px solid #ccc",display:"flex",justifyContent:"space-around" }}>
                      <div style={{ width:35,height:4,background:"#555",borderRadius:1 }}/>
                      <div style={{ width:30,height:4,background:"#555",borderRadius:1 }}/>
                    </div>
                    {/* Seller/Buyer grid */}
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,margin:"4px 6px",border:"1px solid #ccc" }}>
                      {[0,1,2,3,4,5].map(i=>(
                        <div key={i} style={{ padding:"2px 4px",borderBottom:"1px solid #eee",borderRight:i%2===0?"1px solid #ccc":"none" }}>
                          <div style={{ height:3,background:"#ddd",borderRadius:1,width:"80%" }}/>
                        </div>
                      ))}
                    </div>
                    {/* 8-col items table */}
                    <div style={{ margin:"4px 6px",border:"1px solid #ccc" }}>
                      <div style={{ background:"#f0f0f0",display:"flex",padding:"2px 0" }}>
                        {[22,8,7,11,7,7,8,10].map((w,i)=>(
                          <div key={i} style={{ width:`${w}%`,padding:"0 2px",borderRight:i<7?"1px solid #ccc":"none" }}>
                            <div style={{ height:3,background:"#999",borderRadius:1 }}/>
                          </div>
                        ))}
                      </div>
                      {[0].map(i=>(
                        <div key={i} style={{ display:"flex",padding:"3px 0" }}>
                          {[22,8,7,11,7,7,8,10].map((w,j)=>(
                            <div key={j} style={{ width:`${w}%`,padding:"0 2px",borderRight:j<7?"1px solid #eee":"none" }}>
                              <div style={{ height:2,background:"#ddd",borderRadius:1 }}/>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                    {/* Totals right-aligned */}
                    <div style={{ display:"flex",justifyContent:"flex-end",padding:"3px 6px" }}>
                      <div style={{ width:"55%",border:"1px solid #ccc" }}>
                        {[0,1,2,3].map(i=>(
                          <div key={i} style={{ display:"flex",borderBottom:i<3?"1px solid #eee":"none",background:i===3?"#000":"transparent" }}>
                            <div style={{ flex:1,padding:"2px 4px" }}><div style={{ height:2,background:i===3?"rgba(255,255,255,.6)":"#ddd",borderRadius:1 }}/></div>
                            <div style={{ width:25,padding:"2px 4px",borderLeft:"1px solid #eee" }}><div style={{ height:2,background:i===3?"rgba(255,255,255,.6)":"#ddd",borderRadius:1 }}/></div>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Arabic words strip */}
                    <div style={{ margin:"3px 6px",background:"#f9f9f9",padding:"2px 4px",border:"1px solid #eee" }}>
                      <div style={{ height:3,background:"#bbb",borderRadius:1,width:"70%",marginLeft:"auto" }}/>
                    </div>
                  </div>
                )
              },
            ];

            return (
              <div style={css.col(20)}>
                <div style={css.card}>
                  <div style={{ ...css.h2,marginBottom:6 }}>{t("Invoice Template","قالب الفاتورة")}</div>
                  <div style={{ fontSize:".78rem",color:T.gray500,marginBottom:20,lineHeight:1.6 }}>
                    All templates are <strong>ZATCA Phase 1 compliant</strong> — they include the mandatory QR code (TLV encoded), VAT number, seller name, and issue date as required by Saudi Arabia's e-invoicing regulations.
                  </div>

                  <div style={css.grid("repeat(2,1fr)",20)}>
                    {templates.map(tp=>{
                      const sel = tpl===tp.id;
                      return (
                        <div key={tp.id} onClick={()=>setTpl(tp.id)}
                          style={{ border:`2px solid ${sel?T.blue:T.gray100}`,borderRadius:12,overflow:"hidden",cursor:"pointer",
                            boxShadow:sel?`0 0 0 3px ${T.blue}22,0 4px 16px rgba(91,164,207,.2)`:"0 1px 4px rgba(0,0,0,.05)",
                            transition:"all .15s",background:sel?T.bluePale:"white" }}
                          onMouseEnter={e=>{ if(!sel){e.currentTarget.style.borderColor=T.blueLight;e.currentTarget.style.boxShadow="0 4px 12px rgba(91,164,207,.12)";} }}
                          onMouseLeave={e=>{ if(!sel){e.currentTarget.style.borderColor=T.gray100;e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,.05)";} }}>

                          {/* Preview thumbnail */}
                          <div style={{ padding:"12px 12px 8px",background:T.gray50,borderBottom:`1px solid ${sel?T.blueLight:T.gray100}` }}>
                            {tp.preview}
                          </div>

                          {/* Info */}
                          <div style={{ padding:"12px 14px" }}>
                            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
                              <div style={{ fontWeight:700,fontSize:".85rem",color:sel?T.blue:T.ink }}>{tp.name}</div>
                              {sel && (
                                <div style={{ display:"flex",alignItems:"center",gap:4,fontSize:".65rem",color:T.blue,fontWeight:700,
                                  background:T.bluePale,padding:"2px 8px",borderRadius:20,border:`1px solid ${T.blueLight}` }}>
                                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                                  ACTIVE
                                </div>
                              )}
                            </div>
                            <div style={{ fontFamily:"'Noto Naskh Arabic',serif",fontSize:".75rem",color:T.gray500,marginBottom:6,direction:"rtl" }}>{tp.nameAr}</div>
                            <div style={{ fontSize:".72rem",color:T.gray500,lineHeight:1.5 }}>{tp.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ZATCA info strip */}
                  <div style={{ marginTop:20,padding:"12px 16px",background:"#FFFBEA",border:"1px solid #F5DFA0",borderRadius:8,
                    display:"flex",gap:12,alignItems:"flex-start" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#B87800" strokeWidth="2" style={{flexShrink:0,marginTop:1}}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <div style={{ fontSize:".75rem",color:"#7A5200",lineHeight:1.7 }}>
                      <strong>Saudi Arabia ZATCA e-Invoicing (Phase 1):</strong> Every invoice includes a ZATCA-compliant QR code with TLV-encoded seller name, VAT registration number, invoice timestamp, total amount, and VAT amount. VAT is calculated at 15% as mandated. All templates display the mandatory "فاتورة ضريبية" (Tax Invoice) label.
                    </div>
                  </div>

                  <div style={{ display:"flex",gap:12,marginTop:16,alignItems:"center" }}>
                    <button style={css.btnPrimary} onClick={()=>onSaveSettings(form)}>
                      {t("Save Template","حفظ القالب")}
                    </button>
                    <span style={{ fontSize:".72rem",color:T.gray400 }}>Active: <strong style={{color:T.blue}}>{templates.find(tp=>tp.id===tpl)?.name}</strong></span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Users */}
          {tab==="users" && (
            <div style={css.card}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20 }}>
                <div style={css.h2}>{t("User Management","إدارة المستخدمين")}</div>
                <button style={css.btnPrimary} onClick={()=>openUserModal()}>
                  + {t("Add User","إضافة مستخدم")}
                </button>
              </div>
              <table style={{ width:"100%",borderCollapse:"collapse",fontSize:".82rem" }}>
                <thead><tr style={{ borderBottom:`2px solid ${T.gray100}` }}>
                  {["Name","Email","Role","Branch",""].map((h,i)=>(
                    <th key={i} style={{ padding:".55rem .75rem",textAlign:"left",fontSize:".65rem",fontWeight:700,letterSpacing:".1em",textTransform:"uppercase",color:T.gray500 }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {users.map(u=>(
                    <tr key={u.id} style={{ borderBottom:`1px solid ${T.gray100}` }}>
                      <td style={{ padding:".65rem .75rem",fontWeight:600,color:T.ink }}>{u.name}</td>
                      <td style={{ padding:".65rem .75rem",color:T.gray500 }}>{u.email}</td>
                      <td style={{ padding:".65rem .75rem" }}><Badge type={u.role}>{u.role}</Badge></td>
                      <td style={{ padding:".65rem .75rem",color:T.gray500,textTransform:"capitalize" }}>{u.branch}</td>
                      <td style={{ padding:".65rem .75rem" }}>
                        <div style={css.flex(4)}>
                          <button style={css.iconBtn} onClick={()=>openUserModal(u)}
                            onMouseEnter={e=>{e.currentTarget.style.background=T.bluePale;e.currentTarget.style.color=T.blue}}
                            onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.color=T.gray500}}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          {u.id!==currentUser?.id && <button style={{ ...css.iconBtn,color:T.danger }} onClick={()=>setDelUserId(u.id)}
                            onMouseEnter={e=>e.currentTarget.style.background="#FDECEA"}
                            onMouseLeave={e=>e.currentTarget.style.background="none"}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Modal open={userModal} onClose={()=>setUserModal(false)} title={editingUser?"Edit User":"Add User"}
                footer={<>
                  <button style={css.btnSecondary} onClick={()=>setUserModal(false)}>Cancel</button>
                  <button style={css.btnPrimary} onClick={()=>{onSaveUser({...editingUser,...uForm});setUserModal(false);}}>Save User</button>
                </>}>
                  <div style={css.col(14)}>
                  <FormGroup label="Full Name"><Input value={uForm.name} onChange={e=>setU("name",e.target.value)} /></FormGroup>
                  <FormGroup label="Email"><Input type="email" value={uForm.email} onChange={e=>setU("email",e.target.value)} /></FormGroup>
                  <FormGroup label="Password (leave blank to keep)"><Input type="password" value={uForm.password} onChange={e=>setU("password",e.target.value)} placeholder="Min 6 characters" /></FormGroup>
                  <div style={css.grid("1fr 1fr",12)}>
                    <FormGroup label="Role">
                      <Select value={uForm.role} onChange={e=>{
                        const r=e.target.value;
                        const presets = {
                          admin:      {createInvoice:true, viewReports:true, manageClients:true, accessSettings:true, deleteInvoice:true, exportData:true, markPaid:true, issueCreditInv:true},
                          manager:    {createInvoice:true, viewReports:true, manageClients:true, accessSettings:false,deleteInvoice:true, exportData:true, markPaid:true, issueCreditInv:true},
                          accountant: {createInvoice:true, viewReports:true, manageClients:false,accessSettings:false,deleteInvoice:false,exportData:true, markPaid:true, issueCreditInv:false},
                          receptionist:{createInvoice:true,viewReports:false,manageClients:true, accessSettings:false,deleteInvoice:false,exportData:false,markPaid:true, issueCreditInv:false},
                          staff:      {createInvoice:true, viewReports:false,manageClients:true, accessSettings:false,deleteInvoice:false,exportData:false,markPaid:false,issueCreditInv:false},
                          viewer:     {createInvoice:false,viewReports:true, manageClients:false,accessSettings:false,deleteInvoice:false,exportData:false,markPaid:false,issueCreditInv:false},
                        };
                        setUForm(f=>({...f,role:r,permissions:presets[r]||(f.permissions||presets.staff)}));
                      }}>
                        <option value="admin">Admin</option>
                        <option value="manager">Manager</option>
                        <option value="accountant">Accountant</option>
                        <option value="receptionist">Receptionist</option>
                        <option value="staff">Staff</option>
                        <option value="viewer">Viewer (Read-only)</option>
                      </Select>
                    </FormGroup>
                    <FormGroup label="Branch">
                      <Select value={uForm.branch} onChange={e=>setU("branch",e.target.value)}>
                        <option value="both">All Branches</option>
                        <option value="makkah">Makkah</option>
                        <option value="madinah">Madinah</option>
                      </Select>
                    </FormGroup>
                  </div>
                  {/* Permissions */}
                  <div>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                      <div style={css.label}>Permissions</div>
                      <span style={{ fontSize:".68rem",color:T.gray400,fontStyle:"italic" }}>Auto-set by role · customise below</span>
                    </div>
                    <div style={{ background:T.gray50,borderRadius:8,padding:"12px 14px",border:`1px solid ${T.gray100}` }}>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                        {[
                          ["createInvoice",   "Create Invoices",    "📄"],
                          ["markPaid",         "Mark Paid / Unpaid", "✅"],
                          ["viewReports",      "View Reports",       "📊"],
                          ["manageClients",    "Manage Clients",     "👥"],
                          ["issueCreditInv",   "Issue Credit Invoice","🔄"],
                          ["deleteInvoice",    "Delete Invoices",    "🗑️"],
                          ["exportData",       "Export Data",        "📥"],
                          ["accessSettings",   "Access Settings",    "⚙️"],
                        ].map(([key,label,icon])=>{
                          const perms = uForm.permissions||{};
                          const isFullAccess = uForm.role==="admin";
                          const checked = isFullAccess ? true : !!perms[key];
                          return (
                            <label key={key} style={{ display:"flex",alignItems:"center",gap:8,
                              cursor:isFullAccess?"not-allowed":"pointer",
                              padding:"7px 10px",borderRadius:6,
                              background:checked?(isFullAccess?T.bluePale:"#E8F5EF"):"white",
                              border:`1px solid ${checked?(isFullAccess?T.blueLight:"#A8DBC0"):T.gray200}`,
                              transition:"all .12s",opacity:isFullAccess?0.7:1 }}>
                              <input type="checkbox" checked={checked} disabled={isFullAccess}
                                onChange={e=>setUForm(f=>({...f,permissions:{...(f.permissions||{}), [key]:e.target.checked}}))}
                                style={{ accentColor:T.blue,width:14,height:14,flexShrink:0 }} />
                              <span style={{ fontSize:".78rem",fontWeight:500,color:T.ink }}>{icon} {label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {uForm.role==="admin" && <div style={{ fontSize:".72rem",color:T.gray500,marginTop:8,textAlign:"center" }}>Admins always have full access</div>}
                    </div>
                  </div>
                </div>
              </Modal>
              <Confirm open={!!delUserId} title="Delete User" msg="Delete this user account?" onClose={()=>setDelUserId(null)} onOk={()=>{onDeleteUser(delUserId);setDelUserId(null);}} />
            </div>
          )}

          {/* Backup */}
          {tab==="backup" && (() => {
            const scheduleOptions = [
              { id:"manual",  label:"Manual only",  ar:"يدوي فقط" },
              { id:"daily",   label:"Every day",    ar:"كل يوم" },
              { id:"weekly",  label:"Every week",   ar:"كل أسبوع" },
              { id:"monthly", label:"Every month",  ar:"كل شهر" },
            ];
            // Always read from live settings prop (not stale form copy)
            const backupSchedule = settings.backupSchedule || "manual";
            const lastBackup     = settings.lastBackupAt   || null;
            const backupCount    = settings.backupCount    || 0;

            // Check if auto-backup is due
            const isBackupDue = (() => {
              if (backupSchedule === "manual" || !lastBackup) return false;
              const last = new Date(lastBackup);
              const now  = new Date();
              const diffDays = (now - last) / (1000 * 60 * 60 * 24);
              if (backupSchedule === "daily"   && diffDays >= 1)  return true;
              if (backupSchedule === "weekly"  && diffDays >= 7)  return true;
              if (backupSchedule === "monthly" && diffDays >= 30) return true;
              return false;
            })();

            return (
              <div style={css.col(18)}>

                {/* Due now banner */}
                {isBackupDue && (
                  <div style={{ background:"#FFF8E0",border:"1px solid #F5DFA0",borderRadius:10,padding:"14px 18px",
                    display:"flex",alignItems:"center",gap:12 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B87800" strokeWidth="2" style={{flexShrink:0}}>
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700,color:"#7A5200",fontSize:".85rem" }}>Backup is due!</div>
                      <div style={{ fontSize:".75rem",color:"#B87800",marginTop:2 }}>
                        Your {backupSchedule} backup is overdue. Last backup: {lastBackup ? new Date(lastBackup).toLocaleDateString() : "never"}
                      </div>
                    </div>
                    <button style={{ ...css.btnPrimary,background:"#B87800",flexShrink:0 }}
                      onClick={onExportBackup}>
                      Backup Now
                    </button>
                  </div>
                )}

                {/* Status cards */}
                <div style={css.grid("repeat(3,1fr)",14)}>
                  {[
                    ["Last Backup", lastBackup ? new Date(lastBackup).toLocaleDateString("en-SA",{day:"2-digit",month:"short",year:"numeric"}) : "Never", lastBackup ? T.success : T.danger, lastBackup ? "#E8F5EF" : "#FDECEA"],
                    ["Total Backups", backupCount, T.blue, T.bluePale],
                    ["Schedule", scheduleOptions.find(s=>s.id===backupSchedule)?.label || "Manual", T.gray700, T.gray50],
                  ].map(([label,val,col,bg])=>(
                    <div key={label} style={{ background:bg,borderRadius:10,padding:"14px 16px",border:`1px solid ${col}22` }}>
                      <div style={{ fontSize:".65rem",fontWeight:700,color:col,textTransform:"uppercase",letterSpacing:".1em",marginBottom:6 }}>{label}</div>
                      <div style={{ fontSize:".95rem",fontWeight:700,color:col }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Manual backup & restore */}
                <div style={css.card}>
                  <div style={{ fontWeight:700,fontSize:".9rem",marginBottom:4 }}>Manual Backup</div>
                  <div style={{ fontSize:".75rem",color:T.gray500,marginBottom:14,lineHeight:1.6 }}>
                    Export all invoices, clients, users and settings as a JSON file. Store on Google Drive, OneDrive or USB.
                  </div>
                  <div style={css.flex(10)}>
                    <button style={css.btnPrimary} onClick={onExportBackup}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                      Export Backup Now
                    </button>
                    <label style={{ ...css.btnSecondary,cursor:"pointer",display:"inline-flex",alignItems:"center",gap:7 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      Restore from Backup
                      <input type="file" accept=".json" onChange={onImportBackup} style={{display:"none"}} />
                    </label>
                  </div>
                </div>

                {/* Auto-backup schedule */}
                <div style={css.card}>
                  <div style={{ fontWeight:700,fontSize:".9rem",marginBottom:4 }}>Auto-Backup Schedule</div>
                  <div style={{ fontSize:".75rem",color:T.gray500,marginBottom:16,lineHeight:1.6 }}>
                    The app will remind you when a backup is due based on your schedule. On next launch after the due date, a notification will appear.
                  </div>
                  <div style={{ display:"flex",gap:10,flexWrap:"wrap",marginBottom:16 }}>
                    {scheduleOptions.map(opt=>(
                      <button key={opt.id}
                        onClick={()=>onSaveSettings({ backupSchedule: opt.id })}
                        style={{ padding:"8px 18px",borderRadius:8,border:`2px solid ${backupSchedule===opt.id?T.blue:T.gray200}`,
                          background:backupSchedule===opt.id?T.bluePale:"white",
                          color:backupSchedule===opt.id?T.blue:T.gray700,
                          fontWeight:700,fontSize:".78rem",cursor:"pointer",transition:"all .15s" }}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {backupSchedule !== "manual" && (
                    <div style={{ background:T.bluePale,borderRadius:8,padding:"10px 14px",fontSize:".75rem",color:T.blue }}>
                      <strong>Active:</strong> You will see a reminder banner when your {backupSchedule} backup is overdue.
                      Next due: {lastBackup ? (() => {
                        const d = new Date(lastBackup);
                        if (backupSchedule==="daily")   d.setDate(d.getDate()+1);
                        if (backupSchedule==="weekly")  d.setDate(d.getDate()+7);
                        if (backupSchedule==="monthly") d.setMonth(d.getMonth()+1);
                        return d.toLocaleDateString("en-SA",{day:"2-digit",month:"short",year:"numeric"});
                      })() : "after first backup"}
                    </div>
                  )}
                </div>

                {/* What's included */}
                <div style={css.card}>
                  <div style={{ fontWeight:700,fontSize:".9rem",marginBottom:12 }}>What's included in the backup</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:".78rem" }}>
                    {[
                      ["📄 Invoices", `${invoices.length} records`],
                      ["👥 Clients",  `${clients.length} records`],
                      ["👤 Users",    `${users.length} records`],
                      ["⚙️ Settings", "Company, branches, templates"],
                    ].map(([label,val])=>(
                      <div key={label} style={{ display:"flex",justifyContent:"space-between",padding:"8px 12px",background:T.gray50,borderRadius:6 }}>
                        <span style={{ fontWeight:600 }}>{label}</span>
                        <span style={{ color:T.gray500 }}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [loaded,    setLoaded]    = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [user,      setUser]      = useState(null);
  const [lang,      setLangS]     = useState("en");
  const [page,      setPage]      = useState("dashboard");
  const [online,    setOnline]    = useState(navigator.onLine);

  const [toasts, setToasts] = useState([]);

  const [invoices,  setInvoices]  = useState([]);
  const [clients,   setClients]   = useState([]);
  const [users,     setUsers]     = useState([]);
  const [settings,  setSettingsSt]= useState({});

  const [previewInv,  setPreviewInv]  = useState(null);
  const [editingInv,  setEditingInv]  = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);

  const toast = useCallback((msg,type="info")=>{
    const id=uid();
    setToasts(t=>[...t,{id,msg,type}]);
    setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4000);
  },[]);

  // Load everything — tries Firestore first, falls back to IndexedDB
  useEffect(()=>{
    (async()=>{
      await DB.open();
      let i=[],c=[],us=[],s={};

      try {
        const {
          fsGetInvoices, fsGetClients, fsGetSettings, fsGetUsers,
          fsListenInvoices, fsListenClients, fsListenSettings, fsListenUsers,
          fsSaveSettings, fsSaveInvoice, fsSaveClient,
        } = await import("./firebase/firebaseDB.js");

        [i, c, us, s] = await Promise.all([
          fsGetInvoices(), fsGetClients(), fsGetUsers(), fsGetSettings(),
        ]);

        // FIX BUG 2: Only seed on truly first-time empty Firestore
        const isFirstTime = i.length===0 && c.length===0 && Object.keys(s).length===0;
        if (isFirstTime) {
          // Migrate any existing IndexedDB data to Firestore
          const localInv = await DB.getAll("invoices");
          const localCli = await DB.getAll("clients");
          if (localInv.length>0 || localCli.length>0) {
            toast("Migrating local data to cloud sync…","info");
            for (const inv of localInv) await fsSaveInvoice(inv).catch(()=>{});
            for (const cli of localCli) await fsSaveClient(cli).catch(()=>{});
            [i, c] = await Promise.all([fsGetInvoices(), fsGetClients()]);
            toast("Data migrated to cloud ✓","success");
          }
          if (Object.keys(s).length===0) {
            const defaults={companyEn:"",companyAr:"",vatNumber:"",crNumber:"",makkahAddress:"",madinahAddress:""};
            await fsSaveSettings(defaults);
            s = defaults;
          }
        }

        // Real-time listeners — update state on any change from any PC
        // Use a flag so the first snapshot (which fires immediately) doesn't race with initial load
        let initialSnapDone = { inv: false, cli: false, usr: false };
        const unsubInv = fsListenInvoices(data => {
          if (!initialSnapDone.inv) { initialSnapDone.inv = true; return; } // skip first snapshot (already loaded above)
          setInvoices(data);
        });
        const unsubCli = fsListenClients(data => {
          if (!initialSnapDone.cli) { initialSnapDone.cli = true; return; }
          setClients(data);
        });
        const unsubSet = fsListenSettings(data => {
          if (data && Object.keys(data).length > 0) setSettingsSt(prev=>({...prev,...data}));
        });
        const unsubUsr = fsListenUsers(data => {
          if (!initialSnapDone.usr) { initialSnapDone.usr = true; return; }
          if (data.length > 0) setUsers(data);
        });

        window.__fsUnsubs = [unsubInv, unsubCli, unsubSet, unsubUsr];
        window.__useFirestore = true;

      } catch (err) {
        console.warn("Firestore unavailable, using local IndexedDB:", err.message);
        window.__useFirestore = false;

        us = await DB.getAll("users");
        if (!us.length) {
          const ah=await hashPw("admin123"); const sh=await hashPw("staff123");
          await DB.put("users",{id:"u1",name:"Hotel Admin",email:"admin@hotel.sa",passwordHash:ah,role:"admin",branch:"both",createdAt:new Date().toISOString()});
          await DB.put("users",{id:"u2",name:"Staff Member",email:"staff@hotel.sa",passwordHash:sh,role:"staff",branch:"makkah",createdAt:new Date().toISOString()});
          us=await DB.getAll("users");
        }
        i = await DB.getAll("invoices");
        c = await DB.getAll("clients");
        const sArr = await DB.getAll("settings");
        sArr.forEach(r=>s[r.key]=r.value);
        if (!s.companyEn) {
          const defaults={companyEn:"",companyAr:"",vatNumber:"",crNumber:"",makkahAddress:"",madinahAddress:""};
          for(const[k,v] of Object.entries(defaults)){ await DB.setSetting(k,v); s[k]=v; }
        }
      }

      setInvoices(i); setClients(c); setUsers(us); setSettingsSt(s);
      const sess = sessionStorage.getItem("aqsa_user");
      if (sess) { try { const u=JSON.parse(sess); setUser(u); } catch {} }
      setLoaded(true);
    })();

    window.addEventListener("online",  ()=>setOnline(true));
    window.addEventListener("offline", ()=>setOnline(false));

    return () => { (window.__fsUnsubs||[]).forEach(fn=>fn?.()); };
  },[]);

  // ── Firebase auth state observer ─────────────────────────────────────────
  useEffect(()=>{
    let unsub = null;
    (async()=>{
      try {
        const { observeAuthState } = await import("./firebase/firebaseAuth.js");
        unsub = observeAuthState(async (firebaseUser) => {
          if (firebaseUser) {
            // Role/permissions: try Firestore users first, then local IndexedDB
            let profile = null;
            try {
              const { fsGetUserByEmail } = await import("./firebase/firebaseDB.js");
              profile = await fsGetUserByEmail(firebaseUser.email);
            } catch {}
            if (!profile) {
              const allUsers = await DB.getAll("users");
              profile = allUsers.find(u => u.email === firebaseUser.email) || {};
            }
            setUser({
              uid:         firebaseUser.uid,
              email:       firebaseUser.email,
              name:        profile.name  || firebaseUser.displayName || firebaseUser.email.split("@")[0],
              role:        profile.role  || "staff",
              permissions: profile.permissions || {},
              branch:      profile.branch || "",
              ...profile,
            });
          } else {
            setUser(null);
          }
          setAuthReady(true);
        });
      } catch {
        setAuthReady(true);
      }
    })();
    return () => { if(unsub) unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]); // wait until local users are loaded before merging

  const refresh = async () => {
    setInvoices(await DB.getAll("invoices"));
    setClients( await DB.getAll("clients"));
    setUsers(   await DB.getAll("users"));
    const sArr=await DB.getAll("settings"); const s={}; sArr.forEach(r=>s[r.key]=r.value); setSettingsSt(s);
  };

  const doLogin = async (email, pass) => {
    try {
      const { loginWithEmail } = await import("./firebase/firebaseAuth.js");
      await loginWithEmail(email, pass);
      // Try Firestore first for role, then local IndexedDB
      let profile = null;
      try {
        const { fsGetUserByEmail } = await import("./firebase/firebaseDB.js");
        profile = await fsGetUserByEmail(email);
      } catch {}
      if (!profile) {
        const allUsers = await DB.getAll("users");
        profile = allUsers.find(u => u.email === email) || {};
      }
      const merged = {
        email,
        name:        profile.name  || email.split("@")[0],
        role:        profile.role  || "staff",
        permissions: profile.permissions || {},
        branch:      profile.branch || "",
        ...profile,
      };
      setUser(merged);
      await DB.addAudit(`Login: ${merged.name}`, email);
      return true;
    } catch (fbErr) {
      if (fbErr.code && fbErr.code.startsWith("auth/")) return false;
      // Firebase not configured — use local auth
      const hash = await hashPw(pass);
      const u = users.find(u => u.email === email && u.passwordHash === hash);
      if (!u) return false;
      setUser(u);
      sessionStorage.setItem("aqsa_user", JSON.stringify(u));
      await DB.addAudit(`Login: ${u.name}`, email);
      return true;
    }
  };

  const doLogout = async () => {
    try {
      const { logout: firebaseLogout } = await import("./firebase/firebaseAuth.js");
      await firebaseLogout();
    } catch {
      // Firebase not configured — just clear local session
      sessionStorage.removeItem("aqsa_user");
    }
    setUser(null);
    setPage("dashboard");
  };
  const setLang=l=>{ setLangS(l); DB.setSetting("lang",l); };
  const onNav=p=>{ setPage(p); setEditingInv(null); };

  // ── Wire Electron native menu → React ─────────────────────────────────────
  useEffect(()=>{
    const api = window.electronAPI;
    if (!api?.isElectron) return;

    // Navigate to page from menu
    api.onMenuNavigate(({ page: p }) => {
      setEditingInv(null);
      setPage(p);
    });

    // Export Excel from menu
    api.onMenuExportExcel(() => {
      exportExcel();
    });

    // Focus invoice search from menu (Ctrl+F)
    api.onMenuFocusSearch(() => {
      setPage('invoices');
      setTimeout(() => {
        const el = document.querySelector('input[placeholder*="Search"]') ||
                   document.querySelector('input[placeholder*="بحث"]');
        if (el) { el.focus(); el.select(); }
      }, 400);
    });

    // Apply invoice filter from menu
    api.onMenuFilterInvoices((filter) => {
      setPage('invoices');
      // Dispatch a custom DOM event that InvoicesPage can listen to
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('aqsa-menu-filter', { detail: filter }));
      }, 300);
    });

    // Open Add Client modal from menu
    api.onMenuAddClient(() => {
      setPage('clients');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('aqsa-menu-add-client'));
      }, 300);
    });

    return () => api.removeAllMenuListeners?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helper: pick Firestore or IndexedDB based on what's available ──────────
  const fsOrLocal = async (fsAction, localAction) => {
    // Wait up to 3s for the Firestore flag to be determined before falling back
    if (window.__useFirestore === undefined) {
      await new Promise(res => {
        let tries = 0;
        const check = setInterval(() => {
          if (window.__useFirestore !== undefined || ++tries > 30) {
            clearInterval(check); res();
          }
        }, 100);
      });
    }
    if (window.__useFirestore) {
      try { return await fsAction(); } catch(e) { console.warn("Firestore write failed, using local:", e.message); }
    }
    return localAction();
  };

  const saveInvoice=async(data, extraRecord=null)=>{
    const id=data.id||uid();
    const isNew=!invoices.find(i=>i.id===id);
    const inv={...data,id,
      createdBy: data.createdBy || user?.email,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedBy:  user?.email,
      updatedAt:  new Date().toISOString(),
    };
    await fsOrLocal(
      async()=>{ const {fsSaveInvoice}=await import("./firebase/firebaseDB.js"); await fsSaveInvoice(inv); },
      ()=>DB.put("invoices",inv)
    );
    // Advance HWM on every new save so next form open never re-uses this number
    // (guards against Firestore listener delay causing duplicate seq numbers)
    if (isNew && inv.number) {
      const savedSeq = extractSeq(inv.number);
      const currentHWM = +(await DB.getSetting("invSeqHWM") || 0);
      if (savedSeq > currentHWM) await DB.setSetting("invSeqHWM", savedSeq);
    }
    // Update React state immediately — don't wait for listener
    setInvoices(prev => {
      const filtered = prev.filter(i=>i.id!==id);
      return [inv, ...filtered].sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));
    });
    await DB.addAudit(`Invoice ${inv.number} ${isNew?"created":"updated"}`, user?.email);

    // BUG FIX: Save the standalone receipt/credit record (second argument from
    // ReceiptVoucherModal) that was previously being silently ignored.
    // Without this, receipt vouchers never appeared in the client ledger.
    if (extraRecord) {
      const extra = {
        ...extraRecord,
        createdBy: extraRecord.createdBy || user?.email,
        createdAt: extraRecord.createdAt || new Date().toISOString(),
        updatedBy:  user?.email,
        updatedAt:  new Date().toISOString(),
      };
      await fsOrLocal(
        async()=>{ const {fsSaveInvoice}=await import("./firebase/firebaseDB.js"); await fsSaveInvoice(extra); },
        ()=>DB.put("invoices",extra)
      );
      setInvoices(prev => {
        const filtered = prev.filter(i=>i.id!==extra.id);
        return [extra, ...filtered].sort((a,b)=>(b.issueDate||"").localeCompare(a.issueDate||""));
      });
      await DB.addAudit(`Receipt ${extra.number} saved for invoice ${inv.number}`, user?.email);
    }

    if (!window.__useFirestore) await refresh();
    toast(`Invoice ${inv.number} saved`,"success");
  };

  const deleteInvoice=async(id)=>{
    const inv=invoices.find(i=>i.id===id);
    // Persist the sequence number of the deleted invoice as the high-water mark.
    // This ensures future invoices always get a higher number, never reusing
    // a sequence number from a deleted invoice.
    if (inv?.number) {
      const deletedSeq = extractSeq(inv.number);
      const currentHWM = +(await DB.getSetting("invSeqHWM") || 0);
      if (deletedSeq > currentHWM) {
        await DB.setSetting("invSeqHWM", deletedSeq);
      }
    }
    await fsOrLocal(
      async()=>{ const {fsDeleteInvoice}=await import("./firebase/firebaseDB.js"); await fsDeleteInvoice(id); },
      ()=>DB.del("invoices",id)
    );
    setInvoices(prev=>prev.filter(i=>i.id!==id));
    await DB.addAudit(`Invoice ${inv?.number} deleted`, user?.email);
    if (!window.__useFirestore) await refresh();
    toast("Invoice deleted");
  };

  const toggleStatus=async(id)=>{
    const inv=invoices.find(i=>i.id===id);
    if(!inv) return;
    const updated={...inv,status:inv.status==="paid"?"unpaid":"paid",updatedAt:new Date().toISOString()};
    await fsOrLocal(
      async()=>{ const {fsSaveInvoice}=await import("./firebase/firebaseDB.js"); await fsSaveInvoice(updated); },
      ()=>DB.put("invoices",updated)
    );
    setInvoices(prev=>prev.map(i=>i.id===id?updated:i));
    if (!window.__useFirestore) await refresh();
    toast(`Marked ${updated.status}`,"success");
  };

  const saveClient=async(c)=>{
    await fsOrLocal(
      async()=>{ const {fsSaveClient}=await import("./firebase/firebaseDB.js"); await fsSaveClient(c); },
      ()=>DB.put("clients",c)
    );
    // FIX BUG 3: Update React state immediately
    setClients(prev => [...prev.filter(x=>x.id!==c.id), c]);
    await DB.addAudit(`Client "${c.nameEn}" saved`, user?.email);
    if (!window.__useFirestore) await refresh();
    toast("Client saved","success");
  };

  const deleteClient=async(id)=>{
    await fsOrLocal(
      async()=>{ const {fsDeleteClient}=await import("./firebase/firebaseDB.js"); await fsDeleteClient(id); },
      ()=>DB.del("clients",id)
    );
    if (!window.__useFirestore) await refresh();
    toast("Client deleted");
  };

  const saveUser=async(u)=>{
    const id=u.id||uid();
    const existing=users.find(x=>x.id===id);
    let passwordHash=existing?.passwordHash;
    if(u.password){if(u.password.length<6){toast("Password min 6 chars","error");return;}passwordHash=await hashPw(u.password);}
    if(!passwordHash){toast("Password required","error");return;}
    const {password,...rest}=u;
    const userRecord={...rest,id,passwordHash,createdAt:existing?.createdAt||new Date().toISOString()};
    await fsOrLocal(
      async()=>{ const {fsSaveUser}=await import("./firebase/firebaseDB.js"); await fsSaveUser(userRecord); },
      ()=>DB.put("users",userRecord)
    );
    // Also update local IndexedDB so role lookup works offline
    await DB.put("users",userRecord);
    await DB.addAudit(`User "${u.name}" saved`, user?.email);
    if (!window.__useFirestore) await refresh();
    else setUsers(prev=>[...prev.filter(x=>x.id!==id), userRecord]);
    toast("User saved","success");
  };

  const deleteUser=async(id)=>{
    await fsOrLocal(
      async()=>{ const {fsDeleteUser}=await import("./firebase/firebaseDB.js"); await fsDeleteUser(id); },
      ()=>DB.del("users",id)
    );
    await DB.del("users",id);
    if (!window.__useFirestore) await refresh();
    else setUsers(prev=>prev.filter(x=>x.id!==id));
    toast("User deleted");
  };

  const saveSettings=async(form)=>{
    await fsOrLocal(
      async()=>{ const {fsSaveSettings}=await import("./firebase/firebaseDB.js"); await fsSaveSettings(form); },
      async()=>{ for(const[k,v] of Object.entries(form)) await DB.setSetting(k,v); }
    );
    // Keep local copy too for offline access
    for(const[k,v] of Object.entries(form)) await DB.setSetting(k,v);
    await DB.addAudit("Company settings updated", user?.email);
    if (!window.__useFirestore) await refresh();
    else setSettingsSt(prev=>({...prev,...form}));
    toast("Settings saved","success");
  };

  const exportExcel=()=>{
    const wb=window.XLSX.utils.book_new();
    const rows=invoices.map(i=>({'Invoice #':i.number,'Client':i.clientNameEn,'Branch':i.branch,'Date':i.issueDate,'Subtotal':i.subtotal,'VAT':i.vatTotal,'Total':i.grandTotal,'Status':i.status}));
    window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(rows),"Invoices");
    window.XLSX.utils.book_append_sheet(wb,window.XLSX.utils.json_to_sheet(clients.map(c=>({Name:c.nameEn,'Name AR':c.nameAr,VAT:c.vat,Phone:c.phone,Email:c.email}))),"Clients");
    window.XLSX.writeFile(wb,`AqsaInvoices_${today()}.xlsx`);
    toast("Excel exported","success");
  };

  const exportBackup=async()=>{
    const backupData = {
      version:    2,
      exportedAt: new Date().toISOString(),
      exportedBy: user?.email || "unknown",
      invoices, clients, users, settings,
    };
    const blob=new Blob([JSON.stringify(backupData,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download=`AqsaBackup_${today()}_${(user?.email||"").split("@")[0]}.json`;
    a.click();
    // Record backup timestamp and increment counter
    const newCount = (settings.backupCount || 0) + 1;
    await saveSettings({ ...settings, lastBackupAt: new Date().toISOString(), backupCount: newCount });
    toast(`Backup exported — ${invoices.length} invoices, ${clients.length} clients`,"success");
  };

  const importBackup=async(e)=>{
    const file=e.target.files[0]; if(!file) return;
    try {
      const data=JSON.parse(await file.text());
      if (window.__useFirestore) {
        // Save to Firestore so both PCs get the restored data
        const { fsSaveInvoice, fsSaveClient } = await import("./firebase/firebaseDB.js");
        for(const inv of data.invoices||[]) await fsSaveInvoice(inv);
        for(const c of data.clients||[])   await fsSaveClient(c);
        // Firestore listeners will update state automatically — no refresh() needed
      } else {
        for(const inv of data.invoices||[]) await DB.put("invoices",inv);
        for(const c of data.clients||[])   await DB.put("clients",c);
        await refresh();
      }
      toast(`Restored ${data.invoices?.length||0} invoices`,"success");
    } catch { toast("Invalid backup file","error"); }
  };

  if (!loaded || !authReady) return (
    <div style={{ minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",
      background:`linear-gradient(135deg,${T.blueDark} 0%,${T.blue} 100%)`,
      fontFamily:"'DM Sans',sans-serif",flexDirection:"column",gap:16 }}>
      <div style={{ width:48,height:48,border:"3px solid rgba(255,255,255,.15)",
        borderTopColor:"rgba(255,255,255,.85)",borderRadius:"50%",animation:"spin .8s linear infinite" }}/>
      <div style={{ color:"rgba(255,255,255,.7)",fontSize:".85rem" }}>Loading Aqsa Invoice…</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (!user) return <LoginPage onLogin={doLogin} />;

  return (
    <div style={{ display:"flex",flexDirection:"column",minHeight:"100vh",background:T.offWhite }}>
      <style>{GLOBAL_CSS}</style>
      <Header user={user} lang={lang} setLang={setLang} online={online}
        onSync={()=>{if(online)toast("Cloud sync: connect Firebase/Supabase in production. Data saved locally ✓","success");else toast("Offline — data saved locally");}}
        onNav={onNav} page={page} onLogout={doLogout}
        invoices={invoices} onExportExcel={exportExcel} />

      <main style={{ flex:1,maxWidth:1400,margin:"0 auto",width:"100%",padding:"1.75rem 1.5rem" }}>
        {page==="dashboard" && <Dashboard invoices={invoices} onNav={onNav} lang={lang} settings={settings} />}
        {page==="invoices"  && <InvoicesPage invoices={invoices} onToggleStatus={toggleStatus}
          onDelete={id=>setConfirmDel(id)} onEdit={id=>{setEditingInv(invoices.find(i=>i.id===id));setPage("new");}}
          onPreview={id=>setPreviewInv(invoices.find(i=>i.id===id))} onNav={onNav} onExportExcel={exportExcel}
          onSaveInvoice={saveInvoice} clients={clients} settings={settings} lang={lang} user={user} />}
        {page==="new" && <InvoiceFormPage editData={editingInv} clients={clients} settings={settings} invoices={invoices}
          onSave={saveInvoice} onSaveClient={saveClient} onCancel={()=>{ setEditingInv(null); setPage("invoices"); }} lang={lang} user={user} />}
        {page==="clients"  && <ClientsPage clients={clients} invoices={invoices} onSave={saveClient} onDelete={deleteClient}
          onPreview={id=>setPreviewInv(invoices.find(i=>i.id===id))} lang={lang} />}
        {page==="reports"  && <ReportsPage invoices={invoices} onExport={exportExcel} lang={lang} />}
        {page==="settings" && <SettingsPage settings={settings} users={users} invoices={invoices} clients={clients} onSaveSettings={saveSettings}
          onSaveUser={saveUser} onDeleteUser={deleteUser} currentUser={user}
          onExportBackup={exportBackup} onImportBackup={importBackup} lang={lang} />}
      </main>

      <Footer company={settings} lang={lang} />

      {/* Invoice preview — regular or credit */}
      {previewInv && previewInv.type==="credit"
        ? <CreditInvoiceModal originalInv={invoices.find(i=>i.id===previewInv.originalInvId)||previewInv}
            settings={settings} clients={clients} onSave={saveInvoice} onClose={()=>setPreviewInv(null)} previewOnly={previewInv} />
        : previewInv && <InvoicePreview inv={previewInv} settings={settings} allInvoices={invoices} onClose={()=>setPreviewInv(null)} />}

      {/* Delete confirm */}
      <Confirm open={!!confirmDel} title="Delete Invoice" msg="Delete this invoice permanently? This cannot be undone."
        onClose={()=>setConfirmDel(null)} onOk={()=>{deleteInvoice(confirmDel);setConfirmDel(null);}} />

      <Toast toasts={toasts} />
    </div>
  );
}