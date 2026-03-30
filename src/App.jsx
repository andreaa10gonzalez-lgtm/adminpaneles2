import { useState, useEffect, useRef } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const SUPER_ADMIN = { user: "admin", pass: "admin2024" }; // change as needed

const TURNOS = [
  { id: "t1", label: "Turno 1", horario: "00:00 – 08:00" },
  { id: "t2", label: "Turno 2", horario: "08:00 – 16:00" },
  { id: "t3", label: "Turno 3", horario: "16:00 – 00:00" },
];

// Storage keys scoped per tenant
const K = (tenantId) => ({
  entries:   `${tenantId}_entries`,
  campaign:  `${tenantId}_campaign`,
  players:   `${tenantId}_players`,
  empleados: `${tenantId}_empleados`,
  cajas:     `${tenantId}_cajas`,
  config:    `${tenantId}_config`,
});

const TENANTS_KEY = "super_tenants"; // global list of tenants

// ─────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────
const parseMonto = (s) => parseFloat(String(s||"").replace(/\./g,"").replace(",",".").trim())||0;
const fmt = (v) => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(v||0);
const todayStr = () => new Date().toISOString().slice(0,10);
const monthLabel = (off=0) => { const d=new Date(); d.setMonth(d.getMonth()+off); return d.toLocaleString("es-AR",{month:"long",year:"numeric"}); };
const cmk = () => new Date().toISOString().slice(0,7);
const pmk = () => { const d=new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,7); };
const pct = (c,p) => !p ? (c>0?100:0) : (((c-p)/p)*100).toFixed(1);
const sumK = (arr,k) => arr.reduce((s,e)=>s+(e[k]||0),0);
const cajaKey = (date,tid) => `${date}__${tid}`;

