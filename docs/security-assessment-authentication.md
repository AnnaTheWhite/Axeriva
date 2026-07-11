# Axeriva — Authentication Security Assessment (K2.1)

*Hatókör: az autentikációs modul (K2.1.1–K2.1.10). Verzió: `6b1a8c2`.
Dátum: 2026-07-11. Módszer: kód- és viselkedés-alapú felülvizsgálat élő
regressziós tesztekkel. Ez az értékelés funkcionalitást nem módosított
(nem került elő Critical lelet).*

Kapcsolódó: [security-authentication.md](security-authentication.md)
(implementációs részletek), [security-rate-limiting.md](security-rate-limiting.md).

---

## Part 1 — Implementált fejlesztések

### K2.1.2 — Session invalidation (`tokenVersion`)
- **Cél:** stateless JWT-k azonnali visszavonhatósága lejárat előtt.
- **Implementáció:** `User.tokenVersion` integer a JWT claimben; az auth
  middleware minden kérésnél a meglévő user-lookupban (plusz query nélkül)
  ellenőrzi. Jelszó-reset, fiók-törlés és a `POST /auth/logout` bumpolja.
- **Korlát:** userenként egyetlen verzió → minden session egyszerre hal
  meg, eszközönkénti szelektív visszavonás nincs.
- **Hatás:** lopott/kompromittált token élettartama a 7 napról a következő
  invalidáló eseményig csökken.

### K2.1.3 (+3a) — Rate limiting
- **Cél:** brute-force, tömeges regisztráció, e-mail-flooding megállítása.
- **Implementáció:** újrahasznosítható, dependency-mentes in-memory fix-
  ablakos limiter; login IP (20/15p) + IP+maszkolt-email (5/15p), register/
  forgot/reset/verify/invite külön limitekkel. `429` + `Retry-After`.
  `trust proxy: 1` production-ben (Render), a valós kliens-IP hitelesen.
- **Korlát:** process-lokális (restartkor nullázódik); megosztott IP-k
  összevonódnak; elosztott botnet ellen IP-kulcs önmagában gyenge.
- **Hatás:** online jelszó-találgatás és abuse gyakorlatilag kizárva.

### K2.1.4 — Hashed one-time tokens
- **Cél:** DB-szivárgás ne adjon működő reset/verify/invite linkeket.
- **Implementáció:** SHA-256 tárolás, lookup a hash-en; nyers token csak az
  e-mail linkjében. Entrópia és hossz változatlan.
- **Korlát:** deploy előtt kiadott linkek érvénytelenné válnak (migráció
  nem lehetséges, mert a nyers token nem ismert).
- **Hatás:** offline leak esetén a tárolt érték használhatatlan.

### K2.1.5 — Company activity enforcement
- **Cél:** tenant-offboarding után a cég tagjai ne férjenek hozzá.
- **Implementáció:** `Company.active` ellenőrzés a middleware nested
  selectjében (plusz query nélkül) + login/reset/verify/invite ágakon;
  DEVELOPER (cég nélkül) kivétel. Meglévő JWT-k azonnal érvénytelenek.
- **Korlát:** reaktiválási admin-flow nincs; Stripe-lejárat nem kapcsol
  `active`-ot (tudatos szétválasztás).
- **Hatás:** cég-szintű izoláció a fiók-életciklus végén is garantált.

### K2.1.6 — Password policy
- **Cél:** minimum-entrópia kikényszerítése új jelszavaknál.
- **Implementáció:** központi `validatePassword` (≥12, kis/nagy/szám,
  Unicode-tudatos, csak külső trim); register/reset/invite-accept.
- **Korlát:** nincs denylist (gyakori jelszavak), HIBP-check, max-hossz;
  meglévő gyenge jelszavak csak önkéntes cserénél frissülnek.
- **Hatás:** triviális jelszavak kizárva, offline törés drágul.

### K2.1.7 — Email validation
- **Cél:** formátum-validáció, normalizálás, duplikátum-konzisztencia.
- **Implementáció:** központi `validateEmail`/`normalizeEmail` (trim,
  domain-lowercase, local part érintetlen); register/login/forgot/invite.
- **Korlát:** kvótázott local part elutasítva; punycode-konverzió nincs;
  kézbesíthetőség nem ellenőrzött.
- **Hatás:** szemét/injection-jellegű címek és domain-case duplikátumok
  kiszűrve a legkorábbi ponton.

### K2.1.8 — Login timing protection
- **Cél:** válaszidő-alapú user enumeration megszüntetése a loginon.
- **Implementáció:** egyszer generált `DUMMY_PASSWORD_HASH`; ismeretlen
  e-mailnél is lefut a `bcrypt.compare`. Mért különbség: 0,20 ms.
