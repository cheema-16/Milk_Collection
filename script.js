/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const KEY = 'cheemaMilkDB';
let db = load();
let view = { mode: 'today', offset: 0 }; // dashboard always opens on Today
let session = null; // logged-in user: { role: 'admin' | 'employee', user, name }

function load() {
    try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.entries) return d; } catch (e) { }
    return { sellers: [], buyers: [], entries: [], settings: { tsRate: 12 }, dark: false };
}
function save() { localStorage.setItem(KEY, JSON.stringify(db)); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const money = n => 'Rs. ' + Math.round(n).toLocaleString('en-PK');
const lit = n => (Math.round(n * 100) / 100).toLocaleString('en-PK') + ' L';
const longDate = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayStr = () => fmt(new Date());
const nowShift = () => (new Date().getHours() < 12 ? 'morning' : 'evening');
const sum = (arr, f) => arr.reduce((a, e) => a + f(e), 0);
const rateFor = (fat, snf) => (Number(fat) + Number(snf)) * db.settings.tsRate;

/* ---------- Role helpers (Admin sees everything, Employee only own work, litres only) ---------- */
const SHIFT_SETS = { both: ['morning', 'evening'], morning: ['morning'], afternoon: ['afternoon'], evening: ['evening'], all: ['morning', 'afternoon', 'evening'] };
const isEmp = () => !!session && session.role === 'employee';
const curEmp = () => (isEmp() ? (db.employees || []).find(e => e.username === session.user) || null : null);
const empShifts = () => { const e = curEmp(); return e ? (SHIFT_SETS[e.shift] || SHIFT_SETS.both) : ['morning', 'afternoon', 'evening']; };
const scopeSellers = () => { const e = curEmp(); return !isEmp() ? db.sellers : db.sellers.filter(s => e && (e.customers || []).includes(s.id)); };
const inScope = pid => !isEmp() || scopeSellers().some(s => s.id === pid);
// Employees see buy entries of their assigned customers, whoever recorded them (admin entries show up too), plus their own
const scopeEntries = list => {
    if (!isEmp()) return list;
    const mine = new Set((curEmp() || {}).customers || []);
    return list.filter(e => e.type === 'buy' && (mine.has(e.personId) || e.by === session.user));
};
const stamp = () => ({ by: session ? session.user : 'admin', byName: session ? session.name : 'Admin' });
const canEditEntry = e => !isEmp() || (e.by === session.user && e.date === todayStr());

function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2000);
}

/* ---------- Week logic (Monday evening -> next Monday morning) ---------- */
function weekStart(ds, shift) {
    const d = parse(ds);
    const dow = (d.getDay() + 6) % 7; // Monday = 0
    let s = addDays(d, -dow);
    if (dow === 0 && shift === 'morning') s = addDays(s, -7);
    return fmt(s);
}

function getRange(v = view) {
    const today = todayStr();
    if (v.mode === 'today') {
        const off = Math.min(0, v.offset || 0), day = addDays(new Date(), off), ds = fmt(day);
        const prefix = off === 0 ? 'Today' : off === -1 ? 'Yesterday' : day.toLocaleDateString('en-GB', { weekday: 'long' });
        return { label: prefix + ' · ' + longDate(day), short: off === 0 ? 'Today' : off === -1 ? 'Yesterday' : shortDate(ds), test: e => e.date === ds };
    }
    if (v.mode === 'month') {
        const n = new Date(), ym = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
        return { label: 'This Month · ' + n.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), short: 'This month', test: e => e.date.startsWith(ym) };
    }
    const base = parse(weekStart(today, nowShift()));
    const start = addDays(base, v.offset * 7), end = addDays(start, 7);
    return {
        label: `Monday evening – Monday morning · ${longDate(start)} – ${longDate(end)}`,
        short: 'Selected week', start, test: e => weekStart(e.date, e.shift) === fmt(start)
    };
}

/* ---------- Dashboard render ---------- */
function render() {
    const r = getRange();
    const rows = scopeEntries(db.entries).filter(r.test);
    const buy = rows.filter(e => e.type === 'buy'), sell = rows.filter(e => e.type === 'sell');
    const t = todayStr(), todayRows = scopeEntries(db.entries).filter(e => e.date === t);
    const todayBuy = todayRows.filter(e => e.type === 'buy');

    $('#todayDate').textContent = new Date().toDateString();
    $('#rangeLabel').textContent = r.label;
    document.querySelectorAll('.selLabel').forEach(x => x.textContent = r.short);
    ['prevWeek', 'nextWeek', 'curWeek', 'thisMonth', 'todayBtn'].forEach(id => $('#' + id).classList.remove('active'));
    $('#dayNav').hidden = view.mode !== 'today';
    $('#nextDay').disabled = view.mode === 'today' && (view.offset || 0) >= 0;
    $('#' + (view.mode === 'month' ? 'thisMonth' : view.mode === 'today' ? 'todayBtn' : view.offset === 0 ? 'curWeek' : view.offset < 0 ? 'prevWeek' : 'nextWeek')).classList.add('active');

    const total = sum(buy, e => e.litres);
    $('#heroTotal').textContent = lit(total);
    $('#heroSub').textContent = 'Milk collected · ' + r.short.toLowerCase();
    $('#stCustomers').textContent = isEmp() ? scopeSellers().length : db.sellers.length; // customers who supply milk (buyers are not counted)
    $('#stCustLbl').textContent = isEmp() ? 'My Customers' : 'Total Customers';
    $('#stMorning').textContent = lit(sum(buy.filter(e => e.shift === 'morning'), e => e.litres));
    $('#stEvening').textContent = lit(sum(buy.filter(e => e.shift === 'evening'), e => e.litres));
    $('#stTodayAmt').textContent = money(sum(todayBuy, custAmount));
    $('#stAdvance').textContent = money(todayAdvanceDeduction());
    $('#stSold').textContent = lit(sum(sell, e => e.litres));
    const pur = sum(buy, entryAmount), sal = sum(sell, entryAmount);
    $('#stPurchase').textContent = money(pur);
    $('#stProfit').textContent = money(sal - pur);

    renderChart(r);
    renderEntries();
    refreshSellBuyers(); // keeps the Sell Milk buyer dropdown up to date
    refreshRateCustomers(); // keeps the Rate Management customer list up to date
    renderPay(); // Payment Management (only while the page is open)
    tcRender(); // Total Milk Collection page (only while the page is open)
    salesRender(); // Total Sales page (only while the page is open)
}

function todayAdvanceDeduction() {
    if (isEmp()) return 0;
    const isWeekEnd = new Date().getDay() === 1; // Monday = week-ending day
    if (!isWeekEnd) return 0;
    // Advance deducted from the payment of the week that ended on Monday morning (on Monday evening: the previous week)
    return sum(pmData(nowShift() === 'morning' ? 0 : -1).data, d => d.cut);
}

function renderChart(r) {
    const days = [];
    const startDate = r.start ? r.start : addDays(new Date(), -6);
    for (let i = 0; i < 7; i++) days.push(addDays(startDate, i));
    const vals = days.map(d => sum(scopeEntries(db.entries).filter(e => e.type === 'buy' && e.date === fmt(d)), e => e.litres));
    const max = Math.max(...vals, 1);
    $('#chart').innerHTML = days.map((d, i) =>
        `<div style="height:${Math.max(vals[i] / max * 100, 3)}%"><b>${vals[i] ? Math.round(vals[i]) : ''}</b><span>${d.toLocaleDateString('en-GB', { weekday: 'short' })}</span></div>`).join('');
}

function personName(e) {
    const list = e.type === 'buy' ? db.sellers : db.buyers;
    const p = list.find(x => x.id === e.personId);
    return p ? p.name : '(deleted)';
}

function renderEntries() {
    const q = $('#searchBox').value.trim().toLowerCase();
    const rows = scopeEntries(db.entries).slice().sort((a, b) => (b.date + b.ts).localeCompare(a.date + a.ts))
        .filter(e => !q || personName(e).toLowerCase().includes(q)).slice(0, 15);
    $('#entriesBody').innerHTML = rows.length ? rows.map(e => `
        <tr><td>${e.date.slice(5)}</td><td>${esc(personName(e))}${isEmp() ? (e.by === 'admin' ? '<small class="by-tag">by Admin</small>' : '') : (e.by && e.by !== 'admin' ? `<small class="by-tag">by ${esc(e.byName || e.by)}</small>` : '')}</td>
        <td class="adm-only"><span class="badge ${e.type}">${e.type === 'buy' ? 'Buy' : 'Sell'}</span></td>
        <td>${{ morning: '🌅', afternoon: '☀️', evening: '🌇' }[e.shift] || '🌇'}</td><td>${lit(e.litres)}</td><td class="adm-only">${money(entryAmount(e))}</td>
        <td>${canEditEntry(e) ? `<button class="del" onclick="delEntry('${e.id}')">✕</button>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="7" style="text-align:center">No entries found</td></tr>';
}

function delEntry(id) {
    const en = db.entries.find(e => e.id === id);
    if (!en) return;
    if (!canEditEntry(en)) return toast('You can only delete your own entries from today');
    if (!confirm('Delete this entry?')) return;
    db.entries = db.entries.filter(e => e.id !== id); save(); render(); toast('Entry deleted');
}

/* ---------- Menu / modal ---------- */
function toggleMenu() { $('#sidebar').classList.toggle('active'); $('#backdrop').classList.toggle('show'); }
function closeAll() { $('#sidebar').classList.remove('active'); $('#backdrop').classList.remove('show'); }
function openModal(title, html) {
    closeAll();
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
    $('#modal').classList.add('show'); $('#overlay').classList.add('show');
}
function closeModal() { $('#modal').classList.remove('show'); $('#overlay').classList.remove('show'); }

/* logout() is defined in the Login section below */

const actions = {
    dashboard() { closeAll(); closeModal(); showDashboard(); window.scrollTo({ top: 0, behavior: 'smooth' }); },
    seller() { peopleModal('seller'); },
    buyer() { peopleModal('buyer'); },
    system: systemModal, payment: openPayPage, print: printModal, backup: backupModal,
    buy() { buyMilkModal(); }, sell() { openSellPage(); }, manual() { openManualPage(); },
    rate: rateModal, rates: openRatePage, ts: openTsPage
};
document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-action]');
    if (!el) return;
    ev.preventDefault();
    actions[el.dataset.action]();
});

