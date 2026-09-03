const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
app.use(cors());
app.use(express.json());

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

// 📥 1. GET ALL CASES (Powers your registry from the cloud)
app.get(['/api/cases', '/cases'], async (req, res) => {
  try {
    const search = req.query.search || '';
    let query = "SELECT * FROM surveillance_cases";
    let args = [];

    if (search) {
      query += " WHERE patient_name LIKE ? OR epid_id LIKE ? OR barangay LIKE ?";
      const term = `%${search}%`;
      args = [term, term, term];
    }
    query += " ORDER BY id DESC";

    const result = await db.execute({ sql: query, args });
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('GET cases error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 💾 2. SAVE OR UPDATE CASE (Writes directly into surveillance_cases in Turso)
app.post(['/api/cases', '/cases'], async (req, res) => {
  try {
    const d = req.body;
    if (!d.epid_id) {
      return res.status(400).json({ success: false, error: 'Missing Case ID' });
    }

    const sql = `
      INSERT INTO surveillance_cases (
        epid_id, disease, dru_name, investigator, report_date,
        patient_name, sex, dob, age, contact, barangay, city,
        date_onset, hospitalized, case_classification, outcome, disease_specific_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(epid_id) DO UPDATE SET
        disease = excluded.disease,
        dru_name = excluded.dru_name,
        investigator = excluded.investigator,
        report_date = excluded.report_date,
        patient_name = excluded.patient_name,
        sex = excluded.sex,
        dob = excluded.dob,
        age = excluded.age,
        contact = excluded.contact,
        barangay = excluded.barangay,
        city = excluded.city,
        date_onset = excluded.date_onset,
        hospitalized = excluded.hospitalized,
        case_classification = excluded.case_classification,
        outcome = excluded.outcome,
        disease_specific_data = excluded.disease_specific_data
    `;

    const args = [
      d.epid_id,
      d.disease || 'Leptospirosis',
      d.dru_name || '',
      d.investigator || '',
      d.report_date || '',
      d.patient_name || '',
      d.sex || '',
      d.dob || '',
      parseInt(d.age, 10) || 0,
      d.contact || '',
      d.barangay || '',
      d.city || 'Quezon City',
      d.date_onset || '',
      d.hospitalized || 'No',
      d.case_classification || 'Suspected',
      d.outcome || 'Alive',
      JSON.stringify(d.disease_specific_data || {})
    ];

    await db.execute({ sql, args });
    res.json({ success: true, message: 'Saved successfully to Turso Cloud!' });
  } catch (err) {
    console.error('POST cases error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📊 3. STATS ENDPOINT
app.get(['/api/stats', '/stats'], async (req, res) => {
  try {
    const totalRes = await db.execute("SELECT COUNT(*) as count FROM surveillance_cases");
    const confRes = await db.execute("SELECT COUNT(*) as count FROM surveillance_cases WHERE case_classification = 'Confirmed'");
    const suspRes = await db.execute("SELECT COUNT(*) as count FROM surveillance_cases WHERE case_classification IN ('Suspected', 'Probable')");
    const deathRes = await db.execute("SELECT COUNT(*) as count FROM surveillance_cases WHERE outcome LIKE '%Died%'");

    res.json({
      success: true,
      data: {
        total: totalRes.rows[0]?.count || 0,
        confirmed: confRes.rows[0]?.count || 0,
        suspected: suspRes.rows[0]?.count || 0,
        deaths: deathRes.rows[0]?.count || 0
      }
    });
  } catch (err) {
    res.json({ success: true, data: { total: 0, confirmed: 0, suspected: 0, deaths: 0 } });
  }
});

// 📁 4. EXPORT CSV ENDPOINT
app.get(['/api/export-csv', '/export-csv'], async (req, res) => {
  try {
    const result = await db.execute("SELECT * FROM surveillance_cases ORDER BY id DESC");
    const rows = result.rows;
    if (!rows.length) {
      return res.send("No records found.");
    }
    const headers = Object.keys(rows[0]).join(",");
    const csvLines = rows.map(r => Object.values(r).map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(","));
    const csvContent = [headers, ...csvLines].join("\n");

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="pidsr_cases.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).send("Error exporting CSV");
  }
});

// Export the Express app for Vercel
module.exports = app;