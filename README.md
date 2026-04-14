# Screenshot to Code

A web application that converts UI screenshots into clean HTML and CSS code using AI.

## Features

- Google Authentication via Firebase
- Image upload and processing
- AI-powered code generation (mock implementation)
- SQLite database for storing generated code
- Real-time chat interface

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Start the backend server:
```bash
npm run dev
```

The backend will run on `http://localhost:3001`

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

## Usage

1. Open the frontend in your browser
2. Click "Get Started" and sign in with Google
3. Upload a screenshot image
4. The AI will generate HTML/CSS code from your screenshot
5. Copy and use the generated code

## Architecture

- **Frontend**: React + Vite with Firebase Authentication
- **Backend**: Express.js REST API
- **Database**: SQLite for storing users and generated code
- **File Storage**: Local file system for uploaded images

## API Endpoints

- `POST /api/upload` - Upload image and generate code
- `POST /api/save-code` - Save generated code to database
- `GET /api/history` - Get user's code generation history