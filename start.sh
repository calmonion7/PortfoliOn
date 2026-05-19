#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

# Kill existing processes on ports 8000 and 5173
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

echo "Starting backend..."
cd "$BACKEND_DIR"
source .venv/bin/activate
uvicorn main:app --reload --port 8000 &> /tmp/portfolion-backend.log &
BACKEND_PID=$!

echo "Starting frontend..."
cd "$FRONTEND_DIR"
npm run dev &> /tmp/portfolion-frontend.log &
FRONTEND_PID=$!

# Wait for servers to be ready
echo "Waiting for servers..."
until curl -s http://localhost:8000/health > /dev/null 2>&1; do sleep 0.5; done
until curl -s http://localhost:5173 > /dev/null 2>&1; do sleep 0.5; done

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo ""

open http://localhost:5173
echo "Browser opened. Logs: /tmp/portfolion-backend.log, /tmp/portfolion-frontend.log"
