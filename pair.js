// CYPHER-MD Session Generator
const express = require('express');
const fs = require('fs');
const pino = require('pino');
const { makeid } = require('./id');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys');

const router = express.Router();

// Helper: Remove temporary session folder
function removeFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  fs.rmSync(filePath, { recursive: true, force: true });
}

// ========== MAIN ROUTE ==========
router.get('/', async (req, res) => {
  const id = makeid();
  let num = req.query.number;

  async function CYPHER_MD_PAIR_CODE() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(`./temp/${id}`);

      const Cypher_Socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
      });

      // If number not registered yet, request pair code
      if (!Cypher_Socket.authState.creds.registered) {
        await delay(1500);
        num = num.replace(/[^0-9]/g, '');
        const code = await Cypher_Socket.requestPairingCode(num);

        if (!res.headersSent) {
          await res.send({ code });
        }
      }

      Cypher_Socket.ev.on('creds.update', saveCreds);

      Cypher_Socket.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === 'open') {
          console.log('✅ Connected to WhatsApp');

          // Wait for WhatsApp to sync
          await delay(4000);

          // Read creds.json and convert to base64
          const data = fs.readFileSync(`${__dirname}/temp/${id}/creds.json`);
          const b64data = Buffer.from(data).toString('base64');

          // Send session to user
          await Cypher_Socket.sendMessage(Cypher_Socket.user.id, {
            text: 'CYPHER-MD;;;' + b64data
          });

          // Send success message
          const CYPHER_TEXT = `
╔══◇
║ *『 Welcome to CYPHER-MD 』*
║ You have completed the first step to making your bot.
╚════════════════════════╝
╔═══◇
║  『••• 𝗡𝗼𝘁𝗲 •••』
║ Do not share your *SESSION_ID* with anyone.
║ Anyone who gets it can control your bot!
╚════════════════════════╝
          `;

          await Cypher_Socket.sendMessage(Cypher_Socket.user.id, {
            text: CYPHER_TEXT
          });

          // Close and remove temp data
          await delay(100);
          await Cypher_Socket.ws.close();
          return await removeFile(`./temp/${id}`);
        } else if (
          connection === 'close' &&
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output?.statusCode !== 401
        ) {
          console.log('⚠️ Connection closed. Retrying...');
          await delay(10000);
          CYPHER_MD_PAIR_CODE();
        }
      });
    } catch (err) {
      console.log('❌ Service restarted due to error:', err);
      await removeFile(`./temp/${id}`);
      if (!res.headersSent) {
        await res.send({ code: 'Service Unavailable' });
      }
    }
  }

  return await CYPHER_MD_PAIR_CODE();
});

module.exports = router;