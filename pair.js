// src/pairing.js
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const router = express.Router();

// Helper: remove temp folder if needed
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Helper: create a Cypher ID (branded session ID)
function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Heartbeat function: keeps session alive by sending presence every 30s
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

router.get('/', async (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  // Create temp folder
  if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

  // Create a unique folder for this session
  const sessionFolder = './temp/' + Date.now();

  async function createSession() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
      });

      // send pairing code if needed
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

          // start heartbeat
          startHeartbeat(sock);

          // send welcome message
          const welcomeMessage = '☠️ Welcome to the Abyss ☠️\nYour WhatsApp is now linked with Cypher Session ID Generator.';
          try {
            await sock.sendMessage(num + '@s.whatsapp.net', { text: welcomeMessage });
            await delay(500);
            console.log('📩 Welcome message sent');
          } catch (err) {
            console.error('⚠️ Could not send welcome message:', err);
          }

          // small delay before sending session ID
          await delay(1000);
          const cypherId = generateCypherId();
          const sessionMessage = `🆔 Your Cypher Session ID:\n*${cypherId}*\nKeep it safe.`;
          try {
            await sock.sendMessage(num + '@s.whatsapp.net', { text: sessionMessage });
            console.log(`📩 Cypher Session ID sent: ${cypherId}`);
          } catch (err) {
            console.error('⚠️ Could not send session ID message:', err);
          }

          console.log('💀 Session will now stay alive indefinitely until manually closed.');
        } else if (connection === 'close' && lastDisconnect) {
          console.log('⚠️ Connection closed. Reconnecting...');
          await delay(3000);
          createSession();
        }
      });
    } catch (err) {
      console.error('❌ Error creating WhatsApp session:', err);
      removeFile(sessionFolder);
      if (!res.headersSent) res.send({ error: 'Service Unavailable' });
    }
  }

  return await createSession();
});

module.exports = router;