#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==========================================================="
echo "⚡ Starting HyperX Full-Stack System"
echo "   MongoDB • Express.js • React 18 • Node.js"
echo "==========================================================="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Error: Node.js (v18+) is required but was not found in PATH."
  exit 1
fi

# Check npm
if ! command -v npm &>/dev/null; then
  echo "❌ Error: npm is required but was not found in PATH."
  exit 1
fi

cleanup() {
  echo ""
  echo "Shutting down HyperX services..."
  kill $(jobs -p) 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start Node.js Express + Mongoose Backend
echo "🚀 [1/2] Starting Node.js Express + Mongoose Backend on http://localhost:8080..."
cd "$ROOT_DIR/backend"
node src/server.js &

# Wait for backend to bind port
sleep 1.5

# 2. Start React + Vite Frontend
echo "💻 [2/2] Starting React + Vite Frontend on http://localhost:5173..."
cd "$ROOT_DIR/frontend"
npm run dev &

echo ""
echo "==========================================================="
echo "✅ HyperX System is LIVE!"
echo "   - Frontend Web App:     http://localhost:5173"
echo "   - Backend Health API:   http://localhost:8080/api/v1/health"
echo "   - REST Endpoints:       http://localhost:8080/api/v1/(auth|rooms|crdt)"
echo "   - WebSocket Signaling:  ws://localhost:8080/ws/signaling"
echo "==========================================================="
echo "Press Ctrl+C to stop all servers."

wait
