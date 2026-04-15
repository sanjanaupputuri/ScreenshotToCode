import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PYTHON_SERVICE = 'http://127.0.0.1:5001';
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_SCRIPT = path.join(PROJECT_ROOT, 'detection_service.py');

function runPythonDetection(imagePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [PYTHON_SCRIPT, '--once', imagePath], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Python CLI detection timed out'));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python CLI detection failed with exit code ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Invalid detection JSON: ${error.message}`));
      }
    });
  });
}

export class DetectionService {

  static async detectElements(imagePath) {
    // Use absolute path - resolve relative to project root
    const absPath = path.isAbsolute(imagePath)
      ? imagePath
      : path.resolve(imagePath);

    try {
      const response = await fetch(`${PYTHON_SERVICE}/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_path: absPath }),
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Detection service error');
      }

      const data = await response.json();
      return {
        components: data.components || [],
        image: data.image || null,
      };

    } catch (error) {
      console.warn('Python detection service unavailable, trying CLI detector:', error.message);

      try {
        const data = await runPythonDetection(absPath);
        return {
          components: data.components || [],
          image: data.image || null,
        };
      } catch (cliError) {
        console.warn('Python CLI detection unavailable, using fallback:', cliError.message);
        return this.fallbackDetection();
      }
    }
  }

  // Fallback when Python service is down
  static fallbackDetection() {
    return {
      image: { width: 800, height: 600, background_color: '#ffffff' },
      components: [
        {
          kind: 'background',
          type: 'background',
          text: '',
          x: 0,
          y: 0,
          width: 800,
          height: 600,
          x_pct: 0,
          y_pct: 0,
          w_pct: 1,
          h_pct: 1,
          background_color: '#ffffff',
          border_color: 'transparent',
          border_width: 0,
          border_radius: 0,
          text_color: 'transparent',
          font_size: 0,
          font_weight: 0,
          text_align: 'left',
          z_index: 0,
          area: 480000,
        },
        {
          kind: 'shape',
          type: 'toolbar',
          text: '',
          x: 0,
          y: 0,
          width: 800,
          height: 42,
          x_pct: 0,
          y_pct: 0,
          w_pct: 1,
          h_pct: 0.07,
          background_color: '#f6f8fa',
          border_color: '#d0d7de',
          border_width: 1,
          border_radius: 0,
          text_color: 'transparent',
          font_size: 0,
          font_weight: 0,
          text_align: 'left',
          z_index: 5,
          area: 33600,
        },
        {
          kind: 'shape',
          type: 'button',
          text: '',
          x: 300,
          y: 200,
          width: 200,
          height: 60,
          x_pct: 0.375,
          y_pct: 0.333333,
          w_pct: 0.25,
          h_pct: 0.1,
          background_color: '#3b82f6',
          border_color: '#3b82f6',
          border_width: 1,
          border_radius: 8,
          text_color: 'transparent',
          font_size: 0,
          font_weight: 0,
          text_align: 'left',
          z_index: 5,
          area: 12000,
        },
        {
          kind: 'shape',
          type: 'input',
          text: '',
          x: 200,
          y: 320,
          width: 400,
          height: 50,
          x_pct: 0.25,
          y_pct: 0.533333,
          w_pct: 0.5,
          h_pct: 0.083333,
          background_color: '#ffffff',
          border_color: '#c8c8c8',
          border_width: 2,
          border_radius: 6,
          text_color: 'transparent',
          font_size: 0,
          font_weight: 0,
          text_align: 'left',
          z_index: 5,
          area: 20000,
        },
        {
          kind: 'shape',
          type: 'panel',
          text: '',
          x: 100,
          y: 420,
          width: 250,
          height: 130,
          x_pct: 0.125,
          y_pct: 0.7,
          w_pct: 0.3125,
          h_pct: 0.216667,
          background_color: '#f3f4f6',
          border_color: '#c8c8c8',
          border_width: 2,
          border_radius: 8,
          text_color: 'transparent',
          font_size: 0,
          font_weight: 0,
          text_align: 'left',
          z_index: 5,
          area: 32500,
        },
        {
          kind: 'text',
          type: 'text',
          text: 'Welcome to Our App',
          x: 200,
          y: 72,
          width: 380,
          height: 30,
          x_pct: 0.25,
          y_pct: 0.12,
          w_pct: 0.475,
          h_pct: 0.05,
          background_color: 'transparent',
          border_color: 'transparent',
          border_width: 0,
          border_radius: 0,
          text_color: '#ffffff',
          font_size: 24,
          font_weight: 700,
          text_align: 'left',
          z_index: 20,
          area: 11400,
        },
        {
          kind: 'text',
          type: 'text',
          text: 'Get Started',
          x: 322,
          y: 220,
          width: 140,
          height: 20,
          x_pct: 0.4025,
          y_pct: 0.366667,
          w_pct: 0.175,
          h_pct: 0.033333,
          background_color: 'transparent',
          border_color: 'transparent',
          border_width: 0,
          border_radius: 0,
          text_color: '#ffffff',
          font_size: 18,
          font_weight: 600,
          text_align: 'left',
          z_index: 20,
          area: 2800,
        },
        {
          kind: 'text',
          type: 'text',
          text: 'Enter your email',
          x: 222,
          y: 337,
          width: 150,
          height: 18,
          x_pct: 0.2775,
          y_pct: 0.561667,
          w_pct: 0.1875,
          h_pct: 0.03,
          background_color: 'transparent',
          border_color: 'transparent',
          border_width: 0,
          border_radius: 0,
          text_color: '#6b7280',
          font_size: 14,
          font_weight: 400,
          text_align: 'left',
          z_index: 20,
          area: 2700,
        },
        {
          kind: 'text',
          type: 'text',
          text: 'Feature Card\nDescription text',
          x: 130,
          y: 454,
          width: 150,
          height: 62,
          x_pct: 0.1625,
          y_pct: 0.756667,
          w_pct: 0.1875,
          h_pct: 0.103333,
          background_color: 'transparent',
          border_color: 'transparent',
          border_width: 0,
          border_radius: 0,
          text_color: '#111827',
          font_size: 16,
          font_weight: 500,
          text_align: 'left',
          z_index: 20,
          area: 9300,
        },
      ],
    };
  }

  static async isServiceAvailable() {
    try {
      const res = await fetch(`${PYTHON_SERVICE}/health`, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export default DetectionService;
