// Veo Studio — nhập prompt → gen video bằng Veo 3.1 API → ghép bằng ffmpeg
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8787', 10);
const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MOCK = !API_KEY || process.env.MOCK_MODE === '1';

const ROOT = __dirname;
const OUT_DIR = path.join(ROOT, 'output');
const JOBS_FILE = path.join(ROOT, 'jobs.json');
const MOCK_SRC = path.join(OUT_DIR, '_mock-source.mp4');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Tìm thư mục giao diện: chuẩn là public/, fallback là thư mục gốc
// (phòng trường hợp upload nhầm file flat, không theo cấu trúc thư mục)
const PUBLIC_DIR = fs.existsSync(path.join(ROOT, 'public', 'index.html')) ? path.join(ROOT, 'public') : ROOT;

// Tự kiểm tra lúc khởi động để báo lỗi dễ hiểu
if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
  console.error('CẢNH BÁO: không tìm thấy index.html (đã tìm trong public/ và thư mục gốc) — web sẽ báo "Cannot GET /".');
} else if (PUBLIC_DIR === ROOT) {
  console.log('Lưu ý: dùng giao diện ở thư mục gốc (không tìm thấy public/).');
}
async function ensureMockSource() {
  if (!MOCK) return;
  // nếu file mẫu nằm ở root do upload nhầm flat thì chuyển vào output/
  const rootMock = path.join(ROOT, '_mock-source.mp4');
  if (!fs.existsSync(MOCK_SRC) && fs.existsSync(rootMock)) {
    fs.copyFileSync(rootMock, MOCK_SRC);
    console.log('Đã chuyển _mock-source.mp4 từ thư mục gốc vào output/.');
  }
  if (fs.existsSync(MOCK_SRC)) return;
  try {
    console.log('Chưa có clip demo mẫu, đang tự tạo bằng ffmpeg...');
    await execFileP('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'testsrc2=size=1080x1920:rate=30:duration=8', '-pix_fmt', 'yuv420p', MOCK_SRC]);
    console.log('Đã tạo xong clip demo mẫu.');
  } catch (e) {
    console.error('Không tự tạo được clip demo:', e.message);
  }
}

// Bảng giá video (USD/giây, đã gồm audio) — kiểm tra 10/2026
const MODELS = {
  'veo-3.1-lite-generate-preview': { type: 'veo', label: 'Veo 3.1 Lite',  rates: { '720p': 0.05, '1080p': 0.08 } },
  'veo-3.1-fast-generate-preview': { type: 'veo', label: 'Veo 3.1 Fast',  rates: { '720p': 0.10, '1080p': 0.12 } },
  'veo-3.1-generate-preview':       { type: 'veo', label: 'Veo 3.1 Standard', rates: { '720p': 0.40, '1080p': 0.40 } },
  'gemini-omni-1.1-flash':          { type: 'omni', label: 'Gemini Omni Flash', rates: { '720p': 0.10, '1080p': 0.15 }, note: 'rẻ nhất cho clip có thoại' },
};
const CLIP_SECONDS = 8; // Veo 3.1 gen clip 8s
const MAX_CONCURRENT = 2;

// ---------- job store ----------
let jobs = [];
try {
  jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
} catch { jobs = []; }
// Job đang dở khi restart: cho poll tiếp (giữ operationName)
for (const j of jobs) {
  if (j.status === 'working' || j.status === 'queued') {
    j.status = j.operationName ? 'working' : 'queued';
    j.note = 'Tiếp tục sau khi restart server';
  }
}
function saveJobs() {
  const clean = jobs.map((j) => {
    const { _processing, ...rest } = j; // không lưu flag tạm vào file
    return rest;
  });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(clean, null, 2));
}
function newId() {
  return 'job-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function costEstimate(model, resolution, count) {
  const m = MODELS[model];
  if (!m) return 0;
  return +(m.rates[resolution] * CLIP_SECONDS * count).toFixed(2);
}

