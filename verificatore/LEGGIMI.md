# Il registro dei consensi: formato dell'export e verifica

Questo documento è il **contratto pubblico** del file che il titolare scarica dal pannello. Chi lo legge
deve poter scrivere un verificatore proprio, in qualunque linguaggio, senza guardare il nostro codice.
Il nostro verificatore di riferimento è `verificatore/verifica-registro-consensi.mjs` nel repository pubblico
delle àncore, accanto a questo documento: Node ≥ 20, nessuna dipendenza, nessuna rete.

## Cosa prova, e cosa non prova

La verifica prova che **le righe coperte da un'àncora non sono state cambiate né tolte** dopo
l'ancoraggio. Le àncore stanno nel repository pubblico `frontedo/frontedo-anchors`, scritto una volta al
giorno e protetto contro la riscrittura.

Non prova:

- **la finestra non provata**: le righe scritte dopo l'ultima àncora (al più un giorno, fino al cron
  successivo). Il verificatore la dichiara per ogni catena;
- **una catena senza àncore**: le sue righe sono coerenti fra loro, ma chi custodisce il registro
  potrebbe averle riscritte tutte. Il verificatore lo riporta come esito a sé (exit 2), mai come verde;
- **che si sia continuato ad ancorare**: il repository impedisce di riscrivere le àncore, non di
  smettere di scriverle. Un'àncora vecchia di settimane è un fatto da notare;
- **le àncore recenti su un clone vecchio**: il repository va clonato al momento della verifica.

⚠️ Il file contiene **pseudonimi dei visitatori e indirizzi IP troncati**, che sono dati personali.
Servono: entrambi entrano nell'hash, e senza non si verifica niente.

## Come si ottiene

`GET /api/analytics/consent-export?property=<id>`, dal pannello.

- Lo scaricano solo il provider e il super-admin (il titolare), con un **secondo fattore fresco**.
- Un export al minuto per utente.
- Ogni export entra nell'activity-log: chi, quando, quale Property, quante righe e quale intervallo.
- Risposta: `Content-Disposition: attachment`, `Cache-Control: no-store`, tipo `application/x-ndjson`.

## Come si verifica

    git clone https://github.com/frontedo/frontedo-anchors
    node frontedo-anchors/verificatore/verifica-registro-consensi.mjs registro.jsonl frontedo-anchors

Un solo clone porta le àncore **e** il verificatore. Chi preferisce il proprio può scriverlo da questo documento.

| exit | esito | significato |
|---|---|---|
| 0 | VERIFICATO | ogni catena si ricalcola, e ogni àncora anteriore all'export trova la sua testa nel file |
| 1 | FALLITO | una riga manomessa o mancante, una testa ancorata assente, un file più corto di quanto dichiara, un checkpoint della conservazione che non regge |
| 2 | NESSUNA ÀNCORA | le catene sono integre, ma almeno una non ha prova esterna |

## Il file

JSON Lines in UTF-8: un oggetto JSON per riga. La **prima riga è l'intestazione**, le altre sono gli
eventi.

### L'intestazione

