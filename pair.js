// pair.js
const express = require('express');
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
const { Pool } = require('pg');

const router = express.Router();

// ===============================
// 🔧 PostgreSQL Setup
// ===============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===============================
// 🔧 Helpers
// ===============================
function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Keep Render awake every 10 minutes
setInterval(() => {
  require('https').get('https://cypher-pairs-gzbm.onrender.com');
  console.log('🕒 Keeping Render awake...');
}, 600000);

// ===============================
// 🔌 WhatsApp Session Generator (Always On)
// ===============================
router.get('/', async (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  const id = makeid();

  async function createPairingCode() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: Browsers.macOS('Safari')
      });

      // Always listen for auth updates
      sock.ev.on('creds.update', saveCreds);

      // ==========================
      // 🟢 Connection Handling
      // ==========================
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        }

        if (connection === 'open') {
          console.log('✅ WhatsApp session is fully active for:', num);

          // Generate Cypher ID
          const cypherId = generateCypherId();

          // Save session to PostgreSQL
          await pool.query(
            `INSERT INTO sessions (cypher_id, number, creds_json, keys_json, timestamp)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (cypher_id) DO UPDATE SET
               creds_json = EXCLUDED.creds_json,
               keys_json = EXCLUDED.keys_json,
               timestamp = EXCLUDED.timestamp`,
            [cypherId, num, JSON.stringify(state.creds), JSON.stringify(state.keys), Date.now()]
          );

          // Build access link
          const baseUrl = `https://cypher-pairs-gzbm.onrender.com`;
          const sessionUrl = `${baseUrl}/get-session?cypherId=${cypherId}`;

          const message = `☠️ *Welcome to the Abyss* ☠️\n\n` +
            `Your WhatsApp is now connected with Cypher Session ID Generator.\n\n` +
            `🆔 *Cypher ID:* ${cypherId}\n` +
            `🌐 *Bot Link:*\n${sessionUrl}\n\n` +
            `Keep this safe. It controls your WhatsApp session.`;

          await delay(2000);
          await sock.sendMessage(num + '@s.whatsapp.net', { text: message });

          console.log(`📩 Cypher ID & link sent to ${num}`);

          // Keep alive heartbeat
          setInterval(async () => {
            try {
              await sock.sendPresenceUpdate('available');
              console.log('💓 Connection alive');
            } catch (err) {
              console.error('💀 Heartbeat failed, reconnecting...');
              await restartConnection();
            }
          }, 1000 * 60 * 2); // every 2 minutes
        }

        if (connection === 'close') {
          console.log('⚠️ WhatsApp disconnected. Reconnecting soon...');
          await restartConnection(lastDisconnect);
        }
      });

      async function restartConnection(disconnectInfo = null) {
        const shouldReconnect =
          !disconnectInfo ||
          (disconnectInfo?.error?.output?.statusCode !== 401);

        if (shouldReconnect) {
          console.log('♻️ Reconnecting...');
          await delay(5000);
          await createPairingCode();
        } else {
          console.log('🔒 Session ended by WhatsApp (needs new pairing).');
        }
      }

    } catch (err) {
      console.error('❌ Error in session flow:', err);
      if (!res.headersSent) res.send({ error: 'Service Unavailable' });
      await delay(5000);
      await createPairingCode();
    }
  }

  return await createPairingCode();
});

// ===============================
// 🔍 Fetch a Session (for Bots)
// ===============================
router.get('/get-session', async (req, res) => {
  const cypherId = req.query.cypherId;
  if (!cypherId) return res.send({ error: 'Missing Cypher ID' });

  try {
    const result = await pool.query('SELECT * FROM sessions WHERE cypher_id=$1', [cypherId]);
    if (result.rows.length === 0) return res.send({ error: 'Session not found' });

    const session = result.rows[0];
    res.send({
      cypherId: session.cypher_id,
      number: session.number,
      creds: JSON.parse(session.creds_json),
      keys: JSON.parse(session.keys_json)
    });
  } catch (err) {
    console.error('❌ Error fetching session:', err);
    res.send({ error: 'Database error' });
  }
});

// ===============================
// ⚙️ Keep process alive on errors
// ===============================
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Unhandled Rejection:', err);
});

module.exports = router;