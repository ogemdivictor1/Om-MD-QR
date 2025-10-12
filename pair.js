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
const { saveSession } = require('./session'); // handles permanent storage

const router = express.Router();

// Remove folder helper (for errors)
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Generate Cypher ID: CYPHERXXXXXXXX
function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Heartbeat to keep WhatsApp connection alive
async function startHeartbeat(sock) {
  setInterval(async () => {
    try {
      await sock.sendPresenceUpdate('available');
      console.log('💓 Heartbeat sent to WhatsApp');
    } catch (e) {
      console.error('⚠️ Heartbeat failed:', e);
    }
  }, 30000);
}

// Ensure folder exists
function ensureFolder(folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
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

      // Send pairing code if not registered
      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          // Start heartbeat
          startHeartbeat(sock);

          await delay(4000);
          await sock.sendPresenceUpdate('available');

          // Send welcome message
          const welcomeMessage =
            '☠️ Welcome to the Abyss ☠️\nYour WhatsApp is now linked with Cypher Session ID Generator.';
          await sock.sendMessage(num + '@s.whatsapp.net', { text: welcomeMessage });
          console.log('📩 Welcome message sent');

          // Small delay before generating Cypher ID
          await delay(1000);
          const cypherId = generateCypherId();
          const sessionFolder = `./sessions/${cypherId}`;
          ensureFolder(sessionFolder);

          const sessionMessage = `🆔 Your Cypher Session ID:\n*${cypherId}*\nKeep it safe.`;
          await sock.sendMessage(num + '@s.whatsapp.net', { text: sessionMessage });
          console.log(`📩 Cypher Session ID sent: ${cypherId}`);

          // Save the session permanently
          saveSession(cypherId, {
            number: num,
            path: sessionFolder,
            timestamp: Date.now()
          });

          // Respond to API if not already sent
          if (!res.headersSent) res.send({ cypherId, status: 'paired' });
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