# Post-launch backlog

*Forrás: a v1.0 #3.5 Launch Blockers lezárása utáni Release Readiness Audit
(2026-07-26) nyitott-tétel leltára. Minden tétel szándékosan halasztott — egyik
sem launch-blocker; az indoklás a hivatkozott helyen. A launch-blokkoló
operatív teendők NEM itt vannak, hanem a
[release-readiness-audit.md](release-readiness-audit.md) GO-feltételei közt.*

## Kiadási jegyzetbe (launchkor kommunikálandó tény)

- **A visszavont hozzáférésű dolgozó továbbra is fogyaszt egy fizetett helyet**,
  és az újra-meghívása egy továbbit (a seat-számolás minden `Employee` sort
  számol — `utils/planLimits.ts`, `invites.routes.ts`). B1-ben tudatosan
  halasztva; biztonsági hatása nincs.

## Első hetek (important)

| # | Tétel | Forrás |
|---|---|---|
| 1 | **`account.routes.ts` törlési guard trial-finomítása** — a regisztrációs trial tulajdonosa ma nem tudja törölni a fiókját (409); ugyanaz az `isBilled = státusz + stripeSubscriptionId !== null` feltétel kell, mint a B2 archive-guardban, tükör-teszttel | B2 nyitott kérdés; audit |
| 2 | **Admin unarchive endpoint** (`POST /admin/companies/:id/unarchive`, DEVELOPER-only, auditált) — tévesen archivált (nem számlázott) cég ma csak DB-hozzáféréssel menthető; elérhetővé teszi a companyArchive „already archived" 409-ágát is | B2 follow-up; plan :334-338 |
| 3 | **Seat-szemantika döntés** — a visszavont dolgozó kikerüljön-e a seat-számításból, vagy figyelmeztetés a Subscription oldalra; addig a kiadási jegyzet fedi | B1 halasztott |
| 4 | **Frontend teszt-harness** (vitest + testing-library) + `tsconfig.app.json` strict — a B3 policy-tükörnek ma nincs automatikus frontend-regresszióvédelme (csak a szerveroldali tripwire); utána a 23 lint-hiba ledolgozása és a CI lint-gate blokkolóra állítása | B3 nyitott kérdés; project-overview debt |
| 5 | **`CompanyProfileSection` hardkódolt angol validációs üzenetei** — magyar UI-ban is angolul jelennek meg („Company name is required." stb.); i18n kulcsokra váltás mindkét szótárban | audit frontend-sweep |
| 6 | **B6 seed-script hardening** — a usage-string a Renderen nem működő `npm run seed:developer`-t hirdeti (`seedDeveloper.ts:12`); `normalizeEmail()` + `validatePassword()` behúzása, hogy a nagybetűs-e-mail és gyenge-jelszó csapda technikailag is megszűnjön; `project-overview.md:172` production-figyelmeztetése | B6 follow-up 1+2 |

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
| 17 | **B6 jelszó-rotáció rögzítése** — a runbook ajánlja a seedelt jelszó reset-flow-s cseréjét az első belépés után; ha megtörtént, jegyezd fel a jelszókezelőben; ha nem, egyszer futtasd le | B6 nyitott kérdés |
| 18 | **`server/.env` lokálisan még SQLite-ra mutat** (`file:./axeriva.db`) — a lokális fejlesztéshez PostgreSQL URL kell; a repo-t nem érinti (a fájl nem követett) | audit megfigyelés |
