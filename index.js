// ===============================
// ⚙️ Basic Setup
// ===============================
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const axios = require('axios');
const path = require('path');
const PORT = process.env.PORT || 8000;

// ===============================
// 🔧 Modules Import
// ===============================
const qrRouter = require('./qr');   // exports router
const pairRouter = require('./pair'); // exports router
const { restoreAllSessions } = require('./session'); // restore sessions

// Prevent memory leaks from too many listeners
require('events').EventEmitter.defaultMaxListeners = 500;

// ===============================
// 📦 Middlewares
// ===============================
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files (CSS, JS, images, HTML)
app.use(express.static(path.join(__dirname, 'public'))); // put pair.html in /public

// Use Routers
app.use('/qr', qrRouter);
app.use('/api/pair', pairRouter); // all pair.js API routes prefixed with /api/pair

// ===============================
// 🚪 Routes for HTML pages
// ===============================
app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

// ===============================
// ♻️ Restore All Sessions
// ===============================
restoreAllSessions()
  .then(() => console.log('♻️ All saved sessions restored successfully!'))
  .catch(err => console.error('❌ Failed to restore sessions:', err));

// ===============================
// 🩺 Keep Render Alive (Every 25s)
const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  axios
    .get(url)
    .then(() => console.log('💓 Heartbeat ping sent to:', url))
    .catch(err => console.log('⚠️ Heartbeat failed:', err.message));
}, 25000);

// ===============================
// 🚀 Start Server
// ===============================
app.listen(PORT, () => {
  console.log(`
✅ Cypher Pairs Server is running
🌐 ${url}
⚙️ Ready to connect sessions
  `);
});

module.exports = app;