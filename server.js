const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve frontend assets from /public
app.use(express.static(path.join(__dirname, 'public')));

// Download endpoint routing to the /device_solution directory
app.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  let targetPath = path.join(__dirname, 'device_solution', filename);

  // Fallback check if file was placed in public
  if (!fs.existsSync(targetPath)) {
    targetPath = path.join(__dirname, 'public', filename);
  }

  if (fs.existsSync(targetPath)) {
    return res.download(targetPath, filename);
  }

  res.status(404).send(`File ${filename} not found on server.`);
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Handover Sentinel Server] Running on http://localhost:${PORT}`);
});