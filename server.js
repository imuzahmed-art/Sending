const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable proxy trusting so Express detects Railway HTTPS headers
app.set('trust proxy', true);

// State tracking variables
let triggerBlankWipe = false;
let lastPingTimestamp = null;
let connectionStartedAt = null;

// Middleware for parsing raw JPEG payloads from ESP32
app.use(express.raw({ type: 'image/jpeg', limit: '10mb' }));
app.use(express.json());

// Serve static compiled .bin files from the /firmware directory
app.use('/firmware', express.static(path.join(__dirname, 'firmware')));

// --------------------------------------------------------------------------
// 1. BACKGROUND & BOOT-TIME PING LISTENER (Hits every 3s from ESP32)
// --------------------------------------------------------------------------
app.get('/api/firmware/check', (req, res) => {
  const now = Date.now();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Detect if this is the initial boot or a reconnect after being offline (>8 seconds)
  const isFreshConnection = !lastPingTimestamp || (now - lastPingTimestamp > 8000);

  if (isFreshConnection) {
    connectionStartedAt = new Date().toLocaleTimeString();
    console.log(`\n======================================================`);
    console.log(`🟢 [RAILWAY LIVE] ESP32 Connected to Railway Server!`);
    console.log(`⏰ Connected At: ${new Date().toLocaleString()}`);
    console.log(`🌐 Device IP:    ${clientIp}`);
    console.log(`======================================================\n`);
  }

  lastPingTimestamp = now;

  const baseUrl = `https://${req.get('host')}`;

  if (triggerBlankWipe) {
    console.log("[OTA] Serving blank.bin URL:", `${baseUrl}/firmware/blank.bin`);
    triggerBlankWipe = false;
    return res.json({ url: `${baseUrl}/firmware/blank.bin` });
  }

  // No pending updates
  res.json({ url: "" });
});

// --------------------------------------------------------------------------
// 2. LIVE STATUS POLLING ENDPOINT (For the Dashboard)
// --------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
  const now = Date.now();
  // ESP32 pings every 3000ms. If seen in the last 8s, it is live.
  const isOnline = lastPingTimestamp && (now - lastPingTimestamp < 8000);

  res.json({
    online: !!isOnline,
    connectedSince: connectionStartedAt || null,
    lastSeen: lastPingTimestamp ? new Date(lastPingTimestamp).toLocaleTimeString() : null,
    armed: triggerBlankWipe
  });
});

// --------------------------------------------------------------------------
// 3. SCAN RECEIVER ENDPOINT
// --------------------------------------------------------------------------
app.post('/api/scans', (req, res) => {
  const scanId = req.query.scan_id || 'unknown';
  const baseUrl = `https://${req.get('host')}`;
  lastPingTimestamp = Date.now();

  console.log(`[Scan] Received image for scan_id: ${scanId} (${req.body.length || 0} bytes)`);

  let responseData = {
    result: "FRESH",
    confidence: "98.2",
    foodType: "Tomato",
    calories: "22 kcal"
  };

  if (triggerBlankWipe) {
    console.log("[OTA] Trigger active! Sending blank.bin URL to device.");
    responseData.ota_url = `${baseUrl}/firmware/blank.bin`;
    triggerBlankWipe = false;
  }

  res.json(responseData);
});

// --------------------------------------------------------------------------
// 4. ADMIN TRIGGER ENDPOINTS
// --------------------------------------------------------------------------
app.post('/api/admin/arm-wipe', (req, res) => {
  triggerBlankWipe = true;
  console.log("[Admin] WIPE TRIGGER ARMED.");
  res.redirect('/');
});

app.post('/api/admin/disarm-wipe', (req, res) => {
  triggerBlankWipe = false;
  console.log("[Admin] Wipe disarmed.");
  res.redirect('/');
});

