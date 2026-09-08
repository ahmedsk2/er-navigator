import React, { useState, useEffect, useMemo, useRef } from "react";
import { BarChart, Bar, Line, ComposedChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import * as XLSX from "xlsx";

/* ---------- Taxonomy (from ER_Navigator_Tool_Design.md v2) ---------- */
const STAGES = [
  { id: "reg", name: "Registration", reasons: ["Registration desk/system delay", "Missing/incorrect patient information"] },
  { id: "triage", name: "Triage", reasons: ["Waiting for triage nurse availability", "Re-triage required"] },
  { id: "resus", name: "Resus room", reasons: ["No resus bay available", "Equipment/monitor not available"] },
  { id: "exam", name: "Exam room", reasons: ["No exam room available", "Waiting for isolation/negative pressure room"] },
  { id: "inv", name: "Investigations", reasons: [
    "Lab: delay in sample collection",
    "Lab: delay in transport/pickup to lab",
    "Lab: delay in lab receiving specimen",
    "Lab: delay in processing",
    "Lab: delay in results release to ED",
    "Imaging: acquisition delay (CT)",
    "Imaging: acquisition delay (US)",
    "Imaging: acquisition delay (X-ray/KUB)",
    "Imaging: report delay",
    "Waiting for transport to imaging",
  ] },
  { id: "ref", name: "Referral / consulted team", needsDept: true, reasons: [
    "Awaiting consulted team response/callback",
    "Consulted team seen patient, awaiting plan",
    "Referral sent, awaiting acceptance",
    "Disagreement between teams on ownership",
  ] },
  { id: "dispo", name: "Disposition decision", reasons: ["Plan made, awaiting written admission order", "Awaiting senior/attending sign-off"] },
  { id: "adm", name: "Admission process", reasons: [
    "No bed available on accepting ward",
    "Bed available, awaiting transport/porter",
    "Bed available, awaiting nursing handover",
    "Referred out: no bed in accepting department",
    "Referred out: care not available on-site",
    "Waiting for RCC / transfer acceptance",
  ] },
  { id: "dc", name: "Discharge process", reasons: [
    "Awaiting discharge paperwork/prescription",
    "Awaiting pharmacy",
    "Awaiting patient transport home",
    "Patient signing DAMA",
    "Social/family factor delaying discharge",
  ] },
  { id: "admin", name: "Administrative / coordination", reasons: ["Bed coordinator office delay", "Fax/communication breakdown between units", "System/network downtime"] },
];
const OTHER = "Other";
const DEPTS = ["MROD", "Internal Medicine", "General Surgery", "ICU", "CCU", "Orthopedics", "Urology", "Neurology / Neurosurgery", "OB/GYN", "Psychiatry", "Radiology", "Respiratory Therapy", "ENT", "Ophthalmology", "Pediatrics", "Other"];
const WARDS = ["FMW", "MMW", "FSW", "MSW", "ICU", "CCU", "SDU", "OBW"];
const DISPOSITIONS = ["Admitted", "Discharged home", "Discharged DAMA", "Transferred to another facility", "Left without being seen", "Other"];
const SHIFTS = ["Morning", "Evening", "Night"];
const MILESTONES = [
  { id: "triage", label: "Triage" },
  { id: "room", label: "Resus / exam room" },
  { id: "physician", label: "First physician contact" },
  { id: "decision", label: "Disposition decided" },
  { id: "depart", label: "Left ED" },
];
const CONSULT_STEPS = [["consultedAt", "Consulted at"], ["seenAt", "Seen patient at"], ["repliedAt", "Replied / plan given at"]];
const INV_TYPES = [
  { id: "lab", name: "Lab", steps: [["orderedAt", "Ordered"], ["collectedAt", "Sample collected"], ["receivedAt", "Received by lab"], ["resultedAt", "Resulted"]] },
  { id: "ct", name: "CT", steps: [["orderedAt", "Ordered"], ["acquiredAt", "Scan done"], ["reportedAt", "Reported"]] },
  { id: "us", name: "Ultrasound", steps: [["orderedAt", "Ordered"], ["acquiredAt", "Scan done"], ["reportedAt", "Reported"]] },
  { id: "xr", name: "X-ray / KUB", steps: [["orderedAt", "Ordered"], ["acquiredAt", "Done"], ["reportedAt", "Reported"]] },
];
const ADM_STEPS = [["orderAt", "Admission order written"], ["bedRequestedAt", "Bed requested (fax sent)"], ["bedAssignedAt", "Bed assigned"], ["handoverAt", "Nursing handover done"]];
const TRANSFER_STEPS = [["requestedAt", "Transfer requested"], ["acceptedAt", "Accepted by facility"], ["transportAt", "RCC / transport arrived"]];
const STORAGE_KEY = "ernav:cases:v1";
const PREFS_KEY = "ernav:prefs:v1";

/* ---------- Palette ---------- */
const C = {
  bg: "#F5F7F5", ink: "#16243B", panel: "#FFFFFF", line: "#D6DCD7", muted: "#5B6673",
  accent: "#1F7A8C", accentSoft: "#E3F1F4", amber: "#C98A1B", red: "#B93A2E", plum: "#6B2058", ok: "#2E7D5B",
};

/* ---------- Helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const toLocal = (iso) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromLocal = (s) => (s ? new Date(s).toISOString() : "");
const nowLocal = () => toLocal(new Date().toISOString());
const hoursBetween = (a, b) => { if (!a || !b) return null; const h = (new Date(b) - new Date(a)) / 36e5; return h < 0 ? null : h; };
const fmtH = (h) => { if (h == null || isNaN(h)) return "–"; const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); return `${hh}h ${pad(mm)}m`; };
const fmtDT = (iso) => { if (!iso) return "–"; const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const endTime = (c) => (c.status === "resolved" ? (c.milestones?.depart || c.resolvedAt) : null);
const elapsedHours = (c, now) => hoursBetween(c.registrationTime, endTime(c) || now);
const bandColor = (h) => (h == null ? C.line : h >= 24 ? C.ink : h >= 12 ? C.plum : h >= 6 ? C.red : h >= 4 ? C.amber : C.ok);
const reasonLabel = (key) => key.split("::")[1] || key;
const stageOf = (key) => STAGES.find((s) => s.id === key.split("::")[0]);
const median = (arr) => { const a = arr.filter((x) => x != null && !isNaN(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const lastOf = (obj, steps) => { for (let i = steps.length - 1; i >= 0; i--) if (obj?.[steps[i][0]]) return obj[steps[i][0]]; return null; };
function timeWarnings(c) {
  const w = []; const reg = c.registrationTime;
  const chk = (a, b, la, lb) => { if (a && b && new Date(b) < new Date(a)) w.push(`${lb} is before ${la}`); };
  MILESTONES.forEach((m) => chk(reg, c.milestones?.[m.id], "registration", m.label));
  chk(c.milestones?.triage, c.milestones?.room, "triage", "room");
  Object.entries(c.consults || {}).forEach(([d, x]) => { chk(x.consultedAt, x.seenAt, `${d} consulted`, `${d} seen`); chk(x.seenAt, x.repliedAt, `${d} seen`, `${d} replied`); chk(x.repliedAt || x.seenAt || x.consultedAt, c.milestones?.depart ? undefined : undefined); });
  Object.entries(c.investigations || {}).forEach(([id, x]) => { const t = INV_TYPES.find((i) => i.id === id); if (!t) return; for (let i = 1; i < t.steps.length; i++) chk(x[t.steps[i - 1][0]], x[t.steps[i][0]], t.name + " " + t.steps[i - 1][1].toLowerCase(), t.name + " " + t.steps[i][1].toLowerCase()); });
  for (let i = 1; i < ADM_STEPS.length; i++) chk(c.admission?.[ADM_STEPS[i - 1][0]], c.admission?.[ADM_STEPS[i][0]], ADM_STEPS[i - 1][1].toLowerCase(), ADM_STEPS[i][1].toLowerCase());
  return w;
}
const lastActivity = (c) => { const ts = [c.createdAt, ...(c.updates || []).map((u) => u.time)].filter(Boolean); return ts.sort().slice(-1)[0]; };
const uid = () => Math.random().toString(36).slice(2, 10);
const needsReferralNo = (c) => (c.reasons || []).some((r) => r.startsWith("adm::Referred out") || r.startsWith("adm::Waiting for RCC")) || c.disposition === "Transferred to another facility";

function blankCase(prefs = {}) {
  return {
    id: uid(), mrn: "", registrationTime: new Date(Date.now() - 6 * 36e5).toISOString(), createdAt: new Date().toISOString(), navigator: prefs.navigator || "", shift: prefs.shift || "",
    stages: [], reasons: [], otherText: {}, primary: "", departments: [], referralTrackingNumber: "",
    milestones: {}, consults: {}, investigations: {}, admission: {}, transfer: {}, medAdminInformedAt: "", status: "open", disposition: "", ward: "", isolation: false, transferFacility: "",
    resolutionNote: "", updates: [], resolvedAt: "",
  };
}

const normalize = (c) => ({ ...blankCase(), ...c, milestones: c.milestones || {}, consults: c.consults || {}, investigations: c.investigations || {}, admission: c.admission || {}, transfer: c.transfer || {}, otherText: c.otherText || {}, updates: c.updates || [] });

/* ---------- Storage (artifact key-value API; falls back to memory) ---------- */
async function loadCases() {
  try { if (!window.storage) return null; const r = await window.storage.get(STORAGE_KEY, false); return r ? JSON.parse(r.value).map(normalize) : []; }
  catch (e) { return []; }
}
async function loadPrefs() { try { if (!window.storage) return {}; const r = await window.storage.get(PREFS_KEY, false); return r ? JSON.parse(r.value) : {}; } catch (e) { return {}; } }
async function savePrefs(p) { try { if (window.storage) await window.storage.set(PREFS_KEY, JSON.stringify(p), false); } catch (e) {} }
async function saveCases(cases) {
  try { if (!window.storage) return false; await window.storage.set(STORAGE_KEY, JSON.stringify(cases), false); return true; }
  catch (e) { return false; }
}

/* ---------- Synthetic sample data patterned on the WhatsApp extraction ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sampleCases() {
  const rnd = mulberry32(20260908); const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const now = Date.now(); const out = [];
  for (let i = 0; i < 30; i++) {
    const open = i < 8;
    const regHoursAgo = open ? 3 + rnd() * 11 : 24 + rnd() * 120;
    const reg = new Date(now - regHoursAgo * 36e5);
    const c = blankCase();
    c.id = "s" + i; c.mrn = String(100000 + Math.floor(rnd() * 900000)); c.registrationTime = reg.toISOString(); c.createdAt = new Date(reg.getTime() + 6.1 * 36e5).toISOString();
    c.navigator = pick(["Navigator A", "Navigator B", "Navigator C", "Navigator D"]); c.shift = pick(SHIFTS);
    const roll = rnd();
    const los = open ? regHoursAgo : 6 + rnd() * 10;
    const ms = {}; const t = (h) => new Date(reg.getTime() + h * 36e5).toISOString();
    ms.triage = t(0.2 + rnd() * 0.5); ms.room = t(0.8 + rnd() * 1.5); ms.physician = t(1.2 + rnd() * 1.5);
    const consult = (dept, from, cap) => { const seen = Math.max(from + 0.2, Math.min(from + 1 + rnd() * 5, cap - 0.6)); const replied = Math.max(seen + 0.1, Math.min(seen + 0.3 + rnd() * 2, cap - 0.2)); c.consults[dept] = { consultedAt: t(from), seenAt: (!open || rnd() > 0.4) ? t(seen) : "", repliedAt: (!open || rnd() > 0.6) ? t(replied) : "" }; };
    if (roll < 0.45) {
      c.stages = ["ref"]; const r = pick(STAGES.find((s) => s.id === "ref").reasons); c.reasons = ["ref::" + r]; c.primary = c.reasons[0];
      const dept = pick(["MROD", "General Surgery", "ICU", "Internal Medicine", "Orthopedics", "Neurology / Neurosurgery"]); c.departments = [dept]; consult(dept, 2 + rnd() * 1.5, los);
      if (rnd() > 0.6) { const d2 = pick(["ICU", "MROD", "General Surgery"].filter((x) => x !== dept)); c.departments.push(d2); consult(d2, Math.min(4 + rnd() * 2, los - 1), los); }
      if (rnd() > 0.5) { c.stages.push("adm"); c.reasons.push("adm::No bed available on accepting ward"); const ao = 5 + rnd(); c.admission = { orderAt: t(ao), bedRequestedAt: t(ao + 0.3) }; }
    } else if (roll < 0.7) {
      c.stages = ["adm"]; c.reasons = ["adm::No bed available on accepting ward"]; c.primary = c.reasons[0];
      const dept = pick(["MROD", "Internal Medicine", "General Surgery"]); c.departments = [dept]; consult(dept, 2, los); ms.decision = t(3.8 + rnd());
      const ao2 = 4 + rnd(); c.admission = { orderAt: t(ao2), bedRequestedAt: t(ao2 + 0.3) };
    } else if (roll < 0.8) {
      c.stages = ["admin"]; c.reasons = ["admin::Fax/communication breakdown between units"]; c.primary = c.reasons[0]; c.admission = { orderAt: t(3.5), bedRequestedAt: t(3.8) };
    } else if (roll < 0.92) {
      c.stages = ["inv"]; const inv = pick(["lab", "ct", "us", "xr"]); c.reasons = [inv === "lab" ? "inv::Lab: delay in results release to ED" : inv === "ct" ? "inv::Imaging: acquisition delay (CT)" : "inv::Imaging: report delay"]; c.primary = c.reasons[0];
      const o = 1.5 + rnd(); c.investigations[inv] = inv === "lab" ? { orderedAt: t(o), collectedAt: t(o + 0.5 + rnd()), receivedAt: t(o + 1.2 + rnd()), resultedAt: !open ? t(o + 3 + rnd() * 3) : "" } : { orderedAt: t(o), acquiredAt: t(o + 1 + rnd() * 3), reportedAt: !open ? t(o + 3 + rnd() * 3) : "" };
    } else {
      c.stages = ["dc"]; c.reasons = ["dc::Other"]; c.otherText = { dc: pick(["Family not answering phone for pickup", "Waiting for social worker"]) }; c.primary = c.reasons[0];
    }
    if (!open) {
      ms.depart = t(los); c.resolvedAt = ms.depart; c.status = "resolved";
      const d = i === 29 ? 0.97 : rnd();
      if (d < 0.7) { c.disposition = "Admitted"; c.ward = pick(WARDS); const base = c.admission.orderAt ? c.admission : { orderAt: t(Math.max(0.5, los - 2)), bedRequestedAt: t(Math.max(0.7, los - 1.8)) }; c.admission = { ...base, bedAssignedAt: t(los - 0.5), handoverAt: t(los - 0.2) }; }
      else if (d < 0.9) c.disposition = "Discharged home";
      else if (d < 0.95) c.disposition = "Discharged DAMA";
      else { c.disposition = "Transferred to another facility"; c.transferFacility = "Al Mouwasat"; c.referralTrackingNumber = "RCC-" + Math.floor(10000 + rnd() * 90000); c.transfer = { requestedAt: t(los - 4), acceptedAt: t(los - 2.5), transportAt: t(los - 0.3) }; }
      c.updates = [{ time: t(6.2), text: "Exceeded 6H, medical admin on-call informed", by: c.navigator }, { time: ms.depart, text: "Resolved: " + c.disposition, by: c.navigator }];
      c.medAdminInformedAt = t(6.2);
    } else {
      c.updates = [{ time: c.createdAt, text: "Case opened at 6H", by: c.navigator }];
      if (regHoursAgo > 6.5) c.medAdminInformedAt = t(6.3);
    }
    c.milestones = ms; out.push(c);
  }
  return out;
}

/* ---------- Small UI atoms ---------- */
const css = `
  .ernav * { box-sizing: border-box; }
  .ernav { font-family: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; color: ${C.ink}; background: ${C.bg}; min-height: 100vh; padding-bottom: 76px; }
  .ernav .num { font-variant-numeric: tabular-nums; }
  .ernav button, .ernav input, .ernav select, .ernav textarea { font: inherit; }
  .ernav button:focus-visible, .ernav input:focus-visible, .ernav select:focus-visible, .ernav textarea:focus-visible { outline: 3px solid ${C.accent}; outline-offset: 2px; }
  .ernav .chip { border: 1px solid ${C.line}; background: ${C.panel}; color: ${C.ink}; border-radius: 999px; padding: 8px 12px; font-size: 14px; line-height: 1.2; margin: 0 6px 8px 0; cursor: pointer; text-align: left; }
  .ernav .chip.on { background: ${C.accent}; border-color: ${C.accent}; color: #fff; }
  .ernav .chip.primary { box-shadow: 0 0 0 3px ${C.accentSoft}; }
  .ernav .field { display: block; margin-bottom: 14px; }
  .ernav .field > span { display: block; font-size: 13px; color: ${C.muted}; margin-bottom: 4px; }
  .ernav .input { width: 100%; border: 1px solid ${C.line}; border-radius: 8px; padding: 10px 12px; background: ${C.panel}; font-size: 16px; }
  .ernav .btn { border: none; border-radius: 10px; padding: 12px 16px; font-size: 15px; font-weight: 600; cursor: pointer; }
  .ernav .btn.main { background: ${C.accent}; color: #fff; }
  .ernav .btn.quiet { background: ${C.panel}; color: ${C.ink}; border: 1px solid ${C.line}; }
  .ernav .btn.danger { background: #fff; color: ${C.red}; border: 1px solid ${C.red}; }
  .ernav .section { background: ${C.panel}; border-top: 1px solid ${C.line}; border-bottom: 1px solid ${C.line}; padding: 16px; margin-bottom: 10px; }
  .ernav h2 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
  .ernav .row { display: flex; align-items: center; background: ${C.panel}; border-bottom: 1px solid ${C.line}; padding: 12px 14px 12px 0; cursor: pointer; }
  .ernav .band { width: 6px; align-self: stretch; margin-right: 12px; border-radius: 0 3px 3px 0; }
  .ernav .tabbar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; background: ${C.panel}; border-top: 1px solid ${C.line}; z-index: 5; }
  .ernav .tab { flex: 1; padding: 10px 0 12px; border: none; background: none; color: ${C.muted}; font-size: 13px; }
  .ernav .tab.on { color: ${C.accent}; font-weight: 700; }
  .ernav .fab { position: fixed; right: 16px; bottom: 66px; background: ${C.ink}; color: #fff; border: none; border-radius: 999px; padding: 14px 18px; font-size: 15px; font-weight: 700; box-shadow: 0 6px 16px rgba(22,36,59,.25); z-index: 6; }
  @media (prefers-reduced-motion: no-preference) { .ernav .chip { transition: background .12s; } }
  @media print { .ernav .no-print { display: none !important; } .ernav { padding-bottom: 0; background: #fff; } }
`;

function Chips({ options, value, onChange, primary, onPrimary, labelOf = (x) => x }) {
  return (
    <div>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" className={"chip" + (on ? " on" : "") + (primary === o ? " primary" : "")}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            onDoubleClick={() => onPrimary && on && onPrimary(o)}>
            {labelOf(o)}
          </button>
        );
      })}
    </div>
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, className }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3000); return () => clearTimeout(t); }, [armed]);
  return <button type="button" className={className} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? confirmLabel : label}</button>;
}

