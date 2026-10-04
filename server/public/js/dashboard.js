// dashboard.js — live map + employees + history playback
const COLORS = ['#4da3ff', '#51cf66', '#ffd43b', '#ff922b', '#f783ac', '#b197fc', '#66d9e8', '#ffe066'];
const colorFor = id => COLORS[id % COLORS.length];

let map, histMap, liveData = [], markers = {}, trails = {};
let histTrail, histMarkers = [];
let employees = [];

/* ---------- live map ---------- */
function initLive() {
  map = L.map('map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  map.setView([30.3753, 69.3451], 5); // Pakistan-ish default

  refreshLive();
  setInterval(refreshLive, 30000);

  connectWS();
}

async function refreshLive() {
  const res = await fetch('/api/live');
  if (!res.ok) return;
  liveData = await res.json();
  renderLive();
}

function renderLive() {
  const list = document.getElementById('emp-list');
  const tpl = document.getElementById('tpl-emp-row');
  list.innerHTML = '';
  const now = Date.now();
  const fitted = [];

  for (const e of liveData) {
    const stale = !e.recorded_at || now - Date.parse(e.recorded_at + 'Z') > 10 * 60 * 1000;
    const row = tpl.content.cloneNode(true);
    row.querySelector('.name').textContent = e.name;
    row.querySelector('.dot').classList.toggle('stale', stale);
    row.querySelector('.badge').textContent = stale ? 'no signal' : 'live';
    row.querySelector('.emp-meta').textContent = e.lat != null
      ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)} · ${ago(e.recorded_at)}${e.battery != null ? ' · 🔋' + e.battery + '%' : ''}`
      : 'no locations yet';
    row.querySelector('.emp-row').onclick = () => { if (e.lat != null) map.setView([e.lat, e.lng], 16); };
    list.appendChild(row);

    if (e.lat != null) {
      if (!markers[e.id]) {
        markers[e.id] = L.circleMarker([e.lat, e.lng], {
          radius: 8, color: colorFor(e.id), fillColor: colorFor(e.id),
          fillOpacity: .9, weight: 2
        }).addTo(map).bindTooltip(e.name, { permanent: true, direction: 'top' });
        trails[e.id] = L.polyline([], { color: colorFor(e.id), weight: 3, opacity: .7 }).addTo(map);
        loadTrail(e.id);
        fitted.push([e.lat, e.lng]);
      } else {
        markers[e.id].setLatLng([e.lat, e.lng]);
        trails[e.id].addLatLng([e.lat, e.lng]);
      }
    }
  }
  if (fitted.length) map.fitBounds(fitted, { padding: [40, 40], maxZoom: 16 });
}

async function loadTrail(empId) {
  const res = await fetch(`/api/employees/${empId}/locations?from=${dayStart()}`);
  if (!res.ok) return;
  const pts = (await res.json()).map(p => [p.lat, p.lng]);
  if (trails[empId] && pts.length) trails[empId].setLatLngs(pts);
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/live`);
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.type !== 'location') return;
      const e = liveData.find(x => x.id === m.employee_id);
      if (!e) { refreshLive(); return; }
      e.lat = m.lat; e.lng = m.lng; e.battery = m.battery;
      e.accuracy = m.accuracy; e.speed = m.speed;
      e.recorded_at = m.recorded_at.replace('Z', '');
      renderLive();
    } catch {}
  };
}

/* ---------- employee management ---------- */
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadEmployees() {
  const res = await fetch('/api/employees');
  if (res.status === 401) { location.href = '/login'; return; }
  if (!res.ok) return;
  employees = await res.json();
  renderManageList();
}

