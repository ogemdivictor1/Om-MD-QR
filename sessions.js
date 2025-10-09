// session.js
const fs = require("fs");
const path = require("path");

const SESSIONS_DIR = path.join(__dirname, "sessions");

// Ensure the sessions folder exists
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Function to save a session file
function saveSession(sessionId, data) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`💾 Session saved: ${sessionId}`);
}

// Function to load all saved sessions
function loadSessions() {
  const files = fs.readdirSync(SESSIONS_DIR);
  const sessions = [];

  for (const file of files) {
    if (file.endsWith(".json")) {
      const filePath = path.join(SESSIONS_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath));
        sessions.push({
          id: file.replace(".json", ""),
          data,
        });
        console.log(`🔁 Session restored: ${file}`);
      } catch (err) {
        console.error(`❌ Failed to load session ${file}:`, err.message);
      }
    }
  }

  return sessions;
}

// Function to delete a session (if needed)
function deleteSession(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    console.log(`🗑️ Deleted session: ${sessionId}`);
  }
}

module.exports = {
  saveSession,
  loadSessions,
  deleteSession,
};