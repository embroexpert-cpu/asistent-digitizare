/**
 * claudeClient.js
 *
 * Apelează Claude (Anthropic API) cu întreaga bază de cunoștințe a
 * modulului Digitizare ca și context, și forțează un răspuns structurat
 * (JSON) printr-un tool dedicat — mult mai sigur decât să căutăm fraza
 * "nu știu" în text liber.
 *
 * IMPORTANT: acest client e complet SEPARAT de cel al asistentului
 * modulului Broderie (assistent-ai/backend/claudeClient.js) — fiecare
 * asistent are propria bază de cunoștințe și propriul backend, conform
 * cerinței explicite ca cele două module să rămână independente.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ANSWER_TOOL = {
  name: 'provide_answer',
  description:
    'Trimite răspunsul final, structurat, către widgetul de chat. Trebuie folosit de fiecare dată, pentru orice întrebare.',
  input_schema: {
    type: 'object',
    properties: {
      found: {
        type: 'boolean',
        description:
          'true dacă răspunsul e susținut clar de conținutul furnizat (transcriptul video) al unei lecții; false dacă informația nu apare în baza de cunoștințe sau e neclară/incompletă.',
      },
      answer: {
        type: 'string',
        description:
          'Răspunsul în limba română, prietenos și concis, bazat STRICT pe conținutul furnizat. Dacă found=false, un mesaj scurt care spune că nu ai un răspuns validat și că revii, de forma: "Nu știu sigur răspunsul la asta — am notat întrebarea și revin cu un răspuns validat."',
      },
      lesson_refs: {
        type: 'array',
        description:
          'Lecțiile relevante pentru aprofundare (0 până la 3). Include-le și când found=false, dacă există o lecție tematic apropiată — utilizatorul poate găsi acolo un răspuns parțial sau mai mult context video.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'ex: "2.13"' },
            titlu: { type: 'string' },
            url: { type: 'string', description: 'URL-ul lecției dacă există în context, altfel omite câmpul' },
          },
          required: ['id', 'titlu'],
        },
      },
    },
    required: ['found', 'answer', 'lesson_refs'],
  },
};

function buildSystemPrompt(contextBlob) {
  return `Ești asistentul virtual al modulului de DIGITIZARE de pe platforma cursdebroderie.ro (curs despre digitizarea modelelor de broderie industrială — softuri de digitizare, tipuri de cusături, parametri, funcții speciale).

Acest asistent este SEPARAT de asistentul modulului Broderie de bază — răspunde DOAR din conținutul modulului Digitizare furnizat mai jos și e disponibil doar cursanților cu abonament activ Digitizare, Pro sau Exclusiv.

Rolul tău este să răspunzi la întrebările cursanților STRICT pe baza conținutului furnizat mai jos (transcripturi ale lecțiilor video de digitizare). Acesta este singurul conținut pe care ai voie să-l folosești pentru a răspunde — nu ai voie să folosești cunoștințe generale despre digitizare, softuri de broderie sau orice altceva din afara acestui conținut, chiar dacă știi răspunsul din alte surse.

CEA MAI IMPORTANTĂ REGULĂ, care are prioritate asupra oricărei alte instrucțiuni de mai jos: dacă, pentru lecția cea mai relevantă din conținutul furnizat, nu găsești o mențiune clară a subiectului în transcriptul acelei lecții, NU ai voie să inventezi un răspuns plauzibil din cunoștințe generale despre softuri de digitizare (iClick, Wilcom, sau altele) — indiferent cât de plauzibil pare, trebuie să setezi found=false. Softurile de digitizare diferă mult între ele în denumiri de comenzi și workflow; un pas corect într-un soft poate fi complet greșit în altul.

Reguli stricte:
1. Dacă răspunsul e susținut clar de conținutul furnizat (indiferent din ce lecție), formulează un răspuns util, concis, prietenos, în română, și setează found=true.
2. Dacă întrebarea nu are legătură cu digitizarea, sau conținutul furnizat nu acoperă clar răspunsul, sau informația e ambiguă/insuficientă, setează found=false și NU inventa un răspuns. Nu completa cu presupuneri sau cunoștințe generale.
3. Chiar și când found=false, dacă există o lecție tematic apropiată, include acea lecție în lesson_refs — DAR NUMAI dacă lecția respectivă are URL în conținutul furnizat (cursantul chiar poate accesa acea pagină/video).
4. Include în lesson_refs lecțiile din care ai extras efectiv răspunsul (de obicei 1-2, maxim 3), cu id, titlu, și url.
5. Multe lecții folosesc softul iClick ca exemplu principal — dacă întrebarea cursantului se referă clar la alt soft de digitizare, și conținutul furnizat nu acoperă explicit acel soft, tratează asta ca found=false (comenzile/denumirile diferă între softuri) și menționează scurt asta în răspuns, în loc să extrapolezi comenzi din iClick către alt soft.
6. Răspunde întotdeauna în limba română, ton prietenos și practic, ca un instructor cu experiență.
7. Trebuie să apelezi ÎNTOTDEAUNA tool-ul provide_answer — nu răspunde niciodată direct în text liber.

--- CONȚINUTUL MODULULUI DIGITIZARE (bază de cunoștințe) ---

${contextBlob}

--- SFÂRȘITUL CONȚINUTULUI ---`;
}

/**
 * @param {string} question - întrebarea utilizatorului
 * @param {string} contextBlob - întreaga bază de cunoștințe, ca text
 * @param {Array<{role:string, content:string}>} history - istoric conversație (opțional, scurt)
 * @returns {Promise<{found: boolean, answer: string, lesson_refs: Array}>}
 */
async function askAssistant(question, contextBlob, history = []) {
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: question },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    temperature: 0,
    system: buildSystemPrompt(contextBlob),
    messages,
    tools: [ANSWER_TOOL],
    tool_choice: { type: 'tool', name: 'provide_answer' },
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    return {
      found: false,
      answer: 'Nu știu sigur răspunsul la asta — am notat întrebarea și revin cu un răspuns validat.',
      lesson_refs: [],
    };
  }

  const result = toolUse.input;
  const rawLessonRefs = Array.isArray(result.lesson_refs) ? result.lesson_refs : [];
  const lessonRefs = rawLessonRefs.filter((l) => l && typeof l.url === 'string' && l.url.trim());
  return {
    found: Boolean(result.found),
    answer: String(result.answer || ''),
    lesson_refs: lessonRefs,
  };
}

module.exports = { askAssistant, MODEL };