// ---------- Veo client (lazy) ----------
let ai = null;
function getAI() {
  if (!ai) {
    const { GoogleGenAI } = require('@google/genai');
    ai = new GoogleGenAI({ apiKey: API_KEY });
  }
  return ai;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function execFileP(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

async function downloadUri(uri, dest) {
  const sep = uri.includes('?') ? '&' : '?';
  const url = `${uri}${sep}key=${encodeURIComponent(API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải video lỗi HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

// ---------- worker ----------
async function processVeoJob(job) {
  const client = getAI();
  if (job.status === 'queued' || !job.operationName) {
    job.status = 'working';
    job.startedAt = job.startedAt || Date.now();
    job.note = 'Đang gửi yêu cầu lên Veo…';
    const op = await client.models.generateVideos({
      model: job.model,
      prompt: job.prompt,
      config: {
        aspectRatio: job.aspectRatio,
        resolution: job.resolution,
        negativePrompt: job.negativePrompt || undefined,
        enhancePrompt: job.enhancePrompt !== false,
        personGeneration: 'allow_adult',
        numberOfVideos: 1,
      },
    });
    job.operationName = op.name;
    saveJobs();
  }
  job.note = `Veo đang render… ${Math.round((Date.now() - job.startedAt) / 1000)}s`;
  const op = await client.operations.getVideosOperation({ operation: { name: job.operationName } });
  const elapsedMin = (Date.now() - job.startedAt) / 60000;
  job.progress = Math.min(95, Math.round((elapsedMin / 4) * 100)); // ước lượng ~4 phút
  if (op.done) {
    const gen = op.response && op.response.generatedVideos;
    if (!gen || !gen.length) throw new Error('Veo trả về rỗng (có thể bị từ chối bởi bộ lọc nội dung)');
    job.videos = [];
    for (let i = 0; i < gen.length; i++) {
      const uri = gen[i].video && gen[i].video.uri;
      if (!uri) throw new Error('Không lấy được link tải video');
      const dest = path.join(OUT_DIR, `${job.id}-${i}.mp4`);
      const bytes = await downloadUri(uri, dest);
      job.videos.push({ file: `${job.id}-${i}.mp4`, bytes });
    }
    job.status = 'done';
    job.progress = 100;
    job.note = 'Hoàn tất';
  }
}

// Gemini Omni Flash — dùng Interactions API (khác đường với Veo)
async function processOmniJob(job) {
  const client = getAI();
  if (job.status === 'queued' || !job.operationName) {
    job.status = 'working';
    job.startedAt = job.startedAt || Date.now();
    job.note = 'Đang gửi yêu cầu lên Omni…';
    const ix = await client.interactions.create({
      model: job.model,
      input: job.prompt,
      generation_config: { video_config: { task: 'text_to_video' } },
      response_format: {
        type: 'video',
        aspect_ratio: job.aspectRatio,
        resolution: job.resolution,
        duration: `${CLIP_SECONDS}s`,
      },
    });
    job.operationName = ix.id || ix.name;
    if (!job.operationName) throw new Error('Omni không trả về interaction id');
    saveJobs();
  }
  job.note = `Omni đang render… ${Math.round((Date.now() - job.startedAt) / 1000)}s`;
  const ix = await client.interactions.get(job.operationName);
  const elapsedMin = (Date.now() - job.startedAt) / 60000;
  job.progress = Math.min(95, Math.round((elapsedMin / 3) * 100)); // ước lượng ~3 phút
  const out = ix && ix.output_video;
  if (out && (out.data || out.uri)) {
    const dest = path.join(OUT_DIR, `${job.id}-0.mp4`);
    let bytes;
    if (out.data) {
      const buf = Buffer.from(out.data, 'base64');
      fs.writeFileSync(dest, buf);
      bytes = buf.length;
    } else {
      bytes = await downloadUri(out.uri, dest);
    }
    job.videos = [{ file: `${job.id}-0.mp4`, bytes }];
    job.status = 'done';
    job.progress = 100;
    job.note = 'Hoàn tất';
  } else {
    const st = (ix && ix.status ? String(ix.status) : '').toUpperCase();
    if (/FAIL|ERROR|CANCEL/.test(st)) {
      throw new Error(`Omni báo lỗi (status: ${ix.status}) — thử sửa prompt rồi gen lại`);
    }
    // chưa xong → chờ tick tiếp theo
  }
}

async function processJob(job) {
  if (job.status === 'done' || job.status === 'failed') return;
  try {
    if (MOCK) {
      // Chế độ demo: giả lập tiến độ ~40s rồi copy clip mẫu
      if (job.status === 'queued') {
        job.status = 'working';
        job.startedAt = Date.now();
      }
      const elapsed = (Date.now() - job.startedAt) / 1000;
      job.progress = Math.min(99, Math.round((elapsed / 40) * 100));
      job.note = `Đang gen (demo)… ${Math.round(elapsed)}s`;
      if (elapsed >= 40) {
        const dest = path.join(OUT_DIR, `${job.id}.mp4`);
        fs.copyFileSync(MOCK_SRC, dest);
        job.videos = [{ file: `${job.id}.mp4`, bytes: fs.statSync(dest).size }];
        job.status = 'done';
        job.progress = 100;
        job.note = 'Xong (demo — chưa tốn tiền)';
      }
    } else {
      const modelType = (MODELS[job.model] || {}).type || 'veo';
      if (modelType === 'omni') await processOmniJob(job);
      else await processVeoJob(job);
    }
  } catch (e) {
    job.status = 'failed';
    job.note = '';
    job.error = e.message || String(e);
  }
  job.updatedAt = Date.now();
  saveJobs();
}

setInterval(async () => {
  const active = jobs.filter((j) => j.status === 'working' || j.status === 'queued');
  const slots = MAX_CONCURRENT - jobs.filter((j) => j._processing).length;
  const batch = active.filter((j) => !j._processing).slice(0, Math.max(0, slots));
  await Promise.all(batch.map(async (j) => {
    j._processing = true;
    try { await processJob(j); } finally { j._processing = false; }
  }));
}, 8000);

// ---------- ffmpeg assemble ----------
async function assemble(jobIds, extraFiles, name) {
  const files = [];
  for (const id of jobIds) {
    const j = jobs.find((x) => x.id === id && x.status === 'done');
    if (!j) throw new Error(`Job ${id} chưa xong hoặc không tồn tại`);
    for (const v of j.videos) files.push(path.join(OUT_DIR, v.file));
  }
  for (const f of extraFiles || []) {
    // chống path traversal: chỉ nhận tên file, phải nằm trong output/
    const base = path.basename(f);
    if (!/^[a-zA-Z0-9-_.À-ỹ ]+\.mp4$/i.test(base)) throw new Error(`Tên file không hợp lệ: ${f}`);
    const full = path.join(OUT_DIR, base);
    if (!fs.existsSync(full)) throw new Error(`Không tìm thấy file: ${base}`);
    files.push(full);
  }
  if (!files.length) throw new Error('Không có clip nào để ghép');
  const listPath = path.join(OUT_DIR, `_list-${Date.now()}.txt`);
  fs.writeFileSync(listPath, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  const safe = (name || 'final').replace(/[^a-zA-Z0-9-_À-ỹ ]/g, '').trim().replace(/\s+/g, '-') || 'final';
  const outFile = `${safe}-${Date.now().toString(36)}.mp4`;
  const outPath = path.join(OUT_DIR, outFile);
  await execFileP('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-shortest',
    outPath,
  ]);
  fs.unlinkSync(listPath);
  return { file: outFile, bytes: fs.statSync(outPath).size, clips: files.length };
}

// ---------- API ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/output', express.static(OUT_DIR));

app.get('/api/status', (req, res) => {
  res.json({
    mock: MOCK,
    hasKey: !!API_KEY,
    clipSeconds: CLIP_SECONDS,
    models: Object.fromEntries(Object.entries(MODELS).map(([k, v]) => [k, { label: v.label, rates: v.rates, note: v.note || '' }])),
  });
});

app.get('/api/jobs', (req, res) => {
  res.json([...jobs].reverse().map((j) => ({ ...j, _processing: undefined })));
});

app.post('/api/jobs', (req, res) => {
  const { prompt, model, aspectRatio, resolution, negativePrompt, enhancePrompt, count } = req.body || {};
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Thiếu prompt' });
  if (!MODELS[model]) return res.status(400).json({ error: 'Model không hợp lệ' });
  const n = Math.min(4, Math.max(1, parseInt(count, 10) || 1));
  const created = [];
  for (let i = 0; i < n; i++) {
    const job = {
      id: newId(),
      prompt: prompt.trim(),
      model,
      aspectRatio: aspectRatio === '16:9' ? '16:9' : '9:16',
      resolution: resolution === '720p' ? '720p' : '1080p',
      negativePrompt: (negativePrompt || '').trim(),
      enhancePrompt: enhancePrompt !== false,
      status: 'queued',
      operationName: null,
      progress: 0,
      note: 'Đang chờ…',
      videos: [],
      error: '',
      costEstimate: costEstimate(model, resolution === '720p' ? '720p' : '1080p', 1),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
    };
    jobs.push(job);
    created.push({ ...job });
  }
  saveJobs();
  res.json({ jobs: created, totalEstimate: costEstimate(model, resolution === '720p' ? '720p' : '1080p', n), mock: MOCK });
});

app.delete('/api/jobs/:id', (req, res) => {
  const i = jobs.findIndex((j) => j.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Không tìm thấy job' });
  const [j] = jobs.splice(i, 1);
  for (const v of j.videos || []) {
    try { fs.unlinkSync(path.join(OUT_DIR, v.file)); } catch {}
  }
  saveJobs();
  res.json({ ok: true });
});

app.post('/api/assemble', async (req, res) => {
  try {
    const { jobIds, files, name } = req.body || {};
    const j = Array.isArray(jobIds) ? jobIds : [];
    const f = Array.isArray(files) ? files : [];
    if (!j.length && !f.length) return res.status(400).json({ error: 'Chưa chọn clip nào' });
    const r = await assemble(j, f, name);
    res.json({ ok: true, ...r, url: `/output/${r.file}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- upload clip có sẵn (vd: gen tay từ Flow Pro) ----------
async function getDuration(file) {
  try {
    const out = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file]);
    return Math.round(parseFloat(out.trim()) * 10) / 10 || 0;
  } catch { return 0; }
}
const upload = multer({
  storage: multer.diskStorage({
    destination: OUT_DIR,
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'clip.mp4')
        .normalize('NFC').replace(/[^a-zA-Z0-9-_.À-ỹ ]/g, '').trim().replace(/\s+/g, '-').slice(-60) || 'clip.mp4';
      cb(null, `upload-${Date.now().toString(36)}-${safe}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    /\.(mp4|mov|webm)$/i.test(file.originalname) ? cb(null, true) : cb(new Error('Chỉ nhận file video mp4/mov/webm'));
  },
});

app.post('/api/upload', (req, res) => {
  upload.array('clips', 10)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const out = [];
    for (const f of req.files || []) {
      out.push({ file: f.filename, bytes: f.size, url: `/output/${f.filename}`,
        duration: await getDuration(path.join(OUT_DIR, f.filename)) });
    }
    res.json({ ok: true, files: out });
  });
});

app.get('/api/uploads', async (req, res) => {
  const names = fs.readdirSync(OUT_DIR).filter((f) => f.startsWith('upload-') && /\.mp4$/i.test(f));
  const list = [];
  for (const f of names) {
    const full = path.join(OUT_DIR, f);
    const st = fs.statSync(full);
    list.push({ file: f, bytes: st.size, url: `/output/${f}`,
      createdAt: st.mtimeMs, duration: await getDuration(full) });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json(list);
});

app.delete('/api/uploads/:file', (req, res) => {
  const base = path.basename(req.params.file);
  if (!base.startsWith('upload-')) return res.status(400).json({ error: 'File không hợp lệ' });
  try { fs.unlinkSync(path.join(OUT_DIR, base)); } catch {}
  res.json({ ok: true });
});

ensureMockSource().then(() => {
  app.listen(PORT, process.env.HOST || '127.0.0.1', () => {
    console.log(`Veo Studio chạy tại http://127.0.0.1:${PORT} ${MOCK ? '(MOCK — demo, chưa tốn tiền)' : '(LIVE — Veo API thật)'}`);
  });
});
