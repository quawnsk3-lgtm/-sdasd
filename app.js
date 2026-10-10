let MODELS = {};
let CLIP_SECONDS = 8;
let IS_MOCK = true;
const selected = new Set();      // job ids (clip từ API)
const selectedFiles = new Set(); // tên file upload

const $ = (id) => document.getElementById(id);

async function init() {
  const st = await (await fetch('/api/status')).json();
  MODELS = st.models;
  CLIP_SECONDS = st.clipSeconds;
  IS_MOCK = st.mock;
  const banner = $('modeBanner');
  banner.classList.remove('hidden');
  if (st.mock) {
    banner.className = 'banner mock';
    banner.innerHTML = st.hasKey
      ? '⚠️ Đang chạy chế độ <b>MOCK (demo)</b> — chưa gọi Veo thật, không tốn tiền. Tắt MOCK_MODE trong .env để chạy thật.'
      : '⚠️ Chưa có <b>GEMINI_API_KEY</b> — đang chạy chế độ <b>MOCK (demo)</b>, không tốn tiền. Thêm key vào file .env để gen video thật.';
  } else {
    banner.className = 'banner live';
    banner.textContent = '✅ Đã kết nối Veo API — mỗi lần gen sẽ tính tiền thật theo bảng giá.';
  }
  const sel = $('model');
  sel.innerHTML = '';
  for (const [key, m] of Object.entries(MODELS)) {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = `${m.label} — $${m.rates['1080p']}/s (clip 8s 1080p ≈ $${(m.rates['1080p'] * CLIP_SECONDS).toFixed(2)})`;
    if (key.includes('fast')) o.selected = true;
    sel.appendChild(o);
  }
  updateCost();
  loadJobs();
  setInterval(loadJobs, 5000);
}

function updateCost() {
  const m = MODELS[$('model').value];
  if (!m) return;
  const res = $('resolution').value;
  const n = Math.min(4, Math.max(1, parseInt($('count').value, 10) || 1));
  const per = m.rates[res] * CLIP_SECONDS;
  $('costBox').innerHTML =
    `Ước tính: <b>$${(per * n).toFixed(2)}</b> cho ${n} clip ` +
    `(${m.label}, ${res}, ${CLIP_SECONDS}s/clip, $${per.toFixed(2)}/clip)` +
    (IS_MOCK ? ' — <i>mock: chưa tốn tiền</i>' : '');
}

async function loadJobs() {
  const jobs = await (await fetch('/api/jobs')).json();
  const box = $('jobs');
  if (!jobs.length) {
    box.innerHTML = '<p class="empty">Chưa có job nào. Nhập prompt ở trên để bắt đầu.</p>';
    return;
  }
  box.innerHTML = '';
  for (const j of jobs) {
    const d = document.createElement('div');
    d.className = 'job';
    const statusText = { queued: 'Đang chờ', working: 'Đang gen', done: 'Xong', failed: 'Lỗi' }[j.status];
    let inner = `<div class="meta"><span class="badge ${j.status}">${statusText}</span>
      <span>$${j.costEstimate.toFixed(2)} · ${j.model.split('-')[1]} · ${j.aspectRatio}</span></div>
      <div class="prompt">${escapeHtml(j.prompt)}</div>`;
    if (j.status === 'working' || j.status === 'queued') {
      inner += `<div class="bar"><div style="width:${j.progress}%"></div></div>
        <div class="row"><span>${escapeHtml(j.note || '')}</span></div>`;
    }
    if (j.status === 'done' && j.videos.length) {
      for (const v of j.videos) {
        inner += `<video src="/output/${v.file}" controls playsinline></video>
          <div class="row"><a class="dl" href="/output/${v.file}" download>⬇ Tải clip (${(v.bytes / 1048576).toFixed(1)} MB)</a>
          <label class="check"><input type="checkbox" data-job="${j.id}" ${selected.has(j.id) ? 'checked' : ''}> Chọn để ghép</label></div>`;
      }
    }
    if (j.status === 'failed') inner += `<div class="err">❌ ${escapeHtml(j.error || 'Lỗi không rõ')}</div>`;
    inner += `<div class="row"><span>${new Date(j.createdAt).toLocaleString('vi-VN')}</span>
      <button class="danger" data-del="${j.id}">Xóa</button></div>`;
    d.innerHTML = inner;
    box.appendChild(d);
  }
  box.querySelectorAll('input[type=checkbox][data-job]').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(cb.dataset.job) : selected.delete(cb.dataset.job);
      updateAssembleBar();
    });
  });
  box.querySelectorAll('button[data-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Xóa job này và file video của nó?')) return;
      await fetch('/api/jobs/' + b.dataset.del, { method: 'DELETE' });
      selected.delete(b.dataset.del);
      updateAssembleBar();
      loadJobs();
    });
  });
  updateAssembleBar();
}

