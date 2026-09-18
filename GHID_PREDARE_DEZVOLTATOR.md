# Ghid de predare — Asistent AI Modul Digitizare (cursdebroderie.ro)

Acest document e destinat dezvoltatorului care va prelua configurarea, deploy-ul și integrarea în WordPress a asistentului modulului **Digitizare**. Codul e deja scris și funcțional; rămân de făcut pași de configurare/infrastructură (chei API, hosting, DNS/embed) **plus o verificare importantă de restricționare pe abonament**, detaliată la secțiunea 7.

## 1. Ce este acest proiect

Un asistent de chat, **separat de cel al modulului Broderie deja livrat**, pentru cursanții cu abonament activ **Digitizare, Pro sau Exclusiv**, care:

- răspunde la întrebările cursanților **strict din conținutul modulului Digitizare** (31 lecții, 3 module: Funcțiile de bază ale softului / Realizare modele / Funcții speciale ale softului);
- când nu găsește un răspuns clar, afișează „nu știu, revin" și **trimite automat un email** către proprietarul cursului cu întrebarea;
- indică mereu, când e cazul, **link-ul lecției relevante** de pe platformă pentru aprofundare.

**De ce e un proiect separat și nu o extindere a asistentului Broderie:** Constantin a cerut explicit ca acest asistent să fie distinct, pentru că audiența e diferită (doar membrii cu Digitizare/Pro/Exclusiv, nu toți cursanții Broderie) și conținutul e diferit (soft de digitizare, nu operarea mașinii de brodat). Cele două rulează ca servicii Node.js complet independente, cu widget-uri, secrete și (opțional) găzduire separate.

## 2. Arhitectură (pe scurt)

```
[Membru Digitizare/Pro/Exclusiv pe cursdebroderie.ro]
        |
        v
[Widget de chat Digitizare — digitizare-chat-widget.js, embeddat cu <script>]
        |  POST /api/ask  { question }
        v
[Backend Node.js/Express — găzduit separat, port implicit 3002]
        |
        |-- citește Baza_de_cunostinte_Digitizare.md la pornire (în memorie)
        |-- trimite întrebarea + toată baza de cunoștințe către Claude (Anthropic API)
        |-- Claude răspunde structurat: { found, answer, lesson_refs }
        |-- dacă found=false -> trimite email prin Resend (etichetat [Modul DIGITIZARE])
        v
[Răspuns JSON -> afișat în widget]
```

## 3. Structura fișierelor primite

```
assistent-digitizare/
├── README.md
├── GHID_PREDARE_DEZVOLTATOR.md        <- acest fișier
├── backend/
│   ├── server.js
│   ├── knowledgeBase.js               <- parsează Baza_de_cunostinte_Digitizare.md
│   ├── claudeClient.js
│   ├── mailer.js
│   ├── package.json
│   ├── lesson-urls.json               <- cele 31 de slug-uri ale lecțiilor Digitizare
│   └── .env.example
└── widget/
    └── digitizare-chat-widget.js
```

`Baza_de_cunostinte_Digitizare.md` se află în folderul principal al proiectului (`D:\claude marketing\asistent AI\Baza_de_cunostinte_Digitizare.md`) — trebuie copiat lângă backend la deploy (ca la pasul 6).

## 4. Ce trebuie să obții/creezi înainte de a începe