/* ---------- Seller / Buyer ---------- */
function peopleModal(kind) {
    if (kind === 'seller') return sellerModal(); // new Add Seller form
    const list = kind === 'seller' ? db.sellers : db.buyers;
    const isS = kind === 'seller';
    openModal(isS ? '👤 Sellers (Farmers)' : '🛒 Buyers', `
        <label>Name</label><input id="pName" placeholder="Name">
        <label>Phone</label><input id="pPhone" type="tel" placeholder="03xx-xxxxxxx">
        ${isS ? `<div class="row2"><div><label>Advance (Rs)</label><input id="pAdv" type="number" value="0"></div>
        <div><label>Weekly Deduction (Rs)</label><input id="pWeek" type="number" value="0"></div></div>` : ''}
        <button class="btn" onclick="addPerson('${kind}')">➕ Save</button>
        <div class="table-wrap" style="margin-top:16px"><table>
        <tr><th>Name</th><th>Phone</th>${isS ? '<th>Advance</th>' : ''}<th></th></tr>
        ${list.map(p => `<tr><td>${esc(p.name)}</td><td>${esc(p.phone || '-')}</td>${isS ? `<td>${money(p.advance || 0)}</td>` : ''}
        <td><button class="del" onclick="delPerson('${kind}','${p.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="4">Nothing yet</td></tr>'}
        </table></div>`);
}
function addPerson(kind) {
    const name = $('#pName').value.trim();
    if (!name) return toast('Enter a name');
    const p = { id: uid(), name, phone: $('#pPhone').value.trim() };
    if (kind === 'seller') { p.advance = +$('#pAdv').value || 0; p.weekly = +$('#pWeek').value || 0; db.sellers.push(p); }
    else db.buyers.push(p);
    save(); render(); peopleModal(kind); toast('Saved ✔');
}
function delPerson(kind, id) {
    if (!confirm('Delete this record?')) return;
    if (kind === 'seller') db.sellers = db.sellers.filter(p => p.id !== id); else db.buyers = db.buyers.filter(p => p.id !== id);
    save(); render(); peopleModal(kind);
}

/* ---------- Buy / Sell / Manual entry ---------- */
function opts(type) {
    const list = type === 'buy' ? db.sellers : db.buyers;
    return list.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
}
function entryModal(type, manual) {
    const title = manual ? '✍️ Manual Entry' : type === 'buy' ? '🥛 Buy Milk' : '💵 Sell Milk';
    const list = type === 'buy' ? db.sellers : db.buyers;
    if (!manual && !list.length) {
        return openModal(title, `<p>Please add a ${type === 'buy' ? 'seller' : 'buyer'} first.</p>
        <button class="btn" onclick="actions.${type === 'buy' ? 'seller' : 'buyer'}()">Add ${type === 'buy' ? 'Seller' : 'Buyer'}</button>`);
    }
    openModal(title, `
        ${manual ? `<div class="row2"><div><label>Type</label><select id="eType" onchange="swapPeople()"><option value="buy">Buy (from Seller)</option><option value="sell">Sell (to Buyer)</option></select></div>
        <div><label>Date</label><input id="eDate" type="date" value="${todayStr()}"></div></div>` : `<input id="eType" type="hidden" value="${type}">`}
        <label>${type === 'buy' ? 'Seller' : 'Buyer'}</label><select id="ePerson">${opts(type)}</select>
        <label>Shift</label><select id="eShift"><option value="morning" ${nowShift() === 'morning' ? 'selected' : ''}>🌅 Morning</option><option value="evening" ${nowShift() === 'evening' ? 'selected' : ''}>🌇 Evening</option></select>
        <div class="row2"><div><label>Milk (Litres)</label><input id="eLit" type="number" step="0.01" oninput="calcEntry()"></div>
        <div><label>Rate (Rs/L)</label><input id="eRate" type="number" step="0.01" oninput="calcEntry()"></div></div>
        ${type === 'buy' || manual ? `<div class="row2"><div><label>Fat %</label><input id="eFat" type="number" step="0.1" oninput="autoRate()"></div>
        <div><label>SNF %</label><input id="eSnf" type="number" step="0.1" oninput="autoRate()"></div></div>
        <p class="note">The rate is calculated automatically from Fat + SNF (per the Rate List). You can also change the rate manually.</p>` : ''}
        <div class="result" id="eTotal">Total: Rs. 0</div>
        <button class="btn green" onclick="saveEntry()">✔ Save Entry</button>`);
}
function swapPeople() { $('#ePerson').innerHTML = opts($('#eType').value) || '<option value="">-- add one first --</option>'; }
function autoRate() {
    const f = $('#eFat').value, s = $('#eSnf').value;
    if (f && s) { $('#eRate').value = rateFor(f, s).toFixed(2); calcEntry(); }
}
function calcEntry() { $('#eTotal').textContent = 'Total: ' + money((+$('#eLit').value || 0) * (+$('#eRate').value || 0)); }
function saveEntry() {
    const type = $('#eType').value, personId = $('#ePerson').value;
    const litres = +$('#eLit').value, rate = +$('#eRate').value;
    if (!personId) return toast('Select a seller/buyer');
    if (!litres || litres <= 0) return toast('Enter milk litres');
    db.entries.push({
        id: uid(), ts: String(Date.now()), type, personId, date: $('#eDate') ? $('#eDate').value : todayStr(),
        shift: $('#eShift').value, litres, fat: +($('#eFat') && $('#eFat').value) || 0, snf: +($('#eSnf') && $('#eSnf').value) || 0,
        rate, amount: litres * rate
    });
    save(); render(); closeModal(); toast('Entry saved ✔');
}

/* ---------- Rate list & TS calculator ---------- */
function rateModal() {
    const snfs = [8, 8.5, 9], fats = [3.5, 4, 4.5, 5, 5.5, 6, 7];
    openModal('📈 Rate List', `
        <label>Rate per 1 TS point (Rs)</label><input id="tsRate" type="number" step="0.1" value="${db.settings.tsRate}">
        <button class="btn" onclick="saveRate()">Save Rate</button>
        <p class="note">Formula: Rate/L = (Fat + SNF) × TS rate</p>
        <div class="table-wrap" style="margin-top:12px"><table><tr><th>Fat \\ SNF</th>${snfs.map(s => `<th>${s}</th>`).join('')}</tr>
        ${fats.map(f => `<tr><td><b>${f}</b></td>${snfs.map(s => `<td>${Math.round(rateFor(f, s))}</td>`).join('')}</tr>`).join('')}</table></div>`);
}
function saveRate() { db.settings.tsRate = +$('#tsRate').value || 12; save(); toast('Rate saved ✔'); rateModal(); }

/* Weekly farmer payments now live on the Payment Management page (below) */

/* ---------- PDF / Print report ---------- */
function printModal() {
    const r = getRange();
    const rows = db.entries.filter(r.test).sort((a, b) => a.date.localeCompare(b.date));
    openModal('📄 Report – PDF / Print', `
        <p class="note">${r.label}</p>
        <div class="table-wrap"><table><tr><th>Date</th><th>Name</th><th>Type</th><th>Shift</th><th>Milk</th><th>Rate</th><th>Amount</th></tr>
        ${rows.map(e => `<tr><td>${e.date}</td><td>${esc(personName(e))}</td><td>${e.type}</td><td>${e.shift}</td><td>${lit(e.litres)}</td><td>${Math.round(entryRate(e))}</td><td>${money(entryAmount(e))}</td></tr>`).join('') || '<tr><td colspan="7">No entries in this period</td></tr>'}</table></div>
        <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
        <button class="btn green" onclick="exportCSV()">⬇️ Excel (CSV) Download</button>`);
}
function exportCSV() {
    const r = getRange(), rows = db.entries.filter(r.test);
    const csv = ['Date,Name,Type,Shift,Litres,Rate,Amount']
        .concat(rows.map(e => [e.date, `"${personName(e)}"`, e.type, e.shift, e.litres, entryRate(e), Math.round(entryAmount(e) * 100) / 100].join(','))).join('\n');
    download('milk-report.csv', csv, 'text/csv');
}
// Saves a file. In the Android app it opens the phone's Share sheet (WhatsApp, Drive, Files...);
// in a normal browser it downloads the file.
async function download(name, text, type) {
    try {
        const cap = window.Capacitor, P = cap && cap.Plugins;
        if (cap && cap.isNativePlatform && cap.isNativePlatform() && P && P.Filesystem && P.Share) {
            const r = await P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
            await P.Share.share({ title: name, url: r.uri, dialogTitle: 'Save or send file' });
            return;
        }
    } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
}

/* ---------- Backup ---------- */
function backupModal() {
    openModal('💾 Backup', `
        <button class="btn" onclick="exportBackup()">⬇️ Backup (save / share file)</button>
        <label style="margin-top:18px">Backup Restore</label>
        <input type="file" id="restoreFile" accept=".json" onchange="restoreBackup(this)">
        <p class="note">Restoring replaces the current data. Take a backup at least once a week.</p>`);
}
function exportBackup() { download(`cheema-milk-backup-${todayStr()}.json`, JSON.stringify(db), 'application/json'); toast('Backup ready'); }
function restoreBackup(inp) {
    const f = inp.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
        try {
            const d = JSON.parse(rd.result);
            if (!d.entries || !d.sellers) throw 0;
            if (confirm('Replace the current data?')) { db = d; save(); render(); closeModal(); toast('Restored ✔'); }
        } catch (e) { toast('Invalid file'); }
    };
    rd.readAsText(f);
}

/* ---------- System ---------- */
function systemModal() {
    const admin = !session || session.role === 'admin';
    openModal('⚙️ System', `
        ${admin ? `<div class="sys-box">
            <label for="sysTs">📈 TS Rate (Rs per 1 TS point)</label>
            <div class="sys-row"><input id="sysTs" type="number" step="0.1" min="0" value="${db.settings.tsRate}">
            <button class="btn green" onclick="saveTsRate()">Save</button></div>
            <small class="note">Formula: Rate/L = (Fat + SNF) × TS rate</small>
            <button class="btn sys-link" onclick="rateModal()">📋 View Rate List</button>
        </div>` : ''}
        <div class="sys-box sys-dark">
            <div><b>🌙 Dark Mode</b><small class="note">Easier on the eyes at night</small></div>
            <button class="sys-switch" id="darkSwitch" role="switch" aria-checked="${!!db.dark}" aria-label="Dark mode" onclick="toggleDark()"><i></i></button>
        </div>
        <div class="sys-box">
            <b>🔑 Change Password</b><small class="note">Update the password you use to log in</small>
            <button class="btn sys-link" onclick="changePwModal()">Change Password</button>
        </div>
        ${admin ? `<button class="btn red" onclick="clearAll()">🗑️ Delete all data</button>
        <p class="note">Entries: ${db.entries.length} · Sellers: ${db.sellers.length} · Buyers: ${db.buyers.length}</p>` : ''}`);
}
function saveTsRate() {
    const v = parseFloat($('#sysTs').value);
    if (!(v > 0)) { toast('Enter a valid TS rate'); return; }
    db.settings.tsRate = v; save(); render(); toast('TS rate saved ✔'); systemModal();
}
function applyDark() { document.body.classList.toggle('dark', !!db.dark); }
function toggleDark() {
    db.dark = !db.dark; save(); applyDark();
    const b = $('#darkSwitch'); if (b) b.setAttribute('aria-checked', !!db.dark);
}
function clearAll() {
    if (confirm('All data will be deleted. Take a backup first. Are you sure?')) {
        db = { sellers: [], buyers: [], entries: [], settings: db.settings, dark: db.dark }; save(); render(); closeModal(); toast('Data clear');
    }
}

/* ---------- Add New Seller form ---------- */
const SHIFTS = {
    both: 'Both (Morning + Evening)',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    all: 'All Shifts (Morning + Afternoon + Evening)'
};

function sellerModal() {
    openModal('👤 Add New Seller', `
        <div class="form-hero"><span>🧑‍🌾</span><div><b>Register a New Seller</b><p>Enter the farmer's basic details and milk shift</p></div></div>
        <form id="sellerForm" class="seller-form" onsubmit="return addSeller(event)" novalidate>
            <div class="field">
                <label for="sName">Seller Name <i>*</i></label>
                <input id="sName" placeholder="Farmer's name" autocomplete="off" oninput="clearErr('sName')">
                <small class="err" id="eName"></small>
            </div>
            <div class="field">
                <label for="sPhone">Phone Number <i>*</i></label>
                <input id="sPhone" type="tel" inputmode="numeric" maxlength="15" placeholder="03xx-xxxxxxx" autocomplete="off" oninput="clearErr('sPhone')">
                <small class="err" id="ePhone"></small>
            </div>
            <div class="field">
                <label for="sShift">Milk Collection Shift <i>*</i></label>
                <select id="sShift" onchange="clearErr('sShift')">
                    <option value="">-- Select shift --</option>
                    ${Object.entries(SHIFTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
                <small class="err" id="eShift"></small>
            </div>
            <button type="submit" class="btn">➕ Add Seller</button>
        </form>
        <h4 class="list-title">Saved Sellers (${db.sellers.length})</h4>
        <div class="table-wrap"><table>
            <tr><th>Name</th><th>Phone</th><th>Shift</th><th></th></tr>
            ${db.sellers.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone || '-')}</td><td>${esc(SHIFTS[s.shift] || '-')}</td>
            <td><button class="del" onclick="delPerson('seller','${s.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="4">No sellers yet</td></tr>'}
        </table></div>`);
}

function clearErr(id) {
    const el = $('#' + id); if (el) el.classList.remove('invalid');
    const err = $('#e' + id.slice(1)); if (err) err.textContent = '';
}
function setErr(id, msg) {
    $('#' + id).classList.add('invalid');
    $('#e' + id.slice(1)).textContent = msg;
}
function normalizePhone(raw) {
    let d = raw.replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('92')) d = '0' + d.slice(2);
    return d;
}

function addSeller(ev) {
    ev.preventDefault();
    const name = $('#sName').value.trim().replace(/\s+/g, ' ');
    const phone = normalizePhone($('#sPhone').value.trim());
    const shift = $('#sShift').value;
    let ok = true;

    if (name.length < 2) { setErr('sName', 'Seller name is required'); ok = false; }
    if (!$('#sPhone').value.trim()) { setErr('sPhone', 'Phone number is required'); ok = false; }
    else if (!/^03\d{9}$/.test(phone)) { setErr('sPhone', 'Enter a valid number (e.g. 03001234567)'); ok = false; }
    else if (db.sellers.some(s => s.phone === phone)) { setErr('sPhone', 'This number is already saved'); ok = false; }
    if (!shift) { setErr('sShift', 'Select the milk collection shift'); ok = false; }
    if (!ok) return false;

    db.sellers.push({ id: uid(), name, phone, shift, advance: 0 });
    save(); render(); sellerModal(); toast('Seller added ✔');
    return false;
}

/* ---------- Buy Milk (Milk Collection Entry) ---------- */
const SHIFT_OPTIONS = {
    both: ['morning', 'evening'],
    morning: ['morning'],
    afternoon: ['afternoon'],
    evening: ['evening'],
    all: ['morning', 'afternoon', 'evening']
};
const SHIFT_NAMES = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

// Sellers the current user may collect from (employee: assigned customers whose shift matches the employee's shift)
const buySellers = () => scopeSellers().filter(s => !isEmp() || (SHIFT_OPTIONS[s.shift] || SHIFT_OPTIONS.both).some(k => empShifts().includes(k)));
const buyShiftList = s => (SHIFT_OPTIONS[SHIFT_OPTIONS[s.shift] ? s.shift : 'both']).filter(k => !isEmp() || empShifts().includes(k));

function buyMilkModal() {
    if (!buySellers().length) {
        return openModal('🥛 Buy Milk', isEmp()
            ? `<p>No customers are assigned to you for your shift yet. Please contact the Admin.</p>`
            : `<p>Please add a seller first.</p><button class="btn" onclick="actions.seller()">➕ Add Seller</button>`);
    }
    openModal('🥛 Buy Milk', `
        <div class="form-hero"><span>🥛</span><div><b>Milk Collection Entry</b><p>Select a seller and enter the milk quantity</p></div></div>
        <form id="buyForm" class="seller-form" onsubmit="return saveBuyMilk(event)" novalidate>
            <div class="field">
                <label for="bSeller">Select Seller <i>*</i></label>
                <select id="bSeller" onchange="onBuySeller()">
                    <option value="">-- Select seller --</option>
                    ${buySellers().map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
                </select>
                <small class="note" id="bShiftInfo"></small>
                <small class="err" id="eSeller"></small>
            </div>
            <div class="field">
                <label for="bShift">Shift <i>*</i></label>
                <select id="bShift" disabled onchange="clearErr('bShift')">
                    <option value="">-- Select a seller first --</option>
                </select>
                <small class="err" id="eShift"></small>
            </div>
            <div class="field">
                <label for="bLit">Milk (Liters) <i>*</i></label>
                <input id="bLit" type="number" step="0.01" min="0" inputmode="decimal" placeholder="e.g. 12.5" oninput="clearErr('bLit')">
                <small class="err" id="eLit"></small>
            </div>
            <button type="submit" class="btn">✔ Save Entry</button>
        </form>`);
}

function onBuySeller() {
    clearErr('bSeller');
    const s = buySellers().find(x => x.id === $('#bSeller').value);
    const sel = $('#bShift');
    if (!s) {
        sel.disabled = true;
        sel.innerHTML = '<option value="">-- Select a seller first --</option>';
        $('#bShiftInfo').textContent = '';
        return;
    }
    const hasShift = !!SHIFT_OPTIONS[s.shift];
    const key = hasShift ? s.shift : 'both'; // default for older sellers (no shift saved)
    const list = buyShiftList(s);
    $('#bShiftInfo').textContent = 'Saved shift: ' + SHIFTS[key] + (hasShift ? '' : ' (default)');
    const pre = list.includes(nowShift()) ? nowShift() : (list.length === 1 ? list[0] : '');
    sel.disabled = false;
    sel.innerHTML = (list.length > 1 ? '<option value="">-- Select shift --</option>' : '') +
        list.map(k => `<option value="${k}" ${k === pre ? 'selected' : ''}>${SHIFT_NAMES[k]}</option>`).join('');
    clearErr('bShift');
}

function saveBuyMilk(ev) {
    ev.preventDefault();
    const s = buySellers().find(x => x.id === $('#bSeller').value);
    const shift = $('#bShift').value;
    const litres = parseFloat($('#bLit').value);
    let ok = true;
    if (!s) { setErr('bSeller', 'Select a seller'); ok = false; }
    if (!shift) { setErr('bShift', 'Select a shift'); ok = false; }
    if (!(litres > 0)) { setErr('bLit', 'Enter a valid quantity in litres (greater than 0)'); ok = false; }
    if (!ok) return false;

    const now = new Date();
    db.entries.push({
        id: uid(), ts: String(now.getTime()), type: 'buy',
        personId: s.id, sellerName: s.name, shift,
        litres: Math.round(litres * 100) / 100,
        date: fmt(now), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, createdAt: now.toISOString(),
        fat: 0, snf: 0, rate: 0, amount: 0, ...stamp()
    });
    save(); render(); buyMilkModal();
    toast(`${s.name} · ${lit(litres)} saved ✔`);
    return false;
}

/* ---------- Manual Entry page (date-wise register) ---------- */
const manual = { date: todayStr(), week: false, morning: true, evening: true };
const MSH = { morning: '🌅 Morning', evening: '🌇 Evening' };

const activeShifts = () => ['morning', 'evening'].filter(s => manual[s]);
function weekDays(ds) {
    const d = parse(ds), dow = (d.getDay() + 6) % 7, s = addDays(d, -dow);
    return Array.from({ length: 7 }, (_, i) => fmt(addDays(s, i)));
}
const manualDays = () => manual.week ? weekDays(manual.date) : [manual.date];
const shortDate = ds => parse(ds).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

function openManualPage() {
    closeAll(); closeModal();
    manual.date = todayStr(); manual.week = false; // always start from today's date
    showPage('manualPage');
    renderManual(); window.scrollTo(0, 0);
}
// Only one page is visible at a time (dashboard or another page)
const PAGES = ['dashPage', 'manualPage', 'sellPage', 'ratePage', 'tsPage', 'payPage'];
function showPage(id) { PAGES.forEach(p => { $('#' + p).hidden = p !== id; }); }
function showDashboard() { view = { mode: 'today', offset: 0 }; showPage('dashPage'); render(); } // whenever the dashboard opens: Today

function manualMove(dir) { manual.date = fmt(addDays(parse(manual.date), manual.week ? dir * 7 : dir)); renderManual(); }
function manualCurrent() { manual.date = todayStr(); renderManual(); }
function manualToggleWeek() { manual.week = !manual.week; renderManual(); }
function manualShift(s) {
    const other = s === 'morning' ? 'evening' : 'morning';
    if (manual[s] && !manual[other]) return toast('Keep at least one shift selected');
    manual[s] = !manual[s]; renderManual();
}

/* data helpers (uses db.entries, type 'buy') */
const cellEntries = (pid, d, s) => db.entries.filter(e => e.type === 'buy' && e.personId === pid && e.date === d && e.shift === s);
function cellValue(pid, d, s) {
    const m = cellEntries(pid, d, s);
    return m.length ? String(Math.round(sum(m, e => e.litres) * 100) / 100) : ''; // empty = no entry (not zero)
}
const sumCell = (d, s) => sum(db.entries.filter(e => e.type === 'buy' && e.date === d && e.shift === s && inScope(e.personId)), e => e.litres);
// Employee can edit only today, only own shift, only assigned customers
const canEditCell = (pid, d, s) => !isEmp() || (d === todayStr() && empShifts().includes(s) && inScope(pid));

function cleanNum(s) {
    let t = s.replace(/[^0-9.]/g, '');
    const i = t.indexOf('.');
    if (i >= 0) t = t.slice(0, i + 1) + t.slice(i + 1).replace(/\./g, '');
    const m = t.match(/^\d*(\.\d{0,2})?/);
    return (m ? m[0] : t).slice(0, 8);
}

function saveCell(pid, date, shift, raw) {
    const p = db.sellers.find(x => x.id === pid); if (!p) return;
    if (!canEditCell(pid, date, shift)) return;
    const v = parseFloat(raw);
    const m = cellEntries(pid, date, shift);
    if (raw === '' || isNaN(v)) {
        if (m.length) db.entries = db.entries.filter(e => !m.includes(e)); // cleared cell = delete the entry
    } else if (m.length) {
        m[0].litres = v; m[0].amount = v * (m[0].rate || 0);
        const extra = m.slice(1);
        if (extra.length) db.entries = db.entries.filter(e => !extra.includes(e));
    } else {
        const now = new Date();
        db.entries.push({
            id: uid(), ts: String(now.getTime()), type: 'buy', personId: pid, sellerName: p.name, shift, litres: v,
            date, time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, createdAt: now.toISOString(),
            fat: 0, snf: 0, rate: 0, amount: 0, ...stamp()
        });
    }
    save();
}

function cellInput(pid, d, s) {
    return `<input class="mp-in" inputmode="decimal" autocomplete="off" placeholder="—" value="${cellValue(pid, d, s)}" ${canEditCell(pid, d, s) ? '' : 'readonly tabindex="-1"'}
        data-pid="${pid}" data-date="${d}" data-shift="${s}" oninput="onCellInput(this)" onchange="onCellChange(this)" onfocus="this.select()">`;
}
function onCellInput(el) {
    const c = cleanNum(el.value); if (c !== el.value) el.value = c;
    clearTimeout(el._t);
    if (c !== '' && c !== '.') el._t = setTimeout(() => commitCell(el), 700); // auto save
}
function onCellChange(el) {
    clearTimeout(el._t);
    el.value = cleanNum(el.value); if (el.value === '.') el.value = '';
    commitCell(el);
}
function commitCell(el) {
    saveCell(el.dataset.pid, el.dataset.date, el.dataset.shift, el.value);
    el.classList.add('saved'); setTimeout(() => el.classList.remove('saved'), 1200);
    updateManualTotals(); render();
    const st = $('#mpStatus'); if (st) { st.textContent = 'Saved ✔'; setTimeout(() => { st.textContent = 'Auto-save is on'; }, 1500); }
}

function updateManualTotals() {
    const days = manualDays(), shifts = activeShifts();
    document.querySelectorAll('#manualPage [data-tot]').forEach(td => {
        const [d, s] = td.dataset.tot.split('|'); td.textContent = lit(sumCell(d, s));
    });
    document.querySelectorAll('#manualPage [data-rowtot]').forEach(td => {
        td.textContent = lit(sum(days.flatMap(d => shifts.map(s => cellEntries(td.dataset.rowtot, d, s))).flat(), e => e.litres));
    });
    const g = document.querySelector('#manualPage [data-grand]');
    if (g) g.textContent = lit(sum(days.flatMap(d => shifts.map(s => sumCell(d, s))), x => x));
}

function renderManual() {
    const days = manualDays(), shifts = activeShifts(), today = todayStr();
    const isCurrent = manual.week ? days.includes(today) : manual.date === today;
    const title = manual.week
        ? `7-Day Register · ${shortDate(days[0])} – ${shortDate(days[6])}`
        : parse(manual.date).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

    let table;
    if (!scopeSellers().length) {
        table = isEmp() ? `<p style="padding:18px">No customers are assigned to you yet. Please contact the Admin.</p>`
            : `<p style="padding:18px">Please add a seller first.</p><button class="btn" onclick="actions.seller()">➕ Add Seller</button>`;
    } else if (!manual.week) {
        table = `<table class="mp-table"><thead><tr><th style="width:44px">#</th><th style="text-align:left">Customer Name</th>
            ${shifts.map(s => `<th>${MSH[s]}</th>`).join('')}</tr></thead><tbody>
            ${scopeSellers().map((p, i) => `<tr><td>${i + 1}</td><td class="mp-name">${esc(p.name)}</td>
                ${shifts.map(s => `<td>${cellInput(p.id, manual.date, s)}</td>`).join('')}</tr>`).join('')}
            </tbody><tfoot><tr><td></td><td class="mp-name">Total</td>
            ${shifts.map(s => `<td data-tot="${manual.date}|${s}"></td>`).join('')}</tr></tfoot></table>`;
    } else {
        const dl = d => parse(d).toLocaleDateString('en-GB', { weekday: 'short' }) + '<br>' + parse(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        table = `<table class="mp-table mp-reg"><thead>
            <tr><th rowspan="2" class="s1">#</th><th rowspan="2" class="s2">Customer</th>
            ${days.map(d => `<th colspan="${shifts.length}" class="${d === today ? 'today' : ''}">${dl(d)}</th>`).join('')}
            <th rowspan="2">Total</th></tr>
            <tr>${days.map(d => shifts.map(s => `<th class="${d === today ? 'today' : ''}">${s === 'morning' ? 'M' : 'E'}</th>`).join('')).join('')}</tr>
            </thead><tbody>
            ${scopeSellers().map((p, i) => `<tr><td class="s1">${i + 1}</td><td class="mp-name s2">${esc(p.name)}</td>
                ${days.map(d => shifts.map(s => `<td>${cellInput(p.id, d, s)}</td>`).join('')).join('')}
                <td class="mp-rt" data-rowtot="${p.id}"></td></tr>`).join('')}
            </tbody><tfoot><tr><td class="s1"></td><td class="mp-name s2">Total</td>
            ${days.map(d => shifts.map(s => `<td data-tot="${d}|${s}"></td>`).join('')).join('')}
            <td data-grand></td></tr></tfoot></table>`;
    }

    $('#manualPage').innerHTML = `
        <div class="mp-top"><button class="mp-back" onclick="showDashboard()">← Dashboard</button><h2>✍️ Manual Entry</h2></div>
        <div class="mp-hero">
            <div class="mp-date">📅 ${title}</div>
            <div class="mp-nav">
                <button onclick="manualMove(-1)">← Previous</button>
                <button class="${isCurrent ? 'on' : ''}" onclick="manualCurrent()">Current</button>
                <button onclick="manualMove(1)">Forward →</button>
                <button class="${manual.week ? 'on' : ''}" onclick="manualToggleWeek()">7-Day Register</button>
            </div>
            <div class="mp-shifts">
                <button class="${manual.morning ? 'on' : ''}" onclick="manualShift('morning')">🌅 Morning</button>
                <button class="${manual.evening ? 'on' : ''}" onclick="manualShift('evening')">🌇 Evening</button>
            </div>
            <div class="mp-status" id="mpStatus">Auto-save is on</div>
            ${isEmp() ? '<div class="mp-status">You can edit today\'s entries for your own shift. Other days are view-only.</div>' : ''}
        </div>
        <div class="mp-card">${table}</div>`;
    updateManualTotals();
}

/* ---------- Sell Milk page ---------- */
let smEditing = null;      // id of the saved sale for the selected buyer/date/shift (used by Update)
let smLoaded = false;      // is a saved sale loaded in the form?
let smRateManual = false;  // true only for an older sale that has a rate saved on it (kept as is); new sales always follow Rate Management
const SM_FIELDS = ['Buyer', 'Volume', 'Fat', 'LR', 'Rate', 'Date', 'Shift'];

const smKey = (d, s) => d + (s === 'morning' ? '0' : '1'); // date + shift ordering
const smNum = id => { const v = parseFloat($('#' + id).value); return isNaN(v) ? 0 : v; };
const smR2 = n => Math.round(n * 100) / 100;
const smTwo = n => smR2(n).toFixed(2);

function smErr(name, msg) {
    const el = $('#sm' + name), er = $('#smErr' + name);
    if (el) el.classList.add('invalid');
    if (er) er.textContent = msg;
}
function smClear(name) {
    const el = $('#sm' + name), er = $('#smErr' + name);
    if (el) el.classList.remove('invalid');
    if (er) er.textContent = '';
}

function openSellPage() {
    closeAll(); closeModal();
    showPage('sellPage');
    refreshSellBuyers(); smReset(false); window.scrollTo(0, 0);
}

function refreshSellBuyers() {
    const sel = $('#smBuyer'); if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Select buyer --</option>' +
        db.buyers.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    sel.value = db.buyers.some(b => b.id === cur) ? cur : '';
    $('#smNoBuyer').hidden = db.buyers.length > 0;
    if (sel.value !== cur) smContext();
}

function smReset(keepDateShift) {
    ['smBuyer', 'smVolume', 'smFat', 'smLR', 'smRate'].forEach(id => { $('#' + id).value = ''; });
    if (!keepDateShift) { $('#smDate').value = todayStr(); $('#smShift').value = nowShift(); }
    SM_FIELDS.forEach(smClear);
    smRateManual = false; smLoaded = false; smEditing = null;
    smContext();
}

// When buyer / date / shift changes: find the saved sale, load the previous volume, set up the Update button
function smContext() {
    const b = $('#smBuyer').value, d = $('#smDate').value, s = $('#smShift').value;
    const ex = (b && d) ? db.entries.find(e => e.type === 'sell' && e.personId === b && e.date === d && e.shift === s) : null;
    if (ex) {
        $('#smVolume').value = ex.litres;
        $('#smFat').value = ex.fat || '';
        $('#smLR').value = ex.lr || '';
        $('#smRate').value = ex.rate > 0 ? ex.rate : '';
        smRateManual = ex.rate > 0; smLoaded = true;
        ['Volume', 'Fat', 'LR', 'Rate'].forEach(smClear);
    } else if (smLoaded) {
        ['smVolume', 'smFat', 'smLR', 'smRate'].forEach(id => { $('#' + id).value = ''; });
        smRateManual = false; smLoaded = false;
    }
    smEditing = ex ? ex.id : null;
    $('#smUpdate').disabled = !smEditing;
    $('#smStatus').textContent = smEditing
        ? '✏️ A sale is already saved for this buyer/date/shift — you can update it'
        : '🆕 New sale';
    smCalc(false);
}

// Same formulas as the TS Calculator:
//   SNF = (0.22 × Fat) + 0.72 + (0.25 × LR)
//   TS  = ((SNF + Fat) × Volume) ÷ 13
//   Amount = TS × Rate        (Rate = the buyer's rate from Rate Management for the selected date, 0 until one is set)
const smSnfOf = (fat, lr) => (0.22 * fat) + 0.72 + (0.25 * lr);
function smCalc(resetRate) {
    const vol = smNum('smVolume'), fat = smNum('smFat'), lr = smNum('smLR');
    const b = $('#smBuyer').value, has = fat > 0 && lr > 0;
    $('#smSnf').value = has ? smTwo(smSnfOf(fat, lr)) : '';
    const ts = (has && vol > 0) ? tsOf(fat, lr, vol) : null;
    $('#smTs').value = ts === null ? '' : smTwo(ts);
    if (resetRate) smRateManual = false;
    if (!smRateManual) $('#smRate').value = b ? smTwo(applicableRate(b, $('#smDate').value) || 0) : '';
    const rate = smNum('smRate');
    $('#smAmount').value = (b && ts !== null) ? smTwo(ts * rate) : '';
    const hint = $('#smRateHint');
    if (hint) hint.textContent = !b ? '' : (!smRateManual && rate === 0)
        ? '⚠ No rate is set for this buyer on this date. Set it in Rate Management; it will appear here automatically.'
        : 'Amount = TS × Rate. The rate comes from Rate Management and cannot be changed here.';
}

function smCollect() {
    SM_FIELDS.forEach(smClear);
    const b = $('#smBuyer').value, d = $('#smDate').value, s = $('#smShift').value;
    const vol = smNum('smVolume'), fat = smNum('smFat'), lr = smNum('smLR'), rate = smNum('smRate');
    let ok = true;
    if (!b || !db.buyers.some(x => x.id === b)) { smErr('Buyer', 'Select a buyer'); ok = false; }
    if (!(vol > 0)) { smErr('Volume', 'Enter the volume'); ok = false; }
    if (!(fat > 0)) { smErr('Fat', 'Enter the fat'); ok = false; }
    if (!(lr > 0)) { smErr('LR', 'Enter the LR'); ok = false; }
    if (!d) { smErr('Date', 'Select a date'); ok = false; }
    if (!ok) { toast('Please complete the required fields'); return null; }
    return { b, d, s, vol, fat, lr, rate, snf: smSnfOf(fat, lr), ts: tsOf(fat, lr, vol), manual: smRateManual && rate > 0 };
}

function smSave() {
    if (smEditing) return toast('This sale is already saved — use the Update button');
    const v = smCollect(); if (!v) return;
    const buyer = db.buyers.find(x => x.id === v.b), now = new Date();
    db.entries.push({
        id: uid(), ts: String(now.getTime()), type: 'sell', personId: v.b, buyerName: buyer.name,
        date: v.d, shift: v.s, litres: smR2(v.vol), fat: v.fat, lr: v.lr,
        snf: smR2(v.snf), totalSolids: v.ts,
        rate: v.manual ? v.rate : 0, amount: v.manual ? smR2(v.ts * v.rate) : 0, // follows Rate Management (an older sale keeps the rate saved on it)
        time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, createdAt: now.toISOString()
    });
    save(); render();
    toast(`${buyer.name} · ${lit(v.vol)} sale saved ✔` + (entryRate(db.entries[db.entries.length - 1]) > 0 ? '' : ' (rate not set yet)'));
    smReset(true); // date/shift stay the same for the next sale
}

function smUpdate() {
    if (!smEditing) return toast('First select the buyer, date and shift of a saved sale');
    const v = smCollect(); if (!v) return;
    const e = db.entries.find(x => x.id === smEditing);
    if (!e) return smContext();
    Object.assign(e, {
        litres: smR2(v.vol), fat: v.fat, lr: v.lr, snf: smR2(v.snf), totalSolids: v.ts,
        rate: v.manual ? v.rate : 0, amount: v.manual ? smR2(v.ts * v.rate) : 0, updatedAt: new Date().toISOString()
    });
    save(); render(); smContext(); toast('Sale updated ✔');
}

function initSellPage() {
    $('#smDate').value = todayStr(); $('#smShift').value = nowShift();
    ['smBuyer', 'smDate', 'smShift'].forEach(id => ['change', 'input'].forEach(ev => $('#' + id).addEventListener(ev, smContext)));
    ['smFat', 'smLR'].forEach(id => $('#' + id).addEventListener('input', () => smCalc(true)));
    $('#smVolume').addEventListener('input', () => smCalc(false));
    $('#smRateLink').addEventListener('click', () => { actions.rates(); rmSetParty('buyer'); });
    SM_FIELDS.forEach(n => {
        const el = $('#sm' + n);
        ['input', 'change'].forEach(ev => el.addEventListener(ev, () => smClear(n)));
    });
    $('#smSave').addEventListener('click', smSave);
    $('#smUpdate').addEventListener('click', smUpdate);
    $('#sellForm').addEventListener('submit', ev => ev.preventDefault());
}

/* ---------- Rate Management (customer-wise rate history) ---------- */
// db.rates = [{ id, batch, personId, rate, method, from, to, createdAt }]  -- older records are never deleted or overwritten
const rateStore = () => (db.rates = db.rates || []);
const RM_METHODS = { range: 'Date Range', single: 'Single Date', daily: 'Daily', permanent: 'Permanent' };

let rmParty = 'seller'; // 'seller' = Customers Rate (kharid), 'buyer' = Buyers Rate (sale)
const rmPeople = () => rmParty === 'buyer' ? db.buyers : db.sellers;

function rmSetParty(p) {
    rmParty = p;
    const buyer = p === 'buyer';
    $('#rmTabSeller').classList.toggle('on', !buyer);
    $('#rmTabBuyer').classList.toggle('on', buyer);
    $('#rmLegend').textContent = buyer ? 'Select Buyers' : 'Select Customers';
    $('#rmRateLbl').textContent = buyer ? 'Rate per TS (Rs.)' : 'Rate per Liter (Rs.)';
    $('#rmHeroText').textContent = buyer ? 'Set the selling rate for buyers' : 'Set the purchase rate for customers';
    $('#rmNoCustText').textContent = buyer ? 'No buyers saved yet.' : 'No customers saved yet.';
    const link = $('#rmAddLink');
    link.dataset.action = buyer ? 'buyer' : 'seller';
    link.textContent = buyer ? '+ Add Buyer' : '+ Add Seller';
    $('#rmList').innerHTML = ''; // clear the selection from the other type
    rmClear('Cust');
    refreshRateCustomers();
}

const rmLatest = list => list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

// Applicable rate for a customer on a given date (null if none found)
// Priority: Single/Daily (that day) > Date Range > Permanent (latest effective); within each group the newest rate wins
function applicableRate(pid, date) {
    const rows = rateStore().filter(r => r.personId === pid);
    const day = rows.filter(r => (r.method === 'single' || r.method === 'daily') && r.from === date);
    if (day.length) return rmLatest(day).rate;
    const rng = rows.filter(r => r.method === 'range' && r.from <= date && date <= r.to);
    if (rng.length) return rmLatest(rng).rate;
    const perm = rows.filter(r => r.method === 'permanent' && r.from <= date);
    if (perm.length) {
        const bestFrom = perm.map(r => r.from).sort().pop();
        return rmLatest(perm.filter(r => r.from === bestFrom)).rate;
    }
    return null;
}

// Rate of an entry: a rate typed on the entry itself wins; otherwise the Rate Management rate for that date.
// Until a rate is set in Rate Management it is 0, and it appears automatically as soon as one is applied.
const entryRate = e => e.rate > 0 ? e.rate : (applicableRate(e.personId, e.date) || 0);
// Total Solids of a sale (same formulas as the TS Calculator): SNF = (0.22 × Fat) + 0.72 + (0.25 × LR), TS = ((SNF + Fat) × Volume) ÷ 13
const tsOf = (fat, lr, litres) => Math.round((((0.22 * fat) + 0.72 + (0.25 * lr) + fat) * litres / 13) * 100) / 100;
const saleTs = e => (e.fat > 0 && e.lr > 0 && e.litres > 0) ? tsOf(e.fat, e.lr, e.litres) : 0;
// Entry amount: the saved amount if present, otherwise
//   purchases (customers): litres × rate        sales (buyers): TS × rate
const entryAmount = e => e.amount > 0 ? e.amount : Math.round((e.type === 'sell' ? saleTs(e) : e.litres) * entryRate(e) * 100) / 100;
const custAmount = entryAmount; // purchases (customers) use the same rule

function rmErr(name, msg) {
    const el = $('#rm' + name), er = $('#rmErr' + name);
    if (el) el.classList.add('invalid');
    if (er) er.textContent = msg;
}
function rmClear(name) {
    const el = $('#rm' + name), er = $('#rmErr' + name);
    if (el) el.classList.remove('invalid');
    if (er) er.textContent = '';
}

function openRatePage() {
    closeAll(); closeModal();
    showPage('ratePage');
    $('#rmRate').value = '';
    $('#rmMethod').value = 'range';
    $('#rmFrom').value = $('#rmTo').value = $('#rmDate').value = todayStr();
    $('#rmDone').hidden = true;
    $('#rmCurrent').textContent = `TS rate: Rs. ${db.settings.tsRate} / point`;
    ['Rate', 'From', 'To', 'Date', 'Cust'].forEach(rmClear);
    $('#rmList').querySelectorAll('.rm-cb').forEach(c => { c.checked = false; });
    rmSetParty('seller'); rmMethod(); rmHistory(); window.scrollTo(0, 0);
}

// Show/hide the date fields depending on the method
function rmMethod() {
    const m = $('#rmMethod').value;
    $('#rmRangeBox').hidden = m !== 'range';
    $('#rmSingleBox').hidden = m !== 'single';
    $('#rmMethodHint').textContent = {
        range: 'The rate applies between the selected From – To dates (both included)',
        single: 'The rate applies only on the selected date',
        daily: `The rate applies only to today (${shortDate(todayStr())})`,
        permanent: 'The rate applies from today onwards until a new rate is set (earlier dates keep their existing rate)'
    }[m];
    ['From', 'To', 'Date'].forEach(rmClear);
}

// List of db.sellers (existing customers) in the same order; checked selection is preserved
function refreshRateCustomers() {
    const box = $('#rmList'); if (!box) return;
    const checked = new Set([...box.querySelectorAll('.rm-cb:checked')].map(x => x.value));
    const today = todayStr();
    box.innerHTML = rmPeople().map(s => {
        const r = applicableRate(s.id, today);
        return `<label class="rm-check"><input type="checkbox" class="rm-cb" value="${s.id}" ${checked.has(s.id) ? 'checked' : ''}>
            <span class="rm-name">${esc(s.name)}</span><em class="rm-cur">${r ? 'Rs. ' + r : '—'}</em></label>`;
    }).join('');
    $('#rmNoCust').hidden = rmPeople().length > 0;
    rmSync();
}

// Keep Select All and the count in sync with the individual checkboxes
function rmSync() {
    const cbs = [...document.querySelectorAll('#rmList .rm-cb')], n = cbs.filter(c => c.checked).length;
    $('#rmAll').checked = cbs.length > 0 && n === cbs.length;
    $('#rmCount').textContent = `${n} / ${cbs.length} ${rmParty === 'buyer' ? 'buyers' : 'customers'} selected`;
}

function rmHistory() {
    const rows = rateStore().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
    const period = r => r.method === 'range' ? `${shortDate(r.from)} – ${shortDate(r.to)}`
        : r.method === 'permanent' ? `From ${shortDate(r.from)}` : shortDate(r.from);
    $('#rmHistory').innerHTML = rows.length ? rows.map(r => {
        const p = [...db.sellers, ...db.buyers].find(x => x.id === r.personId);
        const tag = r.party === 'buyer' ? 'Buyer' : 'Customer'; // older records (no party) = Customer
        return `<tr><td>${p ? esc(p.name) : '(deleted)'}<small class="rm-tag">${tag}</small></td><td><b>Rs. ${r.rate}</b></td><td>${RM_METHODS[r.method] || r.method}</td>
            <td>${period(r)}</td><td>${new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center">No rates applied yet</td></tr>';
}

function rmApply() {
    ['Rate', 'From', 'To', 'Date', 'Cust'].forEach(rmClear);
    const rate = parseFloat($('#rmRate').value), m = $('#rmMethod').value;
    const ids = [...document.querySelectorAll('#rmList .rm-cb:checked')].map(c => c.value);
    let from = '', to = '', ok = true;

    if (!(rate > 0)) { rmErr('Rate', 'Enter a rate (greater than 0)'); ok = false; }
    if (m === 'range') {
        from = $('#rmFrom').value; to = $('#rmTo').value;
        if (!from) { rmErr('From', 'Select a From date'); ok = false; }
        if (!to) { rmErr('To', 'Select a To date'); ok = false; }
        if (from && to && from > to) { rmErr('To', 'To date cannot be before From date'); ok = false; }
    } else if (m === 'single') {
        from = to = $('#rmDate').value;
        if (!from) { rmErr('Date', 'Select a date'); ok = false; }
    } else if (m === 'daily') {
        from = to = todayStr();
    } else {
        from = todayStr(); // permanent: from today onwards
    }
    if (!ids.length) { rmErr('Cust', `Select at least one ${rmParty === 'buyer' ? 'buyer' : 'customer'}`); ok = false; }
    if (!ok) return toast('Please complete the required fields');

    const batch = uid(), stamp = Date.now();
    ids.forEach((id, i) => rateStore().push({
        id: uid(), batch, party: rmParty, personId: id, rate: smR2(rate), method: m, from, to,
        createdAt: new Date(stamp + i).toISOString() // older records stay as they are, new ones are added
    }));
    save(); render(); rmHistory();

    const when = m === 'range' ? `${shortDate(from)} – ${shortDate(to)}`
        : m === 'permanent' ? `From ${shortDate(from)} (Permanent)` : shortDate(from);
    const msg = `✔ Rs. ${smR2(rate)} / L — ${ids.length} ${rmParty === 'buyer' ? 'buyer' : 'customer'}${ids.length > 1 ? 's' : ''} applied (${when})`;
    const done = $('#rmDone'); done.textContent = msg; done.hidden = false;
    toast('Rate applied ✔');
    $('#rmRate').value = '';
    $('#rmList').querySelectorAll('.rm-cb').forEach(c => { c.checked = false; });
    rmSync();
}

function initRatePage() {
    $('#rmTabSeller').addEventListener('click', () => rmSetParty('seller'));
    $('#rmTabBuyer').addEventListener('click', () => rmSetParty('buyer'));
    $('#rmMethod').addEventListener('change', rmMethod);
    $('#rmAll').addEventListener('change', () => {
        const on = $('#rmAll').checked;
        document.querySelectorAll('#rmList .rm-cb').forEach(c => { c.checked = on; });
        rmSync(); rmClear('Cust');
    });
    $('#rmList').addEventListener('change', () => { rmSync(); rmClear('Cust'); });
    ['Rate', 'From', 'To', 'Date'].forEach(n => {
        const el = $('#rm' + n);
        ['input', 'change'].forEach(ev => el.addEventListener(ev, () => rmClear(n)));
    });
    $('#rmApply').addEventListener('click', rmApply);
    $('#rateForm').addEventListener('submit', ev => ev.preventDefault());
    $('#rmFrom').value = $('#rmTo').value = $('#rmDate').value = todayStr();
    rmMethod(); rmHistory();
}

/* ---------- TS Calculator page ---------- */
// SNF = (0.22 × Fat) + 0.72 + (0.25 × LR)
// TS  = ((SNF + Fat) × Gross Volume) ÷ 13

// Empty or invalid (negative / non-number) input = null (no result shown)
function tsVal(id) {
    const v = $('#' + id).value.trim();
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

function tsCompute() {
    const fat = tsVal('tsFat'), lr = tsVal('tsLR'), gross = tsVal('tsGross');
    const snf = (fat !== null && lr !== null) ? (0.22 * fat) + 0.72 + (0.25 * lr) : null;
    const ts = (snf !== null && gross !== null) ? ((snf + fat) * gross) / 13 : null;
    $('#tsSnf').value = snf === null ? '' : snf.toFixed(2);
    $('#tsTs').value = ts === null ? '' : ts.toFixed(2);
}

function tsClear() {
    ['tsFat', 'tsLR', 'tsGross'].forEach(id => { $('#' + id).value = ''; });
    $('#tsSnf').value = ''; $('#tsTs').value = '';
    $('#tsFat').focus();
}

function openTsPage() {
    closeAll(); closeModal();
    showPage('tsPage');
    ['tsFat', 'tsLR', 'tsGross'].forEach(id => { $('#' + id).value = ''; });
    $('#tsSnf').value = ''; $('#tsTs').value = '';
    $('#tsFat').focus(); window.scrollTo(0, 0);
}

function initTsPage() {
    ['tsFat', 'tsLR', 'tsGross'].forEach(id => $('#' + id).addEventListener('input', tsCompute));
    $('#tsClear').addEventListener('click', tsClear);
    $('#tsForm').addEventListener('submit', ev => ev.preventDefault());
}

/* ---------- Payment Management page ---------- */
// db.advances = [{ id, type:'add'|'cut', personId, amount, date, note, createdAt, settleKey? }]
// db.settled  = { 'YYYY-MM-DD (start of week)': { at, ded: { sellerId: amount deducted }, adv: { sellerId: advance before settling } } }
// A farmer's full advance is kept in s.advance (every new advance is added to it).
// There is no weekly cut option: the payment table shows the full advance, net = amount − advance (never below 0).
let pmOffset = 0;
const advStore = () => (db.advances = db.advances || []);
const settleStore = () => (db.settled = db.settled || {});

function pmWeek(off = pmOffset) {
    const base = parse(weekStart(todayStr(), nowShift()));
    const start = addDays(base, off * 7), end = addDays(start, 7), key = fmt(start);
    return { start, end, key, label: `Monday evening – Monday morning · ${longDate(start)} – ${longDate(end)}`, test: e => weekStart(e.date, e.shift) === key };
}

// Does the entry have a rate? (saved amount, saved rate, or the Rate Management rate for that date)
const pmHasRate = e => e.amount > 0 || e.rate > 0 || applicableRate(e.personId, e.date) !== null;

// Per farmer: this week's milk, auto amount (milk × rate), full advance, actual deduction and net
//   adv  = the farmer's full advance (shown in the table's "Advance" column)
//   cut  = advance actually deducted from the payment = min(advance, amount)
//   net  = amount − cut (never negative), left = advance remaining for next week
function pmData(off = pmOffset) {
    const w = pmWeek(off), st = settleStore()[w.key];
    const rows = db.entries.filter(e => e.type === 'buy' && w.test(e));
    const data = db.sellers.map(s => {
        const mine = rows.filter(e => e.personId === s.id);
        const litres = sum(mine, e => e.litres);
        const amount = smR2(sum(mine, custAmount));
        const unrated = mine.filter(e => !pmHasRate(e)).length;
        // settled week = the advance and deduction saved at that time; otherwise the current full advance
        const adv = st ? smR2(st.adv ? (st.adv[s.id] || 0) : (st.ded[s.id] || 0)) : smR2(+s.advance || 0);
        const cut = st ? smR2(st.ded[s.id] || 0) : smR2(Math.min(adv, amount));
        return { s, litres, amount, unrated, adv, cut, net: smR2(amount - cut), left: smR2(adv - cut) };
    });
    return { w, st, data };
}

// The table shows plain numbers (Rs / L is in the header) so it fits on mobile
const pmN = n => (Math.round(n * 100) / 100).toLocaleString('en-PK');

function pmErr(name, msg) { $('#pm' + name).classList.add('invalid'); $('#pmErr' + name).textContent = msg; }
function pmClear(name) { $('#pm' + name).classList.remove('invalid'); $('#pmErr' + name).textContent = ''; }

function openPayPage() {
    closeAll(); closeModal();
    showPage('payPage');
    pmOffset = 0;
    ['AdvAmount', 'AdvNote'].forEach(n => { $('#pm' + n).value = ''; });
    $('#pmAdvDate').value = todayStr();
    $('#pmAdvSeller').value = '';
    ['AdvSeller', 'AdvAmount', 'AdvDate'].forEach(pmClear);
    renderPay(); pmAdvHint(); window.scrollTo(0, 0);
}

function renderPay() {
    if ($('#payPage').hidden) return;
    const { w, st, data } = pmData();
    const tMilk = sum(data, d => d.litres), tAmt = sum(data, d => d.amount), tAdv = sum(data, d => d.adv), tNet = sum(data, d => d.net);

    $('#pmRange').textContent = w.label;
    ['pmPrev', 'pmCur', 'pmNext'].forEach(id => $('#' + id).classList.remove('active'));
    $('#' + (pmOffset === 0 ? 'pmCur' : pmOffset < 0 ? 'pmPrev' : 'pmNext')).classList.add('active');
    $('#pmNet').textContent = money(tNet);
    $('#pmNet2').textContent = money(tNet);
    $('#pmStatus').textContent = st ? `✔ Settled · ${new Date(st.at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : 'Net payable · week is open';
    $('#pmMilk').textContent = lit(tMilk);
    $('#pmAmount').textContent = money(tAmt);
    $('#pmCut').textContent = money(tAdv);

    $('#pmBody').innerHTML = data.length ? data.map(d => `<tr class="${d.litres || d.adv ? '' : 'pm-zero'}">
        <td><b>${esc(d.s.name)}</b>${d.left > 0 ? `<small class="pm-sub">Remaining for next week: ${money(d.left)}</small>` : ''}${d.unrated ? `<small class="pm-warn">⚠ ${d.unrated} entries have no rate</small>` : ''}</td>
        <td>${pmN(d.litres)}</td><td>${pmN(d.amount)}</td><td>${pmN(d.adv)}</td><td><b>${pmN(d.net)}</b></td></tr>`).join('')
        : '<tr><td colspan="5" style="text-align:center">Add a seller first</td></tr>';
    $('#pmFoot').innerHTML = data.length ? `<tr><th>Total</th><th>${pmN(tMilk)}</th><th>${pmN(tAmt)}</th><th>${pmN(tAdv)}</th><th>${pmN(tNet)}</th></tr>` : '';

    const bad = sum(data, d => d.unrated);
    $('#pmWarn').hidden = !bad;
    $('#pmWarnText').textContent = `⚠ ${bad} ${bad === 1 ? 'entry has' : 'entries have'} no rate set and counted as Rs. 0.`;
    $('#pmSettle').textContent = st ? '↩ Undo Settle' : '✔ Week Settle';

    const cur = $('#pmAdvSeller').value;
    $('#pmAdvSeller').innerHTML = '<option value="">-- Select farmer --</option>' + db.sellers.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    $('#pmAdvSeller').value = db.sellers.some(s => s.id === cur) ? cur : '';

    const hist = advStore().slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25);
    $('#pmHistory').innerHTML = hist.length ? hist.map(a => {
        const p = db.sellers.find(x => x.id === a.personId);
        return `<tr><td>${shortDate(a.date)}</td><td>${p ? esc(p.name) : '(deleted)'}${a.note ? `<small class="pm-sub">${esc(a.note)}</small>` : ''}</td>
            <td><span class="badge ${a.type === 'add' ? 'buy' : 'sell'}">${a.type === 'add' ? 'Advance' : 'Cut'}</span></td>
            <td><b>${a.type === 'add' ? '+' : '−'}${money(a.amount)}</b></td>
            <td>${a.type === 'add' ? `<button type="button" class="del" onclick="pmDelAdv('${a.id}')">✕</button>` : ''}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center">No advances yet</td></tr>';
}

function pmAdvHint() {
    const s = db.sellers.find(x => x.id === $('#pmAdvSeller').value);
    $('#pmAdvBal').textContent = s ? `Advance balance: ${money(s.advance || 0)}` : '';
}

function pmAdvAdd() {
    ['AdvSeller', 'AdvAmount', 'AdvDate'].forEach(pmClear);
    const s = db.sellers.find(x => x.id === $('#pmAdvSeller').value);
    const amt = parseFloat($('#pmAdvAmount').value), date = $('#pmAdvDate').value;
    const note = $('#pmAdvNote').value.trim();
    let ok = true;
    if (!s) { pmErr('AdvSeller', 'Select a farmer'); ok = false; }
    if (!(amt > 0)) { pmErr('AdvAmount', 'Enter an advance amount (greater than 0)'); ok = false; }
    if (!date) { pmErr('AdvDate', 'Select a date'); ok = false; }
    if (!ok) return;

    s.advance = smR2((+s.advance || 0) + amt); // full advance: each new advance is added to the previous total
    advStore().push({ id: uid(), type: 'add', personId: s.id, amount: smR2(amt), date, note, createdAt: new Date().toISOString() });
    save(); render();
    ['AdvAmount', 'AdvNote'].forEach(n => { $('#pm' + n).value = ''; });
    pmAdvHint();
    toast(`${money(amt)} advance added for ${s.name} ✔`);
}

function pmDelAdv(id) {
    const a = advStore().find(x => x.id === id);
    if (!a || a.type !== 'add') return;
    if (!confirm('Delete this advance? The advance balance will be reduced accordingly.')) return;
    const s = db.sellers.find(x => x.id === a.personId);
    if (s) s.advance = Math.max(0, smR2((+s.advance || 0) - a.amount));
    db.advances = advStore().filter(x => x.id !== id);
    save(); render(); pmAdvHint(); toast('Advance deleted');
}

// A week can be settled only once (no double deduction); Undo restores everything
function pmSettle() {
    const { w, st, data } = pmData();
    if (st) {
        if (!confirm('Undo this settlement? Deducted advances will be returned to the farmer balances.')) return;
        Object.entries(st.ded).forEach(([id, amt]) => {
            const s = db.sellers.find(x => x.id === id); if (s) s.advance = smR2((+s.advance || 0) + amt);
        });
        db.advances = advStore().filter(a => a.settleKey !== w.key);
        delete db.settled[w.key];
        save(); render(); pmAdvHint(); return toast('Settlement undone');
    }
    const cuts = data.filter(d => d.cut > 0);
    const msg = cuts.length
        ? `Settle this week? ${money(sum(cuts, d => d.cut))} of advance will be deducted for ${cuts.length} farmer${cuts.length === 1 ? '' : 's'}; any remaining advance carries over to next week.`
        : 'Settle this week? No advance will be deducted.';
    if (!confirm(msg)) return;
    const ded = {}, adv = {};
    data.forEach(d => { if (d.adv > 0) adv[d.s.id] = d.adv; }); // full advance before settling (for the weekly record)
    cuts.forEach(d => {
        ded[d.s.id] = d.cut;
        d.s.advance = Math.max(0, smR2((+d.s.advance || 0) - d.cut));
        advStore().push({ id: uid(), type: 'cut', personId: d.s.id, amount: d.cut, date: todayStr(), note: 'Deducted from weekly payment', settleKey: w.key, createdAt: new Date().toISOString() });
    });
    settleStore()[w.key] = { at: new Date().toISOString(), ded, adv };
    save(); render(); pmAdvHint(); toast('Week settled ✔');
}

function initPayPage() {
    $('#pmPrev').addEventListener('click', () => { pmOffset--; renderPay(); });
    $('#pmCur').addEventListener('click', () => { pmOffset = 0; renderPay(); });
    $('#pmNext').addEventListener('click', () => { pmOffset++; renderPay(); });
    $('#pmPrint').addEventListener('click', () => window.print());
    $('#pmSettle').addEventListener('click', pmSettle);
    $('#pmAdvAdd').addEventListener('click', pmAdvAdd);
    $('#pmAdvSeller').addEventListener('change', () => { pmClear('AdvSeller'); pmAdvHint(); });
    ['AdvAmount', 'AdvDate'].forEach(n => ['input', 'change'].forEach(ev => $('#pm' + n).addEventListener(ev, () => pmClear(n))));
    $('#pmAdvForm').addEventListener('submit', ev => ev.preventDefault());
}


/* ---------- Init ---------- */
$('#prevWeek').onclick = () => { view = { mode: 'week', offset: view.mode === 'week' ? view.offset - 1 : -1 }; render(); };
$('#nextWeek').onclick = () => { view = { mode: 'week', offset: view.mode === 'week' ? view.offset + 1 : 1 }; render(); };
$('#curWeek').onclick = () => { view = { mode: 'week', offset: 0 }; render(); };
$('#thisMonth').onclick = () => { view = { mode: 'month', offset: 0 }; render(); };
$('#todayBtn').onclick = () => { view = { mode: 'today', offset: 0 }; render(); };
$('#prevDay').onclick = () => { view = { mode: 'today', offset: (view.mode === 'today' ? view.offset : 0) - 1 }; render(); };
$('#nextDay').onclick = () => { view = { mode: 'today', offset: Math.min(0, (view.mode === 'today' ? view.offset : 0) + 1) }; render(); };
$('#searchBox').addEventListener('input', renderEntries);
initSellPage();
initRatePage();
initTsPage();
initPayPage();

render();


/* =====================================================
   Employees: Add Employee
   Part of script.js (employee management: form, list, password hashing).
   ===================================================== */

// Small bit of styling
(function () {
    const st = document.createElement('style');
    st.textContent = `
        .modal .rm-check input { padding: 0; border: 0; box-shadow: none; width: 22px; }
        .emp-hint { font-size: 12px; color: #71857c; margin-top: 4px; display: block; }`;
    document.head.appendChild(st);
})();

// db.employees = [{ id, empId, name, phone, username, salt, passHash, shift, customers[], joined, status, createdAt, updatedAt }]
const empStore = () => (db.employees = db.employees || []);
const EMP_SHIFTS = { morning: 'Morning', evening: 'Evening', both: 'Both (Morning + Evening)' };
let empBusy = false; // prevents double submission

const toHex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

function nextEmpId() {
    const max = empStore().reduce((m, e) => Math.max(m, parseInt(String(e.empId).replace(/\D/g, ''), 10) || 0), 0);
    return 'EMP-' + String(max + 1).padStart(3, '0');
}

// Passwords are hashed with a salt + PBKDF2 (SHA-256); the plain password is never stored
async function hashPw(pw, saltHex) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromHex(saltHex), iterations: 100000, hash: 'SHA-256' }, key, 256);
    return toHex(new Uint8Array(bits));
}

function empErr(n, msg) { $('#emp' + n).classList.add('invalid'); $('#empErr' + n).textContent = msg; }
function empClear(n) {
    const el = $('#emp' + n), er = $('#empErr' + n);
    if (el) el.classList.remove('invalid');
    if (er) er.textContent = '';
}

function empModal() {
    const list = empStore();
    openModal('🧑‍💼 Employees', `
        <div class="form-hero"><span>🧑‍💼</span><div><b>Register a New Employee</b><p>Enter the employee's details, shift and assigned customers</p></div></div>
        <form id="empForm" class="seller-form" onsubmit="addEmployee(event); return false;" novalidate>
            <div class="field"><label for="empId">Employee ID</label>
                <input id="empId" value="${nextEmpId()}" readonly></div>
            <div class="field"><label for="empName">Employee Name <i>*</i></label>
                <input id="empName" placeholder="Employee's name" autocomplete="off" oninput="empClear('Name')">
                <small class="err" id="empErrName"></small></div>
            <div class="field"><label for="empPhone">Mobile Number <i>*</i></label>
                <input id="empPhone" type="tel" inputmode="numeric" maxlength="15" placeholder="03xx-xxxxxxx" autocomplete="off" oninput="empClear('Phone')">
                <small class="err" id="empErrPhone"></small></div>
            <div class="field"><label for="empUser">Username <i>*</i></label>
                <input id="empUser" placeholder="e.g. ali_01" autocomplete="off" autocapitalize="none" oninput="empClear('User')">
                <small class="err" id="empErrUser"></small></div>
            <div class="field"><label for="empPass">Password <i>*</i></label>
                <input id="empPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" oninput="empClear('Pass')">
                <small class="err" id="empErrPass"></small></div>
            <div class="field"><label for="empShift">Assigned Shift <i>*</i></label>
                <select id="empShift" onchange="empClear('Shift')">
                    <option value="">-- Select shift --</option>
                    ${Object.entries(EMP_SHIFTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
                </select>
                <small class="err" id="empErrShift"></small></div>
            <div class="field"><label for="empJoin">Joining Date <i>*</i></label>
                <input id="empJoin" type="date" value="${todayStr()}" oninput="empClear('Join')">
                <small class="err" id="empErrJoin"></small></div>
            <div class="field"><label for="empStatus">Account Status</label>
                <select id="empStatus"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>

            <div class="field"><label>Assigned Customers <i>*</i></label>
                ${db.sellers.length ? `
                <input id="empSearch" type="search" placeholder="🔍 Customer search..." autocomplete="off" oninput="empFilter()">
                <div class="rm-box">
                    <label class="rm-check rm-all"><input type="checkbox" id="empAll" onchange="empSelectAll(this.checked)"><span class="rm-name">Select All</span></label>
                    <div class="rm-list" id="empList">
                        ${db.sellers.map(s => `<label class="rm-check" data-name="${esc(s.name.toLowerCase())}">
                            <input type="checkbox" class="emp-cb" value="${s.id}" onchange="empSync()"><span class="rm-name">${esc(s.name)}</span></label>`).join('')}
                    </div>
                </div>
                <small class="emp-hint" id="empCount">0 / ${db.sellers.length} customers selected</small>`
                : '<small class="emp-hint">No customers saved yet. Add a seller first.</small>'}
                <small class="err" id="empErrCust"></small></div>

            <button type="submit" class="btn" id="empSave">➕ Add Employee</button>
        </form>

        <h4 class="list-title">Saved Employees (${list.length})</h4>
        <div class="table-wrap"><table>
            <tr><th>ID</th><th>Name</th><th>Shift</th><th>Customers</th><th>Status</th><th>Actions</th></tr>
            ${list.map(e => `<tr><td>${esc(e.empId)}</td><td>${esc(e.name)}</td><td>${esc(EMP_SHIFTS[e.shift] || '-')}</td>
                <td>${e.customers.filter(id => db.sellers.some(s => s.id === id)).length}</td>
                <td><button type="button" class="badge ${e.status === 'active' ? 'buy' : 'sell'}" style="border:0;cursor:pointer" onclick="empToggle('${e.id}')">${e.status === 'active' ? 'Active' : 'Inactive'}</button></td>
                <td class="emp-actions"><button type="button" class="mini-btn" onclick="empEditModal('${e.id}')">✏️ Edit</button>
                <button type="button" class="mini-btn danger" onclick="empRemove('${e.id}')">🗑️ Remove</button></td></tr>`).join('')
            || '<tr><td colspan="6">No employees yet</td></tr>'}
        </table></div>`);
}

function empFilter() {
    const q = $('#empSearch').value.trim().toLowerCase();
    document.querySelectorAll('#empList .rm-check').forEach(l => { l.style.display = l.dataset.name.includes(q) ? '' : 'none'; });
}
function empSelectAll(on) {
    document.querySelectorAll('#empList .rm-check').forEach(l => {
        if (l.style.display !== 'none') l.querySelector('.emp-cb').checked = on; // visible rows only
    });
    empSync();
}
function empSync() {
    const cbs = [...document.querySelectorAll('#empList .emp-cb')], n = cbs.filter(c => c.checked).length;
    $('#empAll').checked = cbs.length > 0 && n === cbs.length;
    $('#empCount').textContent = `${n} / ${cbs.length} customers selected`;
    empClear('Cust');
}

function empToggle(id) {
    const e = empStore().find(x => x.id === id); if (!e) return;
    const to = e.status === 'active' ? 'inactive' : 'active';
    if (!confirm(`Set ${e.name} as ${to === 'active' ? 'Active' : 'Inactive'}?`)) return;
    e.status = to; e.updatedAt = new Date().toISOString();
    save(); empModal(); toast(`${e.name} is now ${to === 'active' ? 'Active' : 'Inactive'}`);
}

async function addEmployee(ev) {
    ev.preventDefault();
    if (empBusy) return;
    ['Name', 'Phone', 'User', 'Pass', 'Shift', 'Join', 'Cust'].forEach(empClear);
    const name = $('#empName').value.trim().replace(/\s+/g, ' ');
    const phone = normalizePhone($('#empPhone').value.trim());
    const username = $('#empUser').value.trim().toLowerCase();
    const pass = $('#empPass').value;
    const shift = $('#empShift').value, joined = $('#empJoin').value, status = $('#empStatus').value;
    const customers = [...document.querySelectorAll('#empList .emp-cb:checked')].map(c => c.value);
    let ok = true;

    if (name.length < 2) { empErr('Name', 'Enter the employee\'s name'); ok = false; }
    if (!$('#empPhone').value.trim()) { empErr('Phone', 'Enter a mobile number'); ok = false; }
    else if (!/^03\d{9}$/.test(phone)) { empErr('Phone', 'Enter a valid number (e.g. 03001234567)'); ok = false; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { empErr('User', '3–20 characters: letters, numbers or _ only'); ok = false; }
    else if (empStore().some(e => e.username === username)) { empErr('User', 'This username is already taken'); ok = false; }
    if (pass.length < 6) { empErr('Pass', 'Password must be at least 6 characters'); ok = false; }
    if (!shift) { empErr('Shift', 'Select a shift'); ok = false; }
    if (!joined) { empErr('Join', 'Select a joining date'); ok = false; }
    if (!customers.length) { empErr('Cust', 'Select at least one customer'); ok = false; }
    if (!ok) return toast('Please complete the required fields');
    if (!(window.crypto && crypto.subtle)) return toast('HTTPS or localhost is required to secure passwords');

    empBusy = true; $('#empSave').disabled = true;
    try {
        const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        const passHash = await hashPw(pass, salt);
        const now = new Date().toISOString();
        empStore().push({
            id: uid(), empId: nextEmpId(), name, phone, username, salt, passHash,
            shift, customers, joined, status, createdAt: now, updatedAt: now
        });
        save(); empModal(); toast(`${name} added ✔`);
    } catch (err) {
        toast('Could not save the employee');
    } finally { empBusy = false; }
}

// ---- Edit / remove an employee (admin) ----
function empEditModal(id) {
    const e = empStore().find(x => x.id === id); if (!e) return;
    openModal('✏️ Edit Employee', `
        <div class="form-hero"><span>🧑‍💼</span><div><b>${esc(e.name)}</b><p>${esc(e.empId)} · change details, password or customers</p></div></div>
        <form id="empForm" class="seller-form" onsubmit="empUpdate(event, '${e.id}'); return false;" novalidate>
            <div class="field"><label for="empId">Employee ID</label><input id="empId" value="${esc(e.empId)}" readonly></div>
            <div class="field"><label for="empName">Employee Name <i>*</i></label>
                <input id="empName" value="${esc(e.name)}" autocomplete="off" oninput="empClear('Name')"><small class="err" id="empErrName"></small></div>
            <div class="field"><label for="empPhone">Mobile Number <i>*</i></label>
                <input id="empPhone" type="tel" inputmode="numeric" maxlength="15" value="${esc(e.phone || '')}" autocomplete="off" oninput="empClear('Phone')"><small class="err" id="empErrPhone"></small></div>
            <div class="field"><label for="empUser">Username <i>*</i></label>
                <input id="empUser" value="${esc(e.username)}" autocomplete="off" autocapitalize="none" oninput="empClear('User')"><small class="err" id="empErrUser"></small></div>
            <div class="field"><label for="empPass">New Password</label>
                <input id="empPass" type="password" placeholder="Leave blank to keep the current password" autocomplete="new-password" oninput="empClear('Pass')"><small class="err" id="empErrPass"></small></div>
            <div class="field"><label for="empShift">Assigned Shift <i>*</i></label>
                <select id="empShift" onchange="empClear('Shift')">${Object.entries(EMP_SHIFTS).map(([k, v]) => `<option value="${k}" ${e.shift === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
                <small class="err" id="empErrShift"></small></div>
            <div class="field"><label for="empJoin">Joining Date <i>*</i></label>
                <input id="empJoin" type="date" value="${esc(e.joined || todayStr())}" oninput="empClear('Join')"><small class="err" id="empErrJoin"></small></div>
            <div class="field"><label for="empStatus">Account Status</label>
                <select id="empStatus"><option value="active" ${e.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${e.status !== 'active' ? 'selected' : ''}>Inactive</option></select></div>
            <div class="field"><label>Assigned Customers <i>*</i></label>
                <input id="empSearch" type="search" placeholder="🔍 Customer search..." autocomplete="off" oninput="empFilter()">
                <div class="rm-box">
                    <label class="rm-check rm-all"><input type="checkbox" id="empAll" onchange="empSelectAll(this.checked)"><span class="rm-name">Select All</span></label>
                    <div class="rm-list" id="empList">
                        ${db.sellers.map(s => `<label class="rm-check" data-name="${esc(s.name.toLowerCase())}">
                            <input type="checkbox" class="emp-cb" value="${s.id}" ${(e.customers || []).includes(s.id) ? 'checked' : ''} onchange="empSync()"><span class="rm-name">${esc(s.name)}</span></label>`).join('')}
                    </div>
                </div>
                <small class="emp-hint" id="empCount"></small><small class="err" id="empErrCust"></small></div>
            <button type="submit" class="btn" id="empSave">💾 Save Changes</button>
            <button type="button" class="btn ghost" onclick="empModal()">Cancel</button>
        </form>`);
    empSync();
}

async function empUpdate(ev, id) {
    ev.preventDefault();
    if (empBusy) return;
    const e = empStore().find(x => x.id === id); if (!e) return;
    ['Name', 'Phone', 'User', 'Pass', 'Shift', 'Join', 'Cust'].forEach(empClear);
    const name = $('#empName').value.trim().replace(/\s+/g, ' ');
    const phone = normalizePhone($('#empPhone').value.trim());
    const username = $('#empUser').value.trim().toLowerCase();
    const pass = $('#empPass').value;
    const customers = [...document.querySelectorAll('#empList .emp-cb:checked')].map(c => c.value);
    let ok = true;
    if (name.length < 2) { empErr('Name', 'Enter the employee\'s name'); ok = false; }
    if (!/^03\d{9}$/.test(phone)) { empErr('Phone', 'Enter a valid number (e.g. 03001234567)'); ok = false; }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) { empErr('User', '3–20 characters: letters, numbers or _ only'); ok = false; }
    else if (empStore().some(x => x.id !== id && x.username === username)) { empErr('User', 'This username is already taken'); ok = false; }
    if (pass && pass.length < 6) { empErr('Pass', 'Password must be at least 6 characters'); ok = false; }
    if (!$('#empJoin').value) { empErr('Join', 'Select a joining date'); ok = false; }
    if (!customers.length) { empErr('Cust', 'Select at least one customer'); ok = false; }
    if (!ok) return toast('Please complete the required fields');
    empBusy = true; $('#empSave').disabled = true;
    try {
        const oldUser = e.username;
        if (pass) {
            e.salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
            e.passHash = await hashPw(pass, e.salt);
        }
        Object.assign(e, { name, phone, username, customers, shift: $('#empShift').value, joined: $('#empJoin').value, status: $('#empStatus').value, updatedAt: new Date().toISOString() });
        // keep the employee's old entries linked if the username changed
        if (oldUser !== username) db.entries.forEach(x => { if (x.by === oldUser) { x.by = username; x.byName = name; } });
        save(); empModal(); toast(`${name} updated ✔`);
    } catch (err) {
        toast('Could not save the changes');
    } finally { empBusy = false; }
}

function empRemove(id) {
    const e = empStore().find(x => x.id === id); if (!e) return;
    if (!confirm(`Remove ${e.name}? Their milk entries stay saved, but they will no longer be able to log in.`)) return;
    const list = empStore(); list.splice(list.indexOf(e), 1);
    save(); empModal(); toast(`${e.name} removed`);
}

// The sidebar "Add Employee" link is connected here
actions.addEmployee = empModal;
/* =====================================================
   Total Milk Collection page (opened from the dashboard's Total Collection card)
   - Opens for the period selected on the dashboard (Week / Month / Today)
   - Customer-wise Morning / Evening / Total, with a Grand Total at the bottom
   - Hooked into render(), so the page updates by itself when data changes
   ===================================================== */

(function () {
    const st = document.createElement('style');
    st.textContent = `
        .hero.tc-click { cursor: pointer; transition: 0.2s; }
        .hero.tc-click:active { transform: scale(0.98); }
        .tc-range { margin: 8px 0 0 !important; }
        .tc-table { min-width: 340px; }
        .tc-table th, .tc-table td { padding: 12px 8px; text-align: right; white-space: nowrap; }
        .tc-table th:first-child, .tc-table td:first-child { width: 44px; text-align: center; }
        .tc-table th:nth-child(2), .tc-table td:nth-child(2) { text-align: left; white-space: normal; min-width: 110px; }
        .tc-table td:nth-child(2) { font-weight: bold; overflow-wrap: anywhere; }
        .tc-table td.tc-sum { font-weight: bold; color: #087b4b; }
        .tc-table tfoot th { background: #f4faf6; color: #087b4b; font-size: 14px; }
        .tc-empty { text-align: center !important; color: #71857c; padding: 22px 8px !important; }`;
    document.head.appendChild(st);
})();

const TC_COLS = { morning: '🌅 Morning (L)', afternoon: '☀️ Afternoon (L)', evening: '🌇 Evening (L)' };
const TC_SHIFT_NAMES = { all: 'All Shifts', morning: 'Morning', evening: 'Evening' };
// view = dashboard jaisa period ({mode:'week'|'month'|'today', offset})
const tc = { view: { mode: 'week', offset: 0 }, shift: 'all', q: '' };
const tcN = n => (Math.round(n * 100) / 100).toLocaleString('en-PK');

(function () {
    const pg = document.createElement('main');
    pg.className = 'container sell-page'; pg.id = 'tcPage'; pg.hidden = true;
    pg.innerHTML = `
        <div class="sm-top">
            <button type="button" class="sm-back" id="tcBack">← Dashboard</button>
            <h2>🥛 Total Milk Collection</h2>
        </div>

        <section class="sm-hero">
            <div>
                <p>Total Collection</p>
                <h3 id="tcHeroTotal">0 L</h3>
                <small id="tcHeroSub"></small>
            </div>
            <div class="sm-hero-icon">🥛</div>
        </section>

        <section class="sm-card">
            <h4 class="sm-legend">Period</h4>
            <div class="nav-row" style="margin:10px 0 0">
                <button type="button" class="pill" data-tcview="prev">← Previous Week</button>
                <button type="button" class="pill" data-tcview="cur">Current Week</button>
                <button type="button" class="pill" data-tcview="next">Next Week →</button>
                <button type="button" class="pill" data-tcview="month">This Month</button>
                <button type="button" class="pill" data-tcview="today">Today</button>
            </div>
            <div class="nav-row day-nav" id="tcDayNav" style="margin:10px 0 0">
                <button type="button" class="pill" data-tcview="prevday">← Previous Day</button>
                <button type="button" class="pill" data-tcview="nextday">Next Day →</button>
            </div>
            <p class="range-label tc-range" id="tcRangeLabel"></p>
            <h4 class="sm-legend">Shift</h4>
            <div class="nav-row" style="margin:10px 0 0">
                <button type="button" class="pill" data-tcshift="all">All Shifts</button>
                <button type="button" class="pill" data-tcshift="morning">🌅 Morning</button>
                <button type="button" class="pill" data-tcshift="evening">🌇 Evening</button>
            </div>

            <div class="sm-field">
                <label for="tcSearch">Search Customer</label>
                <input id="tcSearch" type="search" placeholder="🔍 Search customer name..." autocomplete="off">
            </div>
        </section>

        <section class="sm-card">
            <h4 class="sm-legend">Customer-wise Milk</h4>
            <div class="table-wrap">
                <table class="tc-table">
                    <thead id="tcHead"></thead>
                    <tbody id="tcBody"></tbody>
                    <tfoot id="tcFoot"></tfoot>
                </table>
            </div>
        </section>`;
    document.querySelector('.bottom-nav').before(pg);
    PAGES.push('tcPage'); // showPage now handles this page too
})();

// Selected period: same logic as the dashboard (getRange)
const tcRange = () => getRange(tc.view);

// Customer-wise totals from db.entries (type 'buy': Admin and Employee entries); each entry id is counted once
function tcData() {
    const r = tcRange(), seen = new Set(), by = new Map();
    scopeEntries(db.entries).forEach(e => {
        if (e.type !== 'buy' || seen.has(e.id)) return;
        seen.add(e.id);
        if (!r.test(e)) return;
        if (tc.shift !== 'all' && e.shift !== tc.shift) return;
        const l = Number(e.litres);
        if (!(l > 0)) return;
        const row = by.get(e.personId) || { morning: 0, afternoon: 0, evening: 0 };
        row[Object.prototype.hasOwnProperty.call(row, e.shift) ? e.shift : 'evening'] += l;
        by.set(e.personId, row);
    });
    const names = new Map(db.sellers.map(s => [s.id, s.name]));
    const ids = db.sellers.map(s => s.id).filter(id => by.has(id));
    [...by.keys()].forEach(id => { if (!names.has(id)) ids.push(id); }); // entries of deleted customers are still counted
    const all = ids.map(id => {
        const v = by.get(id), t = v.morning + v.afternoon + v.evening;
        return { name: names.get(id) || '(deleted)', morning: v.morning, afternoon: v.afternoon, evening: v.evening, total: t };
    });
    const q = tc.q.trim().toLowerCase();
    return {
        range: r, all,
        rows: all.filter(x => !q || x.name.toLowerCase().includes(q)),
        hasAfternoon: all.some(x => x.afternoon > 0)
    };
}

function tcRender() {
    const pg = $('#tcPage');
    if (!pg || pg.hidden) return; // only while the page is open

    const d = tcData();
    const cols = tc.shift === 'all' ? ['morning', ...(d.hasAfternoon ? ['afternoon'] : []), 'evening'] : [tc.shift];
    const multi = cols.length > 1, n = cols.length + 2 + (multi ? 1 : 0);
    const grand = c => d.rows.reduce((a, x) => a + x[c], 0);

    $('#tcHeroTotal').textContent = lit(d.all.reduce((a, x) => a + x.total, 0));
    $('#tcHeroSub').textContent = TC_SHIFT_NAMES[tc.shift] + ' · ' + d.range.label;
    $('#tcRangeLabel').textContent = d.range.label;

    const m = tc.view.mode, o = tc.view.offset;
    const active = m === 'week' ? (o === 0 ? 'cur' : o < 0 ? 'prev' : 'next') : m === 'month' ? 'month' : 'today';
    pg.querySelectorAll('[data-tcview]').forEach(b => b.classList.toggle('active', b.dataset.tcview === active));
    $('#tcDayNav').hidden = m !== 'today';
    pg.querySelector('[data-tcview="nextday"]').disabled = m === 'today' && (o || 0) >= 0;
    pg.querySelectorAll('[data-tcshift]').forEach(b => b.classList.toggle('active', b.dataset.tcshift === tc.shift));

    $('#tcHead').innerHTML = `<tr><th>#</th><th>Customer Name</th>${cols.map(c => `<th>${TC_COLS[c]}</th>`).join('')}${multi ? '<th>Total (L)</th>' : ''}</tr>`;
    $('#tcBody').innerHTML = d.rows.length
        ? d.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td>${cols.map(c => `<td>${x[c] ? tcN(x[c]) : '—'}</td>`).join('')}${multi ? `<td class="tc-sum">${tcN(x.total)}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="${n}" class="tc-empty">No milk entries found for this period / shift</td></tr>`;
    $('#tcFoot').innerHTML = d.rows.length
        ? `<tr><th></th><th>${tc.q.trim() ? 'Grand Total (filtered)' : 'Grand Total'}</th>${cols.map(c => `<th>${tcN(grand(c))}</th>`).join('')}${multi ? `<th>${tcN(d.rows.reduce((a, x) => a + x.total, 0))}</th>` : ''}</tr>`
        : '';
}

function openTcPage() {
    closeAll(); closeModal();
    tc.view = { mode: view.mode, offset: view.offset }; // the period selected on the dashboard
    tc.shift = 'all'; tc.q = '';
    $('#tcSearch').value = '';
    showPage('tcPage'); tcRender(); window.scrollTo(0, 0);
}

(function () {
    const hero = document.querySelector('.hero');
    hero.classList.add('tc-click');
    hero.setAttribute('role', 'button'); hero.tabIndex = 0;
    hero.addEventListener('click', openTcPage);
    hero.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openTcPage(); } });

    $('#tcBack').addEventListener('click', showDashboard);
    $('#tcPage').querySelectorAll('[data-tcview]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.tcview, w = tc.view.mode === 'week';
        tc.view = k === 'prev' ? { mode: 'week', offset: w ? tc.view.offset - 1 : -1 }
            : k === 'next' ? { mode: 'week', offset: w ? tc.view.offset + 1 : 1 }
            : k === 'cur' ? { mode: 'week', offset: 0 }
            : k === 'prevday' ? { mode: 'today', offset: (tc.view.mode === 'today' ? tc.view.offset : 0) - 1 }
            : k === 'nextday' ? { mode: 'today', offset: Math.min(0, (tc.view.mode === 'today' ? tc.view.offset : 0) + 1) }
            : { mode: k, offset: 0 }; // 'month' or 'today'
        tcRender();
    }));
    $('#tcPage').querySelectorAll('[data-tcshift]').forEach(b => b.addEventListener('click', () => { tc.shift = b.dataset.tcshift; tcRender(); }));
    $('#tcSearch').addEventListener('input', () => { tc.q = $('#tcSearch').value; tcRender(); });
})();

// Sidebar "Total Collection" link
actions.collection = openTcPage;

/* =====================================================
   Total Sales page (Admin): the record of every Sell Milk entry
   - Milk collected vs milk sold for the selected period
   - Buyer-wise summary + a day-by-day sales record (date, shift, litres, fat, SNF, rate, amount)
   - Opened from the sidebar, the dashboard "Milk Sold" card, or the Sell Milk page
   ===================================================== */
(function () {
    const st = document.createElement('style');
    st.textContent = `
        .sl-flow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
        .sl-flow div { background: #ffffff1f; border: 1px solid #ffffff40; border-radius: 14px; padding: 10px 8px; text-align: center; }
        .sl-flow small { display: block; font-size: 11px; opacity: .85; }
        .sl-flow b { display: block; font-size: 15px; margin-top: 3px; }
        .sl-table th, .sl-table td { padding: 10px 6px; text-align: right; white-space: nowrap; font-size: 13px; }
        .sl-table th:first-child, .sl-table td:first-child { text-align: left; white-space: normal; min-width: 120px; }
        .sl-table td:first-child b { overflow-wrap: anywhere; }
        .sl-table td small { display: block; color: #71857c; font-size: 11px; margin-top: 3px; white-space: normal; }
        .sl-table tr.sl-day td { background: #e4f5eb; color: #075b38; font-weight: bold; text-align: left; white-space: normal; font-size: 13px; }
        .sl-table tr.sl-day td span { float: right; }
        .sl-table tfoot th { background: #f4faf6; color: #087b4b; }
        .sl-del { border: 0; background: #fdecec; color: #e5484d; border-radius: 8px; padding: 6px 9px; cursor: pointer; font-size: 13px; }
        .sl-pos { color: #087b4b; } .sl-neg { color: #e5484d; }
        .sl-link { margin-top: 12px; width: 100%; padding: 13px; border: 0; border-radius: 14px; font-weight: bold; font-size: 15px; background: #e4f5eb; color: #087b4b; cursor: pointer; font-family: inherit; }
        .card.sl-click { cursor: pointer; }
        body.dark .sl-table tr.sl-day td { background: #1f3a2e; color: #4fd08a; }
        body.dark .sl-table tfoot th { background: #122019; color: #4fd08a; }
        body.dark .sl-del { background: #3a1f22; }
        body.dark .sl-link { background: #1f3a2e; color: #4fd08a; }`;
    document.head.appendChild(st);
})();

const sl = { view: { mode: 'today', offset: 0 }, shift: 'all', q: '' };
const SL_SHIFT_ICON = { morning: '🌅', afternoon: '☀️', evening: '🌇' };
const slDate = ds => new Date(ds + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const slShiftOrder = s => (s === 'morning' ? 0 : s === 'afternoon' ? 1 : 2);

(function () {
    const pg = document.createElement('main');
    pg.className = 'container sell-page'; pg.id = 'salesPage'; pg.hidden = true;
    pg.innerHTML = `
        <div class="sm-top">
            <button type="button" class="sm-back" id="slBack">← Dashboard</button>
            <h2>🚚 Total Milk Sales</h2>
        </div>

        <section class="sm-hero">
            <div style="width:100%">
                <p>Total Sold</p>
                <h3 id="slHeroTotal">0 L</h3>
                <small id="slHeroSub"></small>
                <div class="sl-flow">
                    <div><small>Collected</small><b id="slIn">0 L</b></div>
                    <div><small>Sold</small><b id="slOut">0 L</b></div>
                    <div><small>Balance</small><b id="slBal">0 L</b></div>
                </div>
            </div>
        </section>

        <section class="sm-card">
            <h4 class="sm-legend">Period</h4>
            <div class="nav-row" style="margin:10px 0 0">
                <button type="button" class="pill" data-slview="prev">← Previous Week</button>
                <button type="button" class="pill" data-slview="cur">Current Week</button>
                <button type="button" class="pill" data-slview="next">Next Week →</button>
                <button type="button" class="pill" data-slview="month">This Month</button>
                <button type="button" class="pill" data-slview="today">Today</button>
            </div>
            <div class="nav-row day-nav" id="slDayNav" style="margin:10px 0 0">
                <button type="button" class="pill" data-slview="prevday">← Previous Day</button>
                <button type="button" class="pill" data-slview="nextday">Next Day →</button>
            </div>
            <p class="range-label tc-range" id="slRangeLabel"></p>
            <h4 class="sm-legend">Shift</h4>
            <div class="nav-row" style="margin:10px 0 0">
                <button type="button" class="pill" data-slshift="all">All Shifts</button>
                <button type="button" class="pill" data-slshift="morning">🌅 Morning</button>
                <button type="button" class="pill" data-slshift="evening">🌇 Evening</button>
            </div>
            <div class="sm-field">
                <label for="slSearch">Search Buyer</label>
                <input id="slSearch" type="search" placeholder="🔍 Search buyer name..." autocomplete="off">
            </div>
        </section>

        <section class="sm-card">
            <h4 class="sm-legend">Daily Sales Record</h4>
            <div class="table-wrap"><table class="sl-table">
                <thead><tr><th>Buyer</th><th>TS</th><th>Amount</th><th></th></tr></thead>
                <tbody id="slBody"></tbody><tfoot id="slFoot"></tfoot>
            </table></div>
            <button type="button" class="sl-link" id="slNew">💵 Record a New Sale</button>
        </section>`;
    document.querySelector('.bottom-nav').before(pg);
    PAGES.push('salesPage');
})();

function slData() {
    const r = getRange(sl.view), q = sl.q.trim().toLowerCase();
    const inShift = e => sl.shift === 'all' || e.shift === sl.shift;
    const names = new Map(db.buyers.map(b => [b.id, b.name]));
    const nm = e => names.get(e.personId) || e.buyerName || '(deleted)';
    const sales = db.entries.filter(e => e.type === 'sell' && r.test(e) && inShift(e) && Number(e.litres) > 0)
        .filter(e => !q || nm(e).toLowerCase().includes(q))
        .sort((a, b) => b.date.localeCompare(a.date) || slShiftOrder(a.shift) - slShiftOrder(b.shift) || String(a.ts).localeCompare(String(b.ts)));
    const collected = sum(db.entries.filter(e => e.type === 'buy' && r.test(e) && inShift(e)), e => e.litres);
    const sold = sum(db.entries.filter(e => e.type === 'sell' && r.test(e) && inShift(e)), e => e.litres);
    return { r, sales, nm, collected, sold };
}

function salesRender() {
    const pg = $('#salesPage');
    if (!pg || pg.hidden) return;
    const d = slData(), n2 = tcN;
    const litresAll = sum(d.sales, e => e.litres), amountAll = sum(d.sales, entryAmount), tsAll = sum(d.sales, saleTs);

    $('#slHeroTotal').textContent = lit(litresAll) + ' · ' + money(amountAll);
    $('#slHeroSub').textContent = TC_SHIFT_NAMES[sl.shift] + ' · ' + d.r.label + ' · ' + d.sales.length + (d.sales.length === 1 ? ' sale' : ' sales');
    $('#slIn').textContent = lit(d.collected); $('#slOut').textContent = lit(d.sold);
    const bal = Math.round((d.collected - d.sold) * 100) / 100;
    $('#slBal').textContent = lit(bal);
    $('#slRangeLabel').textContent = d.r.label;

    const m = sl.view.mode, o = sl.view.offset;
    const active = m === 'week' ? (o === 0 ? 'cur' : o < 0 ? 'prev' : 'next') : m === 'month' ? 'month' : 'today';
    pg.querySelectorAll('[data-slview]').forEach(b => b.classList.toggle('active', b.dataset.slview === active));
    $('#slDayNav').hidden = m !== 'today';
    pg.querySelector('[data-slview="nextday"]').disabled = m === 'today' && (o || 0) >= 0;
    pg.querySelectorAll('[data-slshift]').forEach(b => b.classList.toggle('active', b.dataset.slshift === sl.shift));

    // day-by-day record
    let html = '', day = null;
    const dayTotals = {};
    d.sales.forEach(e => { const t = dayTotals[e.date] || (dayTotals[e.date] = { l: 0, a: 0, ts: 0 }); t.l += Number(e.litres); t.a += entryAmount(e); t.ts += saleTs(e); });
    d.sales.forEach(e => {
        if (e.date !== day) {
            day = e.date;
            html += `<tr class="sl-day"><td colspan="4">📅 ${slDate(day)}<span>TS ${n2(dayTotals[day].ts)} · ${n2(dayTotals[day].l)} L · ${money(dayTotals[day].a)}</span></td></tr>`;
        }
        const bits = [`${SL_SHIFT_ICON[e.shift] || ''} ${cap(e.shift)}`];
        if (e.time) bits.push(e.time);
        bits.push(n2(e.litres) + ' L');
        const q = [];
        if (e.fat) q.push('Fat ' + e.fat); if (e.snf) q.push('SNF ' + e.snf); if (e.lr) q.push('LR ' + e.lr);
        const rt = entryRate(e);
        q.push(rt > 0 ? money(rt) + '/TS' : '⚠ No rate set');
        html += `<tr><td><b>${esc(d.nm(e))}</b><small>${bits.join(' · ')}${q.length ? '<br>' + q.join(' · ') : ''}</small></td>
            <td><b>${n2(saleTs(e))}</b></td><td>${money(entryAmount(e))}</td>
            <td><button class="sl-del" title="Delete this sale" aria-label="Delete this sale" onclick="slDelete('${e.id}')">✕</button></td></tr>`;
    });
    $('#slBody').innerHTML = html || '<tr><td colspan="4" class="tc-empty">No sales recorded for this period / shift</td></tr>';
    $('#slFoot').innerHTML = d.sales.length ? `<tr><th>Grand Total</th><th>${n2(tsAll)}</th><th>${money(amountAll)}</th><th></th></tr>` : '';
}
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

function slDelete(id) {
    const e = db.entries.find(x => x.id === id && x.type === 'sell'); if (!e) return;
    if (!confirm(`Delete this sale?\n${e.buyerName || 'Buyer'} · ${lit(e.litres)} · ${slDate(e.date)}`)) return;
    db.entries = db.entries.filter(x => x.id !== id); save(); render(); toast('Sale deleted');
}

function openSalesPage(fromView) {
    closeAll(); closeModal();
    sl.view = fromView ? { mode: fromView.mode, offset: fromView.offset } : { mode: 'today', offset: 0 };
    sl.shift = 'all'; sl.q = ''; $('#slSearch').value = '';
    showPage('salesPage'); salesRender(); window.scrollTo(0, 0);
}

(function () {
    $('#slBack').addEventListener('click', showDashboard);
    $('#slNew').addEventListener('click', () => actions.sell());
    $('#salesPage').querySelectorAll('[data-slview]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.slview, w = sl.view.mode === 'week', td = sl.view.mode === 'today' ? sl.view.offset : 0;
        sl.view = k === 'prev' ? { mode: 'week', offset: w ? sl.view.offset - 1 : -1 }
            : k === 'next' ? { mode: 'week', offset: w ? sl.view.offset + 1 : 1 }
            : k === 'cur' ? { mode: 'week', offset: 0 }
            : k === 'prevday' ? { mode: 'today', offset: td - 1 }
            : k === 'nextday' ? { mode: 'today', offset: Math.min(0, td + 1) }
            : { mode: k, offset: 0 };
        salesRender();
    }));
    $('#salesPage').querySelectorAll('[data-slshift]').forEach(b => b.addEventListener('click', () => { sl.shift = b.dataset.slshift; salesRender(); }));
    $('#slSearch').addEventListener('input', () => { sl.q = $('#slSearch').value; salesRender(); });

    // The dashboard "Milk Sold" card opens the sales record for the selected period
    const card = $('#stSold').closest('.card');
    if (card) {
        card.classList.add('sl-click'); card.setAttribute('role', 'button'); card.tabIndex = 0;
        const go = () => { if (session && session.role === 'admin') openSalesPage(view); };
        card.addEventListener('click', go);
        card.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    }
    // Sell Milk page: shortcut to the record
    const top = document.querySelector('#sellPage .sm-top');
    if (top) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sm-back'; b.textContent = '📋 Sales Record';
        b.addEventListener('click', () => openSalesPage());
        top.appendChild(b);
    }
})();
actions.sales = () => openSalesPage();

/* ---------- New day: the dashboard refreshes itself to Today ---------- */
(function () {
    let day = todayStr();
    function newDayCheck() {
        if (todayStr() === day) return;
        day = todayStr();
        view = { mode: 'today', offset: 0 };
        render();
    }
    setInterval(newDayCheck, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) newDayCheck(); });
    window.addEventListener('focus', newDayCheck);
})();

