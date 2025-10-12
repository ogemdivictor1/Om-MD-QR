const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const https = require('https');
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

// ===============================
// 🔧 Helpers
// ===============================
function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) fs.rmSync(FilePath, { recursive: true, force: true });
}

function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

function ensureFolder(folder) {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
}

// Keep Render awake every 10 minutes
setInterval(() => {
  https.get('https://cypher-pairs-gzbm.onrender.com');
  console.log('🕒 Keeping Render awake...');
}, 600000); // 10 min

// ===============================
// 🔌 WhatsApp Session Generator
// ===============================
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

      // Request pairing code
      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) res.send({ code });
      }

      sock.ev.on('creds.update', saveCreds);

      // =====================================
      // 🧠 Connection handling
      // =====================================
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          // Generate Cypher ID + folder
          const cypherId = generateCypherId();
          const sessionFolder = `./sessions/${cypherId}`;
          ensureFolder(sessionFolder);

          // Build link
          const baseUrl = `https://cypher-pairs-gzbm.onrender.com`;
          const sessionUrl = `${baseUrl}/get-session?cypherId=${cypherId}`;

          // Send WhatsApp message
          const fullMessage =
            `☠️ *Welcome to the Abyss* ☠️\nYour WhatsApp is now linked with Cypher Session ID Generator.\n\n` +
            `🆔 *Your Cypher ID:* ${cypherId}\n` +
            `🌐 *Bot Connection Link:*\n${sessionUrl}\n\n` +
            `Keep it safe! Only you can unlink it from WhatsApp.`;

          await delay(3000);
          await sock.sendMessage(num + '@s.whatsapp.net', { text: fullMessage });
          console.log(`📩 Cypher ID + Link sent to ${num}`);

          // Save session permanently
          saveSession(cypherId, {
            number: num,
            path: sessionFolder,
            timestamp: Date.now()
          });

          // Keep it alive
          setInterval(async () => {
            try {
              await sock.sendPresenceUpdate('available');
              console.log('💓 Alive check passed');
            } catch (e) {
              console.error('💀 Socket died, restarting...');
              createPairingCode();
            }
          }, 120000); // every 2 mins

        } else if (connection === 'close') {
          console.log('⚠️ Disconnected. Trying to reconnect...');
          const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
          if (shouldReconnect) {
            await delay(5000);
            createPairingCode();
          } else {
            console.log('🔒 Session ended by user.');
          }
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