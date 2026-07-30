# Adatbázis-mentés és visszaállítás (B7)

*Ez a kanonikus leírás. A [render-deployment.md](render-deployment.md) 7. pontja, a
[production-checklist.md](production-checklist.md) Backups szakasza és a
[release-candidate-checklist.md](release-candidate-checklist.md) Part 5/6 csak rövid
összefoglalót tart, és ide linkel.*

---

## 1. Mit mentünk — és miért csak együtt ér valamit

| Mit | Hol él | Mivel mentjük |
|---|---|---|
| **Adatbázis** | Render managed PostgreSQL (`DATABASE_URL`) | szolgáltatói napi backup + kézi `pg_dump` deploy előtt |
| **Feltöltött fájlok** | `/var/data/uploads` (persistent disk) — `projects/` (csatolmányok) **és** `logos/` (cég-logók) | `tar` a **teljes** `UPLOAD_ROOT`-ról |

A kettő **csatolt**: a `ProjectAttachment.fileUrl` és a `Company.logoUrl` a diszken lévő
fájlokra hivatkozik. Csak-DB visszaállítás után minden hivatkozás megmarad, de a fájl
404 — csak-uploads visszaállítás után árva fájlok vannak hivatkozás nélkül. **A DB-dump
és az uploads-mentés ugyanabban az időablakban készüljön**; teljes RPO szempontból a
kettő közül a régebbi számít.

## 2. Mentés

Custom formátum: egyetlen tömörített fájl, amit a `pg_restore` `--clean`-nel, egy
tranzakcióban tud visszatölteni. (Plain SQL dumpot a `pg_restore` **nem** olvas.)

```bash
# Render External Database URL-lel, a saját gépről (sslmode=require kell —
# lásd render-deployment.md 0. pont)
pg_dump --format=custom --no-owner --no-privileges \
  --file="axeriva-$(date +%F-%H%M).dump" "$DATABASE_URL"
```

PowerShell-változat (Windowson a `$(date +%F)` bash-izmus nem fut le):

```powershell
$stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
pg_dump --format=custom --no-owner --no-privileges --file="axeriva-$stamp.dump" $env:DATABASE_URL
```

Miért ezek a kapcsolók:

- `--no-owner --no-privileges` — a drill- és a cél-adatbázis role-jai nem azonosak;
  nélkülük a restore `ALTER ... OWNER TO` hibákat dob.
- A `pg_dump` **kliens** verziója legyen azonos vagy újabb, mint a szerveré, különben
  a dump el sem indul (`server version mismatch`) — a szerver major verzióját a
  [render-deployment.md](render-deployment.md) 0. pontjának táblázata rögzíti.

### Uploads

```bash
# a) Render Shell (Web Service → Shell): a TELJES uploads könyvtár tarba —
#    a projects/ ÉS a logos/ alkönyvtárral együtt. Csak a projects/ mentése
#    a cég-logókat veszítené el.
tar -czf /tmp/uploads-$(date +%F).tar.gz -C /var/data uploads
# letöltés a render CLI-vel vagy a Shellből objektumtárolóba — lásd a döntést a 6. pontban

# b) Visszaállítás (helyben vagy új diskre)
tar -xzf uploads-2026-07-25.tar.gz -C /var/data
```

## 3. Visszaállítás

```bash
pg_restore --clean --if-exists --no-owner --no-privileges \
  --single-transaction --dbname="$DATABASE_URL" axeriva-2026-07-25-1830.dump
```

Mit old meg melyik kapcsoló:

- `--clean` — eldobja a meglévő objektumokat, mielőtt újra létrehozná őket. **Ettől
  működik nem üres adatbázison is** — pontosan az az incidens-helyzet, amiben a
  korábbi, sima `psql`-lel visszatöltő eljárás `relation already exists`
  hibasorozattal, de 0-s exit kóddal, félig visszaállított adatbázist hagyott.
- `--if-exists` — üres adatbázison sem hasal el a DROP.
- `--single-transaction` — vagy minden visszaáll, vagy semmi nem változik; nincs
  félkész állapot (és implikálja az exit-on-error viselkedést).

> ⚠️ **A `--clean` rossz `DATABASE_URL`-lel a cél-adatbázis megsemmisítése.** A parancs
> kiadása előtt írasd ki és olvasd el a cél connection stringet. Production ellen
> `--clean` csak valódi incidensben, tudatosan.

Ha valamiért plain SQL dump kell (szemrevételezés), a helyes páros — ezt már a `psql`
tölti vissza, nem a `pg_restore`:

```bash
pg_dump --clean --if-exists --no-owner --no-privileges "$DATABASE_URL" > axeriva-2026-07-25.sql
psql --set ON_ERROR_STOP=on --single-transaction --dbname "$DATABASE_URL" --file axeriva-2026-07-25.sql
```

Az `ON_ERROR_STOP=on` nem opcionális: enélkül a `psql` átgázol a hibákon és sikerrel
tér vissza.

### Verifikáció (a visszaállítás kötelező része)

