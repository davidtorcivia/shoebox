FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    INSIGHTFACE_HOME=/models

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libglib2.0-0 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY faces/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

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
RUN groupadd -g 1000 faces && useradd -u 1000 -g 1000 -m -s /usr/sbin/nologin faces \
    && chown -R faces:faces /app /models

USER faces

CMD ["python", "-m", "main"]
