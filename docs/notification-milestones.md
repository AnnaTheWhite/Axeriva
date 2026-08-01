# Axeriva — Notification & Email rendszer: mérföldkövek (N1.1 – N1.11)

*Készült: 2026-08-01. A [notification-system-plan.md](notification-system-plan.md)
**elfogadott** architektúra végrehajtási bontása. Metodika: a Design C-nél
bevált minta — mérföldkövenként terv → implementáció → adverzális review →
zöld suite + mindkét build → egyetlen, részletes commit.*

---

## 0. A véglegesített döntések (Q1–Q8)

Ezek a terv 18. szakaszának kérdései, lezárva. Az implementáció ezekre épül,
és **nem nyitjuk újra** őket mérföldkövenként.

| # | Döntés | Következmény |
|---|---|---|
| **Q1** | **Node ≥ 22.12 kötelező** | `engines` mindkét `package.json`-ban + Render `NODE_VERSION`. Előfeltétele a pg-boss 12-nek (ESM-only). Ütemezés: **N1.4**. |
| **Q2** | **A kritikus billing-értesítések nem letilthatók** (fizetési hiba, trial lejárat, előfizetés vége); a **nyugták** (`billing_receipts`) igen | A registry `mandatory` flagje dönt, nem a felhasználó. |
| **Q3** | **Stripe hosztolt PDF-link, nem csatolmány** | Nincs worker-oldali letöltés, nincs 40 MB-os kockázat. Az `OutboundEmail.attachments` mező megmarad kiterjesztési pontnak. |
| **Q4** | **Külön aldomain a marketing/digest streamnek** | `mail.axeriva.com` (tranzakciós, tracking KI) + `updates.axeriva.com` (marketing, tracking BE). DNS-munka: **N1.11**. |
| **Q5** | **Az employee-k is kapnak értesítést — de csak arról, ami közvetlenül róluk szól** | `projects.*`, `auth.*`, `employees.access_revoked` → EMPLOYEE is címzett. Minden `billing.*` és `system.*` **owner-only** marad. A volument a `projects` kategória preferencia + a digest fogja vissza. |
| **Q6** | **Új `User.language` oszlop** (nullable) | Feloldás: `User.language` → `Company.language` → `"en"`. Vegyes nyelvű csapatnál a cégszintű nyelv rossz válasz. Bevezetés: **N1.1**. |
| **Q7** | **A meglévő 5 email egy körben migrál** React Emailre | Nem üzemeltetünk két renderelőt párhuzamosan. Mérföldkő: **N1.3**. |
| **Q8** | **Retenció:** `NotificationDelivery` 12 hónap · `EmailEvent` 90 nap · `NotificationEvent` 12 hónap · `ProcessedStripeEvent` 90 nap | Egy közös prune-job takarítja mindet, beleértve a ma korlátlanul növő `ProcessedStripeEvent`-et. Mérföldkő: **N1.9**. |

---

## 1. A bontás elve

Minden mérföldkő négy feltételt teljesít:

1. **Önállóan fejleszthető** — nem igényel párhuzamos munkát másik mérföldkövön.
2. **Önállóan tesztelhető** — saját integrációs tesztekkel zárul, a teljes
   suite zöld marad.
3. **Önállóan review-zható** — egy commit, egy adverzális review-kör.
4. **Önállóan deployolható** — a `master` a mérföldkő után **bármikor
   élesíthető**: vagy nem változik a felhasználói viselkedés (additív
   infrastruktúra), vagy a változás önmagában is teljes értékű.

**A „félkész funkció soha nem látszik" szabály**: az N1.1–N1.6 mérföldkövek
után a felhasználó nem lát új felületet; az N1.7 hozza be a harangot, addigra
a mögötte lévő adat már valós.

---

## 2. Mérföldkövek

### N1.1 — Adatmodell alapok  🟢 *nulla viselkedésváltozás*

