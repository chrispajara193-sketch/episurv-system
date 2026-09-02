const { createClient } = require('@libsql/client');

// Connect to Turso Cloud SQLite using Environment Variables
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Initialize Table in the Cloud
async function initDB() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS surveillance_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        epid_id TEXT UNIQUE NOT NULL,
        disease TEXT NOT NULL,
        dru_name TEXT NOT NULL,
        investigator TEXT NOT NULL,
        report_date TEXT NOT NULL,
        patient_name TEXT NOT NULL,
        sex TEXT NOT NULL,
        dob TEXT,
        age INTEGER NOT NULL,
        contact TEXT,
        barangay TEXT NOT NULL,
        city TEXT NOT NULL,
        date_onset TEXT NOT NULL,
        hospitalized TEXT DEFAULT 'No',
        case_classification TEXT NOT NULL,
        outcome TEXT NOT NULL,
        disease_specific_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Cloud Surveillance database table ready.');
  } catch (err) {
    console.error('❌ Database initialization error:', err.message);
  }
}

initDB();

module.exports = db;