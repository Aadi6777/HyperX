#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==========================================================="
echo "⚡ Starting HyperX Full-Stack System"
echo "==========================================================="

# Detect Python binary
PYTHON_BIN=""
if command -v python3 &>/dev/null; then
  PYTHON_BIN="python3"
elif command -v python &>/dev/null; then
  PYTHON_BIN="python"
elif [ -f "/opt/anaconda3/bin/python3" ]; then
  PYTHON_BIN="/opt/anaconda3/bin/python3"
else
  echo "❌ Error: Python 3 is required but could not be located."
  exit 1
fi

# Detect npm
if ! command -v npm &>/dev/null; then
  echo "❌ Error: npm is required but could not be located."
  exit 1
fi

cleanup() {
  echo ""
  echo "Shutting down HyperX services..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start Python FastAPI Backend
echo "🚀 [1/2] Starting Python FastAPI Backend on http://localhost:8080..."
cd "$ROOT_DIR/backend"
"$PYTHON_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port 8080 &

# Wait for backend to become available
sleep 2

# 2. Start React + Vite Frontend
echo "💻 [2/2] Starting React + Vite Frontend on http://localhost:5173..."
cd "$ROOT_DIR/frontend"
npm run dev &

echo ""
echo "==========================================================="
echo "✅ HyperX is running!"
echo "   - Frontend Web App:     http://localhost:5173"
echo "   - Backend Health API:   http://localhost:8080/api/v1/health"
echo "   - WebSocket Signaling:  ws://localhost:8080/ws/signaling"
echo "==========================================================="
echo "Press Ctrl+C to stop all servers."

wait

