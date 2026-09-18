/**
 * mailer.js
 *
 * Trimite un email către Constantin (NOTIFY_EMAIL) de fiecare dată când
 * asistentul modulului Digitizare nu găsește un răspuns validat în baza
 * de cunoștințe, ca să poată răspunde manual și, eventual, extinde
 * conținutul modulului.
 *
 * Folosește Resend (API HTTP, https://resend.com) în loc de SMTP —
 * Render blochează traficul de ieșire pe porturile SMTP (25/465/587) pe
 * planurile gratuite. Identic ca mecanism cu mailer.js din assistent-ai
 * (modulul Broderie), doar cu subiecte/etichete distincte, ca să se
 * poată distinge ușor în inbox de la care asistent vine notificarea.
 *
 * Configurare (.env / Render):
 *   RESEND_API_KEY   - cheia API generată pe resend.com (poate fi
 *                      ACELAȘI cont Resend folosit și pentru asistentul
 *                      Broderie — Resend nu limitează la un singur "from")
 *   RESEND_FROM      - adresa "from" (implicit onboarding@resend.dev)
 *   NOTIFY_EMAIL     - adresa care primește notificările
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * @param {object} params
 * @param {string} params.question - întrebarea utilizatorului
 * @param {string} [params.sessionId] - id de sesiune widget, dacă există
 * @param {Array} [params.lessonRefs] - lecțiile pe care asistentul le-a sugerat oricum (dacă a găsit ceva apropiat)
 * @param {string} [params.userEmail] - email-ul cursantului logat, dacă platforma îl trimite
 */
async function sendUnansweredQuestionEmail({ question, sessionId, lessonRefs = [], userEmail = '' }) {
  const to = process.env.NOTIFY_EMAIL;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Asistent Digitizare <onboarding@resend.dev>';

  if (!to || !apiKey) {
    console.warn(
      '[mailer] Configurare email lipsă (RESEND_API_KEY / NOTIFY_EMAIL) — email-ul nu a fost trimis. Vezi .env.example.'
    );
    return { sent: false, reason: 'missing_config' };
  }

  const timestamp = new Date().toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });

  const lessonRefsHtml = lessonRefs.length
    ? `<p><strong>Lecții sugerate de asistent (posibil parțial relevante):</strong></p><ul>${lessonRefs
        .map((l) => `<li>${l.id} — ${l.titlu}${l.url ? ` (<a href="${l.url}">${l.url}</a>)` : ''}</li>`)
        .join('')}</ul>`
    : '';

  const html = `
    <p><strong>[Modul DIGITIZARE]</strong> Asistentul de pe cursdebroderie.ro nu a găsit un răspuns validat în baza de cunoștințe pentru întrebarea de mai jos.</p>
    <p><strong>Întrebare:</strong> ${escapeHtml(question)}</p>
    <p><strong>Data/ora:</strong> ${timestamp}</p>
    <p><strong>Email cursant:</strong> ${userEmail ? escapeHtml(userEmail) : 'nespecificat (cursantul nu era logat sau nu am putut prelua email-ul)'}</p>
    ${sessionId ? `<p><strong>Sesiune widget:</strong> ${escapeHtml(sessionId)}</p>` : ''}
    ${lessonRefsHtml}
    <p style="color:#666;font-size:12px;">Trimis automat de asistentul AI al modulului Digitizare (cursdebroderie.ro). Dacă răspunzi la această întrebare, folosește /api/send-validated-answer cu email-ul de mai sus ca să trimiți răspunsul direct cursantului.</p>
  `;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `[Asistent Digitizare] Întrebare nevalidată: ${truncate(question, 60)}`,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend a răspuns cu ${res.status}: ${errBody.slice(0, 300)}`);
  }

  return { sent: true };
}

/**
 * Trimite răspunsul validat de Constantin direct cursantului care a pus
 * întrebarea (folosit de ruta admin /api/send-validated-answer).
 *
 * @param {object} params
 * @param {string} params.toEmail - adresa cursantului
 * @param {string} params.question - întrebarea originală
 * @param {string} params.answer - răspunsul validat
 * @param {string} [params.lessonUrl] - URL-ul lecției relevante, dacă există
 */
async function sendValidatedAnswerEmail({ toEmail, question, answer, lessonUrl = '' }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Asistent Digitizare <onboarding@resend.dev>';

  if (!apiKey) {
    console.warn('[mailer] RESEND_API_KEY lipsă — nu pot trimite răspunsul validat. Vezi .env.example.');
    return { sent: false, reason: 'missing_config' };
  }

  const html = `
    <p>Bună,</p>
    <p>Ai întrebat asistentul modulului Digitizare:</p>
    <p style="background:#faf7f4;border-left:3px solid #2a5f8a;padding:8px 12px;">${escapeHtml(question)}</p>
    <p>Iată răspunsul validat:</p>
    <p>${escapeHtml(answer).replace(/\n/g, '<br>')}</p>
    ${lessonUrl ? `<p>Pentru aprofundare, poți revedea lecția aici: <a href="${escapeHtml(lessonUrl)}">${escapeHtml(lessonUrl)}</a></p>` : ''}
    <p style="color:#666;font-size:12px;">Trimis de echipa cursdebroderie.ro.</p>
  `;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject: `[Curs digitizare] Răspuns la întrebarea ta: ${truncate(question, 60)}`,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Resend a răspuns cu ${res.status}: ${errBody.slice(0, 300)}`);
  }

  return { sent: true };
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendUnansweredQuestionEmail, sendValidatedAnswerEmail };
