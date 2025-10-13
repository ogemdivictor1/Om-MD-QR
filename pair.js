// pair.js
import express from "express";
import makeWASocket, {
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import P from "pino";
import pkg from "pg";
import fs from "fs";
import path from "path";

const router = express.Router();

// ==========================
// 🔹 POSTGRES DATABASE SETUP
// ==========================
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // your Render Postgres URL
  ssl: { rejectUnauthorized: false },
});

// ✅ Auto-create sessions table
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      data JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Table 'sessions' ready in PostgreSQL.");
})();

// ==========================
// 🔹 LOCAL BACKUP FOLDER
// ==========================
const sessionFolder = path.join("./sessions");
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

// ==========================
// 🔹 ROUTES
// ==========================
router.get("/", (req, res) => {
  res.send("🔥 Cypher WhatsApp Pair Server is Running...");
});

router.get("/generate-session", async (req, res) => {
  try {
    console.log("⚡ Generating Session ID...");
    const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      printQRInTerminal: true,
      auth: state,
      logger: P({ level: "silent" }),
      browser: ["CypherPair", "Chrome", "1.0.0"],
      connectTimeoutMs: 20000, // ⏩ makes QR faster to appear
    });

    let qrSent = false;

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ✅ Send QR only once
      if (qr && !qrSent) {
        qrSent = true;
        console.log("📱 QR ready, waiting for scan...");
        return res.json({
          status: true,
          message: "Scan this QR code in WhatsApp to connect.",
          qr: qr,
        });
      }

      // ✅ Connection Opened
      if (connection === "open") {
        const sessionId = `CYPHER-${Date.now().toString(36)}`;
        console.log("✅ WhatsApp Connected:", sessionId);

        // Save to PostgreSQL
        await pool.query(
          "INSERT INTO sessions (session_id, data) VALUES ($1, $2)",
          [sessionId, JSON.stringify(state.creds)]
        );

        // Save backup locally
        fs.writeFileSync(
          path.join(sessionFolder, `${sessionId}.json`),
          JSON.stringify(state.creds, null, 2)
        );

        console.log(`💾 Session saved successfully: ${sessionId}`);

        // Keep the session alive (don’t close sock)
        sock.ev.on("creds.update", saveCreds);

        // ✅ Respond once connection is confirmed
        if (!res.headersSent) {
          res.json({
            status: true,
            message: "✅ Session ID Generated Successfully!",
            sessionId,
          });
        }
      }

      // 🧩 Reconnect only if logged out unexpectedly
      if (connection === "close") {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        console.log("⚠️ Connection closed:", reason);
        if (shouldReconnect) {
          console.log("🔁 Reconnecting...");
        }
      }
    });

  } catch (err) {
    console.error("❌ Error:", err);
    if (!res.headersSent) {
      res.status(500).send("Error generating session ID");
    }
  }
});

// ==========================
// 🔹 EXPORT ROUTER
// ==========================
export default router;