const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// State variable: true if you want the next scan/boot to wipe the ESP
let triggerBlankWipe = false;

// Middleware for parsing raw JPEG payloads from ESP32
app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
app.use(express.json());

// Serve static compiled .bin files from the /firmware directory
app.use('/firmware', express.static(path.join(__dirname, 'firmware')));

// --------------------------------------------------------------------------
// 1. SCAN RECEIVER ENDPOINT
// --------------------------------------------------------------------------
app.post('/api/scans', (req, res) => {
  const scanId = req.query.scan_id || 'unknown';
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  console.log(`[Scan] Received image for scan_id: ${scanId} (${req.body.length || 0} bytes)`);

  // Default response object
  let responseData = {
    result: "FRESH",
    confidence: "98.2",
    foodType: "Tomato",
    calories: "22 kcal"
  };

  // If the wipe command is armed, attach the OTA URL to the response
  if (triggerBlankWipe) {
    console.log("[OTA] Trigger active! Sending blank.bin URL to device.");
    responseData.ota_url = `${baseUrl}/firmware/blank.bin`;
    triggerBlankWipe = false; // Reset trigger after dispatch
  }

  res.json(responseData);
});

// --------------------------------------------------------------------------
// 2. BOOT-TIME OTA CHECK ENDPOINT
// --------------------------------------------------------------------------
app.get('/api/firmware/check', (req, res) => {
  const currentVersion = req.query.version;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  console.log(`[OTA Check] ESP booted with version: ${currentVersion}`);

  if (triggerBlankWipe) {
    console.log("[OTA] Serving blank.bin on boot check.");
    triggerBlankWipe = false;
    return res.json({ url: `${baseUrl}/firmware/blank.bin` });
  }

  // No pending updates
  res.json({ url: "" });
});

// --------------------------------------------------------------------------
// 3. ADMIN TRIGGER ENDPOINTS & WEB DASHBOARD
// --------------------------------------------------------------------------
app.post('/api/admin/arm-wipe', (req, res) => {
  triggerBlankWipe = true;
  console.log("[Admin] WIPE TRIGGER ARMED. Next scan or boot will flash blank.bin");
  res.json({ status: "ARMED", message: "Next request from ESP will trigger blank screen OTA." });
});

app.post('/api/admin/disarm-wipe', (req, res) => {
  triggerBlankWipe = false;
  console.log("[Admin] Wipe disarmed.");
  res.json({ status: "DISARMED" });
});

// Control dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ESP32 Fleet & OTA Manager</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); width: 100%; max-width: 420px; text-align: center; }
        h1 { font-size: 1.4rem; margin-bottom: 0.5rem; }
        p { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.5rem; }
        .status { padding: 0.5rem; border-radius: 6px; font-weight: bold; margin-bottom: 1.5rem; background: ${triggerBlankWipe ? '#7f1d1d' : '#064e3b'}; color: ${triggerBlankWipe ? '#fca5a5' : '#6ee7b7'}; }
        button { width: 100%; padding: 0.75rem; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: 0.2s; margin-bottom: 0.75rem; }
        .btn-danger { background: #ef4444; color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-secondary { background: #334155; color: white; }
        .btn-secondary:hover { background: #475569; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Device Control Panel</h1>
        <p>Manage ESP32 scans and wireless firmware updates.</p>
        <div class="status">
          Status: ${triggerBlankWipe ? "ARMED TO WIPE (Pending Download)" : "IDLE (Normal Scans)"}
        </div>
        <form method="POST" action="/api/admin/arm-wipe">
          <button type="submit" class="btn-danger">Arm Blank Screen Update</button>
        </form>
        <form method="POST" action="/api/admin/disarm-wipe">
          <button type="submit" class="btn-secondary">Cancel / Disarm</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});