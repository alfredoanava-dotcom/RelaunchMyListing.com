/**
 * Relaunch My Listing — funnel server
 * Alfredo Nava | Real Broker × NVA Visuals
 *
 * Serves the opt-in funnel from /public and captures leads.
 * Run:  npm install && npm start
 */

require('dotenv').config();

const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------------------------------------------------------
   Middleware
--------------------------------------------------------------- */
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve everything in /public as static files.
// index.html is served automatically at "/".
app.use(
  express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],       // /book  ->  public/book.html
    maxAge: '1h'
  })
);

/* ---------------------------------------------------------------
   Friendly routes
--------------------------------------------------------------- */
app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'thank-you.html'));
});

app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ---------------------------------------------------------------
   Lead capture
   The opt-in form POSTs here before redirecting to the booking page.
--------------------------------------------------------------- */
const LEADS_FILE = path.join(__dirname, 'leads.jsonl');

app.post('/api/lead', async (req, res) => {
  const { name, phone, email, address } = req.body || {};

  if (!name || !phone || !email || !address) {
    return res.status(400).json({ ok: false, error: 'Missing required fields.' });
  }

  const lead = {
    name: String(name).trim(),
    phone: String(phone).trim(),
    email: String(email).trim(),
    address: String(address).trim(),
    source: 'relaunch-funnel',
    receivedAt: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  };

  // 1. Always write to disk first so a lead is never lost if email fails.
  try {
    fs.appendFileSync(LEADS_FILE, JSON.stringify(lead) + '\n');
  } catch (err) {
    console.error('Failed to write lead to disk:', err.message);
  }

  // 2. Email alert to you + your Lofty CRM parsing address.
  //    Configure SMTP in .env (see README notes at bottom of this file).
  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 465),
        secure: Number(process.env.SMTP_PORT || 465) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });

      await transporter.sendMail({
        from: `"Relaunch Funnel" <${process.env.SMTP_USER}>`,
        to: process.env.LEAD_TO,          // e.g. "you@email.com, leads@lofty-parse-address"
        replyTo: lead.email,
        subject: `New Relaunch Kit lead: ${lead.name} — ${lead.address}`,
        text:
          `New lead from the Relaunch funnel\n\n` +
          `Name:     ${lead.name}\n` +
          `Phone:    ${lead.phone}\n` +
          `Email:    ${lead.email}\n` +
          `Property: ${lead.address}\n` +
          `Time:     ${lead.receivedAt}\n\n` +
          `They are now on the booking page. If no booking comes through ` +
          `within an hour, call them.\n`
      });
    } catch (err) {
      console.error('Lead email failed:', err.message);
      // Still return success — the lead is saved on disk.
    }
  }

  console.log(`[LEAD] ${lead.name} | ${lead.phone} | ${lead.address}`);
  res.json({ ok: true, redirect: '/book' });
});

/* ---------------------------------------------------------------
   404
--------------------------------------------------------------- */
app.use((req, res) => {
  res.status(404).send(
    '<h1 style="font-family:system-ui;padding:40px">Page not found</h1>' +
    '<p style="font-family:system-ui;padding:0 40px">' +
    '<a href="/">Back to the Relaunch Kit</a></p>'
  );
});

app.listen(PORT, () => {
  console.log(`Relaunch funnel running on http://localhost:${PORT}`);
});

/* ---------------------------------------------------------------
   .env example (create a file named ".env" next to this one):

   PORT=3000
   SMTP_HOST=smtp.hostinger.com
   SMTP_PORT=465
   SMTP_USER=alfredo@yourdomain.com
   SMTP_PASS=your_mailbox_password
   LEAD_TO=alfredo@yourdomain.com,your-lofty-parse-address@lofty.com

   Add .env and leads.jsonl to .gitignore before pushing to GitHub.
--------------------------------------------------------------- */
