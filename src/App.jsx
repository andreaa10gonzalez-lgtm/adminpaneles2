import { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, AreaChart, Area } from "recharts";
import { supabase } from "./supabase.js";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SA = { user: "admin", pass: "admin2024" };
const DIAS = [
  { id: "lun", label: "Lun" }, { id: "mar", label: "Mar" },
  { id: "mie", label: "Mié" }, { id: "jue", label: "Jue" },
  { id: "vie", label: "Vie" }, { id: "sab", label: "Sáb" },
  { id: "dom", label: "Dom" },
];
const DIA_MAP = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = {
  bg: "#0d0b1a",
  card: "#13102a",
  border: "#2a1f4a",
  accent: "#9f67ff",
  text: "#f1f5f9",
  muted: "#475569",
};

// ─── UTILS ───────────────────────────────────────────────────────────────────
const parseMonto = (s) => parseFloat(String(s || "").replace(/\./g, "").replace(",", ".").trim()) || 0;
const fmt = (v) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v || 0);
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthLabel = (off = 0) => { const d = new Date(); d.setMonth(d.getMonth() + off); return d.toLocaleString("es-AR", { month: "long", year: "numeric" }); };
const cmk = () => new Date().toISOString().slice(0, 7);
const pmk = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };
const pct = (c, p) => !p ? (c > 0 ? 100 : 0) : (((c - p) / p) * 100).toFixed(1);
const sumK = (arr, k) => arr.reduce((s, e) => s + (e[k] || 0), 0);
const cajaKey = (date, tid) => `${date}__${tid}`;
const getHorarioLabel = (session) => {
  const diaHoy = DIA_MAP[new Date().getDay()];
  const horDia = (session.horarios || {})[diaHoy + "_ini"] || "";
  const horFin = (session.horarios || {})[diaHoy + "_fin"] || "";
  if (horDia) return `${horDia}${horFin ? " – " + horFin : ""}`;
  if (session.horario_inicio) return `${session.horario_inicio}${session.horario_fin ? " – " + session.horario_fin : ""}`;
  return "Mi turno";
};
const calcCaja = (caja, bills) => {
  const tI = bills.reduce((s, b) => s + (+(caja.inicio?.[b.id] || 0)), 0);
  const tC = bills.reduce((s, b) => s + (+(caja.cierre?.[b.id] || 0)), 0);
  const totalBajas = (caja.bajas || []).reduce((s, b) => s + (+b.monto || 0), 0);
  const totalBonos = (caja.bonos || []).reduce((s, b) => s + (+b.monto || 0), 0);
  return { tI, tC, totalBajas, totalBonos, mov: tC - tI + totalBajas - totalBonos };
};

