#!/bin/bash

echo "Stopping Screenshot-to-Code Services..."
echo "========================================"

# Stop Python service
pkill -f "python3 detection_service.py" && echo "Stopped Python detection service"

# Stop Ollama service
pkill -f "ollama serve" && echo "Stopped Ollama service"

# Stop backend server
pkill -f "node server.js" && echo "Stopped backend server"

echo ""
echo "All services stopped!"
