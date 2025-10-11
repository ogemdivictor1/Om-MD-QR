const express = require('express');
const fs = require('fs');
const https = require('https');
const pino = require('pino');
const { makeid } = require('./id');
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Heartbeat: Ping self every 10 minutes ---
setInterval(() => {
  https.get(`https://localhost:${PORT}`, (res) => {
    console.log('💓 Heartbeat ping sent');
  }).on('error', (err) => {
    // Ignore connection errors silently
  });
}, 10 * 60 * 1000);

// --- Safe folder remover ---
function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) fs.rmSync(FilePath, { recursive: true, force: true });
}

// --- Main route ---
app.get('/', async (req, res) => {
  const id = makeid();
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

  const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

  try {
    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.macOS('Safari')
    });

    await delay(1000);

    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(num);
      if (!res.headersSent) return res.send({ code });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'open') {
        console.log('✅ Connected to WhatsApp:', sock.user.id);

        // Send welcome message
        await sock.sendMessage(num + '@s.whatsapp.net', {
          text: 'Welcome to Cypher Session ID Generator 🔥'
        });

        await delay(2000);

        // Send session ID (text only)
        const sessionData = fs.readFileSync(`./temp/${id}/creds.json`, 'utf8');
        await sock.sendMessage(num + '@s.whatsapp.net', {
          text: sessionData
        });

        console.log('📤 Session ID sent successfully');
      } else if (
        connection === 'close' &&
        lastDisconnect &&
        lastDisconnect.error?.output?.statusCode !== 401
      ) {
        console.log('Reconnecting...');
        await delay(5000);
        app.get('/', async (req, res) => createPairingCode());
      }
    });
  } catch (err) {
    console.error('❌ Error connecting:', err);
    removeFile('./temp/' + id);
    if (!res.headersSent) res.send({ code: 'Service Unavailable' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Cypher Pair Server running on port ${PORT}`);
});