function TimeRow({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{ flex: 1, fontSize: 14 }}>{label}</div>
      <input className="input" style={{ width: 178, padding: "6px 8px", fontSize: 14 }} type="datetime-local" value={toLocal(value)} onChange={(e) => onChange(fromLocal(e.target.value))} />
      <button type="button" className="btn quiet" style={{ padding: "6px 8px", fontSize: 12 }} onClick={() => onChange(new Date().toISOString())}>Now</button>
    </div>
  );
}
function Chain({ steps, value, onChange }) {
  return <div>{steps.map(([k, label]) => <TimeRow key={k} label={label} value={value?.[k]} onChange={(v) => onChange({ ...(value || {}), [k]: v })} />)}</div>;
}

function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }

/* ---------- Case editor (new + existing) ---------- */
function CaseEditor({ initial, onSave, onDelete, onBack, now }) {
  const [c, setC] = useState(initial);
  const [update, setUpdate] = useState("");
  const [showTimeline, setShowTimeline] = useState(!!initial.mrn);
  const set = (patch) => setC((p) => ({ ...p, ...patch }));
  const isNew = !initial.mrn;
  const elapsed = elapsedHours(c, now);
  const warnings = timeWarnings(c);

  const toggleStage = (stages) => {
    const reasons = c.reasons.filter((r) => stages.includes(r.split("::")[0]));
    const otherText = Object.fromEntries(Object.entries(c.otherText || {}).filter(([k]) => stages.includes(k)));
    set({ stages, reasons, otherText, primary: reasons.includes(c.primary) ? c.primary : reasons[0] || "" });
  };
  const setReasons = (stageId, keys) => {
    const others = c.reasons.filter((r) => !r.startsWith(stageId + "::"));
    const reasons = [...others, ...keys];
    const otherText = { ...c.otherText };
    if (!keys.includes(stageId + "::" + OTHER)) delete otherText[stageId];
    set({ reasons, otherText, primary: reasons.includes(c.primary) ? c.primary : reasons[0] || "" });
  };
  const mrnOk = /^\d+$/.test(c.mrn);
  const canSave = mrnOk && c.registrationTime && c.reasons.length > 0;

  const addUpdate = () => { if (!update.trim()) return; set({ updates: [...c.updates, { time: new Date().toISOString(), text: update.trim(), by: c.navigator }] }); setUpdate(""); };
  const resolve = () => {
    const depart = c.milestones.depart || new Date().toISOString();
    const next = { ...c, status: "resolved", resolvedAt: depart, milestones: { ...c.milestones, depart }, updates: [...c.updates, { time: new Date().toISOString(), text: "Resolved: " + (c.disposition || "disposition not set"), by: c.navigator }] };
    onSave(next);
  };
  const reopen = () => onSave({ ...c, status: "open", resolvedAt: "", updates: [...c.updates, { time: new Date().toISOString(), text: "Reopened", by: c.navigator }] });

  return (
    <div>
      <div style={{ padding: "14px 16px 6px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }} className="no-print">
        <button className="btn quiet" onClick={onBack} style={{ padding: "8px 12px" }}>‹ Back</button>
        <div className="num" style={{ fontSize: 26, fontWeight: 700, color: bandColor(elapsed) }}>{fmtH(elapsed)}</div>
      </div>

      <div className="section">
        <h2>{isNew ? "New case" : `Case ${c.mrn}`}</h2>
        <Field label="MRN (digits only)">
          <input className="input num" inputMode="numeric" value={c.mrn} onChange={(e) => set({ mrn: e.target.value.replace(/\D/g, "") })} placeholder="e.g. 851557" />
        </Field>
        <Field label="Registration time (clock starts here)">
          <input className="input" type="datetime-local" value={toLocal(c.registrationTime)} max={nowLocal()} onChange={(e) => set({ registrationTime: fromLocal(e.target.value) })} />
          <div style={{ marginTop: 8 }}>
            {[4, 6, 8, 12].map((h) => (
              <button key={h} type="button" className="chip" onClick={() => set({ registrationTime: new Date(Date.now() - h * 36e5).toISOString() })}>{h}h ago</button>
            ))}
            <button type="button" className="chip" onClick={() => set({ registrationTime: new Date(new Date(c.registrationTime).getTime() - 18e5).toISOString() })}>−30m</button>
            <button type="button" className="chip" onClick={() => set({ registrationTime: new Date(new Date(c.registrationTime).getTime() + 18e5).toISOString() })}>+30m</button>
          </div>
          <div className="num" style={{ fontSize: 13, color: C.muted, marginTop: 6 }}>Waiting {fmtH(elapsed)} so far</div>
        </Field>
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="Navigator"><input className="input" value={c.navigator} onChange={(e) => set({ navigator: e.target.value })} placeholder="Your name" /></Field>
          <Field label="Shift"><select className="input" value={c.shift} onChange={(e) => set({ shift: e.target.value })}><option value="">Select</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div>
      </div>

      <div className="section">
        <h2>Where is the delay?</h2>
        <p style={{ margin: "0 0 10px", fontSize: 13, color: C.muted }}>Tap every stage that applies, then the reasons under each. If you pick more than one reason, choose the primary one below.</p>
        <Chips options={STAGES.map((s) => s.id)} value={c.stages} onChange={toggleStage} labelOf={(id) => STAGES.find((s) => s.id === id).name} />
        {c.stages.map((sid) => {
          const st = STAGES.find((s) => s.id === sid);
          const keys = [...st.reasons, OTHER].map((r) => sid + "::" + r);
          const mine = c.reasons.filter((r) => r.startsWith(sid + "::"));
          return (
            <div key={sid} style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{st.name}</div>
              <Chips options={keys} value={mine} onChange={(v) => setReasons(sid, v)} primary={c.primary} onPrimary={(k) => set({ primary: k })} labelOf={reasonLabel} />
              {mine.includes(sid + "::" + OTHER) && (
                <input className="input" placeholder="Describe the other reason (goes to the review queue)" value={c.otherText[sid] || ""} onChange={(e) => set({ otherText: { ...c.otherText, [sid]: e.target.value } })} />
              )}
            </div>
          );
        })}
        {c.reasons.length > 1 && (
          <Field label="Primary reason (the biggest contributor)">
            <select className="input" value={c.primary} onChange={(e) => set({ primary: e.target.value })}>{c.reasons.map((r) => <option key={r} value={r}>{stageOf(r)?.name}: {reasonLabel(r)}</option>)}</select>
          </Field>
        )}
      </div>

      {(c.stages.some((s) => STAGES.find((x) => x.id === s)?.needsDept) || c.stages.includes("adm") || c.stages.includes("dispo")) && (
        <div className="section">
          <h2>Department / consulted team involved</h2>
          <Chips options={DEPTS} value={c.departments} onChange={(v) => set({ departments: v })} />
          {c.departments.map((d) => (
            <div key={d} style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{d}</div>
              <Chain steps={CONSULT_STEPS} value={c.consults[d]} onChange={(v) => set({ consults: { ...c.consults, [d]: v } })} />
            </div>
          ))}
        </div>
      )}

      {c.stages.includes("inv") && (
        <div className="section">
          <h2>Investigation times</h2>
          <Chips options={INV_TYPES.map((i) => i.id)} value={Object.keys(c.investigations)} labelOf={(id) => INV_TYPES.find((i) => i.id === id).name}
            onChange={(v) => { const next = {}; v.forEach((id) => (next[id] = c.investigations[id] || {})); set({ investigations: next }); }} />
          {Object.keys(c.investigations).map((id) => { const inv = INV_TYPES.find((i) => i.id === id); return (
            <div key={id} style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${C.line}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{inv.name}</div>
              <Chain steps={inv.steps} value={c.investigations[id]} onChange={(v) => set({ investigations: { ...c.investigations, [id]: v } })} />
            </div>); })}
        </div>
      )}

      {(c.stages.includes("adm") || c.disposition === "Admitted") && (
        <div className="section">
          <h2>Admission times</h2>
          <Chain steps={ADM_STEPS} value={c.admission} onChange={(v) => set({ admission: v })} />
        </div>
      )}

      {needsReferralNo(c) && (
        <div className="section">
          <h2>Referral out</h2>
          <Field label="Referral tracking number"><input className="input" value={c.referralTrackingNumber} onChange={(e) => set({ referralTrackingNumber: e.target.value })} placeholder="e.g. RCC-48213" /></Field>
          <Field label="Receiving facility"><input className="input" value={c.transferFacility} onChange={(e) => set({ transferFacility: e.target.value })} placeholder="e.g. Al Mouwasat, Erada" /></Field>
          <Chain steps={TRANSFER_STEPS} value={c.transfer} onChange={(v) => set({ transfer: v })} />
        </div>
      )}

      <div className="section">
        <button type="button" className="btn quiet" style={{ width: "100%", textAlign: "left" }} onClick={() => setShowTimeline(!showTimeline)}>
          {showTimeline ? "Hide" : "Add"} journey times (optional)
        </button>
        {showTimeline && (
          <div style={{ marginTop: 12 }}>
            {MILESTONES.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, fontSize: 12, color: C.muted, marginBottom: 8 }} className="num">{i + 1}</div>
                <div style={{ flex: 1 }}><TimeRow label={m.label} value={c.milestones[m.id]} onChange={(v) => set({ milestones: { ...c.milestones, [m.id]: v } })} /></div>
              </div>
            ))}
            <Field label="Medical admin on-call informed at">
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" type="datetime-local" value={toLocal(c.medAdminInformedAt)} onChange={(e) => set({ medAdminInformedAt: fromLocal(e.target.value) })} />
                <button type="button" className="btn quiet" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => set({ medAdminInformedAt: new Date().toISOString() })}>Now</button>
              </div>
            </Field>
          </div>
        )}
      </div>

      {!isNew && (
        <div className="section">
          <h2>Updates</h2>
          {c.updates.length === 0 && <p style={{ fontSize: 13, color: C.muted, margin: "0 0 8px" }}>No updates yet. Add one when something changes.</p>}
          {c.updates.map((u, i) => (
            <div key={i} style={{ fontSize: 14, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
              <span className="num" style={{ color: C.muted, marginRight: 8 }}>{fmtDT(u.time)}</span>{u.text}{u.by ? <span style={{ color: C.muted }}> · {u.by}</span> : null}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input className="input" value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="What changed?" onKeyDown={(e) => e.key === "Enter" && addUpdate()} />
            <button type="button" className="btn main" onClick={addUpdate}>Add</button>
          </div>
        </div>
      )}

      {!isNew && (
        <div className="section">
          <h2>{c.status === "resolved" ? "Resolved" : "Resolve case"}</h2>
          <Field label="Final disposition">
            <select className="input" value={c.disposition} onChange={(e) => set({ disposition: e.target.value })}><option value="">Select</option>{DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}</select>
          </Field>
          {c.disposition === "Admitted" && (
            <div>
              <Field label="Ward"><Chips options={WARDS} value={c.ward ? [c.ward] : []} onChange={(v) => set({ ward: v[v.length - 1] || "" })} /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, marginBottom: 12 }}><input type="checkbox" checked={c.isolation} onChange={(e) => set({ isolation: e.target.checked })} /> Isolation / negative pressure room</label>
            </div>
          )}
          <Field label="Left ED at (defaults to now)"><input className="input" type="datetime-local" value={toLocal(c.milestones.depart)} onChange={(e) => set({ milestones: { ...c.milestones, depart: fromLocal(e.target.value) } })} /></Field>
          <Field label="Resolution note (optional)"><input className="input" value={c.resolutionNote} onChange={(e) => set({ resolutionNote: e.target.value })} /></Field>
          {c.status === "open"
            ? <button type="button" className="btn main" style={{ width: "100%" }} disabled={!c.disposition} onClick={resolve}>Mark resolved</button>
            : <button type="button" className="btn quiet" style={{ width: "100%" }} onClick={reopen}>Reopen case</button>}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="section" style={{ borderLeft: `4px solid ${C.amber}` }}>
          <h2 style={{ color: C.amber }}>Check these times</h2>
          {warnings.map((w, i) => <div key={i} style={{ fontSize: 13, padding: "3px 0" }}>{w}</div>)}
          <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>You can still save. Out-of-order times are left out of the averages.</p>
        </div>
      )}
      <div style={{ padding: 16, display: "flex", gap: 10 }} className="no-print">
        <button type="button" className="btn main" style={{ flex: 1 }} disabled={!canSave} onClick={() => onSave(c)}>{isNew ? "Open case" : "Save changes"}</button>
        {!isNew && <ConfirmButton className="btn danger" label="Delete" confirmLabel="Tap again to delete" onConfirm={() => onDelete(c.id)} />}
      </div>
      {!canSave && <p style={{ margin: "0 16px 16px", fontSize: 13, color: C.muted }}>{!mrnOk ? "Enter the MRN as digits only." : c.reasons.length === 0 ? "Select at least one delay reason." : ""}</p>}
    </div>
  );
}

/* ---------- Board (handover view) ---------- */
function Board({ cases, now, filter, setFilter, onOpen }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const f = cases.filter((c) => (filter === "all" ? true : c.status === filter)).filter((c) => (q ? c.mrn.includes(q.replace(/\D/g, "")) : true));
    return f.sort((a, b) => (elapsedHours(b, now) || 0) - (elapsedHours(a, now) || 0));
  }, [cases, now, filter, q]);
  const open = cases.filter((c) => c.status === "open");
  const over6 = open.filter((c) => elapsedHours(c, now) >= 6).length;
  const over12 = open.filter((c) => elapsedHours(c, now) >= 12).length;
  return (
    <div>
      <div style={{ padding: "18px 16px 10px" }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>ER board</div>
        <div style={{ fontSize: 14, color: C.muted, marginTop: 2 }} className="num">{open.length} open · {over6} past 6h · {over12} past 12h</div>
      </div>
      <div style={{ padding: "0 16px 10px" }} className="no-print">
        <input className="input num" inputMode="numeric" placeholder="Search MRN" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8 }}>
          {[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => (
            <button key={k} type="button" className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {list.length === 0 && (
        <div className="section" style={{ textAlign: "center", color: C.muted, padding: 28 }}>
          {q ? `No case matching ${q}.` : filter === "open" ? "No open cases. Tap New case when a patient passes the threshold, or load sample data from the Dashboard." : "Nothing here yet."}
        </div>
      )}
      {list.map((c) => {
        const h = elapsedHours(c, now);
        const idle = c.status === "open" ? hoursBetween(lastActivity(c), new Date(now).toISOString()) : null;
        return (
          <div key={c.id} className="row" onClick={() => onOpen(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(c.id)}>
            <div className="band" style={{ background: bandColor(h) }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="num" style={{ fontWeight: 700, fontSize: 16 }}>{c.mrn}</span>
                <span style={{ fontSize: 12, color: C.muted }} className="num">reg {fmtDT(c.registrationTime)}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.primary ? reasonLabel(c.primary) : "No reason set"}{c.departments.length ? ` · ${c.departments.join(", ")}` : ""}
              </div>
              {c.status === "resolved"
                ? <div style={{ fontSize: 12, color: C.ok, marginTop: 2 }}>{c.disposition}{c.ward ? ` · ${c.ward}` : ""}</div>
                : <div className="num" style={{ fontSize: 12, marginTop: 2, color: idle >= 2 ? C.amber : C.muted, fontWeight: idle >= 2 ? 600 : 400 }}>
                    {idle == null ? "" : idle >= 2 ? `No update for ${fmtH(idle)}` : `Updated ${fmtH(idle)} ago`}
                  </div>}
            </div>
            <div className="num" style={{ fontSize: 20, fontWeight: 700, color: bandColor(h), marginLeft: 8, whiteSpace: "nowrap" }}>{fmtH(h)}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Dashboard ---------- */
const RANGES = [["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["all", "All time"]];
const MIN_N = 3;

function Dashboard({ cases: allCases, now, onLoadSample, onClear, storageOk, onOpen }) {
  const [range, setRange] = useState("30");
  const [drill, setDrill] = useState(null);
  const cases = useMemo(() => (range === "all" ? allCases : allCases.filter((c) => now - new Date(c.registrationTime) <= Number(range) * 864e5)), [allCases, range, now]);
  const open = cases.filter((c) => c.status === "open");
  const resolved = cases.filter((c) => c.status === "resolved");
  const medLOS = median(resolved.map((c) => elapsedHours(c, now)));
  const count = (arr, keyFn) => { const m = {}; arr.forEach((c) => (keyFn(c) || []).forEach((k) => { if (k) m[k] = (m[k] || 0) + 1; })); return Object.entries(m).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value); };
  const byPrimary = count(cases, (c) => [c.primary && reasonLabel(c.primary)]).slice(0, 8);
  const byStage = count(cases, (c) => c.stages.map((s) => STAGES.find((x) => x.id === s)?.name));
  const byDept = count(cases, (c) => c.departments).slice(0, 8);
  const byDispo = count(resolved, (c) => [c.disposition]);
  const byShift = SHIFTS.map((sh) => ({ name: sh, value: cases.filter((c) => c.shift === sh).length, med: median(cases.filter((c) => c.shift === sh).map((c) => elapsedHours(c, now))) })).filter((r) => r.value);
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byDay = DAYS.map((d, i) => ({ name: d, value: cases.filter((c) => new Date(c.registrationTime).getDay() === i).length })).filter((r) => r.value);

  const weeks = useMemo(() => {
    if (!cases.length) return [];
    const key = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x.toISOString().slice(0, 10); };
    const m = {};
    cases.forEach((c) => { const k = key(c.registrationTime); (m[k] = m[k] || []).push(c); });
    return Object.entries(m).sort().map(([k, v]) => ({ name: k.slice(5), cases: v.length, med: median(v.map((c) => elapsedHours(c, now))), over12: v.filter((c) => elapsedHours(c, now) >= 12).length }));
  }, [cases, now]);

  const consultRows = DEPTS.map((d) => {
    const cs = cases.filter((c) => c.consults?.[d]?.consultedAt);
    const x = cs.map((c) => c.consults[d]);
    return { name: d, n: cs.length, ids: cs.map((c) => c.id), toSeen: median(x.map((v) => hoursBetween(v.consultedAt, v.seenAt))), toReply: median(x.map((v) => hoursBetween(v.consultedAt, v.repliedAt))) };
  }).filter((r) => r.n > 0).sort((a, b) => (b.toReply ?? b.toSeen ?? 0) - (a.toReply ?? a.toSeen ?? 0));
  const invRows = INV_TYPES.map((t) => {
    const cs = cases.filter((c) => c.investigations?.[t.id]?.orderedAt);
    const xs = cs.map((c) => c.investigations[t.id]); const last = t.steps[t.steps.length - 1][0]; const mid = t.steps[1][0];
    return { name: t.name, n: cs.length, ids: cs.map((c) => c.id), toMid: median(xs.map((x) => hoursBetween(x.orderedAt, x[mid]))), toDone: median(xs.map((x) => hoursBetween(x.orderedAt, x[last]))) };
  }).filter((r) => r.n > 0);
  const adm = cases.map((c) => c.admission || {});
  const admStats = { n: adm.filter((a) => a.orderAt).length, orderToBed: median(adm.map((a) => hoursBetween(a.orderAt, a.bedAssignedAt))), requestToBed: median(adm.map((a) => hoursBetween(a.bedRequestedAt, a.bedAssignedAt))), bedToLeave: median(cases.map((c) => hoursBetween(c.admission?.bedAssignedAt, c.milestones?.depart))) };
  const otherQueue = cases.flatMap((c) => Object.entries(c.otherText || {}).filter(([, t]) => t).map(([sid, t]) => ({ stage: STAGES.find((s) => s.id === sid)?.name, text: t, mrn: c.mrn, id: c.id })));

  const med = (v, n) => (n < MIN_N ? <span style={{ color: C.muted }}>n&lt;{MIN_N}</span> : fmtH(v));
  const Tile = ({ label, value, color }) => (
    <div style={{ flex: 1, minWidth: 0, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px" }}>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: color || C.ink }}>{value}</div>
      <div style={{ fontSize: 12, color: C.muted }}>{label}</div>
    </div>
  );
  const HBar = ({ data, valueKey = "value", fmt, color = C.accent, onPick }) => (
    <div style={{ height: Math.max(120, data.length * 30) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 36, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11, fill: C.ink }} interval={0} />
          <Tooltip formatter={(v) => (fmt ? fmt(v) : v)} />
          <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} onClick={onPick} cursor={onPick ? "pointer" : "default"} label={{ position: "right", fontSize: 11, formatter: (v) => (fmt ? fmt(v) : v) }}>
            {data.map((_, i) => <Cell key={i} fill={color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  const Table = ({ head, rows, onPick }) => (
    <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead><tr style={{ color: C.muted, fontSize: 12 }}>{head.map((h, i) => <th key={i} style={{ padding: "4px 0", fontWeight: 500, textAlign: i ? "right" : "left" }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} style={{ borderTop: `1px solid ${C.line}`, cursor: onPick ? "pointer" : "default" }} onClick={() => onPick && onPick(i)}>
          {r.map((v, j) => <td key={j} style={{ padding: "7px 0", textAlign: j ? "right" : "left", fontWeight: j === 0 ? 600 : 400 }}>{v}</td>)}
        </tr>))}
      </tbody>
    </table>
  );

  if (drill) {
    const list = allCases.filter((c) => drill.ids.includes(c.id)).sort((a, b) => (elapsedHours(b, now) || 0) - (elapsedHours(a, now) || 0));
    return (
      <div>
        <div style={{ padding: "14px 16px 6px" }} className="no-print"><button className="btn quiet" onClick={() => setDrill(null)} style={{ padding: "8px 12px" }}>‹ Dashboard</button></div>
        <div style={{ padding: "4px 16px 10px" }}><div style={{ fontSize: 20, fontWeight: 700 }}>{drill.label}</div><div className="num" style={{ fontSize: 13, color: C.muted }}>{list.length} cases</div></div>
        {list.map((c) => (
          <div key={c.id} className="row" onClick={() => onOpen(c.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(c.id)}>
            <div className="band" style={{ background: bandColor(elapsedHours(c, now)) }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="num" style={{ fontWeight: 700 }}>{c.mrn}</div>
              <div style={{ fontSize: 13, color: C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.primary ? reasonLabel(c.primary) : ""}{c.disposition ? ` · ${c.disposition}` : ""}</div>
            </div>
            <div className="num" style={{ fontWeight: 700, color: bandColor(elapsedHours(c, now)) }}>{fmtH(elapsedHours(c, now))}</div>
          </div>
        ))}
      </div>
    );
  }

  const pickBy = (label, fn) => setDrill({ label, ids: cases.filter(fn).map((c) => c.id) });

  return (
    <div>
      <div style={{ padding: "18px 16px 10px" }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Dashboard</div>
        <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{cases.length} of {allCases.length} cases{storageOk ? "" : " · storage unavailable, data lives in this session only"}</div>
      </div>
      <div style={{ padding: "0 16px 12px" }} className="no-print">
        {RANGES.map(([k, l]) => <button key={k} type="button" className={"chip" + (range === k ? " on" : "")} onClick={() => setRange(k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, padding: "0 16px 12px" }}>
        <Tile label="Open now" value={open.length} />
        <Tile label="Open past 6h" value={open.filter((c) => elapsedHours(c, now) >= 6).length} color={C.red} />
        <Tile label="Median LOS, resolved" value={resolved.length < MIN_N ? "n<3" : fmtH(medLOS)} />
      </div>
      {cases.length > 0 && (
        <div className="section">
          <h2>Cases past each threshold</h2>
          <Table head={["Threshold", "Open now", "All cases"]} onPick={(i) => { const t = [4, 6, 12, 24][i]; pickBy(`Cases over ${t}h`, (c) => elapsedHours(c, now) >= t); }}
            rows={[4, 6, 12, 24].map((t) => [<span style={{ color: bandColor(t) }}>Over {t}h</span>, open.filter((c) => elapsedHours(c, now) >= t).length, cases.filter((c) => elapsedHours(c, now) >= t).length])} />
          <p style={{ fontSize: 12, color: C.muted, margin: "8px 0 0" }}>Tap a row to see the cases. Open now counts wait so far; All cases counts total stay including resolved.</p>
        </div>
      )}
      {cases.length === 0 ? (
        <div className="section" style={{ textAlign: "center", padding: 24 }}>
          <p style={{ margin: "0 0 12px", color: C.muted }}>{allCases.length ? "No cases registered in this range." : "No data yet. Load 30 synthetic cases patterned on your WhatsApp history to see the dashboard working."}</p>
          {!allCases.length && <button type="button" className="btn main" onClick={onLoadSample}>Load sample data</button>}
        </div>
      ) : (
        <>
          {weeks.length > 1 && (
            <div className="section"><h2>By week: cases and median stay</h2>
              <div style={{ height: 190 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={weeks} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: C.muted }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 11, fill: C.muted }} width={28} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: C.muted }} width={28} />
                    <Tooltip formatter={(v, n) => (n === "med" ? fmtH(v) : v)} />
                    <Bar yAxisId="l" dataKey="cases" fill={C.accentSoft} stroke={C.accent} radius={[3, 3, 0, 0]} name="cases" />
                    <Line yAxisId="r" type="monotone" dataKey="med" stroke={C.red} strokeWidth={2} dot={{ r: 3 }} name="med" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: 12, color: C.muted, margin: "6px 0 0" }}>Bars: cases flagged that week. Line: median total ED stay.</p>
            </div>
          )}
          <div className="section"><h2>Primary delay reason</h2><HBar data={byPrimary} onPick={(d) => pickBy(d.name, (c) => c.primary && reasonLabel(c.primary) === d.name)} /></div>
          <div className="section"><h2>Journey stage where delays occur</h2><HBar data={byStage} color={C.ink} onPick={(d) => pickBy(d.name, (c) => c.stages.some((s) => STAGES.find((x) => x.id === s)?.name === d.name))} /></div>
          <div className="section"><h2>Departments involved</h2><HBar data={byDept} color={C.plum} onPick={(d) => pickBy(d.name, (c) => c.departments.includes(d.name))} /></div>
          <div className="section"><h2>Consulted team response, median</h2>
            {consultRows.length ? <Table head={["Team", "n", "To seen", "To reply"]} onPick={(i) => setDrill({ label: consultRows[i].name, ids: consultRows[i].ids })}
              rows={consultRows.map((r) => [r.name, r.n, med(r.toSeen, r.n), med(r.toReply, r.n)])} />
              : <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Enter consulted, seen, and replied times under each team to see this.</p>}
          </div>
          <div className="section"><h2>Investigation turnaround, median from order</h2>
            {invRows.length ? <Table head={["Test", "n", "To done", "To result"]} onPick={(i) => setDrill({ label: invRows[i].name, ids: invRows[i].ids })}
              rows={invRows.map((r) => [r.name, r.n, med(r.toMid, r.n), med(r.toDone, r.n)])} />
              : <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Enter investigation times under a case to see this.</p>}
          </div>
          <div className="section"><h2>Admission chain, median</h2>
            {admStats.n ? <Table head={["Step", "Hours"]} rows={[["Order written to bed assigned", med(admStats.orderToBed, admStats.n)], ["Bed requested to bed assigned", med(admStats.requestToBed, admStats.n)], ["Bed assigned to left ED", med(admStats.bedToLeave, admStats.n)]]} />
              : <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Enter admission times under a case to see this.</p>}
          </div>
          {byShift.length > 0 && (
            <div className="section"><h2>By shift</h2>
              <Table head={["Shift", "Cases", "Median stay"]} onPick={(i) => pickBy(byShift[i].name + " shift", (c) => c.shift === byShift[i].name)}
                rows={byShift.map((r) => [r.name, r.value, med(r.med, r.value)])} />
            </div>
          )}
          {byDay.length > 1 && <div className="section"><h2>By day of week</h2><HBar data={byDay} color={C.muted} onPick={(d) => pickBy(d.name, (c) => DAYS[new Date(c.registrationTime).getDay()] === d.name)} /></div>}
          <div className="section"><h2>Final disposition</h2><HBar data={byDispo} color={C.ok} onPick={(d) => pickBy(d.name, (c) => c.disposition === d.name)} /></div>
          <div className="section">
            <h2>Other reasons awaiting review ({otherQueue.length})</h2>
            {otherQueue.length === 0 ? <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>Nothing queued. Anything typed into an "Other" box shows up here so it can be promoted to a real category.</p>
              : otherQueue.map((q, i) => <div key={i} onClick={() => onOpen(q.id)} style={{ fontSize: 14, padding: "6px 0", borderBottom: `1px solid ${C.line}`, cursor: "pointer" }}><span style={{ color: C.muted }}>{q.stage} · {q.mrn}</span><br />{q.text}</div>)}
          </div>
          <div style={{ padding: 16, display: "flex", gap: 10 }} className="no-print">
            <button type="button" className="btn quiet" onClick={onLoadSample}>Reload sample data</button>
            <ConfirmButton className="btn danger" label="Clear all" confirmLabel="Tap again to clear all" onConfirm={onClear} />
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Export ---------- */
function ExportPanel({ cases, now }) {
  const d = new Date(now); const weekAgo = new Date(now - 7 * 864e5);
  const [from, setFrom] = useState(toLocal(weekAgo.toISOString()).slice(0, 10));
  const [to, setTo] = useState(toLocal(d.toISOString()).slice(0, 10));
  const inRange = cases.filter((c) => { const r = c.registrationTime.slice(0, 10); return r >= from && r <= to; });
  const download = () => {
    const rows = inRange.map((c) => ({
      MRN: c.mrn, Status: c.status, Registration: fmtDT(c.registrationTime), "Left ED": fmtDT(endTime(c)),
      "Total ED hours (resolved)": c.status === "resolved" ? elapsedHours(c, now)?.toFixed(2) : "",
      "Hours waiting so far (open)": c.status === "open" ? elapsedHours(c, now)?.toFixed(2) : "",
      Weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(c.registrationTime).getDay()],
      Shift: c.shift, Navigator: c.navigator, Stages: c.stages.map((s) => STAGES.find((x) => x.id === s)?.name).join("; "),
      "Primary reason": c.primary ? `${stageOf(c.primary)?.name}: ${reasonLabel(c.primary)}` : "", "All reasons": c.reasons.map((r) => `${stageOf(r)?.name}: ${reasonLabel(r)}`).join("; "),
      "Other text": Object.values(c.otherText || {}).filter(Boolean).join("; "), Departments: c.departments.join("; "), "Referral tracking no.": c.referralTrackingNumber, "Receiving facility": c.transferFacility,
      Disposition: c.disposition, Ward: c.ward, Isolation: c.isolation ? "Yes" : "", "Med admin informed": fmtDT(c.medAdminInformedAt),
      ...Object.fromEntries(MILESTONES.map((m) => [m.label, fmtDT(c.milestones[m.id])])),
      ...Object.fromEntries(ADM_STEPS.map(([k, l]) => [l, fmtDT(c.admission?.[k])])),
      "Order to bed (h)": hoursBetween(c.admission?.orderAt, c.admission?.bedAssignedAt)?.toFixed(2) || "",
      ...Object.fromEntries(TRANSFER_STEPS.map(([k, l]) => [l, fmtDT(c.transfer?.[k])])),
      Note: c.resolutionNote,
    }));
    const updates = inRange.flatMap((c) => c.updates.map((u) => ({ MRN: c.mrn, Time: fmtDT(u.time), Update: u.text, By: u.by })));
    const consults = inRange.flatMap((c) => Object.entries(c.consults || {}).map(([d, x]) => ({ MRN: c.mrn, Team: d, "Consulted at": fmtDT(x.consultedAt), "Seen at": fmtDT(x.seenAt), "Replied at": fmtDT(x.repliedAt), "Consult to seen (h)": hoursBetween(x.consultedAt, x.seenAt)?.toFixed(2) || "", "Consult to reply (h)": hoursBetween(x.consultedAt, x.repliedAt)?.toFixed(2) || "" })));
    const invs = inRange.flatMap((c) => Object.entries(c.investigations || {}).map(([id, x]) => { const t = INV_TYPES.find((i) => i.id === id); const last = t.steps[t.steps.length - 1][0]; return { MRN: c.mrn, Test: t.name, ...Object.fromEntries(t.steps.map(([k, l]) => [l, fmtDT(x[k])])), "Order to result (h)": hoursBetween(x.orderedAt, x[last])?.toFixed(2) || "" }; }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Cases");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(consults), "Consults");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invs), "Investigations");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(updates), "Updates");
    XLSX.writeFile(wb, `ER_Navigator_${from}_to_${to}.xlsx`);
  };
  return (
    <div>
      <div style={{ padding: "18px 16px 10px" }}><div style={{ fontSize: 22, fontWeight: 700 }}>Export and print</div></div>
      <div className="section">
        <div style={{ display: "flex", gap: 10 }}>
          <Field label="From (registration date)"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p style={{ fontSize: 14, margin: "0 0 12px" }} className="num">{inRange.length} case{inRange.length === 1 ? "" : "s"} in range</p>
        <button type="button" className="btn main" style={{ width: "100%", marginBottom: 10 }} disabled={!inRange.length} onClick={download}>Download Excel</button>
        <button type="button" className="btn quiet" style={{ width: "100%" }} onClick={() => window.print()}>Print current screen</button>
        <p style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Print from the Dashboard or Board tab for a report of that view. The Excel file has Cases (one row per case), Consults (one row per team per case), Investigations (one row per test per case), and Updates sheets.</p>
      </div>
    </div>
  );
}

/* ---------- App ---------- */
export default function ERNavigatorTracker() {
  const [cases, setCases] = useState([]);
  const [prefs, setPrefs] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [tab, setTab] = useState("board");
  const [view, setView] = useState({ type: "list" });
  const [filter, setFilter] = useState("open");
  const [now, setNow] = useState(Date.now());
  const first = useRef(true);

  useEffect(() => { loadCases().then((c) => { if (c === null) { setStorageOk(false); setCases([]); } else setCases(c); setLoaded(true); }); loadPrefs().then(setPrefs); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  useEffect(() => { if (!loaded) return; if (first.current) { first.current = false; return; } saveCases(cases).then((ok) => { if (!ok && window.storage) setStorageOk(false); }); }, [cases, loaded]);

  const upsert = (c) => {
    setCases((p) => (p.some((x) => x.id === c.id) ? p.map((x) => (x.id === c.id ? c : x)) : [c, ...p]));
    if (c.navigator || c.shift) { const np = { navigator: c.navigator, shift: c.shift }; setPrefs(np); savePrefs(np); }
    setView({ type: "list" });
  };
  const remove = (id) => { setCases((p) => p.filter((x) => x.id !== id)); setView({ type: "list" }); };

  const current = view.type === "detail" ? cases.find((c) => c.id === view.id) : null;

  return (
    <div className="ernav">
      <style>{css}</style>
      {view.type === "new" && <CaseEditor initial={blankCase(prefs)} onSave={upsert} onBack={() => setView({ type: "list" })} now={now} />}
      {view.type === "detail" && current && <CaseEditor key={current.id} initial={current} onSave={upsert} onDelete={remove} onBack={() => setView({ type: "list" })} now={now} />}
      {view.type === "list" && tab === "board" && <Board cases={cases} now={now} filter={filter} setFilter={setFilter} onOpen={(id) => setView({ type: "detail", id })} />}
      {view.type === "list" && tab === "dash" && <Dashboard cases={cases} now={now} storageOk={storageOk} onOpen={(id) => setView({ type: "detail", id })} onLoadSample={() => setCases(sampleCases())} onClear={() => setCases([])} />}
      {view.type === "list" && tab === "export" && <ExportPanel cases={cases} now={now} />}

      {view.type === "list" && tab === "board" && <button type="button" className="fab no-print" onClick={() => setView({ type: "new" })}>+ New case</button>}
      {view.type === "list" && (
        <nav className="tabbar no-print">
          {[["board", "Board"], ["dash", "Dashboard"], ["export", "Export"]].map(([k, l]) => (
            <button key={k} type="button" className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>{l}</button>
          ))}
        </nav>
      )}
    </div>
  );
}