function renderManageList() {
  const box = document.getElementById('manage-list');
  box.innerHTML = '';
  if (!employees.length) {
    box.innerHTML = '<p class="muted" style="text-align:center">No employees yet — add one above.</p>';
    return;
  }
  const now = Date.now();
  for (const e of employees) {
    const seen = e.last_seen
      ? ago(e.last_seen)
      : 'no locations yet';
    const row = document.createElement('div');
    row.className = 'manage-row';
    row.innerHTML = `
      <div class="manage-main">
        <div class="manage-name"><strong>${esc(e.name)}</strong>
          <span class="pill ${e.active ? 'on' : 'off'}">${e.active ? 'tracking on' : 'stopped'}</span>
        </div>
        <div class="manage-meta">
          <span>${seen}${e.battery != null ? ' · 🔋' + e.battery + '%' : ''}</span>
          <code>${esc(e.device_token)}</code>
          <button class="copy-chip" data-copy="${esc(e.device_token)}">copy code</button>
        </div>
        ${(e.email || e.ni_number || e.phone) ? `
        <div class="manage-id">
          ${e.email ? `<span title="Email">✉ ${esc(e.email)}</span>` : ''}
          ${e.ni_number ? `<span title="NI number">ID: ${esc(e.ni_number)}</span>` : ''}
          ${e.phone ? `<span title="Phone">☎ ${esc(e.phone)}</span>` : ''}
          ${e.device_name ? `<span class="muted" title="Device">${esc(e.device_name)}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="manage-actions">
        <button class="btn ${e.active ? 'off' : ''} js-toggle" data-id="${e.id}" data-active="${e.active}">
          ${e.active ? 'Deactivate' : 'Activate'}
        </button>
        <button class="btn js-edit" data-id="${e.id}">Edit</button>
        <button class="btn danger js-del" data-id="${e.id}" data-name="${esc(e.name)}">Delete</button>
      </div>
      <div class="edit-form hidden" id="edit-${e.id}">
        <label>Name <input data-f="name" value="${esc(e.name)}"></label>
        <label>Email <input data-f="email" value="${esc(e.email || '')}"></label>
        <label>NI number <input data-f="ni_number" value="${esc(e.ni_number || '')}"></label>
        <label>Phone <input data-f="phone" value="${esc(e.phone || '')}"></label>
        <div class="edit-actions">
          <button class="btn js-save" data-id="${e.id}">Save</button>
          <button class="btn off js-cancel" data-id="${e.id}">Cancel</button>
        </div>
      </div>`;
    box.appendChild(row);
  }
}

async function addEmployee() {
  const name = document.getElementById('new-emp-name').value.trim();
  if (!name) return;
  const res = await fetch('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (res.status === 401) { location.href = '/login'; return; }
  if (!res.ok) { alert(await res.text()); return; }
  const emp = await res.json();
  document.getElementById('new-emp-name').value = '';
  const box = document.getElementById('new-emp-result');
  box.classList.remove('hidden');
  box.innerHTML = `
    <strong>✓ ${esc(emp.name)} created</strong>
    <span class="muted">Activation code — for phones installed before self-registration. New installs register themselves from the app.</span>
    <div class="code-line"><code>${esc(emp.device_token)}</code>
      <button class="copy-chip" data-copy="${esc(emp.device_token)}">copy</button></div>`;
  box.querySelector('.copy-chip').onclick = ev => copyText(ev.target, emp.device_token);
  loadEmployees();
}

async function setEmployeeActive(id, active) {
  await fetch(`/api/employees/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active })
  });
  loadEmployees();
}

async function saveEmployee(id) {
  const form = document.getElementById(`edit-${id}`);
  if (!form) return;
  const body = {};
  for (const input of form.querySelectorAll('input[data-f]')) {
    body[input.dataset.f] = input.value;
  }
  const res = await fetch(`/api/employees/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) { alert('Save failed: ' + ((await res.json()).error || res.status)); return; }
  loadEmployees();
}

function toggleEditForm(id) {
  const form = document.getElementById(`edit-${id}`);
  if (form) form.classList.toggle('hidden');
}

async function deleteEmployee(id) {
  await fetch(`/api/employees/${id}`, { method: 'DELETE' });
  loadEmployees();
  if (histMap) populateEmployees();
}

function copyText(btn, text) {
  const done = () => { btn.textContent = 'copied ✓'; setTimeout(() => { btn.textContent = 'copy'; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); done();
  }
}
function initHistory() {
  histMap = L.map('hist-map');
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(histMap);
}

async function populateEmployees() {
  const res = await fetch('/api/employees');
  if (!res.ok) return;
  const emps = await res.json();
  const sel = document.getElementById('hist-emp');
  sel.innerHTML = '';
  for (const e of emps) {
    const o = document.createElement('option');
    o.value = e.id; o.textContent = e.name;
    sel.appendChild(o);
  }
}

async function loadHistory() {
  const id = document.getElementById('hist-emp').value;
  if (!id) return;
  const from = document.getElementById('hist-from').value || '';
  const to = document.getElementById('hist-to').value || '';
  document.getElementById('hist-csv').href = `/api/employees/${id}/locations.csv?from=${from}&to=${to}`;

  const res = await fetch(`/api/employees/${id}/locations?from=${from}&to=${to}`);
  if (!res.ok) return;
  const pts = await res.json();
  if (histTrail) histTrail.remove();
  histMarkers.forEach(m => m.remove());
  histMarkers = [];
  if (!pts.length) { histMap.setView([30.3753, 69.3451], 5); return; }

  const ll = pts.map(p => [p.lat, p.lng]);
  histTrail = L.polyline(ll, { color: colorFor(+id), weight: 3 }).addTo(histMap);
  const first = pts[0], last = pts[pts.length - 1];
  histMarkers.push(
    L.circleMarker(ll[0], { radius: 6, color: 'green', fillOpacity: 1 }).addTo(histMap)
      .bindPopup(`start ${first.recorded_at}`),
    L.circleMarker(ll[ll.length - 1], { radius: 6, color: 'red', fillOpacity: 1 }).addTo(histMap)
      .bindPopup(`end ${last.recorded_at}`)
  );
  histMap.fitBounds(histTrail.getBounds(), { padding: [30, 30] });
}

/* ---------- helpers ---------- */
function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - Date.parse(ts + 'Z')) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}
function dayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 19);
}
function pad(n) { return String(n).padStart(2, '0'); }
function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ---------- wiring ---------- */
const TABS = ['live', 'employees', 'history'];
document.getElementById('btn-live').onclick = () => switchTab('live');
document.getElementById('btn-employees').onclick = () => switchTab('employees');
document.getElementById('btn-history').onclick = () => switchTab('history');
document.getElementById('add-emp-btn').onclick = addEmployee;
document.getElementById('new-emp-name').addEventListener('keydown', e => { if (e.key === 'Enter') addEmployee(); });
document.getElementById('hist-load').onclick = loadHistory;