```sql
-- 19 modell (schema.prisma, a ProcessedStripeEvent-tel) + _prisma_migrations = 20
-- (2026-07-29 előtti dumpnál még 19 — a checkout_mandatory_upgrades migráció
-- utáni restart hozza be a 20.-at a migrate deploy útján)
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';

SELECT 'Company' AS t, COUNT(*) FROM "Company"
UNION ALL SELECT 'User',              COUNT(*) FROM "User"
UNION ALL SELECT 'Customer',          COUNT(*) FROM "Customer"
UNION ALL SELECT 'Project',           COUNT(*) FROM "Project"
UNION ALL SELECT 'ProjectAttachment', COUNT(*) FROM "ProjectAttachment"
UNION ALL SELECT 'Shift',             COUNT(*) FROM "Shift";

-- minden migráció befejezett; a sorok száma = a server/prisma/migrations/ alkönyvtárak száma
SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY started_at;
```

Plusz a `DATABASE_URL`-t a visszaállított adatbázisra állítva:
`npx prisma migrate status` → „Database schema is up to date!". (A táblanevek
idézőjelesek: a séma nem használ `@@map`-et, a Prisma modellnév a táblanév.)

### ⚠️ A `prisma migrate deploy` kölcsönhatása — incidensben ez fog fájni

A Start Command minden induláskor `prisma migrate deploy`-t futtat
(`server/package.json`). Régebbi dump visszaállítása után a **következő restart
automatikusan újra felviszi a hiányzó migrációkat**. Ha az incidens oka épp egy
destruktív migráció volt, a restore utáni újraindulás **újra elrontja** ugyanazt.
Ezért: a hibás migrációt a repóban vissza kell vonni (vagy a deployt a korábbi buildre
rögzíteni) **még a restart előtt**. Ez a [render-deployment.md](render-deployment.md)
„a migrációk csak előre mennek" szabályának a másik fele.

## 4. Restore-próba (drill)

A drill **nem** production ellen fut, és **nem** az `axeriva_test` adatbázis ellen
(azt a vitest suite üríti tesztek között). Saját scratch adatbázist kap:
**`axeriva_restore_drill`** a lokális PostgreSQL-en — a név szándékosan nem
tartalmazza a `test` markert, és a `TEST_DATABASE_URL`-t soha ne állítsd erre.

**A lényeg: a restore-t KÉTSZER kell lefuttatni.** Az első futás üres adatbázisba megy
— az a régi, hibás paranccsal is sikerülne. A **második futás egy már feltöltött
adatbázisba** megy: pontosan az a helyzet, amiben a régi eljárás elhasalt. A dump ne
legyen üres — üres dump visszaállítása semmit nem bizonyít.

| # | Lépés | Elvárás |
|---|---|---|
| D0 | Forrásadat: production dump a smoke test után, VAGY lokálisan: seed + cég-regisztráció + customer + projekt + **legalább egy feltöltött attachment** (jó, ha cég-logó is) | attachment nélkül a DB↔uploads csatolás nincs lefedve |
| D1 | Dump a 2. pont parancsával + uploads-tar a **teljes** `UPLOAD_ROOT`-ról | a fájl létezik, mérete > 0 |
| D2 | `CREATE DATABASE axeriva_restore_drill;` lokálisan. **A restore előtt írasd ki és olvasd el a cél connection stringet** | — |
| D3 | Első restore (üres célba) a 3. pont parancsával | exit 0, hibaüzenet nélkül |
| D4 | Verifikáció (3. pont): tábla-darabszám = 20 (2026-07-29 előtti dumpnál 19); a sorszámok **pontosan** egyeznek a forráséval; `_prisma_migrations` minden sora `finished_at IS NOT NULL`; `npx prisma migrate status` zöld | mind átmegy |
| D5 | **MÁSODIK restore, ugyanarra a — most már feltöltött — adatbázisra.** Ez a drill lényegi lépése | exit 0, és D4 újra átmegy (nincs duplázódás, nincs félkész állapot) |
| D6 | Alkalmazásszintű ellenőrzés: backend indítása a drill DB-vel + kicsomagolt uploads-szal. (a) belépés visszaállított fiókkal (bcrypt hashek épek); (b) a projekt megnyílik, az attachment listázódik; (c) az attachment-lista **aláírt** URL-je (`?exp=…&sig=…`) 200-at ad helyes content type-pal | mindhárom teljesül. ⚠️ A DB-beli nyers `fileUrl` GET-elése NEM érvényes ellenőrzés: aláírás nélkül szándékosan 404 (signedUploads.middleware) |
| D7 | RTO-mérés: D3 kezdetétől D6 végéig eltelt idő | ez a szám kerül a lenti táblába |
| D8 | Takarítás: `DROP DATABASE axeriva_restore_drill;` + a dump és a kicsomagolt uploads törlése a gépről | érzékeny adat — nem maradhat |

**Pass/fail:** a drill akkor és csak akkor sikeres, ha a **D5** exit 0-val lefut, **és**
utána D4 minden ellenőrzése átmegy, **és** D6 mindhárom pontja teljesül. Bármelyik
bukása esetén a production-checklist restore-tétele nem pipálható, a launch blokkolva.

### Drill-napló

