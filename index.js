const express = require('express');
const app = express();
const bodyParser = require("body-parser");
const axios = require("axios"); // Added for self-ping
const PORT = process.env.PORT || 8000;

const server = require('./qr');
const code = require('./pair');
const path = process.cwd();

require('events').EventEmitter.defaultMaxListeners = 500;

app.use('/qr', server);
app.use('/code', code);

app.use('/pair', async (req, res) => {
  res.sendFile(path + '/pair.html');
});

app.use('/', async (req, res) => {
  res.sendFile(path + '/main.html');
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Keep Render awake — heartbeat every 25s
const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  axios.get(url)
    .then(() => console.log('💓 Heartbeat ping sent to:', url))
    .catch(err => console.log('⚠️ Heartbeat failed:', err.message));
}, 25000);

app.listen(PORT, () => {
  console.log(`
✅ Cypher Pairs Server is running
🌐 ${url}
⚙️ Ready to connect sessions
  `);
});

module.exports = app;