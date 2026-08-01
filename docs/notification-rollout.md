# Axeriva — Notification modul: deployment checklist

*Készült: 2026-08-01. A [notification-milestones.md](notification-milestones.md)
mérföldköveinek üzemeltetési kísérője. Mérföldkövenként egy szakasz: mit kell
tenni **a push előtt**, mi történik magától, és hogyan lehet visszaállni.*

---

## 0. A sorozat állapota

| Mérföldkő | Commit | Ops-teendő deploy előtt | Felhasználó látja? |
|---|---|---|---|
| N1.1 — Adatmodell | `d1f7519` | — | nem |
| N1.2 — Backend i18n | `11a2182` | — | nem |
| N1.3 — React Email | `e22d6fa` + `e407af6` | — | **igen** (levelek kinézete, nyelve) |
| N1.4 — pg-boss queue | `6d54642` | ⚠️ **Node 22.12 a Renderen** | nem |
| N1.5 — Notification core | `4096723` | — | nem (kifelé azonos viselkedés, belül a pipeline) |
| N1.6 — Resend webhook | `0b9e291` | ⚠️ **Resend Dashboard + `RESEND_WEBHOOK_SECRET`** | nem |
| N1.7 — API + harang | `85f3180` | — | **igen** (harang a Topbarban, értesítési beállítások) |

*(ADR-001 — `19d2f12` — dokumentum, nincs ops-vonzata.)*

**A sorozat még nincs pusholva.** A `master` hét notification-commitot
tartalmaz a Design C rollout előtti állapot fölött.

---

## 1. Egyetlen blokkoló lépés: Node 22.12 (N1.4)

Ez az egyetlen pont, ahol a sorrend megsértése **bukott deployt** okoz.

**Miért:** a pg-boss 12 ESM-only csomag, a szerver CommonJS. Csak a Node
`require(esm)` támogatásán át tölthető be, ami **22.12-ben** jelent meg.
Régebbi runtime-on az indulás `ERR_REQUIRE_ESM`-mel elszáll — a hibaüzenet
kódhibának látszik, pedig környezeti.

**Teendő, push ELŐTT:**

1. Render Dashboard → a backend Web Service → **Environment**
2. `NODE_VERSION` = `22.12` (vagy újabb) — ha nincs ilyen változó, hozd létre
3. Mentés (ez önmagában nem indít deployt, ha „Save" és nem „Save and deploy")

**Ellenőrzés a deploy után:** a boot-logban meg kell jelennie:
```
[queue] started (schema: pgboss, poll: 10s per worker)
Axeriva API v1.0.0 running on port ... (production)
```
A `[queue] started` sornak a `running on port` **előtt** kell állnia.

⚠️ **A health-check maradjon `/health`.** A `/health/workers` szándékosan
503-at ad, ha a queue leállt — egy háttér-alrendszer nem dönthet el egy
deployt. A `/health/workers` a monitoringé.

---

## 1b. Nem blokkoló, de a push napján elvégzendő: Resend webhook (N1.6)

