FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
    && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js ./server.js
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
