import React, { useEffect, useMemo, useState } from 'react';
import { loadInvoices, loadRules, resolveApproval, saveRules as saveRulesApi, uploadInvoice } from './api';
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BrainCircuit, Building2,
  Check, CheckCircle2, ChevronDown, CircleHelp, Clock3, FileCheck2,
  FileSearch, FileText, Filter, Gauge, LayoutDashboard, LockKeyhole,
  Menu, MoreHorizontal, Plus, Search, Settings2, ShieldAlert, ShieldCheck,
  SlidersHorizontal, Sparkles, Users, Wallet, X, Ban, CircleDollarSign,
  History, CalendarDays, AlertTriangle, RefreshCw
} from 'lucide-react';

const initialRules = {
  maxPerInvoice: 3000,
  monthlyBudget: 18000,
  allowedVendors: 'Acme Software Inc., Northstar Cloud, Linear Labs, Atlas Office',
  requireApprovalAbove: 1500,
  blockDuplicates: true,
  blockUnknownVendors: true
};

const money = (amount, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style:'currency', currency, maximumFractionDigits:2
}).format(amount);

const statusMeta = {
  pay: { label:'Pago simulado', className:'paid', icon:CheckCircle2 },
  blocked: { label:'Bloqueada', className:'blocked', icon:Ban },
  approval: { label:'Requiere aprobación', className:'approval', icon:Clock3 },
  rejected: { label:'Rechazada', className:'blocked', icon:X }
};

function StatusBadge({ status }) {
  const meta = statusMeta[status] || statusMeta.approval;
  const Icon = meta.icon;
  return <span className={`status-badge ${meta.className}`}><Icon size={13}/>{meta.label}</span>;
}

function MetricCard({ icon:Icon, label, value, note, tone='blue', trend }) {
  return <div className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={19}/></div>
    <div className="metric-label">{label}</div>
    <div className="metric-value">{value}</div>
    <div className="metric-foot">{trend && <span className="trend"><ArrowUpRight size={13}/>{trend}</span>}{note}</div>
  </div>;
}

