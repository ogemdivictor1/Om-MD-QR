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

// Remove folder helper
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Generate unique Cypher ID
function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Keep WhatsApp presence alive
async function startHeartbeat(sock) {
  setInterval(async () => {
    try {
      await sock.sendPresenceUpdate('available');
      console.log('💓 Heartbeat sent');
    } catch (e) {
      console.error('⚠️ Heartbeat failed:', e);
    }
  }, 30000);
}

// Keep WebSocket alive
async function startPing(sock) {
  setInterval(async () => {
    try {
      await sock.ws.ping();
      console.log('🏓 Ping sent to WhatsApp server');
    } catch (e) {
      console.error('⚠️ Ping failed:', e);
    }
  }, 60000);
}

// Ensure folder exists
function ensureFolder(folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

router.get('/', async (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  const id = makeid();
  ensureFolder('./temp');

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

      // Send pairing code if needed
      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          startHeartbeat(sock);
          startPing(sock);

          await delay(2000); // wait 2 sec for session ready

          const cypherId = generateCypherId();
          const sessionFolder = `./sessions/${cypherId}`;
          ensureFolder(sessionFolder);

          // Save session permanently
          saveSession(cypherId, {
            number: num,
            path: sessionFolder,
            timestamp: Date.now()
          });

          // Build full message
          const sessionUrl = `https://your-generator.com/get-session?cypherId=${cypherId}`;
          const fullMessage =
            `☠️ Welcome to the Abyss ☠️\nYour WhatsApp is now linked with Cypher Session ID Generator.\n\n` +
            `🆔 Your Cypher ID: *${cypherId}*\n🌐 Connect your bot using:\n${sessionUrl}\n\n` +
            `Keep it safe! Only you can disconnect this session from WhatsApp.`;

          // Send message to **the account itself**
          try {
            await sock.sendMessage(sock.user.id, { text: fullMessage });
            console.log('📩 Welcome + Cypher ID message sent');
          } catch (e) {
            console.error('❌ Failed to send message:', e);
          }

          // Respond to API if not sent yet
          if (!res.headersSent) res.send({ cypherId, sessionUrl, status: 'paired' });

        } else if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error?.output?.statusCode !== 401
        ) {
          console.log('⚠️ Connection closed unexpectedly. Reconnecting...');
          await delay(3000);
          createPairingCode();
        }
      });
    } catch (err) {
      console.error('❌ Error in pairing flow:', err);
      removeFile('./temp/' + id);
      if (!res.headersSent) res.send({ code: 'Service Unavailable' });
    }
  }

  return await createPairingCode();
});

module.exports = router;