/**
 * knowledgeBase.js
 *
 * Parsează fișierul Baza_de_cunostinte_Digitizare.md într-o listă de
 * lecții structurate, și construiește contextul text trimis către Claude.
 *
 * Formatul sursă (Baza_de_cunostinte_Digitizare.md), diferit de formatul
 * folosit la asistentul modulului Broderie (asistent-ai/backend/knowledgeBase.js):
 *
 *   ## Modulul N. Titlu modul
 *
 *   ### Lecția N.N — Titlu lecție
 *   - **Modul:** N. Titlu modul
 *   - **URL lecție:** <url>
 *   - **Video YouTube:** <url1>, <url2>, ...
 *   - **Text platformă:** (niciunul — lecție video-only)
 *   - **Transcript video** (N cuvinte):
 *
 *   <text transcris, unul sau mai multe paragrafe>
 *
 * Nu există lecții cu text platformă real în modulul Digitizare — toate
 * sunt video-only (vezi nota din capul fișierului .md) — dar parserul
 * suportă oricum câmpul, pentru cazul în care se adaugă text ulterior.
 */

const fs = require('fs');
const path = require('path');

/**
 * Curăță valorile "placeholder" care nu trebuie trimise modelului
 * (ex. "(niciunul — lecție video-only)").
 */
function isEmptyValue(v) {
  if (!v) return true;
  const t = v.trim();
  if (t === '-' || t === '—' || t === '') return true;
  if (/^\(.*\)$/.test(t)) return true; // "(niciunul — lecție video-only)"
  return false;
}

/**
 * Parsează conținutul brut al fișierului md și întoarce:
 *  { modules: [{ number, title }],
 *    lessons: [{ modul, id, titlu, url, video, text, transcript, wordCount }] }
 */
function parseKnowledgeBase(mdContent) {
  const lines = mdContent.split(/\r?\n/);

  const modules = [];
  const lessons = [];

  let currentModuleNumber = null;
  let currentModuleTitle = null;
  let current = null;

  // "## Modulul 1. FUNCȚIILE DE BAZĂ ALE SOFTULUI"
  const moduleHeaderRe = /^##\s+Modulul\s+(\d+)\.\s*(.+)$/i;
  // "### Lecția 1.1 — Realizarea primului model"
  const lessonHeaderRe = /^###\s+Lecția\s+(\d+)\.(\d+)\s*—\s*(.+)$/i;
  // Câmpurile apar în două variante, ambele trebuie suportate:
  //   "- **Modul:** valoare"                    (colonul e ÎN INTERIORUL bold-ului)
  //   "- **Transcript video** (N cuvinte): text" (colonul e ÎN AFARA bold-ului, cu paranteză opțională)
  function parseFieldLine(line) {
    const m = line.match(/^-\s*\*\*(.+?)\*\*(.*)$/);
    if (!m) return null;
    let label = m[1].trim();
    let rest = m[2];

    // Paranteză opțională imediat după bold, ex. " (8665 cuvinte)"
    let paren = '';
    const parenMatch = rest.match(/^\s*\(([^)]*)\)/);
    if (parenMatch) {
      paren = parenMatch[1].trim();
      rest = rest.slice(parenMatch[0].length);
    }

    // Colonul poate fi la finalul label-ului (înăuntrul bold-ului) sau la
    // începutul lui "rest" (în afara bold-ului) — eliminăm oricare apare.
    if (label.endsWith(':')) label = label.slice(0, -1).trim();
    rest = rest.replace(/^\s*:\s*/, '');

    return { label: label.toLowerCase(), paren, value: rest.trim() };
  }

  function flushCurrent() {
    if (current) {
      current.transcript = (current.transcript || '').trim();
      lessons.push(current);
      current = null;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    if (/^-{3,}\s*$/.test(line.trim())) continue; // separator "---"

    const moduleMatch = line.match(moduleHeaderRe);
    if (moduleMatch) {
      flushCurrent();
      currentModuleNumber = parseInt(moduleMatch[1], 10);
      currentModuleTitle = moduleMatch[2].trim();
      modules.push({ number: currentModuleNumber, title: currentModuleTitle });
      continue;
    }

    const lessonMatch = line.match(lessonHeaderRe);
    if (lessonMatch) {
      flushCurrent();
      const numarModul = parseInt(lessonMatch[1], 10);
      const numarLectie = lessonMatch[2];
      current = {
        modul: currentModuleNumber != null ? currentModuleNumber : numarModul,
        moduleTitle: currentModuleTitle,
        id: `${numarModul}.${numarLectie}`,
        titlu: lessonMatch[3].trim(),
        url: null,
        video: null,
        text: null,
        transcript: '',
        wordCount: null,
      };
      continue;
    }

    if (!current) continue; // linie irelevantă (titlu fișier, notă generală, gol)

    const fieldMatch = parseFieldLine(line);
    if (fieldMatch) {
      const { label: key, paren, value } = fieldMatch;

      if (key === 'modul') {
        // deja avem modul/moduleTitle din headerul de secțiune; ignorăm duplicarea
      } else if (key === 'url lecție') {
        current.url = value;
      } else if (key === 'video youtube') {
        current.video = value;
      } else if (key === 'text platformă') {
        current.text = value;
      } else if (key.startsWith('transcript video')) {
        const wcMatch = paren.match(/(\d+)\s*cuvinte/i);
        if (wcMatch) current.wordCount = parseInt(wcMatch[1], 10);
        if (value) current.transcript += (current.transcript ? ' ' : '') + value;
      }
      continue;
    }

    // Linie de continuare — se atașează la transcript (singurul câmp
    // multi-linie din acest format; textul urmează după un rând gol,
    // ca paragraf simplu).
    if (line.trim().length > 0) {
      current.transcript += (current.transcript ? ' ' : '') + line.trim();
    }
  }
  flushCurrent();

  return { modules, lessons };
}

function loadKnowledgeBase(mdPath) {
  const absPath = path.resolve(mdPath);
  const raw = fs.readFileSync(absPath, 'utf-8');
  return parseKnowledgeBase(raw);
}

/**
 * Construiește blocul de context trimis modelului: o reprezentare
 * compactă, per lecție, cu doar informația utilă pentru a răspunde.
 */
function buildContextBlob({ modules, lessons }) {
  const byModule = new Map();
  for (const lesson of lessons) {
    if (!byModule.has(lesson.modul)) byModule.set(lesson.modul, []);
    byModule.get(lesson.modul).push(lesson);
  }

  const chunks = [];
  const sortedModules = [...modules].sort((a, b) => a.number - b.number);

  for (const modInfo of sortedModules) {
    const modNum = modInfo.number;
    const modLessons = byModule.get(modNum) || [];
    if (modLessons.length === 0) continue;

    chunks.push(`## MODUL ${modNum}: ${modInfo.title}`);

    for (const lesson of modLessons) {
      const lines = [`### Lecția ${lesson.id} — ${lesson.titlu}`];
      if (!isEmptyValue(lesson.url)) lines.push(`URL lecție: ${lesson.url}`);
      if (!isEmptyValue(lesson.video)) lines.push(`Video: ${lesson.video}`);
      if (!isEmptyValue(lesson.text)) lines.push(`Text platformă: ${lesson.text}`);
      if (!isEmptyValue(lesson.transcript)) lines.push(`Transcript video: ${lesson.transcript}`);
      chunks.push(lines.join('\n'));
    }
  }

  return chunks.join('\n\n');
}

module.exports = {
  parseKnowledgeBase,
  loadKnowledgeBase,
  buildContextBlob,
  isEmptyValue,
};
