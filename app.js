(function(){
	// State & Storage
	const STORAGE_KEY = "tuition_accounts_v1";
	const THEME_KEY = "tuition_theme";
	let state = {
		students: [], // {id,name,gender,hourlyRate,color,notes}
		sessions: [], // {id,date,rows:[{studentId,duration}], bikeFare, notes}
		payments: []  // {id,date,studentId,amount,notes}
	};

	function load(){
		try{
			const s = localStorage.getItem(STORAGE_KEY);
			if(s){ state = JSON.parse(s); }
		}catch(e){ console.error(e); }
	}
	function save(){
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
		refreshAll();
	}

	function setTheme(theme){
		document.documentElement.setAttribute('data-theme', theme);
		localStorage.setItem(THEME_KEY, theme);
	}
	function initTheme(){
		const saved = localStorage.getItem(THEME_KEY);
		if(saved){ setTheme(saved); }
	}

	// Utilities
	const byId = (id)=> document.getElementById(id);
	const fmtCurrency = (n)=> `₹${(n||0).toLocaleString('en-IN')}`;
	const fmtHours = (n)=> `${n} hrs`;
	const genderEmoji = (g)=> g === 'female' ? '👧' : '👦';
	const genId = ()=> Math.random().toString(36).slice(2,9);
	function dateStr(d){
		const dt = new Date(d);
		return dt.toLocaleDateString('en-GB',{ day:'2-digit', month:'short', year:'numeric' });
	}
	function monthKey(d){
		const dt = new Date(d);
		return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
	}
	function inRange(dateStr, start, end){
		const d = new Date(dateStr);
		return (!start || d >= new Date(start)) && (!end || d <= new Date(end));
	}

	// Tabs
	function initTabs(){
		document.querySelectorAll('.tab').forEach(btn=>{
			btn.addEventListener('click', ()=>{
				document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
				document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
				btn.classList.add('active');
				document.getElementById(btn.dataset.tab).classList.add('active');
			});
		});
	}

	// Students CRUD UI
	function renderStudents(){
		const list = byId('studentsList');
		list.innerHTML = '';
		state.students.forEach(st=>{
			const dues = calcStudentBalance(st.id);
			const item = document.createElement('div');
			item.className = 'list-item';
			item.innerHTML = `
				<div>
					<div class="li-title">${genderEmoji(st.gender)} ${st.name}</div>
					<div class="li-sub">Rate: ${fmtCurrency(st.hourlyRate)}/hr · <span class="chip"><span class="swatch" style="background:${st.color}"></span> Tag</span> · Balance: ${fmtCurrency(dues.balance)}</div>
				</div>
				<div class="li-right">
					<button class="secondary" data-act="edit">Edit</button>
					<button class="icon-btn" data-act="delete" title="Delete">🗑️</button>
				</div>
			`;
			item.querySelector('[data-act="edit"]').onclick = ()=> openStudentDialog(st);
			item.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete student?')){ state.students = state.students.filter(x=>x.id!==st.id); save(); }};
			list.appendChild(item);
		});
	}
	function openStudentDialog(st){
		const dlg = byId('studentDialog');
		const form = byId('studentForm');
		byId('studentDialogTitle').textContent = st ? 'Edit Student' : 'Add Student';
		form.reset();
		form.id.value = st?.id || '';
		form.name.value = st?.name || '';
		form.gender.value = st?.gender || 'male';
		form.hourlyRate.value = st?.hourlyRate ?? '';
		form.color.value = st?.color || '#5b8def';
		form.notes.value = st?.notes || '';
		dlg.showModal();
	}
	function handleStudentForm(){
		const form = byId('studentForm');
		form.addEventListener('submit', (e)=>{
			e.preventDefault();
			const data = Object.fromEntries(new FormData(form).entries());
			const payload = {
				id: data.id || genId(),
				name: data.name.trim(),
				gender: data.gender,
				hourlyRate: Number(data.hourlyRate||0),
				color: data.color,
				notes: data.notes||''
			};
			const idx = state.students.findIndex(s=>s.id===payload.id);
			if(idx>=0) state.students[idx]=payload; else state.students.push(payload);
			save();
			form.closest('dialog').close();
		});
		byId('addStudentBtn').addEventListener('click', ()=> openStudentDialog(null));
	}

	// Sessions CRUD UI
	function msRowTemplate(selectedId, duration){
		const opts = state.students.map(s=>`<option value="${s.id}">${genderEmoji(s.gender)} ${s.name}</option>`).join('');
		return `
			<div class="ms-row">
				<select name="studentId">${opts}</select>
				<input name="duration" type="number" min="0" step="0.5" placeholder="hours" />
				<button type="button" class="icon-btn" data-act="remove">✖️</button>
			</div>
		`;
	}
	function bindMsRows(container){
		container.querySelectorAll('[data-act="remove"]').forEach(btn=>{
			btn.onclick = ()=> btn.closest('.ms-row').remove();
		});
	}
	function openSessionDialog(sess){
		if(state.students.length===0){ alert('Add a student first.'); return; }
		const dlg = byId('sessionDialog');
		const form = byId('sessionForm');
		byId('sessionDialogTitle').textContent = sess ? 'Edit Session' : 'Add Session';
		form.reset();
		form.id.value = sess?.id || '';
		form.date.value = sess?.date || new Date().toISOString().slice(0,10);
		form.bikeFare.value = sess?.bikeFare ?? 0;
		form.notes.value = sess?.notes || '';
		const rows = byId('msRows');
		rows.innerHTML = '';
		const rs = sess?.rows?.length ? sess.rows : [{studentId: state.students[0].id, duration: 1}];
		rs.forEach(r=>{
			rows.insertAdjacentHTML('beforeend', msRowTemplate(r.studentId, r.duration));
		});
		bindMsRows(rows);
		dlg.showModal();
	}
	function handleSessionForm(){
		byId('addMsRow').addEventListener('click', ()=>{
			const rows = byId('msRows');
			rows.insertAdjacentHTML('beforeend', msRowTemplate());
			bindMsRows(rows);
		});
		const form = byId('sessionForm');
		form.addEventListener('submit', (e)=>{
			e.preventDefault();
			const fd = new FormData(form);
			const id = form.id.value || genId();
			const date = form.date.value;
			const bikeFare = Number(form.bikeFare.value||0);
			const notes = form.notes.value||'';
			const rows = Array.from(form.querySelectorAll('.ms-row')).map(row=>({
				studentId: row.querySelector('select[name="studentId"]').value,
				duration: Number(row.querySelector('input[name="duration"]').value||0)
			})).filter(r=>r.studentId && r.duration>0);
			if(rows.length===0){ alert('Add at least one student with duration.'); return; }
			const payload = { id, date, rows, bikeFare, notes };
			const idx = state.sessions.findIndex(s=>s.id===id);
			if(idx>=0) state.sessions[idx]=payload; else state.sessions.push(payload);
			save();
			form.closest('dialog').close();
		});
		byId('addSessionBtn').addEventListener('click', ()=> openSessionDialog(null));
	}
	function renderSessions(){
		const list = byId('sessionsList');
		list.innerHTML = '';
		const sDate = byId('sessionStartFilter').value;
		const eDate = byId('sessionEndFilter').value;
		state.sessions
			.filter(s=> inRange(s.date, sDate, eDate))
			.sort((a,b)=> new Date(b.date)-new Date(a.date))
			.forEach(sess=>{
				const item = document.createElement('div');
				item.className = 'list-item';
				const parts = sess.rows.map(r=>{
					const st = state.students.find(s=>s.id===r.studentId);
					return `${genderEmoji(st?.gender)} ${st?.name} (${fmtHours(r.duration)})`;
				}).join(', ');
				const {fee,total,hours} = calcSessionTotals(sess);
				item.innerHTML = `
					<div>
						<div class="li-title">📅 ${dateStr(sess.date)} — ${parts}</div>
						<div class="li-sub">⏱️ ${fmtHours(hours)} · 🚕 ${fmtCurrency(sess.bikeFare)} · 💰 ${fmtCurrency(total)}</div>
					</div>
					<div class="li-right">
						<button class="secondary" data-act="edit">Edit</button>
						<button class="icon-btn" data-act="delete">🗑️</button>
					</div>
				`;
				item.querySelector('[data-act="edit"]').onclick = ()=> openSessionDialog(sess);
				item.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete session?')){ state.sessions = state.sessions.filter(x=>x.id!==sess.id); save(); }};
				list.appendChild(item);
			});
	}

	// Payments CRUD UI
	function renderPaymentStudentOptions(){
		const sel = byId('paymentStudent');
		sel.innerHTML = state.students.map(s=>`<option value="${s.id}">${genderEmoji(s.gender)} ${s.name}</option>`).join('');
	}
	function openPaymentDialog(pay){
		if(state.students.length===0){ alert('Add a student first.'); return; }
		renderPaymentStudentOptions();
		const dlg = byId('paymentDialog');
		const form = byId('paymentForm');
		byId('paymentDialogTitle').textContent = pay ? 'Edit Payment' : 'Add Payment';
		form.reset();
		form.id.value = pay?.id || '';
		form.date.value = pay?.date || new Date().toISOString().slice(0,10);
		form.studentId.value = pay?.studentId || state.students[0].id;
		form.amount.value = pay?.amount ?? '';
		form.notes.value = pay?.notes || '';
		dlg.showModal();
	}
	function handlePaymentForm(){
		const form = byId('paymentForm');
		form.addEventListener('submit', (e)=>{
			e.preventDefault();
			const data = Object.fromEntries(new FormData(form).entries());
			const payload = {
				id: data.id || genId(),
				date: data.date,
				studentId: data.studentId,
				amount: Number(data.amount||0),
				notes: data.notes||''
			};
			const idx = state.payments.findIndex(p=>p.id===payload.id);
			if(idx>=0) state.payments[idx]=payload; else state.payments.push(payload);
			save();
			form.closest('dialog').close();
		});
		byId('addPaymentBtn').addEventListener('click', ()=> openPaymentDialog(null));
	}
	function renderPayments(){
		const list = byId('paymentsList');
		list.innerHTML = '';
		const sDate = byId('paymentStartFilter').value;
		const eDate = byId('paymentEndFilter').value;
		state.payments
			.filter(p=> inRange(p.date, sDate, eDate))
			.sort((a,b)=> new Date(b.date)-new Date(a.date))
			.forEach(p=>{
				const st = state.students.find(s=>s.id===p.studentId);
				const item = document.createElement('div');
				item.className = 'list-item';
				item.innerHTML = `
					<div>
						<div class="li-title">${dateStr(p.date)} — ${genderEmoji(st?.gender)} ${st?.name}</div>
						<div class="li-sub">Amount: ${fmtCurrency(p.amount)} ${p.notes? '· '+p.notes:''}</div>
					</div>
					<div class="li-right">
						<button class="secondary" data-act="edit">Edit</button>
						<button class="icon-btn" data-act="delete">🗑️</button>
					</div>
				`;
				item.querySelector('[data-act="edit"]').onclick = ()=> openPaymentDialog(p);
				item.querySelector('[data-act="delete"]').onclick = ()=>{ if(confirm('Delete payment?')){ state.payments = state.payments.filter(x=>x.id!==p.id); save(); }};
				list.appendChild(item);
			});
	}

	// Calculations
	function calcSessionTotals(sess){
		let fee = 0; let hours = 0;
		sess.rows.forEach(r=>{
			const st = state.students.find(s=>s.id===r.studentId);
			if(!st) return;
			fee += r.duration * (st.hourlyRate||0);
			hours += r.duration;
		});
		const total = fee + (Number(sess.bikeFare)||0);
		return {fee, total, hours};
	}
	function calcTotals(month){
		let totalHours=0, tuitionFees=0, taxi=0;
		state.sessions.filter(s=>!month||monthKey(s.date)===month).forEach(s=>{
			const t = calcSessionTotals(s);
			totalHours += t.hours; tuitionFees += t.fee; taxi += (s.bikeFare||0);
		});
		let collected = 0;
		state.payments.filter(p=>!month||monthKey(p.date)===month).forEach(p=> collected += p.amount||0);
		const balance = tuitionFees - collected;
		return { totalHours, tuitionFees, taxi, collected, balance };
	}
	function calcTotalsRange(start, end){
		let totalHours=0, tuitionFees=0, taxi=0;
		state.sessions.filter(s=> inRange(s.date, start, end)).forEach(s=>{
			const t = calcSessionTotals(s);
			totalHours += t.hours; tuitionFees += t.fee; taxi += (s.bikeFare||0);
		});
		let collected = 0;
		state.payments.filter(p=> inRange(p.date, start, end)).forEach(p=> collected += p.amount||0);
		return { totalHours, tuitionFees, taxi, collected, balance: tuitionFees - collected };
	}
	function calcStudentBalance(studentId){
		let fees=0, hours=0;
		state.sessions.forEach(s=>{
			s.rows.forEach(r=>{ if(r.studentId===studentId){
				const st = state.students.find(x=>x.id===studentId);
				fees += r.duration * (st?.hourlyRate||0);
				hours += r.duration;
			}});
		});
		let collected=0;
		state.payments.forEach(p=>{ if(p.studentId===studentId) collected += (p.amount||0); });
		return { fees, hours, collected, balance: fees - collected };
	}

	// Dashboard & Charts
	let monthlyChart, studentHoursChart;
	function renderDashboard(){
		const k = calcTotals();
		byId('kpiHours').textContent = k.totalHours;
		byId('kpiFees').textContent = fmtCurrency(k.tuitionFees);
		byId('kpiTaxi').textContent = fmtCurrency(k.taxi);
		byId('kpiCollected').textContent = fmtCurrency(k.collected);
		byId('kpiBalance').textContent = fmtCurrency(k.balance);

		// Timeframe chart using selected mode
		const ctx = byId('monthlyChart');
		const mode = (document.querySelector('.btn-group .chip-btn.active')?.dataset.range) || 'monthly';
		const buckets = buildTimeBuckets(mode);
		const labels = buckets.map(b=>b.label);
		const fees=[]; const taxi=[]; const collected=[];
		buckets.forEach(b=>{ const t = calcTotalsRange(b.start, b.end); fees.push(t.tuitionFees); taxi.push(t.taxi); collected.push(t.collected); });
		monthlyChart && monthlyChart.destroy();
		monthlyChart = new Chart(ctx,{
			type:'bar',
			data:{ labels, datasets:[
				{label:'Fees', data: fees, backgroundColor:'#5b8def'},
				{label:'Taxi', data: taxi, backgroundColor:'#9fb0c3'},
				{label:'Collected', data: collected, backgroundColor:'#1db954'}
			]},
			options:{
				responsive:true,
				maintainAspectRatio:false,
				scales:{ y:{ beginAtZero:true } },
				animation:false,
				devicePixelRatio: 2
			}
		});
	}
	function buildTimeBuckets(mode){
		const now = new Date();
		const pad = (n)=> String(n).padStart(2,'0');
		if(mode==='daily'){
			const arr=[]; for(let i=13;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); const s=d.toISOString().slice(0,10); arr.push({label:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}), start:s, end:s}); } return arr;
		}
		if(mode==='weekly'){
			const arr=[]; let end=new Date(now); for(let i=0;i<8;i++){ const start=new Date(end); start.setDate(end.getDate()-6); arr.unshift({ label:`${start.getDate()}-${end.getDate()} ${end.toLocaleString('en-US',{month:'short'})}`, start:start.toISOString().slice(0,10), end:end.toISOString().slice(0,10)}); end.setDate(end.getDate()-7); } return arr;
		}
		if(mode==='yearly'){
			const arr=[]; for(let i=4;i>=0;i--){ const y=now.getFullYear()-i; arr.push({ label:`${y}`, start:`${y}-01-01`, end:`${y}-12-31`}); } return arr;
		}
		// monthly default last 6
		const arr=[]; for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); const y=d.getFullYear(); const m=pad(d.getMonth()+1); const s=`${y}-${m}-01`; const e=new Date(y, d.getMonth()+1, 0).toISOString().slice(0,10); arr.push({ label:d.toLocaleString('en-US',{month:'short',year:'2-digit'}), start:s, end:e }); } return arr;
	}
	function renderReports(){
		const sDate = byId('reportStart').value; const eDate = byId('reportEnd').value;
		const k = calcTotalsRange(sDate, eDate);
		byId('reportTotals').innerHTML = `
			<div>⏱️ Total Hours: <b>${k.totalHours}</b></div>
			<div>💰 Tuition Fees: <b>${fmtCurrency(k.tuitionFees)}</b></div>
			<div>🚕 Total Bike Fare: <b>${fmtCurrency(k.taxi)}</b></div>
			<div>💵 Collected: <b>${fmtCurrency(k.collected)}</b></div>
			<div>📉 Balance: <b>${fmtCurrency(k.balance)}</b></div>
		`;
		const hoursByStudent = state.students.map(st=>{
			let h=0; state.sessions.filter(s=> inRange(s.date, sDate, eDate)).forEach(s=>{
				s.rows.forEach(r=>{ if(r.studentId===st.id) h+=r.duration; });
			});
			return {name: st.name, color: st.color, h};
		});
		const ctx = byId('studentHoursChart');
		studentHoursChart && studentHoursChart.destroy();
		studentHoursChart = new Chart(ctx,{
			type:'doughnut',
			data:{ labels: hoursByStudent.map(x=>x.name), datasets:[{ data: hoursByStudent.map(x=>x.h), backgroundColor: hoursByStudent.map(x=>x.color) }]},
			options:{
				responsive:true,
				maintainAspectRatio:false,
				plugins:{ legend:{ position:'bottom' } },
				animation:false,
				devicePixelRatio: 2
			}
		});
	}

	// Export (Emoji + CSV + Backup)
	function buildEmoji(range){
		const lines=[];
		let sessions = state.sessions.slice();
		if(range && range.start && range.end){
			const sDate = new Date(range.start);
			const eDate = new Date(range.end);
			sessions = sessions.filter(x=>{ const d=new Date(x.date); return d>=sDate && d<=eDate; });
		}
		sessions.sort((a,b)=> new Date(a.date)-new Date(b.date));
		let totalHours=0,totalFees=0,totalTaxi=0;
		sessions.forEach(s=>{
			const dt = `📅 ${dateStr(s.date)}`;
			const parts = s.rows.map(r=>{ const st = state.students.find(x=>x.id===r.studentId); return `${genderEmoji(st?.gender)} ${st?.name} (${r.duration} hrs)`; });
			const t = calcSessionTotals(s);
			totalHours += t.hours; totalFees += t.fee; totalTaxi += s.bikeFare||0;
			lines.push(`${dt}\n${parts.join(' + ')} — ${fmtCurrency(t.total)}\n⏱️ Duration: ${t.hours} hrs\n🚕 Bike Taxi: ${fmtCurrency(s.bikeFare||0)}\n💰 Total: ${fmtCurrency(t.total)}\n`);
		});
		lines.push(`⏱️ Total Hours: ${totalHours} hrs`);
		lines.push(`💰 Tuition Fees: ${fmtCurrency(totalFees)}`);
		lines.push(`🚕 Total Bike Fare: ${fmtCurrency(totalTaxi)}`);
		lines.push(`💵 Grand Total: ${fmtCurrency(totalFees+totalTaxi)}`);
		return lines.join('\n');
	}
	function csvEscape(v){
		if(v==null) return '';
		const s = String(v).replaceAll('"','""');
		if(/[",\n]/.test(s)) return '"'+s+'"';
		return s;
	}
	function download(filename, content, type='text/plain'){
		const blob = new Blob([content], {type});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = filename; a.click();
		URL.revokeObjectURL(url);
	}
	function exportCsvStudents(){
		const headers = ['id','name','gender','hourlyRate','color','notes'];
		const rows = state.students.map(s=> headers.map(h=>csvEscape(s[h])).join(','));
		download('students.csv', headers.join(',')+'\n'+rows.join('\n'), 'text/csv');
	}
	function exportCsvSessions(){
		const headers = ['id','date','bikeFare','notes','studentId','duration'];
		const rows = state.sessions.flatMap(s=> s.rows.map(r=> [s.id,s.date,s.bikeFare||0,s.notes||'',r.studentId,r.duration].map(csvEscape).join(',')));
		download('sessions.csv', headers.join(',')+'\n'+rows.join('\n'), 'text/csv');
	}
	function exportCsvPayments(){
		const headers = ['id','date','studentId','amount','notes'];
		const rows = state.payments.map(p=> headers.map(h=>csvEscape(p[h])).join(','));
		download('payments.csv', headers.join(',')+'\n'+rows.join('\n'), 'text/csv');
	}
	function exportBackup(){
		download('tuition-backup.json', JSON.stringify(state,null,2), 'application/json');
	}
	function importBackup(file){
		const reader = new FileReader();
		reader.onload = ()=>{
			try{
				const data = JSON.parse(reader.result);
				if(data && data.students && data.sessions && data.payments){ state = data; save(); alert('Imported successfully'); }
				else alert('Invalid backup');
			}catch(e){ alert('Import failed'); }
		};
		reader.readAsText(file);
	}

	// Wire up Export tab
	function initExport(){
		function currentMonthRange(){
			const d=new Date();
			const start=new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10);
			const end=new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
			return {start,end};
		}
		const startEl = byId('exportStart');
		const endEl = byId('exportEnd');
		const def = currentMonthRange();
		startEl.value = def.start; endEl.value = def.end;
		const setEmoji = ()=>{ byId('emojiOutput').textContent = buildEmoji({start:startEl.value, end:endEl.value}); };
		startEl.addEventListener('change', setEmoji);
		endEl.addEventListener('change', setEmoji);
		byId('copyEmoji').addEventListener('click', async ()=>{
			const txt = byId('emojiOutput').textContent;
			try{ await navigator.clipboard.writeText(txt); alert('Copied'); }catch{ alert('Copy failed'); }
		});
		byId('exportStudentsCsv').onclick = exportCsvStudents;
		byId('exportSessionsCsv').onclick = exportCsvSessions;
		byId('exportPaymentsCsv').onclick = exportCsvPayments;
		byId('exportBackup').onclick = exportBackup;
		byId('importBackup').onclick = ()=>{
			const f = byId('importBackupFile').files[0];
			if(!f){ alert('Choose a file'); return; }
			importBackup(f);
		};
		setEmoji();
	}

	// Refresh functions
	function refreshAll(){
		renderStudents();
		renderSessions();
		renderPayments();
		renderDashboard();
		renderReports();
		const startEl = byId('exportStart');
		const endEl = byId('exportEnd');
		if(startEl && endEl){
			byId('emojiOutput').textContent = buildEmoji({start:startEl.value, end:endEl.value});
		}
	}

	// Init
	function init(){
		initTheme();
		load();
		initTabs();
		byId('themeToggle').addEventListener('click', ()=>{
			const cur = document.documentElement.getAttribute('data-theme')||'dark';
			setTheme(cur==='dark'?'light':'dark');
		});
		// Forms
		handleStudentForm();
		handleSessionForm();
		handlePaymentForm();
		// Filters
		const today = new Date().toISOString().slice(0,10);
		// default ranges: this month
		const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
		['sessionStartFilter','paymentStartFilter','reportStart'].forEach(id=>{ const el=byId(id); if(el) el.value = monthStart; });
		['sessionEndFilter','paymentEndFilter','reportEnd'].forEach(id=>{ const el=byId(id); if(el) el.value = today; });
		['sessionStartFilter','sessionEndFilter'].forEach(id=>{ const el=byId(id); if(el) el.addEventListener('change', renderSessions); });
		['paymentStartFilter','paymentEndFilter'].forEach(id=>{ const el=byId(id); if(el) el.addEventListener('change', renderPayments); });
		byId('refreshReport').addEventListener('click', renderReports);
		// Chart timeframe buttons
		document.querySelectorAll('.btn-group .chip-btn').forEach(btn=>{
			btn.addEventListener('click', ()=>{
				document.querySelectorAll('.btn-group .chip-btn').forEach(b=>b.classList.remove('active'));
				btn.classList.add('active');
				renderDashboard();
			});
		});
		initExport();
		refreshAll();
	}

	document.addEventListener('DOMContentLoaded', init);
})();


