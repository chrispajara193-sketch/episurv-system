const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Initialize Firebase Admin using Environment Variables
// We use JSON.parse so you can paste the whole Service Account JSON into Vercel
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    databaseURL: process.env.FIREBASE_DATABASE_URL 
  });
}

const db = admin.database();

// 📥 1. GET ALL CASES
app.get(['/api/cases', '/cases'], async (req, res) => {
  try {
    const search = (req.query.search || '').toLowerCase();
    const snapshot = await db.ref('surveillance_cases').once('value');
    const data = snapshot.val() || {};

    // Convert object to array (Firebase stores data as objects)
    let casesArray = Object.keys(data).map(key => data[key]);

    // Apply Search Filter (Logic moved from SQL to JavaScript)
    if (search) {
      casesArray = casesArray.filter(c => 
        (c.patient_name && c.patient_name.toLowerCase().includes(search)) ||
        (c.epid_id && c.epid_id.toLowerCase().includes(search)) ||
        (c.barangay && c.barangay.toLowerCase().includes(search))
      );
    }

    // Sort by newest first
    casesArray.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, data: casesArray });
  } catch (err) {
    console.error('GET cases error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 💾 2. SAVE OR UPDATE CASE
app.post(['/api/cases', '/cases'], async (req, res) => {
  try {
    const d = req.body;
    if (!d.epid_id) return res.status(400).json({ success: false, error: 'Missing Case ID' });

    // Clean the Epid ID for Firebase keys (No dots, #, $, [, or ])
    const safeId = d.epid_id.replace(/[\.\#\$\[\]]/g, "-");

    const payload = {
      ...d,
      age: parseInt(d.age, 10) || 0,
      created_at: d.created_at || new Date().toISOString(),
      disease_specific_data: typeof d.disease_specific_data === 'string' 
        ? d.disease_specific_data 
        : JSON.stringify(d.disease_specific_data || {})
    };

    // Firebase 'set' on a specific ID handles the "Update if exists" (Upsert) automatically
    await db.ref(`surveillance_cases/${safeId}`).set(payload);

    res.json({ success: true, message: 'Saved successfully to Firebase!' });
  } catch (err) {
    console.error('POST cases error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📊 3. STATS ENDPOINT
app.get(['/api/stats', '/stats'], async (req, res) => {
  try {
    const snapshot = await db.ref('surveillance_cases').once('value');
    const data = snapshot.val() || {};
    const cases = Object.values(data);

    const stats = {
      total: cases.length,
      confirmed: cases.filter(c => c.case_classification === 'Confirmed').length,
      suspected: cases.filter(c => ['Suspected', 'Probable'].includes(c.case_classification)).length,
      deaths: cases.filter(c => String(c.outcome).toLowerCase().includes('died')).length
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    res.json({ success: true, data: { total: 0, confirmed: 0, suspected: 0, deaths: 0 } });
  }
});

// 📁 4. EXPORT CSV
app.get(['/api/export-csv', '/export-csv'], async (req, res) => {
  try {
    const snapshot = await db.ref('surveillance_cases').once('value');
    const data = snapshot.val() || {};
    const rows = Object.values(data);

    if (!rows.length) return res.send("No records found.");

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

// 🗑️ 5. DELETE CASE (Multi-Admin Version)
app.delete(['/api/cases/:id', '/cases/:id'], async (req, res) => {
  // ADD ALL ADMIN EMAILS TO THIS LIST
  const adminEmails = [
    "qcesd.d2esu@quezoncity.gov.ph",
    "nicxdumlao.qcesu@gmail.com",
  ];

  const requesterEmail = req.headers['x-user-email'];

  // Check if the email is in our admin list
  if (!adminEmails.includes(requesterEmail)) {
    return res.status(403).json({ success: false, message: 'ACCESS DENIED: Insufficient Permissions.' });
  }

  try {
    const id = req.params.id;
    // Clean the ID for Firebase keys (same logic as saving)
    const safeId = id.replace(/[\.\#\$\[\]]/g, "-");

    await db.ref(`surveillance_cases/${safeId}`).remove();
    res.json({ success: true, message: 'Record permanently deleted from Firebase.' });
  } catch (err) {
    console.error('DELETE error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;