applyDark(); // saved dark mode lagao

/* =====================================================
   LOGIN PAGE (Admin + Employee)
   - Admin: the password is set on first use, then log in with username "admin" + password
   - Employee: username/password created in Add Employee (an inactive employee cannot log in)
   - Passwords are hashed (PBKDF2), never stored in plain text
   ===================================================== */
const SESSION_KEY = 'cheemaSession';
const ADMIN_ONLY = ['seller', 'buyer', 'sell', 'addEmployee', 'sales', 'rates', 'rate', 'payment', 'print', 'backup']; // hidden from employees
let loginMode = 'admin', loginBusy = false, loginFails = 0, loginLockUntil = 0;

function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function writeSession(s, remember) {
    try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); (remember ? localStorage : sessionStorage).setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { }
}
function clearSession() { try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (e) { } }

(function buildLogin() {
    const el = document.createElement('div');
    el.id = 'loginScreen'; el.className = 'lg-screen'; el.hidden = true;
    el.innerHTML = `
        <div class="lg-card">
            <div class="lg-logo">🥛</div>
            <h1>Cheema Milk Collection</h1>
            <p class="lg-sub" id="lgSub">Dairy Management System</p>

            <div class="lg-tabs" id="lgTabs" role="tablist">
                <button type="button" class="active" data-lgmode="admin" role="tab">👑 Admin</button>
                <button type="button" data-lgmode="employee" role="tab">🧑‍💼 Employee</button>
            </div>

            <form id="lgForm" novalidate autocomplete="off">
                <div class="lg-field"><label for="lgUser">Username</label>
                    <input id="lgUser" placeholder="Enter your username" autocapitalize="none" autocomplete="username">
                    <small class="lg-err" id="lgErrUser"></small></div>
                <div class="lg-field"><label for="lgPass" id="lgPassLbl">Password</label>
                    <div class="lg-pw"><input id="lgPass" type="password" placeholder="Enter your password" autocomplete="current-password">
                    <button type="button" id="lgEye" aria-label="Show password">👁</button></div>
                    <small class="lg-err" id="lgErrPass"></small></div>
                <div class="lg-field" id="lgConfWrap" hidden><label for="lgConf">Confirm password</label>
                    <input id="lgConf" type="password" placeholder="Re-enter password" autocomplete="new-password">
                    <small class="lg-err" id="lgErrConf"></small></div>
                <label class="lg-remember"><input type="checkbox" id="lgRemember" checked> Keep me signed in</label>
                <div class="lg-formerr" id="lgErrForm" role="alert"></div>
                <button class="lg-btn" id="lgBtn" type="submit">Login ↗</button>
            </form>
            <p class="lg-foot" id="lgFoot"></p>
        </div>`;
    document.body.appendChild(el);

    el.querySelectorAll('[data-lgmode]').forEach(b => b.addEventListener('click', () => { loginMode = b.dataset.lgmode; lgRender(); }));
    $('#lgEye').addEventListener('click', () => {
        const p = $('#lgPass'), show = p.type === 'password';
        p.type = show ? 'text' : 'password'; $('#lgConf').type = p.type;
        $('#lgEye').textContent = show ? '🙈' : '👁';
    });
    ['lgUser', 'lgPass', 'lgConf'].forEach(id => $('#' + id).addEventListener('input', () => { lgClear(); }));
    $('#lgForm').addEventListener('submit', lgSubmit);
})();

