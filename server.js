const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');

const app = express();
app.use(cors());
app.use(express.json());

// Connect to Turso Cloud SQLite
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || ''
});

// Ensure Table Exists
async function ensureTable() {
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
  } catch (err) {
    console.error('Table check error:', err);
  }
}

// 1. GET ALL CASES
app.get('/api/cases', async (req, res) => {
  try {
    await ensureTable();
    const { search, disease } = req.query;
    let query = `SELECT * FROM surveillance_cases WHERE 1=1`;
    const args = [];

    if (search) {
      query += ` AND (patient_name LIKE ? OR epid_id LIKE ? OR barangay LIKE ?)`;
      const term = `%${search}%`;
      args.push(term, term, term);
    }
    if (disease && disease !== 'ALL') {
      query += ` AND disease LIKE ?`;
      args.push(`%${disease}%`);
    }

    query += ` ORDER BY id DESC`;
    const result = await db.execute({ sql: query, args });

    const rows = result.rows.map(r => ({
      ...r,
      disease_specific_data: r.disease_specific_data ? JSON.parse(r.disease_specific_data) : {}
    }));

    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. CREATE NEW CASE
app.post('/api/cases', async (req, res) => {
  try {
    await ensureTable();
    const {
      epid_id, disease, dru_name, investigator, report_date,
      patient_name, sex, dob, age, contact,
      barangay, city, date_onset, hospitalized,
      case_classification, outcome, disease_specific_data
    } = req.body;

    if (!epid_id || !patient_name) {
      return res.status(400).json({ success: false, error: 'EPID ID and Patient Name are required.' });
    }

    await db.execute({
      sql: `
        INSERT INTO surveillance_cases (
          epid_id, disease, dru_name, investigator, report_date,
          patient_name, sex, dob, age, contact,
          barangay, city, date_onset, hospitalized,
          case_classification, outcome, disease_specific_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        epid_id,
        disease || 'General Disease',
        dru_name || 'QCHD',
        investigator || 'Surveillance Officer',
        report_date || new Date().toISOString().slice(0, 10),
        patient_name,
        sex || 'Male',
        dob || '',
        age || 0,
        contact || '',
        barangay || 'Central',
        city || 'Quezon City',
        date_onset || new Date().toISOString().slice(0, 10),
        hospitalized || 'No',
        case_classification || 'Suspected',
        outcome || 'Alive',
        JSON.stringify(disease_specific_data || {})
      ]
    });

    res.status(201).json({ success: true, message: 'Case successfully saved to Turso!' });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. GET STATS
app.get('/api/stats', async (req, res) => {
  try {
    await ensureTable();
    const result = await db.execute(`
      SELECT
        COUNT(*) as total_cases,
        SUM(CASE WHEN case_classification = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN case_classification IN ('Suspected', 'Probable') THEN 1 ELSE 0 END) as suspected_probable,
        SUM(CASE WHEN outcome LIKE '%Died%' THEN 1 ELSE 0 END) as deaths
      FROM surveillance_cases
    `);
    const r = result.rows[0];
    res.json({
      success: true,
      data: {
        total: r.total_cases || 0,
        confirmed: r.confirmed || 0,
        suspected: r.suspected_probable || 0,
        deaths: r.deaths || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. EXPORT CSV
app.get('/api/export-csv', async (req, res) => {
  try {
    await ensureTable();
    const result = await db.execute(`SELECT * FROM surveillance_cases ORDER BY id DESC`);
    const headers = ['EPID_ID', 'Disease', 'DRU', 'Investigator', 'Report_Date', 'Patient', 'Sex', 'Age', 'Barangay', 'City', 'Onset', 'Classification', 'Outcome'];
    let csv = headers.join(',') + '\n';

    result.rows.forEach(r => {
      csv += `"${r.epid_id}","${r.disease}","${r.dru_name}","${r.investigator}","${r.report_date}","${r.patient_name}","${r.sex}","${r.age}","${r.barangay}","${r.city}","${r.date_onset}","${r.case_classification}","${r.outcome}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=EpiSurv_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csv);
  } catch (err) {
    res.status(500).send('Error generating CSV');
  }
});

module.exports = app;