#!/bin/bash

echo "Stopping Screenshot-to-Code Services..."
echo "========================================"

pkill -f "python3 .*detection_service.py" && echo "Stopped Python detection service" || true
pkill -f "ollama serve" && echo "Stopped Ollama service" || true
pkill -f "node server.js" && echo "Stopped backend server" || true
pkill -f "npm start" && echo "Stopped backend npm process" || true
pkill -f "vite" && echo "Stopped frontend dev server" || true

echo
echo "All services stopped!"
