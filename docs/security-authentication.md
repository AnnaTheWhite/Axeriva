# Axeriva — Authentication Security

Az autentikáció biztonsági mechanizmusai. Kapcsolódó dokumentumok:
[runtime.md](runtime.md) (hibakezelés, CORS), [environment.md](environment.md)
(JWT_SECRET és társai).

## Áttekintés

- Stateless JWT (HS256, `JWT_SECRET`-tel aláírva, 7 nap lejárat), `Bearer`
  headerben.
- A tokent három hely állítja ki, mind a közös
  [server/src/utils/authToken.ts](../server/src/utils/authToken.ts)
  `signAuthToken()`-jén keresztül: regisztráció, login, meghívó-elfogadás.
- Claim-ek: `userId`, `companyId`, `role`, `employeeId`, **`tokenVersion`**.

## tokenVersion — szerveroldali session-invalidáció (K2.1.2)

A tisztán stateless JWT gyengéje, hogy kiállítás után a lejáratig
visszavonhatatlan. Ezt a `User.tokenVersion` mező (integer, default `0`)
oldja fel:

1. Minden kiállított JWT magával viszi a user **aktuális**
   `tokenVersion`-jét.
2. Az [auth.middleware.ts](../server/src/middleware/auth.middleware.ts)
   minden kérésnél összeveti a token claimjét a DB-beli értékkel — a
   middleware **meglévő** user-lekérdezését bővítve (a soft-delete `active`
   check már kérésekként olvasta a User sort), tehát **plusz DB-query
   nélkül**.
3. Ha nem egyezik, a válasz ugyanaz a generikus
   `401 "Invalid or expired token"`, mint bármely más auth-hibánál — a
   kívülálló nem tudja megkülönböztetni a lejárt, hamis, visszavont vagy
   törölt-fiókos tokent.

A `tokenVersion` **inkrementálása tehát azonnal megöli a user összes
kint lévő sessionjét**. Ez történik:

| Esemény | Hely | Miért |
|---|---|---|
| Jelszó-reset | [auth.routes.ts](../server/src/routes/auth.routes.ts) `POST /auth/reset-password/:token` | aki az e-mail felett diszponál, azé a fiók — egy esetleges támadó korábban szerzett tokenje a következő kérésénél meghal |
| Fiók-törlés | [account.routes.ts](../server/src/routes/account.routes.ts) `POST /account/delete` | defence in depth — az `active: false` check önmagában is blokkol, a verzió-bump akkor is öl, ha az valaha változna |
| Szerveroldali logout | `POST /auth/logout` (új) | "kijelentkezés mindenhonnan" / jövőbeli admin forced-logout alapja |

**Trade-off (szándékos):** egyetlen integer userenként = minden session
egyszerre hal meg, eszközönkénti szelektív visszavonás nincs. Cserébe nincs
session-tábla, nincs denylist, nincs plusz lekérdezés.

### Visszafelé kompatibilitás

A K2.1.2 előtt kiállított tokenekben nincs `tokenVersion` claim — a
middleware ezt `0`-nak tekinti, ami a séma-default, így a meglévő sessionök
a deploy után is működnek, egészen a user első verzió-bumpjáig.

## Jelszó-reset folyamat (teljes)

1. `POST /auth/forgot-password` — mindig ugyanazt a generikus választ adja
   (user enumeration ellen); inaktív (soft-deletelt) fiókra nem generál
   tokent. A token: 32 bájt `crypto.randomBytes`, 1 óra TTL, userenként
   mindig csak a legutolsó érvényes.
2. E-mailben megy a `APP_URL/reset-password/<token>` link.
3. `POST /auth/reset-password/:token` — lejárt/ismeretlen/inaktív esetben
   generikus hiba. Sikernél: új bcrypt-hash, a reset-token törlődik
   (egyszer használatos), **és a `tokenVersion` inkrementálódik** — minden
   korábbi JWT azonnal érvénytelen.
4. A user az új jelszóval lép be, friss (új verziójú) tokent kap.

## Logout

- **Frontend (jelenleg):** localStorage-törlés (kliensoldali logout) —
  változatlan.
- **Backend:** `POST /auth/logout` (auth szükséges) bumpolja a
  `tokenVersion`-t — minden eszközön kijelentkeztet. A frontend rákötése
  későbbi feladat; az API-oldal kész.

