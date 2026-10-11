const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Spawn persistent Python bridge process
let pyProcess = null;
let requestQueue = [];

function startPythonBridge() {
  pyProcess = spawn('python', ['-u', path.join(__dirname, 'evaluate.py')]);

  pyProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const callback = requestQueue.shift();
      if (callback) {
        try { callback(JSON.parse(line)); }
        catch (e) { callback({ trigger_handover: false, error: 'JSON parse failure' }); }
      }
    }
  });

  pyProcess.stderr.on('data', (err) => {
    console.error('[Python Error]:', err.toString());
  });

  pyProcess.on('exit', () => {
    console.log('[Python Bridge] Restarting engine...');
    setTimeout(startPythonBridge, 1000);
  });
}

startPythonBridge();

// Web calls this endpoint to have Python evaluate the metrics
app.post('/api/evaluate', (req, res) => {
  if (!pyProcess || pyProcess.killed) {
    return res.json({ trigger_handover: false, details: 'Python offline' });
  }
  requestQueue.push((result) => res.json(result));
  pyProcess.stdin.write(JSON.stringify(req.body) + '\n');
});

// File download endpoints
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