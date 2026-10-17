# Kino's RunPod Serverless worker: runpod/worker-comfyui with ComfyUI 0.41.0,
# the release Kino's workflows are built and validated against (the base image
# ships 0.34, which lacks the MiniMax H3, Qwen Image 2.1, LTX-2.3 and SeedVR2
# nodes).
#
#   docker build --platform linux/amd64 -t <dockerhub-user>/kino-worker:0.41.0 runpod
#   docker push <dockerhub-user>/kino-worker:0.41.0
#
# Models are not baked in: they live on a RunPod network volume mounted at
# /runpod-volume (see README.md), so the image stays small and one volume
# serves every worker. worker-comfyui is AGPL-3.0; this file only builds on its
# published image.

FROM runpod/worker-comfyui:5.10.0-base

ARG COMFYUI_VERSION=0.41.0

# Swap in the pinned ComfyUI release, keep the image's custom nodes, install the
# release's requirements alongside the base image's torch build, and fail the
# build if ComfyUI can't start.
RUN set -eux; \
    wget -qO /tmp/comfyui.tar.gz "https://github.com/Comfy-Org/ComfyUI/archive/refs/tags/v${COMFYUI_VERSION}.tar.gz"; \
    mkdir /tmp/comfyui; \
    tar -xzf /tmp/comfyui.tar.gz -C /tmp/comfyui --strip-components=1; \
    cp -a /comfyui/custom_nodes/. /tmp/comfyui/custom_nodes/ 2>/dev/null || true; \
    rm -rf /comfyui; \
    mv /tmp/comfyui /comfyui; \
    rm /tmp/comfyui.tar.gz; \
    uv pip install -r /comfyui/requirements.txt "transformers>=4.50.3,<5" "huggingface-hub<1.0"; \
    cd /comfyui && timeout 300 python main.py --quick-test-for-ci --cpu

# Every model folder Kino's apps load from, on the network volume.
COPY extra_model_paths.yaml /comfyui/extra_model_paths.yaml
