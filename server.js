const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------
// 1. GET ALL CASES (With Search & Filter Query Support)
// ----------------------------------------------------
app.get('/api/cases', (req, res) => {
  const { search, disease, classification } = req.query;

  let query = `SELECT * FROM surveillance_cases WHERE 1=1`;
  const params = [];

  if (search) {
    query += ` AND (patient_name LIKE ? OR epid_id LIKE ? OR barangay LIKE ? OR city LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  if (disease && disease !== 'ALL') {
    query += ` AND disease = ?`;
    params.push(disease);
  }

  if (classification && classification !== 'ALL') {
    query += ` AND case_classification = ?`;
    params.push(classification);
  }

  query += ` ORDER BY id DESC`;

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    // Parse JSON stringified disease_specific_data back to object
    const parsedRows = rows.map(r => ({
      ...r,
      disease_specific_data: r.disease_specific_data ? JSON.parse(r.disease_specific_data) : {}
    }));
    res.json({ success: true, count: parsedRows.length, data: parsedRows });
  });
});

// ----------------------------------------------------
// 2. GET SINGLE CASE BY ID
// ----------------------------------------------------
app.get('/api/cases/:id', (req, res) => {
  const query = `SELECT * FROM surveillance_cases WHERE id = ?`;
  db.get(query, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (!row) return res.status(404).json({ success: false, message: 'Case not found' });

    row.disease_specific_data = row.disease_specific_data ? JSON.parse(row.disease_specific_data) : {};
    res.json({ success: true, data: row });
  });
});

// ----------------------------------------------------
// 3. CREATE NEW SURVEILLANCE CASE
// ----------------------------------------------------
app.post('/api/cases', (req, res) => {
  const {
    epid_id, disease, dru_name, investigator, report_date,
    patient_name, sex, dob, age, contact,
    barangay, city, date_onset, hospitalized,
    case_classification, outcome, disease_specific_data
  } = req.body;

  if (!epid_id || !disease || !dru_name || !patient_name || !case_classification || !outcome) {
    return res.status(400).json({ success: false, error: 'Please provide all mandatory fields.' });
  }

  const query = `
    INSERT INTO surveillance_cases (
      epid_id, disease, dru_name, investigator, report_date,
      patient_name, sex, dob, age, contact,
      barangay, city, date_onset, hospitalized,
      case_classification, outcome, disease_specific_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const specificDataJson = JSON.stringify(disease_specific_data || {});

  db.run(query, [
    epid_id, disease, dru_name, investigator, report_date,
    patient_name, sex, dob, age, contact,
    barangay, city, date_onset, hospitalized,
    case_classification, outcome, specificDataJson
  ], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ success: false, error: 'EPID ID already exists. Please regenerate ID.' });
      }
      return res.status(500).json({ success: false, error: err.message });
    }
    res.status(201).json({
      success: true,
      message: 'Case successfully logged into surveillance registry.',
      caseId: this.lastID
    });
  });
});

// ----------------------------------------------------
// 4. DELETE A SURVEILLANCE CASE
// ----------------------------------------------------
app.delete('/api/cases/:id', (req, res) => {
  const query = `DELETE FROM surveillance_cases WHERE id = ?`;
  db.run(query, [req.params.id], function(err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Case not found.' });
    res.json({ success: true, message: 'Case deleted successfully.' });
  });
});

// ----------------------------------------------------
// 5. GET KPI SURVEILLANCE DASHBOARD STATS
// ----------------------------------------------------
app.get('/api/stats', (req, res) => {
  const query = `
    SELECT
      COUNT(*) as total_cases,
      SUM(CASE WHEN case_classification = 'Confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN case_classification IN ('Suspected', 'Probable') THEN 1 ELSE 0 END) as suspected_probable,
      SUM(CASE WHEN outcome LIKE '%Died%' THEN 1 ELSE 0 END) as deaths
    FROM surveillance_cases
  `;

  db.get(query, [], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({
      success: true,
      data: {
        total: row.total_cases || 0,
        confirmed: row.confirmed || 0,
        suspected: row.suspected_probable || 0,
        deaths: row.deaths || 0
      }
    });
  });
});

// ----------------------------------------------------
// 6. EXPORT PIDSR CSV FILE (DIRECT DOWNLOAD STREAM)
// ----------------------------------------------------
app.get('/api/export-csv', (req, res) => {
  const query = `SELECT * FROM surveillance_cases ORDER BY id DESC`;

  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).send('Error generating CSV');

    const headers = [
      'EPID_ID', 'Disease_Form', 'DRU_Facility', 'Investigator', 'Report_Date',
      'Patient_Name', 'Sex', 'Age', 'Barangay', 'City', 'Date_Onset',
      'Hospitalized', 'Classification', 'Outcome'
    ];

    let csvContent = headers.join(',') + '\n';

    rows.forEach(r => {
      const row = [
        `"${r.epid_id}"`,
        `"${r.disease}"`,
        `"${r.dru_name.replace(/"/g, '""')}"`,
        `"${r.investigator.replace(/"/g, '""')}"`,
        `"${r.report_date}"`,
        `"${r.patient_name.replace(/"/g, '""')}"`,
        `"${r.sex}"`,
        `"${r.age}"`,
        `"${r.barangay.replace(/"/g, '""')}"`,
        `"${r.city.replace(/"/g, '""')}"`,
        `"${r.date_onset}"`,
        `"${r.hospitalized}"`,
        `"${r.case_classification}"`,
        `"${r.outcome}"`
      ];
      csvContent += row.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=EpiSurv_Registry_${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(csvContent);
  });
});

// Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


module.exports = app;