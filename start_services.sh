#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PYTHON_LOG="$LOG_DIR/detection_service.log"
OLLAMA_LOG="$LOG_DIR/ollama.log"
BACKEND_LOG="$LOG_DIR/backend.log"

mkdir -p "$LOG_DIR"

echo "Starting Screenshot-to-Code Services..."
echo "========================================"
echo "Logs directory: $LOG_DIR"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_listening() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket
import sys

port = int(sys.argv[1])
sock = socket.socket()
sock.settimeout(0.5)
try:
    sock.connect(("127.0.0.1", port))
except OSError:
    sys.exit(1)
else:
    sys.exit(0)
finally:
    sock.close()
PY
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local retries="${4:-15}"
  local delay="${5:-1}"

  for _ in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $label: Running"
      return 0
    fi
    sleep "$delay"
  done

  echo "✗ $label: Failed"
  if [ -f "$log_file" ]; then
    echo "--- Last 40 lines of $log_file ---"
    tail -n 40 "$log_file"
    echo "--- End log ---"
  fi
  return 1
}

start_if_needed() {
  local label="$1"
  local port="$2"
  local log_file="$3"
  shift 3

  if is_listening "$port"; then
    echo "$label already listening on port $port"
    return 0
  fi

  : > "$log_file"
  "$@" >"$log_file" 2>&1 &
  local pid=$!
  echo "Started $label (PID $pid)"
  return 0
}

if ! command_exists python3; then
  echo "python3 is required but not installed."
  exit 1
fi

if ! command_exists node; then
  echo "node is required but not installed."
  exit 1
fi

if ! command_exists npm; then
  echo "npm is required but not installed."
  exit 1
fi

if ! command_exists curl; then
  echo "curl is required but not installed."
  exit 1
fi

echo "Starting Python detection service on port 5001..."
start_if_needed "Python detection service" 5001 "$PYTHON_LOG" python3 "$ROOT_DIR/detection_service.py"

if command_exists ollama; then
  echo "Starting Ollama service on port 11434..."
  start_if_needed "Ollama service" 11434 "$OLLAMA_LOG" ollama serve
else
  echo "Ollama binary not found. Skipping Ollama startup."
fi

echo "Starting backend server on port 3001..."
(
  cd "$ROOT_DIR/backend" || exit 1
  if [ ! -d node_modules ]; then
    echo "backend/node_modules is missing. Run: cd backend && npm install" >&2
    exit 1
  fi
  npm start
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "Started backend server (PID $BACKEND_PID)"

echo
echo "Checking service status..."
wait_for_http "http://127.0.0.1:5001/health" "Python service" "$PYTHON_LOG" || true
if command_exists ollama; then
  wait_for_http "http://127.0.0.1:11434/api/tags" "Ollama service" "$OLLAMA_LOG" || true
fi
wait_for_http "http://127.0.0.1:3001/api/status" "Backend server" "$BACKEND_LOG"

echo
echo "Frontend command: cd frontend && npm run dev"
echo "Stop command: ./stop_services.sh"