const parseCSV = (text, existingPFS={}) => {
  const lines = text.trim().split("\n").slice(1);
  const events = [];
  lines.forEach(line => {
    const cols=[]; let cur="",inQ=false;
    for(let ch of line){ if(ch==='"'){inQ=!inQ;continue;} if(ch===","&&!inQ){cols.push(cur.trim());cur="";}else cur+=ch; }
    cols.push(cur.trim());
    if(cols.length<5) return;
    const date=cols[0].slice(0,10).replace(/\//g,"-");
    if(!date.match(/\d{4}-\d{2}-\d{2}/)) return;
    events.push({date,tipo:cols[1].trim().toLowerCase(),jugador:cols[3].trim(),monto:Math.abs(parseMonto(cols[4]))});
  });
  events.sort((a,b)=>a.date.localeCompare(b.date));
  const newPFS={...existingPFS};
  events.forEach(({jugador,date})=>{ if(jugador&&!newPFS[jugador]) newPFS[jugador]=date; });
  const dm={};
  events.forEach(({date,tipo,jugador,monto})=>{
    if(!dm[date]) dm[date]={date,cargas:0,retiros:0,mov:0,jug:new Set(),new:new Set()};
    if(tipo==="carga") dm[date].cargas+=monto;
    else if(tipo==="retiro") dm[date].retiros+=monto;
    dm[date].mov++; dm[date].jug.add(jugador);
    if(newPFS[jugador]===date&&!existingPFS[jugador]) dm[date].new.add(jugador);
  });
  return {
    dailyEntries: Object.values(dm).map(d=>({
      id:`csv-${d.date}-${Math.random()}`, date:d.date,
      cargas:Math.round(d.cargas), retiros:Math.round(d.retiros),
      notas:`${d.mov} mov · ${d.jug.size} jugadores`,
      jugadoresUnicos:d.jug.size, jugadoresNuevos:d.new.size,
      jugadoresNuevosLista:[...d.new],
    })).sort((a,b)=>a.date.localeCompare(b.date)),
    newPFS,
  };
};

// ─────────────────────────────────────────────
//  STORAGE HELPERS
// ─────────────────────────────────────────────
// Pure in-memory store — instant, never fails
// Also tries to persist to window.storage as background bonus
const _mem = {};
const sget = (key) => {
  // Try to load from storage once on first access
  if (!(key in _mem)) {
    try {
      const raw = localStorage.getItem("cp_" + key);
      if (raw) { _mem[key] = JSON.parse(raw); }
    } catch(_) {}
  }
  return Promise.resolve(_mem[key] ?? null);
};
const sset = (key, val) => {
  _mem[key] = val;
  try { localStorage.setItem("cp_" + key, JSON.stringify(val)); } catch(_) {}
  // fire-and-forget to window.storage, don't await
  try { window.storage?.set(key, JSON.stringify(val)); } catch(_) {}
  return Promise.resolve();
};

// ─────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────
const S = {
  page:  { minHeight:"100vh", background:"#0a0a0f", color:"#e2e8f0", fontFamily:"'DM Sans', sans-serif" },
  card:  { background:"linear-gradient(135deg,#13102a,#0f1729)", border:"1px solid #2a1f4a", borderRadius:16, padding:"20px 22px" },
  input: { width:"100%", background:"#13102a", border:"1px solid #2a1f4a", borderRadius:10, padding:"12px 14px", color:"#e2e8f0", fontSize:14, outline:"none", boxSizing:"border-box" },
  btn:   { background:"linear-gradient(135deg,#7c3aed,#4f46e5)", border:"none", color:"#fff", padding:"12px 22px", borderRadius:12, cursor:"pointer", fontSize:14, fontWeight:700 },
  label: { fontSize:11, color:"#7c6fa0", textTransform:"uppercase", letterSpacing:1, display:"block", marginBottom:6 },
  ghost: { background:"#13102a", border:"1px solid #2a1f4a", color:"#a78bfa", padding:"10px 16px", borderRadius:10, cursor:"pointer", fontSize:13, fontWeight:500 },
  danger:{ background:"#1e0a0a", border:"1px solid #7f1d1d", color:"#f87171", padding:"8px 12px", borderRadius:8, cursor:"pointer", fontSize:12 },
};

const Tab = ({active,onClick,children}) => (
  <button onClick={onClick} style={{padding:"9px 13px",border:"none",cursor:"pointer",fontSize:12,fontWeight:500,borderRadius:"8px 8px 0 0",whiteSpace:"nowrap",background:active?"#0a0a0f":"transparent",color:active?"#c084fc":"#7c6fa0",borderBottom:active?"2px solid #c084fc":"2px solid transparent"}}>
    {children}
  </button>
);

const SubTab = ({active,onClick,children}) => (
  <button onClick={onClick} style={{padding:"8px 16px",border:"none",cursor:"pointer",fontSize:13,fontWeight:500,borderRadius:8,background:active?"#7c3aed":"#13102a",color:active?"#fff":"#7c6fa0"}}>
    {children}
  </button>
);

const Trend = ({value,invert=false}) => {
  let n=+value; if(invert) n=-n;
  if(n>0) return <span style={{color:"#4ade80",fontSize:13}}>▲ {Math.abs(+value)}%</span>;
  if(n<0) return <span style={{color:"#f87171",fontSize:13}}>▼ {Math.abs(+value)}%</span>;
  return <span style={{color:"#94a3b8",fontSize:13}}>— 0%</span>;
};

// ─────────────────────────────────────────────
//  LOGIN SCREEN
// ─────────────────────────────────────────────
const Login = ({onLogin}) => {
  const [user,setUser]=useState("");
  const [pass,setPass]=useState("");
  const [err,setErr]=useState("");

  const submit = async () => {
    if(!user.trim()||!pass.trim()){ setErr("Completá usuario y contraseña"); return; }
    setErr("");
    try {
      if(user.trim()===SUPER_ADMIN.user&&pass.trim()===SUPER_ADMIN.pass){
        onLogin({role:"superadmin",id:"superadmin",nombre:"Admin"}); return;
      }
      let tenants=[];
      try { tenants=await sget(TENANTS_KEY)||[]; } catch(_){}
      const tenant=tenants.find(t=>t.user===user.trim()&&t.pass===pass.trim());
      if(tenant){ onLogin({role:"owner",id:tenant.id,nombre:tenant.nombre,tenantId:tenant.id}); return; }
      for(const t of tenants){
        let emps=[];
        try { emps=await sget(K(t.id).empleados)||[]; } catch(_){}
        const emp=emps.find(e=>e.user===user.trim()&&e.pass===pass.trim()&&e.activo);
        if(emp){ onLogin({role:"employee",id:emp.id,nombre:emp.nombre,tenantId:t.id,turno:emp.turno,dias:emp.dias||[],horarios:emp.horarios||{}}); return; }
      }
      setErr("Usuario o contraseña incorrectos");
    } catch(e){
      setErr("Error al conectar. Intentá de nuevo.");
    }
  };

  return (
    <div style={{...S.page,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:52,marginBottom:12}}>🎰</div>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:800,margin:0,background:"linear-gradient(90deg,#c084fc,#818cf8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Casino Panel</h1>
          <p style={{color:"#7c6fa0",fontSize:13,marginTop:8}}>Ingresá con tu usuario y contraseña</p>
        </div>
        <div style={{...S.card,padding:28}}>
          <div style={{marginBottom:16}}>
            <label style={S.label}>Usuario</label>
            <input type="text" value={user} onChange={e=>setUser(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={S.input} placeholder="tu_usuario" autoComplete="username"/>
          </div>
          <div style={{marginBottom:20}}>
            <label style={S.label}>Contraseña</label>
            <input type="password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={S.input} placeholder="••••••••" autoComplete="current-password"/>
          </div>
          {err && <div style={{color:"#f87171",fontSize:13,marginBottom:14,textAlign:"center"}}>{err}</div>}
          <button onClick={submit} style={{...S.btn,width:"100%",padding:14,fontSize:15}}>Ingresar →</button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
//  SUPER ADMIN PANEL
// ─────────────────────────────────────────────
const SuperAdmin = ({onLogout}) => {
  const [tenants,setTenants]=useState([]);
  const [form,setForm]=useState({nombre:"",user:"",pass:""});
  const [toast,setToast]=useState("");
  const [saving,setSaving]=useState(false);
  const showToast = m => { setToast(m); setTimeout(()=>setToast(""),2500); };

  useEffect(()=>{
    sget(TENANTS_KEY).then(d=>{ if(d) setTenants(d); });
  },[]);

  const save = async (data) => { await sset(TENANTS_KEY,data); setTenants([...data]); };

  const addTenant = async () => {
    const nombre=form.nombre.trim(), user=form.user.trim(), pass=form.pass.trim();
    if(!nombre||!user||!pass) return showToast("⚠️ Completá todos los campos");
    if(tenants.find(t=>t.user===user)) return showToast("⚠️ Ese usuario ya existe");
    setSaving(true);
    const t={id:`t_${Date.now()}`,nombre,user,pass,creado:new Date().toISOString()};
    await save([...tenants,t]);
    setForm({nombre:"",user:"",pass:""});
    setSaving(false);
    showToast(`✅ Panel "${nombre}" creado`);
  };

  const deleteTenant = async (id) => {
    await save(tenants.filter(t=>t.id!==id));
    showToast("🗑️ Panel eliminado");
  };

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      {toast&&<div style={{position:"fixed",top:20,right:20,background:"#1e1b3a",border:"1px solid #4c1d95",borderRadius:12,padding:"12px 20px",fontSize:14,zIndex:9999}}>{toast}</div>}
      <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",borderBottom:"1px solid #2a1f4a",padding:"20px 28px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>🛡️</span>
          <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,margin:0,color:"#c084fc"}}>Super Admin</h1>
        </div>
        <button onClick={onLogout} style={{...S.ghost,fontSize:12,padding:"7px 14px"}}>Cerrar sesión</button>
      </div>

      <div style={{padding:"24px 28px",maxWidth:700,margin:"0 auto"}}>
        <div style={{...S.card,marginBottom:24}}>
          <div style={{fontSize:13,color:"#a78bfa",fontWeight:600,marginBottom:16}}>➕ Crear nuevo panel</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
            {[{label:"Nombre del negocio",key:"nombre",ph:"Casino Estrella"},{label:"Usuario",key:"user",ph:"casino_estrella"},{label:"Contraseña",key:"pass",ph:"••••••••",type:"password"}].map(f=>(
              <div key={f.key}>
                <label style={S.label}>{f.label}</label>
                <input type={f.type||"text"} value={form[f.key]} placeholder={f.ph} onChange={e=>setForm({...form,[f.key]:e.target.value})} style={S.input}/>
              </div>
            ))}
          </div>
          <button onClick={addTenant} disabled={saving} style={{...S.btn,opacity:saving?0.7:1}}>{saving?"Guardando...":"Crear panel"}</button>
        </div>

        <div style={{fontSize:13,color:"#7c6fa0",marginBottom:12}}>{tenants.length} panel{tenants.length!==1?"es":""} registrado{tenants.length!==1?"s":""}</div>
        {tenants.length===0 ? (
          <div style={{...S.card,textAlign:"center",color:"#7c6fa0",fontSize:13}}>No hay paneles todavía.</div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {tenants.map(t=>(
              <div key={t.id} style={{...S.card,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#c084fc",fontSize:15}}>🎰 {t.nombre}</div>
                  <div style={{fontSize:12,color:"#7c6fa0",marginTop:4}}>
                    <span style={{marginRight:16}}>👤 Usuario: <strong style={{color:"#e2e8f0"}}>{t.user}</strong></span>
                    <span>🔑 Pass: <strong style={{color:"#e2e8f0"}}>{t.pass}</strong></span>
                  </div>
                  <div style={{fontSize:11,color:"#4c3a70",marginTop:2}}>Creado: {new Date(t.creado).toLocaleDateString("es-AR")}</div>
                </div>
                <button onClick={()=>deleteTenant(t.id)} style={S.danger}>🗑️ Eliminar</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
//  EMPLOYEE VIEW — solo cargar turno
// ─────────────────────────────────────────────

// Map JS getDay() (0=Sun) to our dia ids
const DIA_MAP = ["dom","lun","mar","mie","jue","vie","sab"];

// Given an employee session, figure out today's turno from their horarios map
const getTurnoHoy = (session) => {
  const diaHoy = DIA_MAP[new Date().getDay()]; // e.g. "jue"
  const horarios = session.horarios || {};
  // horarios[diaId] = turnoId (e.g. "t2")
  if (horarios[diaHoy]) return horarios[diaHoy];
  // fallback to general turno assigned
  return session.turno || "t1";
};

const EmployeeView = ({session,onLogout}) => {
  const tid = session.tenantId;
  const keys = K(tid);
  const [config,setConfig]=useState(null);
  const [cajas,setCajas]=useState({});
  const [entries,setEntries]=useState([]);
  const turnoHoy = getTurnoHoy(session);
  const [cajaForm,setCajaForm]=useState({date:todayStr(),turno:turnoHoy,inicio:{},cierre:{},bajas:[],bonos:[]});
  const [toast,setToast]=useState("");
  const showToast = m => { setToast(m); setTimeout(()=>setToast(""),2500); };

  // Check if employee works today
  const diaHoy = DIA_MAP[new Date().getDay()];
  const trabajaHoy = !session.dias || session.dias.includes(diaHoy);

  useEffect(()=>{
    sget(keys.config).then(d=>setConfig(d||{}));
    sget(keys.cajas).then(d=>setCajas(d||{}));
    sget(keys.entries).then(d=>setEntries(d||[]));
  },[]);

  // Auto-fill apertura
  useEffect(()=>{
    const idx=TURNOS.findIndex(t=>t.id===cajaForm.turno);
    let prevKey;
    if(idx===0){ const p=new Date(cajaForm.date+"T12:00:00"); p.setDate(p.getDate()-1); prevKey=cajaKey(p.toISOString().slice(0,10),"t3"); }
    else prevKey=cajaKey(cajaForm.date,TURNOS[idx-1].id);
    const prev=cajas[prevKey];
    setCajaForm(f=>({...f,inicio:prev?.cierre?{...prev.cierre}:{}}));
  },[cajaForm.date,cajaForm.turno,cajas]);

  const bills = config?.billeteras||[];
  const turno = TURNOS.find(t=>t.id===cajaForm.turno);

  const handleSave = async () => {
    const k=cajaKey(cajaForm.date,cajaForm.turno);
    const updated={...cajas,[k]:{...cajaForm,empleado:session.nombre,savedAt:new Date().toISOString()}};
    await sset(keys.cajas,updated); setCajas(updated);
    showToast("✅ Turno guardado");
  };

  const tI=bills.reduce((s,b)=>s+(+(cajaForm.inicio[b.id]||0)),0);
  const tC=bills.reduce((s,b)=>s+(+(cajaForm.cierre[b.id]||0)),0);
  const totalBajasEmp=(cajaForm.bajas||[]).reduce((s,b)=>s+(+b.monto||0),0);
  const totalBonosEmp=(cajaForm.bonos||[]).reduce((s,b)=>s+(+b.monto||0),0);
  const mov=tC-tI+totalBajasEmp-totalBonosEmp;
  const de=entries.find(e=>e.date===cajaForm.date);
  const pn=de?(de.cargas-de.retiros)/3:null;
  const dif=pn!==null?mov-pn:null;
  const alert=dif!==null&&Math.abs(dif)>100;

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      {toast&&<div style={{position:"fixed",top:20,right:20,background:"#1e1b3a",border:"1px solid #4c1d95",borderRadius:12,padding:"12px 20px",fontSize:14,zIndex:9999}}>{toast}</div>}

      <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",borderBottom:"1px solid #2a1f4a",padding:"16px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>🎰</span>
            <span style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,background:"linear-gradient(90deg,#c084fc,#818cf8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{config?.nombre||"Casino Panel"}</span>
          </div>
          <div style={{fontSize:12,color:"#7c6fa0",marginTop:2}}>👤 {session.nombre} · Carga de turno</div>
        </div>
        <button onClick={onLogout} style={{...S.ghost,fontSize:12,padding:"7px 14px"}}>Salir</button>
      </div>

      <div style={{padding:"24px",maxWidth:640,margin:"0 auto"}}>
        <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,marginBottom:16,color:"#c084fc"}}>💼 Cargar Turno</h2>

        {/* Franco warning */}
        {!trabajaHoy&&(
          <div style={{background:"linear-gradient(135deg,#1a0a00,#2d1500)",border:"1px solid #92400e",borderRadius:12,padding:"14px 18px",marginBottom:16,display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontSize:24}}>😴</span>
            <div>
              <div style={{color:"#fbbf24",fontWeight:700,fontSize:14}}>Hoy es tu franco</div>
              <div style={{color:"#a16207",fontSize:12,marginTop:2}}>Según tu horario, hoy no tenés turno asignado. Si necesitás cargar igual, podés hacerlo.</div>
            </div>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:16}}>
          <div>
            <label style={S.label}>Fecha</label>
            <input type="date" value={cajaForm.date} onChange={e=>setCajaForm({...cajaForm,date:e.target.value})} style={S.input}/>
          </div>
          <div>
            <label style={S.label}>Tu turno de hoy</label>
            <div style={{background:"#2d1b69",border:"1px solid #7c3aed",borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:700,color:"#c084fc",fontSize:14}}>{turno?.label}</span>
              <span style={{color:"#a78bfa",fontSize:13}}>{turno?.horario}</span>
            </div>
            <div style={{fontSize:11,color:"#4c3a70",marginTop:6}}>
              Detectado automáticamente según el día de hoy ({new Date().toLocaleDateString("es-AR",{weekday:"long"})})
            </div>
          </div>
        </div>

        {bills.length===0 ? (
          <div style={{...S.card,textAlign:"center",color:"#7c6fa0",fontSize:13,padding:32}}>
            <div style={{fontSize:32,marginBottom:10}}>💳</div>
            El dueño del panel todavía no configuró las billeteras.
          </div>
        ) : (
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              {[{label:"🟢 Apertura",key:"inicio",color:"#38bdf8",readOnly:true},{label:"🔴 Cierre",key:"cierre",color:"#f87171",readOnly:false}].map(col=>(
                <div key={col.key} style={S.card}>
                  <div style={{fontSize:12,color:col.color,fontWeight:600,marginBottom:12}}>{col.label}</div>
                  {bills.map(b=>{
                    const isAuto=col.readOnly&&!!cajaForm.inicio[b.id];
                    return (
                      <div key={b.id} style={{marginBottom:10}}>
                        <label style={{...S.label,display:"flex",justifyContent:"space-between"}}>
                          <span>{b.nombre}</span>
                          {isAuto&&<span style={{color:"#2d4a7c",fontSize:10,fontWeight:400,textTransform:"none"}}>← auto</span>}
                        </label>
                        <input type="number" value={cajaForm[col.key][b.id]||""} placeholder="0"
                          readOnly={isAuto}
                          onChange={e=>setCajaForm({...cajaForm,[col.key]:{...cajaForm[col.key],[b.id]:e.target.value}})}
                          style={{...S.input,background:isAuto?"#0a0a12":"#13102a",color:isAuto?"#4c6a9a":"#e2e8f0",borderColor:isAuto?"#1a1f3a":"#2a1f4a"}}/>
                      </div>
                    );
                  })}
                  <div style={{borderTop:"1px solid #2a1f4a",paddingTop:8,display:"flex",justifyContent:"space-between",fontSize:12}}>
                    <span style={{color:"#7c6fa0"}}>Total</span>
                    <span style={{fontWeight:700,color:col.color}}>{fmt(col.key==="inicio"?tI:tC)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── BAJAS EMPLEADO ── */}
            {(()=>{
              const destinos=config?.destinosBajas||[];
              const bajas=cajaForm.bajas||[];
              const addBaja=()=>setCajaForm(f=>({...f,bajas:[...(f.bajas||[]),{id:Date.now(),billeteraId:"",monto:"",destinoId:"",nota:""}]}));
              const updBaja=(id,k,v)=>setCajaForm(f=>({...f,bajas:(f.bajas||[]).map(b=>b.id===id?{...b,[k]:v}:b)}));
              const delBaja=(id)=>setCajaForm(f=>({...f,bajas:(f.bajas||[]).filter(b=>b.id!==id)}));
              return(
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div style={{fontSize:12,color:"#f59e0b",fontWeight:600}}>📤 Bajas del turno</div>
                    <button onClick={addBaja} style={{background:"#1c1200",border:"1px solid #92400e",color:"#fbbf24",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Agregar baja</button>
                  </div>
                  {bajas.length===0?(
                    <div style={{fontSize:12,color:"#4c3a70",fontStyle:"italic"}}>Sin bajas en este turno</div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {bajas.map(baja=>{
                        const dest=destinos.find(d=>d.id===baja.destinoId);
                        return(
                          <div key={baja.id} style={{background:"#0a0a0f",border:"1px solid #92400e",borderRadius:10,padding:"12px 14px"}}>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,marginBottom:8,alignItems:"end"}}>
                              <div>
                                <label style={S.label}>Billetera origen</label>
                                <select value={baja.billeteraId} onChange={e=>updBaja(baja.id,"billeteraId",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px",appearance:"none"}}>
                                  <option value="">— Billetera —</option>
                                  {bills.map(b=><option key={b.id} value={b.id}>{b.nombre}</option>)}
                                </select>
                              </div>
                              <div>
                                <label style={S.label}>Destino</label>
                                <select value={baja.destinoId} onChange={e=>updBaja(baja.id,"destinoId",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px",appearance:"none"}}>
                                  <option value="">— Destino —</option>
                                  {destinos.map(d=><option key={d.id} value={d.id}>{d.alias}</option>)}
                                </select>
                              </div>
                              <button onClick={()=>delBaja(baja.id)} style={{...S.danger,alignSelf:"flex-end"}}>🗑️</button>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                              <div>
                                <label style={S.label}>Monto ($)</label>
                                <input type="number" value={baja.monto} placeholder="0" onChange={e=>updBaja(baja.id,"monto",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                              </div>
                              <div>
                                <label style={S.label}>Nota (opcional)</label>
                                <input type="text" value={baja.nota||""} placeholder="Ej: envío nocturno" onChange={e=>updBaja(baja.id,"nota",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                              </div>
                            </div>
                            {dest&&(
                              <div style={{marginTop:8,fontSize:11,color:"#7c6fa0"}}>
                                🏦 {dest.titular} · <span style={{fontFamily:"monospace",color:"#a78bfa"}}>{dest.cbu}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 4px",fontSize:13}}>
                        <span style={{color:"#7c6fa0"}}>Total bajas</span>
                        <span style={{color:"#fbbf24",fontWeight:700}}>{fmt(totalBajasEmp)}</span>
                      </div>
                    </div>
                  )}
                  {destinos.length===0&&<div style={{marginTop:8,fontSize:11,color:"#4c3a70"}}>El dueño todavía no configuró destinos de bajas.</div>}
                </div>
              );
            })()}


            {/* ── BONOS EMPLEADO ── */}
            {(()=>{
              const bonos=cajaForm.bonos||[];
              const addBono=()=>setCajaForm(f=>({...f,bonos:[...(f.bonos||[]),{id:Date.now(),jugador:"",monto:"",nota:""}]}));
              const updBono=(id,k,v)=>setCajaForm(f=>({...f,bonos:(f.bonos||[]).map(b=>b.id===id?{...b,[k]:v}:b)}));
              const delBono=(id)=>setCajaForm(f=>({...f,bonos:(f.bonos||[]).filter(b=>b.id!==id)}));
              return(
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <div>
                      <div style={{fontSize:12,color:"#a78bfa",fontWeight:600}}>🎁 Bonos entregados</div>
                      <div style={{fontSize:11,color:"#4c3a70",marginTop:2}}>Fichas regaladas a jugadores en este turno</div>
                    </div>
                    <button onClick={addBono} style={{background:"#1a0533",border:"1px solid #7c3aed",color:"#c084fc",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Agregar bono</button>
                  </div>
                  {bonos.length===0?(
                    <div style={{fontSize:12,color:"#4c3a70",fontStyle:"italic"}}>Sin bonos en este turno</div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {bonos.map(bono=>(
                        <div key={bono.id} style={{background:"#0a0a0f",border:"1px solid #4c1d95",borderRadius:10,padding:"12px 14px"}}>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:10,marginBottom:8,alignItems:"end"}}>
                            <div>
                              <label style={S.label}>Jugador</label>
                              <input type="text" value={bono.jugador} placeholder="Usuario del jugador" onChange={e=>updBono(bono.id,"jugador",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                            </div>
                            <div>
                              <label style={S.label}>Monto del bono ($)</label>
                              <input type="number" value={bono.monto} placeholder="0" onChange={e=>updBono(bono.id,"monto",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                            </div>
                            <button onClick={()=>delBono(bono.id)} style={{...S.danger,alignSelf:"flex-end"}}>🗑️</button>
                          </div>
                          <div>
                            <label style={S.label}>Nota (opcional)</label>
                            <input type="text" value={bono.nota||""} placeholder="Ej: bono bienvenida, promo especial..." onChange={e=>updBono(bono.id,"nota",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                          </div>
                        </div>
                      ))}
                      <div style={{display:"flex",justifyContent:"space-between",padding:"6px 4px",fontSize:13}}>
                        <span style={{color:"#7c6fa0"}}>Total bonos</span>
                        <span style={{color:"#a78bfa",fontWeight:700}}>{fmt(totalBonosEmp)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {bills.some(b=>cajaForm.cierre[b.id])&&(
              <div style={{background:alert?"linear-gradient(135deg,#2d0a0a,#1a0a00)":"linear-gradient(135deg,#0a1f0a,#0a1200)",border:`1px solid ${alert?"#7f1d1d":"#14532d"}`,borderRadius:14,padding:"14px 18px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#7c6fa0",marginBottom:10}}>Resumen del turno</div>
                <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                  <div><div style={{fontSize:10,color:"#7c6fa0"}}>Mov. neto caja</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:tC-tI>=0?"#4ade80":"#f87171"}}>{fmt(tC-tI)}</div></div>
                  {totalBajasEmp>0&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Bajas</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#fbbf24"}}>+{fmt(totalBajasEmp)}</div></div>}
                  {totalBonosEmp>0&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Bonos</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#a78bfa"}}>-{fmt(totalBonosEmp)}</div></div>}
                  <div><div style={{fontSize:10,color:"#7c6fa0"}}>Real</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:mov>=0?"#4ade80":"#f87171"}}>{fmt(mov)}</div></div>
                  {pn!==null&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Esperado (⅓ neto)</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#a78bfa"}}>{fmt(pn)}</div></div>}
                  {dif!==null&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Diferencia</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:alert?"#f87171":"#4ade80"}}>{dif>0?"+":""}{fmt(dif)}</div></div>}
                </div>
                {alert&&<div style={{marginTop:8,fontSize:12,color:"#f87171"}}>⚠️ Diferencia significativa</div>}
              </div>
            )}

            <button onClick={handleSave} style={{...S.btn,width:"100%"}}>💾 Guardar cierre de turno</button>
          </>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────
//  OWNER DASHBOARD
// ─────────────────────────────────────────────
const OwnerDashboard = ({session,onLogout}) => {
  const tid = session.tenantId;
  const keys = K(tid);

  const [config,setConfig]=useState(null);
  const [entries,setEntries]=useState([]);
  const [pfs,setPfs]=useState({});
  const [campaign,setCampaign]=useState({sent:0,recovered:0,deposits:0});
  const [empleados,setEmpleados]=useState([]);
  const [cajas,setCajas]=useState({});

  const [activeTab,setActiveTab]=useState("resumen");
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({date:todayStr(),cargas:"",retiros:"",notas:""});
  const [campForm,setCampForm]=useState({sent:"",recovered:"",deposits:""});
  const [toast,setToast]=useState("");
  const [importing,setImporting]=useState(false);
  const [importPreview,setImportPreview]=useState(null);
  const [expandedDay,setExpandedDay]=useState(null);
  const [expandedCaja,setExpandedCaja]=useState(null);
  const [cajaTab,setCajaTab]=useState("cargar");
  const [cajaForm,setCajaForm]=useState({date:todayStr(),turno:"t1",empleado:"",inicio:{},cierre:{},bajas:[],bonos:[]});
  const [settingsTab,setSettingsTab]=useState("billeteras");
  const [newBillName,setNewBillName]=useState("");
  const [newEmpForm,setNewEmpForm]=useState({nombre:"",user:"",pass:"",turno:"t1",dias:["lun","mar","mie","jue","vie","sab","dom"],horarios:{}});
  const [newDest,setNewDest]=useState({alias:"",titular:"",cbu:""});
  const fileRef=useRef();

  const showToast = m => { setToast(m); setTimeout(()=>setToast(""),2800); };

  useEffect(()=>{
    const load = async () => {
      const cfg=await sget(keys.config); setConfig(cfg||{nombre:session.nombre,billeteras:[]});
      const e=await sget(keys.entries); if(e) setEntries(e);
      const p=await sget(keys.players); if(p) setPfs(p);
      const c=await sget(keys.campaign); if(c) setCampaign(c);
      const em=await sget(keys.empleados); if(em) setEmpleados(em);
      const ca=await sget(keys.cajas); if(ca) setCajas(ca);
    };
    load();
  },[]);

  // Auto-fill apertura
  useEffect(()=>{
    if(!cajaForm.empleado) return;
    const idx=TURNOS.findIndex(t=>t.id===cajaForm.turno);
    let prevKey;
    if(idx===0){ const p=new Date(cajaForm.date+"T12:00:00"); p.setDate(p.getDate()-1); prevKey=cajaKey(p.toISOString().slice(0,10),"t3"); }
    else prevKey=cajaKey(cajaForm.date,TURNOS[idx-1].id);
    const prev=cajas[prevKey];
    setCajaForm(f=>({...f,inicio:prev?.cierre?{...prev.cierre}:{}}));
  },[cajaForm.date,cajaForm.turno,cajaForm.empleado,cajas]);

  const saveConfig  = async d => { await sset(keys.config,d);   setConfig(d); };
  const saveEntries = async d => { await sset(keys.entries,d);  setEntries(d); };
  const savePfs     = async d => { await sset(keys.players,d);  setPfs(d); };
  const saveCampaign= async d => { await sset(keys.campaign,d); setCampaign(d); };
  const saveEmpleados=async d => { await sset(keys.empleados,d);setEmpleados(d); };
  const saveCajas   = async d => { await sset(keys.cajas,d);    setCajas(d); };

  // Config
  const bills = config?.billeteras||[];
  const addBill = async () => {
    if(!newBillName.trim()) return;
    const b={id:Date.now(),nombre:newBillName.trim()};
    await saveConfig({...config,billeteras:[...bills,b]});
    setNewBillName(""); showToast(`✅ "${b.nombre}" agregada`);
  };
  const delBill = async id => { await saveConfig({...config,billeteras:bills.filter(b=>b.id!==id)}); };
  const moveBill = async (id,dir) => {
    const bs=[...bills]; const i=bs.findIndex(b=>b.id===id);
    if(i<0||i+dir<0||i+dir>=bs.length) return;
    [bs[i],bs[i+dir]]=[bs[i+dir],bs[i]];
    await saveConfig({...config,billeteras:bs});
  };

  // Empleados
  const addEmp = async () => {
    if(!newEmpForm.nombre||!newEmpForm.user||!newEmpForm.pass) return showToast("⚠️ Completá nombre, usuario y contraseña");
    // check unique user across all tenants
    const tenants=await sget(TENANTS_KEY)||[];
    for(const t of tenants){
      if(t.user===newEmpForm.user) return showToast("⚠️ Ese usuario ya está en uso");
      const emps=await sget(K(t.id).empleados)||[];
      if(emps.find(e=>e.user===newEmpForm.user)) return showToast("⚠️ Ese usuario ya está en uso");
    }
    const emp={id:Date.now(),...newEmpForm,activo:true};
    await saveEmpleados([...empleados,emp]);
    setNewEmpForm({nombre:"",user:"",pass:"",turno:"t1",dias:["lun","mar","mie","jue","vie","sab","dom"],horarios:{}});
    showToast(`✅ ${newEmpForm.nombre} agregado`);
  };
  const toggleEmp = async id => saveEmpleados(empleados.map(e=>e.id===id?{...e,activo:!e.activo}:e));
  const delEmp    = async id => saveEmpleados(empleados.filter(e=>e.id!==id));

  // Caja
  const saveCaja = async () => {
    if(!cajaForm.empleado) return showToast("⚠️ Seleccioná un empleado");
    const k=cajaKey(cajaForm.date,cajaForm.turno);
    await saveCajas({...cajas,[k]:{...cajaForm,savedAt:new Date().toISOString()}});
    showToast("✅ Caja guardada"); setCajaTab("historial");
  };

  // Entries
  const addEntry = async () => {
    if(!form.cargas&&!form.retiros) return;
    let upd;
    if(editId){ upd=entries.map(e=>e.id===editId?{...e,...form,cargas:+form.cargas||0,retiros:+form.retiros||0}:e); setEditId(null); }
    else upd=[...entries,{id:Date.now(),date:form.date,cargas:+form.cargas||0,retiros:+form.retiros||0,notas:form.notas}].sort((a,b)=>a.date.localeCompare(b.date));
    await saveEntries(upd); setForm({date:todayStr(),cargas:"",retiros:"",notas:""}); showToast("✅ Guardado");
  };
  const delEntry = async id => { await saveEntries(entries.filter(e=>e.id!==id)); showToast("🗑️ Eliminado"); };
  const editEntry = e => { setForm({date:e.date,cargas:e.cargas,retiros:e.retiros,notas:e.notas||""}); setEditId(e.id); setActiveTab("cargar"); };

  // Campaign
  const saveCamp = async () => {
    const d={sent:+campForm.sent||campaign.sent,recovered:+campForm.recovered||campaign.recovered,deposits:+campForm.deposits||campaign.deposits};
    await saveCampaign(d); setCampForm({sent:"",recovered:"",deposits:""}); showToast("✅ Actualizado");
  };

  // Bajas destinos
  const addDest = async () => {
    if(!newDest.alias||!newDest.cbu||!newDest.titular) return showToast("⚠️ Completá alias, titular y CBU");
    const d={id:Date.now(),...newDest};
    await saveConfig({...config,destinosBajas:[...(config?.destinosBajas||[]),d]});
    setNewDest({alias:"",titular:"",cbu:""});
    showToast(`✅ "${d.alias}" agregado`);
  };
  const delDest = async (id) => {
    await saveConfig({...config,destinosBajas:(config?.destinosBajas||[]).filter(d=>d.id!==id)});
    showToast("🗑️ Eliminado");
  };

  // CSV
  const handleFile = e => {
    const file=e.target.files[0]; if(!file) return;
    setImporting(true);
    const reader=new FileReader();
    reader.onload=ev=>{
      try { const {dailyEntries,newPFS}=parseCSV(ev.target.result,pfs); setImportPreview({file:file.name,data:dailyEntries,newPFS,totalNew:dailyEntries.reduce((s,d)=>s+(d.jugadoresNuevos||0),0)}); }
      catch(_){ showToast("❌ Error al leer el archivo"); }
      setImporting(false);
    };
    reader.readAsText(file,"utf-8"); e.target.value="";
  };
  const confirmImport = async mode => {
    if(!importPreview) return;
    let upd;
    if(mode==="replace"){ const ds=new Set(importPreview.data.map(d=>d.date)); upd=[...entries.filter(e=>!ds.has(e.date)),...importPreview.data].sort((a,b)=>a.date.localeCompare(b.date)); }
    else { const m=[...entries]; importPreview.data.forEach(ce=>{ const ex=m.find(e=>e.date===ce.date); if(ex){ex.cargas+=ce.cargas;ex.retiros+=ce.retiros;}else m.push(ce); }); upd=m.sort((a,b)=>a.date.localeCompare(b.date)); }
    await saveEntries(upd); await savePfs(importPreview.newPFS);
    setImportPreview(null); showToast(`✅ ${importPreview.data.length} días importados`); setActiveTab("resumen");
  };

  // Derived
  const cmEntries=entries.filter(e=>e.date.startsWith(cmk()));
  const pmEntries=entries.filter(e=>e.date.startsWith(pmk()));
  const [cmC,cmR,pmC,pmR]=[sumK(cmEntries,"cargas"),sumK(cmEntries,"retiros"),sumK(pmEntries,"cargas"),sumK(pmEntries,"retiros")];
  const [cmN,pmN]=[cmC-cmR,pmC-pmR];
  const cmNuevos=sumK(cmEntries,"jugadoresNuevos"),pmNuevos=sumK(pmEntries,"jugadoresNuevos");
  const cmUnicos=sumK(cmEntries,"jugadoresUnicos"),pmUnicos=sumK(pmEntries,"jugadoresUnicos");
  const totalPlayers=Object.keys(pfs).length;
  const recoveryRate=campaign.sent>0?((campaign.recovered/campaign.sent)*100).toFixed(1):0;
  const chartData=cmEntries.map(e=>({dia:e.date.slice(8),Cargas:e.cargas,Retiros:e.retiros,Neto:e.cargas-e.retiros}));
  const compareData=[{name:"Cargas",Anterior:pmC,Actual:cmC},{name:"Retiros",Anterior:pmR,Actual:cmR},{name:"Neto",Anterior:pmN,Actual:cmN}];
  const playerCompData=[{name:"Nuevos",Anterior:pmNuevos,Actual:cmNuevos},{name:"Activos",Anterior:pmUnicos,Actual:cmUnicos}];

  const cajaHistorial=Object.entries(cajas).map(([k,c])=>{
    const [date,turnoId]=k.split("__");
    const turno=TURNOS.find(t=>t.id===turnoId);
    const de=entries.find(e=>e.date===date);
    const pn=de?(de.cargas-de.retiros)/3:0;
    const tI=bills.reduce((s,b)=>s+(+(c.inicio?.[b.id]||0)),0);
    const tC2=bills.reduce((s,b)=>s+(+(c.cierre?.[b.id]||0)),0);
    const totalBajas=(c.bajas||[]).reduce((s,b)=>s+(+b.monto||0),0);
    const totalBonos=(c.bonos||[]).reduce((s,b)=>s+(+b.monto||0),0);
    const mov=tC2-tI+totalBajas-totalBonos; const dif=mov-pn;
    return {key:k,date,turno,caja:c,tI,tC:tC2,mov,pn,dif};
  }).sort((a,b)=>b.date.localeCompare(a.date)||(b.turno?.id||"").localeCompare(a.turno?.id||""));
  const alertas=cajaHistorial.filter(c=>Math.abs(c.dif)>100);

  // All bajas across all turns
  const todasBajas = cajaHistorial.flatMap(c =>
    (c.caja.bajas||[]).map(b => ({
      ...b,
      date: c.date,
      turno: c.turno,
      empleado: c.caja.empleado,
    }))
  ).sort((a,b) => b.date.localeCompare(a.date));

  const totalBajasGeneral = todasBajas.reduce((s,b) => s + (+b.monto||0), 0);

  // All bonos across all turns
  const todosBonos = cajaHistorial.flatMap(c =>
    (c.caja.bonos||[]).map(b => ({
      ...b,
      date: c.date,
      turno: c.turno,
      empleado: c.caja.empleado,
    }))
  ).sort((a,b) => b.date.localeCompare(a.date));
  const totalBonosGeneral = todosBonos.reduce((s,b) => s + (+b.monto||0), 0);
  // Group bonos by employee
  const bonosPorEmpleado = empleados.map(emp => ({
    ...emp,
    bonos: todosBonos.filter(b => b.empleado === emp.nombre),
    total: todosBonos.filter(b => b.empleado === emp.nombre).reduce((s,b)=>s+(+b.monto||0),0),
  })).filter(e => e.total > 0);
  // Group bonos by day
  const bonosPorDia = [...new Set(todosBonos.map(b=>b.date))].map(date => ({
    date,
    bonos: todosBonos.filter(b=>b.date===date),
    total: todosBonos.filter(b=>b.date===date).reduce((s,b)=>s+(+b.monto||0),0),
  }));
  // Group by destino
  const bajasPorDestino = (config?.destinosBajas||[]).map(dest => ({
    ...dest,
    total: todasBajas.filter(b=>b.destinoId===dest.id).reduce((s,b)=>s+(+b.monto||0),0),
    movimientos: todasBajas.filter(b=>b.destinoId===dest.id),
  }));
  // Group by billetera
  const bajasPorBilletera = bills.map(bill => ({
    ...bill,
    total: todasBajas.filter(b=>b.billeteraId===bill.id).reduce((s,b)=>s+(+b.monto||0),0),
  }));

  if(!config) return <div style={{...S.page,display:"flex",alignItems:"center",justifyContent:"center",color:"#7c6fa0"}}><div style={{textAlign:"center"}}><div style={{fontSize:36,marginBottom:8}}>🎰</div>Cargando...</div></div>;

  const tabs=[
    {id:"resumen",label:"📊 Resumen"},
    {id:"caja",label:"💼 Caja"},
    {id:"jugadores",label:"👥 Jugadores"},
    {id:"importar",label:"📂 Importar CSV"},
    {id:"cargar",label:editId?"✏️ Editar":"➕ Panel"},
    {id:"historial",label:"📋 Historial"},
    {id:"campana",label:"📣 Campaña"},
    {id:"bajas",label:"📤 Bajas"},
    {id:"bonos",label:"🎁 Bonos"},
    {id:"ajustes",label:"⚙️ Ajustes"},
  ];

  return (
    <div style={S.page}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Syne:wght@700;800&display=swap" rel="stylesheet"/>
      {toast&&<div style={{position:"fixed",top:20,right:20,background:"#1e1b3a",border:"1px solid #4c1d95",borderRadius:12,padding:"12px 20px",fontSize:14,zIndex:9999,maxWidth:320}}>{toast}</div>}

      {/* Header */}
      <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",borderBottom:"1px solid #2a1f4a",padding:"16px 24px 0"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:22}}>🎰</span>
              <h1 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,margin:0,background:"linear-gradient(90deg,#c084fc,#818cf8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{config.nombre||session.nombre}</h1>
            </div>
            <p style={{margin:"2px 0 0 30px",fontSize:11,color:"#7c6fa0"}}>Seguimiento operativo · {totalPlayers} jugadores</p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{textAlign:"right",fontSize:11,color:"#4c3a70"}}>
              <div style={{color:"#c084fc",fontWeight:600,textTransform:"capitalize"}}>{monthLabel()}</div>
              <div>👤 {session.nombre}</div>
            </div>
            <button onClick={onLogout} style={{...S.ghost,fontSize:12,padding:"7px 12px"}}>Salir</button>
          </div>
        </div>
        <div style={{display:"flex",gap:2,overflowX:"auto"}}>
          {tabs.map(t=><Tab key={t.id} active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}>{t.label}</Tab>)}
        </div>
      </div>

      <div style={{padding:"20px 24px",maxWidth:960,margin:"0 auto"}}>

        {/* RESUMEN */}
        {activeTab==="resumen"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:14}}>
              {[{label:"Cargas",value:fmt(cmC),trend:pct(cmC,pmC),icon:"💰",color:"#4ade80"},{label:"Retiros",value:fmt(cmR),trend:pct(cmR,pmR),icon:"💸",color:"#f87171",inv:true},{label:"Neto",value:fmt(cmN),trend:pct(cmN,pmN),icon:"📊",color:cmN>=0?"#4ade80":"#f87171"}].map(k=>(
                <div key={k.label} style={S.card}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>{k.label} del Mes</div><span style={{fontSize:20}}>{k.icon}</span></div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:k.color,margin:"8px 0 4px"}}>{k.value}</div>
                  <div style={{fontSize:11,color:"#7c6fa0"}}>vs mes ant.: <Trend value={k.trend} invert={k.inv}/></div>
                </div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
              {[{label:"Jugadores Nuevos",value:cmNuevos,trend:pct(cmNuevos,pmNuevos),icon:"🆕",color:"#fbbf24"},{label:"Jugadores Activos",value:cmUnicos,trend:pct(cmUnicos,pmUnicos),icon:"🎮",color:"#38bdf8"},{label:"Alertas de Caja",value:alertas.length,icon:"⚠️",color:alertas.length>0?"#f87171":"#4ade80",sub:alertas.length>0?"diferencias detectadas":"sin diferencias",click:()=>setActiveTab("caja")}].map(k=>(
                <div key={k.label} style={{...S.card,cursor:k.click?"pointer":"default"}} onClick={k.click}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>{k.label}</div><span style={{fontSize:20}}>{k.icon}</span></div>
                  <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:k.color,margin:"8px 0 4px"}}>{k.value}</div>
                  <div style={{fontSize:11,color:"#7c6fa0"}}>{k.trend!==undefined?<><Trend value={k.trend}/> vs mes ant.</>:k.sub}</div>
                </div>
              ))}
            </div>

            {(()=>{
              const t=entries.find(e=>e.date===todayStr());
              return(
                <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",border:"1px solid #4c1d95",borderRadius:16,padding:"14px 20px",marginBottom:20}}>
                  <div style={{fontSize:11,color:"#a78bfa",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>📅 Hoy — {new Date().toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"})}</div>
                  {t?(
                    <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
                      {[{label:"Cargas",v:t.cargas,c:"#4ade80"},{label:"Retiros",v:t.retiros,c:"#f87171"},{label:"Neto",v:t.cargas-t.retiros,c:t.cargas-t.retiros>=0?"#4ade80":"#f87171"}].map(x=>(
                        <div key={x.label}><div style={{fontSize:10,color:"#7c6fa0"}}>{x.label}</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,color:x.c,fontWeight:800}}>{fmt(x.v)}</div></div>
                      ))}
                      {t.jugadoresNuevos>0&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Nuevos hoy</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,color:"#fbbf24",fontWeight:800}}>🆕 {t.jugadoresNuevos}</div></div>}
                    </div>
                  ):(
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                      <span style={{color:"#7c6fa0",fontSize:13}}>No hay datos para hoy</span>
                      <button onClick={()=>setActiveTab("importar")} style={{background:"#7c3aed",border:"none",color:"#fff",padding:"7px 14px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>📂 Importar</button>
                    </div>
                  )}
                </div>
              );
            })()}

            {chartData.length>0?(
              <>
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{fontSize:12,color:"#a78bfa",marginBottom:12,fontWeight:600,textTransform:"capitalize"}}>Evolución — {monthLabel()}</div>
                  <ResponsiveContainer width="100%" height={175}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2a1f4a"/>
                      <XAxis dataKey="dia" tick={{fill:"#7c6fa0",fontSize:10}}/>
                      <YAxis tick={{fill:"#7c6fa0",fontSize:10}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                      <Tooltip contentStyle={{background:"#1e1b3a",border:"1px solid #4c1d95",borderRadius:8}} formatter={v=>fmt(v)}/>
                      <Legend wrapperStyle={{fontSize:11}}/>
                      <Line type="monotone" dataKey="Cargas" stroke="#4ade80" strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="Retiros" stroke="#f87171" strokeWidth={2} dot={false}/>
                      <Line type="monotone" dataKey="Neto" stroke="#c084fc" strokeWidth={2} dot={false} strokeDasharray="5 3"/>
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                  {[[compareData,"Comparativa financiera","#a78bfa",v=>fmt(v)],[playerCompData,"Comparativa jugadores","#fbbf24",v=>v]].map(([data,label,color,fmtFn])=>(
                    <div key={label} style={S.card}>
                      <div style={{fontSize:12,color,marginBottom:12,fontWeight:600}}>{label}</div>
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#2a1f4a"/>
                          <XAxis dataKey="name" tick={{fill:"#7c6fa0",fontSize:10}}/>
                          <YAxis tick={{fill:"#7c6fa0",fontSize:10}} tickFormatter={color==="#a78bfa"?v=>`$${(v/1000).toFixed(0)}k`:undefined}/>
                          <Tooltip contentStyle={{background:"#1e1b3a",border:"1px solid #4c1d95",borderRadius:8}} formatter={fmtFn}/>
                          <Legend wrapperStyle={{fontSize:11}}/>
                          <Bar dataKey="Anterior" fill="#4c1d95" radius={[4,4,0,0]}/>
                          <Bar dataKey="Actual" fill="#7c3aed" radius={[4,4,0,0]}/>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              </>
            ):(
              <div style={{textAlign:"center",padding:"50px 0",color:"#7c6fa0"}}>
                <div style={{fontSize:44,marginBottom:12}}>🎲</div>
                <div style={{fontSize:14,marginBottom:6}}>No hay datos aún</div>
                <div style={{fontSize:12}}>Importá tus CSVs desde <strong style={{color:"#c084fc"}}>📂 Importar CSV</strong></div>
              </div>
            )}
          </div>
        )}

        {/* CAJA */}
        {activeTab==="caja"&&(
          <div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
              <div>
                <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,margin:0,color:"#c084fc"}}>💼 Control de Caja</h2>
                <p style={{color:"#7c6fa0",fontSize:12,margin:"4px 0 0"}}>Billeteras: {bills.map(b=>b.nombre).join(", ")||"Sin configurar"}</p>
              </div>
              <div style={{display:"flex",gap:8}}>
                <SubTab active={cajaTab==="cargar"} onClick={()=>setCajaTab("cargar")}>Cargar turno</SubTab>
                <SubTab active={cajaTab==="historial"} onClick={()=>setCajaTab("historial")}>Historial</SubTab>
              </div>
            </div>

            {bills.length===0&&<div style={{...S.card,textAlign:"center",color:"#7c6fa0",fontSize:13,padding:28,marginBottom:16}}><div style={{fontSize:28,marginBottom:8}}>💳</div>No hay billeteras. <button onClick={()=>{setActiveTab("ajustes");setSettingsTab("billeteras");}} style={{background:"none",border:"none",color:"#c084fc",cursor:"pointer",fontSize:13}}>Configurá en Ajustes →</button></div>}

            {alertas.length>0&&(
              <div style={{background:"linear-gradient(135deg,#2d0a0a,#1a0a00)",border:"1px solid #7f1d1d",borderRadius:14,padding:"14px 18px",marginBottom:20}}>
                <div style={{fontSize:12,color:"#f87171",fontWeight:700,marginBottom:10}}>⚠️ {alertas.length} diferencia{alertas.length>1?"s":""} detectada{alertas.length>1?"s":""}</div>
                {alertas.map(c=>(
                  <div key={c.key} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #2d0a0a",fontSize:12}}>
                    <span><span style={{color:"#fca5a5"}}>{new Date(c.date+"T12:00:00").toLocaleDateString("es-AR",{day:"numeric",month:"short"})}</span><span style={{color:"#7c6fa0",marginLeft:8}}>{c.turno?.label} · {c.caja.empleado}</span></span>
                    <span style={{color:c.dif<0?"#f87171":"#fbbf24",fontWeight:700}}>{c.dif<0?"Falta ":"Sobra "}{fmt(Math.abs(c.dif))}</span>
                  </div>
                ))}
              </div>
            )}

            {cajaTab==="cargar"&&bills.length>0&&(
              <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:20}}>
                <div style={S.card}>
                  <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:14}}>Datos del turno</div>
                  <div style={{marginBottom:12}}><label style={S.label}>Fecha</label><input type="date" value={cajaForm.date} onChange={e=>setCajaForm({...cajaForm,date:e.target.value})} style={S.input}/></div>
                  <div style={{marginBottom:12}}>
                    <label style={S.label}>Turno</label>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {TURNOS.map(t=>(
                        <button key={t.id} onClick={()=>setCajaForm({...cajaForm,turno:t.id})} style={{padding:"8px 12px",border:`1px solid ${cajaForm.turno===t.id?"#7c3aed":"#2a1f4a"}`,borderRadius:10,background:cajaForm.turno===t.id?"#2d1b69":"#0a0a0f",color:cajaForm.turno===t.id?"#c084fc":"#7c6fa0",cursor:"pointer",fontSize:12,textAlign:"left",display:"flex",justifyContent:"space-between"}}>
                          <span style={{fontWeight:600}}>{t.label}</span><span>{t.horario}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div><label style={S.label}>Empleado</label>
                    {empleados.filter(e=>e.activo).length>0?(
                      <select value={cajaForm.empleado} onChange={e=>setCajaForm({...cajaForm,empleado:e.target.value,inicio:{},cierre:{}})} style={{...S.input,appearance:"none"}}>
                        <option value="">— Seleccioná —</option>
                        {empleados.filter(e=>e.activo).map(e=><option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                      </select>
                    ):(
                      <button onClick={()=>{setActiveTab("ajustes");setSettingsTab("empleados");}} style={{width:"100%",background:"#13102a",border:"1px dashed #4c1d95",color:"#a78bfa",padding:"10px",borderRadius:10,cursor:"pointer",fontSize:12}}>+ Agregar empleados en Ajustes</button>
                    )}
                  </div>
                </div>

                <div style={{display:"flex",flexDirection:"column",gap:14}}>
                  {[{label:"🟢 Apertura",fk:"inicio",color:"#38bdf8",ro:true},{label:"🔴 Cierre",fk:"cierre",color:"#f87171",ro:false}].map(col=>{
                    const total=bills.reduce((s,b)=>s+(+(cajaForm[col.fk][b.id]||0)),0);
                    return(
                      <div key={col.fk} style={S.card}>
                        <div style={{fontSize:12,color:col.color,fontWeight:600,marginBottom:12}}>{col.label}</div>
                        <div style={{display:"grid",gridTemplateColumns:bills.length>3?"1fr 1fr":"1fr",gap:"0 16px"}}>
                          {bills.map(b=>{
                            const isAuto=col.ro&&!!cajaForm.inicio[b.id];
                            return(
                              <div key={b.id} style={{marginBottom:10}}>
                                <label style={{...S.label,display:"flex",justifyContent:"space-between"}}>
                                  <span>{b.nombre}</span>
                                  {isAuto&&<span style={{color:"#2d4a7c",fontSize:10,fontWeight:400,textTransform:"none"}}>← auto</span>}
                                </label>
                                <input type="number" value={cajaForm[col.fk][b.id]||""} placeholder="0" readOnly={isAuto}
                                  onChange={e=>setCajaForm({...cajaForm,[col.fk]:{...cajaForm[col.fk],[b.id]:e.target.value}})}
                                  style={{...S.input,background:isAuto?"#0a0a12":"#13102a",color:isAuto?"#4c6a9a":"#e2e8f0",borderColor:isAuto?"#1a1f3a":"#2a1f4a"}}/>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{borderTop:"1px solid #2a1f4a",paddingTop:8,display:"flex",justifyContent:"space-between",fontSize:12}}>
                          <span style={{color:"#7c6fa0"}}>Total</span><span style={{fontWeight:700,color:col.color}}>{fmt(total)}</span>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── BAJAS ── */}
                  {(()=>{
                    const destinos=config?.destinosBajas||[];
                    const bajas=cajaForm.bajas||[];
                    const addBaja=()=>setCajaForm(f=>({...f,bajas:[...f.bajas,{id:Date.now(),billeteraId:"",monto:"",destinoId:"",nota:""}]}));
                    const updBaja=(id,k,v)=>setCajaForm(f=>({...f,bajas:f.bajas.map(b=>b.id===id?{...b,[k]:v}:b)}));
                    const delBaja=(id)=>setCajaForm(f=>({...f,bajas:f.bajas.filter(b=>b.id!==id)}));
                    const totalBajas=bajas.reduce((s,b)=>s+(+b.monto||0),0);
                    return(
                      <div style={S.card}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div style={{fontSize:12,color:"#f59e0b",fontWeight:600}}>📤 Bajas del turno</div>
                          <button onClick={addBaja} style={{background:"#1c1200",border:"1px solid #92400e",color:"#fbbf24",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Agregar baja</button>
                        </div>
                        {bajas.length===0?(
                          <div style={{fontSize:12,color:"#4c3a70",fontStyle:"italic"}}>Sin bajas en este turno</div>
                        ):(
                          <div style={{display:"flex",flexDirection:"column",gap:10}}>
                            {bajas.map(baja=>{
                              const dest=destinos.find(d=>d.id===baja.destinoId);
                              return(
                                <div key={baja.id} style={{background:"#0a0a0f",border:"1px solid #92400e",borderRadius:10,padding:"12px 14px"}}>
                                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
                                    <div>
                                      <label style={S.label}>Billetera origen</label>
                                      <select value={baja.billeteraId} onChange={e=>updBaja(baja.id,"billeteraId",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px",appearance:"none"}}>
                                        <option value="">— Billetera —</option>
                                        {bills.map(b=><option key={b.id} value={b.id}>{b.nombre}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label style={S.label}>Destino</label>
                                      <select value={baja.destinoId} onChange={e=>updBaja(baja.id,"destinoId",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px",appearance:"none"}}>
                                        <option value="">— Destino —</option>
                                        {destinos.map(d=><option key={d.id} value={d.id}>{d.alias}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label style={S.label}>Monto ($)</label>
                                      <input type="number" value={baja.monto} placeholder="0" onChange={e=>updBaja(baja.id,"monto",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/>
                                    </div>
                                    <button onClick={()=>delBaja(baja.id)} style={{...S.danger,alignSelf:"flex-end",marginBottom:0}}>🗑️</button>
                                  </div>
                                  {dest&&(
                                    <div style={{marginTop:8,fontSize:11,color:"#7c6fa0"}}>
                                      🏦 {dest.titular} · CBU: <span style={{fontFamily:"monospace",color:"#a78bfa"}}>{dest.cbu}</span>
                                    </div>
                                  )}
                                  <div style={{marginTop:6}}>
                                    <input type="text" value={baja.nota||""} placeholder="Nota opcional..." onChange={e=>updBaja(baja.id,"nota",e.target.value)} style={{...S.input,fontSize:11,padding:"6px 10px",color:"#7c6fa0"}}/>
                                  </div>
                                </div>
                              );
                            })}
                            <div style={{display:"flex",justifyContent:"space-between",padding:"8px 4px",fontSize:13}}>
                              <span style={{color:"#7c6fa0"}}>Total bajas</span>
                              <span style={{color:"#fbbf24",fontWeight:700}}>{fmt(totalBajas)}</span>
                            </div>
                          </div>
                        )}
                        {destinos.length===0&&<div style={{marginTop:8,fontSize:11,color:"#4c3a70"}}>⚙️ Configurá destinos de bajas en Ajustes → Bajas</div>}
                      </div>
                    );
                  })()}

                  {/* BONOS OWNER */}
                  {(()=>{
                    const bonos=cajaForm.bonos||[];
                    const addBono=()=>setCajaForm(f=>({...f,bonos:[...(f.bonos||[]),{id:Date.now(),jugador:"",monto:"",nota:""}]}));
                    const updBono=(id,k,v)=>setCajaForm(f=>({...f,bonos:(f.bonos||[]).map(b=>b.id===id?{...b,[k]:v}:b)}));
                    const delBono=(id)=>setCajaForm(f=>({...f,bonos:(f.bonos||[]).filter(b=>b.id!==id)}));
                    const totalBonosOwner=bonos.reduce((s,b)=>s+(+b.monto||0),0);
                    return(
                      <div style={S.card}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div>
                            <div style={{fontSize:12,color:"#a78bfa",fontWeight:600}}>🎁 Bonos entregados</div>
                            <div style={{fontSize:11,color:"#4c3a70",marginTop:2}}>Fichas regaladas — se descuentan del neto real</div>
                          </div>
                          <button onClick={addBono} style={{background:"#1a0533",border:"1px solid #7c3aed",color:"#c084fc",padding:"5px 12px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600}}>+ Agregar bono</button>
                        </div>
                        {bonos.length===0?(
                          <div style={{fontSize:12,color:"#4c3a70",fontStyle:"italic"}}>Sin bonos en este turno</div>
                        ):(
                          <div style={{display:"flex",flexDirection:"column",gap:8}}>
                            {bonos.map(bono=>(
                              <div key={bono.id} style={{background:"#0a0a0f",border:"1px solid #4c1d95",borderRadius:10,padding:"12px 14px"}}>
                                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
                                  <div><label style={S.label}>Jugador</label><input type="text" value={bono.jugador} placeholder="Usuario" onChange={e=>updBono(bono.id,"jugador",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/></div>
                                  <div><label style={S.label}>Monto ($)</label><input type="number" value={bono.monto} placeholder="0" onChange={e=>updBono(bono.id,"monto",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/></div>
                                  <div><label style={S.label}>Nota</label><input type="text" value={bono.nota||""} placeholder="Promo, bienvenida..." onChange={e=>updBono(bono.id,"nota",e.target.value)} style={{...S.input,fontSize:12,padding:"8px 10px"}}/></div>
                                  <button onClick={()=>delBono(bono.id)} style={{...S.danger,alignSelf:"flex-end"}}>🗑️</button>
                                </div>
                              </div>
                            ))}
                            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 4px",fontSize:13}}>
                              <span style={{color:"#7c6fa0"}}>Total bonos</span>
                              <span style={{color:"#a78bfa",fontWeight:700}}>{fmt(totalBonosOwner)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {bills.some(b=>cajaForm.cierre[b.id])&&(()=>{
                    const tI2=bills.reduce((s,b)=>s+(+(cajaForm.inicio[b.id]||0)),0);
                    const tC2=bills.reduce((s,b)=>s+(+(cajaForm.cierre[b.id]||0)),0);
                    const totalBajas=(cajaForm.bajas||[]).reduce((s,b)=>s+(+b.monto||0),0);
                    const totalBonos2=(cajaForm.bonos||[]).reduce((s,b)=>s+(+b.monto||0),0);
                    const mov=tC2-tI2+totalBajas-totalBonos2; // bajas suman, bonos restan
                    const de=entries.find(e=>e.date===cajaForm.date);
                    const pn=de?(de.cargas-de.retiros)/3:null;
                    const dif=pn!==null?mov-pn:null;
                    const al=dif!==null&&Math.abs(dif)>100;
                    return(
                      <div style={{background:al?"linear-gradient(135deg,#2d0a0a,#1a0a00)":"linear-gradient(135deg,#0a1f0a,#0a1200)",border:`1px solid ${al?"#7f1d1d":"#14532d"}`,borderRadius:14,padding:"14px 18px"}}>
                        <div style={{fontSize:11,color:"#7c6fa0",marginBottom:10}}>Resumen del turno</div>
                        <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                          <div><div style={{fontSize:10,color:"#7c6fa0"}}>Mov. neto caja</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:mov>=0?"#4ade80":"#f87171"}}>{fmt(tC2-tI2)}</div></div>
                          {totalBajas>0&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Bajas enviadas</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#fbbf24"}}>+{fmt(totalBajas)}</div></div>}
                          <div><div style={{fontSize:10,color:"#7c6fa0"}}>Real (con bajas)</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:mov>=0?"#4ade80":"#f87171"}}>{fmt(mov)}</div></div>
                          {pn!==null&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Esperado (⅓ neto)</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#a78bfa"}}>{fmt(pn)}</div></div>}
                          {dif!==null&&<div><div style={{fontSize:10,color:"#7c6fa0"}}>Diferencia</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:al?"#f87171":"#4ade80"}}>{dif>0?"+":""}{fmt(dif)}</div></div>}
                        </div>
                        {al&&<div style={{marginTop:8,fontSize:12,color:"#f87171"}}>⚠️ Diferencia significativa</div>}
                      </div>
                    );
                  })()}
                  <button onClick={saveCaja} style={{...S.btn,width:"100%"}}>💾 Guardar cierre de turno</button>
                </div>
              </div>
            )}

            {cajaTab==="historial"&&(
              <div>
                {cajaHistorial.length===0?<div style={{textAlign:"center",padding:"40px",color:"#7c6fa0"}}>No hay registros todavía.</div>:(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {cajaHistorial.map(c=>{
                      const isExp=expandedCaja===c.key; const hasDif=Math.abs(c.dif)>100;
                      return(
                        <div key={c.key} style={{background:hasDif?"#1a0808":"#13102a",border:`1px solid ${hasDif?"#7f1d1d":"#2a1f4a"}`,borderRadius:14}}>
                          <div onClick={()=>setExpandedCaja(isExp?null:c.key)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 18px",cursor:"pointer",flexWrap:"wrap",gap:8}}>
                            <div>
                              <span style={{color:"#a78bfa",fontWeight:700,fontSize:13}}>{new Date(c.date+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short"})}</span>
                              <span style={{marginLeft:10,fontSize:11,color:"#7c6fa0"}}>{c.turno?.label} · {c.turno?.horario}</span>
                              <span style={{marginLeft:10,fontSize:11,color:"#c084fc"}}>👤 {c.caja.empleado}</span>
                            </div>
                            <div style={{display:"flex",gap:14,alignItems:"center"}}>
                              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#7c6fa0"}}>Mov.</div><div style={{color:c.mov>=0?"#4ade80":"#f87171",fontWeight:700,fontSize:13}}>{fmt(c.mov)}</div></div>
                              <div style={{textAlign:"right"}}><div style={{fontSize:10,color:"#7c6fa0"}}>Diferencia</div><div style={{color:hasDif?"#f87171":"#4ade80",fontWeight:800,fontFamily:"'Syne',sans-serif",fontSize:14}}>{c.dif>0?"+":""}{fmt(c.dif)}</div></div>
                              <span style={{color:"#7c6fa0",fontSize:11}}>{isExp?"▲":"▼"}</span>
                            </div>
                          </div>
                          {isExp&&(
                            <div style={{padding:"0 18px 14px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                              {[{label:"🟢 Apertura",k:"inicio",color:"#38bdf8",total:c.tI},{label:"🔴 Cierre",k:"cierre",color:"#f87171",total:c.tC}].map(col=>(
                                <div key={col.k}>
                                  <div style={{fontSize:11,color:col.color,marginBottom:8}}>{col.label}</div>
                                  {bills.map(b=>(
                                    <div key={b.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"4px 0",borderBottom:"1px solid #1a1530"}}>
                                      <span style={{color:"#7c6fa0"}}>{b.nombre}</span><span style={{color:"#e2e8f0"}}>{fmt(c.caja[col.k]?.[b.id]||0)}</span>
                                    </div>
                                  ))}
                                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,paddingTop:6,fontWeight:700}}>
                                    <span style={{color:col.color}}>Total</span><span style={{color:col.color}}>{fmt(col.total)}</span>
                                  </div>
                                </div>
                              ))}
                              {(c.caja.bonos||[]).length>0&&(
                                <div style={{gridColumn:"1/-1"}}>
                                  <div style={{fontSize:11,color:"#a78bfa",marginBottom:8}}>🎁 Bonos del turno</div>
                                  {(c.caja.bonos||[]).map((bono,i)=>(
                                    <div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"5px 0",borderBottom:"1px solid #1a1530"}}>
                                      <div>
                                        {bono.jugador&&<span style={{color:"#e2e8f0"}}>→ {bono.jugador}</span>}
                                        {bono.nota&&<span style={{color:"#4c3a70",marginLeft:8}}>· {bono.nota}</span>}
                                      </div>
                                      <span style={{color:"#a78bfa",fontWeight:700}}>{fmt(+bono.monto||0)}</span>
                                    </div>
                                  ))}
                                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,paddingTop:6,fontWeight:700}}>
                                    <span style={{color:"#a78bfa"}}>Total bonos</span>
                                    <span style={{color:"#a78bfa"}}>{fmt((c.caja.bonos||[]).reduce((s,b)=>s+(+b.monto||0),0))}</span>
                                  </div>
                                </div>
                              )}
                              {(c.caja.bajas||[]).length>0&&(
                                <div style={{gridColumn:"1/-1"}}>
                                  <div style={{fontSize:11,color:"#fbbf24",marginBottom:8}}>📤 Bajas del turno</div>
                                  {(c.caja.bajas||[]).map((baja,i)=>{
                                    const bill=bills.find(b=>b.id===baja.billeteraId);
                                    const dest=(config?.destinosBajas||[]).find(d=>d.id===baja.destinoId);
                                    return(
                                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"6px 0",borderBottom:"1px solid #1a1530"}}>
                                        <div>
                                          <span style={{color:"#7c6fa0"}}>{bill?.nombre||"—"}</span>
                                          {dest&&<span style={{color:"#4c3a70",marginLeft:8}}>→ {dest.alias} ({dest.titular})</span>}
                                          {baja.nota&&<span style={{color:"#4c3a70",marginLeft:8}}>· {baja.nota}</span>}
                                        </div>
                                        <span style={{color:"#fbbf24",fontWeight:700}}>{fmt(+baja.monto||0)}</span>
                                      </div>
                                    );
                                  })}
                                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12,paddingTop:6,fontWeight:700}}>
                                    <span style={{color:"#fbbf24"}}>Total bajas</span>
                                    <span style={{color:"#fbbf24"}}>{fmt((c.caja.bajas||[]).reduce((s,b)=>s+(+b.monto||0),0))}</span>
                                  </div>
                                </div>
                              )}
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

        {/* JUGADORES */}
        {activeTab==="jugadores"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:6,color:"#c084fc"}}>👥 Jugadores</h2>
            <p style={{color:"#7c6fa0",fontSize:12,marginBottom:20}}>Primera aparición en el historial.</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
              {[{label:"Nuevos este mes",value:cmNuevos,color:"#fbbf24",icon:"🆕"},{label:"Nuevos mes pasado",value:pmNuevos,color:"#a78bfa",icon:"📅"},{label:"Activos este mes",value:cmUnicos,color:"#38bdf8",icon:"🎮"},{label:"Total historial",value:totalPlayers,color:"#4ade80",icon:"📁"}].map(s=>(
                <div key={s.label} style={S.card}><div style={{fontSize:18,marginBottom:6}}>{s.icon}</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:24,fontWeight:800,color:s.color}}>{s.value}</div><div style={{fontSize:11,color:"#7c6fa0",marginTop:4}}>{s.label}</div></div>
              ))}
            </div>
            {(cmNuevos>0||pmNuevos>0)&&(
              <div style={{...S.card,marginBottom:20}}>
                <div style={{fontSize:12,color:"#fbbf24",fontWeight:600,marginBottom:14}}>Nuevos: mes a mes</div>
                {[{label:monthLabel(-1),value:pmNuevos,color:"#78350f",tc:"#a78bfa"},{label:monthLabel(),value:cmNuevos,color:"linear-gradient(90deg,#d97706,#fbbf24)",tc:"#fbbf24"}].map(row=>(
                  <div key={row.label} style={{display:"flex",alignItems:"center",gap:14,marginBottom:10}}>
                    <div style={{fontSize:11,color:"#7c6fa0",width:90,textTransform:"capitalize",flexShrink:0}}>{row.label}</div>
                    <div style={{flex:1,background:"#2a1f4a",borderRadius:100,height:10}}><div style={{background:row.color,borderRadius:100,height:10,width:`${Math.max(cmNuevos,pmNuevos)>0?(row.value/Math.max(cmNuevos,pmNuevos))*100:0}%`,transition:"width 1s ease"}}/></div>
                    <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,color:row.tc,width:28,textAlign:"right"}}>{row.value}</div>
                  </div>
                ))}
                {pmNuevos>0&&<div style={{marginTop:12,padding:"10px 14px",background:"#0a0a0f",borderRadius:10,fontSize:13}}>{cmNuevos>pmNuevos?<span>📈 <span style={{color:"#4ade80",fontWeight:700}}>+{cmNuevos-pmNuevos} más</span> que el mes pasado (+{pct(cmNuevos,pmNuevos)}%)</span>:cmNuevos<pmNuevos?<span>📉 <span style={{color:"#f87171",fontWeight:700}}>{cmNuevos-pmNuevos} menos</span> que el mes pasado ({pct(cmNuevos,pmNuevos)}%)</span>:<span style={{color:"#94a3b8"}}>Igual que el mes pasado</span>}</div>}
              </div>
            )}
            {cmEntries.some(e=>e.jugadoresNuevos>0)&&(
              <div style={S.card}>
                <div style={{fontSize:12,color:"#fbbf24",fontWeight:600,marginBottom:14}}>Día a día este mes</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {cmEntries.filter(e=>e.jugadoresNuevos>0).map(entry=>(
                    <div key={entry.date}>
                      <div onClick={()=>setExpandedDay(expandedDay===entry.date?null:entry.date)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#0d0a1a",borderRadius:10,cursor:"pointer",border:"1px solid #1a1530"}}>
                        <div style={{display:"flex",gap:10,alignItems:"center"}}>
                          <span style={{color:"#a78bfa",fontSize:13,fontWeight:600}}>{new Date(entry.date+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short"})}</span>
                          <div style={{display:"flex",gap:3}}>{Array.from({length:Math.min(entry.jugadoresNuevos,8)}).map((_,i)=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#fbbf24"}}/>)}{entry.jugadoresNuevos>8&&<span style={{fontSize:10,color:"#fbbf24"}}>+{entry.jugadoresNuevos-8}</span>}</div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#fbbf24",fontSize:16}}>+{entry.jugadoresNuevos}</span>
                          {entry.jugadoresNuevosLista?.length>0&&<span style={{color:"#7c6fa0",fontSize:11}}>{expandedDay===entry.date?"▲":"▼"}</span>}
                        </div>
                      </div>
                      {expandedDay===entry.date&&entry.jugadoresNuevosLista?.length>0&&(
                        <div style={{background:"#0a0812",border:"1px solid #1a1530",borderTop:"none",borderRadius:"0 0 10px 10px",padding:"10px 14px",display:"flex",flexWrap:"wrap",gap:8}}>
                          {entry.jugadoresNuevosLista.map(j=><span key={j} style={{background:"#1a1225",border:"1px solid #3b2a5a",borderRadius:20,padding:"3px 12px",fontSize:12,color:"#c084fc"}}>👤 {j}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {totalPlayers===0&&<div style={{textAlign:"center",padding:"40px",color:"#7c6fa0"}}><div style={{fontSize:36,marginBottom:12}}>👥</div><div>Importá los CSVs para ver jugadores</div></div>}
          </div>
        )}

        {/* IMPORTAR */}
        {activeTab==="importar"&&(
          <div style={{maxWidth:620}}>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:6,color:"#c084fc"}}>📂 Importar CSV</h2>
            <p style={{color:"#7c6fa0",fontSize:12,marginBottom:20}}>Agrupá por día, separá cargas/retiros, detectá jugadores nuevos.</p>
            {!importPreview?(
              <div onClick={()=>fileRef.current.click()} style={{border:"2px dashed #4c1d95",borderRadius:16,padding:"48px",textAlign:"center",cursor:"pointer",background:"#0d0a1a"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="#7c3aed"} onMouseLeave={e=>e.currentTarget.style.borderColor="#4c1d95"}>
                <div style={{fontSize:40,marginBottom:10}}>📁</div>
                <div style={{color:"#a78bfa",fontWeight:600,fontSize:14,marginBottom:4}}>{importing?"Procesando...":"Hacé clic para seleccionar el CSV"}</div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{display:"none"}}/>
              </div>
            ):(
              <div>
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{fontSize:11,color:"#a78bfa",marginBottom:14}}>✅ <strong>{importPreview.file}</strong></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:14}}>
                    {[{label:"Días",value:importPreview.data.length,color:"#c084fc"},{label:"Cargas",value:fmt(sumK(importPreview.data,"cargas")),color:"#4ade80"},{label:"Retiros",value:fmt(sumK(importPreview.data,"retiros")),color:"#f87171"},{label:"Nuevos",value:importPreview.totalNew,color:"#fbbf24"}].map(s=>(
                      <div key={s.label} style={{background:"#0a0a0f",borderRadius:10,padding:"10px 12px"}}>
                        <div style={{fontSize:10,color:"#7c6fa0",marginBottom:4}}>{s.label}</div>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:s.color}}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{maxHeight:190,overflowY:"auto"}}>
                    {importPreview.data.map(d=>(
                      <div key={d.date} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,padding:"6px 0",borderBottom:"1px solid #13102a",fontSize:12}}>
                        <span style={{color:"#a78bfa"}}>{new Date(d.date+"T12:00:00").toLocaleDateString("es-AR",{day:"numeric",month:"short"})}</span>
                        <span style={{color:"#4ade80"}}>{fmt(d.cargas)}</span>
                        <span style={{color:"#f87171"}}>{fmt(d.retiros)}</span>
                        <span style={{color:d.jugadoresNuevos>0?"#fbbf24":"#7c6fa0"}}>{d.jugadoresNuevos>0?`🆕 ${d.jugadoresNuevos}`:"—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{fontSize:12,color:"#7c6fa0",marginBottom:10}}>¿Qué hacemos si ya existen fechas?</div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>confirmImport("replace")} style={{...S.btn,flex:1}}>✅ Reemplazar</button>
                  <button onClick={()=>confirmImport("merge")} style={{flex:1,background:"#1e1b3a",border:"1px solid #4c1d95",color:"#a78bfa",padding:"12px",borderRadius:12,cursor:"pointer",fontSize:13,fontWeight:600}}>➕ Sumar</button>
                  <button onClick={()=>setImportPreview(null)} style={{background:"#1e0a0a",border:"1px solid #7f1d1d",color:"#f87171",padding:"12px 14px",borderRadius:12,cursor:"pointer"}}>✕</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* CARGAR */}
        {activeTab==="cargar"&&(
          <div style={{maxWidth:460}}>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:20,color:"#c084fc"}}>{editId?"✏️ Editar":"➕ Cargar Día del Panel"}</h2>
            {[{label:"Fecha",key:"date",type:"date"},{label:"💰 Cargas ($)",key:"cargas",type:"number",ph:"0"},{label:"💸 Retiros ($)",key:"retiros",type:"number",ph:"0"}].map(f=>(
              <div key={f.key} style={{marginBottom:14}}><label style={S.label}>{f.label}</label><input type={f.type} value={form[f.key]} placeholder={f.ph} onChange={e=>setForm({...form,[f.key]:e.target.value})} style={S.input}/></div>
            ))}
            <div style={{marginBottom:18}}><label style={S.label}>📝 Notas</label><textarea value={form.notas} placeholder="Novedades..." onChange={e=>setForm({...form,notas:e.target.value})} rows={3} style={{...S.input,resize:"vertical"}}/></div>
            {form.cargas&&form.retiros&&<div style={{background:"#1a0533",border:"1px solid #4c1d95",borderRadius:12,padding:"12px 16px",marginBottom:16}}><div style={{display:"flex",gap:20}}><div><span style={{color:"#7c6fa0",fontSize:12}}>Neto: </span><span style={{color:+form.cargas-+form.retiros>=0?"#4ade80":"#f87171",fontWeight:700}}>{fmt(+form.cargas-+form.retiros)}</span></div><div><span style={{color:"#7c6fa0",fontSize:12}}>Ratio: </span><span style={{color:"#c084fc",fontWeight:700}}>{form.retiros>0?((+form.cargas/+form.retiros)*100).toFixed(0):"∞"}%</span></div></div></div>}
            <div style={{display:"flex",gap:10}}>
              <button onClick={addEntry} style={{...S.btn,flex:1}}>{editId?"Actualizar":"Guardar"}</button>
              {editId&&<button onClick={()=>{setEditId(null);setForm({date:todayStr(),cargas:"",retiros:"",notas:""}); }} style={{background:"#1e1b3a",border:"1px solid #2a1f4a",color:"#7c6fa0",padding:"12px 18px",borderRadius:12,cursor:"pointer"}}>Cancelar</button>}
            </div>
          </div>
        )}

        {/* HISTORIAL */}
        {activeTab==="historial"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:18,color:"#c084fc"}}>📋 Historial</h2>
            {entries.length===0?<div style={{textAlign:"center",padding:"40px",color:"#7c6fa0"}}>No hay registros.</div>:(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[...entries].reverse().map(entry=>{
                  const neto=entry.cargas-entry.retiros;
                  return(
                    <div key={entry.id} style={{background:"#13102a",border:"1px solid #2a1f4a",borderRadius:14,padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                      <div style={{minWidth:110}}>
                        <div style={{fontWeight:700,color:"#a78bfa",fontSize:13}}>{new Date(entry.date+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short"})}</div>
                        {entry.notas&&<div style={{fontSize:11,color:"#7c6fa0",marginTop:2}}>{entry.notas}</div>}
                        {entry.jugadoresNuevos>0&&<div style={{fontSize:11,color:"#fbbf24",marginTop:2}}>🆕 {entry.jugadoresNuevos} nuevos</div>}
                      </div>
                      <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                        {[{label:"Cargas",v:entry.cargas,c:"#4ade80"},{label:"Retiros",v:entry.retiros,c:"#f87171"},{label:"Neto",v:neto,c:neto>=0?"#4ade80":"#f87171"}].map(x=>(
                          <div key={x.label} style={{textAlign:"right"}}><div style={{fontSize:10,color:"#7c6fa0"}}>{x.label}</div><div style={{color:x.c,fontWeight:700,fontFamily:x.label==="Neto"?"'Syne',sans-serif":"inherit"}}>{fmt(x.v)}</div></div>
                        ))}
                        <div style={{display:"flex",gap:6}}>
                          <button onClick={()=>editEntry(entry)} style={{background:"#1e1b3a",border:"1px solid #4c1d95",color:"#a78bfa",padding:"5px 9px",borderRadius:8,cursor:"pointer",fontSize:12}}>✏️</button>
                          <button onClick={()=>delEntry(entry.id)} style={{background:"#1e0a0a",border:"1px solid #7f1d1d",color:"#f87171",padding:"5px 9px",borderRadius:8,cursor:"pointer",fontSize:12}}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CAMPAÑA */}
        {/* ── BONOS ── */}
        {activeTab==="bonos"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:6,color:"#c084fc"}}>🎁 Seguimiento de Bonos</h2>
            <p style={{color:"#7c6fa0",fontSize:12,marginBottom:20}}>Fichas regaladas por turno y empleado. Un exceso de bonos puede indicar irregularidades.</p>

            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Total bonos entregados</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:"#a78bfa",margin:"8px 0 4px"}}>{fmt(totalBonosGeneral)}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>{todosBonos.length} bono{todosBonos.length!==1?"s":""} registrado{todosBonos.length!==1?"s":""}</div>
              </div>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Neto real del mes</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:cmN-totalBonosGeneral>=0?"#4ade80":"#f87171",margin:"8px 0 4px"}}>{fmt(cmN-totalBonosGeneral)}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>neto panel menos bonos</div>
              </div>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Empleados con bonos</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:"#fbbf24",margin:"8px 0 4px"}}>{bonosPorEmpleado.length}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>de {empleados.length} empleados</div>
              </div>
            </div>

            {/* Por empleado */}
            {bonosPorEmpleado.length>0&&(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:14}}>Por empleado</div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {bonosPorEmpleado.sort((a,b)=>b.total-a.total).map(emp=>(
                    <div key={emp.id}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                        <div>
                          <span style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>👤 {emp.nombre}</span>
                          <span style={{fontSize:11,color:"#7c6fa0",marginLeft:10}}>{emp.bonos.length} bono{emp.bonos.length!==1?"s":""}</span>
                        </div>
                        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,color:emp.total>totalBonosGeneral*0.5?"#f87171":"#a78bfa",fontSize:16}}>{fmt(emp.total)}</span>
                      </div>
                      <div style={{background:"#1a1530",borderRadius:100,height:8}}>
                        <div style={{background:emp.total>totalBonosGeneral*0.5?"linear-gradient(90deg,#dc2626,#f87171)":"linear-gradient(90deg,#4c1d95,#a78bfa)",borderRadius:100,height:8,width:`${totalBonosGeneral>0?(emp.total/totalBonosGeneral)*100:0}%`,transition:"width 1s ease"}}/>
                      </div>
                      {totalBonosGeneral>0&&<div style={{fontSize:10,color:"#4c3a70",marginTop:3}}>{((emp.total/totalBonosGeneral)*100).toFixed(1)}% del total</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Por día */}
            {bonosPorDia.length>0&&(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{fontSize:12,color:"#fbbf24",fontWeight:600,marginBottom:14}}>Por día — detalle de turnos</div>
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {bonosPorDia.sort((a,b)=>b.date.localeCompare(a.date)).map(dia=>(
                    <div key={dia.date} style={{padding:"12px 0",borderBottom:"1px solid #1a1530"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <span style={{color:"#a78bfa",fontWeight:600,fontSize:13}}>{new Date(dia.date+"T12:00:00").toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"short"})}</span>
                        <span style={{fontFamily:"'Syne',sans-serif",fontWeight:800,color:"#a78bfa",fontSize:15}}>{fmt(dia.total)}</span>
                      </div>
                      <div style={{display:"flex",flexDirection:"column",gap:4}}>
                        {dia.bonos.map((b,i)=>(
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#0a0a0f",borderRadius:8,padding:"8px 12px",fontSize:12}}>
                            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{color:"#c084fc"}}>👤 {b.empleado}</span>
                              <span style={{color:"#7c6fa0"}}>{b.turno?.label}</span>
                              {b.jugador&&<span style={{color:"#e2e8f0"}}>→ {b.jugador}</span>}
                              {b.nota&&<span style={{color:"#4c3a70"}}>· {b.nota}</span>}
                            </div>
                            <span style={{color:"#a78bfa",fontWeight:700,flexShrink:0}}>{fmt(+b.monto||0)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {todosBonos.length===0&&(
              <div style={{...S.card,textAlign:"center",padding:40}}>
                <div style={{fontSize:36,marginBottom:10}}>🎁</div>
                <div style={{color:"#7c6fa0",fontSize:13}}>No hay bonos registrados todavía.</div>
                <div style={{fontSize:12,color:"#4c3a70",marginTop:6}}>Los bonos se cargan desde la sección de Caja al guardar un turno.</div>
              </div>
            )}
          </div>
        )}

        {/* ── BAJAS ── */}
        {activeTab==="bajas"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:6,color:"#c084fc"}}>📤 Flujo de Bajas</h2>
            <p style={{color:"#7c6fa0",fontSize:12,marginBottom:20}}>Todo el dinero enviado a cuentas externas desde las billeteras del panel.</p>

            {/* KPIs */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Total bajado</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:"#fbbf24",margin:"8px 0 4px"}}>{fmt(totalBajasGeneral)}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>{todasBajas.length} movimiento{todasBajas.length!==1?"s":""}</div>
              </div>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Neto del mes</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:cmN>=0?"#4ade80":"#f87171",margin:"8px 0 4px"}}>{fmt(cmN)}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>generado en el panel</div>
              </div>
              <div style={S.card}>
                <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1}}>Diferencia</div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:cmN-totalBajasGeneral>=0?"#4ade80":"#f87171",margin:"8px 0 4px"}}>{fmt(cmN-totalBajasGeneral)}</div>
                <div style={{fontSize:11,color:"#7c6fa0"}}>{cmN-totalBajasGeneral>=0?"aún en cuentas":"más bajado que generado"}</div>
              </div>
            </div>

            {/* Por destino */}
            {(config?.destinosBajas||[]).length>0&&(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{fontSize:12,color:"#fbbf24",fontWeight:600,marginBottom:14}}>Por destino</div>
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {bajasPorDestino.map((dest,i)=>(
                    <div key={dest.id}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 0",borderBottom:"1px solid #1a1530"}}>
                        <div>
                          <div style={{color:"#e2e8f0",fontWeight:600,fontSize:14}}>{dest.alias}</div>
                          <div style={{fontSize:11,color:"#7c6fa0",marginTop:2}}>👤 {dest.titular} · <span style={{fontFamily:"monospace",color:"#a78bfa"}}>{dest.cbu}</span></div>
                          <div style={{fontSize:11,color:"#4c3a70",marginTop:1}}>{dest.movimientos.length} transferencia{dest.movimientos.length!==1?"s":""}</div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,color:"#fbbf24"}}>{fmt(dest.total)}</div>
                          {totalBajasGeneral>0&&<div style={{fontSize:11,color:"#7c6fa0"}}>{((dest.total/totalBajasGeneral)*100).toFixed(1)}% del total</div>}
                        </div>
                      </div>
                      {/* Barra proporcional */}
                      <div style={{background:"#1a1530",borderRadius:100,height:4,margin:"4px 0 4px"}}>
                        <div style={{background:"linear-gradient(90deg,#d97706,#fbbf24)",borderRadius:100,height:4,width:`${totalBajasGeneral>0?(dest.total/totalBajasGeneral)*100:0}%`,transition:"width 1s ease"}}/>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Por billetera */}
            {bills.length>0&&(
              <div style={{...S.card,marginBottom:16}}>
                <div style={{fontSize:12,color:"#38bdf8",fontWeight:600,marginBottom:14}}>Por billetera origen</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {bajasPorBilletera.filter(b=>b.total>0).map(b=>(
                    <div key={b.id} style={{display:"flex",alignItems:"center",gap:14}}>
                      <span style={{fontSize:16}}>💳</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{color:"#e2e8f0",fontSize:13}}>{b.nombre}</span>
                          <span style={{color:"#38bdf8",fontWeight:700,fontSize:13}}>{fmt(b.total)}</span>
                        </div>
                        <div style={{background:"#1a1530",borderRadius:100,height:6}}>
                          <div style={{background:"linear-gradient(90deg,#0369a1,#38bdf8)",borderRadius:100,height:6,width:`${totalBajasGeneral>0?(b.total/totalBajasGeneral)*100:0}%`,transition:"width 1s ease"}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                  {bajasPorBilletera.every(b=>b.total===0)&&<div style={{color:"#4c3a70",fontSize:13}}>Sin bajas registradas todavía.</div>}
                </div>
              </div>
            )}

            {/* Historial de bajas */}
            <div style={S.card}>
              <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:14}}>Historial de bajas</div>
              {todasBajas.length===0?(
                <div style={{color:"#4c3a70",fontSize:13,fontStyle:"italic"}}>No hay bajas registradas todavía.</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:0}}>
                  {todasBajas.map((b,i)=>{
                    const bill=bills.find(x=>x.id===b.billeteraId);
                    const dest=(config?.destinosBajas||[]).find(d=>d.id===b.destinoId);
                    return(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid #1a1530",gap:10,flexWrap:"wrap"}}>
                        <div>
                          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{color:"#a78bfa",fontSize:12,fontWeight:600}}>{new Date(b.date+"T12:00:00").toLocaleDateString("es-AR",{weekday:"short",day:"numeric",month:"short"})}</span>
                            <span style={{fontSize:11,color:"#7c6fa0"}}>{b.turno?.label}</span>
                            <span style={{fontSize:11,color:"#c084fc"}}>👤 {b.empleado}</span>
                          </div>
                          <div style={{fontSize:12,color:"#7c6fa0",marginTop:3}}>
                            <span style={{color:"#38bdf8"}}>💳 {bill?.nombre||"—"}</span>
                            {dest&&<span style={{marginLeft:8}}>→ <span style={{color:"#fbbf24"}}>{dest.alias}</span> · <span style={{fontFamily:"monospace",fontSize:11}}>{dest.cbu}</span></span>}
                          </div>
                          {b.nota&&<div style={{fontSize:11,color:"#4c3a70",marginTop:2}}>📝 {b.nota}</div>}
                        </div>
                        <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:800,color:"#fbbf24",flexShrink:0}}>{fmt(+b.monto||0)}</div>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",justifyContent:"space-between",paddingTop:12,fontSize:13,fontWeight:700}}>
                    <span style={{color:"#7c6fa0"}}>Total</span>
                    <span style={{color:"#fbbf24",fontFamily:"'Syne',sans-serif",fontSize:16}}>{fmt(totalBajasGeneral)}</span>
                  </div>
                </div>
              )}
            </div>

            {(config?.destinosBajas||[]).length===0&&(
              <div style={{...S.card,textAlign:"center",padding:32,marginTop:16}}>
                <div style={{fontSize:32,marginBottom:10}}>📤</div>
                <div style={{color:"#7c6fa0",fontSize:13,marginBottom:12}}>No hay destinos de baja configurados todavía.</div>
                <button onClick={()=>{setActiveTab("ajustes");setSettingsTab("bajas");}} style={{...S.btn,fontSize:13,padding:"9px 18px"}}>⚙️ Configurar destinos</button>
              </div>
            )}
          </div>
        )}

        {activeTab==="campana"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:6,color:"#c084fc"}}>📣 Campaña de Recuperación</h2>
            <p style={{color:"#7c6fa0",fontSize:12,marginBottom:20}}>Seguimiento de reactivación de jugadores inactivos.</p>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20}}>
              {[{label:"Mensajes enviados",value:campaign.sent.toLocaleString("es-AR"),icon:"📨",color:"#818cf8"},{label:"Recuperados",value:campaign.recovered.toLocaleString("es-AR"),icon:"🔄",color:"#4ade80"},{label:"Depósitos generados",value:fmt(campaign.deposits),icon:"💵",color:"#fbbf24"}].map(s=>(
                <div key={s.label} style={S.card}><div style={{fontSize:22,marginBottom:8}}>{s.icon}</div><div style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:s.color}}>{s.value}</div><div style={{fontSize:11,color:"#7c6fa0",marginTop:4}}>{s.label}</div></div>
              ))}
            </div>
            <div style={{background:"linear-gradient(135deg,#1a0533,#0d1b3e)",border:"1px solid #4c1d95",borderRadius:14,padding:"16px 20px",marginBottom:20}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:13,color:"#a78bfa"}}>Tasa de recuperación</span>
                <span style={{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,color:recoveryRate>10?"#4ade80":recoveryRate>5?"#fbbf24":"#f87171"}}>{recoveryRate}%</span>
              </div>
              <div style={{background:"#2a1f4a",borderRadius:100,height:8}}><div style={{background:"linear-gradient(90deg,#7c3aed,#4ade80)",borderRadius:100,height:8,width:`${Math.min(recoveryRate,100)}%`,transition:"width 1s ease"}}/></div>
              {campaign.deposits>0&&campaign.recovered>0&&<div style={{marginTop:10,fontSize:12,color:"#7c6fa0"}}>Depósito promedio: <span style={{color:"#fbbf24",fontWeight:700}}>{fmt(campaign.deposits/campaign.recovered)}</span></div>}
            </div>
            <div style={S.card}>
              <div style={{fontSize:12,color:"#a78bfa",marginBottom:14,fontWeight:600}}>Actualizar</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:14}}>
                {[{label:"📨 Enviados",key:"sent",ph:campaign.sent},{label:"🔄 Recuperados",key:"recovered",ph:campaign.recovered},{label:"💵 Depósitos ($)",key:"deposits",ph:campaign.deposits}].map(f=>(
                  <div key={f.key}><label style={S.label}>{f.label}</label><input type="number" placeholder={f.ph} value={campForm[f.key]} onChange={e=>setCampForm({...campForm,[f.key]:e.target.value})} style={{width:"100%",background:"#0a0a0f",border:"1px solid #2a1f4a",borderRadius:8,padding:"10px 12px",color:"#e2e8f0",fontSize:14,outline:"none",boxSizing:"border-box"}}/></div>
                ))}
              </div>
              <button onClick={saveCamp} style={S.btn}>Guardar</button>
            </div>
          </div>
        )}

        {/* AJUSTES */}
        {activeTab==="ajustes"&&(
          <div>
            <h2 style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:800,marginBottom:20,color:"#c084fc"}}>⚙️ Ajustes</h2>
            <div style={{display:"flex",gap:8,marginBottom:24}}>
              {[{id:"billeteras",label:"💳 Billeteras"},{id:"empleados",label:"👥 Empleados"},{id:"bajas",label:"📤 Destinos Bajas"},{id:"negocio",label:"🏷️ Negocio"}].map(t=>(
                <SubTab key={t.id} active={settingsTab===t.id} onClick={()=>setSettingsTab(t.id)}>{t.label}</SubTab>
              ))}
            </div>

            {settingsTab==="billeteras"&&(
              <div style={{maxWidth:500}}>
                <div style={S.card}>
                  <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:6}}>Billeteras del negocio</div>
                  <p style={{color:"#7c6fa0",fontSize:12,marginBottom:16}}>Se usan en <strong style={{color:"#c084fc"}}>todos los turnos</strong>. Nombre libre: podés poner "MP Principal", "Brubank Noche", etc.</p>
                  {bills.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                      {bills.map((b,idx)=>(
                        <div key={b.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0a0a0f",borderRadius:10,padding:"11px 14px",border:"1px solid #2a1f4a"}}>
                          <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:18}}>💳</span><span style={{color:"#e2e8f0",fontSize:14,fontWeight:500}}>{b.nombre}</span></div>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={()=>moveBill(b.id,-1)} disabled={idx===0} style={{background:"#1e1b3a",border:"1px solid #2a1f4a",color:idx===0?"#2a1f4a":"#7c6fa0",padding:"4px 8px",borderRadius:6,cursor:idx===0?"default":"pointer",fontSize:11}}>▲</button>
                            <button onClick={()=>moveBill(b.id,1)} disabled={idx===bills.length-1} style={{background:"#1e1b3a",border:"1px solid #2a1f4a",color:idx===bills.length-1?"#2a1f4a":"#7c6fa0",padding:"4px 8px",borderRadius:6,cursor:idx===bills.length-1?"default":"pointer",fontSize:11}}>▼</button>
                            <button onClick={()=>delBill(b.id)} style={S.danger}>🗑️</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{display:"flex",gap:10}}>
                    <input type="text" value={newBillName} placeholder='"MP Principal", "Brubank 2"...' onChange={e=>setNewBillName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addBill()} style={{...S.input,flex:1}}/>
                    <button onClick={addBill} style={{...S.btn,padding:"11px 18px"}}>+</button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab==="empleados"&&(()=>{
              const DIAS=[{id:"lun",label:"Lun"},{id:"mar",label:"Mar"},{id:"mie",label:"Mié"},{id:"jue",label:"Jue"},{id:"vie",label:"Vie"},{id:"sab",label:"Sáb"},{id:"dom",label:"Dom"}];

              // Toggle día en formulario nuevo
              const toggleDia=(id)=>{
                const dias=newEmpForm.dias||[];
                const horarios={...newEmpForm.horarios||{}};
                const next=dias.includes(id)?dias.filter(d=>d!==id):[...dias,id];
                if(!next.includes(id)) delete horarios[id];
                setNewEmpForm({...newEmpForm,dias:next,horarios});
              };

              // Actualizar horario en formulario nuevo
              const setHorarioNew=(diaId,val)=>{
                setNewEmpForm({...newEmpForm,horarios:{...newEmpForm.horarios||{},[diaId]:val}});
              };

              // Toggle día en empleado existente
              const toggleDiaEmp=(empId,diaId)=>{
                const updated=empleados.map(e=>{
                  if(e.id!==empId) return e;
                  const dias=e.dias||[];
                  const horarios={...e.horarios||{}};
                  const next=dias.includes(diaId)?dias.filter(d=>d!==diaId):[...dias,diaId];
                  if(!next.includes(diaId)) delete horarios[diaId];
                  return {...e,dias:next,horarios};
                });
                saveEmpleados(updated);
              };

              // Actualizar horario en empleado existente
              const setHorarioEmp=(empId,diaId,val)=>{
                const updated=empleados.map(e=>{
                  if(e.id!==empId) return e;
                  return {...e,horarios:{...e.horarios||{},[diaId]:val}};
                });
                saveEmpleados(updated);
              };

              return(
              <div style={{maxWidth:620}}>
                {/* Formulario nuevo empleado */}
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:10}}>➕ Agregar empleado</div>
                  <div style={{background:"#0d0a1a",border:"1px solid #2a1f4a",borderRadius:10,padding:"12px 14px",marginBottom:16}}>
                    <div style={{fontSize:12,color:"#7c6fa0",lineHeight:1.8}}>
                      <div>📝 <strong style={{color:"#c084fc"}}>Paso 1:</strong> Completá nombre, usuario y contraseña del empleado.</div>
                      <div>🕐 <strong style={{color:"#c084fc"}}>Paso 2:</strong> Elegí el turno general que tiene asignado.</div>
                      <div>📅 <strong style={{color:"#c084fc"}}>Paso 3:</strong> Activá los días que trabaja y seleccioná el turno de cada día. Los días sin activar quedan como franco.</div>
                      <div>🔑 <strong style={{color:"#c084fc"}}>Paso 4:</strong> El empleado ingresa con su usuario y contraseña y solo verá la pantalla de carga de su turno.</div>
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
                    {[{label:"Nombre",key:"nombre",ph:"Juan Pérez"},{label:"Usuario",key:"user",ph:"juanperez"},{label:"Contraseña",key:"pass",ph:"••••••",type:"password"}].map(f=>(
                      <div key={f.key}><label style={S.label}>{f.label}</label><input type={f.type||"text"} value={newEmpForm[f.key]} placeholder={f.ph} onChange={e=>setNewEmpForm({...newEmpForm,[f.key]:e.target.value})} style={S.input}/></div>
                    ))}
                    <div>
                      <label style={S.label}>Turno asignado</label>
                      <select value={newEmpForm.turno} onChange={e=>setNewEmpForm({...newEmpForm,turno:e.target.value})} style={{...S.input,appearance:"none"}}>
                        {TURNOS.map(t=><option key={t.id} value={t.id}>{t.label} ({t.horario})</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{marginBottom:16}}>
                    <label style={S.label}>Días y horarios</label>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      {DIAS.map(d=>{
                        const on=(newEmpForm.dias||[]).includes(d.id);
                        const horario=(newEmpForm.horarios||{})[d.id]||"";
                        return(
                          <div key={d.id} style={{display:"flex",alignItems:"center",gap:10}}>
                            <button onClick={()=>toggleDia(d.id)} style={{width:52,padding:"7px 0",border:`1px solid ${on?"#7c3aed":"#2a1f4a"}`,borderRadius:8,background:on?"#2d1b69":"#0a0a0f",color:on?"#c084fc":"#7c6fa0",cursor:"pointer",fontSize:13,fontWeight:on?700:400,flexShrink:0,textAlign:"center"}}>
                              {d.label}
                            </button>
                            {on?(
                              <select value={horario} onChange={e=>setHorarioNew(d.id,e.target.value)}
                                style={{...S.input,flex:1,padding:"7px 12px",fontSize:13,appearance:"none"}}>
                                <option value="">— Seleccioná turno —</option>
                                {TURNOS.map(t=><option key={t.id} value={t.id}>{t.label} · {t.horario}</option>)}
                              </select>
                            ):(
                              <span style={{fontSize:12,color:"#4c3a70",fontStyle:"italic"}}>Franco</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button onClick={addEmp} style={S.btn}>Agregar empleado</button>
                </div>

                {/* Lista empleados */}
                {empleados.length===0
                  ?<div style={{...S.card,textAlign:"center",color:"#7c6fa0",fontSize:13}}>No hay empleados todavía.</div>
                  :(
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {empleados.map(emp=>{
                      const turno=TURNOS.find(t=>t.id===emp.turno);
                      const empDias=emp.dias||[];
                      const empHorarios=emp.horarios||{};
                      return(
                        <div key={emp.id} style={{background:"#13102a",border:`1px solid ${emp.activo?"#2a1f4a":"#1a1020"}`,borderRadius:14,padding:"14px 16px"}}>
                          {/* Header */}
                          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,marginBottom:14}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:8}}>
                                <div style={{width:8,height:8,borderRadius:"50%",background:emp.activo?"#4ade80":"#4a4a5a",flexShrink:0}}/>
                                <span style={{color:emp.activo?"#e2e8f0":"#7c6fa0",fontSize:14,fontWeight:600}}>{emp.nombre}</span>
                              </div>
                              <div style={{fontSize:11,color:"#7c6fa0",marginTop:3,marginLeft:16}}>
                                👤 {emp.user} · 🕐 {turno?.label} ({turno?.horario}){Object.keys(empHorarios).length>0&&<span style={{marginLeft:6,color:"#4c3a70"}}>· {Object.entries(empHorarios).filter(([,v])=>v).map(([k,v])=>{const t=TURNOS.find(x=>x.id===v); return `${DIAS.find(d=>d.id===k)?.label}: ${t?t.label:v}`;}).join(' · ')}</span>}
                              </div>
                            </div>
                            <div style={{display:"flex",gap:8}}>
                              <button onClick={()=>toggleEmp(emp.id)} style={{...S.ghost,fontSize:12,padding:"6px 12px"}}>{emp.activo?"Desactivar":"Activar"}</button>
                              <button onClick={()=>delEmp(emp.id)} style={S.danger}>🗑️</button>
                            </div>
                          </div>

                          {/* Días + horarios editables */}
                          <div style={{fontSize:10,color:"#7c6fa0",textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Días y horarios</div>
                          <div style={{display:"flex",flexDirection:"column",gap:7}}>
                            {DIAS.map(d=>{
                              const on=empDias.includes(d.id);
                              const horario=empHorarios[d.id]||"";
                              return(
                                <div key={d.id} style={{display:"flex",alignItems:"center",gap:10}}>
                                  <button onClick={()=>toggleDiaEmp(emp.id,d.id)}
                                    style={{width:52,padding:"6px 0",border:`1px solid ${on?"#7c3aed":"#1a1530"}`,borderRadius:7,background:on?"#2d1b69":"#0a0a0f",color:on?"#c084fc":"#4c3a70",cursor:"pointer",fontSize:12,fontWeight:on?700:400,flexShrink:0,textAlign:"center"}}>
                                    {d.label}
                                  </button>
                                  {on?(
                                    <select value={horario} onChange={e=>setHorarioEmp(emp.id,d.id,e.target.value)}
                                      style={{...S.input,flex:1,padding:"6px 12px",fontSize:12,appearance:"none"}}>
                                      <option value="">— Seleccioná turno —</option>
                                      {TURNOS.map(t=><option key={t.id} value={t.id}>{t.label} · {t.horario}</option>)}
                                    </select>
                                  ):(
                                    <span style={{fontSize:11,color:"#4c3a70",fontStyle:"italic"}}>Franco</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })()}

            {settingsTab==="bajas"&&(
              <div style={{maxWidth:560}}>
                <div style={{...S.card,marginBottom:16}}>
                  <div style={{fontSize:12,color:"#f59e0b",fontWeight:600,marginBottom:6}}>📤 Destinos de Bajas</div>
                  <p style={{color:"#7c6fa0",fontSize:12,marginBottom:16}}>Configurá los CBU a donde se envía el dinero cuando hay una baja. Estos aparecerán como opciones al registrar una baja en el turno.</p>
                  {(config?.destinosBajas||[]).length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
                      {(config.destinosBajas).map(d=>(
                        <div key={d.id} style={{background:"#0a0a0f",border:"1px solid #92400e",borderRadius:10,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                          <div>
                            <div style={{color:"#fbbf24",fontWeight:700,fontSize:14}}>{d.alias}</div>
                            <div style={{fontSize:12,color:"#7c6fa0",marginTop:3}}>👤 {d.titular}</div>
                            <div style={{fontSize:12,color:"#a78bfa",fontFamily:"monospace",marginTop:2}}>{d.cbu.length===22&&!isNaN(d.cbu)?"CBU: ":"Alias: "}{d.cbu}</div>
                          </div>
                          <button onClick={()=>delDest(d.id)} style={S.danger}>🗑️</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{fontSize:11,color:"#a78bfa",textTransform:"uppercase",letterSpacing:1,marginBottom:10}}>➕ Agregar destino</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                    <div><label style={S.label}>Nombre del destino</label><input type="text" value={newDest.alias} placeholder='Ej: "Cuenta principal"' onChange={e=>setNewDest({...newDest,alias:e.target.value})} style={S.input}/></div>
                    <div><label style={S.label}>Titular</label><input type="text" value={newDest.titular} placeholder="Nombre del titular" onChange={e=>setNewDest({...newDest,titular:e.target.value})} style={S.input}/></div>
                  </div>
                  <div style={{marginBottom:12}}>
                    <label style={S.label}>CBU o Alias</label>
                    <input type="text" value={newDest.cbu} placeholder="CBU (22 dígitos) o alias (ej: nombre.apellido)"
                      onChange={e=>setNewDest({...newDest,cbu:e.target.value})}
                      style={{...S.input,fontFamily:"monospace"}}/>
                    <div style={{fontSize:10,color:"#4c3a70",marginTop:4}}>Podés ingresar el CBU numérico o el alias de la cuenta</div>
                  </div>
                  <button onClick={addDest} style={S.btn}>Agregar destino</button>
                </div>
              </div>
            )}

            {settingsTab==="negocio"&&(
              <div style={{maxWidth:440}}>
                <div style={S.card}>
                  <div style={{fontSize:12,color:"#a78bfa",fontWeight:600,marginBottom:14}}>🏷️ Nombre del negocio</div>
                  <div style={{display:"flex",gap:10}}>
                    <input type="text" value={config.nombre||""} onChange={e=>setConfig({...config,nombre:e.target.value})} style={{...S.input,flex:1}}/>
                    <button onClick={()=>saveConfig(config)} style={{...S.btn,padding:"11px 18px"}}>Guardar</button>
                  </div>
                  <div style={{marginTop:20,padding:"14px",background:"#0a0a0f",borderRadius:10,border:"1px solid #1a1530"}}>
                    <div style={{fontSize:10,color:"#4c3a70",marginBottom:6}}>Vista previa</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:18}}>🎰</span>
                      <span style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,background:"linear-gradient(90deg,#c084fc,#818cf8)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{config.nombre||"Mi Casino"}</span>
                    </div>
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

// ─────────────────────────────────────────────
//  ROOT
// ─────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null);

  const handleLogin  = s  => setSession(s);
  const handleLogout = () => setSession(null);

  if(!session)                       return <Login onLogin={handleLogin}/>;
  if(session.role==="superadmin")    return <SuperAdmin onLogout={handleLogout}/>;
  if(session.role==="employee")      return <EmployeeView session={session} onLogout={handleLogout}/>;
  return <OwnerDashboard session={session} onLogout={handleLogout}/>;
}