## Secure Token Storage — hash-elt egyszer használatos tokenek (K2.1.4)

A jelszó-reset, e-mail-verifikációs és meghívó-tokenek a DB-ben **kizárólag
SHA-256 hash-ként** tárolódnak
([server/src/utils/tokenHash.ts](../server/src/utils/tokenHash.ts)). A nyers
token egyetlen helyen létezik: a kiküldött e-mail linkjében (meghívónál
emellett a létrehozó API-válasz `inviteLink`/`token` mezőjében, ahogy
eddig is — az e-mail-sablonok és a linkek változatlanok).

**Miért:** egy adatbázis-szivárgás (backup, SQL-injection, elhagyott
DB-fájl) korábban működő reset-/meghívó-linkeket adott volna a támadó
kezébe — a reset-token önmagában fiók-átvételt ér. A hash-elt tárolással a
kiszivárgott érték használhatatlan: a végpontok a *nyers* tokent várják, és
a SHA-256 preimage-ellenállása miatt a hash-ből nem állítható elő.

**Lookup:** a linkben érkező tokent a szerver hash-eli, és a hash-re keres
a meglévő unique-indexelt oszlopban — plaintext-összehasonlítás sehol nincs.
A mellékhatás-mentes tulajdonságok (egyszer használatosság, lejárat,
replay-védelem) változatlanok: sikeres felhasználáskor a hash törlődik /
`acceptedAt` beáll, a TTL-ellenőrzések érintetlenek.

**Miért sima SHA-256, nem bcrypt:** a tokenek 192–256 bit
`crypto.randomBytes` entrópiájúak (a generálás változatlan) — brute force és
rainbow table értelmezhetetlen, a gyors hash pedig megtartja az indexelt
lookupot. A bcrypt lassítása csak alacsony entrópiájú titkoknál (jelszó) ad
hozzá biztonságot.

**Threat model:** véd a DB-tartalom kiszivárgása ellen (offline leak,
backup, injection). Nem véd — és nem is feladata — a futó processz
kompromittálása, az e-mail-fiók átvétele vagy a TLS-t megkerülő
linklehallgatás ellen.

**Ismert átállási korlát:** a K2.1.4 deploy előtt kiküldött (plaintextben
tárolt tokenű) linkek érvénytelenné válnak — a hash-lookup nem találja őket.
Reset-linkeknél a TTL amúgy is 1 óra; függő meghívókat (7 nap TTL) újra kell
küldeni. Migrálás szándékosan nincs: a plaintext→hash konverzió pont azt az
értéket írná a DB-be, amit el akarunk felejteni... a nyers tokent a szerver
már nem ismeri, tehát nem is lehetséges.

**Naplózás:** token, hash és tokent tartalmazó URL nem kerül logba. Kivétel
a fejlesztői MockEmailService (csak `RESEND_API_KEY` nélkül aktív), amelynek
épp az a dolga, hogy lokálisan a konzolra írja a kiküldendő linket — éles
környezetben nem fut.

## Company activity enforcement (K2.1.5)

**Aktiválási modell:** a `Company.active` mező a tenant-szintű kapcsoló —
akkor vált `false`-ra, amikor a BUSINESS_OWNER törli a fiókját (soft-delete,
lásd account.routes.ts). Inaktív cég **minden** tagja azonnal elveszti a
hozzáférést, nem csak a törölt tulajdonos.

**Auth-folyamat:** az autentikáció mindenhol KÉT feltételt ellenőriz:
`User.active === true` ÉS (ha a usernek van cége) `Company.active === true`.

| Útvonal | Viselkedés inaktív cégnél |
|---|---|
| Auth middleware (minden védett kérés) | generikus 401 — **meglévő JWT-k azonnal meghalnak**, nem kell lejáratot várni. A cég-státusz a middleware meglévő user-lekérdezésének nested selectjével jön (`company: { select: { active } }`) — nincs plusz Prisma-hívás. |
| Login | generikus `401 "Invalid credentials"` — a cég státusza nem szivárog |
| Forgot password | generikus válasz, de reset-token **nem is generálódik** — ez a legbiztonságosabb: a reset-link különben visszaadná a jelszót egy kizárandó fióknak; e-mail (Resend-költség) sem megy ki |
| Reset password | generikus `400` — a cég deaktiválása ELŐTT kiállított tokenekre is |
| Email verification | generikus `400` — önmagában ártalmatlan lenne, de a konzisztens szabály olcsóbban auditálható, mint a végpontonkénti kivétel |
| Invite lookup + accept | generikus `404 "Invitation not found or expired"` — inaktív cégbe nem lehet belépni függő meghívóval |