function updateAssembleBar() {
  const bar = $('assembleBar');
  const total = selected.size + selectedFiles.size;
  if (total) {
    bar.classList.remove('hidden');
    $('selCount').textContent = `Đã chọn ${total} clip (${selected.size} từ API, ${selectedFiles.size} upload)`;
  } else bar.classList.add('hidden');
}

async function loadUploads() {
  const list = await (await fetch('/api/uploads')).json();
  const box = $('uploads');
  if (!list.length) {
    box.innerHTML = '<p class="empty">Chưa có file nào.</p>';
    return;
  }
  box.innerHTML = '';
  for (const f of list) {
    const d = document.createElement('div');
    d.className = 'upfile';
    d.innerHTML = `<div class="fname">${escapeHtml(f.file)}</div>
      <video src="${f.url}" controls playsinline></video>
      <div class="row">
        <label class="check"><input type="checkbox" data-file="${escapeHtml(f.file)}" ${selectedFiles.has(f.file) ? 'checked' : ''}> Chọn để ghép</label>
        <a class="dl" href="${f.url}" download>⬇ Tải (${(f.bytes / 1048576).toFixed(1)} MB)</a>
        <button class="danger" data-delfile="${escapeHtml(f.file)}">Xóa</button>
      </div>`;
    box.appendChild(d);
  }
  box.querySelectorAll('input[type=checkbox][data-file]').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.checked ? selectedFiles.add(cb.dataset.file) : selectedFiles.delete(cb.dataset.file);
      updateAssembleBar();
    });
  });
  box.querySelectorAll('button[data-delfile]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Xóa file này?')) return;
      await fetch('/api/uploads/' + encodeURIComponent(b.dataset.delfile), { method: 'DELETE' });
      selectedFiles.delete(b.dataset.delfile);
      updateAssembleBar();
      loadUploads();
    });
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

$('genBtn').addEventListener('click', async () => {
  const btn = $('genBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang gửi…';
  try {
    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: $('prompt').value,
        model: $('model').value,
        aspectRatio: $('aspect').value,
        resolution: $('resolution').value,
        negativePrompt: $('negative').value,
        enhancePrompt: $('enhance').checked,
        count: $('count').value,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lỗi gửi job');
    $('prompt').value = '';
    loadJobs();
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '🚀 Tạo video';
});

$('assembleBtn').addEventListener('click', async () => {
  const btn = $('assembleBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang ghép…';
  try {
    const r = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds: [...selected], files: [...selectedFiles], name: $('finalName').value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lỗi ghép video');
    $('assembleResult').innerHTML =
      `<div class="job"><div class="meta"><span class="badge done">Đã ghép ${data.clips} clip</span></div>
       <video src="${data.url}" controls playsinline></video>
       <div class="row"><a class="dl" href="${data.url}" download>⬇ Tải video cuối (${(data.bytes / 1048576).toFixed(1)} MB)</a></div></div>`;
    selected.clear();
    selectedFiles.clear();
    updateAssembleBar();
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = '🔗 Ghép thành 1 video';
});

$('refreshBtn').addEventListener('click', loadJobs);
$('uploadBtn').addEventListener('click', async () => {
  const files = $('fileInput').files;
  if (!files.length) { alert('Chọn ít nhất 1 file video đã.'); return; }
  const btn = $('uploadBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang tải…';
  try {
    const fd = new FormData();
    for (const f of files) fd.append('clips', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lỗi upload');
    $('fileInput').value = '';
    loadUploads();
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Tải lên';
});
['model', 'resolution', 'count'].forEach((id) => $(id).addEventListener('change', updateCost));
$('count').addEventListener('input', updateCost);

init();
loadUploads();