| | |
|---|---|
| **Tartalom** | 6 új Prisma-modell (`NotificationEvent`, `Notification`, `NotificationDelivery`, `EmailEvent`, `NotificationPreference`, `EmailSuppression`); `User.language String?`; additív migráció; `constants/notifications.ts` (csatorna-, kategória-, státusz-listák a „string, nem enum" konvenció szerint); `DELETE_ORDER` bővítés. |
| **Kész, ha** | A migráció lefut üres és feltöltött DB-n is; a `dedupeKey` unique constraint bizonyítottan blokkolja a duplikátumot; a `NotificationPreference` kompozit unique működik; a teljes suite zöld; mindkét build zöld. |
| **Tesztek** | Új: `notificationSchema.test.ts` — idempotencia-constraint, preferencia-unicitás, suppression-unicitás, tenant-reláció, kaszkád-viselkedés. |
| **Deploy** | Triviális: additív migráció, egyetlen sor kódot sem olvas belőle semmi. |
| **Kockázat** | Alacsony. |
| **Függ** | — |
| **Ismert korlát → N1.5** | ⚠️ A `NotificationPreference` kompozit unique **nem fedi a cég-alapértelmezés sorait**: a PostgreSQL a NULL-okat különbözőnek tekinti egy unique indexben, így két `userId = NULL` sor ugyanarra a kategória+csatorna párra beszúrható. Teszt rögzíti a tényleges viselkedést (nem feltételezésként hagyva). **Következmény N1.5-re:** a preferencia-service a cég-alapértelmezést *find-then-update* úton írja, nem csupasz `create`-tel. Alternatívák elvetve: a PG 15+ `NULLS NOT DISTINCT` és a parciális unique index sem fejezhető ki a Prisma-sémában, így mindkettő megtörné a drift-ellenőrzést. |

### N1.2 — Backend i18n  🟢 *nulla viselkedésváltozás*

| | |
|---|---|
| **Tartalom** | `server/src/i18n/` — `t(locale, key, vars)` a frontend engine mintájára (`{{var}}` interpoláció, hiányzó kulcs → `en` fallback → kulcs visszaadása); `en/notifications.json` + `hu/notifications.json` váz; `resolveLocale(user, company)`. |
| **Kész, ha** | A két katalógus **kulcsra azonos** (teszt bizonyítja); a locale-feloldás minden ágra tesztelt; nincs hívó, de a modul exportált. |
| **Tesztek** | Unit: interpoláció, fallback-lánc, hiányzó kulcs, kulcs-paritás a két nyelv között. |
| **Deploy** | Triviális: senki nem hívja. |
| **Kockázat** | Alacsony. |
| **Függ** | N1.1 (`User.language`) |

### N1.3 — React Email template engine + az 5 meglévő email migrálása  🟡 *látható változás*

| | |
|---|---|
| **Tartalom** | `tsconfig` `jsx: react-jsx`; `react`+`react-dom` szerver-dependency; `emails/components/` (BaseLayout, Header, Footer, CtaButton, InfoRow, theme); `render()`; a meglévő **5 email** átírása React Emailre **hu+en** nyelven, cég-brandinggel; a régi `templates/*.ts` törlése. |
| **Kész, ha** | Mind az 5 email mindkét nyelven renderel; a plain-text változat minden esetben generálódik; a snapshot-tesztek rögzítik a HTML-t; a meglévő email-tesztek átírva zöldek; **kézi kliens-ellenőrzés** (Gmail + Apple Mail, világos/sötét). |
| **Állapot (2026-08-01)** | **LEZÁRVA** — kód: `e22d6fa`, eszköztár: lásd lent. Az automatizált kritériumok teljesültek (297/297 teszt, mindkét build, `dist`-ből futtatott renderelés-ellenőrzés mind az 5 sablonra × 2 nyelv). **Egyetlen nyitott tétel: a valós kliensen végzett kézi ellenőrzés — ezt Anna végzi el**, `npm run emails:preview` (fájlba renderel, gitignore-olt) és `npm run emails:test-send -- <cím>` (valódi küldés a konfigurált Resend-fiókból) segítségével. Az eredmény ide jegyzendő fel. |
| **Ismert korlát** | ⚠️ A mai CTA-gomb (fehér szöveg `#f97316`-on) **2,83:1 kontrasztarány = WCAG AA bukás** (sötét szöveggel 5,18:1 lenne). A migráció ezt **szándékosan nem javította** — a márka gombjának átszínezése design-döntés. Külön tételként eldöntendő. |
| **Tesztek** | Snapshot mind az 5 × 2 nyelv; escape-teszt (a mai `escapeHtml`-teszt örököse); plain-text jelenléte. |
| **Deploy** | Önmagában értékes: szebb, brandelt, kétnyelvű levelek. **Ez az első mérföldkő, amit a felhasználó észrevesz.** |
| **Kockázat** | ⚠️ Közepes — build-lánc változás (JSX a CommonJS szerverben). Rollback: a commit revertje. |
| **Függ** | N1.2 |

### N1.4 — Queue-infrastruktúra (pg-boss)  🟢 *nulla viselkedésváltozás*

| | |
|---|---|
| **Tartalom** | Node ≥ 22.12 pin (Q1); pg-boss singleton a meglévő pool átadásával (`db` opció); `enqueue()`/`registerWorker()` **seam** (a migrációs út ára előre kifizetve); **SIGTERM graceful drain** — ma egyáltalán nincs shutdown-kezelés; `/health/workers`; `pgboss` séma migrációja CI-lépésként (`migrate: false` + CLI). |
| **Kész, ha** | A worker elindul az `index.ts`-ben, `app.ts` mellékhatás-mentes marad; egy no-op teszt-job végigmegy; SIGTERM-re a futó job befejeződik, az új nem indul; a `pg-boss doctor` drift-mentes. |
| **Tesztek** | Integrációs: enqueue → worker feldolgozás → retry backoff → DLQ; graceful shutdown. |
| **Deploy** | ⚠️ **Node-bump miatt koordinált**: Render `NODE_VERSION` **a push előtt**. Új séma a DB-ben, de üres. |
| **Kockázat** | ⚠️ Közepes-magas — ez érinti a process életciklusát. Rollback: revert + a `pgboss` séma marad (ártalmatlan). |
| **Függ** | N1.1 |

### N1.5 — Notification core (a mag)  🟡 *az 5 email átáll a pipeline-ra*

| | |
|---|---|
| **Tartalom** | `registry.ts` (a típus-katalógus); `notify()` outbox-írás; `dispatcher` (recipient → preferencia → suppression → locale → fan-out); `channels/email` + `channels/inApp`; a **meglévő 5 hívási hely** átállítása `notify()`-ra; a `Company` három kapcsolójának **végre valódi** kikényszerítése. |
| **Kész, ha** | Mind az 5 meglévő email a queue-n megy ki; a `dedupeKey` duplikátumot blokkol; a kikapcsolt kapcsoló tényleg blokkol (és `suppressionReason`-nel rögzül); in-app sorok keletkeznek; a Stripe-webhook **2xx-e nem várja meg az emailt**. |
| **Tesztek** | Preferencia-mátrix (mandatory × company toggle × user pref × suppression); idempotencia; recipient-feloldás (tombstone-szűrés!); tenant-izoláció. |
| **Deploy** | Viselkedés kifelé azonos, belül teljesen más út. |
| **Kockázat** | ⚠️ **A legnagyobb mérföldkő.** Ha túl nagynak bizonyul: N1.5a (registry + notify + dispatcher + email) és N1.5b (in-app + preferenciák) bontás. |
| **Függ** | N1.3, N1.4 |

### N1.6 — Resend webhook + delivery-követés  🟢

| | |
|---|---|
| **Tartalom** | `POST /notifications/webhook/resend` **raw-body + Svix**-verifikációval (a Stripe-webhook mintájára); `EmailEvent` írás (PK = Svix esemény-id → replay-védelem); `NotificationDelivery.status` frissítés; bounce/complaint → `EmailSuppression`. |
| **Kész, ha** | Hamis aláírás 400; ugyanaz az esemény kétszer → no-op; bounce után a cím tényleg blokkolt; `email.sent` **nem** jelenik meg „kézbesítve"-ként. |
| **Tesztek** | Aláírás-verifikáció (valós Svix-aláírással, hálózat nélkül); idempotencia; suppression-hatás. |
| **Deploy** | + Resend Dashboard: webhook-endpoint regisztráció. |
| **Kockázat** | Alacsony. |
| **Függ** | N1.5 |

### N1.7 — Notification API + frontend harang  🟡 *új felület*

| | |
|---|---|
| **Tartalom** | REST: feed, unread-count, mark-read, preferenciák (user + cég-default); `NotificationBell` a Topbarban, `NotificationList`, preferencia-UI; i18n kulcsok. |
| **Kész, ha** | A harang valós adatot mutat; olvasott-állapot perzisztens; a preferencia-UI a 3-szintű feloldást tükrözi; tenant-izolációs teszt zöld; a read-only mód nem töri. |
| **Tesztek** | Backend integrációs + tenant-izoláció. *(Frontend teszt-harness ma nincs — backlog #4.)* |
| **Deploy** | Az első felhasználó felé látható notification-funkció. |
| **Kockázat** | Alacsony-közepes (UI). |
| **Függ** | N1.5 |

### N1.8 — Stripe billing-értesítések  🟡

| | |
|---|---|
| **Tartalom** | `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming`, `payment_method.attached` felvétele a `HANDLED_EVENTS`-be (+ Dashboard); a **16 billing-template**; a plan-terv 10. szakasza szerinti leképezés. |
| **Kész, ha** | Minden §13-mátrix sor triggerelhető és tesztelt; az új események ugyanazt az idempotencia- és stale-guardot kapják; Dashboard-lépés dokumentálva. |
| **Tesztek** | Eseményenként: helyes típus, címzett, nyelv, dedupeKey. |
| **Deploy** | ⚠️ Dashboard-koordináció (a Design C rollout mintájára). |
| **Kockázat** | Közepes (pénzügyi kommunikáció). |
| **Függ** | N1.5 |

### N1.9 — Ütemezett sweepek + retenció  🟡

| | |
|---|---|
| **Tartalom** | `sweep:trial-reminders` (7/3/1 nap), `sweep:trial-expired`, `sweep:deadlines`, `digest:weekly`, `maintenance:prune` (Q8 retenció, a `ProcessedStripeEvent`-tel együtt). |
| **Kész, ha** | A sweep **többszöri futásra is** cégenként/küszöbönként pontosan egy értesítést ad (dedupeKey); időzóna helyes; a prune a Q8 határidőket tartja. |
| **Tesztek** | Idő-manipulált integrációs tesztek; kétszeri futtatás → egy email. |
| **Deploy** | ⚠️ Ez az első valódi ütemezett munka a rendszerben. |
| **Kockázat** | Közepes (idő-logika). |
| **Függ** | N1.4, N1.5 |

### N1.10 — Monitoring + admin  🟢

| | |
|---|---|
| **Tartalom** | `/admin/notifications` (delivery-napló, DLQ-újraküldés, statisztika); küszöb-riasztások (`ops.*`); bounce/complaint arány. |
| **Kész, ha** | A support meg tudja válaszolni a „miért nem kapta meg?" kérdést a felületről; a DLQ nem néma. |
| **Kockázat** | Alacsony. |
| **Függ** | N1.6 |

### N1.11 — Production rollout  🔴 *ops*

| | |
|---|---|
| **Tartalom** | Aldomain-szétválasztás + DNS (Q4); DMARC ramp (`p=none` → `quarantine` → `reject`); env-változók; monitoring-küszöbök élesítése; **rollout- és rollback-dokumentum** a Design C mintájára. |
| **Kész, ha** | A checklist minden pontja kipipálva; a rollback-terv verifikált. |
| **Kockázat** | ⚠️ DNS-átfutás. |
| **Függ** | mind |

---

## 3. Függőségi sorrend

```
N1.1 ──┬── N1.2 ── N1.3 ──┐
       │                   ├── N1.5 ──┬── N1.6 ── N1.10 ──┐
       └── N1.4 ───────────┘          ├── N1.7            ├── N1.11
                    │                 └── N1.8            │
                    └───────────────────── N1.9 ──────────┘
```

**Párhuzamosítható:** N1.2 és N1.4 egymástól függetlenek. **Kritikus út:**
N1.1 → N1.4 → N1.5 → N1.9.

---

*Aktuális állapot: **N1.1 implementációja folyamatban**. A többi mérföldkő
terv szinten rögzítve, implementáció nem kezdődött el.*
