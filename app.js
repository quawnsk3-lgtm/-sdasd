let files = []; // [{file, bytes, duration, url}] theo thứ tự hiển thị
const selected = new Set(); // tên file được chọn để ghép

const $ = (id) => document.getElementById(id);

function fmtDur(s) {
  s = Math.round(s || 0);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadUploads() {
  files = await (await fetch('/api/uploads')).json();
  // giữ lại lựa chọn cũ cho file còn tồn tại
  for (const f of [...selected]) {
    if (!files.some((x) => x.file === f)) selected.delete(f);
  }
  render();
}

function render() {
  const box = $('uploads');
  if (!files.length) {
    box.innerHTML = '<p class="empty">Chưa có clip nào.</p>';
  } else {
    box.innerHTML = '';
    files.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'clip';
      const checked = selected.has(f.file);
      const orderBadge = checked
        ? `<span class="ord">${[...selected].indexOf(f.file) + 1}</span>` : '';
      d.innerHTML = `
        <label class="pick"><input type="checkbox" data-i="${i}" ${checked ? 'checked' : ''}>${orderBadge}</label>
        <video src="${f.url}" muted playsinline preload="metadata"></video>
        <div class="info">
          <div class="fname">${escapeHtml(f.file)}</div>
          <div class="meta">${fmtDur(f.duration)} · ${(f.bytes / 1048576).toFixed(1)} MB</div>
          <div class="actions">
            <button class="ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="ghost" data-down="${i}" ${i === files.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="danger" data-del="${escapeHtml(f.file)}">Xóa</button>
          </div>
        </div>`;
      box.appendChild(d);
    });
  }
  updateBar();
}

function updateBar() {
  const ordered = files.filter((f) => selected.has(f.file));
  const totalDur = ordered.reduce((s, f) => s + (f.duration || 0), 0);
  $('selInfo').textContent = ordered.length
    ? `Đã chọn ${ordered.length} clip · tổng ~${fmtDur(totalDur)}`
    : 'Chưa chọn clip nào';
  $('assembleBtn').disabled = !ordered.length;
}

$('uploads').addEventListener('change', (e) => {
  const cb = e.target.closest('input[type=checkbox][data-i]');
  if (!cb) return;
  const f = files[+cb.dataset.i];
  cb.checked ? selected.add(f.file) : selected.delete(f.file);
  render();
});

$('uploads').addEventListener('click', async (e) => {
  const up = e.target.closest('button[data-up]');
  const down = e.target.closest('button[data-down]');
  const del = e.target.closest('button[data-del]');
  if (up) {
    const i = +up.dataset.up;
    [files[i - 1], files[i]] = [files[i], files[i - 1]];
    render();
  } else if (down) {
    const i = +down.dataset.down;
    [files[i], files[i + 1]] = [files[i + 1], files[i]];
    render();
  } else if (del) {
    if (!confirm('Xóa clip này?')) return;
    await fetch('/api/uploads/' + encodeURIComponent(del.dataset.del), { method: 'DELETE' });
    selected.delete(del.dataset.del);
    loadUploads();
  }
});

$('uploadBtn').addEventListener('click', async () => {
  const inputFiles = $('fileInput').files;
  if (!inputFiles.length) { alert('Chọn ít nhất 1 file video đã.'); return; }
  const btn = $('uploadBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang tải…';
  try {
    const fd = new FormData();
    for (const f of inputFiles) fd.append('clips', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lỗi upload');
    $('fileInput').value = '';
    // tự tick chọn các file vừa upload
    for (const f of data.files) selected.add(f.file);
    loadUploads();
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Tải lên';
});

$('assembleBtn').addEventListener('click', async () => {
  const ordered = files.filter((f) => selected.has(f.file)).map((f) => f.file);
  if (!ordered.length) return;
  const btn = $('assembleBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Đang ghép…';
  try {
    const r = await fetch('/api/assemble', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobIds: [], files: ordered, name: $('finalName').value }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Lỗi ghép video');
    $('assembleResult').innerHTML =
      `<div class="job"><div class="meta"><span class="badge done">Đã ghép ${data.clips} clip</span></div>
       <video src="${data.url}" controls playsinline></video>
       <div class="row"><a class="dl" href="${data.url}" download>⬇ Tải video cuối (${(data.bytes / 1048576).toFixed(1)} MB)</a></div></div>`;
    $('assembleResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Ghép thành 1 video';
  updateBar();
});

loadUploads();