- **Korlát:** a forgot-password enyhe timing-eltérése megmarad (rate limit
  miatt statisztikailag nem kiaknázható).
- **Hatás:** CWE-208 a loginon lezárva.

### K2.1.9 — Registration enumeration protection
- **Cél:** a regisztráció ne árulja el, mely címek regisztráltak.
- **Implementáció:** egységes generikus `201` új és létező címre; duplikátum
  nem hoz létre semmit, nem küld e-mailt, dummy `bcrypt.compare` a timing-
  egyezéshez (különbség 0,02 ms). Token nincs a válaszban.
- **Korlát:** UX-csere (nincs explicit „email already in use"); invite-
  accept 409-e megmarad (nem enumerálható, titkos token védi).
- **Hatás:** CWE-204 a regisztráción lezárva.

### K2.1.10 — Authentication audit logging
- **Cél:** biztonsági események konzisztens, gépi-parse-olható naplózása.
- **Implementáció:** központi `logAuthEvent`, 16 eseménytípus, strukturált
  JSON (INFO/WARN), maszkolt e-mail, `requestId`, titkok kizárva.
- **Korlát:** denial-események nincsenek rate-limitelve (log-flood vektor);
  tartós megőrzés a hosting/log-drain feladata.
- **Hatás:** A09 (logging) lefedve; incidens-detektálás és forenzika
  lehetővé válik.

---

## Part 2 — K2.1.1 audit-leletek státusza

| # | Lelet | Státusz | Indoklás |
|---|---|---|---|
| **C1** | Nincs brute-force védelem | **Resolved** | K2.1.3 rate limiting minden publikus auth-végponton |
| **C2** | Reset nem invalidál sessiont | **Resolved** | K2.1.2 `tokenVersion` bump reseten |
| **H1** | Logout csak kliensoldali | **Resolved** (backend) | K2.1.2 `POST /auth/logout` + bump; a frontend rákötése még hátravan (nem biztonsági rés, a token szerveroldalon már visszavonható) |
| **H2** | Token localStorage-ban | **Still Open** | XSS→token-lopás; CSP/Helmet (K2.2) és/vagy httpOnly cookie kell |
| **H3** | User enumeration (register/invite) | **Resolved** (register) / **Not Applicable** (invite-accept) | K2.1.9 register generikus válasz; invite-accept titkos tokennel védett, nem enumerálható |
| **H4** | Plaintext tokenek a DB-ben | **Resolved** | K2.1.4 SHA-256 tárolás |
| **H5** | Inaktív cég tagjai bent maradnak | **Resolved** | K2.1.5 company-active enforcement |
| **M1** | Nincs jelszó-policy | **Resolved** | K2.1.6 |
| **M2** | Login timing side-channel | **Resolved** (login) / **Partially** (forgot) | K2.1.8; forgot-password eltérése rate-limittel mérsékelve |
| **M3** | JWT 7 nap, nincs refresh | **Partially Resolved** | K2.1.2 visszavonhatóságot ad; role/company staleness legfeljebb 7 napig, refresh-stratégia nincs |
| **M4** | Nincs reset-értesítő; state-changing GET verify | **Still Open** | alacsony prioritás |
| **M5** | Invite-accept nem tranzakciós | **Still Open** | ritka versenyhelyzet (dupla Employee), low likelihood |
| **M6** | E-mail-verifikáció nem kikényszerített | **Still Open** | termékdöntés; a verifikáció létezik, de nincs funkcióhoz kötve |
| **L1** | bcrypt cost 10 | **Still Open** | elfogadható; 12 ajánlott |
| **L2** | JWT_SECRET nincs hossz-validálva | **Still Open** | csak üresség-ellenőrzés (K1 fail-fast) |
| **L3** | Nincs e-mail-formátum-validáció | **Resolved** | K2.1.7 |
| **L4** | Login nem nézi company.active | **Resolved** | K2.1.5 |
| **L5** | Ismételt meghívó-spam | **Partially Resolved** | invite-create authentikált BUSINESS_OWNER + plan-limit alatt; dedikált rate limit nincs |

**Összegzés:** 2/2 Critical és 4/5 High lezárva (H2 nyitva); a Medium/Low
zöme kezelve.

---

## Part 3 — OWASP Top 10 (2021) leképezés

| | Kategória | Fedettség | Megjegyzés |
|---|---|---|---|
| A01 | Broken Access Control | **Partially** | Company-izoláció (K2.1.5), session-invalidáció (K2.1.2), meglévő RBAC; objektum-szintű authz teljes körű audit külön feladat |
| A02 | Cryptographic Failures | **Covered** (auth) | bcrypt jelszó-hash, SHA-256 token-hash, HS256 JWT; TLS a platformé (Render) |
| A03 | Injection | **Partially** | E-mail-validáció (K2.1.7), Prisma paraméterezett query-k, log-injection-védelem (K2.1.10); teljes input-validációs réteg auth-on kívül nincs |
| A04 | Insecure Design | **Partially** | Központi policy-modulok, generikus válaszok, threat-modellezett flow-k, rate limiting |
| A05 | Security Misconfiguration | **Partially** | Config-validáció + fail-fast (K1.2), CORS, `x-powered-by` off; Helmet/CSP **hiányzik** (K2.2) |
| A06 | Vulnerable & Outdated Components | **Not Covered** | Dependency-scanning/SCA nincs beállítva (auth-on kívüli) |
| A07 | Identification & Authentication Failures | **Covered** | A modul fókusza: rate limit, jelszó-policy, session-invalidáció, timing/enumeration-védelem, secure token — ld. Part 5 |
| A08 | Software & Data Integrity Failures | **Partially** | JWT-aláírás-ellenőrzés, Stripe-webhook aláírás; supply-chain integritás nincs |
| A09 | Security Logging & Monitoring Failures | **Partially→Covered** (logging) | Strukturált auth audit (K2.1.10); alerting/monitoring külső |
| A10 | SSRF | **Not Applicable** | Az auth-modul nem kezdeményez kimenő kérést felhasználói input alapján |

---

## Part 4 — OWASP ASVS 4.0 leképezés (fő szekciók)

| Szekció | Becsült fedettség | Megjegyzés |
|---|---|---|
| **V2.1 Password Security** | Erős (L1) | ≥12 karakter, Unicode engedélyezett, csak külső trim; a kompozíciós szabály (kis/nagy/szám) az explicit követelmény, ASVS-nél nem preferált, de nem sértő; denylist (V2.1.7) hiányzik |
| **V2.2 General Authenticator** | Erős (L1) | Rate limiting (V2.2.1), információszivárgás-mentes hibák időzítéssel együtt (V2.2.2) |
| **V2.3 Authenticator Lifecycle** | Részleges | Meghívó-alapú aktiválás, verifikációs token; kezdeti-jelszó-kényszer nincs |
| **V2.5 Credential Recovery** | Erős (L1) | Hashelt, TTL-es, egyszer használatos reset-token; session-invalidáció; generikus válasz |
| **V2.7 Out-of-band Verifier** | N/A | E-mail-alapú verifikáció; MFA nincs |
| **V3.2 Session Binding** | Részleges | Stateless JWT + `tokenVersion` revokáció; 7 napos, nem sliding |
| **V3.3 Session Termination** | Részleges | Logout + reset/delete invalidál; per-device termináció nincs |
| **V4.1 Access Control Design** | Részleges | Company-izoláció + RBAC; teljes objektum-szintű authz nem auditált itt |
| **V7.1–7.2 Logging** | Erős (L1) | Strukturált audit, érzékeny adat kizárva, biztonsági események naplózva |

**Összesített becslés:** az autentikációs modul az **ASVS Level 1** auth-
kontrollok ~**70–75%**-át teljesíti; **Level 2** részlegesen (a session-
kötés, per-device termináció, MFA és denylist a fő hiányok).

---

## Part 5 — Threat Model

| Fenyegetés | Védelem | Reziduál |
|---|---|---|
| **Brute force** | Rate limit IP + IP+email; jelszó-policy; timing-uniformitás | Elosztott botnet mérsékelten (IP-kulcs); **Low** |
| **Credential stuffing** | Per-email rate limit; policy kizárja a gyenge/újrahasznált triviálisakat; audit-detektálás | MFA nincs → sikeres stuffing egy helyes párral átmegy; **Medium** |
| **Replay attacks** | Reset/verify/invite egyszer használatos (hashelt); JWT `tokenVersion` | Érvényes JWT a lejáratig replay-elhető, ha ellopták; **Medium** (ld. token theft) |
| **Timing attacks** | Login dummy-compare (0,20 ms); register dummy-compare (0,02 ms) | Forgot-password mikro-eltérés (rate-limitelt); **Low** |
| **User enumeration** | Login + register + forgot generikus válasz és időzítés | Válasz-alapon nincs; **Low** |
| **Token theft** | Rövidülő effektív élettartam (invalidáció); tokenek hashelve tárolva | **localStorage (H2)** → XSS esetén JWT lopható; CSP/Helmet hiányzik; **High** |
| **JWT abuse** | HS256 aláírás-ellenőrzés; `JWT_SECRET` induláskor kötelező; `tokenVersion` | Titok hossz-validáció nincs (L2); alg-confusion HS256-nál nem releváns; **Low** |
| **Company isolation** | `Company.active` minden auth-úton; `companyId`-scope | Reaktiváció/objektum-szintű authz teljes audit hiányzik; **Low–Medium** |
| **Password attacks** | bcrypt (cost 10); ≥12 policy | Cost 10 (12 ajánlott); denylist nincs; **Low** |
| **Email abuse** | Forgot/verify/invite rate limit; duplikátum-register nem küld e-mailt | Invite-create nincs külön limitelve (auth+plan mögött); **Low** |
| **Invitation abuse** | Titkos hashelt token; TTL; accept rate-limitelt; company-active | Accept nem tranzakciós (M5, ritka verseny); **Low** |

---

## Part 6 — Fennmaradó kockázatok

**Critical:** nincs.

**High**
- **H2 — Token localStorage-ban (XSS→token-lopás).** A legmagasabb nyitott
  kockázat. *Ajánlás:* K2.2 keretében Helmet + szigorú CSP; közép-távon
  httpOnly + `SameSite` cookie-alapú session CSRF-védelemmel, vagy rövidebb
  access token + refresh rotáció.

**Medium**
- **M3 — 7 napos JWT, nincs refresh.** Szerep/cég-változás legfeljebb 7 nap
  késéssel érvényesül; ellopott token a lejáratig él. *Ajánlás:* rövid
  access token (pl. 15 perc) + refresh token rotációval és per-device
  revokációval.
- **MFA hiánya.** Credential stuffing egy helyes párral átmegy. *Ajánlás:*
  legalább opcionális TOTP a BUSINESS_OWNER/DEVELOPER szerepekre.
- **M6 — verifikáció nem kikényszerített.** *Ajánlás:* érzékeny műveletek
  (számlázás, meghívás) `emailVerified`-hez kötése, ha nem tudatos döntés.

**Low**
- bcrypt cost 10 → 12 (L1); `JWT_SECRET` min-hossz-validáció (L2);
  reset-értesítő e-mail + state-changing GET verify (M4); invite-accept
  tranzakcióba (M5); invite-create dedikált rate limit (L5); audit denial-
  események log-flood-mérséklése; elosztott brute-force fiók-lockout/
  progressive delay.

---

## Part 7 — Authentication Readiness Score

### **82 / 100**

**Pontozás indoklása (súlyozott):**
- Brute-force & rate limiting — 18/20 (erős; elosztott mérséklés részleges)
- Session-kezelés & revokáció — 14/20 (revokáció megvan; refresh/per-device
  és a localStorage-tárolás hiányzik)
- Jelszó & credential biztonság — 16/20 (policy + bcrypt; denylist/MFA nincs)
- Információszivárgás (enum/timing) — 19/20 (login+register lezárva; forgot
  reziduál)
- Token & crypto biztonság — 15/20 (hashelt tokenek, aláírt JWT; XSS-
  kitettség és cost/secret-hardening nyitott)

A levont ~18 pont túlnyomó része a **token-tárolás (XSS)**, a **refresh-
stratégia** és az **MFA** hiányából ered — ezek a következő mérföldkövek.

---

## Part 8 — Ajánlás (érettségi szint)

| Szint | Alkalmas? | Indoklás |
|---|---|---|
| **Internal beta** | ✅ Igen | Az auth-felület robusztus; a nyitott kockázatok kontrollált, megbízható felhasználói körben elfogadhatók |
| **Closed beta** | ✅ Igen | Rate limiting, enumeration- és timing-védelem, session-revokáció, audit — a zárt beta követelményeit teljesíti |
| **Public beta** | ✅ Igen, feltétellel | **Előbb K2.2 (Helmet + CSP)** landoljon, hogy az XSS→token-lopás (H2) útja záruljon; TLS/HSTS a Render-en igazolva |
| **Production** | ⚠️ Feltételesen | K2.2 után igen; erősen ajánlott a refresh-stratégia és a bcrypt cost 12 is a széles kitettség előtt |
| **Enterprise** | ❌ Még nem | Hiányzik: MFA/SSO, refresh + per-device session, dependency-scanning (A06), külső monitoring/alerting, teljes objektum-szintű authz-audit |

**Következő mérföldkő (K2.2 — HTTP Security):** Helmet, Content-Security-
Policy, HSTS és a kapcsolódó fejlécek — ez zárja a jelenlegi legmagasabb
(High) reziduális kockázatot, és feltétele a nyilvános/production
kitettségnek.
