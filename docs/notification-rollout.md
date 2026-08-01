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

**A sorozat még nincs pusholva.** A `master` négy notification-commitot
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

## 2. Ami magától megtörténik

| Mi | Mikor | Megjegyzés |
|---|---|---|
| `20260801100000_notification_module_foundation` migráció | a start command `prisma migrate deploy` lépésében | Additív: egy nullable oszlop + hat új tábla. Meglévő sort nem ír át. |
| `pgboss` séma létrehozása | az első `startQueue()`-nál, boot közben | pg-boss saját migrációi. Külön sémában, a Prisma `public`-jától elszigetelve — a drift-ellenőrzés ezt igazoltan nem látja. |
| A `notify/dlq` sor létrehozása | minden boot | Idempotens. |

**Új env-változó nincs.** A queue a meglévő `DATABASE_URL`-t használja.

---

## 3. Deploy utáni ellenőrzés (5 perc)

- [ ] `/health` → 200
- [ ] `/health/workers` → 200, `{"status":"ok"}`
- [ ] Boot-log: `[queue] started` a `running on port` előtt, `FATAL` nélkül
- [ ] Egy regisztráció végigmegy (a welcome + verifikációs levél megérkezik)
- [ ] A levelek a helyes nyelven érkeznek (magyar cégnyelv → magyar levél)
- [ ] DB: `SELECT COUNT(*) FROM pgboss.job;` fut hibátlanul

---

## 4. Rollback

**Kód:** `git revert` a mérföldkő-commitokra, fordított sorrendben
(`6d54642` → `e407af6` → `e22d6fa` → `11a2182` → `d1f7519`), a migrációs
mappa megtartásával — ugyanaz a minta, mint a Design C rolloutnál:

```bash
git revert --no-commit 6d54642 e407af6 e22d6fa 11a2182 d1f7519
git checkout HEAD -- server/prisma/migrations/
git commit -m "revert(notifications): N1.1-N1.4 rollback (migration kept)"
```

**Adatbázis:** nem kell visszamigrálni. A migráció additív, a régi kód a hat
új táblát és a `User.language` oszlopot nem ismeri és nem is zavarja (a Prisma
explicit oszlop-listákkal ír).

**`pgboss` séma:** maradhat. A régi kód nem nyúl hozzá. Törölni csak akkor,
ha végleg elvetjük a queue-t — és csak üres `job` táblával
(`SELECT COUNT(*) FROM pgboss.job WHERE state IN ('created','active');`).

**Node-verzió:** a `NODE_VERSION=22.12` maradhat a Renderen rollback után is
— a régi kód is elfut rajta (`engines: >=20` volt, a 22.12 ezt kielégíti).

**Mellékhatás rollback alatt:** a levelek visszaállnak angolra és a régi,
string-alapú sablonokra. Pénzt vagy adatot nem érint.

---

## 5. Nyitott tétel (nem blokkoló)

- **N1.3 kézi kliens-teszt** — Gmail + Apple Mail, világos/sötét. Eszközök:
  `npm run emails:preview`, illetve `npm run emails:test-send -- <cím>`.
  Anna végzi; az eredmény a `notification-milestones.md` N1.3 sorába kerül.
- **WCAG:** a jelenlegi CTA-gomb (fehér `#f97316`-on) 2,83:1 — AA-bukás.
  Design-döntést igényel, lásd N1.3 „Ismert korlát".

---

*A későbbi mérföldkövek (N1.5-től) saját szakaszt kapnak itt, amint
elkészülnek.*
