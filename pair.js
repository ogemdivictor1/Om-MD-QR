const PastebinAPI = require('pastebin-js'),
pastebin = new PastebinAPI('EMWTMkQAVfJa9kM-MRUrxd5Oku1U7pgL')
const {makeid} = require('./id');
const express = require('express');
const fs = require('fs');
let router = express.Router()
const pino = require("pino");
const {
    default: Mohammad_Imran,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys");

function removeFile(FilePath){
    if(!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true })
 };

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function CYPHER_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/'+id)
        try {
            let Pair_Code_By_Cypher = Mohammad_Imran({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({level: "fatal"}).child({level: "fatal"})),
                },
                printQRInTerminal: false,
                logger: pino({level: "fatal"}).child({level: "fatal"}),
                browser: ["Chrome (Linux)", "", ""]
             });

            if(!Pair_Code_By_Cypher.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g,'');
                const code = await Pair_Code_By_Cypher.requestPairingCode(num);
                if(!res.headersSent){
                    await res.send({code});
                }
            }

            Pair_Code_By_Cypher.ev.on('creds.update', saveCreds);
            Pair_Code_By_Cypher.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;

                if (connection == "open") {
                    await delay(5000);
                    let data = fs.readFileSync(__dirname + `/temp/${id}/creds.json`);
                    await delay(800);
                    let b64data = Buffer.from(data).toString('base64');
                    let session = await Pair_Code_By_Cypher.sendMessage(Pair_Code_By_Cypher.user.id, { text: 'CYPHER-MD;;;' + b64data });

                    let CYPHER_TEXT = `
╔════◇
║ *『 𝗖𝗬𝗣𝗛𝗘𝗥-𝗠𝗗 』*
║ _Pairing successful. Bot ready to connect._
╚════════════════════════╝
╔═════◇
║ 『••• 𝗦𝗨𝗣𝗣𝗢𝗥𝗧 𝗟𝗜𝗡𝗞 •••』
║ *Developer:* _https://wa.me/2348126159499_
║ *Note:* _Never share your SESSION_ID with anyone._
║ _It gives full access to your WhatsApp._
╚════════════════════════╝
`;

                    await Pair_Code_By_Cypher.sendMessage(
                        Pair_Code_By_Cypher.user.id,
                        { text: CYPHER_TEXT },
                        { quoted: session }
                    );

                    await delay(100);
                    await Pair_Code_By_Cypher.ws.close();
                    return await removeFile('./temp/'+id);
                } 
                else if (connection === "close" && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    CYPHER_PAIR_CODE();
                }
            });
        } catch (err) {
            console.log("Service restarted due to error");
            await removeFile('./temp/'+id);
            if(!res.headersSent){
                await res.send({code:"Service Unavailable"});
            }
        }
    }

    return await CYPHER_PAIR_CODE();
});

module.exports = router;