// --------------------------------------------------------------------------
// 5. LIVE CONTROL DASHBOARD
// --------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ESP32 Fleet & OTA Manager</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
          background: #0f172a; 
          color: #f8fafc; 
          display: flex; 
          justify-content: center; 
          align-items: center; 
          min-height: 100vh; 
          margin: 0; 
        }
        .card { 
          background: #1e293b; 
          padding: 2.2rem; 
          border-radius: 14px; 
          box-shadow: 0 12px 30px rgba(0,0,0,0.6); 
          width: 100%; 
          max-width: 440px; 
          text-align: center; 
          border: 1px solid rgba(255,255,255,0.08);
        }
        h1 { font-size: 1.45rem; margin-bottom: 0.4rem; }
        p { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1.4rem; }
        
        /* Connection Status Card */
        .conn-card {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 10px;
          padding: 1rem;
          margin-bottom: 1.4rem;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .conn-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-weight: 700;
          font-size: 0.95rem;
        }
        .conn-sub {
          font-size: 0.8rem;
          color: #94a3b8;
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          display: inline-block;
        }
        .dot.online {
          background: #22c55e;
          box-shadow: 0 0 12px #22c55e;
          animation: pulse 1.8s infinite;
        }
        .dot.offline {
          background: #64748b;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); opacity: 0.8; }
          50% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.95); opacity: 0.8; }
        }

        .status { 
          padding: 0.6rem; 
          border-radius: 6px; 
          font-weight: bold; 
          margin-bottom: 1.4rem; 
          font-size: 0.88rem;
        }
        .status.armed { background: #7f1d1d; color: #fca5a5; }
        .status.idle { background: #064e3b; color: #6ee7b7; }

        button { 
          width: 100%; 
          padding: 0.75rem; 
          border: none; 
          border-radius: 7px; 
          font-size: 0.95rem; 
          font-weight: 600; 
          cursor: pointer; 
          transition: 0.2s; 
          margin-bottom: 0.75rem; 
        }
        .btn-danger { background: #ef4444; color: white; }
        .btn-danger:hover { background: #dc2626; }
        .btn-secondary { background: #334155; color: white; }
        .btn-secondary:hover { background: #475569; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Device Control Panel</h1>
        <p>Real-time ESP32 connection & OTA management.</p>
        
        <!-- Live Connection Box -->
        <div class="conn-card">
          <div class="conn-header">
            <span id="conn-dot" class="dot offline"></span>
            <span id="conn-title" style="color: #94a3b8;">Waiting for ESP32...</span>
          </div>
          <div id="conn-details" class="conn-sub">Power on your ESP32 to connect</div>
        </div>

        <div id="wipe-status-box" class="status ${triggerBlankWipe ? 'armed' : 'idle'}">
          Status: ${triggerBlankWipe ? "ARMED TO WIPE (Pending Download)" : "IDLE (Normal Scans)"}
        </div>

        <form method="POST" action="/api/admin/arm-wipe">
          <button type="submit" class="btn-danger">Arm Blank Screen Update</button>
        </form>
        <form method="POST" action="/api/admin/disarm-wipe">
          <button type="submit" class="btn-secondary">Cancel / Disarm</button>
        </form>
      </div>

      <script>
        async function refreshStatus() {
          try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            const dot = document.getElementById('conn-dot');
            const title = document.getElementById('conn-title');
            const details = document.getElementById('conn-details');

            if (data.online) {
              dot.className = "dot online";
              title.style.color = "#22c55e";
              title.innerText = "CONNECTED TO RAILWAY";
              details.innerHTML = "Connected At: <strong>" + data.connectedSince + "</strong> | Heartbeat: " + data.lastSeen;
            } else {
              dot.className = "dot offline";
              title.style.color = "#94a3b8";
              title.innerText = "ESP32 DISCONNECTED";
              details.innerText = data.lastSeen ? "Last seen at: " + data.lastSeen : "Power on your ESP32 to connect";
            }
          } catch (e) {
            console.error("Status error:", e);
          }
        }

        // Poll every 1.5 seconds for instant live feedback
        refreshStatus();
        setInterval(refreshStatus, 1500);
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});