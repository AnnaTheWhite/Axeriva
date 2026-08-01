# Architecture Decision Records (ADR)

Egy ADR **egyetlen, nehezen visszafordítható döntést** rögzít: mi volt a
helyzet, mit döntöttünk, mit adtunk fel érte, és milyen alternatívákat
vetettünk el — hogy fél év múlva ne kelljen újra levezetni.

**Mi kerül ide, és mi nem.** ADR akkor születik, ha a döntés visszavonása
kódon túli költséggel jár (infrastruktúra, szolgáltató, adatmodell, futtatási
környezet), vagy ha több komoly alternatíva közül választottunk. Ami egy
commit-üzenetben elfér, az maradjon ott.

**Állapotok:** `Javasolt` → `Elfogadva` → (`Felülírva ADR-XXX által` |
`Elavult`). Egy elfogadott ADR-t **nem szerkesztünk át** — ha a döntés
megváltozik, új ADR írja felül, és a régi státusza módosul.

**Nyelv:** magyar, a modul többi tervdokumentumával egyezően; a technikai
azonosítók (csomagnevek, opciók, hibakódok) angolul.

| # | Cím | Állapot |
|---|---|---|
| [001](ADR-001-job-queue.md) | Tartós job-queue: pg-boss a BullMQ helyett | Elfogadva (2026-08-01) |