**Developer-kivétel:** a DEVELOPER usernek nincs cége (`companyId: null`) —
a cég-ellenőrzés csak akkor fut, ha van kapcsolt cég (`user.company &&
!user.company.active`), így a platform-operátor működése változatlan. Ez nem
új szerep-logika: az RBAC érintetlen.

**Threat model:** azt a rést zárja, hogy a tulajdonosi fiók-törlés (tenant
offboarding) után a cég munkavállalói tovább hozzáfértek a cég adataihoz
(K2.1.1 H5). Nem célja szerep-szintű jogosultság-változás kezelése (az az
RBAC dolga), és nem fedi a Stripe-előfizetés lejártát — a `plan`/limit
logika attól független.

## Password Policy (K2.1.6)

**Szabályok** (központilag:
[server/src/utils/passwordPolicy.ts](../server/src/utils/passwordPolicy.ts)):

- legalább **12 karakter**
- legalább egy kisbetű, egy nagybetű és egy számjegy
- speciális karakter **nem** kötelező
- Unicode-jelszavak támogatottak — a kis-/nagybetű-ellenőrzés
  Unicode-tudatos (`\p{Ll}` / `\p{Lu}` / `\p{Nd}`), így pl. az
  `Árvíztűrő123x` érvényes
- csak a bevezető/záró whitespace trimmelődik (a trimmelt forma kerül
  hash-elésre); a belső szóköz legális jelszó-karakter és érintetlen marad

A `validatePassword()` az egyetlen erősség-validátor — a register, a
jelszó-reset és a meghívó-elfogadás mind ezt hívja; másolt szabály nincs.
Minden flow ugyanazt a konzisztens hibaüzenetet adja
(`400`, `PASSWORD_POLICY_MESSAGE`), implementációs részletek nélkül.

**Backward compatibility:** a policy KIZÁRÓLAG jelszó létrehozásakor/
cseréjekor fut — a login soha nem validál erősséget, a meglévő (akár
gyengébb) jelszavú fiókok változatlanul bejelentkeznek, kényszerített
jelszócsere nincs, a tárolt hash-ekhez és a bcrypt költséghez nem nyúltunk.
A régi jelszavak a következő önkéntes cserénél „nőnek bele" a policybe.

**Future extension:** a modul a természetes helye a későbbi bővítéseknek —
pl. gyakori-jelszó lista (top-10k denylist), e-mail≠jelszó ellenőrzés,
haveibeenpwned-integráció, maximum-hossz. Új szabály felvételéhez csak a
`validatePassword()` és a `PASSWORD_POLICY_MESSAGE` módosítandó; minden
flow automatikusan örökli.

## Email Validation (K2.1.7)

**Központi modul:**
[server/src/utils/emailValidation.ts](../server/src/utils/emailValidation.ts)
— `validateEmail()` + `normalizeEmail()`. Minden e-mailt fogadó végpont ezt
hívja (register, login, forgot-password, invite-create); duplikált regex
nincs. Az invite-accept és a resend-verification nem fogad e-mail inputot
(a meghívó tárolt címét, ill. a bejelentkezett usert használja), így ott
nincs mit validálni.

**Normalizálás** (validálás előtt, és a tárolt/lookupolt forma is ez):
- bevezető/záró whitespace trimmelése
- a **domain-rész** kisbetűsítése — a local part érintetlen (RFC szerint
  case-sensitive)
- NINCS szolgáltató-specifikus átírás: a pontok és a `+aliasok` a local
  partban megmaradnak

**Validációs szabályok** (elutasítva): üres cím; hiányzó `@` vagy több `@`;
hiányzó domain vagy TLD; whitespace / ASCII-vezérlőkarakter bárhol; 254
karakternél hosszabb cím / 64-nél hosszabb local part; ponttal kezdődő/
végződő vagy dupla-pontos local part; kötőjellel kezdődő/végződő
domain-label. **Elfogadva:** Unicode local part (`árvíztűrő@example.com`)
és nem-ASCII (IDN) domain-karakterek — a kompatibilitás nem csökkent.
Hibánál minden végpont konzisztens `400 {"error":"Invalid email address."}`
választ ad — a formátum-hiba semmit nem árul el arról, létezik-e a fiók,
így a forgot-password enumeration-védelme érintetlen.