const lgSetup = () => !(db.admin && db.admin.passHash); // the admin password has not been set yet

function lgClear() { ['User', 'Pass', 'Conf'].forEach(n => { $('#lg' + n).classList.remove('invalid'); $('#lgErr' + n).textContent = ''; }); $('#lgErrForm').textContent = ''; }
function lgErr(n, msg) { $('#lg' + n).classList.add('invalid'); $('#lgErr' + n).textContent = msg; }

function lgRender() {
    const setup = loginMode === 'admin' && lgSetup();
    $('#lgTabs').querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.lgmode === loginMode); b.setAttribute('aria-selected', b.dataset.lgmode === loginMode); });
    $('#lgConfWrap').hidden = !setup;
    $('#lgPassLbl').textContent = setup ? 'New Password' : 'Password';
    $('#lgPass').autocomplete = setup ? 'new-password' : 'current-password';
    $('#lgBtn').textContent = setup ? 'Create Admin Account ✔' : 'Login ↗';
    $('#lgSub').textContent = setup ? 'First time: set the Admin password' : 'Dairy Management System';
    $('#lgFoot').textContent = loginMode === 'admin'
        ? (setup ? 'The Admin username is "admin". Keep your password safe.' : 'Admin username: admin')
        : 'Employee username and password are created by the Admin in Add Employee.';
    if (loginMode === 'admin') $('#lgUser').value = 'admin';
    else if ($('#lgUser').value === 'admin') $('#lgUser').value = '';
    $('#lgUser').readOnly = setup;
    lgClear();
}

