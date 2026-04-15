#!/bin/bash

echo "Starting Screenshot-to-Code Services..."
echo "========================================"

# Start Python detection service
echo "Starting Python detection service on port 5001..."
python3 detection_service.py > detection_service.log 2>&1 &
PYTHON_PID=$!
sleep 2

# Start Ollama service
echo "Starting Ollama service on port 11434..."
ollama serve > ollama.log 2>&1 &
OLLAMA_PID=$!
sleep 2

# Start backend server
echo "Starting backend server on port 3001..."
cd backend && node server.js > backend.log 2>&1 &
BACKEND_PID=$!
cd ..
sleep 2

# Check services
echo ""
echo "Checking service status..."
curl -s http://localhost:5001/health > /dev/null && echo "✓ Python service: Running" || echo "✗ Python service: Failed"
curl -s http://localhost:3001/api/status > /dev/null && echo "✓ Backend server: Running" || echo "✗ Backend server: Failed"
curl -s http://localhost:11434/api/tags > /dev/null && echo "✓ Ollama service: Running" || echo "✗ Ollama service: Failed"

echo ""
echo "All services started!"
echo "Python PID: $PYTHON_PID"
echo "Ollama PID: $OLLAMA_PID"
echo "Backend PID: $BACKEND_PID"
echo ""
echo "To start frontend: cd frontend && npm run dev"
echo "To stop services: ./stop_services.sh"
