/* ============================================================
   relaunchmylisting.com — server.js
   Alfredo Nava | REALTOR® | Real Broker | Arizona

   Opt-in works exactly like azhomelistings.net:
   - Uses GMAIL with a 16-char App Password (no Hostinger mailbox needed)
   - On every lead it sends TWO emails:
       1) a readable alert to you (LEAD_TO)
       2) a Lofty-parseable email to your Lofty address, so the lead
          auto-creates in your CRM
   - Also saves a local backup to leads.jsonl

   Routes:
     POST /api/lead  — capture a lead, email you + Lofty, then redirect to /book
     GET  /book      — the booking / thank-you page
     GET  /health    — quick check of whether email is wired up
   ============================================================ */

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- CONFIG ----------
   The ONLY thing you must set on Hostinger is GMAIL_APP_PASSWORD.
   You can reuse the same App Password from azhomelistings.net — an
   App Password is tied to your Google account, not to one site. */

// Gmail account that SENDS the alert (and that the App Password belongs to).
const GMAIL_USER = process.env.GMAIL_USER || 'Alfredo.anava@gmail.com';

// 16-char Gmail App Password. Set this in Hostinger > Environment Variables.
// Get one at: myaccount.google.com > Security > 2-Step Verification > App passwords
const GMAIL_APP_PASSWORD = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

// Where your readable lead alerts land.
const LEAD_TO = process.env.LEAD_TO || 'Alfredo.anava@gmail.com';

// Your Lofty email-parsing address — a lead emailed here auto-creates in Lofty.
// This is the same one used on azhomelistings.net.
const LOFTY_PARSING_EMAIL = process.env.LOFTY_PARSING_EMAIL || 'alfredo_nava@mail.lofty.me';

const EMAIL_ENABLED = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);
const LEADS_FILE = path.join(__dirname, 'leads.jsonl');

/* ---------- mail transport (Gmail) ---------- */
let transporter = null;
if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
  });
}

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

// 1) Human-readable alert to Alfredo.
async function sendAlert(lead) {
  await transporter.sendMail({
    from: `"Relaunch Funnel" <${GMAIL_USER}>`,
    to: LEAD_TO,
    replyTo: lead.email || undefined,
    subject: `New Relaunch lead: ${lead.name}`,
    text:
      `New $149 Relaunch Kit lead\n\n` +
      `Name:     ${lead.name || '-'}\n` +
      `Phone:    ${lead.phone || '-'}\n` +
      `Email:    ${lead.email || '-'}\n` +
      `Address:  ${lead.address || '-'}\n` +
      `Time:     ${lead.time}\n`
  });
}

// 2) Machine-parseable email to Lofty so the lead auto-creates in the CRM.
//    Labeled Name/Email/Phone lines are what Lofty's parser looks for.
async function sendToLofty(lead) {
  if (!LOFTY_PARSING_EMAIL) return;
  await transporter.sendMail({
    from: `"${lead.name}" <${GMAIL_USER}>`,
    to: LOFTY_PARSING_EMAIL,
    replyTo: lead.email || undefined,
    subject: `New Lead: ${lead.name}`,
    text:
      `Name: ${lead.name}\n` +
      `Email: ${lead.email || ''}\n` +
      `Phone: ${lead.phone || ''}\n` +
      `Address: ${lead.address || ''}\n` +
      `Source: RelaunchMyListing.com\n`
  });
}

async function emailLead(lead) {
  if (!EMAIL_ENABLED) {
    console.warn('[lead] EMAIL SKIPPED — GMAIL_APP_PASSWORD not set in environment.');
    return false;
  }
  let ok = false;
  try { await sendAlert(lead);   console.log('[lead] ALERT SENT to', LEAD_TO); ok = true; }
  catch (err) { console.error('[lead] ALERT FAILED:', err.message); }

  try { await sendToLofty(lead); console.log('[lead] LOFTY SENT to', LOFTY_PARSING_EMAIL); ok = true; }
  catch (err) { console.error('[lead] LOFTY FAILED:', err.message); }

  return ok;
}

/* ---------- middleware ---------- */
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- routes ---------- */
app.post('/api/lead', async (req, res) => {
  const name    = (req.body.name    || '').toString().trim();
  const phone   = (req.body.phone   || '').toString().trim();
  const email   = (req.body.email   || '').toString().trim();
  const address = (req.body.address || '').toString().trim();

  if (!name || !phone) {
    return res.status(400).json({ ok: false, error: 'Please include your name and mobile number.' });
  }

  const lead = {
    name, phone, email, address,
    time: new Date().toISOString(),
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim()
  };

  const saved  = saveToDisk(lead);
  const mailed = await emailLead(lead);

  if (saved || mailed) {
    console.log(`[lead] CAPTURED — file:${saved} email:${mailed} — ${name} / ${phone}`);
    return res.json({ ok: true, redirect: '/book' });
  }

  console.error('[lead] LOST — neither file nor email worked:', name, phone);
  return res.status(500).json({ ok: false, error: 'Something broke on our end. Text me directly and I\'ll get you scheduled.' });
});

app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    emailConfigured: EMAIL_ENABLED,
    sendVia: EMAIL_ENABLED ? 'gmail' : null,
    gmailUser: GMAIL_USER,
    leadTo: LEAD_TO,
    loftyParsingEmail: LOFTY_PARSING_EMAIL
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
    console.log(`Email: ON (Gmail ${GMAIL_USER})`);
    console.log(`  Alert -> ${LEAD_TO}`);
    console.log(`  Lofty -> ${LOFTY_PARSING_EMAIL}`);
  } else {
    console.log('Email: OFF — set GMAIL_APP_PASSWORD to turn it on.');
    console.log('  >> This is the #1 reason leads/emails go missing. <<');
  }
  console.log('========================================');
});
