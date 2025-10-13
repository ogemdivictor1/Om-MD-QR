// pair.js
const express = require("express");
const router = express.Router();
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} = require("@whiskeysockets/baileys");
const P = require("pino");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// ==========================
// 🔹 POSTGRES DATABASE SETUP
// ==========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Table 'sessions' is ready.");
})();

// ==========================
// 🔹 STORAGE FOLDER BACKUP
// ==========================
const sessionFolder = path.join(__dirname, "sessions");
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

// ==========================
// 🔹 MAIN ROUTE
// ==========================
router.get("/", (req, res) => {
  res.send("🔥 Cypher Pair Server is active and ready!");
});

router.get("/generate-session", async (req, res) => {
  try {
    console.log("⚡ Starting WhatsApp session generation...");

    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      printQRInTerminal: true,
      auth: state,
      logger: P({ level: "silent" }),
      browser: ["CypherPair", "Chrome", "1.0.0"],
    });

    let qrSent = false;

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !qrSent) {
        qrSent = true;
        console.log("📱 QR Code generated — waiting for user to scan...");
        return res.send({
          status: true,
          message: "Scan this QR code in WhatsApp to connect.",
          qr: qr,
        });
      }

      if (connection === "open") {
        const sessionId = `CYPHER-${Date.now().toString(36)}`;
        console.log("✅ WhatsApp Connected! Session ID:", sessionId);

        // Save to database
        await pool.query(
          "INSERT INTO sessions (session_id, data) VALUES ($1, $2)",
          [sessionId, JSON.stringify(state.creds)]
        );

        // Save to file as backup
        fs.writeFileSync(
          path.join(sessionFolder, `${sessionId}.json`),
          JSON.stringify(state.creds, null, 2)
        );

        console.log("💾 Session saved successfully!");
        sock.ev.off("connection.update", this);

        // Keep connection open (don’t end)
        res.json({
          status: true,
          message: "✅ Session ID Generated Successfully and Connection Kept Alive!",
          sessionId,
        });
      }

      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("♻️ Reconnecting...");
          makeWASocket({ version, auth: state });
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error generating session ID");
  }
});

module.exports = router;