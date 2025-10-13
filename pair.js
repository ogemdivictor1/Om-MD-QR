const express = require('express');
const crypto = require('crypto');
const pino = require('pino');
const { makeid } = require('./id');
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const { Pool } = require('pg');

const router = express.Router();

// ===============================
// 🔧 PostgreSQL Setup
// ===============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create sessions table if it doesn't exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        cypher_id VARCHAR(50) UNIQUE NOT NULL,
        number VARCHAR(20) NOT NULL,
        creds_json TEXT NOT NULL,
        keys_json TEXT NOT NULL,
        timestamp BIGINT NOT NULL
      );
    `);
    console.log('✅ Sessions table is ready');
  } catch (err) {
    console.error('❌ Error creating sessions table:', err);
  }
})();

// ===============================
// 🔧 Helpers
// ===============================
function generateCypherId() {
  return 'CYPHER' + crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Keep Render awake every 10 minutes (optional)
setInterval(() => {
  require('https').get('https://cypher-pairs-gzbm.onrender.com');
  console.log('🕒 Keeping Render awake...');
}, 600000);

// ===============================
// 🔌 WhatsApp Session Generator
// ===============================
router.get('/', async (req, res) => {
  const num = (req.query.number || '').replace(/[^0-9]/g, '');
  if (!num) return res.send({ error: 'Number missing' });

  const id = makeid();

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

      // Request pairing code if not registered
      if (!sock.authState.creds.registered) {
        const code = await sock.requestPairingCode(num);
        if (!res.headersSent) res.send({ code });
      }

      // Save credentials whenever they update
      sock.ev.on('creds.update', async () => {
        await saveCreds();
      });

      // Connection handling
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'connecting') {
          console.log('🔄 Connecting to WhatsApp...');
        } else if (connection === 'open') {
          console.log('✅ WhatsApp session is fully active:', sock.user?.id || 'unknown');

          // Generate Cypher ID
          const cypherId = generateCypherId();

          // Save session in PostgreSQL
          await pool.query(
            `INSERT INTO sessions(cypher_id, number, creds_json, keys_json, timestamp)
             VALUES($1, $2, $3, $4, $5) ON CONFLICT (cypher_id) DO NOTHING`,
            [cypherId, num, JSON.stringify(state.creds), JSON.stringify(state.keys), Date.now()]
          );

          // Build link for external bot access
          const baseUrl = `https://cypher-pairs-gzbm.onrender.com`;
          const sessionUrl = `${baseUrl}/get-session?cypherId=${cypherId}`;

          // Send WhatsApp message with Cypher ID + link
          const fullMessage =
            `☠️ *Welcome to the Abyss* ☠️\nYour WhatsApp is now linked with Cypher Session ID Generator.\n\n` +
            `🆔 *Your Cypher ID:* ${cypherId}\n` +
            `🌐 *Bot Connection Link:*\n${sessionUrl}\n\n` +
            `Keep it safe! Only you can unlink it from WhatsApp.`;

          await delay(3000);
          await sock.sendMessage(num + '@s.whatsapp.net', { text: fullMessage });
          console.log(`📩 Cypher ID + Link sent to ${num}`);

          // Keep session alive until user disconnects
          const heartbeat = setInterval(async () => {
            try {
              await sock.sendPresenceUpdate('available');
              console.log('💓 Socket alive check passed');
            } catch (e) {
              console.error('💀 Socket died, reconnecting...', e);
              clearInterval(heartbeat);
              createPairingCode();
            }
          }, 120000); // every 2 mins
        } else if (connection === 'close') {
          console.log('⚠️ Disconnected. User may have closed session.');
        }
      });
    } catch (err) {
      console.error('❌ Error in pairing flow:', err);
      if (!res.headersSent) res.send({ code: 'Service Unavailable' });
    }
  }

  return await createPairingCode();
});

// ===============================
// 🔌 Endpoint to fetch session for other bots
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

module.exports = router;