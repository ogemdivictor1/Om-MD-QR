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

function removeFile(FilePath) {
  if (!fs.existsSync(FilePath)) return false;
  fs.rmSync(FilePath, { recursive: true, force: true });
}

// helper: create a Cypher ID: CYPHERXXXXXXXX (no spaces/dashes)
function generateCypherId() {
  return crypto.randomBytes(6).toString('hex').toUpperCase(); // 12-character hex
}

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

      await delay(1000);

      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) {
          console.log('📱 Pair code generated:', code);
          res.send({ code });
        }
      }

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

          // Generate fully-random Cypher Session ID
          const cypherId = generateCypherId();

          // Messages: first welcome, then session ID
          const welcomeMessage = `☠️ *Welcome to the Abyss* ☠️\n\nYour Cypher session is now active...`;
          const sessionMessage = `🆔 *Your Cypher Session ID:* ${cypherId}\nKeep this key safe.`;

          try {
            await sock.sendMessage(num + '@s.whatsapp.net', { text: welcomeMessage });
            await delay(500);
            await sock.sendMessage(num + '@s.whatsapp.net', { text: sessionMessage });
            console.log(`📩 Cypher ID ${cypherId} sent to ${num}`);
          } catch (err) {
            console.error('⚠️ Could not send messages:', err);
          }

          // HEARTBEAT: send every 30s indefinitely
          const heartbeat = setInterval(async () => {
            try {
              await sock.sendPresenceUpdate('available');
              console.log('💓 Heartbeat sent to keep session alive');
            } catch (err) {
              console.error('⚠️ Heartbeat failed:', err);
            }
          }, 30000);

          // DO NOT close the socket or remove temp folder automatically
          console.log('💀 Session will now stay alive indefinitely until manually closed.');
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