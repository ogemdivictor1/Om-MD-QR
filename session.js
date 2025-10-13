// session.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ✅ PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Folder where Baileys session folders are stored
const baseFolder = path.join(__dirname, 'temp');

// Create the temp folder if missing
if (!fs.existsSync(baseFolder)) {
  fs.mkdirSync(baseFolder);
}

// ===============================
// 💾 SAVE SESSION TO DATABASE
// ===============================
async function saveSession(cypherId) {
  try {
    const sessionPath = path.join(baseFolder, cypherId);
    const credsPath = path.join(sessionPath, 'creds.json');

    // Read Baileys creds
    if (!fs.existsSync(credsPath)) {
      console.log(`⚠️ No creds found for ${cypherId}`);
      return;
    }

    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

    // Read all key files inside the folder
    const keysFolder = path.join(sessionPath, 'keys');
    const keys = {};
    if (fs.existsSync(keysFolder)) {
      const files = fs.readdirSync(keysFolder);
      for (const file of files) {
        const keyData = JSON.parse(fs.readFileSync(path.join(keysFolder, file), 'utf8'));
        keys[file.replace('.json', '')] = keyData;
      }
    }

    await pool.query(
      `INSERT INTO sessions (cypher_id, creds_json, keys_json, timestamp)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cypher_id)
       DO UPDATE SET
         creds_json = EXCLUDED.creds_json,
         keys_json = EXCLUDED.keys_json,
         timestamp = EXCLUDED.timestamp`,
      [cypherId, JSON.stringify(creds), JSON.stringify(keys), Date.now()]
    );

    console.log(`💾 Session ${cypherId} synced to database`);
  } catch (err) {
    console.error('❌ Error saving session:', err.message);
  }
}

// ===============================
// ♻️ RESTORE SESSION FROM DATABASE
// ===============================
async function restoreAllSessions() {
  try {
    const result = await pool.query('SELECT * FROM sessions');
    if (result.rows.length === 0) {
      console.log('⚠️ No saved sessions found in database.');
      return;
    }

    console.log(`♻️ Restoring ${result.rows.length} saved session(s)...`);

    for (const session of result.rows) {
      const sessionPath = path.join(baseFolder, session.cypher_id);
      const keysFolder = path.join(sessionPath, 'keys');

      // Make sure folders exist
      if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);
      if (!fs.existsSync(keysFolder)) fs.mkdirSync(keysFolder);

      // Restore creds.json
      fs.writeFileSync(
        path.join(sessionPath, 'creds.json'),
        JSON.stringify(JSON.parse(session.creds_json), null, 2)
      );

      // Restore keys
      const keys = JSON.parse(session.keys_json || '{}');
      for (const keyName in keys) {
        const keyPath = path.join(keysFolder, `${keyName}.json`);
        fs.writeFileSync(keyPath, JSON.stringify(keys[keyName], null, 2));
      }

      console.log(`✅ Restored session folder: ${session.cypher_id}`);
    }
  } catch (err) {
    console.error('❌ Error restoring sessions from database:', err.message);
  }
}

// ===============================
// 🗑️ DELETE SESSION
// ===============================
async function deleteSession(cypherId) {
  try {
    await pool.query('DELETE FROM sessions WHERE cypher_id=$1', [cypherId]);

    const sessionPath = path.join(baseFolder, cypherId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    console.log(`🗑️ Session ${cypherId} deleted from both DB & folder`);
  } catch (err) {
    console.error('❌ Error deleting session:', err.message);
  }
}

module.exports = {
  saveSession,
  restoreAllSessions,
  deleteSession
};