// ─── CSV PARSER ──────────────────────────────────────────────────────────────
const parseCSV = (text, existingPFS = {}) => {
  const lines = text.trim().split("\n").slice(1);
  const events = [];
  lines.forEach((line) => {
    const cols = []; let cur = "", inQ = false;
    for (let ch of line) { if (ch === '"') { inQ = !inQ; continue; } if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; } else cur += ch; }
    cols.push(cur.trim());
    if (cols.length < 5) return;
    const date = cols[0].slice(0, 10).replace(/\//g, "-");
    if (!date.match(/\d{4}-\d{2}-\d{2}/)) return;
    events.push({ date, tipo: cols[1].trim().toLowerCase(), jugador: cols[3].trim(), monto: Math.abs(parseMonto(cols[4])) });
  });
  events.sort((a, b) => a.date.localeCompare(b.date));
  const newPFS = { ...existingPFS };
  events.forEach(({ jugador, date }) => { if (jugador && !newPFS[jugador]) newPFS[jugador] = date; });
  const dm = {};
  events.forEach(({ date, tipo, jugador, monto }) => {
    if (!dm[date]) dm[date] = { date, cargas: 0, retiros: 0, mov: 0, jug: new Set(), new: new Set() };
    if (tipo === "carga") dm[date].cargas += monto;
    else if (tipo === "retiro") dm[date].retiros += monto;
    dm[date].mov++; dm[date].jug.add(jugador);
    if (newPFS[jugador] === date && !existingPFS[jugador]) dm[date].new.add(jugador);
  });
  return {
    dailyEntries: Object.values(dm).map((d) => ({
      id: `csv-${d.date}-${Math.random()}`, date: d.date,
      cargas: Math.round(d.cargas), retiros: Math.round(d.retiros),
      notas: `${d.mov} mov · ${d.jug.size} jugadores`,
      jugadoresUnicos: d.jug.size, jugadoresNuevos: d.new.size,
      jugadoresNuevosLista: [...d.new],
    })).sort((a, b) => a.date.localeCompare(b.date)),
    newPFS,
    newPlayers: Object.entries(newPFS).filter(([k]) => !existingPFS[k]).map(([nombre, primera_vez]) => ({ nombre, primera_vez })),
  };
};

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: "100vh", background: "#07070f", color: "#f1f5f9", fontFamily: "'Inter', 'DM Sans', sans-serif" },
  card: { background: "#0e0e1a", border: "1px solid #1e1e38", borderRadius: 18, padding: "22px 24px" },
  input: { width: "100%", background: "#0a0a16", border: "1px solid #1e1e38", borderRadius: 11, padding: "11px 14px", color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box" },
  btn: { background: "linear-gradient(135deg,#7c3aed,#4f46e5)", border: "none", color: "#fff", padding: "12px 22px", borderRadius: 11, cursor: "pointer", fontSize: 14, fontWeight: 600, boxShadow: "0 4px 14px rgba(124,58,237,0.3)" },
  ghost: { background: "transparent", border: "1px solid #1e1e38", color: "#a78bfa", padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500 },
  danger: { background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", padding: "7px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12 },
  label: { fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 7, fontWeight: 600 },
  subBtn: (a) => ({ padding: "8px 16px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, borderRadius: 9, background: a ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "#0e0e1a", color: a ? "#fff" : "#475569", border: a ? "none" : "1px solid #1e1e38" }),
};

const Trend = ({ value, invert = false }) => {
  let n = +value; if (invert) n = -n;
  if (n > 0) return <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>▲ {Math.abs(+value)}%</span>;
  if (n < 0) return <span style={{ color: "#f87171", fontSize: 13, fontWeight: 600 }}>▼ {Math.abs(+value)}%</span>;
  return <span style={{ color: "#475569", fontSize: 13 }}>— 0%</span>;
};

const StatCard = ({ icon, label, value, sub, color = "#a78bfa", trend, onClick }) => (
  <div onClick={onClick} style={{ ...S.card, cursor: onClick ? "pointer" : "default", borderColor: `${color}25`, background: `linear-gradient(135deg,${color}0a,#0e0e1a)` }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{label}</div>
      <span style={{ fontSize: 20 }}>{icon}</span>
    </div>
    <div style={{ fontFamily: "'Inter',sans-serif", fontSize: 24, fontWeight: 700, color, marginBottom: 5, letterSpacing: "-0.02em" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: "#475569" }}>{sub}</div>}
    {trend !== undefined && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>vs mes ant.: <Trend value={trend} /></div>}
  </div>
);

const Badge = ({ ok }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: ok ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", color: ok ? "#4ade80" : "#f87171", border: `1px solid ${ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
    <span style={{ width: 5, height: 5, borderRadius: "50%", background: ok ? "#4ade80" : "#f87171" }} />{ok ? "OK" : "Alerta"}
  </span>
);

const Tag = ({ color = "#a78bfa", children }) => (
  <span style={{ background: `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>{children}</span>
);

// ─── DB HELPERS ──────────────────────────────────────────────────────────────
const db = {
  // Tenants
  getTenants: async () => { const { data } = await supabase.from("tenants").select("*"); return data || []; },
  addTenant: async (t) => supabase.from("tenants").insert(t),
  deleteTenant: async (id) => supabase.from("tenants").delete().eq("id", id),

  // Config
  getConfig: async (tid) => { const { data } = await supabase.from("tenant_config").select("*").eq("tenant_id", tid).single(); return data; },
  upsertConfig: async (tid, cfg) => supabase.from("tenant_config").upsert({ tenant_id: tid, ...cfg }),

  // Empleados
  getEmpleados: async (tid) => { const { data } = await supabase.from("empleados").select("*").eq("tenant_id", tid).order("nombre"); return data || []; },
  addEmpleado: async (emp) => supabase.from("empleados").insert(emp),
  updateEmpleado: async (id, data) => supabase.from("empleados").update(data).eq("id", id),
  deleteEmpleado: async (id) => supabase.from("empleados").delete().eq("id", id),

  // Panel entries
  getEntries: async (tid) => { const { data } = await supabase.from("panel_entries").select("*").eq("tenant_id", tid).order("fecha"); return data || []; },
  upsertEntry: async (e) => supabase.from("panel_entries").upsert(e, { onConflict: "tenant_id,fecha" }),
  deleteEntry: async (id) => supabase.from("panel_entries").delete().eq("id", id),

  // Cajas
  getCajas: async (tid) => { const { data } = await supabase.from("cajas").select("*").eq("tenant_id", tid); return data || []; },
  upsertCaja: async (c) => {
    const { id, ...data } = c;
    // Try update first, then insert
    const { data: existing } = await supabase.from("cajas").select("id").eq("tenant_id", data.tenant_id).eq("fecha", data.fecha).eq("turno_id", data.turno_id).single();
    if (existing) {
      return supabase.from("cajas").update(data).eq("id", existing.id);
    } else {
      return supabase.from("cajas").insert({ ...data });
    }
  },
  updateCajaComment: async (tid, fecha, turno_id, comentario) => supabase.from("cajas").update({ comentario_dueno: comentario }).eq("tenant_id", tid).eq("fecha", fecha).eq("turno_id", turno_id),

  // Jugadores
  getJugadores: async (tid) => { const { data } = await supabase.from("jugadores").select("*").eq("tenant_id", tid); return data || []; },
  upsertJugadores: async (players) => supabase.from("jugadores").upsert(players, { onConflict: "tenant_id,nombre" }),

  // Campaña
  getCampana: async (tid) => { const { data } = await supabase.from("campana").select("*").eq("tenant_id", tid).single(); return data || { enviados: 0, recuperados: 0, depositos: 0 }; },
  upsertCampana: async (tid, c) => supabase.from("campana").upsert({ tenant_id: tid, ...c }),
};

// ─── LOGIN ───────────────────────────────────────────────────────────────────
const Login = ({ onLogin }) => {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!user.trim() || !pass.trim()) { setErr("Completá usuario y contraseña"); return; }
    setLoading(true); setErr("");
    try {
      if (user.trim() === SA.user && pass.trim() === SA.pass) { onLogin({ role: "superadmin" }); return; }
      const tenants = await db.getTenants();
      const tenant = tenants.find(t => t.usuario === user.trim() && t.pass === pass.trim());
      if (tenant) { onLogin({ role: "owner", tenantId: tenant.id, nombre: tenant.nombre }); return; }
      // Check employees across all tenants
      for (const t of tenants) {
        const emps = await db.getEmpleados(t.id);
        const emp = emps.find(e => e.usuario === user.trim() && e.pass === pass.trim() && e.activo);
        if (emp) { onLogin({ role: "employee", tenantId: t.id, nombre: emp.nombre, horario_inicio: emp.horario_inicio || "", horario_fin: emp.horario_fin || "", dias: emp.dias || [], horarios: emp.horarios || {} }); return; }
      }
      setErr("Usuario o contraseña incorrectos");
    } catch (_) { setErr("Error de conexión. Intentá de nuevo."); }
    setLoading(false);
  };

  return (
    <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "radial-gradient(ellipse at 50% 0%, #1a0533 0%, #07070f 60%)" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ width: 60, height: 60, borderRadius: 18, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto 16px", boxShadow: "0 8px 28px rgba(124,58,237,0.4)" }}>🎰</div>
          <h1 style={{ fontFamily: "'Inter',sans-serif", fontSize: 28, fontWeight: 800, margin: 0, background: "linear-gradient(90deg,#c084fc,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Casino Panel</h1>
          <p style={{ color: "#475569", fontSize: 13, marginTop: 6 }}>Plataforma de gestión operativa</p>
        </div>
        <div style={{ ...S.card, padding: 28, borderColor: "#2a1f4a" }}>
          {[{ label: "Usuario", val: user, set: setUser, type: "text", ph: "tu_usuario" }, { label: "Contraseña", val: pass, set: setPass, type: "password", ph: "••••••••" }].map(f => (
            <div key={f.label} style={{ marginBottom: 16 }}>
              <label style={S.label}>{f.label}</label>
              <input type={f.type} value={f.val} placeholder={f.ph} onChange={e => f.set(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} style={S.input} />
            </div>
          ))}
          {err && <div style={{ color: "#f87171", fontSize: 12, marginBottom: 14, textAlign: "center", background: "rgba(239,68,68,0.08)", padding: "9px 14px", borderRadius: 9 }}>{err}</div>}
          <button onClick={submit} disabled={loading} style={{ ...S.btn, width: "100%", padding: 14, fontSize: 15, opacity: loading ? 0.7 : 1 }}>
            {loading ? "Verificando..." : "Ingresar →"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── SUPER ADMIN ─────────────────────────────────────────────────────────────
const SuperAdmin = ({ onLogout }) => {
  const [tenants, setTenants] = useState([]);
  const [form, setForm] = useState({ nombre: "", usuario: "", pass: "" });
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const showToast = m => { setToast(m); setTimeout(() => setToast(""), 2500); };

  useEffect(() => { db.getTenants().then(setTenants); }, []);

  const addTenant = async () => {
    const { nombre, usuario, pass } = form;
    if (!nombre.trim() || !usuario.trim() || !pass.trim()) return showToast("⚠️ Completá todos los campos");
    if (tenants.find(t => t.usuario === usuario.trim())) return showToast("⚠️ Ese usuario ya existe");
    setSaving(true);
    const id = `t_${Date.now()}`;
    await db.addTenant({ id, nombre: nombre.trim(), usuario: usuario.trim(), pass: pass.trim() });
    await supabase.from("tenant_config").insert({ tenant_id: id, nombre: nombre.trim(), billeteras: [], destinos_bajas: [] });
    await supabase.from("campana").insert({ tenant_id: id, enviados: 0, recuperados: 0, depositos: 0 });
    setTenants(await db.getTenants());
    setForm({ nombre: "", usuario: "", pass: "" }); setSaving(false);
    showToast(`✅ Panel "${nombre}" creado`);
  };

  const deleteTenant = async (id) => {
    await db.deleteTenant(id);
    setTenants(await db.getTenants());
    showToast("🗑️ Panel eliminado");
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#1e1b3a", border: "1px solid #4c1d95", borderRadius: 12, padding: "12px 20px", fontSize: 14, zIndex: 9999 }}>{toast}</div>}
      <div style={{ background: "linear-gradient(135deg,#1a0533,#0d1b3e)", borderBottom: "1px solid #2a1f4a", padding: "18px 28px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontSize: 22 }}>🛡️</span><h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, margin: 0, color: "#c084fc" }}>Super Admin</h1></div>
        <button onClick={onLogout} style={S.ghost}>Cerrar sesión</button>
      </div>
      <div style={{ padding: "24px 28px", maxWidth: 700, margin: "0 auto" }}>
        <div style={{ ...S.card, marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: "#a78bfa", fontWeight: 600, marginBottom: 16 }}>➕ Crear nuevo panel</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
            {[{ label: "Nombre del negocio", key: "nombre", ph: "Casino Estrella" }, { label: "Usuario", key: "usuario", ph: "casino_estrella" }, { label: "Contraseña", key: "pass", ph: "••••••••", type: "password" }].map(f => (
              <div key={f.key}><label style={S.label}>{f.label}</label><input type={f.type || "text"} value={form[f.key]} placeholder={f.ph} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={S.input} /></div>
            ))}
          </div>
          <button onClick={addTenant} disabled={saving} style={{ ...S.btn, opacity: saving ? 0.7 : 1 }}>{saving ? "Creando..." : "Crear panel"}</button>
        </div>
        <div style={{ fontSize: 13, color: "#7c6fa0", marginBottom: 12 }}>{tenants.length} panel{tenants.length !== 1 ? "es" : ""} registrado{tenants.length !== 1 ? "s" : ""}</div>
        {tenants.map(t => (
          <div key={t.id} style={{ ...S.card, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, color: "#c084fc", fontSize: 15 }}>🎰 {t.nombre}</div>
              <div style={{ fontSize: 12, color: "#7c6fa0", marginTop: 4 }}>👤 <strong style={{ color: "#e2e8f0" }}>{t.usuario}</strong> · 🔑 <strong style={{ color: "#e2e8f0" }}>{t.pass}</strong></div>
              <div style={{ fontSize: 11, color: "#4c3a70", marginTop: 2 }}>Creado: {new Date(t.creado_at).toLocaleDateString("es-AR")}</div>
            </div>
            <button onClick={() => deleteTenant(t.id)} style={S.danger}>🗑️ Eliminar</button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── EMPLOYEE VIEW ───────────────────────────────────────────────────────────
const EmployeeView = ({ session, onLogout }) => {
  const tid = session.tenantId;
  const [config, setConfig] = useState(null);
  const [cajas, setCajas] = useState([]);
  const [entries, setEntries] = useState([]);
  const [tab, setTab] = useState("cargar");
  const horarioLabel = getHorarioLabel(session);
  const [form, setForm] = useState({ date: todayStr(), turnoLabel: horarioLabel || "Mi turno", inicio: {}, cierre: {}, bajas: [], bonos: [] });
  const [toast, setToast] = useState("");
  const showToast = m => { setToast(m); setTimeout(() => setToast(""), 2500); };
  const diaHoy = DIA_MAP[new Date().getDay()];
  const trabajaHoy = !session.dias?.length || session.dias.includes(diaHoy);

  useEffect(() => {
    db.getConfig(tid).then(d => setConfig(d || { billeteras: [], destinos_bajas: [] }));
    db.getCajas(tid).then(setCajas);
    db.getEntries(tid).then(setEntries);
  }, []);

  // Auto-fill apertura from last cierre of same employee
  useEffect(() => {
    const prev = cajas.filter(c => c.empleado_nombre === session.nombre && c.fecha < form.date)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    setForm(f => ({ ...f, inicio: prev?.cierre ? { ...prev.cierre } : {} }));
  }, [form.date, cajas]);

  const bills = config?.billeteras || [];
  const destinos = config?.destinos_bajas || [];
  const { tI, tC, totalBajas, totalBonos, mov } = calcCaja(form, bills);
  const de = entries.find(e => e.fecha === form.date);
  const pn = de ? (de.cargas - de.retiros) / 3 : null;
  const dif = pn !== null ? mov - pn : null;
  const hasAlert = dif !== null && Math.abs(dif) > 100;

  const handleSave = async () => {
    const turnoKey = `${form.date}_${session.nombre.replace(/\s+/g, "_")}`;
    const { error } = await db.upsertCaja({ tenant_id: tid, fecha: form.date, turno_id: turnoKey, turno_label: form.turnoLabel, empleado_nombre: session.nombre, inicio: form.inicio, cierre: form.cierre, bajas: form.bajas, bonos: form.bonos, saved_at: new Date().toISOString() });
    if (error) { showToast("❌ Error al guardar"); return; }
    setCajas(await db.getCajas(tid));
    showToast("✅ Turno guardado");
  };

  const myTurnos = cajas.filter(c => c.empleado_nombre === session.nombre).map(c => {
    const { tI, tC, totalBajas, totalBonos, mov } = calcCaja(c, bills);
    return { ...c, tI, tC, totalBajas, totalBonos, mov };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha));

  const BajasForm = () => {
    const items = form.bajas || [];
    const total = items.reduce((s, b) => s + (+b.monto || 0), 0);
    const add = () => setForm(f => ({ ...f, bajas: [...f.bajas, { id: Date.now(), billeteraId: "", monto: "", destinoId: "", nota: "" }] }));
    const upd = (id, k, v) => setForm(f => ({ ...f, bajas: f.bajas.map(b => b.id === id ? { ...b, [k]: v } : b) }));
    const del = (id) => setForm(f => ({ ...f, bajas: f.bajas.filter(b => b.id !== id) }));
    return (
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600 }}>📤 Bajas del turno</div></div>
          <button onClick={add} style={{ background: "#1c1200", border: "1px solid #92400e", color: "#fbbf24", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar</button>
        </div>
        {items.length === 0 ? <div style={{ fontSize: 12, color: "#4c3a70", fontStyle: "italic" }}>Sin bajas</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(item => {
              const dest = destinos.find(d => d.id === item.destinoId);
              return (
                <div key={item.id} style={{ background: "#0a0a0f", border: "1px solid #92400e", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 8, alignItems: "end" }}>
                    <div><label style={S.label}>Billetera</label><select value={item.billeteraId} onChange={e => upd(item.id, "billeteraId", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px", appearance: "none" }}><option value="">—</option>{bills.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
                    <div><label style={S.label}>Destino</label><select value={item.destinoId} onChange={e => upd(item.id, "destinoId", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px", appearance: "none" }}><option value="">—</option>{destinos.map(d => <option key={d.id} value={d.id}>{d.alias}</option>)}</select></div>
                    <button onClick={() => del(item.id)} style={{ ...S.danger, alignSelf: "flex-end" }}>🗑️</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div><label style={S.label}>Monto ($)</label><input type="number" value={item.monto} placeholder="0" onChange={e => upd(item.id, "monto", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                    <div><label style={S.label}>Nota</label><input type="text" value={item.nota || ""} onChange={e => upd(item.id, "nota", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  </div>
                  {dest && <div style={{ fontSize: 11, color: "#7c6fa0", marginTop: 6 }}>🏦 {dest.titular} · <span style={{ fontFamily: "monospace", color: "#a78bfa" }}>{dest.cbu}</span></div>}
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#7c6fa0" }}>Total bajas</span><span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(total)}</span></div>
          </div>
        )}
      </div>
    );
  };

  const BonosForm = () => {
    const items = form.bonos || [];
    const total = items.reduce((s, b) => s + (+b.monto || 0), 0);
    const add = () => setForm(f => ({ ...f, bonos: [...f.bonos, { id: Date.now(), jugador: "", monto: "", nota: "" }] }));
    const upd = (id, k, v) => setForm(f => ({ ...f, bonos: f.bonos.map(b => b.id === id ? { ...b, [k]: v } : b) }));
    const del = (id) => setForm(f => ({ ...f, bonos: f.bonos.filter(b => b.id !== id) }));
    return (
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div><div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600 }}>🎁 Bonos entregados</div></div>
          <button onClick={add} style={{ background: "#1a0533", border: "1px solid #7c3aed", color: "#c084fc", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar</button>
        </div>
        {items.length === 0 ? <div style={{ fontSize: 12, color: "#4c3a70", fontStyle: "italic" }}>Sin bonos</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map(item => (
              <div key={item.id} style={{ background: "#0a0a0f", border: "1px solid #4c1d95", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <div><label style={S.label}>Jugador</label><input type="text" value={item.jugador} onChange={e => upd(item.id, "jugador", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <div><label style={S.label}>Monto ($)</label><input type="number" value={item.monto} placeholder="0" onChange={e => upd(item.id, "monto", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <div><label style={S.label}>Nota</label><input type="text" value={item.nota || ""} onChange={e => upd(item.id, "nota", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <button onClick={() => del(item.id)} style={{ ...S.danger, alignSelf: "flex-end" }}>🗑️</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#7c6fa0" }}>Total bonos</span><span style={{ color: "#a78bfa", fontWeight: 700 }}>{fmt(total)}</span></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#1e1b3a", border: "1px solid #4c1d95", borderRadius: 12, padding: "12px 20px", fontSize: 14, zIndex: 9999 }}>{toast}</div>}
      <div style={{ background: "linear-gradient(135deg,#1a0533,#0d1b3e)", borderBottom: "1px solid #1e1e38", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🎰</div><span style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, background: "linear-gradient(90deg,#c084fc,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{config?.nombre || "Casino Panel"}</span></div>
          <div style={{ fontSize: 12, color: "#475569", marginTop: 2, marginLeft: 42 }}>👤 {session.nombre}{session.horario_inicio ? ` · ⏰ ${session.horario_inicio}${session.horario_fin ? " – " + session.horario_fin : ""}` : ""}</div>
        </div>
        <button onClick={onLogout} style={S.ghost}>Salir</button>
      </div>
      <div style={{ padding: "20px 24px", maxWidth: 680, margin: "0 auto" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid #1e1e38", paddingBottom: 2 }}>
          {[{ id: "cargar", label: "📋 Cargar Turno" }, { id: "historial", label: "📊 Mis Turnos" }].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "9px 16px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: tab === t.id ? 700 : 500, borderRadius: "8px 8px 0 0", background: tab === t.id ? "#07070f" : "transparent", color: tab === t.id ? "#9f67ff" : "#475569", borderBottom: tab === t.id ? "2px solid #9f67ff" : "2px solid transparent" }}>{t.label}</button>
          ))}
        </div>

        {tab === "historial" && (
          <div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 14 }}>Tus últimos turnos registrados</div>
            {myTurnos.length === 0 ? <div style={{ textAlign: "center", padding: "40px", color: "#475569" }}>No tenés turnos registrados todavía.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {myTurnos.map(t => (
                  <div key={t.fecha + t.turno_id} style={{ ...S.card }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13 }}>{new Date(t.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</div>
                        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{t.turno_label || t.turno_id}</div>
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {[{ label: "Apertura", v: t.tI, c: "#38bdf8" }, { label: "Cierre", v: t.tC, c: "#f87171" }, { label: "Neto", v: t.mov, c: t.mov >= 0 ? "#4ade80" : "#f87171" }].map(x => (
                          <div key={x.label} style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>{x.label}</div><div style={{ color: x.c, fontWeight: 700 }}>{fmt(x.v)}</div></div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "cargar" && (
          <div>
            {!trabajaHoy && (
              <div style={{ background: "linear-gradient(135deg,#1a0a00,#2d1500)", border: "1px solid #92400e", borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ fontSize: 24 }}>😴</span>
                <div><div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>Hoy es tu franco</div><div style={{ color: "#a16207", fontSize: 12, marginTop: 2 }}>Podés cargar igual si es necesario.</div></div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
              <div><label style={S.label}>Fecha</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} style={S.input} /></div>
              <div>
                <label style={S.label}>Descripción del turno</label>
                <input type="text" value={form.turnoLabel} onChange={e => setForm({ ...form, turnoLabel: e.target.value })} placeholder="Ej: 08:00 – 19:30" style={S.input} />
              </div>
            </div>

            {bills.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", padding: 32 }}><div style={{ fontSize: 32, marginBottom: 10 }}>💳</div><div style={{ color: "#475569" }}>El dueño todavía no configuró las billeteras.</div></div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                  {[{ label: "🌅 Apertura", key: "inicio", color: "#38bdf8", ro: true }, { label: "🌆 Cierre", key: "cierre", color: "#f87171", ro: false }].map(col => {
                    const total = bills.reduce((s, b) => s + (+(form[col.key][b.id] || 0)), 0);
                    return (
                      <div key={col.key} style={S.card}>
                        <div style={{ fontSize: 12, color: col.color, fontWeight: 700, marginBottom: 12 }}>{col.label}</div>
                        {bills.map(b => {
                          const isAuto = col.ro && !!form.inicio[b.id];
                          return (
                            <div key={b.id} style={{ marginBottom: 10 }}>
                              <label style={{ ...S.label, display: "flex", justifyContent: "space-between" }}><span>{b.nombre}</span>{isAuto && <span style={{ color: "#2d4a7c", fontSize: 10, fontWeight: 400, textTransform: "none" }}>↻ auto</span>}</label>
                              <input type="number" value={form[col.key][b.id] || ""} placeholder="0" readOnly={isAuto}
                                onChange={e => setForm({ ...form, [col.key]: { ...form[col.key], [b.id]: e.target.value } })}
                                style={{ ...S.input, background: isAuto ? "#0a0a12" : "#0a0a16", color: isAuto ? "#4c6a9a" : "#f1f5f9" }} />
                            </div>
                          );
                        })}
                        <div style={{ borderTop: "1px solid #1e1e38", paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "#475569" }}>Total</span><span style={{ fontWeight: 700, color: col.color }}>{fmt(total)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <BajasForm />
                <BonosForm />
                {bills.some(b => form.cierre[b.id]) && (
                  <div style={{ background: hasAlert ? "linear-gradient(135deg,#2d0a0a,#1a0a00)" : "linear-gradient(135deg,#0a1f0a,#0a1200)", border: `1px solid ${hasAlert ? "#7f1d1d" : "#14532d"}`, borderRadius: 14, padding: "14px 18px", marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>Resumen del turno</div>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                      <div><div style={{ fontSize: 10, color: "#475569" }}>Mov. caja</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: tC - tI >= 0 ? "#4ade80" : "#f87171" }}>{fmt(tC - tI)}</div></div>
                      {totalBajas > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bajas</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#fbbf24" }}>+{fmt(totalBajas)}</div></div>}
                      {totalBonos > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bonos</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>-{fmt(totalBonos)}</div></div>}
                      <div><div style={{ fontSize: 10, color: "#475569" }}>Real</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: mov >= 0 ? "#4ade80" : "#f87171" }}>{fmt(mov)}</div></div>
                      {pn !== null && <div><div style={{ fontSize: 10, color: "#475569" }}>Esperado (⅓)</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>{fmt(pn)}</div></div>}
                      {dif !== null && <div><div style={{ fontSize: 10, color: "#475569" }}>Diferencia</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: hasAlert ? "#f87171" : "#4ade80" }}>{dif > 0 ? "+" : ""}{fmt(dif)}</div></div>}
                    </div>
                    {hasAlert && <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>⚠️ Diferencia significativa</div>}
                  </div>
                )}
                <button onClick={handleSave} style={{ ...S.btn, width: "100%" }}>💾 Guardar cierre de turno</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── OWNER DASHBOARD ─────────────────────────────────────────────────────────
const OwnerDashboard = ({ session, onLogout }) => {
  const tid = session.tenantId;
  const [config, setConfig] = useState(null);
  const [entries, setEntries] = useState([]);
  const [jugadores, setJugadores] = useState([]);
  const [campaign, setCampaign] = useState({ enviados: 0, recuperados: 0, depositos: 0 });
  const [empleados, setEmpleados] = useState([]);
  const [cajas, setCajas] = useState([]);
  const [activeTab, setActiveTab] = useState("resumen");
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ date: todayStr(), cargas: "", retiros: "", notas: "" });
  const [campForm, setCampForm] = useState({ enviados: "", recuperados: "", depositos: "" });
  const [toast, setToast] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const [expandedCaja, setExpandedCaja] = useState(null);
  const [cajaTab, setCajaTab] = useState("cargar");
  const [cajaForm, setCajaForm] = useState({ date: todayStr(), empleado: "", inicio: {}, cierre: {}, bajas: [], bonos: [] });
  const [settingsTab, setSettingsTab] = useState("billeteras");
  const [newBillName, setNewBillName] = useState("");
  const [newEmpForm, setNewEmpForm] = useState({ nombre: "", usuario: "", pass: "", horario_inicio: "", horario_fin: "", dias: DIAS.map(d => d.id), horarios: {} });
  const [newDest, setNewDest] = useState({ alias: "", titular: "", cbu: "" });
  const [cajaComment, setCajaComment] = useState({});
  const [selectedDay, setSelectedDay] = useState(todayStr());
  const [empHistoryId, setEmpHistoryId] = useState(null);
  const [jugSeg, setJugSeg] = useState(null);
  const [jugFiltro, setJugFiltro] = useState("");
  const [iaLoading, setIaLoading] = useState(false);
  const [iaAnalisis, setIaAnalisis] = useState(null);
  const [iaPregunta, setIaPregunta] = useState("");
  const fileRef = useRef();
  const showToast = m => { setToast(m); setTimeout(() => setToast(""), 2800); };

  const loadAll = async () => {
    const [cfg, ents, jugs, camp, emps, cajs] = await Promise.all([
      db.getConfig(tid), db.getEntries(tid), db.getJugadores(tid),
      db.getCampana(tid), db.getEmpleados(tid), db.getCajas(tid),
    ]);
    setConfig(cfg || { nombre: session.nombre, billeteras: [], destinos_bajas: [] });
    setEntries(ents); setJugadores(jugs); setCampaign(camp); setEmpleados(emps); setCajas(cajs);
  };

  useEffect(() => { loadAll(); }, []);

  // Auto-fill apertura caja con cierre anterior del mismo empleado
  useEffect(() => {
    if (!cajaForm.empleado) return;
    const prev = cajas.filter(c => c.empleado_nombre === cajaForm.empleado && c.fecha < cajaForm.date)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    setCajaForm(f => ({ ...f, inicio: prev?.cierre ? { ...prev.cierre } : {} }));
  }, [cajaForm.date, cajaForm.empleado, cajas]);

  const bills = config?.billeteras || [];
  const destinos = config?.destinos_bajas || [];

  // Config handlers
  const saveConfig = async (newCfg) => {
    await db.upsertConfig(tid, newCfg);
    setConfig({ ...config, ...newCfg });
  };
  const addBill = async () => { if (!newBillName.trim()) return; const b = { id: Date.now(), nombre: newBillName.trim() }; await saveConfig({ billeteras: [...bills, b] }); setNewBillName(""); showToast(`✅ "${b.nombre}" agregada`); };
  const delBill = async id => { await saveConfig({ billeteras: bills.filter(b => b.id !== id) }); };
  const moveBill = async (id, dir) => { const bs = [...bills]; const i = bs.findIndex(b => b.id === id); if (i < 0 || i + dir < 0 || i + dir >= bs.length) return; [bs[i], bs[i + dir]] = [bs[i + dir], bs[i]]; await saveConfig({ billeteras: bs }); };
  const addDest = async () => { if (!newDest.alias || !newDest.cbu || !newDest.titular) return showToast("⚠️ Completá todos los campos"); const d = { id: Date.now(), ...newDest }; await saveConfig({ destinos_bajas: [...destinos, d] }); setNewDest({ alias: "", titular: "", cbu: "" }); showToast(`✅ "${d.alias}" agregado`); };
  const delDest = async id => { await saveConfig({ destinos_bajas: destinos.filter(d => d.id !== id) }); showToast("🗑️ Eliminado"); };

  // Empleados
  const addEmp = async () => {
    if (!newEmpForm.nombre || !newEmpForm.usuario || !newEmpForm.pass) return showToast("⚠️ Completá nombre, usuario y contraseña");
    const { data: existing } = await supabase.from("empleados").select("id").eq("usuario", newEmpForm.usuario).single();
    if (existing) return showToast("⚠️ Ese usuario ya existe");
    await db.addEmpleado({ id: `e_${Date.now()}`, tenant_id: tid, ...newEmpForm, activo: true });
    setEmpleados(await db.getEmpleados(tid));
    setNewEmpForm({ nombre: "", usuario: "", pass: "", turno: "t1", dias: DIAS.map(d => d.id), horarios: {} });
    showToast(`✅ ${newEmpForm.nombre} agregado`);
  };
  const toggleEmp = async (id, activo) => { await db.updateEmpleado(id, { activo: !activo }); setEmpleados(await db.getEmpleados(tid)); };
  const delEmp = async id => { await db.deleteEmpleado(id); setEmpleados(await db.getEmpleados(tid)); };
  const updateEmpDia = async (id, diaId) => {
    const emp = empleados.find(e => e.id === id);
    const dias = emp.dias || [];
    const newDias = dias.includes(diaId) ? dias.filter(d => d !== diaId) : [...dias, diaId];
    await db.updateEmpleado(id, { dias: newDias });
    setEmpleados(await db.getEmpleados(tid));
  };
  const updateEmpHorario = async (id, diaId, val) => {
    const emp = empleados.find(e => e.id === id);
    const horarios = { ...emp.horarios, [diaId]: val };
    await db.updateEmpleado(id, { horarios });
    setEmpleados(await db.getEmpleados(tid));
  };

  // Caja
  const saveCaja = async () => {
    if (!cajaForm.empleado) return showToast("⚠️ Seleccioná un empleado");
    const emp = empleados.find(e => e.nombre === cajaForm.empleado);
    const horIni = emp?.horario_inicio || "";
    const horFin = emp?.horario_fin || "";
    const turnoLabel = horIni ? `${horIni}${horFin ? " – " + horFin : ""}` : "Turno";
    const turnoId = `${cajaForm.date}_${cajaForm.empleado.replace(/\s+/g, "_")}`;
    const { error } = await db.upsertCaja({ tenant_id: tid, fecha: cajaForm.date, turno_id: turnoId, turno_label: turnoLabel, empleado_nombre: cajaForm.empleado, inicio: cajaForm.inicio, cierre: cajaForm.cierre, bajas: cajaForm.bajas, bonos: cajaForm.bonos, saved_at: new Date().toISOString() });
    if (error) { showToast("❌ Error al guardar: " + error.message); return; }
    setCajas(await db.getCajas(tid));
    showToast("✅ Caja guardada"); setCajaTab("historial");
  };
  const saveComment = async (fecha, turno_id, text) => {
    await db.updateCajaComment(tid, fecha, turno_id, text);
    setCajas(await db.getCajas(tid));
    showToast("💬 Comentario guardado");
  };

  // Entries
  const addEntry = async () => {
    if (!form.cargas && !form.retiros) return;
    const ts = new Date().toISOString();
    const existing = entries.find(e => e.fecha === form.date);
    const payload = { tenant_id: tid, fecha: form.date, cargas: +form.cargas || 0, retiros: +form.retiros || 0, notas: form.notas };
    if (editId) {
      const editLog = [...(existing?.edit_log || []), { ts, cargas: existing.cargas, retiros: existing.retiros }];
      await supabase.from("panel_entries").update({ ...payload, edit_log: editLog }).eq("id", editId);
      setEditId(null);
    } else {
      await db.upsertEntry({ ...payload, id: `pe_${Date.now()}` });
    }
    setEntries(await db.getEntries(tid));
    setForm({ date: todayStr(), cargas: "", retiros: "", notas: "" });
    showToast("✅ Guardado");
  };
  const delEntry = async id => { await db.deleteEntry(id); setEntries(await db.getEntries(tid)); showToast("🗑️ Eliminado"); };
  const editEntry = e => { setForm({ date: e.fecha, cargas: e.cargas, retiros: e.retiros, notas: e.notas || "" }); setEditId(e.id); setActiveTab("cargar"); };

  // Campaign
  const saveCamp = async () => {
    const d = { enviados: +campForm.enviados || campaign.enviados, recuperados: +campForm.recuperados || campaign.recuperados, depositos: +campForm.depositos || campaign.depositos };
    await db.upsertCampana(tid, d); setCampaign(d); setCampForm({ enviados: "", recuperados: "", depositos: "" }); showToast("✅ Actualizado");
  };

  // CSV
  const handleFile = e => {
    const file = e.target.files[0]; if (!file) return; setImporting(true);
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const existingPFS = Object.fromEntries(jugadores.map(j => [j.nombre, j.primera_vez]));
        const { dailyEntries, newPFS, newPlayers } = parseCSV(ev.target.result, existingPFS);
        setImportPreview({ file: file.name, data: dailyEntries, newPlayers, totalNew: newPlayers.length });
      } catch (_) { showToast("❌ Error al leer el archivo"); }
      setImporting(false);
    };
    reader.readAsText(file, "utf-8"); e.target.value = "";
  };

  const confirmImport = async mode => {
    if (!importPreview) return;
    for (const entry of importPreview.data) {
      const existing = entries.find(e => e.fecha === entry.date);
      if (mode === "replace" || !existing) {
        await db.upsertEntry({ id: existing?.id || `pe_${Date.now()}_${entry.date}`, tenant_id: tid, fecha: entry.date, cargas: entry.cargas, retiros: entry.retiros, notas: entry.notas, jugadores_nuevos: entry.jugadoresNuevos, jugadores_unicos: entry.jugadoresUnicos, jugadores_nuevos_lista: entry.jugadoresNuevosLista });
      } else {
        await supabase.from("panel_entries").update({ cargas: existing.cargas + entry.cargas, retiros: existing.retiros + entry.retiros }).eq("id", existing.id);
      }
    }
    if (importPreview.newPlayers.length > 0) {
      await db.upsertJugadores(importPreview.newPlayers.map(p => ({ tenant_id: tid, nombre: p.nombre, primera_vez: p.primera_vez })));
    }
    await loadAll();
    setImportPreview(null); showToast(`✅ ${importPreview.data.length} días importados`); setActiveTab("resumen");
  };

  // ── Derived ──
  const cmEntries = entries.filter(e => e.fecha?.startsWith(cmk()));
  const pmEntries = entries.filter(e => e.fecha?.startsWith(pmk()));
  const cmC = sumK(cmEntries, "cargas"), cmR = sumK(cmEntries, "retiros"), cmN = cmC - cmR;
  const pmC = sumK(pmEntries, "cargas"), pmR = sumK(pmEntries, "retiros"), pmN = pmC - pmR;
  // Comparacion proporcional: promedio diario del mes anterior × dias cargados del mes actual
  const cmDias = cmEntries.length;
  const pmDias = pmEntries.length;
  const pmCProp = pmDias > 0 && cmDias > 0 ? (pmC / pmDias) * cmDias : pmC;
  const pmRProp = pmDias > 0 && cmDias > 0 ? (pmR / pmDias) * cmDias : pmR;
  const pmNProp = pmCProp - pmRProp;
  const cmNuevos = sumK(cmEntries, "jugadores_nuevos"), pmNuevos = sumK(pmEntries, "jugadores_nuevos");
  const cmUnicos = sumK(cmEntries, "jugadores_unicos"), pmUnicos = sumK(pmEntries, "jugadores_unicos");
  const totalPlayers = jugadores.length;
  const recoveryRate = campaign.enviados > 0 ? ((campaign.recuperados / campaign.enviados) * 100).toFixed(1) : 0;
  const chartData = cmEntries.map(e => ({ dia: e.fecha?.slice(8), Cargas: e.cargas, Retiros: e.retiros, Neto: e.cargas - e.retiros }));
  const compareData = [{ name: "Cargas", Anterior: Math.round(pmCProp), Actual: cmC }, { name: "Retiros", Anterior: Math.round(pmRProp), Actual: cmR }, { name: "Neto", Anterior: Math.round(pmNProp), Actual: cmN }];
  const last7 = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - i); const ds = d.toISOString().slice(0, 10); const e = entries.find(x => x.fecha === ds); return { dia: d.toLocaleDateString("es-AR", { weekday: "short" }), Cargas: e?.cargas || 0, Retiros: e?.retiros || 0 }; }).reverse();

  const cajaHistorial = cajas.map(c => {
    const de = entries.find(e => e.fecha === c.fecha);
    const pn = de ? (de.cargas - de.retiros) / 3 : 0;
    const { tI, tC, totalBajas, totalBonos, mov } = calcCaja(c, bills);
    return { ...c, turnoLabel: c.turno_label || c.turno_id, tI, tC, totalBajas, totalBonos, mov, pn, dif: mov - pn };
  }).sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.turno_id || "").localeCompare(a.turno_id || ""));

  const alertas = cajaHistorial.filter(c => Math.abs(c.dif) > 100);

  const getDaySummary = (date) => {
    const dayTurnos = cajas.filter(c => c.fecha === date).map(c => {
      const { tI, tC, totalBajas, totalBonos, mov } = calcCaja(c, bills);
      return { turnoLabel: c.turno_label || c.turno_id, exists: true, caja: c, tI, tC, totalBajas, totalBonos, mov, empleado: c.empleado_nombre };
    });
    const entry = entries.find(e => e.fecha === date);
    const panelNeto = entry ? entry.cargas - entry.retiros : null;
    const totalMov = dayTurnos.filter(t => t.exists).reduce((s, t) => s + t.mov, 0);
    return { date, dayTurnos, entry, panelNeto, totalMov, dif: panelNeto !== null ? totalMov - panelNeto : null };
  };

  const todasBajas = cajaHistorial.flatMap(c => (c.bajas || []).map(b => ({ ...b, fecha: c.fecha, turnoLabel: c.turnoLabel, empleado: c.empleado_nombre })));
  const totalBajasGeneral = todasBajas.reduce((s, b) => s + (+b.monto || 0), 0);
  const todosBonos = cajaHistorial.flatMap(c => (c.bonos || []).map(b => ({ ...b, fecha: c.fecha, turnoLabel: c.turnoLabel, empleado: c.empleado_nombre })));
  const totalBonosGeneral = todosBonos.reduce((s, b) => s + (+b.monto || 0), 0);
  const rankingEmpleados = empleados.map(emp => { const empCajas = cajaHistorial.filter(c => c.empleado_nombre === emp.nombre); const difNeg = empCajas.filter(c => (c.dif || 0) < -100).length; const difTotal = empCajas.reduce((s, c) => s + Math.abs(c.dif || 0), 0); const totalBonos = todosBonos.filter(b => b.empleado === emp.nombre).reduce((s, b) => s + (+b.monto || 0), 0); return { ...emp, turnos: empCajas.length, difNeg, difTotal, totalBonos }; }).filter(e => e.turnos > 0).sort((a, b) => b.difTotal - a.difTotal);

  if (!config) return <div style={{ ...S.page, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 36 }}>🎰</div>Cargando...</div></div>;

  const tabs = [
    { id: "resumen", label: "📊 Resumen" }, { id: "dia", label: "📅 Día" },
    { id: "caja", label: "💼 Caja" }, { id: "jugadores", label: "👥 Jugadores" },
    { id: "bonos", label: "🎁 Bonos" }, { id: "bajas", label: "📤 Bajas" },
    { id: "importar", label: "📂 Importar" }, { id: "cargar", label: editId ? "✏️ Editar" : "➕ Panel" },
    { id: "historial", label: "📋 Historial" }, { id: "campana", label: "📣 Campaña" },
    { id: "meses", label: "📆 Meses" }, { id: "ia", label: "🤖 IA Analista" }, { id: "empleados_hist", label: "👤 Empleados" }, { id: "ajustes", label: "⚙️ Ajustes" },
  ];

  const CajaBajas = ({ formState, setFormState }) => {
    const items = formState.bajas || [];
    const total = items.reduce((s, b) => s + (+b.monto || 0), 0);
    const add = () => setFormState(f => ({ ...f, bajas: [...(f.bajas || []), { id: Date.now(), billeteraId: "", monto: "", destinoId: "", nota: "" }] }));
    const upd = (id, k, v) => setFormState(f => ({ ...f, bajas: f.bajas.map(b => b.id === id ? { ...b, [k]: v } : b) }));
    const del = (id) => setFormState(f => ({ ...f, bajas: f.bajas.filter(b => b.id !== id) }));
    return (
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600 }}>📤 Bajas del turno</div>
          <button onClick={add} style={{ background: "#1c1200", border: "1px solid #92400e", color: "#fbbf24", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar</button>
        </div>
        {items.length === 0 ? <div style={{ fontSize: 12, color: "#4c3a70", fontStyle: "italic" }}>Sin bajas</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map(item => { const dest = destinos.find(d => d.id === item.destinoId); return (
              <div key={item.id} style={{ background: "#0a0a0f", border: "1px solid #92400e", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <div><label style={S.label}>Billetera</label><select value={item.billeteraId} onChange={e => upd(item.id, "billeteraId", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px", appearance: "none" }}><option value="">—</option>{bills.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select></div>
                  <div><label style={S.label}>Destino</label><select value={item.destinoId} onChange={e => upd(item.id, "destinoId", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px", appearance: "none" }}><option value="">—</option>{destinos.map(d => <option key={d.id} value={d.id}>{d.alias}</option>)}</select></div>
                  <div><label style={S.label}>Monto ($)</label><input type="number" value={item.monto} placeholder="0" onChange={e => upd(item.id, "monto", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <button onClick={() => del(item.id)} style={{ ...S.danger, alignSelf: "flex-end" }}>🗑️</button>
                </div>
                <div style={{ marginTop: 8 }}><input type="text" value={item.nota || ""} placeholder="Nota..." onChange={e => upd(item.id, "nota", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "7px 10px" }} /></div>
                {dest && <div style={{ fontSize: 11, color: "#7c6fa0", marginTop: 6 }}>🏦 {dest.titular} · <span style={{ fontFamily: "monospace", color: "#a78bfa" }}>{dest.cbu}</span></div>}
              </div>
            ); })}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#7c6fa0" }}>Total bajas</span><span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(total)}</span></div>
          </div>
        )}
      </div>
    );
  };

  const CajaBonos = ({ formState, setFormState }) => {
    const items = formState.bonos || [];
    const total = items.reduce((s, b) => s + (+b.monto || 0), 0);
    const add = () => setFormState(f => ({ ...f, bonos: [...(f.bonos || []), { id: Date.now(), jugador: "", monto: "", nota: "" }] }));
    const upd = (id, k, v) => setFormState(f => ({ ...f, bonos: f.bonos.map(b => b.id === id ? { ...b, [k]: v } : b) }));
    const del = (id) => setFormState(f => ({ ...f, bonos: f.bonos.filter(b => b.id !== id) }));
    return (
      <div style={S.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600 }}>🎁 Bonos entregados</div>
          <button onClick={add} style={{ background: "#1a0533", border: "1px solid #7c3aed", color: "#c084fc", padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Agregar</button>
        </div>
        {items.length === 0 ? <div style={{ fontSize: 12, color: "#4c3a70", fontStyle: "italic" }}>Sin bonos</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map(item => (
              <div key={item.id} style={{ background: "#0a0a0f", border: "1px solid #4c1d95", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
                  <div><label style={S.label}>Jugador</label><input type="text" value={item.jugador} onChange={e => upd(item.id, "jugador", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <div><label style={S.label}>Monto ($)</label><input type="number" value={item.monto} placeholder="0" onChange={e => upd(item.id, "monto", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <div><label style={S.label}>Nota</label><input type="text" value={item.nota || ""} onChange={e => upd(item.id, "nota", e.target.value)} style={{ ...S.input, fontSize: 12, padding: "8px 10px" }} /></div>
                  <button onClick={() => del(item.id)} style={{ ...S.danger, alignSelf: "flex-end" }}>🗑️</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ color: "#7c6fa0" }}>Total bonos</span><span style={{ color: "#a78bfa", fontWeight: 700 }}>{fmt(total)}</span></div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet" />
      {toast && <div style={{ position: "fixed", top: 20, right: 20, background: "#1e1b3a", border: "1px solid #4c1d95", borderRadius: 12, padding: "12px 20px", fontSize: 14, zIndex: 9999, maxWidth: 320 }}>{toast}</div>}

      <div style={{ background: "linear-gradient(135deg,#1a0533,#0d1b3e)", borderBottom: "1px solid #1e1e38", padding: "16px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🎰</div><h1 style={{ fontFamily: "'Inter',sans-serif", fontSize: 20, fontWeight: 800, margin: 0, background: "linear-gradient(90deg,#c084fc,#818cf8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{config.nombre}</h1></div>
            <p style={{ margin: "2px 0 0 42px", fontSize: 11, color: "#475569" }}>Seguimiento operativo · {totalPlayers} jugadores</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 11, color: "#9f67ff", fontWeight: 600, textTransform: "capitalize" }}>{monthLabel()}</div>
            <button onClick={onLogout} style={S.ghost}>Salir</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, overflowX: "auto" }}>
          {tabs.map(t => <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ padding: "8px 11px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 500, borderRadius: "8px 8px 0 0", whiteSpace: "nowrap", background: activeTab === t.id ? "#07070f" : "transparent", color: activeTab === t.id ? "#9f67ff" : "#475569", borderBottom: activeTab === t.id ? "2px solid #9f67ff" : "2px solid transparent" }}>{t.label}</button>)}
        </div>
      </div>

      <div style={{ padding: "22px 24px", maxWidth: 980, margin: "0 auto" }}>

        {activeTab === "resumen" && (
          <div>
            {cmDias > 0 && pmDias > 0 && (
              <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.2)", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#9f67ff" }}>
                📊 Comparando <strong>{cmDias} días</strong> de este mes vs el equivalente proporcional del mes anterior ({pmDias} días totales)
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 14 }}>
              <StatCard icon="💰" label="Cargas del Mes" value={fmt(cmC)} trend={pct(cmC, pmCProp)} color="#4ade80" />
              <StatCard icon="💸" label="Retiros del Mes" value={fmt(cmR)} trend={pct(cmR, pmRProp)} color="#f87171" />
              <StatCard icon="📊" label="Neto del Mes" value={fmt(cmN)} trend={pct(cmN, pmNProp)} color={cmN >= 0 ? "#4ade80" : "#f87171"} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
              <StatCard icon="🆕" label="Jugadores Nuevos" value={cmNuevos} trend={pct(cmNuevos, pmNuevos)} color="#fbbf24" />
              <StatCard icon="👥" label="Jugadores Activos" value={cmUnicos} trend={pct(cmUnicos, pmUnicos)} color="#38bdf8" />
              <StatCard icon="⚠️" label="Alertas de Caja" value={alertas.length} color={alertas.length > 0 ? "#f87171" : "#4ade80"} sub={alertas.length > 0 ? "diferencias detectadas" : "sin diferencias"} onClick={() => setActiveTab("caja")} />
            </div>
            {(() => { const t = entries.find(e => e.fecha === todayStr()); return (<div style={{ background: "linear-gradient(135deg,rgba(124,58,237,0.08),rgba(6,182,212,0.04))", border: "1px solid #1e1e38", borderRadius: 16, padding: "14px 20px", marginBottom: 20 }}><div style={{ fontSize: 11, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10, fontWeight: 700 }}>📅 Hoy</div>{t ? (<div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>{[{ label: "Cargas", v: t.cargas, c: "#4ade80" }, { label: "Retiros", v: t.retiros, c: "#f87171" }, { label: "Neto", v: t.cargas - t.retiros, c: t.cargas - t.retiros >= 0 ? "#4ade80" : "#f87171" }].map(x => (<div key={x.label}><div style={{ fontSize: 11, color: "#475569" }}>{x.label}</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 20, color: x.c, fontWeight: 800 }}>{fmt(x.v)}</div></div>))}</div>) : (<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ color: "#475569", fontSize: 13 }}>No hay datos para hoy</span><button onClick={() => setActiveTab("importar")} style={{ ...S.btn, padding: "7px 14px", fontSize: 12 }}>📂 Importar</button></div>)}</div>); })()}
            {chartData.length > 0 ? (<>
              <div style={{ ...S.card, marginBottom: 14 }}><div style={{ fontSize: 13, color: "#38bdf8", marginBottom: 14, fontWeight: 700 }}>Últimos 7 días</div><ResponsiveContainer width="100%" height={200}><BarChart data={last7}><CartesianGrid strokeDasharray="3 3" stroke="#1e1e38" /><XAxis dataKey="dia" tick={{ fill: "#475569", fontSize: 11 }} /><YAxis tick={{ fill: "#475569", fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#1e1b3a", border: "1px solid #1e1e38", borderRadius: 10 }} formatter={v => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Cargas" fill="#4ade80" radius={[5, 5, 0, 0]} /><Bar dataKey="Retiros" fill="#f87171" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <div style={{ ...S.card, marginBottom: 14 }}><div style={{ fontSize: 13, color: "#a78bfa", marginBottom: 14, fontWeight: 700, textTransform: "capitalize" }}>Evolución — {monthLabel()}</div><ResponsiveContainer width="100%" height={220}><AreaChart data={chartData}><defs><linearGradient id="gC" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3} /><stop offset="95%" stopColor="#4ade80" stopOpacity={0} /></linearGradient><linearGradient id="gR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3} /><stop offset="95%" stopColor="#f87171" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#1e1e38" /><XAxis dataKey="dia" tick={{ fill: "#475569", fontSize: 11 }} /><YAxis tick={{ fill: "#475569", fontSize: 11 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#1e1b3a", border: "1px solid #1e1e38", borderRadius: 10 }} formatter={v => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Area type="monotone" dataKey="Cargas" stroke="#4ade80" fill="url(#gC)" strokeWidth={2} dot={false} /><Area type="monotone" dataKey="Retiros" stroke="#f87171" fill="url(#gR)" strokeWidth={2} dot={false} /></AreaChart></ResponsiveContainer></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={S.card}><div style={{ fontSize: 13, color: "#a78bfa", marginBottom: 12, fontWeight: 700 }}>Comparativa financiera</div><ResponsiveContainer width="100%" height={160}><BarChart data={compareData}><CartesianGrid strokeDasharray="3 3" stroke="#1e1e38" /><XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 11 }} /><YAxis tick={{ fill: "#475569", fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} /><Tooltip contentStyle={{ background: "#1e1b3a", border: "1px solid #1e1e38", borderRadius: 10 }} formatter={v => fmt(v)} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Anterior" fill="#4c1d95" radius={[4, 4, 0, 0]} /><Bar dataKey="Actual" fill="#7c3aed" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
                <div style={S.card}><div style={{ fontSize: 13, color: "#fbbf24", marginBottom: 12, fontWeight: 700 }}>Comparativa jugadores</div><ResponsiveContainer width="100%" height={160}><BarChart data={[{ name: "Nuevos", Anterior: pmNuevos, Actual: cmNuevos }, { name: "Activos", Anterior: pmUnicos, Actual: cmUnicos }]}><CartesianGrid strokeDasharray="3 3" stroke="#1e1e38" /><XAxis dataKey="name" tick={{ fill: "#475569", fontSize: 11 }} /><YAxis tick={{ fill: "#475569", fontSize: 10 }} allowDecimals={false} /><Tooltip contentStyle={{ background: "#1e1b3a", border: "1px solid #1e1e38", borderRadius: 10 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Anterior" fill="#78350f" radius={[4, 4, 0, 0]} /><Bar dataKey="Actual" fill="#d97706" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              </div>
            </>) : (<div style={{ textAlign: "center", padding: "50px 0", color: "#475569" }}><div style={{ fontSize: 44, marginBottom: 12 }}>📊</div><div>Importá tus CSVs desde <strong style={{ color: "#9f67ff" }}>📂 Importar</strong></div></div>)}
          </div>
        )}

        {activeTab === "dia" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
              <div><h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, margin: 0, color: "#c084fc" }}>📅 Resumen del Día</h2></div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {[...new Set([...cajas.map(c => c.fecha), ...entries.map(e => e.fecha)])].sort((a, b) => b.localeCompare(a)).slice(0, 5).map(d => (<button key={d} onClick={() => setSelectedDay(d)} style={{ padding: "7px 12px", border: `1px solid ${selectedDay === d ? "#7c3aed" : "#2a1f4a"}`, borderRadius: 8, background: selectedDay === d ? "#2d1b69" : "#0a0a0f", color: selectedDay === d ? "#c084fc" : "#7c6fa0", cursor: "pointer", fontSize: 11, fontWeight: selectedDay === d ? 700 : 400 }}>{new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</button>))}
                <input type="date" value={selectedDay} onChange={e => setSelectedDay(e.target.value)} style={{ ...S.input, width: "auto", padding: "7px 12px", fontSize: 12 }} />
              </div>
            </div>
            {(() => {
              const day = getDaySummary(selectedDay);
              const alertDay = day.dif !== null && Math.abs(day.dif) > 100;
              return (<>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
                  {[{ label: "Neto del Panel", value: day.panelNeto !== null ? fmt(day.panelNeto) : "Sin datos", color: "#a78bfa", icon: "📊" }, { label: "Mov. Real Caja", value: day.dayTurnos.some(t => t.exists) ? fmt(day.totalMov) : "Sin datos", color: day.totalMov >= 0 ? "#4ade80" : "#f87171", icon: "💼" }, { label: "Diferencia", value: day.dif !== null ? fmt(day.dif) : "—", color: alertDay ? "#f87171" : "#4ade80", icon: alertDay ? "⚠️" : "✅" }].map(k => (
                    <div key={k.label} style={{ ...S.card, border: alertDay && k.label === "Diferencia" ? "1px solid #7f1d1d" : "1px solid #2a1f4a" }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ fontSize: 10, color: "#7c6fa0", textTransform: "uppercase", letterSpacing: 1 }}>{k.label}</div><span style={{ fontSize: 20 }}>{k.icon}</span></div>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: k.color, margin: "8px 0 4px" }}>{k.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {day.dayTurnos.length === 0 ? <div style={{ ...S.card, textAlign: "center", color: "#475569", padding: 28 }}>No hay registros de caja para este día.</div> : day.dayTurnos.map(({ turnoLabel, caja, tI, tC, totalBajas, totalBonos, mov, empleado }) => (
                    <div key={caja?.turno_id || turnoLabel} style={{ ...S.card }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div><span style={{ fontFamily: "'Inter',sans-serif", fontWeight: 700, color: "#9f67ff", fontSize: 14 }}>{turnoLabel}</span>{empleado && <span style={{ fontSize: 12, color: "#475569", marginLeft: 10 }}>· 👤 {empleado}</span>}</div>
                        <div style={{ fontFamily: "'Inter',sans-serif", fontWeight: 800, color: mov >= 0 ? "#4ade80" : "#f87171", fontSize: 18 }}>{fmt(mov)}</div>
                      </div>
                      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginTop: 12 }}>
                        {[{ label: "Apertura", v: tI, c: "#38bdf8" }, { label: "Cierre", v: tC, c: "#f87171" }].map(x => (<div key={x.label}><div style={{ fontSize: 10, color: "#475569" }}>{x.label}</div><div style={{ color: x.c, fontWeight: 700, fontSize: 13 }}>{fmt(x.v)}</div></div>))}
                        {totalBajas > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bajas</div><div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 13 }}>+{fmt(totalBajas)}</div></div>}
                        {totalBonos > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bonos</div><div style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13 }}>-{fmt(totalBonos)}</div></div>}
                        {caja?.comentario_dueno && <div style={{ width: "100%" }}><div style={{ fontSize: 11, color: "#f59e0b", fontStyle: "italic" }}>💬 {caja.comentario_dueno}</div></div>}
                      </div>
                    </div>
                  ))}
                </div>
                {day.dayTurnos.some(t => t.exists) && (
                  <div style={{ ...S.card, marginTop: 16, background: alertDay ? "linear-gradient(135deg,#2d0a0a,#1a0a00)" : "linear-gradient(135deg,#0a1f0a,#0a1200)", border: `1px solid ${alertDay ? "#7f1d1d" : "#14532d"}` }}>
                    <div style={{ fontSize: 12, color: alertDay ? "#f87171" : "#4ade80", fontWeight: 600, marginBottom: 12 }}>Totales del día</div>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                      {day.panelNeto !== null && <div><div style={{ fontSize: 10, color: "#7c6fa0" }}>Panel neto</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#a78bfa" }}>{fmt(day.panelNeto)}</div></div>}
                      <div><div style={{ fontSize: 10, color: "#7c6fa0" }}>Caja real</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: day.totalMov >= 0 ? "#4ade80" : "#f87171" }}>{fmt(day.totalMov)}</div></div>
                      {day.dif !== null && <div><div style={{ fontSize: 10, color: "#7c6fa0" }}>Diferencia</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: alertDay ? "#f87171" : "#4ade80" }}>{day.dif > 0 ? "+" : ""}{fmt(day.dif)}</div></div>}
                    </div>
                    {alertDay && <div style={{ marginTop: 10, fontSize: 13, color: "#f87171", fontWeight: 600 }}>⚠️ La caja no cierra con el panel</div>}
                  </div>
                )}
              </>);
            })()}
          </div>
        )}

        {activeTab === "caja" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{ fontFamily: "'Inter',sans-serif", fontSize: 20, fontWeight: 800, margin: 0, color: "#9f67ff" }}>💼 Control de Caja</h2>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setCajaTab("cargar")} style={{ padding: "9px 16px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: cajaTab === "cargar" ? 700 : 500, borderRadius: "8px 8px 0 0", background: cajaTab === "cargar" ? C.bg : "transparent", color: cajaTab === "cargar" ? "#9f67ff" : "#475569", borderBottom: cajaTab === "cargar" ? "2px solid #9f67ff" : "2px solid transparent" }}>Cargar turno</button>
                <button onClick={() => setCajaTab("historial")} style={{ padding: "9px 16px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: cajaTab === "historial" ? 700 : 500, borderRadius: "8px 8px 0 0", background: cajaTab === "historial" ? C.bg : "transparent", color: cajaTab === "historial" ? "#9f67ff" : "#475569", borderBottom: cajaTab === "historial" ? "2px solid #9f67ff" : "2px solid transparent" }}>Historial</button>
              </div>
            </div>
            {alertas.length > 0 && <div style={{ background: "linear-gradient(135deg,#2d0a0a,#1a0a00)", border: "1px solid #7f1d1d", borderRadius: 14, padding: "14px 18px", marginBottom: 20 }}><div style={{ fontSize: 12, color: "#f87171", fontWeight: 700, marginBottom: 10 }}>⚠️ {alertas.length} diferencia{alertas.length > 1 ? "s" : ""} detectada{alertas.length > 1 ? "s" : ""}</div>{alertas.map(c => (<div key={c.fecha + c.turno_id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #2d0a0a", fontSize: 12 }}><span><span style={{ color: "#fca5a5" }}>{new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span><span style={{ color: "#475569", marginLeft: 8 }}>{c.turnoLabel} · {c.empleado_nombre}</span></span><span style={{ color: c.dif < 0 ? "#f87171" : "#fbbf24", fontWeight: 700 }}>{c.dif < 0 ? "Falta " : "Sobra "}{fmt(Math.abs(c.dif))}</span></div>))}</div>}

            {cajaTab === "cargar" && (
              <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 700, marginBottom: 14 }}>Datos del turno</div>
                  <div style={{ marginBottom: 12 }}><label style={S.label}>Fecha</label><input type="date" value={cajaForm.date} onChange={e => setCajaForm({ ...cajaForm, date: e.target.value })} style={S.input} /></div>
                  <div style={{ marginBottom: 12 }}><label style={S.label}>Empleado</label>
                    {empleados.filter(e => e.activo).length > 0 ? (<select value={cajaForm.empleado} onChange={e => setCajaForm({ ...cajaForm, empleado: e.target.value, inicio: {}, cierre: {} })} style={{ ...S.input, appearance: "none" }}><option value="">— Seleccioná —</option>{empleados.filter(e => e.activo).map(e => <option key={e.id} value={e.nombre}>{e.nombre}{e.horario_inicio ? ` (${e.horario_inicio}${e.horario_fin ? " – " + e.horario_fin : ""})` : ""}</option>)}</select>) : (<button onClick={() => { setActiveTab("ajustes"); setSettingsTab("empleados"); }} style={{ width: "100%", background: "#0e0e1a", border: "1px dashed #4c1d95", color: "#a78bfa", padding: "10px", borderRadius: 10, cursor: "pointer", fontSize: 12 }}>+ Agregar empleados</button>)}
                  </div>
                  {cajaForm.empleado && (() => { const emp = empleados.find(e => e.nombre === cajaForm.empleado); return emp?.horario_inicio ? <div style={{ background: "#1a0533", border: "1px solid #4c1d95", borderRadius: 9, padding: "8px 12px", fontSize: 12 }}><span style={{ color: "#475569" }}>⏰ </span><span style={{ color: "#c084fc", fontWeight: 700 }}>{emp.horario_inicio}{emp.horario_fin ? " – " + emp.horario_fin : ""}</span></div> : null; })()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {[{ label: "🌅 Apertura", fk: "inicio", color: "#38bdf8", ro: true }, { label: "🌆 Cierre", fk: "cierre", color: "#f87171", ro: false }].map(col => {
                    const total = bills.reduce((s, b) => s + (+(cajaForm[col.fk][b.id] || 0)), 0);
                    return (<div key={col.fk} style={S.card}><div style={{ fontSize: 12, color: col.color, fontWeight: 700, marginBottom: 12 }}>{col.label}</div><div style={{ display: "grid", gridTemplateColumns: bills.length > 3 ? "1fr 1fr" : "1fr", gap: "0 16px" }}>{bills.map(b => { const isAuto = col.ro && !!cajaForm.inicio[b.id]; return (<div key={b.id} style={{ marginBottom: 10 }}><label style={{ ...S.label, display: "flex", justifyContent: "space-between" }}><span>{b.nombre}</span>{isAuto && <span style={{ color: "#2d4a7c", fontSize: 10, fontWeight: 400, textTransform: "none" }}>↻ auto</span>}</label><input type="number" value={cajaForm[col.fk][b.id] || ""} placeholder="0" readOnly={isAuto} onChange={e => setCajaForm({ ...cajaForm, [col.fk]: { ...cajaForm[col.fk], [b.id]: e.target.value } })} style={{ ...S.input, background: isAuto ? "#0a0a12" : "#0a0a16", color: isAuto ? "#4c6a9a" : "#f1f5f9" }} /></div>); })}</div><div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, display: "flex", justifyContent: "space-between", fontSize: 12 }}><span style={{ color: "#475569" }}>Total</span><span style={{ fontWeight: 700, color: col.color }}>{fmt(total)}</span></div></div>);
                  })}
                  <CajaBajas formState={cajaForm} setFormState={setCajaForm} />
                  <CajaBonos formState={cajaForm} setFormState={setCajaForm} />
                  {bills.some(b => cajaForm.cierre[b.id]) && (() => {
                    const { tI, tC, totalBajas, totalBonos, mov } = calcCaja(cajaForm, bills);
                    const de = entries.find(e => e.fecha === cajaForm.date);
                    const pn = de ? (de.cargas - de.retiros) / 3 : null;
                    const dif = pn !== null ? mov - pn : null;
                    const al = dif !== null && Math.abs(dif) > 100;
                    return (<div style={{ background: al ? "linear-gradient(135deg,#2d0a0a,#1a0a00)" : "linear-gradient(135deg,#0a1f0a,#0a1200)", border: `1px solid ${al ? "#7f1d1d" : "#14532d"}`, borderRadius: 14, padding: "14px 18px" }}><div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>Resumen del turno</div><div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}><div><div style={{ fontSize: 10, color: "#475569" }}>Mov.</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: tC - tI >= 0 ? "#4ade80" : "#f87171" }}>{fmt(tC - tI)}</div></div>{totalBajas > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bajas</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#fbbf24" }}>+{fmt(totalBajas)}</div></div>}{totalBonos > 0 && <div><div style={{ fontSize: 10, color: "#475569" }}>Bonos</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>-{fmt(totalBonos)}</div></div>}<div><div style={{ fontSize: 10, color: "#475569" }}>Real</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: mov >= 0 ? "#4ade80" : "#f87171" }}>{fmt(mov)}</div></div>{pn !== null && <div><div style={{ fontSize: 10, color: "#475569" }}>Esperado</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: "#a78bfa" }}>{fmt(pn)}</div></div>}{dif !== null && <div><div style={{ fontSize: 10, color: "#475569" }}>Diferencia</div><div style={{ fontFamily: "'Inter',sans-serif", fontSize: 18, fontWeight: 800, color: al ? "#f87171" : "#4ade80" }}>{dif > 0 ? "+" : ""}{fmt(dif)}</div></div>}</div>{al && <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>⚠️ Diferencia significativa</div>}</div>);
                  })()}
                  <button onClick={saveCaja} style={{ ...S.btn, width: "100%" }}>📋 Guardar cierre de turno</button>
                </div>
              </div>
            )}

            {cajaTab === "historial" && (
              <div>
                {cajaHistorial.length === 0 ? <div style={{ textAlign: "center", padding: "40px", color: "#7c6fa0" }}>No hay registros todavía.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {cajaHistorial.map(c => {
                      const isExp = expandedCaja === c.fecha + c.turno_id;
                      const hasDif = Math.abs(c.dif) > 100;
                      const commentKey = c.fecha + c.turno_id;
                      return (
                        <div key={commentKey} style={{ background: hasDif ? "#1a0808" : C.card, border: `1px solid ${hasDif ? "#7f1d1d" : C.border}`, borderRadius: 14 }}>
                          <div onClick={() => setExpandedCaja(isExp ? null : commentKey)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", cursor: "pointer", flexWrap: "wrap", gap: 8 }}>
                            <div><span style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13 }}>{new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</span><span style={{ marginLeft: 10, fontSize: 11, color: "#475569" }}>{c.turnoLabel}</span><span style={{ marginLeft: 10, fontSize: 11, color: "#9f67ff" }}>· 👤 {c.empleado_nombre}</span></div>
                            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Real</div><div style={{ color: c.mov >= 0 ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 13 }}>{fmt(c.mov)}</div></div>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Diferencia</div><div style={{ color: hasDif ? "#f87171" : "#4ade80", fontWeight: 800, fontFamily: "'Inter',sans-serif", fontSize: 14 }}>{c.dif > 0 ? "+" : ""}{fmt(c.dif)}</div></div>
                              <Badge ok={!hasDif} />
                              <span style={{ color: "#475569", fontSize: 11 }}>{isExp ? "▲" : "▼"}</span>
                            </div>
                          </div>
                          {isExp && (
                            <div style={{ padding: "0 18px 16px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                                {[{ label: "🟢 Apertura", k: "inicio", color: "#38bdf8", total: c.tI }, { label: "🔴 Cierre", k: "cierre", color: "#f87171", total: c.tC }].map(col => (
                                  <div key={col.k}><div style={{ fontSize: 11, color: col.color, marginBottom: 8 }}>{col.label}</div>{bills.map(b => (<div key={b.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #1a1530" }}><span style={{ color: "#7c6fa0" }}>{b.nombre}</span><span style={{ color: "#e2e8f0" }}>{fmt(c[col.k]?.[b.id] || 0)}</span></div>))}<div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, paddingTop: 6, fontWeight: 700 }}><span style={{ color: col.color }}>Total</span><span style={{ color: col.color }}>{fmt(col.total)}</span></div></div>
                                ))}
                              </div>
                              {(c.bonos || []).length > 0 && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#a78bfa", marginBottom: 6 }}>🎁 Bonos</div>{(c.bonos || []).map((b, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #1a1530" }}><span style={{ color: "#7c6fa0" }}>{b.jugador || "—"}{b.nota ? ` · ${b.nota}` : ""}</span><span style={{ color: "#a78bfa", fontWeight: 700 }}>{fmt(+b.monto || 0)}</span></div>))}</div>}
                              {(c.bajas || []).length > 0 && <div style={{ marginBottom: 10 }}><div style={{ fontSize: 11, color: "#fbbf24", marginBottom: 6 }}>📤 Bajas</div>{(c.bajas || []).map((b, i) => { const bill = bills.find(x => x.id === b.billeteraId); const dest = destinos.find(d => d.id === b.destinoId); return (<div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid #1a1530" }}><span style={{ color: "#7c6fa0" }}>{bill?.nombre || "—"}{dest ? ` → ${dest.alias}` : ""}</span><span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(+b.monto || 0)}</span></div>); })}</div>}
                              <div style={{ marginTop: 8 }}>
                                <div style={{ fontSize: 10, color: "#7c6fa0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>💬 Comentario interno</div>
                                <div style={{ display: "flex", gap: 8 }}>
                                  <input type="text" value={cajaComment[commentKey] !== undefined ? cajaComment[commentKey] : (c.comentario_dueno || "")} placeholder="Nota interna..." onChange={e => setCajaComment({ ...cajaComment, [commentKey]: e.target.value })} style={{ ...S.input, flex: 1, fontSize: 12, padding: "8px 12px" }} />
                                  <button onClick={() => saveComment(c.fecha, c.turno_id, cajaComment[commentKey] !== undefined ? cajaComment[commentKey] : c.comentario_dueno || "")} style={{ ...S.btn, padding: "8px 14px", fontSize: 12 }}>Guardar</button>
                                </div>
                                {c.comentario_dueno && cajaComment[commentKey] === undefined && <div style={{ fontSize: 12, color: "#a78bfa", marginTop: 6, fontStyle: "italic" }}>"{c.comentario_dueno}"</div>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === "jugadores" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#9f67ff" }}>👥 Jugadores</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
              {[{ label: "Nuevos este mes", value: cmNuevos, color: "#fbbf24", icon: "🆕" }, { label: "Nuevos mes pasado", value: pmNuevos, color: "#a78bfa", icon: "📅" }, { label: "Activos este mes", value: cmUnicos, color: "#38bdf8", icon: "🎮" }, { label: "Total historial", value: totalPlayers, color: "#4ade80", icon: "📁" }].map(s => (
                <div key={s.label} style={S.card}><div style={{ fontSize: 18, marginBottom: 6 }}>{s.icon}</div><div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div><div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{s.label}</div></div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "💪 Cargas fuertes", sub: "+$15.000", seg: "fuerte", color: "#4ade80", border: "rgba(74,222,128,0.25)", count: jugadores.filter(j => (j.total_mes||0) >= 15000).length },
                { label: "📊 Cargas medias", sub: "$5.000 – $15.000", seg: "media", color: "#fbbf24", border: "rgba(251,191,36,0.25)", count: jugadores.filter(j => (j.total_mes||0) >= 5000 && (j.total_mes||0) < 15000).length },
                { label: "🔻 Cargas bajas", sub: "Hasta $5.000", seg: "baja", color: "#f87171", border: "rgba(248,113,113,0.25)", count: jugadores.filter(j => (j.total_mes||0) > 0 && (j.total_mes||0) < 5000).length },
                { label: "🔥 Alta frecuencia", sub: "5+ cargas este mes", seg: "frecuente", color: "#a78bfa", border: "rgba(167,139,250,0.25)", count: jugadores.filter(j => (j.frecuencia_mes||0) >= 5).length },
              ].map(seg => (
                <div key={seg.seg} onClick={() => setJugSeg(jugSeg === seg.seg ? null : seg.seg)} style={{ ...S.card, borderColor: jugSeg === seg.seg ? seg.border : C.border, cursor: "pointer", background: jugSeg === seg.seg ? "rgba(255,255,255,0.03)" : C.card }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: seg.color, marginBottom: 4 }}>{seg.label}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>{seg.sub}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: seg.color }}>{seg.count}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>jugadores</div>
                </div>
              ))}
            </div>
            {jugSeg && (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#9f67ff" }}>
                    {jugSeg === "fuerte" ? "💪 Cargas fuertes (+$15.000)" : jugSeg === "media" ? "📊 Cargas medias ($5.000 – $15.000)" : jugSeg === "baja" ? "🔻 Cargas bajas (hasta $5.000)" : "🔥 Alta frecuencia (5+ cargas)"}
                  </div>
                  <button onClick={() => setJugSeg(null)} style={S.ghost}>✕ Cerrar</button>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <input type="text" placeholder="Buscar jugador..." value={jugFiltro} onChange={e => setJugFiltro(e.target.value)} style={{ ...S.input, fontSize: 13 }} />
                </div>
                {jugadores.filter(j => {
                  const ok = jugSeg === "fuerte" ? (j.total_mes||0) >= 15000 : jugSeg === "media" ? (j.total_mes||0) >= 5000 && (j.total_mes||0) < 15000 : jugSeg === "baja" ? (j.total_mes||0) > 0 && (j.total_mes||0) < 5000 : (j.frecuencia_mes||0) >= 5;
                  return ok && (!jugFiltro || j.nombre.toLowerCase().includes(jugFiltro.toLowerCase()));
                }).length === 0 ? (
                  <div style={{ color: "#475569", textAlign: "center", padding: 24 }}>No hay jugadores en este segmento todavía.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {jugadores.filter(j => {
                      const ok = jugSeg === "fuerte" ? (j.total_mes||0) >= 15000 : jugSeg === "media" ? (j.total_mes||0) >= 5000 && (j.total_mes||0) < 15000 : jugSeg === "baja" ? (j.total_mes||0) > 0 && (j.total_mes||0) < 5000 : (j.frecuencia_mes||0) >= 5;
                      return ok && (!jugFiltro || j.nombre.toLowerCase().includes(jugFiltro.toLowerCase()));
                    }).map(j => (
                      <div key={j.nombre} style={{ background: "#0a0a14", border: "1px solid #1e1e38", borderRadius: 12, padding: "13px 16px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 600, color: "#f1f5f9", fontSize: 14 }}>👤 {j.nombre}</div>
                            <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>Primera vez: {j.primera_vez || "—"}{j.telefono ? ` · 📱 ${j.telefono}` : ""}</div>
                          </div>
                          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                            {j.telefono ? (
                              <span style={{ fontSize: 12, color: "#4ade80" }}>📱 {j.telefono}</span>
                            ) : (
                              <input type="text" placeholder="+ teléfono" style={{ ...S.input, width: 130, fontSize: 12, padding: "6px 10px" }}
                                onBlur={async e => { if (e.target.value) { await supabase.from("jugadores").update({ telefono: e.target.value }).eq("tenant_id", tid).eq("nombre", j.nombre); loadAll(); } }} />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {(cmNuevos > 0 || pmNuevos > 0) && (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 14 }}>Nuevos: mes a mes</div>
                {[{ label: monthLabel(-1), value: pmNuevos, color: "#78350f", tc: "#a78bfa" }, { label: monthLabel(), value: cmNuevos, color: "linear-gradient(90deg,#d97706,#fbbf24)", tc: "#fbbf24" }].map(row => (
                  <div key={row.label} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: "#475569", width: 90, textTransform: "capitalize", flexShrink: 0 }}>{row.label}</div>
                    <div style={{ flex: 1, background: "#1e1e38", borderRadius: 100, height: 8 }}><div style={{ background: row.color, borderRadius: 100, height: 8, width: `${Math.max(cmNuevos, pmNuevos) > 0 ? (row.value / Math.max(cmNuevos, pmNuevos)) * 100 : 0}%`, transition: "width 1s ease" }} /></div>
                    <div style={{ fontWeight: 800, color: row.tc, width: 28, textAlign: "right" }}>{row.value}</div>
                  </div>
                ))}
              </div>
            )}
            {cmEntries.some(e => e.jugadores_nuevos > 0) && (
              <div style={S.card}>
                <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 14 }}>Día a día este mes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cmEntries.filter(e => e.jugadores_nuevos > 0).map(entry => (
                    <div key={entry.fecha}>
                      <div onClick={() => setExpandedDay(expandedDay === entry.fecha ? null : entry.fecha)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0a0a14", borderRadius: 10, cursor: "pointer", border: "1px solid #1e1e38" }}>
                        <span style={{ color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>{new Date(entry.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</span>
                        <span style={{ fontWeight: 800, color: "#fbbf24", fontSize: 16 }}>+{entry.jugadores_nuevos}</span>
                      </div>
                      {expandedDay === entry.fecha && (entry.jugadores_nuevos_lista || []).length > 0 && (<div style={{ background: "#0a0812", border: "1px solid #1a1530", borderTop: "none", borderRadius: "0 0 10px 10px", padding: "10px 14px", display: "flex", flexWrap: "wrap", gap: 8 }}>{(entry.jugadores_nuevos_lista || []).map(j => <span key={j} style={{ background: "#1a1225", border: "1px solid #3b2a5a", borderRadius: 20, padding: "3px 12px", fontSize: 12, color: "#c084fc" }}>👤 {j}</span>)}</div>)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "bonos" && (
          <div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#c084fc" }}>🎁 Seguimiento de Bonos</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
              {[{ label: "Total bonos", value: fmt(totalBonosGeneral), color: "#a78bfa", icon: "🎁" }, { label: "Neto real del mes", value: fmt(cmN - totalBonosGeneral), color: cmN - totalBonosGeneral >= 0 ? "#4ade80" : "#f87171", icon: "📊" }, { label: "Empleados con bonos", value: todosBonos.length > 0 ? [...new Set(todosBonos.map(b => b.empleado))].length : 0, color: "#fbbf24", icon: "👥" }].map(k => (
                <div key={k.label} style={S.card}><div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ fontSize: 10, color: "#7c6fa0", textTransform: "uppercase", letterSpacing: 1 }}>{k.label}</div><span style={{ fontSize: 20 }}>{k.icon}</span></div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, color: k.color, margin: "8px 0 4px" }}>{k.value}</div></div>
              ))}
            </div>
            {rankingEmpleados.length > 0 && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#f87171", fontWeight: 600, marginBottom: 6 }}>🏆 Ranking por diferencias acumuladas</div>
                <div style={{ fontSize: 11, color: "#4c3a70", marginBottom: 14 }}>Mayor diferencia = mayor riesgo</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {rankingEmpleados.map((emp, i) => {
                    const isRisk = emp.difTotal > 5000 || emp.difNeg > 2;
                    return (<div key={emp.id} style={{ background: "#0a0a0f", border: `1px solid ${isRisk ? "#7f1d1d" : "#2a1f4a"}`, borderRadius: 12, padding: "14px 16px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, color: i === 0 ? "#f87171" : i === 1 ? "#fbbf24" : "#7c6fa0", fontSize: 16, width: 24 }}>#{i + 1}</div><div><div style={{ color: "#e2e8f0", fontWeight: 600, fontSize: 14 }}>{emp.nombre}</div><div style={{ fontSize: 11, color: "#7c6fa0", marginTop: 2 }}>{emp.turnos} turnos · {emp.difNeg} dif. negativa{emp.difNeg !== 1 ? "s" : ""}</div></div></div><div style={{ textAlign: "right" }}><div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, color: isRisk ? "#f87171" : "#7c6fa0", fontSize: 16 }}>{fmt(emp.difTotal)}</div></div></div><div style={{ display: "flex", gap: 16, fontSize: 12 }}><div><span style={{ color: "#4c3a70" }}>Bonos: </span><span style={{ color: "#a78bfa", fontWeight: 600 }}>{fmt(emp.totalBonos)}</span></div>{isRisk && <div style={{ color: "#f87171", fontWeight: 600 }}>⚠️ Requiere atención</div>}</div></div>);
                  })}
                </div>
              </div>
            )}
            {todosBonos.length === 0 && <div style={{ ...S.card, textAlign: "center", padding: 40 }}><div style={{ fontSize: 36, marginBottom: 10 }}>🎁</div><div style={{ color: "#7c6fa0" }}>No hay bonos registrados todavía.</div></div>}
          </div>
        )}

        {activeTab === "bajas" && (
          <div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#c084fc" }}>📤 Flujo de Bajas</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
              {[{ label: "Total bajado", value: fmt(totalBajasGeneral), color: "#fbbf24", sub: `${todasBajas.length} movimientos` }, { label: "Neto del mes", value: fmt(cmN), color: cmN >= 0 ? "#4ade80" : "#f87171", sub: "generado en el panel" }, { label: "En cuentas", value: fmt(cmN - totalBajasGeneral), color: cmN - totalBajasGeneral >= 0 ? "#4ade80" : "#f87171", sub: "diferencia estimada" }].map(k => (
                <div key={k.label} style={S.card}><div style={{ fontSize: 10, color: "#7c6fa0", textTransform: "uppercase", letterSpacing: 1 }}>{k.label}</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, color: k.color, margin: "8px 0 4px" }}>{k.value}</div><div style={{ fontSize: 11, color: "#7c6fa0" }}>{k.sub}</div></div>
              ))}
            </div>
            {destinos.filter(d => todasBajas.some(b => b.destinoId === d.id)).length > 0 && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 600, marginBottom: 14 }}>Por destino</div>
                {destinos.map(dest => { const total = todasBajas.filter(b => b.destinoId === dest.id).reduce((s, b) => s + (+b.monto || 0), 0); if (!total) return null; return (
                  <div key={dest.id} style={{ padding: "12px 0", borderBottom: "1px solid #1a1530" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><div><div style={{ color: "#e2e8f0", fontWeight: 600 }}>{dest.alias}</div><div style={{ fontSize: 11, color: "#7c6fa0", marginTop: 2 }}>👤 {dest.titular} · <span style={{ fontFamily: "monospace", color: "#a78bfa" }}>{dest.cbu}</span></div></div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, color: "#fbbf24" }}>{fmt(total)}</div></div>
                    <div style={{ background: "#1a1530", borderRadius: 100, height: 4 }}><div style={{ background: "linear-gradient(90deg,#d97706,#fbbf24)", borderRadius: 100, height: 4, width: `${totalBajasGeneral > 0 ? (total / totalBajasGeneral) * 100 : 0}%` }} /></div>
                  </div>
                ); })}
              </div>
            )}
            <div style={S.card}>
              <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600, marginBottom: 14 }}>Historial</div>
              {todasBajas.length === 0 ? <div style={{ color: "#4c3a70", fontSize: 13 }}>No hay bajas todavía.</div> : todasBajas.map((b, i) => { const bill = bills.find(x => x.id === b.billeteraId); const dest = destinos.find(d => d.id === b.destinoId); return (<div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1a1530", gap: 10, flexWrap: "wrap" }}><div><div style={{ display: "flex", gap: 10 }}><span style={{ color: "#a78bfa", fontSize: 12, fontWeight: 600 }}>{new Date(b.fecha + "T12:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })}</span><span style={{ fontSize: 11, color: "#c084fc" }}>👤 {b.empleado}</span></div><div style={{ fontSize: 12, color: "#7c6fa0", marginTop: 2 }}><span style={{ color: "#38bdf8" }}>💳 {bill?.nombre || "—"}</span>{dest && <span style={{ marginLeft: 8 }}>→ <span style={{ color: "#fbbf24" }}>{dest.alias}</span></span>}</div></div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "#fbbf24" }}>{fmt(+b.monto || 0)}</div></div>); })}
            </div>
          </div>
        )}

        {activeTab === "importar" && (
          <div style={{ maxWidth: 620 }}>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#c084fc" }}>📂 Importar CSV</h2>
            {!importPreview ? (
              <div onClick={() => fileRef.current.click()} style={{ border: "2px dashed #4c1d95", borderRadius: 16, padding: "48px", textAlign: "center", cursor: "pointer", background: "#0d0a1a" }} onMouseEnter={e => e.currentTarget.style.borderColor = "#7c3aed"} onMouseLeave={e => e.currentTarget.style.borderColor = "#4c1d95"}>
                <div style={{ fontSize: 40, marginBottom: 10 }}>📁</div>
                <div style={{ color: "#a78bfa", fontWeight: 600, fontSize: 14 }}>{importing ? "Procesando..." : "Hacé clic para seleccionar el CSV"}</div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: "none" }} />
              </div>
            ) : (
              <div>
                <div style={{ ...S.card, marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "#a78bfa", marginBottom: 14 }}>✅ <strong>{importPreview.file}</strong></div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
                    {[{ label: "Días", value: importPreview.data.length, color: "#c084fc" }, { label: "Cargas", value: fmt(sumK(importPreview.data, "cargas")), color: "#4ade80" }, { label: "Retiros", value: fmt(sumK(importPreview.data, "retiros")), color: "#f87171" }, { label: "Jugadores nuevos", value: importPreview.totalNew, color: "#fbbf24" }].map(s => (<div key={s.label} style={{ background: "#0a0a0f", borderRadius: 10, padding: "10px 12px" }}><div style={{ fontSize: 10, color: "#7c6fa0", marginBottom: 4 }}>{s.label}</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div></div>))}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#7c6fa0", marginBottom: 10 }}>¿Qué hacemos si ya existen fechas?</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={() => confirmImport("replace")} style={{ ...S.btn, flex: 1 }}>✅ Reemplazar</button>
                  <button onClick={() => confirmImport("merge")} style={{ flex: 1, background: "#1e1b3a", border: "1px solid #4c1d95", color: "#a78bfa", padding: "12px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>➕ Sumar</button>
                  <button onClick={() => setImportPreview(null)} style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", color: "#f87171", padding: "12px 14px", borderRadius: 12, cursor: "pointer" }}>✕</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "cargar" && (
          <div style={{ maxWidth: 460 }}>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#c084fc" }}>{editId ? "✏️ Editar" : "➕ Cargar Día del Panel"}</h2>
            {[{ label: "Fecha", key: "date", type: "date" }, { label: "💰 Cargas ($)", key: "cargas", type: "number", ph: "0" }, { label: "💸 Retiros ($)", key: "retiros", type: "number", ph: "0" }].map(f => (<div key={f.key} style={{ marginBottom: 14 }}><label style={S.label}>{f.label}</label><input type={f.type} value={form[f.key]} placeholder={f.ph} onChange={e => setForm({ ...form, [f.key]: e.target.value })} style={S.input} /></div>))}
            <div style={{ marginBottom: 18 }}><label style={S.label}>📝 Notas</label><textarea value={form.notas} placeholder="Novedades..." onChange={e => setForm({ ...form, notas: e.target.value })} rows={3} style={{ ...S.input, resize: "vertical" }} /></div>
            {form.cargas && form.retiros && <div style={{ background: "#1a0533", border: "1px solid #4c1d95", borderRadius: 12, padding: "12px 16px", marginBottom: 16 }}><div style={{ display: "flex", gap: 20 }}><div><span style={{ color: "#7c6fa0", fontSize: 12 }}>Neto: </span><span style={{ color: +form.cargas - +form.retiros >= 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>{fmt(+form.cargas - +form.retiros)}</span></div></div></div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={addEntry} style={{ ...S.btn, flex: 1 }}>{editId ? "Actualizar" : "Guardar"}</button>
              {editId && <button onClick={() => { setEditId(null); setForm({ date: todayStr(), cargas: "", retiros: "", notas: "" }); }} style={{ background: "#1e1b3a", border: "1px solid #2a1f4a", color: "#7c6fa0", padding: "12px 18px", borderRadius: 12, cursor: "pointer" }}>Cancelar</button>}
            </div>
          </div>
        )}

        {activeTab === "historial" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#9f67ff" }}>📋 Historial</h2>
              <button onClick={() => { const rows = [["Fecha", "Cargas", "Retiros", "Neto"], ...[...entries].reverse().map(e => [e.fecha, e.cargas, e.retiros, e.cargas - e.retiros])]; const csv = rows.map(r => r.join(",")).join("\n"); const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `historial.csv`; a.click(); }} style={S.ghost}>⬇️ Exportar CSV</button>
            </div>
            {entries.length === 0 ? <div style={{ textAlign: "center", padding: "40px", color: "#475569" }}>No hay registros.</div> : (() => {
              const byMes = {};
              [...entries].reverse().forEach(e => {
                const mes = e.fecha.slice(0, 7);
                if (!byMes[mes]) byMes[mes] = { entries: [], cargas: 0, retiros: 0, jugNuevos: 0 };
                byMes[mes].entries.push(e);
                byMes[mes].cargas += e.cargas || 0;
                byMes[mes].retiros += e.retiros || 0;
                byMes[mes].jugNuevos += e.jugadores_nuevos || 0;
              });
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {Object.entries(byMes).map(([mes, data]) => {
                    const neto = data.cargas - data.retiros;
                    const mesLabel = new Date(mes + "-15").toLocaleString("es-AR", { month: "long", year: "numeric" });
                    const isOpen = expandedCaja === mes;
                    return (
                      <div key={mes} style={{ ...S.card }}>
                        <div onClick={() => setExpandedCaja(isOpen ? null : mes)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", flexWrap: "wrap", gap: 10 }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9", textTransform: "capitalize" }}>📅 {mesLabel}</div>
                            <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>{data.entries.length} días · {data.jugNuevos} jugadores nuevos</div>
                          </div>
                          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                            {[{ label: "Cargas", v: data.cargas, c: "#4ade80" }, { label: "Retiros", v: data.retiros, c: "#f87171" }, { label: "Neto", v: neto, c: neto >= 0 ? "#4ade80" : "#f87171" }].map(x => (
                              <div key={x.label} style={{ textAlign: "right" }}>
                                <div style={{ fontSize: 10, color: "#475569" }}>{x.label}</div>
                                <div style={{ color: x.c, fontWeight: 700, fontSize: 14 }}>{fmt(x.v)}</div>
                              </div>
                            ))}
                            <span style={{ color: "#475569", fontSize: 13 }}>{isOpen ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 14, borderTop: "1px solid #1e1e38", paddingTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                            {data.entries.map(entry => {
                              const neto = entry.cargas - entry.retiros;
                              return (
                                <div key={entry.id} style={{ background: "#07070f", border: "1px solid #1e1e38", borderRadius: 11, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                  <div>
                                    <div style={{ fontWeight: 600, color: "#a78bfa", fontSize: 13 }}>{new Date(entry.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</div>
                                    {entry.notas && <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>{entry.notas}</div>}
                                    {entry.jugadores_nuevos > 0 && <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 1 }}>🆕 {entry.jugadores_nuevos} nuevos</div>}
                                  </div>
                                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                    {[{ label: "Cargas", v: entry.cargas, c: "#4ade80" }, { label: "Retiros", v: entry.retiros, c: "#f87171" }, { label: "Neto", v: neto, c: neto >= 0 ? "#4ade80" : "#f87171" }].map(x => (
                                      <div key={x.label} style={{ textAlign: "right" }}>
                                        <div style={{ fontSize: 10, color: "#475569" }}>{x.label}</div>
                                        <div style={{ color: x.c, fontWeight: 600, fontSize: 13 }}>{fmt(x.v)}</div>
                                      </div>
                                    ))}
                                    <div style={{ display: "flex", gap: 5 }}>
                                      <button onClick={e => { e.stopPropagation(); editEntry(entry); }} style={{ background: "#0e0e1a", border: "1px solid #2a1f4a", color: "#a78bfa", padding: "4px 8px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>✏️</button>
                                      <button onClick={e => { e.stopPropagation(); delEntry(entry.id); }} style={{ background: "#1e0a0a", border: "1px solid #7f1d1d", color: "#f87171", padding: "4px 8px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>🗑️</button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "campana" && (
          <div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#c084fc" }}>📣 Campaña de Recuperación</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 }}>
              {[{ label: "Mensajes enviados", value: (campaign.enviados || 0).toLocaleString("es-AR"), icon: "📨", color: "#818cf8" }, { label: "Recuperados", value: (campaign.recuperados || 0).toLocaleString("es-AR"), icon: "🔄", color: "#4ade80" }, { label: "Depósitos generados", value: fmt(campaign.depositos), icon: "💵", color: "#fbbf24" }].map(s => (<div key={s.label} style={S.card}><div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div><div style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div><div style={{ fontSize: 11, color: "#7c6fa0", marginTop: 4 }}>{s.label}</div></div>))}
            </div>
            <div style={{ background: "linear-gradient(135deg,#1a0533,#0d1b3e)", border: "1px solid #4c1d95", borderRadius: 14, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><span style={{ fontSize: 13, color: "#a78bfa" }}>Tasa de recuperación</span><span style={{ fontFamily: "'Syne',sans-serif", fontSize: 22, fontWeight: 800, color: recoveryRate > 10 ? "#4ade80" : recoveryRate > 5 ? "#fbbf24" : "#f87171" }}>{recoveryRate}%</span></div>
              <div style={{ background: "#2a1f4a", borderRadius: 100, height: 8 }}><div style={{ background: "linear-gradient(90deg,#7c3aed,#4ade80)", borderRadius: 100, height: 8, width: `${Math.min(recoveryRate, 100)}%` }} /></div>
            </div>
            <div style={S.card}>
              <div style={{ fontSize: 12, color: "#a78bfa", marginBottom: 14, fontWeight: 600 }}>Actualizar</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
                {[{ label: "📨 Enviados", key: "enviados", ph: campaign.enviados }, { label: "🔄 Recuperados", key: "recuperados", ph: campaign.recuperados }, { label: "💵 Depósitos ($)", key: "depositos", ph: campaign.depositos }].map(f => (<div key={f.key}><label style={S.label}>{f.label}</label><input type="number" placeholder={f.ph} value={campForm[f.key]} onChange={e => setCampForm({ ...campForm, [f.key]: e.target.value })} style={{ width: "100%", background: "#0a0a0f", border: "1px solid #2a1f4a", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box" }} /></div>))}
              </div>
              <button onClick={saveCamp} style={S.btn}>Guardar</button>
            </div>
          </div>
        )}

        {activeTab === "meses" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#9f67ff" }}>📆 Historial por Mes</h2>
            {(() => {
              const mesesData = {};
              entries.forEach(e => {
                const mes = e.fecha.slice(0, 7);
                if (!mesesData[mes]) mesesData[mes] = { mes, cargas: 0, retiros: 0, neto: 0, dias: 0, jugNuevos: 0, jugUnicos: 0 };
                mesesData[mes].cargas += e.cargas || 0;
                mesesData[mes].retiros += e.retiros || 0;
                mesesData[mes].neto += (e.cargas || 0) - (e.retiros || 0);
                mesesData[mes].dias += 1;
                mesesData[mes].jugNuevos += e.jugadores_nuevos || 0;
                mesesData[mes].jugUnicos += e.jugadoresUnicos || 0;
              });
              const lista = Object.values(mesesData).sort((a,b) => b.mes.localeCompare(a.mes));
              if (lista.length === 0) return <div style={{ ...S.card, textAlign: "center", padding: 40, color: "#475569" }}>No hay datos todavía. Importá CSVs para ver el historial mensual.</div>;
              const maxNeto = Math.max(...lista.map(m => Math.abs(m.neto)), 1);
              return (
                <div>
                  <div style={{ ...S.card, marginBottom: 20 }}>
                    <div style={{ fontSize: 12, color: "#9f67ff", fontWeight: 700, marginBottom: 16 }}>Evolución mensual</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={[...lista].reverse()} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                        <defs>
                          <linearGradient id="gCargas" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4ade80" stopOpacity={0.3}/><stop offset="95%" stopColor="#4ade80" stopOpacity={0}/></linearGradient>
                          <linearGradient id="gRetiros" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f87171" stopOpacity={0.3}/><stop offset="95%" stopColor="#f87171" stopOpacity={0}/></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e38" />
                        <XAxis dataKey="mes" tick={{ fill: "#475569", fontSize: 11 }} />
                        <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickFormatter={v => "$"+Math.round(v/1000)+"k"} />
                        <Tooltip formatter={(v, n) => [fmt(v), n === "cargas" ? "Cargas" : "Retiros"]} contentStyle={{ background: "#0e0e1a", border: "1px solid #1e1e38", borderRadius: 10 }} />
                        <Area type="monotone" dataKey="cargas" stroke="#4ade80" fill="url(#gCargas)" strokeWidth={2} />
                        <Area type="monotone" dataKey="retiros" stroke="#f87171" fill="url(#gRetiros)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {lista.map((m, i) => {
                      const prev = lista[i+1];
                      const diff = prev ? m.neto - prev.neto : 0;
                      const mesLabel = new Date(m.mes + "-15").toLocaleString("es-AR", { month: "long", year: "numeric" });
                      return (
                        <div key={m.mes} style={{ ...S.card }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 15, color: "#f1f5f9", textTransform: "capitalize" }}>{mesLabel}</div>
                              <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{m.dias} días · {m.jugNuevos} nuevos · {m.jugUnicos} únicos</div>
                            </div>
                            <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Cargas</div><div style={{ color: "#4ade80", fontWeight: 700, fontSize: 14 }}>{fmt(m.cargas)}</div></div>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Retiros</div><div style={{ color: "#f87171", fontWeight: 700, fontSize: 14 }}>{fmt(m.retiros)}</div></div>
                              <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Neto</div><div style={{ color: m.neto >= 0 ? "#4ade80" : "#f87171", fontWeight: 800, fontSize: 18 }}>{fmt(m.neto)}</div></div>
                              {prev && <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>vs ant.</div><div style={{ color: diff >= 0 ? "#4ade80" : "#f87171", fontWeight: 700, fontSize: 13 }}>{diff >= 0 ? "+" : ""}{fmt(diff)}</div></div>}
                            </div>
                          </div>
                          <div style={{ background: "#07070f", borderRadius: 8, height: 6 }}>
                            <div style={{ background: m.neto >= 0 ? "linear-gradient(90deg,#059669,#4ade80)" : "linear-gradient(90deg,#dc2626,#f87171)", borderRadius: 8, height: 6, width: `${Math.min((Math.abs(m.neto)/maxNeto)*100, 100)}%`, transition: "width 1s ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "ia" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>🤖</div>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#9f67ff" }}>IA Analista</h2>
                <p style={{ color: "#475569", fontSize: 12, margin: "3px 0 0" }}>Análisis inteligente de tu operación en tiempo real</p>
              </div>
            </div>

            <div style={{ ...S.card, marginBottom: 16, background: "linear-gradient(135deg,rgba(124,58,237,0.08),rgba(79,70,229,0.05))", borderColor: "rgba(124,58,237,0.3)" }}>
              <div style={{ fontSize: 12, color: "#9f67ff", fontWeight: 700, marginBottom: 10 }}>📊 Datos que va a analizar</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                {[
                  { label: "Cargas del mes", v: fmt(cmN + cmR) },
                  { label: "Neto del mes", v: fmt(cmN) },
                  { label: "Jugadores activos", v: cmUnicos },
                  { label: "Alertas de caja", v: alertas.length },
                ].map(x => (
                  <div key={x.label} style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 4 }}>{x.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>{x.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, marginBottom: 10 }}>💬 Preguntale algo específico (opcional)</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="text"
                  value={iaPregunta}
                  onChange={e => setIaPregunta(e.target.value)}
                  placeholder='Ej: "¿Qué días rinden más?" o "¿Hay algo raro en caja?"'
                  style={{ ...S.input, flex: 1, fontSize: 13 }}
                  onKeyDown={e => e.key === "Enter" && !iaLoading && (() => {
                    setIaLoading(true);
                    setIaAnalisis(null);
                    const mesesData = {};
                    entries.forEach(e => {
                      const mes = e.fecha.slice(0,7);
                      if (!mesesData[mes]) mesesData[mes] = { cargas: 0, retiros: 0, dias: 0 };
                      mesesData[mes].cargas += e.cargas || 0;
                      mesesData[mes].retiros += e.retiros || 0;
                      mesesData[mes].dias++;
                    });
                    const resumenMeses = Object.entries(mesesData).slice(-3).map(([mes,d]) => `${mes}: cargas $${Math.round(d.cargas/1000)}k, retiros $${Math.round(d.retiros/1000)}k, neto $${Math.round((d.cargas-d.retiros)/1000)}k (${d.dias} días)`).join('\n');
                    const prompt = `Sos un analista experto en operaciones de casinos online en Argentina. Analizá estos datos reales y respondé de forma clara, directa y útil para el dueño del negocio. Usá pesos argentinos y sé específico.\n\nDATOS DEL NEGOCIO:\n- Nombre: ${config.nombre || "Casino"}\n- Mes actual: cargas $${Math.round((cmN+cmR > 0 ? cmN+cmR : 0)/1000)}k, retiros $${Math.round((cmR||0)/1000)}k, neto $${Math.round((cmN||0)/1000)}k\n- Jugadores activos este mes: ${cmUnicos}\n- Jugadores nuevos este mes: ${cmNuevos}\n- Alertas de caja (diferencias detectadas): ${alertas.length}\n- Empleados activos: ${empleados.filter(e=>e.activo).length}\n- Historial últimos meses:\n${resumenMeses}\n- Total jugadores en historial: ${totalPlayers}\n${iaPregunta ? `\nPREGUNTA ESPECÍFICA DEL DUEÑO: ${iaPregunta}` : "\nHacé un análisis completo identificando: tendencias, oportunidades de mejora, alertas o riesgos, y 3 recomendaciones concretas para esta semana."}`;
                    fetch("https://rpqfzsrmmamfhxxarvvf.supabase.co/functions/v1/ia-analista", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ prompt })
                    }).then(r => r.json()).then(data => {
                      setIaAnalisis(data.result || ("Error: " + (data.error || "No se pudo obtener análisis.")));
                      setIaLoading(false);
                    }).catch(() => { setIaAnalisis("Error al conectar con la IA. Intentá de nuevo."); setIaLoading(false); });
                  })()}
                />
                <button
                  onClick={() => {
                    if (iaLoading) return;
                    setIaLoading(true);
                    setIaAnalisis(null);
                    const mesesData = {};
                    entries.forEach(e => {
                      const mes = e.fecha.slice(0,7);
                      if (!mesesData[mes]) mesesData[mes] = { cargas: 0, retiros: 0, dias: 0 };
                      mesesData[mes].cargas += e.cargas || 0;
                      mesesData[mes].retiros += e.retiros || 0;
                      mesesData[mes].dias++;
                    });
                    const resumenMeses = Object.entries(mesesData).slice(-3).map(([mes,d]) => `${mes}: cargas $${Math.round(d.cargas/1000)}k, retiros $${Math.round(d.retiros/1000)}k, neto $${Math.round((d.cargas-d.retiros)/1000)}k (${d.dias} días)`).join('\n');
                    const prompt = `Sos un analista experto en operaciones de casinos online en Argentina. Analizá estos datos reales y respondé de forma clara, directa y útil para el dueño del negocio. Usá pesos argentinos y sé específico.\n\nDATOS DEL NEGOCIO:\n- Nombre: ${config.nombre || "Casino"}\n- Mes actual: cargas $${Math.round((cmN+cmR > 0 ? cmN+cmR : 0)/1000)}k, retiros $${Math.round((cmR||0)/1000)}k, neto $${Math.round((cmN||0)/1000)}k\n- Jugadores activos este mes: ${cmUnicos}\n- Jugadores nuevos este mes: ${cmNuevos}\n- Alertas de caja (diferencias detectadas): ${alertas.length}\n- Empleados activos: ${empleados.filter(e=>e.activo).length}\n- Historial últimos meses:\n${resumenMeses}\n- Total jugadores en historial: ${totalPlayers}\n${iaPregunta ? `\nPREGUNTA ESPECÍFICA DEL DUEÑO: ${iaPregunta}` : "\nHacé un análisis completo identificando: tendencias, oportunidades de mejora, alertas o riesgos, y 3 recomendaciones concretas para esta semana."}`;
                    fetch("https://rpqfzsrmmamfhxxarvvf.supabase.co/functions/v1/ia-analista", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ prompt })
                    }).then(r => r.json()).then(data => {
                      setIaAnalisis(data.result || ("Error: " + (data.error || "No se pudo obtener análisis.")));
                      setIaLoading(false);
                    }).catch(() => { setIaAnalisis("Error al conectar con la IA. Intentá de nuevo."); setIaLoading(false); });
                  }}
                  disabled={iaLoading}
                  style={{ ...S.btn, padding: "11px 22px", opacity: iaLoading ? 0.7 : 1, whiteSpace: "nowrap" }}
                >
                  {iaLoading ? "Analizando..." : "🔍 Analizar"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {["¿Qué días rinden más?", "¿Hay riesgo en empleados?", "¿Están creciendo los jugadores?", "Recomendaciones para esta semana"].map(q => (
                  <button key={q} onClick={() => setIaPregunta(q)} style={{ background: "#0a0a16", border: "1px solid #1e1e38", color: "#475569", padding: "5px 12px", borderRadius: 20, cursor: "pointer", fontSize: 11 }}>{q}</button>
                ))}
              </div>
            </div>

            {iaLoading && (
              <div style={{ ...S.card, textAlign: "center", padding: 40 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
                <div style={{ color: "#9f67ff", fontWeight: 600, fontSize: 15 }}>Analizando tu operación...</div>
                <div style={{ color: "#475569", fontSize: 12, marginTop: 6 }}>Procesando datos del panel, caja y empleados</div>
              </div>
            )}

            {iaAnalisis && !iaLoading && (
              <div style={{ ...S.card, borderColor: "rgba(124,58,237,0.3)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🤖</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#9f67ff" }}>Análisis de IA</div>
                  <button onClick={() => setIaAnalisis(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#475569", cursor: "pointer", fontSize: 18 }}>✕</button>
                </div>
                <div style={{ fontSize: 14, color: "#e2e8f0", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{iaAnalisis}</div>
                <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid #1e1e38", display: "flex", gap: 10 }}>
                  <button onClick={() => { setIaAnalisis(null); setIaPregunta(""); }} style={S.ghost}>Nueva consulta</button>
                  <button onClick={() => navigator.clipboard?.writeText(iaAnalisis)} style={{ ...S.ghost, color: "#475569" }}>📋 Copiar</button>
                </div>
              </div>
            )}

            {!iaAnalisis && !iaLoading && (
              <div style={{ ...S.card, textAlign: "center", padding: 40, borderStyle: "dashed" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🧠</div>
                <div style={{ color: "#9f67ff", fontWeight: 600, fontSize: 15, marginBottom: 6 }}>IA lista para analizar</div>
                <div style={{ color: "#475569", fontSize: 13 }}>Presioná "Analizar" para obtener un diagnóstico de tu operación,<br/>o escribí una pregunta específica.</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "empleados_hist" && (
          <div>
            <h2 style={{ fontFamily: "'Inter',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#9f67ff" }}>👤 Historial por Empleado</h2>
            {empleados.length === 0 ? <div style={{ ...S.card, textAlign: "center", color: "#475569", padding: 40 }}>No hay empleados todavía.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {empleados.map(emp => {
                  const empCajas = cajaHistorial.filter(c => c.empleado_nombre === emp.nombre);
                  const isOpen = empHistoryId === emp.id;
                  const totalMov = empCajas.reduce((s, c) => s + c.mov, 0);
                  const totalDifAbs = empCajas.reduce((s, c) => s + Math.abs(c.dif || 0), 0);
                  const alertasEmp = empCajas.filter(c => Math.abs(c.dif || 0) > 100).length;
                  return (<div key={emp.id} style={{ ...S.card, borderColor: alertasEmp > 2 ? "#7f1d1d" : C.border }}>
                    <div onClick={() => setEmpHistoryId(isOpen ? null : emp.id)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", flexWrap: "wrap", gap: 10, marginBottom: isOpen ? 16 : 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 13, background: "linear-gradient(135deg,#7c3aed,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>👤</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color: emp.activo ? "#f1f5f9" : "#475569" }}>{emp.nombre}</div>
                          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                            {emp.horario_inicio ? `⏰ ${emp.horario_inicio}${emp.horario_fin ? " – " + emp.horario_fin : ""}` : "Sin horario fijo"} · {empCajas.length} turnos
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                        <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Total mov.</div><div style={{ color: totalMov >= 0 ? "#4ade80" : "#f87171", fontWeight: 700 }}>{fmt(totalMov)}</div></div>
                        <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>Dif. acum.</div><div style={{ color: alertasEmp > 2 ? "#f87171" : "#475569", fontWeight: 700 }}>{fmt(totalDifAbs)}</div></div>
                        {alertasEmp > 0 && <Tag color="#f87171">⚠️ {alertasEmp} alerta{alertasEmp > 1 ? "s" : ""}</Tag>}
                        <span style={{ color: "#475569", fontSize: 12 }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isOpen && (<div>
                      {empCajas.length === 0 ? <div style={{ color: "#475569", fontSize: 13, fontStyle: "italic" }}>Sin registros de caja todavía.</div> : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {empCajas.map(c => {
                            const hasDif = Math.abs(c.dif || 0) > 100;
                            const de = entries.find(e => e.fecha === c.fecha);
                            const pn = de ? (de.cargas - de.retiros) / 3 : null;
                            return (<div key={c.fecha + c.turno_id} style={{ background: hasDif ? "#1a0808" : "#0a0a14", border: `1px solid ${hasDif ? "#7f1d1d" : C.border}`, borderRadius: 12, padding: "13px 15px" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                                <div>
                                  <span style={{ color: "#a78bfa", fontWeight: 700, fontSize: 13 }}>{new Date(c.fecha + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })}</span>
                                  <span style={{ fontSize: 11, color: "#475569", marginLeft: 10 }}>{c.turnoLabel}</span>
                                </div>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                                  {[{ label: "Apertura", v: c.tI, col: "#38bdf8" }, { label: "Cierre", v: c.tC, col: "#f87171" }, { label: "Real", v: c.mov, col: c.mov >= 0 ? "#4ade80" : "#f87171" }, ...(pn !== null ? [{ label: "Esperado (⅓)", v: pn, col: "#a78bfa" }] : []), { label: "Diferencia", v: c.dif, col: hasDif ? "#f87171" : "#4ade80" }].map(x => (
                                    <div key={x.label} style={{ textAlign: "right" }}>
                                      <div style={{ fontSize: 10, color: "#475569" }}>{x.label}</div>
                                      <div style={{ color: x.col, fontWeight: 700, fontSize: 12 }}>{x.label === "Diferencia" && c.dif > 0 ? "+" : ""}{fmt(x.v)}</div>
                                    </div>
                                  ))}
                                  <Badge ok={!hasDif} />
                                </div>
                              </div>
                              {hasDif && <div style={{ fontSize: 12, color: "#f87171", fontWeight: 600 }}>⚠️ Diferencia significativa entre caja y panel</div>}
                            </div>);
                          })}
                        </div>
                      )}
                    </div>)}
                  </div>);
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "ajustes" && (
          <div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 20, color: "#c084fc" }}>⚙️ Ajustes</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
              {[{ id: "billeteras", label: "💳 Billeteras" }, { id: "empleados", label: "👥 Empleados" }, { id: "bajas", label: "📤 Destinos Bajas" }, { id: "negocio", label: "🏷️ Negocio" }].map(t => (<button key={t.id} onClick={() => setSettingsTab(t.id)} style={S.subBtn(settingsTab === t.id)}>{t.label}</button>))}
            </div>

            {settingsTab === "billeteras" && (
              <div style={{ maxWidth: 500 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600, marginBottom: 16 }}>Billeteras del negocio</div>
                  {bills.length > 0 && (<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>{bills.map((b, idx) => (<div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0a0a0f", borderRadius: 10, padding: "11px 14px", border: "1px solid #2a1f4a" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span>💳</span><span style={{ color: "#e2e8f0", fontSize: 14 }}>{b.nombre}</span></div><div style={{ display: "flex", gap: 6 }}><button onClick={() => moveBill(b.id, -1)} disabled={idx === 0} style={{ background: "#1e1b3a", border: "1px solid #2a1f4a", color: idx === 0 ? "#2a1f4a" : "#7c6fa0", padding: "4px 8px", borderRadius: 6, cursor: idx === 0 ? "default" : "pointer", fontSize: 11 }}>▲</button><button onClick={() => moveBill(b.id, 1)} disabled={idx === bills.length - 1} style={{ background: "#1e1b3a", border: "1px solid #2a1f4a", color: idx === bills.length - 1 ? "#2a1f4a" : "#7c6fa0", padding: "4px 8px", borderRadius: 6, cursor: idx === bills.length - 1 ? "default" : "pointer", fontSize: 11 }}>▼</button><button onClick={() => delBill(b.id)} style={S.danger}>🗑️</button></div></div>))}</div>)}
                  <div style={{ display: "flex", gap: 10 }}><input type="text" value={newBillName} placeholder='"MP Principal", "Brubank 2"...' onChange={e => setNewBillName(e.target.value)} onKeyDown={e => e.key === "Enter" && addBill()} style={{ ...S.input, flex: 1 }} /><button onClick={addBill} style={{ ...S.btn, padding: "11px 18px" }}>+</button></div>
                </div>
              </div>
            )}

            {settingsTab === "empleados" && (
              <div style={{ maxWidth: 640 }}>
                <div style={{ ...S.card, marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: "#9f67ff", fontWeight: 700, marginBottom: 12 }}>➕ Agregar empleado</div>
                  <div style={{ background: "#0d0a1a", border: `1px solid ${C.border}`, borderRadius: 11, padding: "12px 14px", marginBottom: 14, fontSize: 12, color: "#475569", lineHeight: 1.8 }}>
                    <div>📝 <strong style={{ color: "#9f67ff" }}>Paso 1:</strong> Completá nombre, usuario y contraseña.</div>
                    <div>⏰ <strong style={{ color: "#9f67ff" }}>Paso 2:</strong> Definí el horario general (ej: 08:00 a 19:30).</div>
                    <div>📅 <strong style={{ color: "#9f67ff" }}>Paso 3:</strong> Activá los días que trabaja.</div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                    {[{ label: "Nombre", key: "nombre", ph: "Juan Pérez" }, { label: "Usuario", key: "usuario", ph: "juanperez" }, { label: "Contraseña", key: "pass", ph: "••••••", type: "password" }].map(f => (<div key={f.key}><label style={S.label}>{f.label}</label><input type={f.type || "text"} value={newEmpForm[f.key]} placeholder={f.ph} onChange={e => setNewEmpForm({ ...newEmpForm, [f.key]: e.target.value })} style={S.input} /></div>))}
                    <div>
                      <label style={S.label}>Horario general</label>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input type="time" value={newEmpForm.horario_inicio || ""} onChange={e => setNewEmpForm({ ...newEmpForm, horario_inicio: e.target.value })} style={{ ...S.input, fontSize: 13 }} placeholder="Desde" />
                        <input type="time" value={newEmpForm.horario_fin || ""} onChange={e => setNewEmpForm({ ...newEmpForm, horario_fin: e.target.value })} style={{ ...S.input, fontSize: 13 }} placeholder="Hasta" />
                      </div>
                    </div>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={S.label}>Días que trabaja</label>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {DIAS.map(d => {
                        const on = (newEmpForm.dias || []).includes(d.id);
                        return (<button key={d.id} onClick={() => { const dias = newEmpForm.dias || []; setNewEmpForm({ ...newEmpForm, dias: dias.includes(d.id) ? dias.filter(x => x !== d.id) : [...dias, d.id] }); }} style={{ width: 52, padding: "7px 0", border: `1px solid ${on ? "#7c3aed" : C.border}`, borderRadius: 8, background: on ? "#2d1b69" : "#0a0a0f", color: on ? "#c084fc" : "#475569", cursor: "pointer", fontSize: 13, fontWeight: on ? 700 : 400, textAlign: "center" }}>{d.label}</button>);
                      })}
                    </div>
                  </div>
                  <button onClick={addEmp} style={S.btn}>Agregar empleado</button>
                </div>
                {empleados.length === 0 ? <div style={{ ...S.card, textAlign: "center", color: "#475569", fontSize: 13 }}>No hay empleados todavía.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {empleados.map(emp => (<div key={emp.id} style={{ ...S.card, borderColor: emp.activo ? C.border : "#1a1020" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: emp.activo ? "#4ade80" : "#4a4a5a" }} /><span style={{ color: emp.activo ? "#f1f5f9" : "#475569", fontSize: 14, fontWeight: 600 }}>{emp.nombre}</span></div>
                          <div style={{ fontSize: 11, color: "#475569", marginTop: 3, marginLeft: 16 }}>👤 {emp.usuario}{emp.horario_inicio ? ` · ⏰ ${emp.horario_inicio}${emp.horario_fin ? " – " + emp.horario_fin : ""}` : ""}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}><button onClick={() => toggleEmp(emp.id, emp.activo)} style={S.ghost}>{emp.activo ? "Desactivar" : "Activar"}</button><button onClick={() => delEmp(emp.id)} style={S.danger}>🗑️</button></div>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontWeight: 600 }}>Horario general</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <div style={{ flex: 1 }}><label style={S.label}>Desde</label><input type="time" value={emp.horario_inicio || ""} onChange={e => { db.updateEmpleado(emp.id, { horario_inicio: e.target.value }); setEmpleados(emps => emps.map(x => x.id === emp.id ? { ...x, horario_inicio: e.target.value } : x)); }} style={{ ...S.input, fontSize: 13 }} /></div>
                        <div style={{ flex: 1 }}><label style={S.label}>Hasta</label><input type="time" value={emp.horario_fin || ""} onChange={e => { db.updateEmpleado(emp.id, { horario_fin: e.target.value }); setEmpleados(emps => emps.map(x => x.id === emp.id ? { ...x, horario_fin: e.target.value } : x)); }} style={{ ...S.input, fontSize: 13 }} /></div>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontWeight: 600 }}>Días que trabaja</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {DIAS.map(d => {
                          const on = (emp.dias || []).includes(d.id);
                          return (<button key={d.id} onClick={() => updateEmpDia(emp.id, d.id)} style={{ width: 50, padding: "6px 0", border: `1px solid ${on ? "#7c3aed" : "#1a1530"}`, borderRadius: 7, background: on ? "#2d1b69" : "#0a0a0f", color: on ? "#c084fc" : "#4c3a70", cursor: "pointer", fontSize: 12, fontWeight: on ? 700 : 400, textAlign: "center" }}>{d.label}</button>);
                        })}
                      </div>
                    </div>))}
                  </div>
                )}
              </div>
            )}

            {settingsTab === "bajas" && (
              <div style={{ maxWidth: 560 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 600, marginBottom: 6 }}>📤 Destinos de Bajas</div>
                  <p style={{ color: "#7c6fa0", fontSize: 12, marginBottom: 16 }}>CBU o alias a donde se envía el dinero.</p>
                  {destinos.length > 0 && (<div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>{destinos.map(d => (<div key={d.id} style={{ background: "#0a0a0f", border: "1px solid #92400e", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}><div><div style={{ color: "#fbbf24", fontWeight: 700, fontSize: 14 }}>{d.alias}</div><div style={{ fontSize: 12, color: "#7c6fa0", marginTop: 3 }}>👤 {d.titular}</div><div style={{ fontSize: 12, color: "#a78bfa", fontFamily: "monospace", marginTop: 2 }}>{d.cbu}</div></div><button onClick={() => delDest(d.id)} style={S.danger}>🗑️</button></div>))}</div>)}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div><label style={S.label}>Nombre</label><input type="text" value={newDest.alias} placeholder="Cuenta principal" onChange={e => setNewDest({ ...newDest, alias: e.target.value })} style={S.input} /></div>
                    <div><label style={S.label}>Titular</label><input type="text" value={newDest.titular} placeholder="Nombre titular" onChange={e => setNewDest({ ...newDest, titular: e.target.value })} style={S.input} /></div>
                  </div>
                  <div style={{ marginBottom: 12 }}><label style={S.label}>CBU o Alias</label><input type="text" value={newDest.cbu} placeholder="CBU o alias de la cuenta" onChange={e => setNewDest({ ...newDest, cbu: e.target.value })} style={{ ...S.input, fontFamily: "monospace" }} /></div>
                  <button onClick={addDest} style={S.btn}>Agregar destino</button>
                </div>
              </div>
            )}

            {settingsTab === "negocio" && (
              <div style={{ maxWidth: 440 }}>
                <div style={S.card}>
                  <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600, marginBottom: 14 }}>🏷️ Nombre del negocio</div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input type="text" value={config.nombre || ""} onChange={e => setConfig({ ...config, nombre: e.target.value })} style={{ ...S.input, flex: 1 }} />
                    <button onClick={() => saveConfig({ nombre: config.nombre })} style={{ ...S.btn, padding: "11px 18px" }}>Guardar</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(() => {
    try {
      const saved = localStorage.getItem("casino_session");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  const handleLogin = (s) => {
    try { localStorage.setItem("casino_session", JSON.stringify(s)); } catch {}
    setSession(s);
  };

  const handleLogout = () => {
    try { localStorage.removeItem("casino_session"); } catch {}
    setSession(null);
  };

  if (!session) return <Login onLogin={handleLogin} />;
  if (session.role === "superadmin") return <SuperAdmin onLogout={handleLogout} />;
  if (session.role === "employee") return <EmployeeView session={session} onLogout={handleLogout} />;
  return <OwnerDashboard session={session} onLogout={handleLogout} />;
}
