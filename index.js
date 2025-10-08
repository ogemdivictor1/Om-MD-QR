const express = require('express');
const bodyParser = require("body-parser");
const fs = require('fs');
const path = require('path');
const open = require('open'); // optional
require('events').EventEmitter.defaultMaxListeners = 500;

const app = express();
const __path = process.cwd();
const PORT = process.env.PORT || 8000;

// Ensure session folders exist
if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');
if (!fs.existsSync('./sessions')) fs.mkdirSync('./sessions');

// Middlewares first
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Route imports
const qr = require('./qr');
const pair = require('./pair');
const code = require('./code'); // optional if you separate logic

// Routes
app.use('/qr', qr);
app.use('/code', code);
app.use('/pair', async (req, res) => {
  res.sendFile(path.join(__path, '/pair.html'));
});
app.use('/', async (req, res) => {
  res.sendFile(path.join(__path, '/main.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`
🔥 CYPHER SESSION ID CONNECTOR 🔥
--------------------------------
Server running on: http://localhost:${PORT}
Press Ctrl + C to stop
`);

  // Optional auto open browser
  // await open(`http://localhost:${PORT}`);
});

module.exports = app;