# Clipwise

App para pegar el enlace de un video, encontrar hasta cinco segmentos con menos silencios y descargar cada uno como MP4.

## Requisitos

- Node.js 18 o superior
- `yt-dlp` instalado y disponible en PATH
- `ffmpeg` y `ffprobe` instalados y disponibles en PATH

## Iniciar

Desde esta carpeta ejecuta:

```powershell
node server.js
```

Abre http://127.0.0.1:3003. En PowerShell, para cambiar el puerto, ejecuta `$env:PORT='3004'` antes de `node server.js`.

La app procesa enlaces públicos que `yt-dlp` pueda leer; algunos sitios, videos privados o protegidos pueden no funcionar. El análisis actual detecta silencios y selecciona hasta cinco ventanas de 15–40 segundos. No interpreta el significado del video, por lo que conviene revisar los clips antes de publicarlos. Usa contenido que tengas derecho a descargar y editar.

Los archivos temporales y clips se guardan en `data/` dentro de esta carpeta.

## Publicar la interfaz en Netlify

El frontend estático está configurado en `netlify.toml`. El procesamiento requiere un backend público separado que ejecute Node.js, `yt-dlp` y `ffmpeg`; `Dockerfile` prepara ese backend para un servicio de contenedores. Netlify no ejecutará `server.js` como servidor local persistente.

1. Publica esta carpeta como raíz del sitio en Netlify (o configúrala como base directory si el repositorio contiene otras carpetas). `public/` contiene solo HTML, CSS y JavaScript, así que Netlify no publica el directorio de videos ni el código del backend.
2. Despliega el backend desde `Dockerfile` en un servicio que admita contenedores y mantenga disponible el directorio `data/` mientras se descargan los clips.
3. Cambia `replace-with-your-backend.example` en las tres reglas de `netlify.toml` por el dominio HTTPS asignado al backend y vuelve a desplegar el sitio.

Hasta que exista ese dominio de backend, las reglas de proxy son una plantilla y la extracción desde el sitio publicado no funcionará. Netlify documenta los proxies externos mediante reglas de reescritura; la función estática y el backend deben estar desplegados por separado.
