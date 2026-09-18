# Asistent AI — Modul Digitizare (cursdebroderie.ro)

Asistent care răspunde întrebărilor cursanților de la modulul **Digitizare** strict din conținutul acelui modul (`Baza_de_cunostinte_Digitizare.md`), spune „nu știu, revin" când nu găsește răspunsul, trimite un email cu întrebarea nevalidată, și indică mereu link-ul lecției relevante pentru aprofundare.

**Acest proiect e complet SEPARAT de `assistent-ai/` (asistentul modulului Broderie).** Rulează ca serviciu propriu, cu propria bază de cunoștințe, propriul widget și propriile secrete — nu partajează nimic la runtime cu asistentul Broderie, exact cum a cerut Constantin (fiecare modul are utilizatori diferiți: Digitizare/Pro/Exclusiv vs. Broderie).

Compus din două părți:

- `backend/` — server Node.js/Express care apelează Claude (Anthropic API) și trimite email-uri.
- `widget/` — widget de chat (un singur fișier JavaScript, `digitizare-chat-widget.js`), embeddabil în WordPress printr-un `<script>`.

## Cum funcționează

1. Utilizatorul scrie o întrebare în widget (bulina albastră, distinctă de bulina maro a asistentului Broderie).
2. Widgetul trimite întrebarea la backend-ul Digitizare (`POST /api/ask`).
3. Backend-ul trimite lui Claude Haiku 4.5 întreaga bază de cunoștințe a modulului Digitizare (31 lecții, 3 module) ca și context, cu instrucțiuni stricte: răspunde doar din conținutul dat, altfel marchează `found: false`.
4. Dacă `found: false`, backend-ul trimite automat un email către tine (`NOTIFY_EMAIL`) cu întrebarea, etichetat clar `[Modul DIGITIZARE]` ca să-l distingi de notificările asistentului Broderie.
5. Widgetul afișează răspunsul și, dacă există, link-ul către lecția relevantă ("Pentru aprofundare").

### De ce se trimite întreaga bază de cunoștințe, nu doar un fragment

`Baza_de_cunostinte_Digitizare.md` are în jur de 125-130.000 de tokeni (transcripturi video complete pentru 31 de lecții) — încape confortabil în fereastra de context a lui Claude (peste 200.000 de tokeni). Costul per întrebare e undeva la 0,10-0,13$ (aprox. dublu față de asistentul Broderie, pentru că baza e mai mare) — la câteva sute de întrebări pe lună, sub 40$ lunar.

## Configurare pas cu pas

### 1. Cheie API Anthropic + cont Resend

Poți refolosi **aceeași** cheie Anthropic și **același** cont Resend ca la asistentul Broderie — nu sunt limitate la un singur consumator. Diferă doar `WIDGET_SHARED_SECRET` și `ADMIN_API_SECRET`, care trebuie generate din nou, cu valori diferite de cele ale asistentului Broderie.

### 2. Configurare backend

```bash
cd backend
cp .env.example .env
# editează .env cu cheile tale (ANTHROPIC_API_KEY, RESEND_API_KEY, NOTIFY_EMAIL, WIDGET_SHARED_SECRET, ADMIN_API_SECRET)
npm install
npm start
```

Backend-ul pornește implicit pe portul **3002** (diferit de 3001, portul asistentului Broderie — poți rula ambele simultan local pentru testare). Testează rapid:

```bash
curl -X POST http://localhost:3002/api/ask \
  -H "Content-Type: application/json" \
  -H "X-Widget-Secret: <valoarea din .env>" \
  -d '{"question": "Ce este underlay-ul și de ce e important?"}'
```

### 3. Deploy backend

Identic cu asistentul Broderie: orice serviciu Node.js merge (recomandare: Render.com, plan gratuit/ieftin, **serviciu separat** de cel al asistentului Broderie). Copiază `Baza_de_cunostinte_Digitizare.md` în interiorul folderului `backend/` înainte de deploy și setează `KB_PATH=./Baza_de_cunostinte_Digitizare.md`.

### 4. Embed widget în WordPress — DOAR pe paginile modulului Digitizare

**Widgetul NU trebuie pus site-wide** și **NU trebuie amestecat cu widgetul Broderie**. Cod de embed:

```html
<script
  src="https://asistent-digitizare.onrender.com/widget.js"
  data-api-url="https://asistent-digitizare.onrender.com/api/ask"
  data-secret="<WIDGET_SHARED_SECRET din .env>">
</script>
```

Fișierul `backend/lesson-urls.json` conține cele 31 de URL-uri (slug-uri) ale lecțiilor modulului Digitizare, extrase din curriculum-ul live. Vezi `GHID_PREDARE_DEZVOLTATOR.md`, secțiunea 7, pentru snippet-ul PHP de condiționare **și pentru discuția despre restricționarea pe abonament (Digitizare/Pro/Exclusiv)**, care e punctul cel mai important de verificat cu dezvoltatorul înainte de a merge live.

## Actualizarea bazei de cunoștințe

- Repornești backend-ul (`npm start`), care reîncarcă automat fișierul la pornire, sau
- Apelezi `POST /api/reload-kb` (fără restart) după ce ai suprascris fișierul pe server.

## Limitări cunoscute

- Lecția 3.3 ("Funcția nod") are conținut combinat din 2 video-uri sursă — asistentul primește ambele transcripturi ca un singur bloc de context pentru acea lecție, deci poate răspunde la întrebări despre oricare dintre cele două subiecte (nodurile + de ce mașina nu ia ața de jos) sub aceeași referință de lecție.
- La fel ca la asistentul Broderie, nu există istoric persistent al conversațiilor — se pierde la refresh de pagină.
