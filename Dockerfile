# The Kino studio, for running it on a server (a VPS, Fly.io, Railway, a RunPod
# CPU pod). This is the studio itself; the GPU worker is runpod/Dockerfile.
# GitHub Actions publishes it as ghcr.io/jamesliuzx/kino (.github/workflows/kino.yml).
#
#   docker run -p 7860:7860 -e KINO_TOKEN=<access code> -v kino-data:/data ghcr.io/jamesliuzx/kino
#   docker build -t kino .     # or build it yourself
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 7860) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "server.mjs"]
