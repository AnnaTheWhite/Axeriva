# Axeriva — HTTP Security (K2.2)

A backend API HTTP-biztonsági fejléc-rétege: Helmet + Content-Security-
Policy + kiegészítő fejlécek, központilag a
[server/src/middleware/httpSecurity.ts](../server/src/middleware/httpSecurity.ts)-ben,
környezet-függő módon. Bekötés: [index.ts](../server/src/index.ts) (globális,
a routing előtt). Kapcsolódó: [runtime.md](runtime.md),
[security-assessment-authentication.md](security-assessment-authentication.md)
(H2 kockázat).

> **Fontos hatókör-tisztázás.** Ez a réteg a **backend API saját válaszait**
> hardeníti (JSON + `/uploads` fájlok). Az API **nem szolgál ki HTML-t**,
> így az assessmentben azonosított **H2 (XSS → JWT-lopás a localStorage-ból)**
> a **frontend dokumentumon** él, amit ez a szerver nem szolgál ki. A H2
> teljes lezárásához a **frontend statikus site CSP-jét** is be kell
> állítani a hosting rétegen — lásd „Frontend dokumentum CSP" lent. A
> backend-réteg szükséges védelmi mélység és az `/uploads` fájlokat
> közvetlenül védi, de önmagában nem elég a H2-höz.

## Helmet-konfiguráció

Helmet v8, `helmet(...)` egyetlen hívással. A módosított/kiemelt opciók:

| Opció | Beállítás | Indok |
|---|---|---|
| `contentSecurityPolicy` | egyedi, env-függő (lásd lent) | az API-hoz szabott szigorú/laza CSP |
| `strictTransportSecurity` | prod: `max-age=31536000; includeSubDomains; preload`; dev: **kikapcsolva** | HSTS localhoston footgun (minden lokális portot HTTPS-re kényszerít) |
| `referrerPolicy` | `strict-origin-when-cross-origin` | ne szivárogjon API-útvonal (id-k) harmadik félnek |
| `crossOriginOpenerPolicy` | `same-origin` | böngészési kontextus izolálása |
| `crossOriginResourcePolicy` | globális `same-origin`; `/uploads` **override** `cross-origin` | a JSON-t CORS védi (CORP-ra nincs szükség); az attachment-képeket a frontend cross-origin embedeli |
| `crossOriginEmbedderPolicy` | **kikapcsolva** (Helmet default) | COEP minden subresource CORP/CORS opt-in-jét követelné; JSON API-nak nincs haszna, törés-kockázat |
| `frameguard` | `DENY` | az API-t sosem framezik (a CSP `frame-ancestors 'none'` a modern megfelelője; mindkettő megy régi böngészőkért) |
| `xContentTypeOptions` | `nosniff` (default) | kritikus az `/uploads`-nál: fájl ne értelmeződhessen HTML/script-ként |
| `xPoweredBy` | eltávolítva | fingerprinting-higiénia (az index.ts is letiltja) |

A **Permissions-Policy**-t Helmet v8 nem küldi; külön middleware állítja:
`geolocation=(), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()`
— minden erős böngésző-funkció letiltva, mert az API/uploads egyiket sem
használja.

## Content-Security-Policy

Az API nem ad vissza HTML-t és nem futtat inline scriptet, ezért a szigorú
CSP nem tör el semmit — tiszta defense-in-depth, és közvetlenül szabályozza
az `/uploads` betöltését.

### Production (strict)
```
default-src 'self'; script-src 'self'; style-src 'self';
img-src 'self' data:; connect-src 'self'; font-src 'self';
object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'; upgrade-insecure-requests
```
- **Nincs `unsafe-inline`, nincs `unsafe-eval`.**
- `upgrade-insecure-requests`: production HTTPS end-to-end (Render).

### Development (relaxed)
```
default-src 'self'; script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src 'self' <APP_URL> ws: wss:; font-src 'self' data:;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```
- `'unsafe-inline'` és `ws:`/`wss:` a Vite dev tooling/HMR súrlódásmentességéért.
- **Nincs `upgrade-insecure-requests`** (localhost HTTP).

### Engedélyezett források indoklása (prod)
| Direktíva | Érték | Miért |
|---|---|---|
| default/script/style/connect/font | `'self'` | az API magához képest same-origin; nem embedel, nem futtat inline scriptet |
| img-src | `'self' data:` | az `/uploads` képek + esetleges data-URI |
| object-src | `'none'` | nincs plugin/embed |
| base-uri, form-action | `'self'` | nincs HTML form, de a direktívák zárva |
| frame-ancestors | `'none'` | az API-t sosem framezik |

