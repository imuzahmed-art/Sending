const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Detect correct executable: 'python' on Windows, 'python3' on Linux/Cloud
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

let pyProcess = null;
let requestQueue = [];
let pythonAvailable = false;

function startPythonBridge() {
  try {
    pyProcess = spawn(PYTHON_CMD, ['-u', path.join(__dirname, 'evaluate.py')]);

    // PREVENT CRASH: Handle spawn error when Python binary is missing
    pyProcess.on('error', (err) => {
      console.error(`[Python Bridge] Warning: Could not spawn '${PYTHON_CMD}' (${err.message}).`);
      pythonAvailable = false;
      // Clear pending queue with fallback responses
      while (requestQueue.length > 0) {
        const cb = requestQueue.shift();
        cb(runFallbackEvaluation({}));
      }
    });

    pyProcess.stdout.on('data', (data) => {
      pythonAvailable = true;
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const callback = requestQueue.shift();
        if (callback) {
          try {
            callback(JSON.parse(line));
          } catch (e) {
            callback(runFallbackEvaluation({}));
          }
        }
      }
    });

    pyProcess.stderr.on('data', (err) => {
      console.error('[Python Stderr]:', err.toString());
    });

    pyProcess.on('exit', (code) => {
      console.log(`[Python Bridge] Process exited (code ${code}).`);
      pythonAvailable = false;
    });
  } catch (err) {
    console.error('[Python Bridge] Spawn attempt failed:', err.message);
    pythonAvailable = false;
  }
}

// Fallback evaluator if Python runtime is unavailable in cloud container
function runFallbackEvaluation(req) {
  const signal = parseFloat(req.signal || 92.0);
  const history = req.history || [];
  const iface = req.interface || 'WIFI';

  let slope = 0.0;
  if (history.length >= 2) {
    slope = (history[history.length - 1] - history[0]) / history.length;
  }

  const trigger = iface === 'CELLULAR' ? signal <= 30.0 : (signal < 60.0 && slope < 0.0);

  return {
    trigger_handover: trigger,
    selected_target: 'Field_Station_5G',
    slope: parseFloat(slope.toFixed(2)),
    filtered_signal: parseFloat(signal.toFixed(1)),
    state: trigger ? 'PROACTIVE CUTOVER (< 60%)' : 'PRIMARY LINK HEALTHY',
    details: trigger
      ? `Proactive threshold met (Signal: ${signal.toFixed(1)}%) -> Handover executed!`
      : `Operating under nominal primary link`,
    engine: 'evaluation_engine'
  };
}

startPythonBridge();

// Web evaluation endpoint
app.post('/api/evaluate', (req, res) => {
  if (!pyProcess || !pythonAvailable) {
    // Return graceful evaluation rather than dropping the HTTP request
    return res.json(runFallbackEvaluation(req.body));
  }
  requestQueue.push((result) => res.json(result));
  try {
    pyProcess.stdin.write(JSON.stringify(req.body) + '\n');
  } catch (err) {
    res.json(runFallbackEvaluation(req.body));
  }
});

// Download endpoints
app.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  let targetPath = path.join(__dirname, 'device_solution', filename);
  if (!fs.existsSync(targetPath)) targetPath = path.join(__dirname, 'public', filename);
  if (fs.existsSync(targetPath)) return res.download(targetPath, filename);
  res.status(404).send(`File ${filename} not found.`);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Handover Sentinel] Running at http://localhost:${PORT}`);
});