| campo | significato |
|---|---|
| `formato` | sempre `"frontedo-registro-consensi"` |
| `versione` | `2` dal registro B (le righe portano i campi del checkpoint). Un file di versione `1` non ha checkpoint e si verifica allo stesso modo |
| `exportedAt` | l'istante dell'export (ISO 8601). Il file contiene **tutte** le righe esistenti a quell'istante |
| `installationId` | l'installazione: è la cartella delle àncore v1 |
| `installationRef` | lo pseudonimo dell'installazione: è la cartella delle àncore v2 |
| `pseudonymKeyId` | l'impronta della chiave degli pseudonimi con cui sono calcolati `installationRef` e `tenantRef` |
| `property` | `{ id, slug }` della Property esportata |
| `catene` | una voce per catena: `{ tenantSlug, tenantRef, righe, da, a }` (`da`/`a`: `eventTimestamp` della prima e dell'ultima riga) |
| `retentionDays` | la conservazione della policy, in giorni: un checkpoint che ne dichiara meno non regge. È nell'intestazione perché la scrive chi esporta, non chi ha il database |
| `avviso` | il testo qui sopra, in breve, in italiano e in inglese |

**Perché più catene.** La catena è per `tenantSlug`, lo slug che la Property aveva quando l'evento è
stato registrato. Se lo slug è cambiato, gli eventi stanno in più catene, e il file le porta tutte,
**intere**. Una catena intera può contenere righe di un'altra Property della stessa installazione che
abbia usato quello slug: ogni riga porta la sua `property`, e toglierle renderebbe la catena non
verificabile.

`property` è `null` quando la Property che ha registrato l'evento è stata **cancellata**: il database
azzera il riferimento, e la riga resta nella catena con lo slug che aveva allora. Se quello slug è stato
poi riusato da una Property nuova, le righe della vecchia compaiono nell'export della nuova, con
`property: null`. Non sono consensi della Property nuova: sono anelli della stessa catena.

### Una riga

Le righe di una catena sono consecutive e nell'ordine in cui sono state scritte.

| campo | tipo |
|---|---|
| `tenantSlug` | stringa, **anche non ASCII** |
| `eventType` | stringa |
| `subjectPseudonym` | stringa |
| `categories` | `{ analytics: boolean, marketing: boolean }` |
| `locale` | stringa |
| `bannerVersion`, `policyVersion` | stringa |
| `bannerTextHash` | stringa |
| `ipTruncated` | stringa o `null` |
| `eventTimestamp` | intero, millisecondi dall'epoca |
| `schemaVersion` | `null` (versione 1), `2`, `3`, o `4` per il checkpoint della conservazione |
| `deferred` | boolean, o `null` nelle righe di versione 1 |
| `clientReportedAt` | intero o `null` |
| `providersHash` | sha256 esadecimale nelle righe di versione 3, altrimenti `null` |
| `lastDeletedHash`, `deletedCount`, `fromTs`, `toTs`, `anchorPath`, `retentionDays` | solo nelle righe di versione 4 (il checkpoint della conservazione, più sotto); `null` in ogni consenso |
| `prevHash` | l'hash della riga precedente della catena, `"GENESIS"` per la prima |
| `hash` | l'hash di questa riga |
| `property` | l'id della Property che ha registrato l'evento (non entra nell'hash) |

## La regola dell'hash

    hash = sha256_hex( UTF-8( prevHash + "|" + canonical ) )

`canonical` è l'output di **`JSON.stringify` di ECMAScript** su un oggetto con queste chiavi, **in
quest'ordine**:

    tenantSlug, eventType, subjectPseudonym, categories{analytics, marketing}, locale,
    bannerVersion, policyVersion, bannerTextHash, ipTruncated, eventTimestamp

seguite, secondo `schemaVersion`, da:

| `schemaVersion` | chiavi aggiunte in coda |
|---|---|
| `null` | nessuna: nemmeno `schemaVersion` |
| `2` | `schemaVersion`, `deferred`, `clientReportedAt` |
| `3` | `schemaVersion`, `deferred`, `clientReportedAt`, `providersHash` |

Le righe di versione `4` sono i **checkpoint della conservazione** (`eventType: "chain_checkpoint"`) e hanno un canonical
loro, senza nessun campo del consenso, con queste chiavi in quest'ordine:

    tenantSlug, eventType, eventTimestamp, schemaVersion, lastDeletedHash, deletedCount,
    fromTs, toTs, anchorPath, retentionDays

Qualunque altro valore di `schemaVersion` è un errore, non una riga da interpretare.

Cosa significa «l'output di `JSON.stringify`», per chi lo reimplementa:

- nessuno spazio fra i token;
- i caratteri non ASCII **restano come sono**: non diventano sequenze `\uXXXX`. Si scappano solo `"`
  e `\` (come `\"` e `\\`), i caratteri di controllo sotto U+0020 (`\b` `\f` `\n` `\r` `\t` in forma
  breve, gli altri come `\u00XX` minuscolo) e i surrogati UTF-16 isolati (come `\uXXXX`);
- **nessuna normalizzazione Unicode**. Si hasha la stringa così com'è: `è` precomposto (U+00E8) ed
  `e` più l'accento combinante danno hash diversi, e solo uno dei due è quello registrato;
- gli interi si scrivono come interi (`1790000000000`), `null` come `null`.

Una riga di versione 4 è **malformata** se:

- non è un `chain_checkpoint`, o un `chain_checkpoint` non è di versione 4;
- il **riempimento** non è vuoto. Nei campi del consenso un checkpoint porta la stringa vuota (`subjectPseudonym`,
  `locale`, `bannerVersion`, `policyVersion`, `bannerTextHash`), `false` nelle categorie e `null` in `ipTruncated`,
  `deferred`, `clientReportedAt`, `providersHash`. Quei campi **non sono nell'hash**: per questo un valore diverso si
  rifiuta, o una riga checkpoint potrebbe portare dati che nessun hash copre;
- `lastDeletedHash` non è uno sha256 esadecimale, `anchorPath` non è un path `anchors/….json`, o `deletedCount`,
  `fromTs`, `toTs`, `retentionDays` non sono interi positivi, o `fromTs > toTs`;
- `retentionDays` è sotto **365**: sotto l'anno non è una conservazione, è una manomissione che ne ha preso la forma;
- `toTs > eventTimestamp − retentionDays` giorni: l'ultima riga tagliata è più recente della conservazione dichiarata.

Una riga è **malformata**, e la verifica fallisce, se in versione 2 o 3 `deferred` non è un boolean o
`clientReportedAt` non è né `null` né un intero; se in versione 2 `deferred` è vero senza
`clientReportedAt` o falso con; se in versione 3 `providersHash` non è uno sha256 esadecimale.

### Vettore di prova

Una riga di versione 3 con uno slug non ASCII. I byte UTF-8 dello slug, perché non ci sia dubbio sulla
forma Unicode: `63616666c3a82d6dc3bc6e6368656e2de69db1e4baac`.

    prevHash:  GENESIS
    canonical: {"tenantSlug":"caffè-münchen-東京","eventType":"consent_given","subjectPseudonym":"3fa85f64-5717-4562-b3fc-2c963f66afa6","categories":{"analytics":true,"marketing":false},"locale":"it","bannerVersion":"v1","policyVersion":"2026-06","bannerTextHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ipTruncated":"192.0.2.0","eventTimestamp":1790000000000,"schemaVersion":3,"deferred":false,"clientReportedAt":null,"providersHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
    byte hashati: 527
    hash:      563b1b2dddffc37805829afce3d0435c4b2fb041ceb3dfffa8427e7eab72b790

Con lo slug in forma NFD l'hash diventa `1f03ecf84aa07cef6bd156a137c97df0f7a87f9fb2640ddd394087bcfed4ddbc`:
se il vostro verificatore dà questo, sta normalizzando.

Un checkpoint (versione 4), con lo stesso slug:

    prevHash:  eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
    canonical: {"tenantSlug":"caffè-münchen-東京","eventType":"chain_checkpoint","eventTimestamp":1790000000000,"schemaVersion":4,"lastDeletedHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","deletedCount":42,"fromTs":1720000000000,"toTs":1725000000000,"anchorPath":"anchors/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd/2024/09/01/20240901T040000Z.json","retentionDays":731}
    byte hashati: 472
    hash:      ed1fc8beb7b5350aa5f398d394331ffb82f659d44a95c9c54fa67b771c73dd79

Due casi della suite (`tests/int/registro-consensi.int.spec.ts` e `tests/int/registro-checkpoint.int.spec.ts`)
provano che questi vettori, il nostro
backend e il nostro verificatore danno lo stesso hash, e che questo documento lo riporta.

## Le àncore

Si leggono le cartelle dell'installazione nel clone: `anchors/<installationRef>/` (v2) e
`anchors/<installationId>/` (v1, le àncore scritte prima del passaggio alla v2). Contano solo le àncore con
`anchoredAt` **anteriore** a `exportedAt`: la loro testa esisteva quando l'export è stato fatto, quindi
dev'essere nel file.

- **v2** (`schemaVersion: 2`): ogni voce è `{ tenantRef, headHash }`. La catena è quella con lo stesso
  `tenantRef` nell'intestazione, e la testa si trova per hash.
- **v1** (`schemaVersion: 1`): ogni voce è `{ tenantSlug, anchoredCount, headEventId, headHash }`. La
  testa è la riga in posizione `anchoredCount` (contando da 1) della catena con quel `tenantSlug`.

Poiché la catena intera si ricalcola da `GENESIS`, trovare la testa basta a dire che il prefisso
ancorato è intatto. Una testa che non c'è vuol dire righe tolte dopo l'ancoraggio, o un file incompleto.

⚠️ La rotazione della chiave degli pseudonimi non è prevista. Se avvenisse, le àncore scritte con la
chiave precedente (`pseudonymKeyId` diverso) starebbero in un'altra cartella, e un export fatto dopo non
le vedrebbe: la catena risulterebbe con meno àncore di quante ne ha.

## La conservazione: il checkpoint e la catena che riparte

Le righe più vecchie di 24 mesi (`eventTimestamp`, l'ora del **server**) si tagliano, ma il taglio lascia una prova
di sé: un **checkpoint**, cioè una riga di versione 4 in coda alla catena, che dichiara:

- `lastDeletedHash`: l'hash dell'ultima riga tagliata;
- `deletedCount`: quante righe;
- `fromTs`, `toTs`: l'`eventTimestamp` della prima e dell'ultima;
- `anchorPath`: l'àncora che le copriva;
- `retentionDays`: la conservazione applicata.

Il taglio avviene in **due fasi**. Prima il checkpoint, e le righe restano. Poi, solo quando un'àncora successiva
ha coperto il checkpoint, le righe fino a `lastDeletedHash` si cancellano. Un checkpoint senza taglio è innocuo; un
taglio senza un checkpoint ancorato non deve esistere.

Dopo il taglio la catena **riparte**: la sua prima riga ha `prevHash = lastDeletedHash` invece di `GENESIS`, e la
verifica la accetta solo se un checkpoint della catena dichiara proprio quell'hash.

Un checkpoint regge solo se supera tre controlli, **tutti contro il repo delle àncore** (il backend non li può fare).
Si chiama **copertura** la prima àncora, nel tempo, che ha per questa catena una testa uguale o successiva al
checkpoint: è il primo impegno esterno scritto dopo di lui.

1. l'àncora `anchorPath` è nel clone, e la sua testa per questa catena è `lastDeletedHash`;
2. **ogni tempo viene dal repo, mai dalla riga**:
   - l'`anchoredAt` di `anchorPath` precede di almeno `retentionDays` giorni l'`anchoredAt` della copertura (o
     `exportedAt`, se il checkpoint è ancora pendente);
   - l'`eventTimestamp` del checkpoint non supera l'`anchoredAt` della copertura né `exportedAt`;
   - `toTs` precede l'`anchoredAt` di `anchorPath`;
   - `retentionDays` non è sotto quella dell'intestazione;
3. se il taglio è avvenuto (la riga `lastDeletedHash` non c'è più), la copertura esiste.

Se uno fallisce, la verifica fallisce. Con i tre controlli, chi controlla il database può «tagliare» solo ciò che la
conservazione ammette.

⚠️ Il perché del punto 2, pagato: `eventTimestamp` è una colonna del database. Una prima versione confrontava
l'àncora nominata con quella data, e chi aveva il database poteva datare il checkpoint fra un anno, nominare
l'àncora di ieri e togliere consensi di cinque giorni prima con tutti i verificatori verdi.

**Le àncore la cui testa è stata tagliata** non si contano né come verificate né come mancanti: sono **coperte**.
- La copertura si decide **col tempo**, in v1 come in v2: è coperta ogni àncora con `anchoredAt` non successivo a
  quello dell'àncora nominata dal checkpoint della ripartenza.
- Una v1 **non** coperta si cerca per posizione, togliendo le righe tagliate: `anchoredCount − Σ deletedCount` dei
  checkpoint eseguiti presenti nella catena. La somma è esatta finché quei checkpoint restano nella catena, e le v1
  non coperte esistono solo in quel periodo.
- ⛔ La copertura di una v1 NON si decide con quella somma: il secondo taglio che porta via il primo checkpoint ne
  perde il conteggio, e una v1 legittima risulterebbe manomessa.

Il registro conserva quindi solo il **segmento corrente** e i suoi checkpoint. La storia dei tagli precedenti vive
nel repo delle àncore: la testa di ogni checkpoint vecchio è stata ancorata prima che lo si tagliasse.
