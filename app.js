const form = document.querySelector('#video-form');
const input = document.querySelector('#video-url');
const button = document.querySelector('#submit-btn');
const statusBox = document.querySelector('#status');
const results = document.querySelector('#results');
const fmtTime = n => { const s = Math.floor(n); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; };
form.addEventListener('submit', async e => {
  e.preventDefault();
  statusBox.className = 'status'; statusBox.textContent = 'Descargando y analizando el video… puede tardar un poco.';
  button.disabled = true; button.querySelector('span').textContent = 'Procesando…'; results.classList.add('hidden');
  try {
    const response = await fetch('/api/process', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ videoUrl:input.value.trim() }) });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Aún falta conectar el procesador. Despliega el Dockerfile en un servicio que acepte contenedores y reemplaza replace-with-your-backend.example en netlify.toml por la URL HTTPS que te asignen.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo procesar el video.');
    document.querySelector('#video-meta').textContent = `${data.title} · ${fmtTime(data.duration)} de video`;
    document.querySelector('#clip-count').textContent = `${data.clips.length} clips`;
    document.querySelector('#clips').innerHTML = data.clips.map((clip,i) => {
      const duration = clip.end - clip.start;
      const href = `/media/${encodeURIComponent(clip.id).replaceAll('%2F','/')}`;
      const preview = `/preview/${encodeURIComponent(clip.id).replaceAll('%2F','/')}`;
      return `<article class="clip-card"><div class="preview"><video src="${preview}" controls preload="metadata" aria-label="Vista previa del clip ${i+1}"></video><span class="clip-number">CLIP 0${i+1}</span><span class="duration">${fmtTime(duration)}</span></div><div class="card-body"><div class="clip-title">Momento destacado ${i+1}</div><div class="clip-time">${fmtTime(clip.start)} – ${fmtTime(clip.end)} · ${Math.round(clip.score*100)}% sin silencios</div><a class="download" href="${href}" download="${data.title}-clip-${i+1}.mp4"><span>↓</span> Descargar clip</a></div></article>`;
    }).join('');
    results.classList.remove('hidden'); statusBox.textContent = '¡Listo! Puedes descargar cada clip por separado.';
    results.scrollIntoView({behavior:'smooth',block:'start'});
  } catch (err) {
    statusBox.className = 'status error';
    statusBox.textContent = err instanceof TypeError && err.message.includes('fetch')
      ? 'No se pudo conectar con el servidor de procesamiento. En local, inicia node server.js; en Netlify, configura el backend y el proxy.'
      : err.message;
  }
  finally { button.disabled = false; button.querySelector('span').textContent = 'Encontrar clips'; }
});