document.getElementById('manage-list').addEventListener('click', e => {
  const copyBtn = e.target.closest('.copy-chip');
  if (copyBtn) return copyText(copyBtn, copyBtn.dataset.copy);
  const toggleBtn = e.target.closest('.js-toggle');
  if (toggleBtn) return setEmployeeActive(toggleBtn.dataset.id, toggleBtn.dataset.active !== 'true');
  const editBtn = e.target.closest('.js-edit');
  if (editBtn) return toggleEditForm(editBtn.dataset.id);
  const cancelBtn = e.target.closest('.js-cancel');
  if (cancelBtn) return toggleEditForm(cancelBtn.dataset.id);
  const saveBtn = e.target.closest('.js-save');
  if (saveBtn) return saveEmployee(saveBtn.dataset.id);
  const delBtn = e.target.closest('.js-del');
  if (delBtn && confirm(`Delete "${delBtn.dataset.name}" and all their history?`)) {
    return deleteEmployee(delBtn.dataset.id);
  }
});

function switchTab(which) {
  for (const t of TABS) {
    document.getElementById(`panel-${t}`).classList.toggle('hidden', t !== which);
    document.getElementById(`btn-${t}`).classList.toggle('active', t === which);
  }
  if (which === 'history') {
    if (!histMap) initHistory();
    populateEmployees();
    document.getElementById('hist-from').value = nowLocal().slice(0, 10) + 'T00:00';
    document.getElementById('hist-to').value = nowLocal();
    setTimeout(() => histMap.invalidateSize(), 50);
  } else if (which === 'employees') {
    document.getElementById('new-emp-result').classList.add('hidden');
    loadEmployees();
  } else {
    setTimeout(() => map.invalidateSize(), 50);
  }
}

if (document.getElementById('map')) initLive();
