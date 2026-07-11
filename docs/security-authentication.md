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

## Egyéb meglévő védelmek

- Soft-deletelt user: login tiltva, middleware minden kérésnél kizárja,
  e-mail tombstone-nal felszabadul, reset-re nem jogosult.
- Verify/reset/invite tokenek: erős random, TTL, egyszer használatosak.
- JWT_SECRET: induláskori validáció (lásd environment.md).

## Ismert korlátok (K2.1.1 audit, még nyitott)

Rate limiting (C1), jelszó-policy (M1), tokenek hash-elt tárolása a DB-ben
(H4), cég-szintű aktív-check (H5), register-enumeration (H3), localStorage
(H2), refresh-stratégia (M3) — ezek külön K2-feladatok.
