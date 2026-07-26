# Release Readiness Audit — v1.0 első production deploy

*Készült: 2026-07-26, a `master` @ `bb8c94d` (+ az auditjavítások) ellen.
Módszer: blokkolónként független verifikáció a `launch-blockers-plan.md`
„Kész, ha" kritériumai ellen (a kódot olvasva, nem a doksit), plusz négy
keresztmetszeti vizsgálat (doksi↔kód konzisztencia, biztonsági sweep,
frontend-készenlét, nyitott-tétel leltár) — összesen 10 független auditor.*

## Verdikt: **FELTÉTELES GO**

A kód-oldal kész: mind a hat launch-blocker lezárva, a teljes suite és mindkét
build zöld, a biztonsági sweep nulla találatot adott. A deploy előtt kizárólag
**operatív** kapuk maradtak (lent, „GO-feltételek") — mindegyik Render/Stripe
dashboard-hozzáférést igényel, azaz Anna kezét.

## Alapigazság (a gépen mérve, nem következtetve)

| Ellenőrzés | Eredmény |
|---|---|
| Teljes backend suite @ `bb8c94d` | **198/198 zöld** (16 fájl; valós PostgreSQL — Render `axeriva_test` — ellen futtatva, 2026-07-26) |
| Backend build (`prisma generate && tsc`) | zöld |
| Frontend build (`tsc -b && vite build`) | zöld (ismert, örökölt chunk-size warning) |
| Boot-check füstteszt (lefordított `dist/config`) | a B4 döntési tábla mind a 7 sora a várt exit-kóddal fut |
| Biztonsági sweep (trackelt titkok, .env/.claude higiénia, hibakezelő-szivárgás, auth-felületek, signed uploads, CI-permissions) | **0 találat** |

## Blokkolónkénti státusz

| Blocker | Verdikt | Megjegyzés |
|---|---|---|
| **B2** archiválás-guard | LEZÁRVA | mind a 10 kritérium teljesül; a trial-finomítás (stripeSubscriptionId) backend+frontend konzisztens |
| **B3** jelszó-policy | LEZÁRVA | mind a kód-kritérium teljesül; a 18 soros manuális mátrix repo-ból nem verifikálható (böngészős részverifikáció a B3 lezárásakor megtörtént) |
| **B1** revoke-access | LEZÁRVA | 16 teszt (a tervezett 15 szuperhalmaza); a tervezett `deleteBlockedRevokeInstead` i18n kulcs nem készült el → backlog #7 |
| **B4** Stripe hardening | LEZÁRVA | a mapper a terven túl a StripePermissionError-t és a „No such customer"-t is kezeli |
| **B6** DEVELOPER-seed | LEZÁRVA (operátor-attesztálva) | végrehajtva+verifikálva 2026-07-26 (login 200, role DEVELOPER, companyId null, /admin elérhető); script-hardening follow-upok → backlog #6, #17 |
| **B7** backup/restore | REPO-OLDAL LEZÁRVA | mind a 12 repo-kritérium teljesül; a Render-oldali fél a GO-feltételek közt |

## Az audit által talált és **javított** hibák (ebben a commitban)

1. **[blocker] A deploy-doksi félrevezette volna az első deployt:** a
   `render-deployment.md` env-táblája a 16 kötelező változóból 10-et sorolt fel
   „a lista teljes" állítással — a hat `STRIPE_PRICE_*` hiányzott; a deploy-sorrend
   a seedet a Stripe-setup **elé** tette, ami a config-validáció miatt nem futtatható.
   Javítva (tábla + sorrend + a `stripe:setup` kimenetének pontos leírása).
2. Ugyanez a hiány az `environment.md`-ben és az RC-checklist Part 3-ban — javítva.
3. A `production-checklist.md` azt állította, „Rate limiting / Helmet még nincs" —
   mindkettő él (K2.1.3 / K2.2); pozitív ellenőrzési tétellé átírva.
4. A CI-header „140 tests" felirata (valójában 198) — számnélkülire cserélve,
   hogy ne tudjon újra elavulni.
5. A `project-overview.md` elavult számai (19→20 route-modul, 140/10→198/16 teszt,
   17→18 modell, „22 migráció"→2 PostgreSQL-migráció + archívum) — javítva.
6. A B6 seed-sor kipipálva a production-checklistben, dátumozott verifikációs
   jegyzettel.
7. A terv fejlécére utóirat került (a hivatkozott sorszámok a javítás előtti fát
   írják le), és megszületett a [post-launch-backlog.md](post-launch-backlog.md)
   — a B1/B6 „Kész, ha" backlog-dobozai ezzel zárultak.

## GO-feltételek a deploy előtt (sorrendben; mind Anna keze)

1. **Push + CI-zöld.** A `master` több committal az `origin/master` előtt jár —
   a v1.0 #2-ben épített CI („zöld = deployolható") még **soha nem futott** a
   Launch Blockers kódon. A lokális 198/198 erős bizonyíték, de a repo saját
   kapuja a CI: push után a backend-job (postgres:16 service) zöldje zárja le
   a bizonyítási láncot.
2. **Stripe live cutover** (deploy-nap, production-checklist Stripe-szekció
   sorrendben): `sk_live_` kulcs a Render env-ben, `ALLOW_TEST_STRIPE_KEY`
   **nincs** beállítva; **Customer Portal konfiguráció elmentve a live
   Dashboardon**; `stripe:setup` live futtatása és mind a **hét** price-változó
   (legacy + 6 per-plan) bemásolása; live webhook + secret.
3. **B7 Render-oldal:** a DB tier/PG-verzió/napi backup/PITR tábla kitöltése a
   dashboardról (`render-deployment.md` 0. pont); ha nincs napi backup → döntés
   (tier-váltás vs. vállalt RPO) a `backup-restore.md`-be; dump-tárolási hely +
   titkosítás + retention rögzítése.
4. **Restore-drill lefuttatása** (`backup-restore.md` D0–D8): a D5 — második
   restore **nem üres** célba — a pass/fail mag; dátum + mért RTO a
   drill-naplóba, utána pipálhatók a backup-checklist tételek. **Enélkül a
   launch a saját tervünk szerint blokkolva marad.**
5. A production-checklist és az RC-checklist végigjárása (a többi tétel).

## Ismert, tudatosan vállalt maradékok

A teljes lista a [post-launch-backlog.md](post-launch-backlog.md)-ben — kiemelten:
a trial-tulajdonos fióktörlési 409-e (első hetek #1), a hiányzó admin-unarchive
(#2), a seat-számolás a visszavont dolgozókkal (kiadási jegyzet + #3), és a
frontend teszt-harness hiánya (#4). Egyik sem nyitja újra a blokkolók biztonsági
vagy pénzügyi kitettségét.