async function lgSubmit(ev) {
    ev.preventDefault();
    if (loginBusy) return;
    lgClear();
    const wait = Math.ceil((loginLockUntil - Date.now()) / 1000);
    if (wait > 0) { $('#lgErrForm').textContent = `Too many failed attempts. Try again in ${wait} seconds.`; return; }
    const user = $('#lgUser').value.trim().toLowerCase(), pass = $('#lgPass').value, setup = loginMode === 'admin' && lgSetup();
    let ok = true;
    if (!user) { lgErr('User', 'Enter your username'); ok = false; }
    if (!pass) { lgErr('Pass', 'Enter your password'); ok = false; }
    else if (setup && pass.length < 6) { lgErr('Pass', 'Password must be at least 6 characters'); ok = false; }
    if (setup && pass && $('#lgConf').value !== pass) { lgErr('Conf', 'Passwords do not match'); ok = false; }
    if (!ok) return;
    if (!(window.crypto && crypto.subtle)) { $('#lgErrForm').textContent = 'HTTPS or localhost is required to log in.'; return; }

    loginBusy = true; $('#lgBtn').disabled = true;
    try {
        let who = null;
        if (setup) {
            const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
            db.admin = { username: 'admin', salt, passHash: await hashPw(pass, salt), createdAt: new Date().toISOString() };
            save(); who = { role: 'admin', user: 'admin', name: 'Admin' };
        } else if (loginMode === 'admin') {
            if (user === (db.admin.username || 'admin') && await hashPw(pass, db.admin.salt) === db.admin.passHash) who = { role: 'admin', user: 'admin', name: 'Admin' };
        } else {
            const emp = empStore().find(e => e.username === user);
            const good = emp && await hashPw(pass, emp.salt) === emp.passHash;
            if (good && emp.status === 'inactive') { $('#lgErrForm').textContent = 'This account is inactive. Please contact the Admin.'; return; }
            if (good) who = { role: 'employee', user: emp.username, name: emp.name, empId: emp.id };
        }
        if (!who) {
            if (++loginFails >= 5) { loginFails = 0; loginLockUntil = Date.now() + 30000; $('#lgErrForm').textContent = 'Too many failed attempts. Please wait 30 seconds.'; }
            else $('#lgErrForm').textContent = 'Incorrect username or password.';
            $('#lgPass').value = ''; $('#lgPass').focus(); return;
        }
        loginFails = 0;
        const rec = who.role === 'admin' ? db.admin : empStore().find(e => e.username === who.user);
        if (rec) { rec.lastLogin = new Date().toISOString(); save(); }
        writeSession(who, $('#lgRemember').checked);
        enterApp(who);
    } catch (e) {
        $('#lgErrForm').textContent = 'Could not log in. Please try again.';
    } finally { loginBusy = false; $('#lgBtn').disabled = false; }
}

