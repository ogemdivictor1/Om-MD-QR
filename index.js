const express = require('express');
const app = express();
const bodyParser = require("body-parser");
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

app.listen(PORT, () => {
  console.log(`
✅ Cypher Pairs Server is running
🌐 http://localhost:${PORT}
⚙️ Ready to connect sessions
  `);
});

module.exports = app;