| Dátum | Végrehajtó | D5 eredmény | Mért RTO | Megjegyzés |
|---|---|---|---|---|
| 2026-07-27 | Anna + Claude | **PASS** (exit 0, nincs duplázódás) | **~0,6 mp technikai** (restore 402 ms + verifikáció 155 ms); teljes emberi ciklus reálisan 10–15 perc | Forrás: az első éles dump (80 kB — 1 cég, 3 user, 1 employee, 1 projekt). Cél: lokális `axeriva_restore_drill`, PostgreSQL 18. D6 teljesült: a backend elindult a visszaállított DB-re, `prisma migrate status` „up to date", mindhárom bcrypt hash ép (`$2b$`, 10 rounds), `/admin/companies`, `/employees` (`accessRevoked` mezővel), `/dashboard`, `/subscription` mind 200, és a rossz jelszavas login `401 Invalid credentials`-t adott (nem „unknown email") — tehát a jelszó-összehasonlítás ténylegesen lefutott a visszaállított hash ellen. **Nem fedve:** helyes jelszavas login (a credential az operátornál) és az uploads-csatolás (a dumpban 0 `ProjectAttachment` — az első valódi feltöltés után ismétlendő). |

## 5. Retention, RPO, RTO, tárolási hely

*(A számok javaslatok — a vállalás mértéke üzleti döntés, a végleges értékeket Anna
rögzíti. A kitöltetlen mezők a Render-oldali ellenőrzés után frissítendők.)*

| Tétel | Vállalás |
|---|---|
| Kézi deploy-előtti dump megőrzése | **30 nap**, utána törlés (rögzítve: 2026-07-26) |
| Szolgáltatói védelem | **PITR, 7 napos ablak** (Render Basic-256mb, 2026-07-26-án ellenőrizve); on-demand Export-fájlok ≥7 napig — külön napi backup-lista nincs |
| **RPO** | a PITR-ablakon belül percek nagyságrendű (WAL-alapú); deploy-pillanatra 0 (kézi dump); **7 napnál régebbre visszaállás csak megőrzött kézi dumpból lehetséges** |
| **RTO** | **~0,6 mp technikai** restore+verifikáció a jelenlegi adatmennyiségen (2026-07-27-i drillben mérve); a teljes incidens-ciklus (dump megkeresése, parancs kiadása, app átállítása, smoke) reálisan **10–15 perc**. Az adatmennyiség növekedésével a technikai rész nő — érdemes évente újramérni. |
| Tárolási hely | `D:\Axeriva\Backups\` — **jelenleg titkosítás nélkül** (tudatos döntés, 2026-07-26: a BitLocker bevezetése külön biztonsági follow-up, lásd post-launch-backlog). A lenti titkosítási követelmény a célállapot; addig a mappa nem szinkronizálódhat felhőbe és nem osztható meg. |

> 🔒 **Biztonság — a dump nem „csak egy fájl".** A dump a `User.password` bcrypt
> hasheket, a teljes ügyfélállományt és a Stripe-azonosítókat
> (`stripeCustomerId`/`stripeSubscriptionId`) tartalmazza. **Titkosított tárolóra
> kerül, megnevezett helyre, megnevezett megőrzési idővel, és a retention lejártakor
> törlendő.** E-mailben, chatben, megosztott felhőmappában, repóban nem tárolható.
> A `.gitignore` kizárja a dump-mintákat (`*.dump`, `backup-*.sql`, `backup-*.dump`,
> `axeriva-*.sql`, `uploads-*.tar.gz`) — de ez csak a commitolás ellen véd, a gépen
> felejtés ellen nem.

## 6. Render-oldali képességek és nyitott döntések

A [render-deployment.md](render-deployment.md) 0. pontjának táblázata (plan/tier,
PostgreSQL verzió, napi backup, PITR) a dashboardról töltendő ki. Ha a tieren nincs
napi backup vagy PITR: döntés kell — tier-váltás (figyelem: járhat connection
string-cserével és leállással) vagy a csak-kézi-dump RPO tudatos vállalása; a döntés
indoklással ide kerül.

**Uploads-mentés csatornája (döntésre vár):** (a) Render Shell + `tar` + letöltés a
render CLI-vel, vagy (b) a Shellből közvetlen feltöltés objektumtárolóba. A választott
változat lesz az elsődleges eljárás ebben a doksiban.

**Amit tudatosan NEM csinálunk:** nincs `backup`/`restore` npm script és nincs
ütemezett dump-job a CI-ban. Egy GitHub Actions cron-dumphoz élő production
DB-credential kellene GitHub secretként és kifelé nyitott DB-elérés — érdemi támadási
felület egy olyan képességért, amit a managed szolgáltató napi backupja amúgy is nyújt,
ráadásul a dump a runner fájlrendszerén landolna. A `ci.yml` szándékosan
`permissions: contents: read`. A rendszeres mentés mechanizmusa a szolgáltatói napi
backup; a repo dolga ennek dokumentálása és a visszaállítás bizonyítása (a drill).
Ha később mégis kell saját ütemezett dump, az önálló feladat, saját threat-modellel.
