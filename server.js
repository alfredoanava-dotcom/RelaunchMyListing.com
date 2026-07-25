/* ============================================================
   relaunchmylisting.com — server.js
   Alfredo Nava | REALTOR® | Real Broker | Arizona

   What this file does:
   1. Serves the front end from /public
   2. POST /api/lead  — saves the lead to leads.jsonl AND emails Alfredo
   3. GET  /health    — uptime check + tells you if email is wired up
   4. Auto-creates leads.jsonl on first write

   IMPORTANT DESIGN NOTE:
   Email is the SOURCE OF TRUTH for leads. On shared hosting the
   leads.jsonl file can get wiped on a redeploy, so a lead is only
   counted as "captured" if it lands in your inbox. The file is a
   convenience backup, not the record.
   ============================================================ */

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CONFIG (all set via environment variables on Hostinger) ---------- */
// Where lead alerts are sent. Put your Lofty CRM parsing address here so
// leads flow straight into your CRM, or your normal email.
const LEAD_TO   = process.env.LEAD_TO   || 'Alfredo.anava@gmail.com';
// The mailbox that SENDS the alert (usually the same as SMTP_USER).
const LEAD_FROM = process.env.LEAD_FROM || process.env.SMTP_USER || 'Alfredo.anava@gmail.com';

// SMTP credentials. Two ways to configure:
//   A) Hostinger email:  SMTP_HOST=smtp.hostinger.com  SMTP_PORT=465  SMTP_SECURE=true
//   B) Gmail:            SMTP_HOST=smtp.gmail.com       SMTP_PORT=465  SMTP_SECURE=true
//      (Gmail requires a 16-char App Password, not your login password.)
const SMTP_HOST   = process.env.SMTP_HOST   || 'smtp.gmail.com';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = (process.env.SMTP_SECURE || 'true') === 'true';
const SMTP_USER   = process.env.SMTP_USER   || '';
const SMTP_PASS   = process.env.SMTP_PASS   || '';

const EMAIL_ENABLED = Boolean(SMTP_USER && SMTP_PASS);
const LEADS_FILE = path.join(__dirname, 'leads.jsonl');

/* ---------- mail transport ---------- */
let transporter = null;
if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

/* ---------- middleware ---------- */
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
function saveToDisk(lead) {
  try {
    fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
    return true;
  } catch (err) {
    console.error('[lead] FILE WRITE FAILED:', err.message);
    return false;
  }
}

async function sendAlert(lead) {
  if (!EMAIL_ENABLED) {
    console.warn('[lead] EMAIL SKIPPED — SMTP_USER / SMTP_PASS not set in environment.');
    return false;
  }
  try {
    await transporter.sendMail({
      from: `"Relaunch Funnel" <${LEAD_FROM}>`,
      to: LEAD_TO,
      replyTo: lead.email || undefined,
      subject: `New Relaunch lead: ${lead.name || 'Unknown'}`,
      text:
        `New $149 Relaunch Kit lead\n\n` +
        `Name:     ${lead.name || '-'}\n` +
        `Phone:    ${lead.phone || '-'}\n` +
        `Email:    ${lead.email || '-'}\n` +
        `Address:  ${lead.address || '-'}\n` +
        `Time:     ${lead.time}\n`
    });
    console.log('[lead] EMAIL SENT to', LEAD_TO);
    return true;
  } catch (err) {
    console.error('[lead] EMAIL FAILED:', err.message);
    return false;
  }
}

/* ---------- routes ---------- */
app.post('/api/lead', async (req, res) => {
  const name    = (req.body.name    || '').toString().trim();
  const phone   = (req.body.phone   || '').toString().trim();
  const email   = (req.body.email   || '').toString().trim();
  const address = (req.body.address || '').toString().trim();

  // Minimum viable lead: a name and a way to reach them.
  if (!name || !phone) {
    return res.status(400).json({ ok: false, error: 'Please include your name and mobile number.' });
  }

  const lead = {
    name, phone, email, address,
    time: new Date().toISOString(),
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
  };

  const saved  = saveToDisk(lead);
  const mailed = await sendAlert(lead);

  // A lead is captured if it persisted at least one way.
  if (saved || mailed) {
    console.log(`[lead] CAPTURED — file:${saved} email:${mailed} — ${name} / ${phone}`);
    return res.json({ ok: true, redirect: '/book' });
  }

  console.error('[lead] LOST — neither file nor email worked:', name, phone);
  return res.status(500).json({ ok: false, error: 'Something broke on our end. Text me directly at (your number).' });
});

app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    emailConfigured: EMAIL_ENABLED,
    smtpHost: EMAIL_ENABLED ? SMTP_HOST : null,
    leadTo: LEAD_TO
  });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ---------- boot ---------- */
app.listen(PORT, () => {
  console.log('========================================');
  console.log(`relaunchmylisting.com listening on :${PORT}`);
  if (EMAIL_ENABLED) {
    console.log(`Email alerts: ON  (via ${SMTP_HOST}, to ${LEAD_TO})`);
  } else {
    console.log('Email alerts: OFF — set SMTP_USER and SMTP_PASS to turn them on.');
    console.log('  >> This is the #1 reason leads/emails go missing. <<');
  }
  console.log('========================================');
});
