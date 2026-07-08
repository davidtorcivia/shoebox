# Faces worker image.
#
# Two build modes, selected by the FACE_GPU build arg:
#
#   * CPU (default) -- exactly as this image has always shipped:
#       docker build -f faces/Dockerfile -t shoebox-faces .
#
#   * Intel GPU / OpenVINO (Intel ARC, Xe, recent iGPU):
#       docker build -f faces/Dockerfile --build-arg FACE_GPU=openvino \
#         -t shoebox-faces:openvino .
#     This installs the Intel user-space compute stack (OpenCL + Level Zero)
#     and swaps onnxruntime for onnxruntime-openvino. At run time set
#     FACE_PROVIDERS=OpenVINOExecutionProvider,CPUExecutionProvider and pass the
#     GPU through with `--device /dev/dri` (see docker-compose.faces-gpu.yml).
#
# The default build (FACE_GPU empty) touches none of the GPU paths and remains
# CPU-only, byte-for-byte as before.
FROM python:3.12-slim AS base

ARG FACE_GPU=

ENV PYTHONUNBUFFERED=1 \
    INSIGHTFACE_HOME=/models

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Intel GPU user-space runtime -- only for the openvino build. The default CPU
# image never installs these packages. We pull the Intel compute runtime and
# Level Zero driver from bookworm-backports, which ships a version new enough for
# discrete ARC silicon (A770 / DG2); the stock bookworm packages are too old to
# enumerate ARC. If a still-newer host GPU isn't detected (check `clinfo` inside
# the container), add Intel's apt repo (https://repositories.intel.com/gpu) and
# install intel-opencl-icd / intel-level-zero-gpu from there instead.
RUN if [ "$FACE_GPU" = "openvino" ]; then \
        echo 'deb http://deb.debian.org/debian bookworm-backports main contrib non-free non-free-firmware' \
            > /etc/apt/sources.list.d/backports.list \
        && apt-get update \
        && apt-get install -y --no-install-recommends ocl-icd-libopencl1 clinfo \
        && apt-get install -y --no-install-recommends -t bookworm-backports \
            intel-opencl-icd libze1 intel-level-zero-gpu \
        && rm -rf /var/lib/apt/lists/*; \
    fi

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
# /dev/dri; supply the host's render group via `group_add` (see
# docker-compose.faces-gpu.yml) so this uid-1000 user can open the device.
RUN groupadd -g 1000 faces && useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin faces \
    && chown -R faces:faces /app /models

USER faces

CMD ["python", "-m", "main"]