**Known limitations:** a kvótázott local part (`"a@b"@x.com`, RFC 5321
szerint legális, gyakorlatban nem használt) elutasításra kerül; punycode/IDN
mélyebb ellenőrzés nincs (a nem-ASCII domain szintaktikailag átmegy, de nem
konvertálódik); kézbesíthetőséget (MX-rekord, létező postafiók) a validáció
nem ellenőriz — azt az e-mail-verifikációs kör fedi. A validáció előtti,
DB-ben ülő címek változatlanul működnek (a login a normalizált formával
keres; a korábbi register minden címet kisbetű-érzékenyen tárolt, ahogy
gépelték — nagybetűs domainű örökölt rekord elvben elérhetetlenné válna,
a meglévő adatbázisban ilyen nincs).

## Timing Attack Protection — login (K2.1.8)

**Probléma:** ismeretlen e-mailnél a login a DB-lookup után azonnal
visszatért (~0,3 ms), létező fióknál viszont lefutott a bcrypt-összehasonlítás
(~46 ms) — a válaszidő tehát elárulta, mely címek regisztráltak, hiába volt
azonos a hibaüzenet (K2.1.1 M2).

**Dummy hash:** az [auth.routes.ts](../server/src/routes/auth.routes.ts)
modul-betöltéskor EGYSZER legenerál egy érvényes bcrypt-hash-t egy 32 bájtos
véletlen értékből (`DUMMY_PASSWORD_HASH`) — kérésekként soha nem generálódik
újra, plaintext jelszó nincs a forrásban, a cost factor (10) megegyezik a
valós user-hash-ekével, így az összehasonlítás ideje is egyezik.

**Folyamat:** ismeretlen e-mailnél a szerver a dummy hash ellen futtatja le
a `bcrypt.compare()`-t, majd PONTOSAN ugyanazt a generikus 401-et adja, mint
a rossz-jelszó ág — státusz, body, headerek és a (nem létező) naplózás is
azonos. Mesterséges `sleep()` nincs: a védelem valódi, azonos munkavégzés.

**Mérés** (100–100 sikertelen login, kód-szinten — a HTTP-mérést a
rate limiter blokkolná): létező user átlag 46,71 ms (min 46,00 / max 54,61),
ismeretlen user átlag 46,51 ms (min 45,94 / max 49,93) — **0,2 ms átlagos
eltérés, teljesen átfedő eloszlások**; a régi ismeretlen-user út 0,33 ms
volt.

**Threat model:** a válaszidő-alapú user enumerationt zárja a loginon. Nem
fedi: a register 409-es enumeration-viselkedését (K2.1.1 H3, külön feladat),
a forgot-password apró timing-eltérését (DB-írás + e-mail-sorbaállítás csak
létező usernél — a rate limit 5/óra plafonja miatt statisztikai mérésre
gyakorlatilag alkalmatlan), és a hálózati jitter feletti mikro-eltéréseket.

**Performance:** többletköltség csak az ismeretlen-e-mailes sikertelen
loginokon van (+1 bcrypt-compare, ~46 ms) — sikeres és rossz-jelszavas
loginok költsége változatlan. Ez a többlet a rate limittel (max 20
login/IP/15 perc) együtt elhanyagolható terhelés.

## Registration Enumeration Protection (K2.1.9)

**Régi viselkedés:** új e-mail → `201` + session-token; létező e-mail →
`409 "Email already in use"`. A státuszkód és a body közvetlenül elárulta,
hogy egy cím regisztrált-e — tömegesen (rate limiten belül) fiók-enumerációra
használható.

**Új viselkedés:** minden érvényes (formátum + jelszó-policy átment)
regisztrációs kísérlet **ugyanazt a generikus `201` választ** kapja:

```json
{ "message": "Registration received. Please check your email to verify your account." }
```

- Létező cím esetén **nincs 409, nincs eltérő body** — nem hozunk létre
  semmit, és **nem küldünk verifikációs (sem welcome) e-mailt**.
- Új cím esetén létrejön a Company + User, kimegy a welcome + verifikációs
  e-mail, majd ugyanez a generikus válasz megy vissza.

