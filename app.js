(function(){
  const STORAGE_KEY = 'tuition_accounts_v3';
  const LEGACY_STORAGE_KEYS = ['tuition_accounts_v2', 'tuition_accounts_v1'];
  const THEME_KEY = 'tuition_theme';
  const SUPABASE_URL_KEY = 'tuition_supabase_url';
  const SUPABASE_ANON_KEY = 'tuition_supabase_anon_key';

  const byId = (id)=>document.getElementById(id);
  const fmtCurrency = (n)=>`₹${Number(n||0).toLocaleString('en-IN')}`;
  const genderEmoji = (g)=> g === 'female' ? '👧' : '👦';
  const genId = ()=> Math.random().toString(36).slice(2,9);

  let state = defaultState();
  let supabase = null;
  let syncInFlight = false;
  let monthlyChart = null;
  let studentHoursChart = null;

  function defaultState(){
    return { globalRate:0, students:[], sessions:[], payments:[], meta:{updatedAt:new Date(0).toISOString()} };
  }

  function hasData(s){
    return (s.students?.length || 0) + (s.sessions?.length || 0) + (s.payments?.length || 0) > 0;
  }

  function mergeUniqueById(localItems, cloudItems){
    const map = new Map();
    (cloudItems || []).forEach(item=>{ if(item?.id) map.set(item.id, item); });
    (localItems || []).forEach(item=>{ if(item?.id) map.set(item.id, item); });
    return [...map.values()];
  }

  function mergeStates(localState, cloudState){
    const merged = {
      globalRate: Number(localState.globalRate || cloudState.globalRate || 0),
      students: mergeUniqueById(localState.students, cloudState.students),
      sessions: mergeUniqueById(localState.sessions, cloudState.sessions),
      payments: mergeUniqueById(localState.payments, cloudState.payments),
      meta: {
        updatedAt: new Date().toISOString()
      }
    };
    return merged;
  }

  function parseJSON(raw){
    try { return JSON.parse(raw); } catch { return null; }
  }

  function migrateLegacyIfNeeded(){
    const current = localStorage.getItem(STORAGE_KEY);
    if(current) return;

    for(const key of LEGACY_STORAGE_KEYS){
      const raw = localStorage.getItem(key);
      if(!raw) continue;
      const parsed = parseJSON(raw);
      if(parsed && (Array.isArray(parsed.students) || Array.isArray(parsed.sessions) || Array.isArray(parsed.payments))){
        state = parsed;
        normalizeState();
        if(!state.meta?.updatedAt || state.meta.updatedAt === new Date(0).toISOString()){
          state.meta = { updatedAt: new Date().toISOString() };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        return;
      }
    }
  }

  function load(){
    migrateLegacyIfNeeded();
    const saved = parseJSON(localStorage.getItem(STORAGE_KEY) || 'null');
    if(saved) state = saved;
    normalizeState();
  }

  function save({skipSync=false}={}){
    state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshAll();
    if(!skipSync) syncCloudState();
  }

  function normalizeState(){
    state = state || {};
    state.globalRate = Number(state.globalRate || 0);
    state.students = (state.students || []).map(s=>({
      id: s.id || genId(),
      name: (s.name || '').trim(),
      gender: s.gender === 'female' ? 'female' : 'male',
      color: s.color || '#4f7cff',
      notes: s.notes || ''
    })).filter(s=>s.name);

    const studentIds = new Set(state.students.map(s=>s.id));
    state.sessions = (state.sessions || []).map(sess=>({
      id: sess.id || genId(),
      date: sess.date,
      bikeFare: Number(sess.bikeFare || 0),
      notes: sess.notes || '',
      rows: (sess.rows || []).map(r=>({
        studentId: r.studentId,
        duration: Number(r.duration || 0),
        rate: Number(r.rate || state.globalRate || 0)
      })).filter(r=>studentIds.has(r.studentId) && r.duration > 0)
    })).filter(s=>s.date && s.rows.length > 0);

    state.payments = (state.payments || []).map(p=>({
      id: p.id || genId(),
      date: p.date,
      amount: Number(p.amount || 0),
      notes: p.notes || ''
    })).filter(p=>p.date);

    if(!state.meta || !state.meta.updatedAt){
      state.meta = { updatedAt: new Date(0).toISOString() };
    }
  }

  function setTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    byId('themeToggle').textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  function initTheme(){
    setTheme(localStorage.getItem(THEME_KEY) || 'dark');
  }

  function parseDateAtLocalStart(value){
    if(!value) return null;
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)){
      const [y,m,d] = value.split('-').map(Number);
      return new Date(y, m - 1, d, 0,0,0,0);
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function parseDateAtLocalEnd(value){
    const dt = parseDateAtLocalStart(value);
    if(!dt) return null;
    dt.setHours(23,59,59,999);
    return dt;
  }

  function inRange(date, start, end){
    const d = parseDateAtLocalStart(date);
    const s = parseDateAtLocalStart(start);
    const e = parseDateAtLocalEnd(end);
    if(!d) return false;
    return (!s || d >= s) && (!e || d <= e);
  }

  function dateStr(d){
    const dt = parseDateAtLocalStart(d);
    if(!dt) return 'Invalid Date';
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function monthKey(d){
    const dt = parseDateAtLocalStart(d);
    if(!dt) return '';
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
  }

  function initTabs(){
    document.querySelectorAll('.tab').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        document.querySelectorAll('.tab').forEach(b=>{ b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        byId(btn.dataset.tab).classList.add('active');
      });
    });
  }

  function renderEmptyState(container, message){
    container.innerHTML = `<div class="empty-state">${message}</div>`;
  }

  function calcSessionTotals(sess){
    let fee = 0;
    let hours = 0;
    (sess.rows || []).forEach(r=>{
      fee += Number(r.duration || 0) * Number(r.rate || 0);
      hours += Number(r.duration || 0);
    });
    return { fee, hours, total: fee + Number(sess.bikeFare || 0) };
  }

  function calcTotals(month){
    let totalHours = 0, tuitionFees = 0, taxi = 0;
    state.sessions.filter(s=>!month || monthKey(s.date)===month).forEach(s=>{
      const t = calcSessionTotals(s);
      totalHours += t.hours;
      tuitionFees += t.fee;
      taxi += Number(s.bikeFare || 0);
    });
    let collected = 0;
    state.payments.filter(p=>!month || monthKey(p.date)===month).forEach(p=>{ collected += Number(p.amount || 0); });
    return { totalHours, tuitionFees, taxi, collected, balance: tuitionFees - collected };
  }

  function calcTotalsRange(start,end){
    let totalHours = 0, tuitionFees = 0, taxi = 0;
    state.sessions.filter(s=>inRange(s.date,start,end)).forEach(s=>{
      const t = calcSessionTotals(s);
      totalHours += t.hours;
      tuitionFees += t.fee;
      taxi += Number(s.bikeFare || 0);
    });
    let collected = 0;
    state.payments.filter(p=>inRange(p.date,start,end)).forEach(p=>{ collected += Number(p.amount || 0); });
    return { totalHours, tuitionFees, taxi, collected, balance: tuitionFees - collected };
  }

  function calcStudentBalance(studentId){
    let fees=0, hours=0;
    state.sessions.forEach(s=>s.rows.forEach(r=>{ if(r.studentId===studentId){ fees += r.duration * r.rate; hours += r.duration; } }));
    return { fees, hours, balance: fees };
  }

  function renderGlobalRate(){ byId('globalRateDisplay').textContent = `${fmtCurrency(state.globalRate)}/hr`; }
  function openGlobalRateDialog(){ const f=byId('globalRateForm'); f.reset(); f.hourlyRate.value = state.globalRate; byId('globalRateDialog').showModal(); }

  function renderStudents(){
    const list = byId('studentsList');
    list.innerHTML = '';
    if(!state.students.length) return renderEmptyState(list, 'No students yet. Add your first student.');
    state.students.forEach(st=>{
      const dues = calcStudentBalance(st.id);
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<div><div class="li-title">${genderEmoji(st.gender)} ${st.name}</div><div class="li-sub"><span class="chip"><span class="swatch" style="background:${st.color}"></span>Tag</span> · Hours ${dues.hours} · Balance ${fmtCurrency(dues.balance)}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`;
      el.querySelector('[data-act="edit"]').onclick = ()=>openStudentDialog(st);
      el.querySelector('[data-act="delete"]').onclick = ()=>{
        if(!confirm('Delete this student?')) return;
        state.students = state.students.filter(s=>s.id!==st.id);
        state.sessions = state.sessions.map(sess=>({ ...sess, rows: sess.rows.filter(r=>r.studentId!==st.id) })).filter(sess=>sess.rows.length);
        save();
      };
      list.appendChild(el);
    });
  }

  function openStudentDialog(st){
    const f=byId('studentForm');
    f.reset();
    byId('studentDialogTitle').textContent = st ? 'Edit Student' : 'Add Student';
    f.id.value = st?.id || '';
    f.name.value = st?.name || '';
    f.gender.value = st?.gender || 'male';
    f.color.value = st?.color || '#4f7cff';
    f.notes.value = st?.notes || '';
    byId('studentDialog').showModal();
  }

  function msRowTemplate(){
    const options = state.students.map(s=>`<option value="${s.id}">${genderEmoji(s.gender)} ${s.name}</option>`).join('');
    return `<div class="ms-row"><select name="studentId">${options}</select><input name="duration" type="number" min="0" step="any" placeholder="hours" /><button type="button" class="icon-btn" data-act="remove">✖️</button></div>`;
  }

  function bindMsRows(container){ container.querySelectorAll('[data-act="remove"]').forEach(btn=>btn.onclick=()=>btn.closest('.ms-row').remove()); }

  function openSessionDialog(sess){
    if(!state.students.length) return alert('Add students first.');
    const f=byId('sessionForm');
    f.reset();
    byId('sessionDialogTitle').textContent = sess ? 'Edit Session' : 'Add Session';
    f.id.value = sess?.id || '';
    f.date.value = sess?.date || new Date().toISOString().slice(0,10);
    f.bikeFare.value = sess?.bikeFare ?? 0;
    f.notes.value = sess?.notes || '';
    const rows=byId('msRows');
    rows.innerHTML='';
    const source = sess?.rows?.length ? sess.rows : [{ studentId: state.students[0].id, duration: 1 }];
    source.forEach(r=>{
      rows.insertAdjacentHTML('beforeend', msRowTemplate());
      const row = rows.lastElementChild;
      row.querySelector('select[name="studentId"]').value = r.studentId;
      row.querySelector('input[name="duration"]').value = r.duration;
    });
    bindMsRows(rows);
    byId('sessionDialog').showModal();
  }

  function renderSessions(){
    const list = byId('sessionsList');
    list.innerHTML = '';
    const filtered = state.sessions.filter(s=>inRange(s.date, byId('sessionStartFilter').value, byId('sessionEndFilter').value)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(!filtered.length) return renderEmptyState(list,'No sessions in this range.');
    filtered.forEach(sess=>{
      const names = sess.rows.map(r=>{ const st=state.students.find(s=>s.id===r.studentId); return `${genderEmoji(st?.gender)} ${st?.name||'Unknown'} (${r.duration}h)`; }).join(', ');
      const t = calcSessionTotals(sess);
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<div><div class="li-title">📅 ${dateStr(sess.date)} — ${names}</div><div class="li-sub">⏱️ ${t.hours}h · 🚕 ${fmtCurrency(sess.bikeFare)} · 💰 ${fmtCurrency(t.total)}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`;
      el.querySelector('[data-act="edit"]').onclick = ()=>openSessionDialog(sess);
      el.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete this session?')){ state.sessions = state.sessions.filter(s=>s.id!==sess.id); save(); } };
      list.appendChild(el);
    });
  }

  function openPaymentDialog(pay){
    const f=byId('paymentForm');
    f.reset();
    byId('paymentDialogTitle').textContent = pay ? 'Edit Payment' : 'Add Payment';
    f.id.value = pay?.id || '';
    f.date.value = pay?.date || new Date().toISOString().slice(0,10);
    f.amount.value = pay?.amount ?? '';
    f.notes.value = pay?.notes || '';
    byId('paymentDialog').showModal();
  }

  function renderPayments(){
    const list = byId('paymentsList');
    list.innerHTML = '';
    const filtered = state.payments.filter(p=>inRange(p.date, byId('paymentStartFilter').value, byId('paymentEndFilter').value)).sort((a,b)=>new Date(b.date)-new Date(a.date));
    if(!filtered.length) return renderEmptyState(list,'No payments in this range.');
    filtered.forEach(pay=>{
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<div><div class="li-title">${dateStr(pay.date)} — Payment</div><div class="li-sub">Amount ${fmtCurrency(pay.amount)} ${pay.notes ? `· ${pay.notes}` : ''}</div></div><div class="li-right"><button class="secondary" data-act="edit">Edit</button><button class="icon-btn" data-act="delete">🗑️</button></div>`;
      el.querySelector('[data-act="edit"]').onclick = ()=>openPaymentDialog(pay);
      el.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete this payment?')){ state.payments = state.payments.filter(p=>p.id!==pay.id); save(); } };
      list.appendChild(el);
    });
  }

  function buildTimeBuckets(mode){
    const now = new Date();
    if(mode === 'daily') return Array.from({length:14},(_,i)=>{ const d = new Date(now); d.setDate(now.getDate()-(13-i)); const s=d.toISOString().slice(0,10); return {label:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}),start:s,end:s}; });
    if(mode === 'weekly'){
      const arr=[]; let end = new Date(now);
      for(let i=0;i<8;i++){
        const start = new Date(end); start.setDate(end.getDate()-6);
        arr.unshift({ label:`${start.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} - ${end.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}`, start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10) });
        end.setDate(end.getDate()-7);
      }
      return arr;
    }
    if(mode === 'yearly') return Array.from({length:6},(_,i)=>{ const y=now.getFullYear()-(5-i); return {label:String(y), start:`${y}-01-01`, end:`${y}-12-31`}; });
    return Array.from({length:12},(_,i)=>{ const d = new Date(now.getFullYear(), now.getMonth()-(11-i), 1); const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10); const end = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10); return {label:d.toLocaleDateString('en-GB',{month:'short',year:'2-digit'}),start,end}; });
  }

  function renderDashboard(){
    const all = calcTotals();
    byId('kpiHours').textContent = all.totalHours;
    byId('kpiFees').textContent = fmtCurrency(all.tuitionFees);
    byId('kpiTaxi').textContent = fmtCurrency(all.taxi);
    byId('kpiCollected').textContent = fmtCurrency(all.collected);
    byId('kpiBalance').textContent = fmtCurrency(all.balance);
    const month = calcTotals(monthKey(new Date().toISOString().slice(0,10)));
    byId('kpiCurrentMonthAmount').textContent = fmtCurrency(month.collected);

    const mode = document.querySelector('.chip-btn.active')?.dataset.range || 'monthly';
    const buckets = buildTimeBuckets(mode);
    const labels = buckets.map(b=>b.label);
    const fees=[], taxi=[], collected=[];
    buckets.forEach(b=>{ const t=calcTotalsRange(b.start,b.end); fees.push(t.tuitionFees); taxi.push(t.taxi); collected.push(t.collected); });
    monthlyChart?.destroy();
    monthlyChart = new Chart(byId('monthlyChart'),{ type:'bar', data:{labels,datasets:[{label:'Fees',data:fees,backgroundColor:'#5078ff'},{label:'Taxi',data:taxi,backgroundColor:'#7f8ca8'},{label:'Collected',data:collected,backgroundColor:'#10b981'}]}, options:{responsive:true,maintainAspectRatio:false,animation:false} });
  }

  function renderReports(){
    const start = byId('reportStart').value;
    const end = byId('reportEnd').value;
    const t = calcTotalsRange(start,end);
    byId('reportTotals').innerHTML = `⏱️ Total Hours <b>${t.totalHours}</b><br>💰 Tuition Fees <b>${fmtCurrency(t.tuitionFees)}</b><br>🚕 Taxi Fare <b>${fmtCurrency(t.taxi)}</b><br>💵 Collected <b>${fmtCurrency(t.collected)}</b><br>📉 Balance <b>${fmtCurrency(t.balance)}</b>`;

    const map = new Map();
    state.sessions.filter(s=>inRange(s.date,start,end)).forEach(s=>s.rows.forEach(r=>map.set(r.studentId,(map.get(r.studentId)||0)+r.duration)));
    const labels = [...map.keys()].map(id=>state.students.find(s=>s.id===id)?.name || 'Unknown');
    const data = [...map.values()];
    studentHoursChart?.destroy();
    studentHoursChart = new Chart(byId('studentHoursChart'),{ type:'doughnut', data:{labels,datasets:[{data,backgroundColor:labels.map((_,i)=>`hsl(${(i*61)%360} 70% 55%)`)}]}, options:{plugins:{legend:{position:'bottom'}}, animation:false} });
  }

  function buildEmoji({start,end}){
    const sessions = state.sessions.filter(s=>inRange(s.date,start,end)).sort((a,b)=>new Date(a.date)-new Date(b.date));
    const lines = ['📘 Tuition Summary'];
    let totalHours=0,totalFees=0,totalTaxi=0;
    sessions.forEach(s=>{
      const t=calcSessionTotals(s);
      totalHours += t.hours;
      totalFees += t.fee;
      totalTaxi += Number(s.bikeFare || 0);
      const names = s.rows.map(r=>{ const st=state.students.find(x=>x.id===r.studentId); return `${genderEmoji(st?.gender)} ${st?.name} (${r.duration}h)`; }).join(' + ');
      lines.push(`📅 ${dateStr(s.date)}\n${names}\n💰 ${fmtCurrency(t.total)}\n`);
    });
    lines.push(`⏱️ Total Hours: ${totalHours}`);
    lines.push(`💰 Tuition Fees: ${fmtCurrency(totalFees)}`);
    lines.push(`🚕 Taxi: ${fmtCurrency(totalTaxi)}`);
    lines.push(`💵 Grand Total: ${fmtCurrency(totalFees + totalTaxi)}`);
    return lines.join('\n');
  }

  function csvEscape(v){ if(v==null) return ''; const s = String(v).replaceAll('"','""'); return /[",\n]/.test(s) ? `"${s}"` : s; }
  function download(filename, content, type='text/plain'){ const blob = new Blob([content],{type}); const a=document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); }
  function exportCsvStudents(){ const h=['id','name','gender','color','notes']; download('students.csv', `${h.join(',')}\n${state.students.map(s=>h.map(k=>csvEscape(s[k])).join(',')).join('\n')}`, 'text/csv'); }
  function exportCsvSessions(){ const h=['id','date','bikeFare','notes','studentId','duration','rate']; const rows = state.sessions.flatMap(s=>s.rows.map(r=>[s.id,s.date,s.bikeFare,s.notes,r.studentId,r.duration,r.rate].map(csvEscape).join(','))); download('sessions.csv', `${h.join(',')}\n${rows.join('\n')}`, 'text/csv'); }
  function exportCsvPayments(){ const h=['id','date','amount','notes']; download('payments.csv', `${h.join(',')}\n${state.payments.map(p=>h.map(k=>csvEscape(p[k])).join(',')).join('\n')}`, 'text/csv'); }
  function exportBackup(){ download('tuition-backup.json', JSON.stringify(state,null,2), 'application/json'); }

  function importBackup(file){
    const reader = new FileReader();
    reader.onload = ()=>{
      const parsed = parseJSON(reader.result || '');
      if(!parsed || !Array.isArray(parsed.students) || !Array.isArray(parsed.sessions) || !Array.isArray(parsed.payments)){
        alert('Invalid backup file');
        return;
      }
      state = parsed;
      normalizeState();
      save();
      alert('Backup imported successfully.');
    };
    reader.readAsText(file);
  }

  function refreshAll(){
    renderGlobalRate();
    renderStudents();
    renderSessions();
    renderPayments();
    renderDashboard();
    renderReports();
    const s=byId('exportStart')?.value; const e=byId('exportEnd')?.value;
    if(s && e) byId('emojiOutput').textContent = buildEmoji({start:s,end:e});
  }

  async function initSupabaseClient(){
    const url = (localStorage.getItem(SUPABASE_URL_KEY) || '').trim();
    const anon = (localStorage.getItem(SUPABASE_ANON_KEY) || '').trim();
    if(!url || !anon || !window.supabase?.createClient){
      supabase = null;
      await updateAuthUi();
      return;
    }

    supabase = window.supabase.createClient(url, anon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    supabase.auth.onAuthStateChange(async ()=>{
      await updateAuthUi();
      await syncCloudState({preferCloud:true});
    });

    await updateAuthUi();
  }

  async function getUser(){
    if(!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if(error) return null;
    return data?.user || null;
  }

  async function updateAuthUi(){
    const status = byId('authStatus');
    const btn = byId('authButton');
    if(!supabase){
      status.textContent = 'Cloud not configured. Data stays local on this device.';
      btn.textContent = 'Sign In';
      return;
    }
    const user = await getUser();
    if(user){
      status.textContent = `Signed in as ${user.email}. Cloud sync is active.`;
      btn.textContent = 'Sign Out';
    }else{
      status.textContent = 'Signed out. Sign in to sync across devices.';
      btn.textContent = 'Sign In';
    }
  }

  function chooseState(localState, cloudPayload, cloudUpdatedAt, preferCloud=false){
    const localHas = hasData(localState);
    const cloudHas = hasData(cloudPayload || defaultState());

    if(preferCloud && cloudHas) return cloudPayload;
    if(!localHas && cloudHas) return cloudPayload;
    if(localHas && !cloudHas) return localState;
    if(!localHas && !cloudHas) return localState;

    const localTs = new Date(localState.meta?.updatedAt || 0).getTime();
    const cloudTs = new Date(cloudUpdatedAt || 0).getTime();
    return cloudTs > localTs ? cloudPayload : localState;
  }

  async function syncCloudState({preferCloud=false}={}){
    if(syncInFlight || !supabase) return;
    const user = await getUser();
    if(!user) return;

    syncInFlight = true;
    try{
      const { data:row, error } = await supabase.from('tuition_profiles').select('payload,updated_at').eq('user_id', user.id).maybeSingle();
      if(error){
        console.error(error.message);
        return;
      }

      const cloudPayload = row?.payload || null;
      if(!cloudPayload){
        if(hasData(state)){
          await supabase.from('tuition_profiles').upsert({ user_id:user.id, payload:state, updated_at:state.meta.updatedAt });
        }
        return;
      }

      const bothHaveData = hasData(state) && hasData(cloudPayload);

      if(bothHaveData){
        state = mergeStates(state, cloudPayload);
        normalizeState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        refreshAll();
        await supabase.from('tuition_profiles').upsert({ user_id:user.id, payload:state, updated_at:state.meta.updatedAt });
        return;
      }

      const selected = chooseState(state, cloudPayload, row.updated_at, preferCloud);
      const useCloud = selected !== state;

      if(useCloud){
        state = selected;
        normalizeState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        refreshAll();
      }else{
        // Never overwrite non-empty cloud with empty local state.
        if(hasData(state) || !hasData(cloudPayload)){
          await supabase.from('tuition_profiles').upsert({ user_id:user.id, payload:state, updated_at:state.meta.updatedAt });
        }
      }
    }finally{
      syncInFlight = false;
    }
  }

  function initCloudSettings(){
    byId('openCloudSettings').addEventListener('click', ()=>{
      const form = byId('cloudSettingsForm');
      form.url.value = localStorage.getItem(SUPABASE_URL_KEY) || '';
      form.anonKey.value = localStorage.getItem(SUPABASE_ANON_KEY) || '';
      byId('cloudSettingsDialog').showModal();
    });

    byId('cloudSettingsForm').addEventListener('submit', async (e)=>{
      e.preventDefault();
      const form = e.target;
      localStorage.setItem(SUPABASE_URL_KEY, form.url.value.trim());
      localStorage.setItem(SUPABASE_ANON_KEY, form.anonKey.value.trim());
      byId('cloudSettingsDialog').close();
      await initSupabaseClient();
      alert('Cloud settings saved successfully.');
    });
  }

  function initAuth(){
    byId('authButton').addEventListener('click', async ()=>{
      if(!supabase){
        byId('cloudSettingsDialog').showModal();
        return;
      }
      const user = await getUser();
      if(user){
        await supabase.auth.signOut();
        await updateAuthUi();
        return;
      }
      byId('authDialog').showModal();
    });

    byId('authForm').addEventListener('submit', async (e)=>{
      e.preventDefault();
      if(!supabase) return;
      const form = e.target;
      const email = form.email.value.trim();
      const password = form.password.value.trim();

      const signIn = await supabase.auth.signInWithPassword({ email, password });
      if(signIn.error){
        const signUp = await supabase.auth.signUp({ email, password });
        if(signUp.error){ alert(signUp.error.message); return; }
        // After sign-up try sign-in so status is not stuck as signed out.
        const secondSignIn = await supabase.auth.signInWithPassword({ email, password });
        if(secondSignIn.error){
          alert('Account created. Please verify email if confirmation is enabled, then sign in again.');
          byId('authDialog').close();
          await updateAuthUi();
          return;
        }
      }

      byId('authDialog').close();
      await updateAuthUi();
      await syncCloudState({preferCloud:true});
      alert('Signed in and sync completed.');
    });
  }

  function initForms(){
    byId('studentForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      const payload = { id:d.id || genId(), name:d.name.trim(), gender:d.gender, color:d.color, notes:d.notes || '' };
      const idx = state.students.findIndex(s=>s.id===payload.id);
      if(idx >= 0) state.students[idx] = payload; else state.students.push(payload);
      save();
      byId('studentDialog').close();
    });

    byId('globalRateForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      state.globalRate = Number(e.target.hourlyRate.value || 0);
      save();
      byId('globalRateDialog').close();
    });

    byId('sessionForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const f=e.target;
      const rows=[...f.querySelectorAll('.ms-row')].map(row=>({ studentId: row.querySelector('select[name="studentId"]').value, duration: Number(row.querySelector('input[name="duration"]').value || 0), rate: Number(state.globalRate || 0) })).filter(r=>r.studentId && r.duration > 0);
      if(!rows.length){ alert('Add at least one student and duration.'); return; }
      const payload={ id:f.id.value || genId(), date:f.date.value, bikeFare:Number(f.bikeFare.value || 0), notes:f.notes.value || '', rows };
      const idx = state.sessions.findIndex(s=>s.id===payload.id);
      if(idx >= 0) state.sessions[idx] = payload; else state.sessions.push(payload);
      save();
      byId('sessionDialog').close();
    });

    byId('paymentForm').addEventListener('submit', (e)=>{
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target).entries());
      const payload = { id:d.id || genId(), date:d.date, amount:Number(d.amount || 0), notes:d.notes || '' };
      const idx = state.payments.findIndex(p=>p.id===payload.id);
      if(idx >= 0) state.payments[idx] = payload; else state.payments.push(payload);
      save();
      byId('paymentDialog').close();
    });

    byId('addStudentBtn').onclick = ()=>openStudentDialog();
    byId('editGlobalRateBtn').onclick = openGlobalRateDialog;
    byId('addSessionBtn').onclick = ()=>openSessionDialog();
    byId('addPaymentBtn').onclick = ()=>openPaymentDialog();
    byId('addMsRow').onclick = ()=>{ const rows = byId('msRows'); rows.insertAdjacentHTML('beforeend', msRowTemplate()); bindMsRows(rows); };
  }

  function initExports(){
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
    const end = today.toISOString().slice(0,10);
    byId('exportStart').value = start;
    byId('exportEnd').value = end;
    const update = ()=>{ byId('emojiOutput').textContent = buildEmoji({start:byId('exportStart').value, end:byId('exportEnd').value}); };
    byId('exportStart').addEventListener('change', update);
    byId('exportEnd').addEventListener('change', update);
    byId('copyEmoji').onclick = async ()=>{ try{ await navigator.clipboard.writeText(byId('emojiOutput').textContent); alert('Copied'); }catch{ alert('Copy failed'); } };
    byId('exportStudentsCsv').onclick = exportCsvStudents;
    byId('exportSessionsCsv').onclick = exportCsvSessions;
    byId('exportPaymentsCsv').onclick = exportCsvPayments;
    byId('exportBackup').onclick = exportBackup;
    byId('importBackup').onclick = ()=>{ const f=byId('importBackupFile').files[0]; if(!f) return alert('Choose a backup file'); importBackup(f); };
    update();
  }

  async function init(){
    initTheme();
    load();
    initTabs();
    initForms();
    initExports();
    initCloudSettings();
    initAuth();

    byId('themeToggle').onclick = ()=>{ const cur=document.documentElement.getAttribute('data-theme') || 'dark'; setTheme(cur==='dark' ? 'light' : 'dark'); refreshAll(); };

    const today = new Date().toISOString().slice(0,10);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
    ['sessionStartFilter','paymentStartFilter','reportStart'].forEach(id=>byId(id).value = monthStart);
    ['sessionEndFilter','paymentEndFilter','reportEnd'].forEach(id=>byId(id).value = today);
    ['sessionStartFilter','sessionEndFilter'].forEach(id=>byId(id).addEventListener('change', renderSessions));
    ['paymentStartFilter','paymentEndFilter'].forEach(id=>byId(id).addEventListener('change', renderPayments));
    byId('refreshReport').onclick = renderReports;
    document.querySelectorAll('.chip-btn').forEach(btn=>btn.addEventListener('click', ()=>{ document.querySelectorAll('.chip-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderDashboard(); }));

    await initSupabaseClient();
    await syncCloudState({preferCloud:true});
    refreshAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