## Biztonsági fejlécek — összefoglaló (élő ellenőrzés)

| Fejléc | Dev | Prod |
|---|---|---|
| Content-Security-Policy | laza | strict |
| Strict-Transport-Security | — | `max-age=31536000; includeSubDomains; preload` |
| X-Content-Type-Options | `nosniff` | `nosniff` |
| X-Frame-Options | `DENY` | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` | ua. |
| Permissions-Policy | restriktív | ua. |
| Cross-Origin-Opener-Policy | `same-origin` | ua. |
| Cross-Origin-Resource-Policy | `same-origin` (uploads: `cross-origin`) | ua. |
| Cross-Origin-Embedder-Policy | — (tudatosan) | — |
| X-Powered-By | eltávolítva | eltávolítva |

## CORS (változatlan, Task 4)

A CORS-réteg (index.ts) érintetlen és nem gyengült: prod-ban csak az
`APP_URL` origin engedélyezett, metódusok `GET/POST/PUT/PATCH/DELETE`,
headerek `Content-Type`+`Authorization`, credentials kikapcsolva. A CORP
`same-origin` a JSON-választ **nem** töri, mert a cross-origin fetch-et a
CORS szabályozza, nem a CORP.

## Static assets (`/uploads`, Task 5)

- Fix, nem-futtatható MIME-készlet (jpg/png/pdf/docx/xlsx — az
  upload.middleware fehérlistája), véletlen UUID fájlnevek.
- `X-Content-Type-Options: nosniff` (globális) → nincs MIME-sniffing.
- `Cross-Origin-Resource-Policy: cross-origin` (csak itt) → a frontend
  embedelheti a képeket; másutt `same-origin` marad.
- `Cache-Control: max-age=1d` — a fájlok immutábilisak (új feltöltés = új
  UUID).
- Nincs directory listing; ismeretlen fájl a JSON 404-re esik.

## Frontend dokumentum CSP (deployment lépés — H2 lezárásához)

A backend nem szolgálja ki a frontend HTML-t, ezért a H2-t lezáró
dokumentum-CSP-t a **Render Static Site** fejléc-rétegén kell beállítani
(pl. `public/_headers` fájl vagy a Render dashboard/`render.yaml`). Ajánlott
kiindulás (a jelenlegi Vite-build inline stílusaihoz igazítandó):
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://<API_HOST>; connect-src 'self' https://<API_HOST>; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; upgrade-insecure-requests
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```
> Ez frontend-**kód**-módosítás nélküli hosting-konfiguráció; a K2.2 scope
> a backend-rétegre korlátozódott, ezért itt csak dokumentáljuk. A
> `style-src 'unsafe-inline'` szükségessége a Tailwind/Vite build inline
> stílusaitól függ — élesítés előtt böngésző-konzolból validálandó, és ha
> lehet, nonce/hash-alapúra szigorítandó.

## Development vs Production — összegzés

- **Dev:** nincs HSTS (localhost-footgun elkerülése), laza CSP (`unsafe-
  inline`, `ws:`), nincs `upgrade-insecure-requests`.
- **Prod:** HSTS 1 év + preload, strict CSP inline/eval nélkül, `upgrade-
  insecure-requests`. A kapcsoló a `config.isProduction` (`NODE_ENV`).

## Böngésző-kompatibilitás

Minden fejléc széles körben támogatott (Chrome/Edge/Firefox/Safari
aktuális). Ismeretlen direktívákat/fejléceket a böngészők figyelmen kívül
hagynak, így nincs törés. `X-Frame-Options` + `frame-ancestors` duplán megy
a régebbi kliensekért. HSTS `preload` a böngésző-preload-listához való
jelentkezéshez opcionális, de kompatibilis.

## Ismert korlátok

- **H2 nem zárul le teljesen a backend-rétegtől** — a frontend dokumentum
  CSP (fenti deployment lépés) és/vagy httpOnly cookie-alapú session kell a
  JWT-lopás útjának végleges elvágásához. A jelenlegi backend-hardening
  szükséges, de nem elégséges feltétel.
- A CSP az API-válaszokra hat; mivel az API nem ad HTML-t, a CSP fő
  gyakorlati haszna az `/uploads` és a defense-in-depth.
- COEP tudatosan kikapcsolva (nincs cross-origin isolation) — ha később
  `SharedArrayBuffer`/precíz timer kellene, külön mérlegelendő.
- HSTS `preload` csak akkor lép életbe, ha a domaint be is regisztrálják a
  preload-listára (opcionális).
