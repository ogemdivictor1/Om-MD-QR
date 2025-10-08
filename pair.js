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

const router = express.Router();

// helper to remove temp folder
function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// Generate Cypher ID: CYPHER-XXXX-XXXX
function generateCypherId() {
  const a = crypto.randomBytes(2).toString('hex').toUpperCase();
  const b = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `CYPHER-${a}-${b}`;
}

// Store active sockets to keep them alive
const activeSockets = {};

router.get('/', async (req, res) => {
  const id = makeid();
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

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

      // Small delay to initialize
      await delay(1000);

      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          console.log('📱 Pair code generated:', code);
          res.send({ code });
        }
      }

      // Save auth updates
      sock.ev.on('creds.update', saveCreds);

      // Watch connection
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          // Generate Cypher ID
          const cypherId = generateCypherId();
          const message = `☠️ *Welcome to the Abyss* ☠️\n\nYour Cypher Session ID has been forged:\n\n*${cypherId}*\n\nBound to the shadows... keep the key safe.`;

          try {
            await sock.sendMessage(num + '@s.whatsapp.net', { text: message });
            console.log(`📩 Cypher ID ${cypherId} sent to ${num}`);
          } catch (err) {
            console.error('⚠️ Could not send Cypher ID message:', err);
          }

          // Keep the socket alive by storing it
          activeSockets[sock.user.id] = sock;
          console.log(`🧠 Session for ${sock.user.id} is now active.`);
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