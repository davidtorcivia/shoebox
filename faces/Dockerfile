# Faces worker image. Two build modes, selected by the FACE_GPU build arg (and a
# matching base image):
#
#   * CPU (default) -- Debian slim, CPU onnxruntime:
#       docker build -f faces/Dockerfile -t shoebox-faces .
#
#   * Intel GPU / OpenVINO (Intel ARC A770 / DG2, Xe, recent iGPU):
#       docker build -f faces/Dockerfile \
#         --build-arg BASE_IMAGE=ubuntu:24.04 --build-arg FACE_GPU=openvino \
#         -t shoebox-faces:openvino .
#     Why an Ubuntu base: Debian does not package the Intel *compute* runtime
#     (OpenCL NEO + Level Zero GPU driver) that OpenVINO needs to reach the GPU;
#     Ubuntu 24.04's own repos ship a consistent, ARC-capable set (intel-opencl-icd
#     23.43 + libze-intel-gpu1). Building on Ubuntu means every Intel package comes
#     from one repo, so their dependencies resolve. The OpenVINO runtime itself
#     ships inside the onnxruntime-openvino wheel; the apt packages are the
#     kernel-facing user-space driver it talks to over /dev/dri.
#     At run time set FACE_PROVIDERS=OpenVINOExecutionProvider,CPUExecutionProvider
#     and pass the GPU through with `--device /dev/dri` (docker-compose does this).
#
# Python lives in a venv (/opt/venv) so the pip flow is identical on both bases
# (the slim base ships Python; the Ubuntu base installs it from apt).
ARG BASE_IMAGE=python:3.12-slim
FROM ${BASE_IMAGE} AS base

ARG FACE_GPU=

ENV PYTHONUNBUFFERED=1 \
    INSIGHTFACE_HOME=/models \
    PATH=/opt/venv/bin:$PATH

WORKDIR /app

# System deps + the Python venv. The openvino build additionally installs the
# Intel OpenCL (NEO) and Level Zero compute drivers ARC needs, all from the
# Ubuntu base's own repos; the CPU build stays on the slim Debian base.
RUN set -eux; \
    apt-get update; \
    if [ "$FACE_GPU" = "openvino" ]; then \
        apt-get install -y --no-install-recommends \
            python3 python3-venv python3-dev build-essential \
            libglib2.0-0t64 libgl1 libgomp1 \
            ocl-icd-libopencl1 clinfo libze1 intel-opencl-icd libze-intel-gpu1; \
        python3 -m venv /opt/venv; \
    else \
        apt-get install -y --no-install-recommends \
            build-essential libglib2.0-0 libgl1 libgomp1; \
        python -m venv /opt/venv; \
    fi; \
    rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir --upgrade pip

# Install Python deps. openvino build installs onnxruntime-openvino (which
# provides the same `onnxruntime` module, GPU-enabled); default installs the
# CPU onnxruntime. The two wheels conflict, so exactly one is installed.
COPY faces/requirements.txt ./requirements.txt
COPY faces/requirements-openvino.txt ./requirements-openvino.txt
RUN if [ "$FACE_GPU" = "openvino" ]; then \
        pip install --no-cache-dir -r requirements-openvino.txt; \
    else \
        pip install --no-cache-dir -r requirements.txt; \
    fi

# Warm/bake the buffalo_l pack. Warmup always uses the CPU provider (present in
# both onnxruntime builds) so the download+prepare works regardless of whether a
# GPU is available at build time.
RUN python -c "from insightface.app import FaceAnalysis; app = FaceAnalysis(name='buffalo_l', root='/models', providers=['CPUExecutionProvider']); app.prepare(ctx_id=0, det_size=(640, 640))"

COPY faces/ ./

FROM base AS test

COPY faces/requirements-test.txt ./requirements-test.txt
RUN pip install --no-cache-dir -r requirements-test.txt
CMD ["pytest", "tests", "-v"]

FROM base AS runtime

# Run the worker as a non-root user (uid/gid 1000, matching the node app) so a
# compromise while scanning untrusted media cannot escalate to root on the
# mounted /data and /media volumes. Host bind-mounts must be uid-1000 writable,
# the same requirement the app container already imposes.
#
# For the OpenVINO GPU build the container additionally needs access to
# /dev/dri; supply the host's render group via `group_add` (see docker-compose)
# so this uid-1000 user can open the device.
# The Ubuntu base ships a default 'ubuntu' user at uid/gid 1000; drop it so we
# can claim 1000 for 'faces' (a no-op on the Debian base, which has no such user).
#
# Deliberately NO `chown -R` of /app, /models, or /opt/venv: pip and the model
# bake run as root with umask 022, so everything is already world-readable, and
# the worker only writes to the mounted volumes and its own home. On overlayfs a
# recursive chown copies every file (~3GB of venv + model pack) into a fresh
# layer, which turned each code-change rebuild into a multi-minute commit.
RUN (userdel -r ubuntu 2>/dev/null || true) \
    && groupadd -g 1000 faces \
    && useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin faces

USER faces

CMD ["python", "-m", "main"]
