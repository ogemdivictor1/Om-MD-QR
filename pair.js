const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const pino = require('pino');
const { makeid } = require('./id'); // optional; used for temp folder naming
const {
  makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const router = express.Router();

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// helper: create a Cypher ID: CYPHER-XXXX-XXXX (uppercase hex)
function generateCypherId() {
  const a = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars
  const b = crypto.randomBytes(2).toString('hex').toUpperCase(); // 4 chars
  return `CYPHER-${a}-${b}`;
}

router.get('/', async (req, res) => {
  const id = makeid();
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  // ensure temp folder exists
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

      // small delay to let Baileys init
      await delay(1000);

      // If not already registered, request pairing code and return it to the web client
      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          console.log('📱 Pair code generated:', code);
          res.send({ code });
        }
      }

      // keep auth updates if any (still temporary)
      sock.ev.on('creds.update', saveCreds);

      // watch connection updates
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          // Generate a fully-random Cypher Session ID
          const cypherId = generateCypherId();

          // Build dark & scary message
          const message = `☠️ *Welcome to the Abyss* ☠️\n\nYour Cypher Session ID has been forged:\n\n*${cypherId}*\n\nBound to the shadows... keep the key safe.`;

          try {
            // Send the custom Cypher ID to the very number that paired
            await sock.sendMessage(num + '@s.whatsapp.net', { text: message });
            console.log(`📩 Cypher ID ${cypherId} sent to ${num}`);
          } catch (err) {
            console.error('⚠️ Could not send Cypher ID message:', err);
          }

          // Clean up: close socket and remove temp auth folder
          await delay(2000);
          try { await sock.ws.close(); } catch (e) { /* ignore */ }
          removeFile('./temp/' + id);

          // NOTE: we intentionally do NOT persist session files here
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