Ez **nem** buktatja el a deployt, és szándékosan nem is: a
`RESEND_WEBHOOK_SECRET` hiánya esetén a végpont 400-at ad, elveszik a
kézbesítési telemetria, de az API fut tovább (lásd N1.6 „Eltérés a tervtől").
Ha viszont kimarad, **csendben** marad ki: nem lesz `delivered`/`bounced`
állapot, a bounce-olt címek nem kerülnek suppression-listára, és ez csak
hetekkel később, romló domain-reputációként jelentkezik.

**Teendő:**

1. Resend Dashboard → **Webhooks** → *Add endpoint*
2. URL: `https://<backend-host>/notifications/webhook/resend`
3. Események: legalább `email.delivered`, `email.bounced`, `email.complained`
   (az `email.sent` felvehető, de **soha nem** jelenik meg „kézbesítve"-ként)
4. A megjelenő **signing secret** (`whsec_…`) → Render → Environment →
   `RESEND_WEBHOOK_SECRET`
5. Deploy

**Ellenőrzés:** a Resend Dashboard *Send test event* gombja után
`SELECT COUNT(*) FROM "EmailEvent";` nő eggyel. Hamis titokkal küldött kérés
400-at kap — ezt a suite valós Svix-aláírással már bizonyítja, hálózat nélkül.

---

## 1c. N1.7 — nincs ops-teendő

Séma-változás nincs, migráció nincs, új env-változó nincs, Dashboard-lépés
nincs. A mérföldkő hét végpontot és a frontend harangot adja hozzá. Egyetlen
üzemeltetési vonzata, hogy a `/notifications` prefix innentől **két** mountot
szolgál ki: a publikus, nyers-body-s Resend webhookot (`/webhook/resend`,
korábban mountolva) és a hitelesített routert. A sorrend megfordulása
csendben 401-esítené a webhookot — ezért van rá `dist` elleni boot-ellenőrzés
a mérföldkő zárásában, és ezért maradjon a `/notifications/webhook/resend`
`app.ts`-beli mountja **az `express.json()` előtt**.

---

## 2. Ami magától megtörténik

| Mi | Mikor | Megjegyzés |
|---|---|---|
| `20260801100000_notification_module_foundation` migráció | a start command `prisma migrate deploy` lépésében | Additív: egy nullable oszlop + hat új tábla. Meglévő sort nem ír át. |
| `pgboss` séma létrehozása | az első `startQueue()`-nál, boot közben | pg-boss saját migrációi. Külön sémában, a Prisma `public`-jától elszigetelve — a drift-ellenőrzés ezt igazoltan nem látja. |
| A `notify/dlq` sor létrehozása | minden boot | Idempotens. |

**Új env-változó a queue-hoz nincs** — a meglévő `DATABASE_URL`-t használja.
Az egyetlen új változó a sorozatban a `RESEND_WEBHOOK_SECRET` (N1.6, lásd
1b.), és az sem kötelező a boothoz.

---

## 3. Deploy utáni ellenőrzés (5 perc)

- [ ] `/health` → 200
- [ ] `/health/workers` → 200, `{"status":"ok"}`
- [ ] Boot-log: `[queue] started` a `running on port` előtt, `FATAL` nélkül
- [ ] Egy regisztráció végigmegy (a welcome + verifikációs levél megérkezik)
- [ ] A levelek a helyes nyelven érkeznek (magyar cégnyelv → magyar levél)
- [ ] DB: `SELECT COUNT(*) FROM pgboss.job;` fut hibátlanul
- [ ] **N1.5:** `SELECT status, COUNT(*) FROM "NotificationDelivery" GROUP BY 1;`
      — a friss sorok `sent`/`delivered`, nem `pending`-ben ragadva
- [ ] **N1.6:** `POST /notifications/webhook/resend` aláírás nélkül → **400**
      (nem 401 — ha 401, a mount-sorrend elromlott, lásd 1c.)
- [ ] **N1.6:** a Dashboard *Send test event* után `"EmailEvent"` nő
- [ ] **N1.7:** bejelentkezve a harang megjelenik a Topbarban;
      `GET /notifications/unread-count` token nélkül → **401**
- [ ] **N1.7:** Beállítások oldal → „Értesítési beállítások" szekció betölt,
      egy kapcsoló mentése 200-at ad és újratöltés után is megmarad

---

## 4. Rollback

**Kód:** `git revert` a mérföldkő-commitokra, fordított sorrendben, a
migrációs mappa megtartásával — ugyanaz a minta, mint a Design C rolloutnál:

```bash
git revert --no-commit 85f3180 0b9e291 4096723 6d54642 e407af6 e22d6fa 11a2182 d1f7519
git checkout HEAD -- server/prisma/migrations/
git commit -m "revert(notifications): N1.1-N1.7 rollback (migration kept)"
```

**Részleges rollback.** A mérföldkövek szándékosan önállóan deployolhatók, így
a teljes sorozat visszavonása ritkán a helyes válasz:

| Mit vonsz vissza | Parancs | Mi marad |
|---|---|---|
| Csak a harang (N1.7) | `git revert 85f3180` | A pipeline megy tovább, in-app sorok keletkeznek, csak nem látszanak |
| Harang + webhook (N1.7, N1.6) | `git revert 85f3180 0b9e291` | A levelek mennek, a kézbesítési telemetria áll |
| A pipeline is (N1.5-től) | `git revert 85f3180 0b9e291 4096723` | Az 5 email visszaáll a közvetlen küldésre |

⚠️ N1.5 visszavonása után a `NotificationEvent` sorok `pending`-ben maradnak;
ártalmatlanok (senki nem olvassa őket), és a re-deploy után a sweep felveszi
azt, ami még nem járt le.

**Adatbázis:** nem kell visszamigrálni. A migráció additív, a régi kód a hat
új táblát és a `User.language` oszlopot nem ismeri és nem is zavarja (a Prisma
explicit oszlop-listákkal ír).

**`pgboss` séma:** maradhat. A régi kód nem nyúl hozzá. Törölni csak akkor,
ha végleg elvetjük a queue-t — és csak üres `job` táblával
(`SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created','active');`).

**Node-verzió:** a `NODE_VERSION=22.12` maradhat a Renderen rollback után is
— a régi kód is elfut rajta (`engines: >=20` volt, a 22.12 ezt kielégíti).

**`RESEND_WEBHOOK_SECRET`:** maradhat a Renderen. A régi kód nem olvassa. A
Resend Dashboard webhook-endpointja is maradhat — a végpont eltűnése után a
Resend 404-et kap és leáll az újrapróbálkozással.

**Mellékhatás rollback alatt:** a levelek visszaállnak angolra és a régi,
string-alapú sablonokra. Pénzt vagy adatot nem érint. A harang eltűnik; a már
megírt `Notification` sorok megmaradnak és a re-deploy után újra látszanak
(az olvasott-állapot is), mert a rollback egyetlen sort sem töröl.

---

## 5. Nyitott tétel (nem blokkoló)

- **N1.3 kézi kliens-teszt** — Gmail + Apple Mail, világos/sötét. Eszközök:
  `npm run emails:preview`, illetve `npm run emails:test-send -- <cím>`.
  Anna végzi; az eredmény a `notification-milestones.md` N1.3 sorába kerül.
- **WCAG:** a jelenlegi CTA-gomb (fehér `#f97316`-on) 2,83:1 — AA-bukás.
  Design-döntést igényel, lásd N1.3 „Ismert korlát".

---

*A későbbi mérföldkövek (N1.8-tól) saját szakaszt kapnak itt, amint
elkészülnek. Az N1.8 Stripe Dashboard-koordinációt igényel (négy új
esemény felvétele), tehát ott újra lesz blokkoló, sorrendfüggő lépés.*
