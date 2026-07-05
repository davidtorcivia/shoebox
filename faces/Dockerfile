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

CMD ["python", "-m", "main"]
