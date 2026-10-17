# The Kino studio, for running it on a server (a VPS, Fly.io, Railway, a RunPod
# CPU pod). This is the studio itself; the GPU worker is runpod/Dockerfile.
#
#   docker build -t kino .
#   docker run -p 7860:7860 -e KINO_TOKEN=<access code> -v kino-data:/data kino
#
# Settings saved in the studio live in /data with your files, so keep the volume.
FROM node:22-slim

# ffmpeg (with libass) for instant camera moves and ad renders, and a CJK font
# for Chinese captions (WenQuanYi Zen Hei is the studio's default).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-wqy-zenhei fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .

RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=7860 KINO_DATA=/data
VOLUME /data
EXPOSE 7860
USER node
CMD ["node", "server.mjs"]
