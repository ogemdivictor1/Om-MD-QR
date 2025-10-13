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

// ==========================
// 🔹 POSTGRES DATABASE SETUP
// ==========================
const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // From Render
  ssl: { rejectUnauthorized: false },
});

// ✅ Auto-create table if not exists
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
// 🔹 EXPRESS SERVER SETUP
// ==========================
const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ==========================
// 🔹 STORAGE FOLDER BACKUP
// ==========================
const sessionFolder = path.join("./sessions");
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder, { recursive: true });

// ==========================
// 🔹 QUICK SESSION GENERATOR
// ==========================
app.get("/", (req, res) => {
  res.send("🔥 Cypher WhatsApp Pair Server is Running...");
});

// Main route for session generation
app.get("/generate-session", async (req, res) => {
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
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        res.send({
          status: true,
          message: "Scan this QR code in WhatsApp to connect.",
          qr: qr,
        });
      }

      if (connection === "open") {
        const sessionId = `CYPHER-${Date.now().toString(36)}`;
        console.log("✅ WhatsApp Connected!");

        // Save to database
        pool.query(
          "INSERT INTO sessions (session_id, data) VALUES ($1, $2)",
          [sessionId, JSON.stringify(state.creds)]
        );

        // Save to file as backup
        fs.writeFileSync(
          path.join(sessionFolder, `${sessionId}.json`),
          JSON.stringify(state.creds, null, 2)
        );

        res.json({
          status: true,
          message: "✅ Session ID Generated Successfully!",
          sessionId,
        });

        sock.end();
      } else if (connection === "close") {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        if (shouldReconnect) sock();
      }
    });

    sock.ev.on("creds.update", saveCreds);
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).send("Error generating session ID");
  }
});

// ==========================
// 🔹 START SERVER
// ==========================
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});