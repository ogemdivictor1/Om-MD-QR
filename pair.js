const express = require('express');
const fs = require('fs');
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

      // 👇 Added: clear connection updates for better tracking
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ Connected to WhatsApp:', sock.user.id);

          // 💾 Save the session only after success
          await fs.promises.writeFile(
            `./sessions/${sock.user.id}.json`,
            JSON.stringify(state.creds, null, 2)
          );
          console.log('🧠 Session saved successfully!');

          await delay(3000);
          await sock.ws.close();
          removeFile('./temp/' + id);
        } else if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error?.output?.statusCode !== 401
        ) {
          console.log('⚠️ Connection lost. Reconnecting...');
          await delay(3000);
          createPairingCode();
        }
      });
    } catch (err) {
      console.error('❌ Error connecting:', err);
      removeFile('./temp/' + id);
      if (!res.headersSent) res.send({ code: 'Service Unavailable' });
    }
  }

  return await createPairingCode();
});

module.exports = router;