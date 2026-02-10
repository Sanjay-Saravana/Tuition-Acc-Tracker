(function(){
  const STORAGE_KEY = 'tuition_accounts_v2';
  const THEME_KEY = 'tuition_theme';
  const SUPABASE_URL_KEY = 'tuition_supabase_url';
  const SUPABASE_ANON_KEY = 'tuition_supabase_anon_key';

  const byId = (id)=>document.getElementById(id);
  const fmtCurrency = (n)=>`₹${(n||0).toLocaleString('en-IN')}`;
  const genderEmoji = (g)=> g === 'female' ? '👧' : '👦';
  const genId = ()=> Math.random().toString(36).slice(2,9);

  let state = { globalRate:0, students:[], sessions:[], payments:[], meta:{updatedAt:new Date().toISOString()} };
  let supabase = null;
  let monthlyChart = null;
  let studentHoursChart = null;

  function hasData(s){ return (s.students?.length||0)+(s.sessions?.length||0)+(s.payments?.length||0) > 0; }
  function load(){ try{ const v = localStorage.getItem(STORAGE_KEY); if(v) state = JSON.parse(v); }catch(e){console.error(e);} }
  function normalizeState(){
    state = state || {};
    state.globalRate = Number(state.globalRate||0);
    state.students = (state.students||[]).map(s=>({id:s.id,name:s.name||'',gender:s.gender||'male',color:s.color||'#5b8def',notes:s.notes||''}));
    state.sessions = (state.sessions||[]).map(s=>({id:s.id,date:s.date,bikeFare:Number(s.bikeFare||0),notes:s.notes||'',rows:(s.rows||[]).map(r=>({studentId:r.studentId,duration:Number(r.duration||0),rate:Number(r.rate||state.globalRate||0)}))}));
    state.payments = (state.payments||[]).map(p=>({id:p.id,date:p.date,amount:Number(p.amount||0),notes:p.notes||''}));
    state.meta = state.meta || {updatedAt:new Date().toISOString()};
  }
  function save(){
    state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshAll();
    syncCloudState();
  }

  function setTheme(theme){ document.documentElement.setAttribute('data-theme', theme); localStorage.setItem(THEME_KEY, theme); byId('themeToggle').textContent = theme==='dark'?'🌙':'☀️'; }
  function initTheme(){ setTheme(localStorage.getItem(THEME_KEY) || 'dark'); }

  function parseDateAtLocalStart(value){
    if(!value) return null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)){ const [y,m,d] = value.split('-').map(Number); return new Date(y,m-1,d); }
    const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  function parseDateAtLocalEnd(value){ const dt = parseDateAtLocalStart(value); if(!dt) return null; dt.setHours(23,59,59,999); return dt; }
  function inRange(date, start, end){ const d=parseDateAtLocalStart(date), s=parseDateAtLocalStart(start), e=parseDateAtLocalEnd(end); return !!d && (!s||d>=s) && (!e||d<=e); }
  function dateStr(d){ const dt=parseDateAtLocalStart(d); return dt ? dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : 'Invalid Date'; }
  function monthKey(d){ const dt=parseDateAtLocalStart(d); return dt ? `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}` : ''; }

  function initTabs(){ document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.tab').forEach(b=>{b.classList.remove('active'); b.setAttribute('aria-selected','false');}); document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); btn.setAttribute('aria-selected','true'); byId(btn.dataset.tab).classList.add('active'); })); }

  function renderEmptyState(container, message){ container.innerHTML = `<div class="empty-state">${message}</div>`; }

  function calcSessionTotals(sess){ let fee=0,hours=0; (sess.rows||[]).forEach(r=>{ fee += Number(r.duration||0) * Number(r.rate||0); hours += Number(r.duration||0); }); return {fee,hours,total:fee+Number(sess.bikeFare||0)}; }
  function calcTotals(month){ let totalHours=0, tuitionFees=0, taxi=0; state.sessions.filter(s=>!month||monthKey(s.date)===month).forEach(s=>{const t=calcSessionTotals(s); totalHours+=t.hours; tuitionFees+=t.fee; taxi+=Number(s.bikeFare||0);}); let collected=0; state.payments.filter(p=>!month||monthKey(p.date)===month).forEach(p=>collected+=p.amount||0); return {totalHours,tuitionFees,taxi,collected,balance:tuitionFees-collected}; }
  function calcTotalsRange(start,end){ let totalHours=0, tuitionFees=0, taxi=0; state.sessions.filter(s=>inRange(s.date,start,end)).forEach(s=>{const t=calcSessionTotals(s); totalHours+=t.hours; tuitionFees+=t.fee; taxi+=Number(s.bikeFare||0);}); let collected=0; state.payments.filter(p=>inRange(p.date,start,end)).forEach(p=>collected+=p.amount||0); return {totalHours,tuitionFees,taxi,collected,balance:tuitionFees-collected}; }
  function calcStudentBalance(studentId){ let fees=0,hours=0; state.sessions.forEach(s=>s.rows.forEach(r=>{ if(r.studentId===studentId){ fees += r.duration*r.rate; hours += r.duration; }})); return {fees,hours,balance:fees}; }

  function renderGlobalRate(){ byId('globalRateDisplay').textContent = `${fmtCurrency(state.globalRate)}/hr`; }
  function openGlobalRateDialog(){ const form=byId('globalRateForm'); form.reset(); form.hourlyRate.value = Number(state.globalRate||0); byId('globalRateDialog').showModal(); }

  function renderStudents(){
    const list = byId('studentsList'); list.innerHTML='';
    if(!state.students.length) return renderEmptyState(list,'No students yet. Add your first student.');
    state.students.forEach(st=>{
      const dues = calcStudentBalance(st.id);
      const el = document.createElement('div');
      el.className='list-item';
      el.innerHTML = `<div><div class="li-title">${genderEmoji(st.gender)} ${st.name}</div><div class="li-sub"><span class="chip"><span class="swatch" style="background:${st.color}"></span>Tag</span> · Balance: ${fmtCurrency(dues.balance)}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`;
      el.querySelector('[data-act="edit"]').onclick = ()=>openStudentDialog(st);
      el.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete student? Related session rows will be removed.')){ state.students = state.students.filter(s=>s.id!==st.id); state.sessions = state.sessions.map(sess=>({...sess,rows:sess.rows.filter(r=>r.studentId!==st.id)})).filter(sess=>sess.rows.length); save(); } };
      list.appendChild(el);
    });
  }
  function openStudentDialog(st){ const form=byId('studentForm'); form.reset(); byId('studentDialogTitle').textContent = st ? 'Edit Student' : 'Add Student'; form.id.value=st?.id||''; form.name.value=st?.name||''; form.gender.value=st?.gender||'male'; form.color.value=st?.color||'#5b8def'; form.notes.value=st?.notes||''; byId('studentDialog').showModal(); }

  function msRowTemplate(){
    const opts = state.students.map(s=>`<option value="${s.id}">${genderEmoji(s.gender)} ${s.name}</option>`).join('');
    return `<div class="ms-row"><select name="studentId">${opts}</select><input name="duration" type="number" min="0" step="any" placeholder="hours" /><button type="button" class="icon-btn" data-act="remove">✖️</button></div>`;
  }
  function bindMsRows(parent){ parent.querySelectorAll('[data-act="remove"]').forEach(btn=>btn.onclick=()=>btn.closest('.ms-row').remove()); }
  function openSessionDialog(sess){
    if(!state.students.length) return alert('Add a student first.');
    const form=byId('sessionForm'); form.reset(); byId('sessionDialogTitle').textContent = sess ? 'Edit Session' : 'Add Session'; form.id.value=sess?.id||''; form.date.value=sess?.date||new Date().toISOString().slice(0,10); form.bikeFare.value=sess?.bikeFare??0; form.notes.value=sess?.notes||'';
    const rows=byId('msRows'); rows.innerHTML='';
    const rowData = sess?.rows?.length ? sess.rows : [{studentId:state.students[0].id,duration:1}];
    rowData.forEach((r)=>{ rows.insertAdjacentHTML('beforeend', msRowTemplate()); const row = rows.lastElementChild; row.querySelector('select[name="studentId"]').value=r.studentId; row.querySelector('input[name="duration"]').value=r.duration; });
    bindMsRows(rows); byId('sessionDialog').showModal();
  }
  function renderSessions(){
    const list = byId('sessionsList'); list.innerHTML='';
    const filtered = state.sessions.filter(s=>inRange(s.date,byId('sessionStartFilter').value,byId('sessionEndFilter').value)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(!filtered.length) return renderEmptyState(list,'No sessions in this date range.');
    filtered.forEach(sess=>{
      const parts = sess.rows.map(r=>{ const st=state.students.find(s=>s.id===r.studentId); return `${genderEmoji(st?.gender)} ${st?.name||'Unknown'} (${r.duration} hrs)`; }).join(', ');
      const t=calcSessionTotals(sess);
      const el=document.createElement('div'); el.className='list-item';
      el.innerHTML=`<div><div class="li-title">📅 ${dateStr(sess.date)} — ${parts}</div><div class="li-sub">⏱️ ${t.hours} hrs · 🚕 ${fmtCurrency(sess.bikeFare)} · 💰 ${fmtCurrency(t.total)}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`;
      el.querySelector('[data-act="edit"]').onclick=()=>openSessionDialog(sess);
      el.querySelector('[data-act="delete"]').onclick=()=>{ if(confirm('Delete session?')){ state.sessions = state.sessions.filter(s=>s.id!==sess.id); save(); } };
      list.appendChild(el);
    });
  }

  function openPaymentDialog(pay){ const form=byId('paymentForm'); form.reset(); byId('paymentDialogTitle').textContent = pay ? 'Edit Payment':'Add Payment'; form.id.value=pay?.id||''; form.date.value=pay?.date||new Date().toISOString().slice(0,10); form.amount.value=pay?.amount??''; form.notes.value=pay?.notes||''; byId('paymentDialog').showModal(); }
  function renderPayments(){
    const list=byId('paymentsList'); list.innerHTML='';
    const filtered = state.payments.filter(p=>inRange(p.date,byId('paymentStartFilter').value,byId('paymentEndFilter').value)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(!filtered.length) return renderEmptyState(list,'No payments in this date range.');
    filtered.forEach(pay=>{ const el=document.createElement('div'); el.className='list-item'; el.innerHTML=`<div><div class="li-title">${dateStr(pay.date)} — Payment</div><div class="li-sub">Amount: ${fmtCurrency(pay.amount)} ${pay.notes?`· ${pay.notes}`:''}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`; el.querySelector('[data-act="edit"]').onclick=()=>openPaymentDialog(pay); el.querySelector('[data-act="delete"]').onclick=()=>{ if(confirm('Delete payment?')){ state.payments=state.payments.filter(p=>p.id!==pay.id); save(); } }; list.appendChild(el); });
  }

  function buildTimeBuckets(mode){
    const now = new Date();
    if(mode==='daily'){ return Array.from({length:14},(_,k)=>{ const d=new Date(now); d.setDate(now.getDate()-(13-k)); const s=d.toISOString().slice(0,10); return {label:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}),start:s,end:s}; }); }
    if(mode==='weekly'){
      const arr=[]; let end = new Date(now);
      for(let i=0;i<8;i++){ const start = new Date(end); start.setDate(end.getDate()-6); arr.unshift({label:`${start.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} - ${end.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`,start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)}); end.setDate(end.getDate()-7); }
      return arr;
    }
    if(mode==='yearly'){ return Array.from({length:6},(_,k)=>{ const y = now.getFullYear()-(5-k); return {label:String(y),start:`${y}-01-01`,end:`${y}-12-31`}; }); }
    return Array.from({length:12},(_,k)=>{ const d=new Date(now.getFullYear(), now.getMonth()-(11-k),1); const start=new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10); const end=new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10); return {label:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}),start,end}; });
  }

  function renderDashboard(){
    const t=calcTotals(); byId('kpiHours').textContent=t.totalHours; byId('kpiFees').textContent=fmtCurrency(t.tuitionFees); byId('kpiTaxi').textContent=fmtCurrency(t.taxi); byId('kpiCollected').textContent=fmtCurrency(t.collected); byId('kpiBalance').textContent=fmtCurrency(t.balance);
    const cm = calcTotals(monthKey(new Date().toISOString().slice(0,10))); byId('kpiCurrentMonthAmount').textContent = fmtCurrency(cm.collected);
    const mode = document.querySelector('.chip-btn.active')?.dataset.range || 'monthly';
    const buckets = buildTimeBuckets(mode);
    const labels=buckets.map(b=>b.label), fees=[], taxi=[], collected=[];
    buckets.forEach(b=>{ const x=calcTotalsRange(b.start,b.end); fees.push(x.tuitionFees); taxi.push(x.taxi); collected.push(x.collected); });
    monthlyChart?.destroy();
    monthlyChart = new Chart(byId('monthlyChart'),{type:'bar',data:{labels,datasets:[{label:'Fees',data:fees,backgroundColor:'#6a86ff'},{label:'Taxi',data:taxi,backgroundColor:'#a7b6d4'},{label:'Collected',data:collected,backgroundColor:'#22c55e'}]},options:{responsive:true,maintainAspectRatio:false,animation:false}});
  }

  function renderReports(){
    const start=byId('reportStart').value, end=byId('reportEnd').value;
    const t=calcTotalsRange(start,end);
    byId('reportTotals').innerHTML = `⏱️ Total Hours <b>${t.totalHours}</b><br/>💰 Tuition Fees <b>${fmtCurrency(t.tuitionFees)}</b><br/>🚕 Taxi Fare <b>${fmtCurrency(t.taxi)}</b><br/>💵 Collected <b>${fmtCurrency(t.collected)}</b><br/>📉 Balance <b>${fmtCurrency(t.balance)}</b>`;
    const map = new Map();
    state.sessions.filter(s=>inRange(s.date,start,end)).forEach(s=>s.rows.forEach(r=>map.set(r.studentId,(map.get(r.studentId)||0)+r.duration)));
    const labels=[...map.keys()].map(id=>state.students.find(s=>s.id===id)?.name||'Unknown');
    const data=[...map.values()];
    studentHoursChart?.destroy();
    studentHoursChart = new Chart(byId('studentHoursChart'),{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>`hsl(${(i*49)%360} 72% 58%)`)}]},options:{plugins:{legend:{position:'bottom'}},animation:false}});
  }

  function buildEmoji({start,end}){
    const sessions = state.sessions.filter(s=>inRange(s.date,start,end)).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const lines=['📘 Tuition Summary'];
    let totalHours=0,totalFees=0,totalTaxi=0;
    sessions.forEach(s=>{ const t=calcSessionTotals(s); totalHours+=t.hours; totalFees+=t.fee; totalTaxi+=s.bikeFare||0; const names=s.rows.map(r=>{const st=state.students.find(x=>x.id===r.studentId); return `${genderEmoji(st?.gender)} ${st?.name} (${r.duration}h)`;}).join(' + '); lines.push(`📅 ${dateStr(s.date)}\n${names}\n💰 ${fmtCurrency(t.total)}\n`); });
    lines.push(`⏱️ Total Hours: ${totalHours}`); lines.push(`💰 Tuition Fees: ${fmtCurrency(totalFees)}`); lines.push(`🚕 Taxi: ${fmtCurrency(totalTaxi)}`); lines.push(`💵 Grand Total: ${fmtCurrency(totalFees+totalTaxi)}`);
    return lines.join('\n');
  }

  function csvEscape(v){ if(v==null) return ''; const s=String(v).replaceAll('"','""'); return /[",\n]/.test(s) ? `"${s}"` : s; }
  function download(filename, content, type='text/plain'){ const blob = new Blob([content],{type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }
  function exportCsvStudents(){ const h=['id','name','gender','color','notes']; download('students.csv',h.join(',')+'\n'+state.students.map(s=>h.map(k=>csvEscape(s[k])).join(',')).join('\n'),'text/csv'); }
  function exportCsvSessions(){ const h=['id','date','bikeFare','notes','studentId','duration','rate']; const rows=state.sessions.flatMap(s=>s.rows.map(r=>[s.id,s.date,s.bikeFare,s.notes,r.studentId,r.duration,r.rate].map(csvEscape).join(','))); download('sessions.csv',h.join(',')+'\n'+rows.join('\n'),'text/csv'); }
  function exportCsvPayments(){ const h=['id','date','amount','notes']; download('payments.csv',h.join(',')+'\n'+state.payments.map(p=>h.map(k=>csvEscape(p[k])).join(',')).join('\n'),'text/csv'); }
  function exportBackup(){ download('tuition-backup.json',JSON.stringify(state,null,2),'application/json'); }
  function importBackup(file){ const reader = new FileReader(); reader.onload=()=>{ try{ const parsed=JSON.parse(reader.result); if(parsed?.students&&parsed?.sessions&&parsed?.payments){ state={...state,...parsed}; normalizeState(); save(); alert('Imported successfully'); } else alert('Invalid backup file'); }catch{ alert('Import failed'); } }; reader.readAsText(file); }

  function refreshAll(){ renderGlobalRate(); renderStudents(); renderSessions(); renderPayments(); renderDashboard(); renderReports(); const start=byId('exportStart')?.value; const end=byId('exportEnd')?.value; if(start&&end) byId('emojiOutput').textContent = buildEmoji({start,end}); }

  // Cloud + Auth
  function initSupabaseClient(){
    const url = localStorage.getItem(SUPABASE_URL_KEY);
    const anon = localStorage.getItem(SUPABASE_ANON_KEY);
    if(url && anon && window.supabase?.createClient){
      supabase = window.supabase.createClient(url, anon);
      supabase.auth.onAuthStateChange(()=>{ updateAuthUi(); syncCloudState(true); });
    }
  }
  async function getUser(){ if(!supabase) return null; const {data} = await supabase.auth.getUser(); return data?.user || null; }
  async function updateAuthUi(){
    const status = byId('authStatus'); const btn = byId('authButton');
    if(!supabase){ status.textContent='Cloud not configured • data stays only on this device.'; btn.textContent='Sign In'; return; }
    const user = await getUser();
    if(user){ status.textContent=`Signed in as ${user.email} • data sync enabled.`; btn.textContent='Sign Out'; }
    else { status.textContent='Signed out • data saved only on this device.'; btn.textContent='Sign In'; }
  }
  async function syncCloudState(force=false){
    if(!supabase) return;
    const user = await getUser();
    if(!user) return;
    const {data:row,error} = await supabase.from('tuition_profiles').select('payload,updated_at').eq('user_id', user.id).maybeSingle();
    if(error) return console.error(error.message);
    if(!row?.payload){
      if(hasData(state)){
        await supabase.from('tuition_profiles').upsert({user_id:user.id,payload:state,updated_at:state.meta.updatedAt});
      }
      return;
    }
    const localTs = new Date(state.meta?.updatedAt||0).getTime();
    const cloudTs = new Date(row.updated_at||0).getTime();
    if(force || !hasData(state) || cloudTs >= localTs){
      state = row.payload;
      normalizeState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      refreshAll();
    }else{
      await supabase.from('tuition_profiles').upsert({user_id:user.id,payload:state,updated_at:state.meta.updatedAt});
    }
  }

  function initCloudSettings(){
    byId('openCloudSettings').addEventListener('click',()=>{ const f=byId('cloudSettingsForm'); f.url.value=localStorage.getItem(SUPABASE_URL_KEY)||''; f.anonKey.value=localStorage.getItem(SUPABASE_ANON_KEY)||''; byId('cloudSettingsDialog').showModal(); });
    byId('cloudSettingsForm').addEventListener('submit',(e)=>{ e.preventDefault(); const f=e.target; localStorage.setItem(SUPABASE_URL_KEY,f.url.value.trim()); localStorage.setItem(SUPABASE_ANON_KEY,f.anonKey.value.trim()); byId('cloudSettingsDialog').close(); initSupabaseClient(); updateAuthUi(); alert('Cloud settings saved.'); });
  }
  function initAuth(){
    byId('authButton').addEventListener('click', async ()=>{
      if(!supabase) return byId('cloudSettingsDialog').showModal();
      const user = await getUser();
      if(user){ await supabase.auth.signOut(); updateAuthUi(); return; }
      byId('authDialog').showModal();
    });
    byId('authForm').addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!supabase) return;
      const f=e.target; const email=f.email.value.trim(); const password=f.password.value.trim();
      const res = await supabase.auth.signInWithPassword({email,password});
      if(res.error){
        const signUp = await supabase.auth.signUp({email,password});
        if(signUp.error){ alert(signUp.error.message); return; }
        alert('Account created. Check email if confirmation is enabled.');
      }
      byId('authDialog').close();
      await updateAuthUi();
      await syncCloudState(true);
    });
  }

  function initForms(){
    byId('studentForm').addEventListener('submit',(e)=>{ e.preventDefault(); const d=Object.fromEntries(new FormData(e.target).entries()); const payload={id:d.id||genId(),name:d.name.trim(),gender:d.gender,color:d.color,notes:d.notes||''}; const idx=state.students.findIndex(s=>s.id===payload.id); if(idx>=0) state.students[idx]=payload; else state.students.push(payload); save(); byId('studentDialog').close(); });
    byId('globalRateForm').addEventListener('submit',(e)=>{ e.preventDefault(); state.globalRate = Number(e.target.hourlyRate.value||0); save(); byId('globalRateDialog').close(); });
    byId('sessionForm').addEventListener('submit',(e)=>{ e.preventDefault(); const f=e.target; const rows=[...f.querySelectorAll('.ms-row')].map(row=>({studentId:row.querySelector('select[name="studentId"]').value,duration:Number(row.querySelector('input[name="duration"]').value||0),rate:Number(state.globalRate||0)})).filter(r=>r.studentId&&r.duration>0); if(!rows.length) return alert('Add at least one student and duration.'); const payload={id:f.id.value||genId(),date:f.date.value,bikeFare:Number(f.bikeFare.value||0),notes:f.notes.value||'',rows}; const idx=state.sessions.findIndex(s=>s.id===payload.id); if(idx>=0) state.sessions[idx]=payload; else state.sessions.push(payload); save(); byId('sessionDialog').close(); });
    byId('paymentForm').addEventListener('submit',(e)=>{ e.preventDefault(); const d=Object.fromEntries(new FormData(e.target).entries()); const payload={id:d.id||genId(),date:d.date,amount:Number(d.amount||0),notes:d.notes||''}; const idx=state.payments.findIndex(p=>p.id===payload.id); if(idx>=0) state.payments[idx]=payload; else state.payments.push(payload); save(); byId('paymentDialog').close(); });
    byId('addStudentBtn').onclick=()=>openStudentDialog(); byId('editGlobalRateBtn').onclick=openGlobalRateDialog; byId('addSessionBtn').onclick=()=>openSessionDialog(); byId('addPaymentBtn').onclick=()=>openPaymentDialog(); byId('addMsRow').onclick=()=>{ const rows=byId('msRows'); rows.insertAdjacentHTML('beforeend',msRowTemplate()); bindMsRows(rows); };
  }

  function initExports(){
    const d = new Date(); const start = new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10); const end=d.toISOString().slice(0,10);
    byId('exportStart').value=start; byId('exportEnd').value=end;
    const update=()=>byId('emojiOutput').textContent = buildEmoji({start:byId('exportStart').value,end:byId('exportEnd').value});
    byId('exportStart').addEventListener('change',update); byId('exportEnd').addEventListener('change',update); byId('copyEmoji').onclick=async()=>{ try{ await navigator.clipboard.writeText(byId('emojiOutput').textContent); alert('Copied'); }catch{ alert('Copy failed'); } };
    byId('exportStudentsCsv').onclick=exportCsvStudents; byId('exportSessionsCsv').onclick=exportCsvSessions; byId('exportPaymentsCsv').onclick=exportCsvPayments; byId('exportBackup').onclick=exportBackup; byId('importBackup').onclick=()=>{ const f=byId('importBackupFile').files[0]; if(!f) return alert('Choose backup file'); importBackup(f); };
    update();
  }

  function init(){
    initTheme(); load(); normalizeState(); initTabs(); initForms(); initExports(); initCloudSettings(); initSupabaseClient(); initAuth();
    byId('themeToggle').onclick=()=>{ const cur=document.documentElement.getAttribute('data-theme')||'dark'; setTheme(cur==='dark'?'light':'dark'); refreshAll(); };
    const today = new Date().toISOString().slice(0,10); const monthStart = new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
    ['sessionStartFilter','paymentStartFilter','reportStart'].forEach(id=>byId(id).value=monthStart); ['sessionEndFilter','paymentEndFilter','reportEnd'].forEach(id=>byId(id).value=today);
    ['sessionStartFilter','sessionEndFilter'].forEach(id=>byId(id).addEventListener('change',renderSessions)); ['paymentStartFilter','paymentEndFilter'].forEach(id=>byId(id).addEventListener('change',renderPayments)); byId('refreshReport').onclick=renderReports;
    document.querySelectorAll('.chip-btn').forEach(btn=>btn.addEventListener('click',()=>{ document.querySelectorAll('.chip-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderDashboard(); }));
    updateAuthUi(); refreshAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