| Ce anume | De unde | Notă |
|---|---|---|
| Cheie API Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) | poate fi **aceeași** cheie ca la asistentul Broderie |
| Cont Resend (email) | [resend.com](https://resend.com) | poate fi **același** cont ca la asistentul Broderie |
| Cont pe un serviciu de hosting Node.js | ex. [render.com](https://render.com) | recomandare: serviciu **separat** de cel al asistentului Broderie, pentru izolare completă |
| Acces la WordPress (wp-admin sau FTP/theme editor) | cursdebroderie.ro | ai deja acces la control panel |

## 5. Pas cu pas: configurare locală

1. Deschide un terminal în folderul `backend/`.
2. `cp .env.example .env` și completează `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `NOTIFY_EMAIL`, `WIDGET_SHARED_SECRET`, `ADMIN_API_SECRET` (generează secrete noi, **diferite** de cele ale asistentului Broderie — vezi comanda în `.env.example`).
3. `npm install`
4. `npm start` — ar trebui să vezi:
   ```
   [kb] Bază de cunoștințe Digitizare încărcată: 3 module, 31 lecții, ~127.000 tokeni estimați.
   [server] Asistent modul Digitizare ascultă pe portul 3002
   ```
5. Testează:
   ```bash
   curl -X POST http://localhost:3002/api/ask \
     -H "Content-Type: application/json" \
     -H "X-Widget-Secret: <secretul tău>" \
     -d "{\"question\": \"Ce este underlay-ul?\"}"
   ```
   Ar trebui să primești `found: true` și o referință spre lecția 1.1.
6. Testează și „nu știu": o întrebare nelegată de digitizare (ex. „Cât e ceasul?") ar trebui să dea `found: false` și un email către `NOTIFY_EMAIL`.

## 6. Deploy online

Identic ca proces cu asistentul Broderie (vezi și `GHID_PREDARE_DEZVOLTATOR.md` din `assistent-ai/` pentru detalii pas-cu-pas Render.com) — **dar folosește un serviciu Render separat**, cu propriul URL (ex. `asistent-digitizare-xxxx.onrender.com`), ca să nu depindă unul de celălalt.

Nu uita: copiază `Baza_de_cunostinte_Digitizare.md` în interiorul folderului `backend/` înainte de deploy, și setează `KB_PATH=./Baza_de_cunostinte_Digitizare.md`.

## 7. Integrare în WordPress — DOAR pentru membri Digitizare/Pro/Exclusiv

Aici e partea care cere cea mai multă atenție din partea ta, pentru că restricția nu e doar "pe ce pagini apare widgetul" (ca la Broderie), ci și "cine are voie să vadă acele pagini" — cele două trebuie să coincidă.

### 7.1 Scoping pe URL (condiție necesară, dar poate nu suficientă singură)

La fel ca la asistentul Broderie, `backend/lesson-urls.json` conține cele 31 de URL-uri ale lecțiilor Digitizare. Snippet PHP analog (footer.php al temei active):

```php
<?php
$asistent_digitizare_lectii = array(
  '/realizarea-primului-model/', '/prelucrarea-imaginii/', '/cusatura-running-stitch/',
  // ... restul — vezi backend/lesson-urls.json (31 intrări) pentru lista completă
);

$asistent_digitizare_curent = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') . '/';
if (in_array($asistent_digitizare_curent, $asistent_digitizare_lectii, true)) :
?>
<script
  src="https://asistent-digitizare-xxxx.onrender.com/widget.js"
  data-api-url="https://asistent-digitizare-xxxx.onrender.com/api/ask"
  data-secret="<WIDGET_SHARED_SECRET>">
</script>
<?php endif; ?>
```

(Recomandare identică cu ghidul Broderie: citește `lesson-urls.json` direct cu `file_get_contents` + `json_decode`, nu copia manual lista, ca să rămână o singură sursă de adevăr.)

**Această condiție garantează DOAR că widgetul nu apare pe restul site-ului.** Nu garantează, prin ea însăși, că doar membrii Digitizare/Pro/Exclusiv văd widgetul — asta depinde de cum sunt restricționate ÎN PREZENT paginile respective.

### 7.2 Mecanismul de restricționare pe pagină — CONFIRMAT

Constantin a confirmat direct mecanismul: fiecare pagină de lecție are, în panoul lateral al editorului WordPress ("Atribute pagină"), o secțiune **"Solicitați calitatea de membru"** cu bife individuale — Broderie / Digitizare / Pro / Exclusiv. Pagina e vizibilă doar utilizatorilor care au cel puțin unul dintre nivelurile bifate; restul văd un ecran de tip "alege un abonament" în loc de conținut.

Pentru lecțiile modulului Digitizare, bifele corecte sunt **Digitizare + Pro + Exclusiv** (NU Broderie) — confirmat vizual pe pagina „Așezarea broderiei pe curbură la un felon preoțesc continuu" (lecția 2.18).

**Concluzie practică: scoping-ul pe URL de la 7.1 este suficient.** Pentru că fiecare din cele 31 de pagini din `lesson-urls.json` e deja restricționată la nivel de pagină prin această bifă, oricine ajunge să vadă efectiv pagina (și deci scriptul widgetului injectat pe ea) are deja unul dintre abonamentele Digitizare/Pro/Exclusiv. Nu e nevoie de o verificare PHP suplimentară pe nivel de membru — ar fi redundantă.

**Singurul lucru de verificat înainte de a merge live:** că toate cele 31 de pagini din `lesson-urls.json` au într-adevăr bifele Digitizare/Pro/Exclusiv setate corect (și nu, de exemplu, o pagină uitată nebifată sau bifată greșit doar pe Broderie). Cel mai simplu: verifică din wp-admin lista de pagini ale modulului Digitizare și confirmă bifele una câte una, sau cere-i lui Constantin să confirme că astea au fost setate la publicare (probabil da, din moment ce accesul deja funcționează corect pentru cursanți).

## 8. Verificare finală (checklist)

- [ ] `/api/health` răspunde cu `{"ok":true,"module":"digitizare","modules":3,"lessons":31}`
- [ ] O întrebare cu răspuns clar (ex. „Ce este underlay-ul?") primește un răspuns corect + link către lecția 1.1
- [ ] O întrebare fără legătură cu digitizarea primește „nu știu" + email către `NOTIFY_EMAIL`
- [ ] Widgetul (bulina **albastră**, distinctă de bulina maro a asistentului Broderie) apare doar pe cele 31 de pagini ale modulului Digitizare
- [ ] Confirmat că toate cele 31 de pagini din `lesson-urls.json` au bifele "Solicitați calitatea de membru" setate corect (Digitizare/Pro/Exclusiv, nu Broderie) — vezi 7.2
- [ ] CORS: `ALLOWED_ORIGIN` din `.env` conține exact `https://cursdebroderie.ro`

## 9. Costuri lunare estimate

| Componentă | Cost aproximativ |
|---|---|
| Claude API (Anthropic) | sub 40$/lună la câteva sute de întrebări/lună (bază de cunoștințe ~2x mai mare decât la Broderie) |
| Resend (email) | gratuit sub limita planului free |
| Hosting backend (Render, serviciu separat) | gratuit — ~7$/lună |

Detalii tehnice suplimentare sunt în `README.md` din același folder.
