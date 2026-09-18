/**
 * server.js
 *
 * Backend-ul asistentului AI pentru MODULUL DIGITIZARE de pe
 * cursdebroderie.ro. Complet SEPARAT de backend-ul asistentului
 * modulului Broderie (assistent-ai/backend/server.js) — rulează ca
 * proces/serviciu propriu, cu propria bază de cunoștințe, propriile
 * secrete și propriul widget.
 *
 * Endpoint principal: POST /api/ask
 *   body: { question: string, sessionId?: string, history?: [{role,content}] }
 *   răspuns: { found: boolean, answer: string, lessonRefs: [{id,titlu,url?}] }
 *
 * Comportament:
 *  - Răspunde STRICT din Baza_de_cunostinte_Digitizare.md (vezi claudeClient.js).
 *  - Dacă nu găsește răspunsul (found=false), trimite un email către
 *    NOTIFY_EMAIL cu întrebarea nevalidată (vezi mailer.js).
 *  - Include mereu link-ul lecției relevante, dacă există, pentru aprofundare.
 *
 * Acces: acest asistent trebuie afișat DOAR pe paginile modulului
 * Digitizare (disponibile membrilor cu abonament activ Digitizare, Pro
 * sau Exclusiv) — vezi widget/digitizare-chat-widget.js și ghidul de
 * integrare WordPress din GHID_PREDARE_DEZVOLTATOR.md.
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { loadKnowledgeBase, buildContextBlob } = require('./knowledgeBase');
const { askAssistant } = require('./claudeClient');
const { sendUnansweredQuestionEmail, sendValidatedAnswerEmail } = require('./mailer');

const PORT = process.env.PORT || 3002; // port diferit de asistentul Broderie (3001) pentru rulare locală simultană
const KB_PATH = process.env.KB_PATH || path.join(__dirname, '..', '..', 'Baza_de_cunostinte_Digitizare.md');
// Secret partajat cu widgetul — blochează apelurile directe la API făcute
// de oricine în afara widgetului afișat doar membrilor cu acces activ la
// modulul Digitizare/Pro/Exclusiv. Vezi README.md pentru detalii.
const WIDGET_SHARED_SECRET = process.env.WIDGET_SHARED_SECRET || '';
// Secret separat, DOAR pentru rute de administrare — NU e expus niciodată public.
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || '';
// Webhook Google Apps Script — logare opțională, identic ca mecanism cu
// asistentul Broderie (poate scrie într-un Sheet separat sau într-un tab
// separat al aceluiași Sheet, la alegerea ta).
const SHEET_LOG_WEBHOOK_URL = process.env.SHEET_LOG_WEBHOOK_URL || '';
const SHEET_LOG_TOKEN = process.env.SHEET_LOG_TOKEN || '';

function logQuestionToSheet({ question, found, userEmail, sessionId, lessonRefs }) {
  if (!SHEET_LOG_WEBHOOK_URL || !SHEET_LOG_TOKEN) return;
  fetch(SHEET_LOG_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      token: SHEET_LOG_TOKEN,
      source: 'digitizare',
      timestamp: new Date().toISOString(),
      question,
      found,
      userEmail: userEmail || '',
      sessionId: sessionId || '',
      lessonRefs: lessonRefs || [],
    }),
  }).catch((err) => console.error('[sheet-log] Eroare la logare:', err.message));
}

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '200kb' }));

// --- Încărcarea bazei de cunoștințe la pornire (ținută în memorie) ---
let contextBlob = '';
let kbStats = { modules: 0, lessons: 0 };

function reloadKnowledgeBase() {
  const kb = loadKnowledgeBase(KB_PATH);
  contextBlob = buildContextBlob(kb);
  kbStats = { modules: kb.modules.length, lessons: kb.lessons.length };
  console.log(
    `[kb] Bază de cunoștințe Digitizare încărcată: ${kbStats.modules} module, ${kbStats.lessons} lecții, ~${Math.round(
      contextBlob.length / 4
    )} tokeni estimați.`
  );
}

reloadKnowledgeBase();

// --- Rate limiting simplu, în memorie (protecție cost API) ---
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '30', 10); // cereri
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '3600000', 10); // 1 oră
const requestLog = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

// --- Rute ---

app.get('/api/health', (req, res) => {
  res.json({ ok: true, module: 'digitizare', ...kbStats });
});

// Permite reîncărcarea bazei de cunoștințe fără restart (după ce se
// actualizează manual Baza_de_cunostinte_Digitizare.md).
app.post('/api/reload-kb', (req, res) => {
  try {
    reloadKnowledgeBase();
    res.json({ ok: true, ...kbStats });
  } catch (err) {
    console.error('[kb] Eroare la reîncărcare:', err);
    res.status(500).json({ ok: false, error: 'Nu am putut reîncărca baza de cunoștințe.' });
  }
});

app.post('/api/ask', async (req, res) => {
  // Cere secretul partajat, dacă e configurat — respinge apelurile directe
  // la API care nu vin din widgetul afișat pe pagini restricționate
  // membrilor cu acces Digitizare/Pro/Exclusiv.
  if (WIDGET_SHARED_SECRET && req.headers['x-widget-secret'] !== WIDGET_SHARED_SECRET) {
    return res.status(401).json({ error: 'Acces neautorizat.' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Prea multe întrebări într-un timp scurt. Încearcă din nou mai târziu.' });
  }

  const { question, sessionId, history, userEmail } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Câmpul "question" este obligatoriu.' });
  }
  if (question.length > 2000) {
    return res.status(400).json({ error: 'Întrebarea este prea lungă.' });
  }

  try {
    const result = await askAssistant(question.trim(), contextBlob, Array.isArray(history) ? history.slice(-6) : []);

    logQuestionToSheet({
      question: question.trim(),
      found: result.found,
      userEmail: typeof userEmail === 'string' ? userEmail.trim() : '',
      sessionId,
      lessonRefs: result.lesson_refs,
    });

    if (!result.found) {
      sendUnansweredQuestionEmail({
        question: question.trim(),
        sessionId,
        lessonRefs: result.lesson_refs,
        userEmail: typeof userEmail === 'string' ? userEmail.trim() : '',
      }).catch((err) => console.error('[mailer] Eroare la trimiterea email-ului:', err.message));
    }

    res.json({
      found: result.found,
      answer: result.answer,
      lessonRefs: result.lesson_refs,
    });
  } catch (err) {
    console.error('[api/ask] Eroare:', err);
    res.status(500).json({
      error: 'A apărut o eroare la procesarea întrebării. Încearcă din nou în câteva momente.',
    });
  }
});

// Rută de administrare — trimite răspunsul validat direct pe email
// cursantului. Apelată manual (de Constantin/dezvoltator), NU de widget.
app.post('/api/send-validated-answer', async (req, res) => {
  if (!ADMIN_API_SECRET || req.headers['x-admin-secret'] !== ADMIN_API_SECRET) {
    return res.status(401).json({ error: 'Acces neautorizat.' });
  }

  const { toEmail, question, answer, lessonUrl } = req.body || {};

  if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
    return res.status(400).json({ error: 'Câmpul "toEmail" trebuie să fie o adresă de email validă.' });
  }
  if (!question || !answer) {
    return res.status(400).json({ error: 'Câmpurile "question" și "answer" sunt obligatorii.' });
  }

  try {
    await sendValidatedAnswerEmail({
      toEmail: toEmail.trim(),
      question: question.trim(),
      answer: answer.trim(),
      lessonUrl: typeof lessonUrl === 'string' ? lessonUrl.trim() : '',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/send-validated-answer] Eroare:', err);
    res.status(500).json({ error: 'Nu am putut trimite email-ul cu răspunsul validat.' });
  }
});

// Servește widgetul direct de pe backend, pentru un embed simplu în
// WordPress: <script src="https://<domeniul-tau-backend-digitizare>/widget.js"></script>
app.use('/widget.js', express.static(path.join(__dirname, '..', 'widget', 'digitizare-chat-widget.js')));

app.listen(PORT, () => {
  console.log(`[server] Asistent modul Digitizare ascultă pe portul ${PORT}`);
});
