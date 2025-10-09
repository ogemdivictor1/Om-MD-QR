// session.js
const fs = require('fs');
const path = require('path');

// Folder where all sessions will be stored
const sessionFolder = path.join(__dirname, 'sessions');

// ✅ Create the folder if it doesn’t exist
if (!fs.existsSync(sessionFolder)) {
  fs.mkdirSync(sessionFolder);
}

// ✅ Save session data (called when a new session is created)
function saveSession(sessionId, sessionData) {
  const filePath = path.join(sessionFolder, `${sessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
  console.log(`💾 Session saved: ${sessionId}`);
}

// ✅ Restore all saved sessions (called automatically in index.js)
async function restoreAllSessions() {
  const files = fs.readdirSync(sessionFolder);
  if (files.length === 0) {
    console.log('⚠️ No saved sessions found to restore.');
    return;
  }

  console.log(`♻️ Restoring ${files.length} saved session(s)...`);

  for (const file of files) {
    try {
      const filePath = path.join(sessionFolder, file);
      const data = JSON.parse(fs.readFileSync(filePath));

      // Here, you should reconnect your bot using saved session data
      // Example: await connectToWhatsapp(data);
      console.log(`✅ Restored session: ${file.replace('.json', '')}`);
    } catch (err) {
      console.error(`❌ Failed to restore ${file}:`, err.message);
    }
  }
}

// ✅ Delete a session (optional cleanup function)
function deleteSession(sessionId) {
  const filePath = path.join(sessionFolder, `${sessionId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🗑️ Session deleted: ${sessionId}`);
  }
}

module.exports = {
  saveSession,
  restoreAllSessions,
  deleteSession
};