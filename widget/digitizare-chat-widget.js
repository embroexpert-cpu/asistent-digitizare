/**
 * digitizare-chat-widget.js
 *
 * Widget de chat embeddabil pentru modulul DIGITIZARE de pe
 * cursdebroderie.ro. Fișier unic, fără dependențe externe.
 *
 * SEPARAT de widgetul modulului Broderie
 * (assistent-ai/widget/embroidery-chat-widget.js) — culoare, prefix CSS,
 * texte și endpoint API diferite, ca să nu existe nicio coliziune dacă,
 * din vreun motiv, ambele widgeturi ar ajunge vreodată pe aceeași pagină
 * (ex. un cursant cu acces la ambele module).
 *
 * Configurare (una din cele două variante):
 *
 *   <script src="https://<backend-ul-digitizare>/widget.js"
 *           data-api-url="https://<backend-ul-digitizare>/api/ask"
 *           data-secret="<WIDGET_SHARED_SECRET>"></script>
 *
 * sau:
 *
 *   <script>window.DigitizareAssistantConfig = { apiUrl: "https://.../api/ask", secret: "..." };</script>
 *   <script src="https://<backend-ul-digitizare>/widget.js"></script>
 *
 * IMPORTANT: acest script trebuie inclus DOAR pe paginile modulului
 * Digitizare (vezi lesson-urls.json + GHID_PREDARE_DEZVOLTATOR.md),
 * disponibile membrilor cu abonament activ Digitizare, Pro sau Exclusiv.
 */

