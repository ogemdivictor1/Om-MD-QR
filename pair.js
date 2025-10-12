const PastebinAPI = require('pastebin-js'),
pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL');
const { makeid } = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require("pino");
const {
    default: Mohammad_Imran,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

// Helper to remove temp folder
function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

// Route to generate pairing code
router.get('/', async (req, res) => {
    const id = makeid();
    let number = req.query.number;

    async function CYPHER_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);

        try {
            // Create Baileys socket
            const socket = Mohammad_Imran({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ["Chrome (Linux)", "", ""]
            });

            // Wait until WhatsApp registers the user
            socket.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;

                // Connection open -> user scanned QR / approved pairing
                if (connection === "open") {
                    console.log("WhatsApp connected, generating session ID...");

                    const credsPath = `./temp/${id}/creds.json`;

                    // Wait until creds.json exists
                    let tries = 0;
                    while (!fs.existsSync(credsPath) && tries < 20) {
                        await delay(1000);
                        tries++;
                    }

                    if (fs.existsSync(credsPath)) {
                        const data = fs.readFileSync(credsPath);
                        const sessionID = Buffer.from(data).toString('base64');

                        // Send session ID to your WhatsApp number
                        await socket.sendMessage(socket.user.id, { text: `CYPHER-MD;;;\n${sessionID}` });

                        // Send response to API caller
                        if (!res.headersSent) {
                            await res.send({ sessionID });
                        }

                        // Close connection and remove temp folder
                        await delay(1000);
                        await socket.ws.close();
                        removeFile(`./temp/${id}`);
                    }
                }

                // Connection closed -> restart if not due to auth
                if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    console.log("Connection closed, retrying...");
                    await delay(5000);
                    CYPHER_PAIR_CODE();
                }
            });

            // Request pairing code if not registered
            if (!socket.authState.creds.registered) {
                number = number.replace(/[^0-9]/g, '');
                const code = await socket.requestPairingCode(number);
                if (!res.headersSent) {
                    await res.send({ code });
                }
            }

            // Save credentials on updates
            socket.ev.on('creds.update', saveCreds);

        } catch (err) {
            console.log("Error occurred:", err);
            removeFile(`./temp/${id}`);
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }

    return await CYPHER_PAIR_CODE();
});

module.exports = router;
