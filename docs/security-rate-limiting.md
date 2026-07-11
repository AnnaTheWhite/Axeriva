# Axeriva — Rate Limiting

A publikus (nem autentikált, vagy e-mail-küldést kiváltó) végpontok
brute-force- és abuse-védelme (K2.1.3). Kapcsolódó:
[security-authentication.md](security-authentication.md).

## Architektúra

- **Middleware-gyár:**
  [server/src/middleware/rateLimit.middleware.ts](../server/src/middleware/rateLimit.middleware.ts)
  — `createRateLimiter({ name, windowMs, max, keyGenerator? })` újrahasznosítható
  Express middleware-t ad vissza. Nincs duplikált logika: minden védett
  végpont ugyanazt a gyárat használja.
- **Konfiguráció egyetlen helyen:**
  [server/src/constants/rateLimits.ts](../server/src/constants/rateLimits.ts)
  — minden limit (ablak + max) itt él, a route-fájlokban nincs magic number.
- **Tárolás:** in-memory `Map`, fix ablakos számlálással, percenkénti
  takarító-sweeppel (memória-korlátos scanning-támadás ellen), `unref()`-elt
  timerrel. **Szándékosan nincs Redis/külső infra**: az app egyetlen
  példányban fut (SQLite + persistent disk), így a process-lokális számláló
  pontosan ugyanolyan erős, mint egy külső store. Több példányra skálázásnál
  a `Map`-et kell közös store-ra cserélni — az interfész változatlan
  maradhat.
- **Kulcsolás:** alapból a kliens IP (`req.ip` — production-ben a `trust
  proxy` beállítás miatt a Render proxyja mögött is a valós kliens-IP).
  Egyéni `keyGenerator`-ral tetszőleges kulcs képezhető (pl. IP+e-mail);
  `null` visszatérés = a kérés kimarad a limitálásból (pl. hiányzó mező,
  amit úgyis a route validációja utasít el).

## Védett végpontok és limitek

| Végpont | Limiter | Kulcs | Limit |
|---|---|---|---|
| `POST /auth/login` | `login-ip` | IP | 20 / 15 perc |
| `POST /auth/login` | `login-email` | IP + maszkolt e-mail | 5 / 15 perc |
| `POST /auth/register` | `register` | IP | 5 / óra |
| `POST /auth/forgot-password` | `forgot-password` | IP | 5 / óra |
| `POST /auth/reset-password/:token` | `reset-password` | IP | 10 / óra |
| `POST /auth/resend-verification` | `resend-verification` | IP | 3 / óra |
| `POST /invites/:token/accept` | `invite-accept` | IP | 10 / óra |

A loginon **két független limiter** ül: a laza per-IP plafon a tömeges
credential stuffing ellen (irodai/NAT-olt közös IP-ket nem bántja), a
szigorú IP+e-mail limit a célzott jelszó-találgatás ellen. Autentikált CRUD
végpontok szándékosan nincsenek limitálva.

A `forgot-password` válasza limitálás alatt is ugyanaz a generikus üzenet
létező és nem létező e-mailre — a limiter a route ELŐTT fut és csak IP-re
kulcsol, tehát user enumeration-re továbbra sem használható.

## 429-es válasz

```
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{"error":"Too many requests. Please try again later.","retryAfterSeconds":900}
```

A `Retry-After` az ablak zárásáig hátralévő másodperceket adja. Minden más
válaszformátum változatlan.

## Naplózás

Blokkoláskor egy sor megy a logba: limiter-név, metódus, útvonal, IP,
ISO-timestamp:

```
[rate-limit] blocked login-email POST /auth/login ip=1.2.3.4 at=2026-07-11T11:47:57.360Z
```

**Nem kerül logba:** jelszó, JWT, reset/invite token, e-mail-tartalom. A
login per-e-mail kulcsa maszkolt címet használ (`an***@example.com`, lásd
`maskEmail()`), így a limiter belső kulcsai sem hordoznak teljes címet.

## Bővítési útmutató (új végpont védése)

1. Vedd fel a limitet a [rateLimits.ts](../server/src/constants/rateLimits.ts)
   objektumba: `MY_ENDPOINT: { windowMs: ..., max: ... }`.
2. A route-fájlban: `const myLimiter = createRateLimiter({ name: "my-endpoint", ...RATE_LIMITS.MY_ENDPOINT });`
3. Tedd be a route middleware-láncába: `router.post("/my-endpoint", myLimiter, handler)`.
4. Egyéni kulcshoz adj `keyGenerator`-t — érzékeny azonosítót (e-mail)
   mindig maszkolva tegyél a kulcsba.

## Kliens-IP meghatározás — trusted proxy (K2.1.3a)

A limiter kulcsa a `req.ip`; hogy ez mit jelent, az Express `trust proxy`
beállításán múlik ([index.ts](../server/src/index.ts)):

- **Development** (`trust proxy` kikapcsolva): `req.ip` = a TCP-kapcsolat
  túloldala (localhostról `::1`). A kliens által küldött `X-Forwarded-For`
  headert az Express **figyelmen kívül hagyja** — hamisított headerrel nem
  lehet friss bucketet szerezni (teszttel igazolva).
- **Production** (`trust proxy: 1`): pontosan **egy** proxy-hopot
  tekintünk megbízhatónak — a Render edge proxyját, amely a valós kliens-IP-t
  a `X-Forwarded-For` **végére** fűzi. A `req.ip` így a proxy által
  hozzáfűzött (jobb szélső) érték lesz; a kliens által előre beírt, hamisított
  bal oldali bejegyzések nem számítanak (teszttel igazolva: azonos valós IP
  eltérő spoofolt bejegyzésekkel egy bucketbe esik, eltérő valós IP külön
  bucketet kap).

**Feltételezések (dokumentált):**
1. Production-ben a szerver **kizárólag** a Render proxyján keresztül érhető
   el — közvetlen internetes elérésnél a `trust proxy: 1` mellett az utolsó
   XFF-bejegyzés hamisítható lenne. Renderen ez a platform adottsága.
2. Pontosan egy megbízható proxy-réteg van (Render). Ha később CDN kerül a
   Render elé (pl. Cloudflare), a `trust proxy` értékét a hopok számához
   kell igazítani, különben a limiter a CDN IP-jét kulcsolná.
3. `req.ip` hiányára (elméleti eset) a limiter `"unknown"` közös buckettel
   esik vissza — inkább túl-limitál, mint kihagy.

## Ismert korlátok

- Process-restartkor a számlálók nullázódnak (deploy = friss ablakok) —
  egypéldányos üzemben elfogadott trade-off.
- IP-alapú limitek megosztott IP (céges NAT) mögül több felhasználót
  összevonnak — ezért laza a per-IP login-plafon, és ezért van külön
  per-e-mail szint.
- Elosztott (sok IP-s) brute force ellen az IP-kulcsolás önmagában nem véd —
  ezt a per-e-mail limiter és a K2.1.2-es tokenVersion mérsékli; teljes
  megoldás (pl. progressive delay, fiók-szintű lockout) későbbi feladat.
