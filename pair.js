const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const { makeid } = require('./id');
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');
const { saveSession } = require('./session');

const router = express.Router();

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

async function startHeartbeat(sock) {
  setInterval(async () => {
    try {
      await sock.sendPresenceUpdate('available');
    } catch (e) {
      console.error('Heartbeat failed:', e);
    }
  }, 30000);
}

function ensureFolder(folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

async function startPing(sock) {
  setInterval(async () => {
    try {
      await sock.ws.ping();
    } catch (e) {
      console.error('Ping failed:', e);
    }
  }, 60000);
}

router.get('/', async (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  const id = makeid();
  if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

  async function createPairingCode() {
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
        if (!res.headersSent) res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'open') {
          console.log('Connected to WhatsApp:', sock.user?.id || 'unknown');

          startHeartbeat(sock);
          startPing(sock);

          await delay(2000);
          await sock.sendPresenceUpdate('available');

          // Generate Cypher ID
          const cypherId = generateCypherId();
          const sessionFolder = `./sessions/${cypherId}`;
          ensureFolder(sessionFolder);

          // Save session permanently
          saveSession(cypherId, {
            number: num,
            path: sessionFolder,
            timestamp: Date.now()
          });

          // Prepare URL for bot
          const sessionUrl = `https://your-generator.com/get-session?cypherId=${cypherId}`;

          // Send Cypher ID + URL to user
          const message = `🆔 Your Cypher Session ID: *${cypherId}*\n\n` +
                          `🌐 Bot connection URL:\n${sessionUrl}\n\n` +
                          `Keep it safe! Use this Cypher ID as environment when hosting your bot.`;

          await sock.sendMessage(num + '@s.whatsapp.net', { text: message });

          console.log(`Cypher ID and URL sent to ${num}`);
          if (!res.headersSent) res.send({ cypherId, sessionUrl, status: 'sent' });

        } else if (connection === 'close' &&
                   lastDisconnect &&
                   lastDisconnect.error?.output?.statusCode !== 401) {
          console.log('Connection closed unexpectedly. Reconnecting...');
          await delay(3000);
          createPairingCode();
        }
      });

    } catch (err) {
      console.error('Error in pairing flow:', err);
      removeFile('./temp/' + id);
      if (!res.headersSent) res.send({ code: 'Service Unavailable' });
    }
  }

  return await createPairingCode();
});

module.exports = router;