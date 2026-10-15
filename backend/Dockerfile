# Multi-stage/lightweight production Dockerfile for HyperX Python / FastAPI Backend
FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system dependencies & curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Create non-root user
RUN groupadd -r hyperx && useradd -r -g hyperx hyperx

# Copy application source code
COPY app/ app/

# Grant appropriate permissions
RUN chown -R hyperx:hyperx /app

USER hyperx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=5s \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