(function () {
  'use strict';

  // --- Configurare ---
  var currentScript = document.currentScript;
  var config = window.DigitizareAssistantConfig || {};
  var API_URL =
    config.apiUrl ||
    (currentScript && currentScript.getAttribute('data-api-url')) ||
    '/api/ask';
  var SECRET =
    config.secret ||
    (currentScript && currentScript.getAttribute('data-secret')) ||
    '';
  var TITLE = config.title || 'Asistent Digitizare';
  var GREETING =
    config.greeting ||
    'Salut! Sunt asistentul modulului de digitizare. Întreabă-mă orice despre lecțiile de digitizare, softul de digitizare, cusături sau parametri.';
  var autoOpenAttr = currentScript && currentScript.getAttribute('data-auto-open');
  var AUTO_OPEN = config.autoOpen !== undefined ? config.autoOpen !== false : autoOpenAttr !== 'false';
  // Email-ul cursantului logat, injectat de functions.php — folosit doar
  // ca să putem trimite răspunsul validat direct pe email. Opțional.
  var USER_EMAIL =
    config.userEmail ||
    (currentScript && currentScript.getAttribute('data-user-email')) ||
    '';

  var PREFIX = 'dab'; // digitizare-assistant-bubble — prefix CSS distinct de "eab" (Broderie)

  // --- Stare ---
  var isOpen = false;
  var history = []; // [{role: 'user'|'assistant', content: string}]
  var sessionId =
    'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  var isSending = false;

  // --- CSS (albastru — distinct de maro-ul Broderie) ---
  var ACCENT = '#2a5f8a';
  var css =
    '.' + PREFIX + '-bubble{position:fixed;bottom:20px;right:20px;width:60px;height:60px;' +
    'border-radius:50%;background:' + ACCENT + ';color:#fff;display:flex;align-items:center;' +
    'justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);' +
    'z-index:999999;transition:transform .15s ease;border:none;}' +
    '.' + PREFIX + '-bubble:hover{transform:scale(1.06);}' +
    '.' + PREFIX + '-bubble svg{width:28px;height:28px;fill:#fff;}' +
    '.' + PREFIX + '-panel{position:fixed;bottom:92px;right:20px;width:340px;max-width:92vw;' +
    'height:480px;max-height:75vh;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);' +
    'display:flex;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,-apple-system,' +
    '"Segoe UI",Roboto,sans-serif;opacity:0;pointer-events:none;transform:translateY(10px);' +
    'transition:opacity .18s ease, transform .18s ease;}' +
    '.' + PREFIX + '-panel.open{opacity:1;pointer-events:auto;transform:translateY(0);}' +
    '.' + PREFIX + '-header{background:' + ACCENT + ';color:#fff;padding:14px 16px;font-weight:600;' +
    'display:flex;align-items:center;justify-content:space-between;font-size:15px;}' +
    '.' + PREFIX + '-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;' +
    'line-height:1;padding:0 4px;}' +
    '.' + PREFIX + '-messages{flex:1;overflow-y:auto;padding:14px;background:#f5f8fa;}' +
    '.' + PREFIX + '-msg{margin-bottom:12px;max-width:88%;line-height:1.4;font-size:14px;' +
    'padding:9px 12px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word;}' +
    '.' + PREFIX + '-msg.user{background:' + ACCENT + ';color:#fff;margin-left:auto;border-bottom-right-radius:2px;}' +
    '.' + PREFIX + '-msg.assistant{background:#fff;color:#2a2a2a;border:1px solid #dbe6ee;' +
    'margin-right:auto;border-bottom-left-radius:2px;}' +
    '.' + PREFIX + '-msg.assistant.pending{color:#999;font-style:italic;}' +
    '.' + PREFIX + '-refs{margin-top:8px;padding-top:8px;border-top:1px solid #eee;font-size:12.5px;}' +
    '.' + PREFIX + '-refs a{display:block;color:' + ACCENT + ';text-decoration:none;margin-top:4px;}' +
    '.' + PREFIX + '-refs a:hover{text-decoration:underline;}' +
    '.' + PREFIX + '-inputRow{display:flex;padding:10px;border-top:1px solid #eee;background:#fff;gap:8px;}' +
    '.' + PREFIX + '-input{flex:1;border:1px solid #ddd;border-radius:20px;padding:9px 14px;font-size:14px;' +
    'outline:none;}' +
    '.' + PREFIX + '-input:focus{border-color:' + ACCENT + ';}' +
    '.' + PREFIX + '-send{background:' + ACCENT + ';color:#fff;border:none;border-radius:50%;width:38px;height:38px;' +
    'cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}' +
    '.' + PREFIX + '-send:disabled{opacity:.5;cursor:default;}' +
    '.' + PREFIX + '-send svg{width:17px;height:17px;fill:#fff;}' +
    '@media (max-width:420px){.' + PREFIX + '-panel{right:10px;left:10px;width:auto;bottom:82px;}' +
    '.' + PREFIX + '-bubble{right:14px;bottom:14px;}}';

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --- Markup ---
  var bubble = document.createElement('button');
  bubble.className = PREFIX + '-bubble';
  bubble.setAttribute('aria-label', 'Deschide asistentul de digitizare');
  bubble.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  var panel = document.createElement('div');
  panel.className = PREFIX + '-panel';
  panel.innerHTML =
    '<div class="' + PREFIX + '-header">' +
    '<span>' + escapeHtml(TITLE) + '</span>' +
    '<button class="' + PREFIX + '-close" aria-label="Închide">×</button>' +
    '</div>' +
    '<div class="' + PREFIX + '-messages"></div>' +
    '<div class="' + PREFIX + '-inputRow">' +
    '<input class="' + PREFIX + '-input" type="text" placeholder="Scrie o întrebare..." />' +
    '<button class="' + PREFIX + '-send" aria-label="Trimite">' +
    '<svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>' +
    '</button>' +
    '</div>';

  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var messagesEl = panel.querySelector('.' + PREFIX + '-messages');
  var inputEl = panel.querySelector('.' + PREFIX + '-input');
  var sendBtn = panel.querySelector('.' + PREFIX + '-send');
  var closeBtn = panel.querySelector('.' + PREFIX + '-close');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addMessage(role, text, lessonRefs) {
    var el = document.createElement('div');
    el.className = PREFIX + '-msg ' + role;
    el.textContent = text;

    if (lessonRefs && lessonRefs.length) {
      var refsEl = document.createElement('div');
      refsEl.className = PREFIX + '-refs';
      refsEl.innerHTML =
        '<strong>Pentru aprofundare:</strong>' +
        lessonRefs
          .map(function (l) {
            var label = escapeHtml((l.id ? l.id + ' — ' : '') + (l.titlu || ''));
            if (l.url) {
              return '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">' + label + '</a>';
            }
            return '<span>' + label + '</span>';
          })
          .join('');
      el.appendChild(refsEl);
    }

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function togglePanel(open) {
    isOpen = typeof open === 'boolean' ? open : !isOpen;
    panel.classList.toggle('open', isOpen);
    if (isOpen && messagesEl.children.length === 0) {
      addMessage('assistant', GREETING, []);
    }
    if (isOpen) {
      setTimeout(function () {
        inputEl.focus();
      }, 150);
    }
  }

  bubble.addEventListener('click', function () {
    togglePanel();
  });
  closeBtn.addEventListener('click', function () {
    togglePanel(false);
  });

  async function sendQuestion() {
    var question = inputEl.value.trim();
    if (!question || isSending) return;

    isSending = true;
    sendBtn.disabled = true;
    inputEl.value = '';

    addMessage('user', question, []);
    var pendingEl = addMessage('assistant', 'Caut răspunsul...', []);
    pendingEl.classList.add('pending');

    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Widget-Secret': SECRET },
        body: JSON.stringify({
          question: question,
          sessionId: sessionId,
          userEmail: USER_EMAIL,
          history: history.slice(-6),
        }),
      });

      if (!res.ok) throw new Error('Răspuns HTTP ' + res.status);
      var data = await res.json();

      pendingEl.remove();
      addMessage('assistant', data.answer || 'Nu am primit un răspuns valid.', data.lessonRefs || []);

      history.push({ role: 'user', content: question });
      history.push({ role: 'assistant', content: data.answer || '' });
    } catch (err) {
      pendingEl.remove();
      addMessage(
        'assistant',
        'A apărut o problemă tehnică și nu am putut trimite întrebarea. Încearcă din nou în câteva momente.',
        []
      );
      console.error('[digitizare-chat-widget]', err);
    } finally {
      isSending = false;
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', sendQuestion);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendQuestion();
    }
  });

  // --- Deschidere automată ---
  if (AUTO_OPEN) {
    setTimeout(function () {
      togglePanel(true);
    }, 600);
  }
})();