function enterApp(who) {
    session = who;
    $('#loginScreen').hidden = true; document.body.classList.remove('locked');
    document.body.classList.toggle('is-employee', who.role === 'employee');
    // Employees get only the day-to-day options
    document.querySelectorAll('#sidebar [data-action], .bottom-nav [data-action]').forEach(a => {
        a.hidden = who.role === 'employee' ? ADMIN_ONLY.includes(a.dataset.action) : a.classList.contains('emp-only');
    });
    const e = curEmp(), w = document.querySelector('.welcome p');
    if (w) w.textContent = `Welcome back, ${who.name}!` + (e ? ` · ${EMP_SHIFTS[e.shift] || ''} shift` : '');
    ['#lgPass', '#lgConf'].forEach(s => { $(s).value = ''; });
    showDashboard(); window.scrollTo(0, 0);
}

function showLogin() {
    session = null; closeAll(); closeModal();
    document.body.classList.add('locked'); document.body.classList.remove('is-employee');
    $('#loginScreen').hidden = false;
    loginMode = 'admin'; $('#lgPass').value = ''; $('#lgConf').value = ''; $('#lgPass').type = 'password'; $('#lgConf').type = 'password'; $('#lgEye').textContent = '👁';
    lgRender();
    setTimeout(() => (lgSetup() ? $('#lgPass') : $('#lgPass')).focus(), 50);
}