function App() {
  const [page, setPage] = useState('Dashboard');
  const [invoices, setInvoices] = useState([]);
  const [config, setConfig] = useState(null);
  const [rules, setRules] = useState(initialRules);
  const [selectedId, setSelectedId] = useState(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newFile, setNewFile] = useState(null);
  const [audit, setAudit] = useState([]);

  const refresh = () => loadInvoices().then(setInvoices);
  useEffect(() => {
    Promise.all([loadInvoices(), loadRules()])
      .then(([list, loaded]) => { setInvoices(list); setRules(loaded.rules); setConfig(loaded.config); })
      .catch(e => notify(`No se pudo conectar con el backend: ${e.message}`));
  }, []);

  const activeInvoice = invoices.find(i => i.id === selectedId) || invoices[0];
  const currentStatus = i => i.finalStatus || i.decision;
  const addAudit = (title, detail, kind='info') => setAudit(prev => [{ time:new Date().toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit', second:'2-digit'}), title, detail, kind }, ...prev]);
  const notify = message => { setToast(message); window.setTimeout(() => setToast(''), 2800); };

  const counts = useMemo(() => ({
    total: invoices.length,
    pay: invoices.filter(i => currentStatus(i) === 'pay').length,
    blocked: invoices.filter(i => currentStatus(i) === 'blocked').length,
    approval: invoices.filter(i => currentStatus(i) === 'approval').length,
    pendingAmount: invoices.filter(i => currentStatus(i) === 'approval').reduce((sum,i) => sum + i.amount, 0),
    simulatedAmount: invoices.filter(i => currentStatus(i) === 'pay').reduce((sum,i) => sum + i.amount, 0)
  }), [invoices]);

  const visibleInvoices = invoices.filter(i => {
    const match = `${i.id} ${i.vendor} ${i.category}`.toLowerCase().includes(query.toLowerCase());
    const status = currentStatus(i);
    return match && (filter === 'all' || status === filter);
  });

  async function rerunAgent() {
    await refresh().catch(e => notify(e.message));
    addAudit('Decisiones recargadas', 'Se cargó el estado actual desde el backend.', 'info');
    notify('Decisiones recargadas');
  }
  async function takeAction(invoice, action) {
    const comment = window.prompt(`Comentario para ${action === 'rejected' ? 'rechazar' : 'aprobar'} ${invoice.id} (obligatorio):`);
    if (!comment?.trim()) return;
    try {
      const updated = await resolveApproval(invoice.decisionId, action === 'rejected' ? 'REJECT' : 'APPROVE', 'Nico Ledezma', comment);
      setInvoices(prev => prev.map(i => i.decisionId === updated.decisionId ? updated : i));
      addAudit(`${updated.decision === 'pay' ? 'Aprobada' : 'Resuelta'} · ${invoice.id}`, `${updated.vendor} · ${money(updated.amount)}. ${updated.reason}`, updated.decision === 'pay' ? 'success' : 'danger');
      notify('Resolución registrada (sin mover dinero real)');
    } catch (e) { notify(`Error: ${e.message}`); }
  }
  async function saveRules() {
    try {
      const saved = await saveRulesApi(rules, config);
      setRules(saved.rules); setConfig(saved.config);
      addAudit('Reglas actualizadas', 'Se guardó una nueva versión de reglas en el backend.', 'info');
      notify('Reglas guardadas. Las nuevas facturas usarán esta versión.');
      setPage('Reglas');
    } catch (e) { notify(`Error: ${e.message}`); }
  }
  async function createInvoice(e) {
    e.preventDefault();
    if (!newFile) return;
    try {
      const invoice = await uploadInvoice(newFile);
      await refresh();
      setSelectedId(invoice.id);
      addAudit(`Nueva factura recibida · ${invoice.id}`, `${invoice.vendor} · ${money(invoice.amount)}. Evaluada con las reglas activas.`, 'info');
      setShowAdd(false); setNewFile(null);
      setPage('Facturas');
      notify('Factura evaluada');
    } catch (err) { notify(`Error: ${err.message}`); }
  }

  const navItems = [
    { name:'Dashboard', icon:LayoutDashboard },
    { name:'Facturas', icon:FileText },
    { name:'Aprobaciones', icon:FileCheck2, count:counts.approval },
    { name:'Reglas', icon:SlidersHorizontal },
    { name:'Auditoría', icon:History }
  ];

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'mobile-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span/></div><span>Triple<span className="brand-light">Firma</span></span><button className="icon-button sidebar-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace"><div className="workspace-logo"><Building2 size={16}/></div><div><strong>Acme Corporation</strong><small>Workspace de prueba</small></div><ChevronDown size={15} className="muted"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>{navItems.map(item => <button key={item.name} onClick={()=>{setPage(item.name);setMobileNav(false)}} className={`nav-item ${page===item.name?'active':''}`}><item.icon size={18}/><span>{item.name}</span>{item.count>0&&<span className="nav-count">{item.count}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="agent-status"><span className="pulse-dot"/><div><strong>Agente operativo</strong><small>Modo de simulación</small></div><span className="status-live">LIVE</span></div>
        <button className="nav-item" onClick={()=>notify('La configuración de cuenta estará disponible en una siguiente versión.')}><Settings2 size={18}/><span>Configuración</span></button>
        <div className="user-profile"><div className="avatar">NL</div><div><strong>Nico Ledezma</strong><small>Administrador</small></div><MoreHorizontal size={18} className="muted"/></div>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={()=>setMobileNav(!mobileNav)}><Menu size={20}/></button>
        <div className="breadcrumbs"><span>Workspace</span><span className="crumb-sep">/</span><strong>{page}</strong></div>
        <div className="top-actions"><span className="demo-pill"><span/>DEMO · DATOS FICTICIOS</span><button className="icon-button notification" onClick={()=>notify('No tienes notificaciones nuevas')}><Bell size={18}/><i/></button><div className="top-avatar">NL</div></div>
      </header>

      <div className="content">
        {page === 'Dashboard' && <Dashboard invoices={invoices} counts={counts} currentStatus={currentStatus} setPage={setPage} setSelectedId={setSelectedId} audit={audit} rerunAgent={rerunAgent} />}
        {page === 'Facturas' && <Invoices invoices={visibleInvoices} allCount={invoices.length} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} currentStatus={currentStatus} selectedId={selectedId} setSelectedId={setSelectedId} onAdd={()=>setShowAdd(true)} />}
        {page === 'Aprobaciones' && <Approvals invoices={invoices.filter(i=>currentStatus(i)==='approval')} setSelectedId={setSelectedId} setPage={setPage} takeAction={takeAction} />}
        {page === 'Reglas' && <Rules rules={rules} setRules={setRules} saveRules={saveRules} rerunAgent={rerunAgent} />}
        {page === 'Auditoría' && <Audit audit={audit} />}
      </div>
      <footer className="footer"><span><ShieldCheck size={14}/> Cada decisión es explicable, auditable y transparente.</span><span>Triple Firma <b>·</b> PROTOTIPO DE HACKATHON</span></footer>
    </main>

    {activeInvoice && <InvoiceDrawer invoice={activeInvoice} status={currentStatus(activeInvoice)} onClose={()=>setSelectedId(null)} onAction={takeAction} open={page==='Facturas' && Boolean(selectedId)} />}
    {showAdd && <div className="modal-backdrop" onClick={()=>setShowAdd(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={createInvoice}><div className="modal-head"><div><span className="eyebrow">SIMULACIÓN</span><h2>Agregar factura</h2></div><button type="button" className="icon-button" onClick={()=>setShowAdd(false)}><X size={18}/></button></div><p className="muted-copy">Sube un PDF, imagen, email o chat. El backend lo lee y aplica las reglas.</p><label>Archivo<input type="file" accept=".pdf,.png,.jpg,.jpeg,.eml,.txt" onChange={e=>setNewFile(e.target.files[0])} required/></label><div className="modal-actions"><button type="button" className="button secondary" onClick={()=>setShowAdd(false)}>Cancelar</button><button type="submit" className="button primary"><Plus size={16}/> Evaluar factura</button></div></form></div>}
    {toast && <div className="toast"><CheckCircle2 size={17}/>{toast}</div>}
  </div>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title-row"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Dashboard({ invoices, counts, currentStatus, setPage, setSelectedId, audit, rerunAgent }) {
  const latest = invoices.slice(0,5);
  const bars = [38,52,44,66,48,74,59,86,63,78,55,95];
  return <>
    <PageTitle eyebrow="VIERNES, 16 DE OCTUBRE DE 2026" title={<>Buenas Noches, Nico <span className="wave">✦</span></>} description="Este es el resumen de las decisiones de pago de tu empresa." action={<button className="button secondary" onClick={rerunAgent}><RefreshCw size={15}/> Ejecutar agente</button>}/>
    <div className="banner"><div className="banner-icon"><Sparkles size={21}/></div><div className="banner-copy"><strong>Tu agente está protegiendo las operaciones</strong><span>Las facturas se analizan según las reglas configuradas antes de registrar una decisión.</span></div><div className="banner-right"><span className="pulse-dot"/> Sistema activo</div></div>
    <div className="section-heading"><div><h2>Resumen de operaciones</h2><p>Vista general de tu espacio de trabajo</p></div><span className="period"><CalendarDays size={14}/> Este período <ChevronDown size={14}/></span></div>
    <div className="metrics-grid">
      <MetricCard icon={FileText} label="Facturas procesadas" value={counts.total} note="en el conjunto de demo" tone="blue"/>
      <MetricCard icon={CircleDollarSign} label="Pagos simulados" value={money(counts.simulatedAmount)} note={`${counts.pay} facturas elegibles`} tone="green"/>
      <MetricCard icon={Clock3} label="Pendientes de aprobación" value={counts.approval} note={money(counts.pendingAmount)+' por revisar'} tone="amber"/>
      <MetricCard icon={ShieldAlert} label="Facturas bloqueadas" value={counts.blocked} note="Reglas incumplidas" tone="red"/>
    </div>
    <div className="dashboard-grid">
      <section className="panel activity-panel"><div className="panel-head"><div><h3>Actividad de facturas</h3><p>Vista de las operaciones recientes</p></div><button className="text-button" onClick={()=>setPage('Facturas')}>Ver todas <ArrowUpRight size={14}/></button></div><div className="table-wrap"><table><thead><tr><th>Proveedor</th><th>Importe</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead><tbody>{latest.map(i=><tr key={i.id} onClick={()=>{setSelectedId(i.id);setPage('Facturas')}} className="clickable-row"><td><div className="vendor-cell"><div className="vendor-logo">{i.initials}</div><div><strong>{i.vendor}</strong><small>{i.id}</small></div></div></td><td className="amount-cell">{money(i.amount)}</td><td className="date-cell">{i.due.slice(5).replace('-','/')}</td><td><StatusBadge status={currentStatus(i)}/></td><td><MoreHorizontal size={17} className="muted"/></td></tr>)}</tbody></table></div></section>
      <section className="panel spend-panel"><div className="panel-head"><div><h3>Volumen analizado</h3><p>Actividad de ejemplo</p></div><button className="icon-button"><MoreHorizontal size={18}/></button></div><div className="spend-total">{money(invoices.reduce((sum,i)=>sum+i.amount,0))}</div><div className="spend-sub"><span className="trend"><ArrowUpRight size={14}/> Datos simulados</span><span>últimas 12 muestras</span></div><div className="bar-chart">{bars.map((height,i)=><div key={i} className={`bar ${i===11?'highlight':''}`} style={{height:`${height}%`}} title={`Muestra ${i+1}`}/>)}</div><div className="chart-labels"><span>Inicio</span><span>Período actual</span></div><div className="chart-divider"/><div className="mini-stat"><span><span className="legend-dot green-dot"/> Elegibles para pago</span><strong>{counts.pay}</strong></div><div className="mini-stat"><span><span className="legend-dot amber-dot"/> Revisión humana</span><strong>{counts.approval}</strong></div><div className="mini-stat"><span><span className="legend-dot red-dot"/> Bloqueadas</span><strong>{counts.blocked}</strong></div></section>
    </div>
    <section className="panel audit-preview"><div className="panel-head"><div><h3>Registro de actividad</h3><p>Últimos eventos del agente</p></div><button className="text-button" onClick={()=>setPage('Auditoría')}>Ver auditoría <ArrowUpRight size={14}/></button></div><div className="audit-list compact">{audit.slice(0,3).map((a,i)=><AuditRow key={i} item={a}/>)}</div></section>
  </>;
}

function Invoices({ invoices, allCount, query, setQuery, filter, setFilter, currentStatus, selectedId, setSelectedId, onAdd }) {
  return <>
    <PageTitle eyebrow="GESTIÓN FINANCIERA" title="Facturas" description="Revisa cada factura y entiende la decisión del agente." action={<button className="button primary" onClick={onAdd}><Plus size={16}/> Nueva factura</button>}/>
    <div className="filter-bar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Buscar proveedor o factura..."/>{query&&<button className="icon-button tiny" onClick={()=>setQuery('')}><X size={14}/></button>}</div><div className="filter-select"><Filter size={15}/><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos los estados</option><option value="pay">Pago simulado</option><option value="approval">Requiere aprobación</option><option value="blocked">Bloqueadas</option><option value="rejected">Rechazadas</option></select><ChevronDown size={14}/></div><span className="results-count">{invoices.length} de {allCount} facturas</span></div>
    <section className="panel invoice-panel"><div className="panel-head"><div><h3>Facturas recibidas</h3><p>Los importes son ficticios y no representan pagos reales.</p></div><span className="table-tag"><span className="pulse-dot"/> Agente activo</span></div><div className="table-wrap"><table className="full-table"><thead><tr><th><input type="checkbox" aria-label="Seleccionar todas" disabled/></th><th>Factura / Proveedor</th><th>Fecha de vencimiento</th><th>Beneficiario</th><th>Importe</th><th>Decisión del agente</th><th></th></tr></thead><tbody>{invoices.map(i=><tr key={i.id} className={`clickable-row ${selectedId===i.id?'selected-row':''}`} onClick={()=>setSelectedId(i.id)}><td><input type="checkbox" aria-label={`Seleccionar ${i.id}`} onClick={e=>e.stopPropagation()} /></td><td><div className="vendor-cell"><div className="vendor-logo">{i.initials}</div><div><strong>{i.vendor}</strong><small>{i.id} · {i.category}</small></div></div></td><td className="date-cell">{i.due}</td><td>{i.beneficiary}</td><td className="amount-cell">{money(i.amount)}</td><td><StatusBadge status={currentStatus(i)}/></td><td><MoreHorizontal size={17} className="muted"/></td></tr>)}</tbody></table>{invoices.length===0&&<div className="empty-state"><FileSearch size={28}/><strong>No encontramos facturas</strong><span>Prueba con otra búsqueda o cambia el filtro.</span></div>}</div><div className="table-footer"><span>Mostrando {invoices.length} resultados</span><span>Datos de demostración <CircleHelp size={13}/></span></div></section>
    <p className="helper-note"><ShieldCheck size={15}/> Las decisiones se basan en reglas locales de demostración. Ningún pago se ejecuta realmente.</p>
  </>;
}

function Approvals({ invoices, setSelectedId, setPage, takeAction }) {
  return <>
    <PageTitle eyebrow="CONTROL HUMANO" title="Aprobaciones" description="Las decisiones que necesitan una persona antes de continuar."/>
    <div className="approval-summary"><div className="approval-summary-icon"><Clock3 size={22}/></div><div><strong>{invoices.length} solicitudes pendientes</strong><span>La aprobación solo registra una decisión en esta demo; no mueve dinero.</span></div><div className="approval-summary-total">{money(invoices.reduce((s,i)=>s+i.amount,0))}<small>Importe bajo revisión</small></div></div>
    {invoices.length===0 ? <div className="panel empty-state large"><CheckCircle2 size={34}/><strong>Todo al día</strong><span>No hay facturas pendientes de aprobación humana.</span><button className="button secondary" onClick={()=>setPage('Facturas')}>Ver facturas</button></div> :
      <div className="approval-list">{invoices.map(i=><article className="panel approval-card" key={i.id}><div className="vendor-logo large-logo">{i.initials}</div><div className="approval-main"><div className="approval-title"><strong>{i.vendor}</strong><span>{i.id}</span></div><p>{i.reason}</p><div className="approval-meta"><span><Wallet size={14}/>{money(i.amount)}</span><span><CalendarDays size={14}/> Vence {i.due}</span></div><button className="text-button" onClick={()=>{setSelectedId(i.id);setPage('Facturas')}}>Ver análisis completo <ArrowUpRight size={14}/></button></div><div className="approval-actions"><button className="button secondary danger-text" onClick={()=>takeAction(i,'rejected')}><X size={15}/> Rechazar</button><button className="button primary" onClick={()=>takeAction(i,'pay')}><Check size={15}/> Aprobar simulación</button></div></article>)}</div>}
  </>;
}

function Rules({ rules, setRules, saveRules, rerunAgent }) {
  const update = (key, value) => setRules(prev=>({...prev,[key]:value}));
  return <>
    <PageTitle eyebrow="POLÍTICAS DE LA EMPRESA" title="Reglas de pago" description="Define los límites que el agente debe respetar al analizar facturas." action={<button className="button primary" onClick={saveRules}><Check size={16}/> Guardar y reevaluar</button>}/>
    <div className="rules-layout"><div className="rules-main">
      <section className="panel rules-card"><div className="rules-card-title"><div className="rule-icon"><Gauge size={18}/></div><div><h3>Límites y presupuesto</h3><p>Controla cuánto puede aprobar el agente.</p></div></div><div className="field-grid"><label>Límite máximo por factura <span>USD</span><div className="input-prefix"><span>$</span><input type="number" min="1" value={rules.maxPerInvoice} onChange={e=>update('maxPerInvoice',Number(e.target.value))}/></div><small>Las facturas que excedan este importe se bloquean.</small></label><label>Presupuesto del período <span>USD</span><div className="input-prefix"><span>$</span><input type="number" min="1" value={rules.monthlyBudget} onChange={e=>update('monthlyBudget',Number(e.target.value))}/></div><small>Presupuesto de referencia para la demo.</small></label><label>Solicitar aprobación por encima de <span>USD</span><div className="input-prefix"><span>$</span><input type="number" min="0" value={rules.requireApprovalAbove} onChange={e=>update('requireApprovalAbove',Number(e.target.value))}/></div><small>Las facturas que superen este umbral requieren revisión.</small></label></div></section>
      <section className="panel rules-card"><div className="rules-card-title"><div className="rule-icon purple"><Users size={18}/></div><div><h3>Beneficiarios permitidos</h3><p>Lista de proveedores que pueden recibir pagos.</p></div></div><label className="full-label">Proveedores permitidos <textarea rows="3" value={rules.allowedVendors} onChange={e=>update('allowedVendors',e.target.value)} placeholder="Proveedor A, Proveedor B, Proveedor C"/><small>Separa los nombres con comas. El nombre del beneficiario debe coincidir.</small></label><div className="vendor-chips">{rules.allowedVendors.split(',').map(v=>v.trim()).filter(Boolean).map(v=><span key={v}><CheckCircle2 size={13}/>{v}</span>)}</div></section>
      <section className="panel rules-card"><div className="rules-card-title"><div className="rule-icon amber"><ShieldCheck size={18}/></div><div><h3>Protecciones del agente</h3><p>Reglas de seguridad para evaluar las facturas.</p></div></div><ToggleRow title="Bloquear facturas duplicadas" description="Detiene facturas que coinciden con un registro duplicado de la demo." checked={rules.blockDuplicates} onChange={v=>update('blockDuplicates',v)}/><div className="settings-divider"/><ToggleRow title="Bloquear beneficiarios desconocidos" description="No permite pagos a proveedores que no estén en la lista." checked={rules.blockUnknownVendors} onChange={v=>update('blockUnknownVendors',v)}/></section>
    </div><aside className="rules-aside"><div className="panel rules-preview"><div className="preview-head"><Sparkles size={17}/><strong>Vista previa de reglas</strong></div><p>El agente usará estas condiciones en la siguiente evaluación.</p><div className="preview-rule"><span>Límite por factura</span><strong>{money(rules.maxPerInvoice)}</strong></div><div className="preview-rule"><span>Aprobación humana</span><strong>{money(rules.requireApprovalAbove)}</strong></div><div className="preview-rule"><span>Proveedores permitidos</span><strong>{rules.allowedVendors.split(',').filter(v=>v.trim()).length}</strong></div><div className="preview-rule"><span>Duplicados</span><StatusBadge status={rules.blockDuplicates?'blocked':'pay'}/></div><div className="preview-rule"><span>Proveedor desconocido</span><StatusBadge status={rules.blockUnknownVendors?'blocked':'pay'}/></div><div className="preview-callout"><LockKeyhole size={16}/><span>El agente no puede saltarse una regla sin intervención humana.</span></div><button className="button primary full-width" onClick={saveRules}>Guardar reglas <ArrowUpRight size={15}/></button><button className="button secondary full-width" onClick={rerunAgent}><RefreshCw size={15}/> Reevaluar facturas</button></div></aside></div>
  </>;
}

function ToggleRow({ title, description, checked, onChange }) {
  return <div className="toggle-row"><div><strong>{title}</strong><p>{description}</p></div><button className={`toggle ${checked?'on':''}`} role="switch" aria-checked={checked} onClick={()=>onChange(!checked)}><span/></button></div>;
}

function Audit({ audit }) {
  return <>
    <PageTitle eyebrow="TRAZABILIDAD" title="Registro de auditoría" description="Consulta qué ocurrió, cuándo y por qué. Las acciones se registran localmente en esta demo."/>
    <div className="audit-stats"><div className="panel audit-stat"><Activity size={19}/><span>Eventos registrados</span><strong>{audit.length}</strong></div><div className="panel audit-stat"><ShieldCheck size={19}/><span>Historial disponible</span><strong>Local</strong></div><div className="panel audit-stat"><LockKeyhole size={19}/><span>Modo de ejecución</span><strong>Simulado</strong></div></div>
    <section className="panel audit-full"><div className="panel-head"><div><h3>Todos los eventos</h3><p>Registro cronológico, del más reciente al más antiguo</p></div><span className="table-tag">{audit.length} eventos</span></div><div className="audit-list">{audit.map((item,i)=><AuditRow key={i} item={item}/>)}</div></section>
    <div className="helper-note"><CircleHelp size={15}/> Para producción, este registro debe persistirse y validarse en el backend; el historial actual se pierde al recargar la página.</div>
  </>;
}

function AuditRow({ item }) {
  const Icon = item.kind==='success'?CheckCircle2:item.kind==='warning'?AlertTriangle:item.kind==='danger'?Ban:Activity;
  return <div className="audit-row"><div className={`audit-icon ${item.kind}`}><Icon size={16}/></div><div className="audit-event"><strong>{item.title}</strong><p>{item.detail}</p></div><time>{item.time}</time></div>;
}

function InvoiceDrawer({ invoice, status, onClose, onAction, open }) {
  if (!invoice || !open) return null;
  const current = invoice;
  return <div className="drawer-backdrop" onClick={onClose}><aside className="invoice-drawer" onClick={e=>e.stopPropagation()}><div className="drawer-head"><div><span className="eyebrow">DETALLE DE FACTURA</span><h2>{current.id}</h2></div><button className="icon-button" onClick={onClose}><X size={18}/></button></div><div className="drawer-vendor"><div className="vendor-logo large-logo">{current.initials}</div><div><h3>{current.vendor}</h3><span>{current.category}</span></div></div><div className="drawer-amount"><span>Importe solicitado</span><strong>{money(current.amount)}</strong><span>Vencimiento: {current.due}</span></div><div className="drawer-status"><span>Decisión actual</span><StatusBadge status={status}/></div><section className="decision-explanation"><div className="decision-heading"><div className="decision-spark"><BrainCircuit size={17}/></div><div><strong>Explicación del agente</strong><span>Análisis basado en reglas</span></div></div><p>{current.reason}</p>{current.reasons?.length>0&&<ul>{current.reasons.map((r,i)=><li key={i}>{r}</li>)}</ul>}</section><section className="checks-section"><h4>Validaciones de reglas</h4>{current.checks.map((c,i)=><div className="check-row" key={i}><span className={`check-icon ${c.status}`}>{c.status==='pass'?<Check size={13}/>:c.status==='fail'?<X size={13}/>:<Clock3 size={13}/>}</span><div><strong>{c.label}</strong><small>{c.detail}</small></div><span className={`check-status ${c.status}`}>{c.status==='pass'?'Cumple':c.status==='fail'?'Incumple':'Revisar'}</span></div>)}</section><div className="drawer-audit-note"><History size={15}/><span>La decisión y las acciones se registran en el historial de auditoría.</span></div><div className="drawer-actions">{status==='approval'&&<><button className="button secondary danger-text" onClick={()=>onAction(current,'rejected')}><X size={15}/> Rechazar</button><button className="button primary" onClick={()=>onAction(current,'pay')}><Check size={15}/> Aprobar simulación</button></>}{status==='blocked'&&<div className="blocked-note"><ShieldAlert size={16}/> Bloqueada por una regla. Ajusta las reglas o los datos y vuelve a evaluar.</div>}{status==='rejected'&&<div className="blocked-note">Esta factura fue rechazada manualmente.</div>}</div></aside></div>;
}

export default App;