**Design-döntés — miért tűnik el a token a válaszból:** identikus body csak
úgy lehetséges, ha egyik ág sem hordoz fiók-specifikus adatot. Egy létező
fiókhoz nem lehet érvényes session-tokent kiállítani (az fiók-átvétel
lenne), így a valódi regisztráció ágán is elhagyjuk a tokent. Ez a
frontendet nem érinti: a `RegisterPage` a `register()` után amúgy is külön
`POST /auth/login`-t hív a beírt jelszóval, és azzal jelentkezik be — a
register válaszát eldobta eddig is. Egy visszatérő felhasználó, aki a saját,
létező címével „újraregisztrál" a helyes jelszavával, a követő login révén
egyszerűen belép; rossz jelszóval a login generikus hibát ad — egyik esetben
sem szivárog a cím létezése.

**Verifikációs e-mail — miért nincs újraküldés duplikátumnál:** ha a létező
címre újraküldenénk verifikációt, azzal (a) egy off-channel megfigyelőnek
megerősítenénk a fiók létezését, és (b) a regisztráció e-mail-bombázó
vektorrá válna egy meglévő felhasználó postafiókja ellen. Ezért a
duplikátum-ág néma.

**Timing:** a duplikátum-ág egy `bcrypt.compare()`-t futtat a megosztott
dummy hash ellen (ugyanaz a `DUMMY_PASSWORD_HASH`, mint a login timing-
védelemnél, K2.1.8), hogy a költsége megegyezzen az új-fiók ágának
`bcrypt.hash()`-ével — a státuszkód-szivárgás megszüntetése nem hoz be új,
időzítés-alapú szivárgást. Mért különbség 100+100 kísérleten: **0,02 ms**
(új: átlag 46,30 ms, duplikátum: átlag 46,28 ms) — az eloszlások teljesen
átfednek.

**Logging:** az új vs. duplikátum megkülönböztetés csak **belső** logban
jelenik meg, maszkolt e-maillel (`[auth] new registration for k2***@…` /
`[auth] duplicate registration attempt for k2***@…`); a kliens sosem látja.

**Egyéb regisztrációs utak (átvizsgálva):**
- **Invite-accept** (`POST /invites/:token/accept`): a létező-e-mail 409-e
  megmarad, de ez **nem enumerációs vektor** — az útvonalat egy titkos, 24
  bájtos meghívó-token védi (hash-elve tárolva, K2.1.4), és az e-mailt a
  tulajdonos rögzítette a meghíváskor; támadó nem tud tetszőleges címet
  próbálgatni. Szándékosan változatlan.
- **Developer seed** (`scripts/seedDeveloper.ts`): CLI-parancs, nincs
  hálózati kitettsége — nem enumerálható.

**Threat model:** a login-végpont (K2.1.8) mellett a másik közvetlen
fiók-enumerációs felület, a regisztráció, is lezárva — célzott phishing /
credential-stuffing előkészítésére szolgáló cím-feltérképezés a publikus
API-ból többé nem lehetséges.

**Trade-offs:** a regisztráció válasz-body-ja és -szemantikája megváltozott
(nincs token/user a válaszban) — ez szükségszerű következménye az identikus
válasznak, és a jelenlegi frontendet nem töri. Egy létező, ismeretlen
jelszavú címmel próbálkozó jóhiszemű felhasználó a UI-n „sikeres
regisztráció, majd bukó login" élményt kap a korábbi explicit „Email already
in use" helyett — ez tudatos csere: az enumeration-védelem fontosabb, mint a
duplikátum azonnali jelzése (a felhasználó a login-oldalon a „forgot
password" úton tud továbbmenni).

## Egyéb meglévő védelmek

- Soft-deletelt user: login tiltva, middleware minden kérésnél kizárja,
  e-mail tombstone-nal felszabadul, reset-re nem jogosult.
- Verify/reset/invite tokenek: erős random, TTL, egyszer használatosak.
- JWT_SECRET: induláskori validáció (lásd environment.md).

## Ismert korlátok (K2.1.1 audit, még nyitott)

Rate limiting (C1), jelszó-policy (M1), tokenek hash-elt tárolása a DB-ben
(H4), cég-szintű aktív-check (H5), register-enumeration (H3), localStorage
(H2), refresh-stratégia (M3) — ezek külön K2-feladatok.