// Logout: returns to the login page
function logout() {
    if (!confirm('Log out?')) return;
    clearSession(); showLogin();
}


/* =====================================================
   Change Password (everyone)
   ===================================================== */
const fmtLogin = iso => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never');

function changePwModal() {
    openModal('🔑 Change Password', `
        <form id="cpForm" class="seller-form" onsubmit="return changePw(event)" novalidate>
            <div class="field"><label for="cpOld">Current Password <i>*</i></label>
                <input id="cpOld" type="password" autocomplete="current-password" oninput="cpClear()"><small class="err" id="cpErrOld"></small></div>
            <div class="field"><label for="cpNew">New Password <i>*</i></label>
                <input id="cpNew" type="password" autocomplete="new-password" placeholder="At least 6 characters" oninput="cpClear()"><small class="err" id="cpErrNew"></small></div>
            <div class="field"><label for="cpConf">Confirm New Password <i>*</i></label>
                <input id="cpConf" type="password" autocomplete="new-password" oninput="cpClear()"><small class="err" id="cpErrConf"></small></div>
            <button type="submit" class="btn" id="cpSave">🔑 Update Password</button>
        </form>`);
}
const cpClear = () => ['Old', 'New', 'Conf'].forEach(n => { $('#cp' + n).classList.remove('invalid'); $('#cpErr' + n).textContent = ''; });
const cpErr = (n, m) => { $('#cp' + n).classList.add('invalid'); $('#cpErr' + n).textContent = m; };
async function changePw(ev) {
    ev.preventDefault(); cpClear();
    const rec = !session ? null : session.role === 'admin' ? db.admin : empStore().find(e => e.username === session.user);
    const o = $('#cpOld').value, n = $('#cpNew').value, c = $('#cpConf').value;
    let ok = true;
    if (!o) { cpErr('Old', 'Enter your current password'); ok = false; }
    if (n.length < 6) { cpErr('New', 'Password must be at least 6 characters'); ok = false; }
    else if (n === o) { cpErr('New', 'New password must be different'); ok = false; }
    if (c !== n) { cpErr('Conf', 'Passwords do not match'); ok = false; }
    if (!ok || !rec) return false;
    $('#cpSave').disabled = true;
    try {
        if (await hashPw(o, rec.salt) !== rec.passHash) { cpErr('Old', 'Current password is incorrect'); return false; }
        rec.salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
        rec.passHash = await hashPw(n, rec.salt);
        if (session.role === 'employee') rec.updatedAt = new Date().toISOString();
        save(); closeModal(); toast('Password updated ✔');
    } catch (e) { toast('Could not update the password'); }
    finally { const b = $('#cpSave'); if (b) b.disabled = false; }
    return false;
}
actions.changePassword = changePwModal;

// Block actions without a session / for employees (cannot be bypassed from the console)
(function guardActions() {
    Object.keys(actions).forEach(k => {
        const fn = actions[k];
        actions[k] = function () {
            if (!session) return;
            if (session.role === 'employee' && ADMIN_ONLY.includes(k)) { toast('This option is available to the Admin only'); return; }
            return fn.apply(this, arguments);
        };
    });
})();

// Start: purani valid session ho to seedha app, warna login
(function boot() {
    const s = readSession();
    let valid = !!(s && (s.role === 'admin' ? db.admin && db.admin.passHash : empStore().some(e => e.username === s.user && e.status !== 'inactive')));
    if (valid) { if (s.role === 'employee') { const e = empStore().find(x => x.username === s.user); s.name = e.name; } enterApp(s); }
    else { clearSession(); showLogin(); }
})();
