const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const jobs = new Map();

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, ...opts });
    let out = '', err = '';
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ out, err }) : reject(new Error(err.slice(-3000) || `${command} terminó con código ${code}`)));
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function safeName(s) { return s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'clip'; }

async function getVideoInfo(file) {
  const { out } = await run('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', file]);
  const duration = Number(out.trim());
  if (!Number.isFinite(duration) || duration < 8) throw new Error('El video es demasiado corto o no se pudo leer.');
  return duration;
}

async function silenceRanges(file, duration) {
  const { err } = await run('ffmpeg', ['-hide_banner','-i',file,'-vn','-af','silencedetect=noise=-32dB:d=0.65','-f','null','-']);
  const ranges = [];
  let start = null;
  for (const line of err.split(/\r?\n/)) {
    const a = line.match(/silence_start: ([\d.]+)/);
    const b = line.match(/silence_end: ([\d.]+)/);
    if (a) start = Number(a[1]);
    if (b && start !== null) { ranges.push([start, Number(b[1])]); start = null; }
  }
  if (start !== null) ranges.push([start, duration]);
  return ranges;
}

function chooseClips(duration, silences) {
  const len = Math.min(40, Math.max(15, duration * 0.35));
  const step = Math.max(5, len / 3);
  const starts = new Set([0, Math.max(0, duration - len), Math.max(0, (duration - len) / 2)]);
  for (let t = 0; t + len <= duration; t += step) starts.add(t);
  const candidates = [...starts].filter(s => s + Math.min(len, duration - s) >= 8).map(start => {
    const end = Math.min(duration, start + len);
    const silent = silences.reduce((sum, [a,b]) => sum + Math.max(0, Math.min(end,b) - Math.max(start,a)), 0);
    const span = end - start;
    const silentRatio = silent / span;
    const middle = (start + end) / 2;
    const positionBonus = Math.max(0, 1 - Math.abs(middle / duration - 0.5) * 0.35);
    return { start, end, score: (1 - silentRatio) * 0.75 + positionBonus * 0.25 };
  }).sort((a,b) => b.score - a.score);
  const picked = [];
  for (const c of candidates) {
    if (picked.every(p => Math.abs(p.start - c.start) > len * 0.62)) picked.push(c);
    if (picked.length === 5) break;
  }
  return picked.sort((a,b) => a.start - b.start);
}

async function processVideo(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Pega un enlace válido.'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('El enlace debe comenzar con http:// o https://');
  const id = crypto.randomUUID();
  const dir = path.join(DATA, id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    const source = path.join(dir, 'source.mp4');
    await run('yt-dlp', ['--no-playlist','--no-warnings','--format','bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b','--merge-output-format','mp4','--max-filesize','1G','--output',source,url]);
    if (!fs.existsSync(source)) throw new Error('No se pudo descargar el video desde ese enlace.');
    const duration = await getVideoInfo(source);
    const silence = await silenceRanges(source, duration);
    const clips = chooseClips(duration, silence);
    const title = safeName(parsed.hostname.replace(/^www\./, ''));
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      const filename = `clip-${i + 1}.mp4`;
      await run('ffmpeg', ['-y','-ss',c.start.toFixed(2),'-i',source,'-t',(c.end-c.start).toFixed(2),'-c:v','libx264','-preset','veryfast','-crf','23','-c:a','aac','-movflags','+faststart',path.join(dir,filename)]);
      c.id = `${id}/${filename}`;
    }
    fs.unlinkSync(source);
    return { id, title, duration, clips };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  if (origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return send(res, 200, { status: 'ok' });
  }
  if (req.method === 'POST' && url.pathname === '/api/process') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10000) req.destroy(); });
    req.on('end', async () => {
      try {
        const { videoUrl } = JSON.parse(body || '{}');
        if (!videoUrl) return send(res, 400, { error: 'Pega el enlace del video para comenzar.' });
        const result = await processVideo(videoUrl);
        send(res, 200, result);
      } catch (e) { send(res, 400, { error: e.message.includes('ENOENT') ? 'Falta yt-dlp o ffmpeg. Instálalos y vuelve a iniciar la app.' : e.message }); }
    });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const rel = decodeURIComponent(url.pathname.slice('/media/'.length));
    const file = path.resolve(DATA, rel);
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file)) return send(res, 404, { error: 'Archivo no encontrado.' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${path.basename(file)}"`, 'X-Content-Type-Options':'nosniff' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/preview/')) {
    const rel = decodeURIComponent(url.pathname.slice('/preview/'.length));
    const file = path.resolve(DATA, rel);
    if (!file.startsWith(DATA + path.sep) || !fs.existsSync(file)) return send(res, 404, { error: 'Archivo no encontrado.' });
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'X-Content-Type-Options':'nosniff' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  const filePath = url.pathname === '/' ? path.join(ROOT,'index.html') : path.resolve(ROOT, '.' + decodeURIComponent(url.pathname));
  if (!filePath.startsWith(ROOT + path.sep) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, 'No encontrado.', 'text/plain; charset=utf-8');
  const type = filePath.endsWith('.css') ? 'text/css; charset=utf-8' : filePath.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
  send(res, 200, fs.readFileSync(filePath), type);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') console.error(`El puerto ${PORT} ya está ocupado. Inicia con PORT=${PORT + 1} para usar otro.`);
  else console.error(error.message);
  process.exitCode = 1;
});
server.listen(PORT, HOST, () => console.log(`Clipwise está listo en http://${HOST}:${PORT}`));
