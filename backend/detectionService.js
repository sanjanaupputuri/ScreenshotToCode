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
        throw new Error(
          `Detection failed for ${absPath}. Service error: ${error.message}. CLI error: ${cliError.message}`
        );
      }
    }
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
