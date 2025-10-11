// src/pairing.js
const express = require('express');
const fs = require('fs');
const pino = require('pino');
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');

const router = express.Router();

// Helper: remove temp folder if needed
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// Heartbeat function
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

    // Generate unique folder for this session
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

            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === 'connecting') {
                    console.log('🔄 Connecting to WhatsApp...');
                } else if (connection === 'open') {
                    console.log('✅ Connected to WhatsApp:', sock.user?.id || 'unknown');

                    // Start heartbeat
                    startHeartbeat(sock);

                    await delay(1000);
                    await sock.sendPresenceUpdate('available');

                    // Send welcome message
                    const welcomeMessage =
                        '☠️ Welcome to CYPHER-MD ☠️\nYour WhatsApp is now linked.';
                    await sock.sendMessage(num + '@s.whatsapp.net', { text: welcomeMessage });

                    // Delay a bit, then send main WhatsApp session (creds.json)
                    await delay(1000);
                    const mainSession = JSON.stringify(state.creds);
                    await sock.sendMessage(num + '@s.whatsapp.net', {
                        text: `🆔 Your main WhatsApp Session ID:\n${mainSession}\n\n⚠️ Keep this safe! Anyone with it can access your WhatsApp account.`
                    });
                    console.log('📩 Main WhatsApp session sent');

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
