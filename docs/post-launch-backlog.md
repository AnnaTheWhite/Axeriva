# Post-launch backlog

*Forrás: a v1.0 #3.5 Launch Blockers lezárása utáni Release Readiness Audit
(2026-07-26) nyitott-tétel leltára; frissítve a production deploy és a
deploy-napi incidens (rossz adatbázisba futott seed → üres prod User-tábla →
teljes login-kiesés) utáni sanity-audittal. A még nyitott GO-feltételek
(B7 Render-oldal, restore-drill, Stripe-cutover verifikáció) a
[release-readiness-audit.md](release-readiness-audit.md)-ben — azok határidős
launch-adósságok, nem backlog.*

## Azonnali operatív teendők (az incidens nyomán — perc-nagyságrendűek)

- **DEVELOPER-jelszó rotálása** a reset-flow-n át: a jelszó kétszer járta meg a
  parancssort, és az első seed a `axeriva_test`-be írta a hash-ét — egy olyan
  DB-be, amit a teszt-suite eldobhatónak kezel. *(a korábbi #17 előrehozva)*
- **Az `axeriva_test` instance credentialjének rotálása** — a URL-je a
  production URL mellett keringett operátori shellekben; az incidens
  bizonyította, hogy össze tudnak keveredni. *(új tétel)*
- **A B6-pipa jegyzetének javítása** a production-checklistben: az eredeti
  attesztáció a rossz DB ellen történt; a tényleges lezárás az újraseedelés +
  éles login-verifikáció dátuma.
- **Shell-history takarítás** a seedhez használt gép(ek)en, és annak
  ellenőrzése, hogy egyetlen profil/env sem exportál élő `DATABASE_URL`-t.

## Kiadási jegyzetbe (launchkor kommunikálandó tény)

- **A visszavont hozzáférésű dolgozó továbbra is fogyaszt egy fizetett helyet**,
  és az újra-meghívása egy továbbit (a seat-számolás minden `Employee` sort
  számol — `utils/planLimits.ts`, `invites.routes.ts`). B1-ben tudatosan
  halasztva; biztonsági hatása nincs.

## Első hetek (important)

| # | Tétel | Forrás |
|---|---|---|
| 0 | **B6 seed-script hardening — ELŐREHOZVA, bővített scope-pal:** a script induláskor írja ki a cél-DB hostját/nevét (maszkolt credentiallel, a `DATABASE_URL`-ből parse-olva), és nem-üres `User`-tábla esetén csak explicit `--force`-szal írjon; plusz `normalizeEmail()` + `validatePassword()`; a usage-string cseréje a működő `node dist/…` alakra; a sikert az éles API elleni loginnal kell verifikálni, nem a script kimenetéből. **Az incidens gyökéroka pont a cél-DB-vakság volt.** | B6 follow-up; deploy-incidens |
| 0a | **BitLocker (vagy egyenértékű titkosítás) a backup-mappára** (`D:\Axeriva\Backups\`) — a P0.2 tudatosan titkosítás nélkül zárult (2026-07-26); a dumpok bcrypt hasheket, ügyféladatot és Stripe-azonosítókat tartalmaznak, a titkosítás a backup-restore.md kimondott célállapota | 🔧 | P0.2 döntés |
| 0c | **Tárhely-kapacitás: a disk kisebb, mint amit eladunk.** A persistent disk **4,9 GB** (`/dev/nvme21n1` a `/var/data` mounton, 2026-07-27-én ellenőrizve), a csomag-kvóták viszont Starter **5 GB** / Professional 25 GB / Business 100 GB (`constants/limits.ts:42`) — és a kvóták **feltöltéskor nincsenek kikényszerítve**. Egyetlen Starter ügyfél is túlnőheti a diszket; teli disknél a feltöltés hibázik. Teendő: (a) disk-használat figyelése (a 0b monitoring része), (b) döntés: disk növelése (Renderen bővíthető) **vagy** a #4 (R2) előrehozása, (c) kvóta-ellenőrzés az upload-úton (egy `SUM(fileSize)` a cégre — a `fileSize` oszlop megvan). **Döntés (2026-07-27, Anna):** a disk **nem** bővül most (1%-os kihasználtság mellett indokolatlan); a kvóta-ellenőrzés és az R2/S3 migráció a **növekedési fázisra** ütemezve; addig a disk-kihasználtság **monitorozás alatt** (a 0b tétel része — ez a konkrét trigger, ami a döntést újranyitja). | 🤔💻 | P0.13 megfigyelés |
| 0b | **Monitoring/alerting előrehozása (roadmap #5-ből):** uptime-monitor a `/health`-re + Sentry (vagy egyenértékű) az API-ra. Az incidenst kézzel vettük észre — a következő „nulla user"-osztályú hibát riasztásnak kell jeleznie, nem ügyfélnek. | deploy-incidens; roadmap #5 |
| 1 | **`account.routes.ts` törlési guard trial-finomítása** — a regisztrációs trial tulajdonosa ma nem tudja törölni a fiókját (409); ugyanaz az `isBilled = státusz + stripeSubscriptionId !== null` feltétel kell, mint a B2 archive-guardban, tükör-teszttel | B2 nyitott kérdés; audit |
| 2 | **Admin unarchive endpoint** (`POST /admin/companies/:id/unarchive`, DEVELOPER-only, auditált) — tévesen archivált (nem számlázott) cég ma csak DB-hozzáféréssel menthető; elérhetővé teszi a companyArchive „already archived" 409-ágát is | B2 follow-up; plan :334-338 |
| 3 | **Seat-szemantika döntés** — a visszavont dolgozó kikerüljön-e a seat-számításból, vagy figyelmeztetés a Subscription oldalra; addig a kiadási jegyzet fedi | B1 halasztott |
| 4 | **Frontend teszt-harness** (vitest + testing-library) + `tsconfig.app.json` strict — a B3 policy-tükörnek ma nincs automatikus frontend-regresszióvédelme (csak a szerveroldali tripwire); utána a 23 lint-hiba ledolgozása és a CI lint-gate blokkolóra állítása | B3 nyitott kérdés; project-overview debt |
| 5 | **`CompanyProfileSection` hardkódolt angol validációs üzenetei** — magyar UI-ban is angolul jelennek meg („Company name is required." stb.); i18n kulcsokra váltás mindkét szótárban | audit frontend-sweep |
| 6 | *(→ előrehozva #0-ként, bővített scope-pal — lásd fent)* | B6 follow-up 1+2 |

## N1.8 — tudatosan elfogadott korlátok

*Anna 2026-08-05-én mindkettőt **elfogadott korlátként** vette tudomásul; egyik
sem blokkolja a Slice 4 mergét. Itt vannak rögzítve, hogy ne felejtődjenek el.*

| # | Tétel | Forrás |
|---|---|---|
| N1 | **Az `invoice.upcoming` lead time kizárólag a Stripe Dashboardon él.** A Stripe *X nappal* a következő számla előtt küldi az eseményt, ahol X **fiókszintű beállítás** (`Events.d.ts:1554`) — nincs env-változó, a `stripeSetup.ts` nem állítja, teszt nem látja. **Ha X = 0 / ki van kapcsolva, a `billing.renewal_upcoming` készen, zölden és működésképtelenül áll élesben.** Teendő: a beállított érték ellenőrzése és **beírása** a [notification-rollout.md](notification-rollout.md) Slice 4 szakaszába (van hozzá kipontozott hely), plusz az ott megadott két ellenőrző lekérdezés az első valós ciklusforduló után. Ugyanaz a hibaosztály, mint a Slice 2 `always_invoice` függősége, egy fokkal rosszabb: az legalább látszik a repóban. | N1.8 Slice 4 review; elfogadva 2026-08-05 |
| N2 | **A `Company.timezone` alapértelmezés nélküli, így a dátumos billing-levelek UTC-ben számolnak.** A mező nullable, a regisztráció nem tölti ki, a beállítás-űrlap nem detektál böngésző-zónát — tehát a legtöbb tenantnál UTC. A Stripe ciklushorgony a checkout pillanata, így egy 01:30-kor előfizető budapesti ügyfél `period.start`-ja 23:30 UTC az **előző** naptári napon, és a „következő fizetés" levél azt a napot nevezi meg. Korlátos (±1 nap, és az utána érkező nyugta a valós dátumot közli), de a Slice 4-nél a nap **maga az üzenet**. Lehetséges irányok: `Company.timezone` kitöltése regisztrációkor (böngésző-detektálás), vagy időzóna-címke a levélben. Érinti a Slice 1–2 időszak-dátumait is, ott kozmetikai. | N1.8 Slice 4 review; elfogadva 2026-08-05 |
| N3 | **Dupla mondatvégi pont a magyar `invoiceFailed.retryScheduled`-ben.** Az ICU `hu-HU` hosszú dátum ponttal végződik („2026. október 18."), a Slice 3-ban committolt szöveg pedig még egy pontot tesz utána: „…ideje: 2026. október 18.. Csak akkor…". Kozmetikai, a Slice 4 ugyanezt a csapdát már elkerüli (a dátum mondatvégen áll). Külön, apró javítás — nem a Slice 4 dolga a committolt Slice 3 csendes átírása. | N1.8 Slice 4 review |

## Backlog (minor)

| # | Tétel | Forrás |
|---|---|---|
| 7 | **Szerver-hibaszövegek lokalizálása egy körben** — stabil hibakódok + kliensoldali i18n-leképezés: archive-409, employee-delete-409, Stripe-mapper üzenetek (`code` mező már van), `PASSWORD_POLICY_MESSAGE` (a teszt-lockolt szerződés miatt kódot igényel); plusz a hiányzó `employees.deleteBlockedRevokeInstead` kulcs és a `BillingPlansSection` „Failed to change plan" fallbackje | B1/B2/B3/B4 nyitott kérdések |
| 8 | **Revoke-endpoint rate limit** (pl. 20/óra per user) — jelszó-orákulum nincs, de egy ellopott owner-token tömeges offboardingot futtathat; a kár újra-meghívással visszafordítható | B1 nyitott kérdés |
| 9 | **Beoszthatóság** — a visszavont dolgozó beosztható marad (szándékos: az utólagos műszak-rögzítés jogos); a helyes fix dátumszabály (múlt engedve, jövő tiltva); opcionális jelölő badge a scheduling-felületeken | B1 halasztott |
| 10 | **Reactivate-út** — az újra-meghívás új `Employee` sort hoz létre, a régi munkaidő-előzményhez nem köt vissza; v1.1: meglévő Employee-hez kötő flow | B1 nyitott kérdés |
| 11 | **Tombstone-os e-mail az admin-listákban** — a DEVELOPER `/admin/users` nézetben a `revoked+…` nyers formában látszik; „revoked" jelölővé alakítás | B1 kozmetika |
| 12 | **ResetPasswordPage zsákutca** szerverhibánál — csak token-hibára legyen hard-fail (backend hibakódot igényel); a kliensoldali ellenőrzés a gyakori esetet már kikerüli | B3 maradék |
| 13 | **B4 hardening-klaszter** — unknown-prefixű kulcs prodban warning→fatal szigorítás; `stripeSetup.ts` Billing Portal-konfig automatizálás; `ALLOW_TEST_STRIPE_KEY` láthatóvá tétele a `/health`-ben; **karbantartási szabály:** az `apiVersion` pint (`2026-05-27.dahlia`) minden `stripe`-csomagfrissítéskor léptetni, a `resource_missing` üzenet-illesztéseket ellenőrizni | B4 nyitott kérdések |
| 14 | **Saját ütemezett dump** — tudatosan nincs (credential-kitettség a CI-ban); újranyitandó, ha a szolgáltatói napi backup elégtelennek bizonyul | B7 döntés |
| 15 | **Teszt-fájlok típusellenőrzése** — a `server/tsconfig.json` kizárja a `src/tests`-et; külön typecheck-tsconfig a teszteknek | project-overview debt |
| 16 | **Controller/service réteg** — vastag route-fájlok, üres `controllers/`; alkalomszerű refaktor teszt-háló alatt | project-overview debt |
| 17 | *(→ előrehozva az „Azonnali" szekcióba — az incidens után a jelszó másodszor is megjárta a parancssort)* | B6 nyitott kérdés |
| 18 | *(→ átminősítve „Első hetek"-re, lokális env-higiéniaként)* **`server/.env` lokálisan még SQLite-ra mutat** — javítás egyértelműen lokális PostgreSQL URL-re, és az `environment.md`-be egy szabály: lokális `.env` soha nem tartalmazhat távoli live/teszt instance-URL-t. Az incidens bizonyította, hogy az operátori környezetben kóborló DATABASE_URL-ek production-kiesés osztályú veszélyt jelentenek. | audit megfigyelés; deploy-incidens |
