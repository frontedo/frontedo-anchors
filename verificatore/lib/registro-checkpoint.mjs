// IL CHECKPOINT DELLA CONSERVAZIONE, visto dal verificatore INDIPENDENTE (registro B, 24/09).
//
// Stesse regole di `registro-verifica.mjs`: niente import dal backend, niente dipendenze. Il formato è
// riscritto dal contratto pubblico (`docs/registro-consensi-formato.md`), e un caso int prova che
// coincide con `src/frontedo/analytics/checkpoint.ts`.
//
// 🔴 PERCHÉ QUI CI SONO TRE CONTROLLI CHE IL BACKEND NON FA (C3 di CRI2): chi controlla il DB può
// scrivere un checkpoint che dichiara di aver tagliato le righe di ieri. Il backend non legge il repo
// delle àncore, quindi quel checkpoint gli sembra coerente. Il verificatore sì:
//   (i)   l'àncora che il checkpoint nomina esiste, e la sua testa per il tenant è `lastDeletedHash`;
//   (ii)  quell'àncora è più vecchia, della conservazione dichiarata, dell'àncora che COPRE il checkpoint
//         (tutti tempi del repo, mai della riga), e la conservazione dichiarata non è sotto la policy;
//   (iii) se il taglio è AVVENUTO, un'àncora successiva copre il checkpoint: prima si ancora, poi si taglia.
// ⇒ Con i tre controlli, chi ha il DB può «tagliare» solo ciò che la conservazione ammette.

export const CHECKPOINT = 'chain_checkpoint'
export const SCHEMA_V4 = 4
/** Sotto un anno un checkpoint non è una conservazione: è una manomissione che ne ha preso la forma. */
export const MINIMO_GIORNI = 365
const GIORNO_MS = 86_400_000
const HEX64 = /^[0-9a-f]{64}$/
const intero = (v) => Number.isInteger(v) && v > 0

export const eCheckpoint = (r) => r.eventType === CHECKPOINT && r.schemaVersion === SCHEMA_V4

/** Cosa non va nella forma di una riga V4, o `null`. Nessuna riparazione: malformata = FALLITO. */
export const problemaDelCheckpoint = (r) => {
  if (r.eventType !== CHECKPOINT) return 'schemaVersion 4 su una riga che non è un checkpoint'
  const vuoti = ['subjectPseudonym', 'locale', 'bannerVersion', 'policyVersion', 'bannerTextHash']
  const nulli = ['ipTruncated', 'deferred', 'clientReportedAt', 'providersHash']
  if (
    vuoti.some((k) => r[k] !== '') ||
    nulli.some((k) => r[k] !== null && r[k] !== undefined) ||
    r.categories?.analytics !== false ||
    r.categories?.marketing !== false
  ) {
    return 'il riempimento non è vuoto: un checkpoint non porta dati di un consenso'
  }
  if (typeof r.lastDeletedHash !== 'string' || !HEX64.test(r.lastDeletedHash)) return 'lastDeletedHash malformato'
  if (typeof r.anchorPath !== 'string' || !/^anchors\/[^\s]+\.json$/.test(r.anchorPath) || r.anchorPath.includes('..')) {
    return 'anchorPath malformato'
  }
  for (const k of ['deletedCount', 'fromTs', 'toTs', 'retentionDays']) {
    if (!intero(r[k])) return `${k} malformato`
  }
  if (r.fromTs > r.toTs) return 'fromTs è posteriore a toTs'
  if (r.retentionDays < MINIMO_GIORNI) return `retentionDays ${r.retentionDays} è sotto il minimo di ${MINIMO_GIORNI}`
  if (r.toTs > r.eventTimestamp - r.retentionDays * GIORNO_MS) {
    return 'toTs è più recente della conservazione dichiarata al momento del checkpoint'
  }
  return null
}

/** Il canonical V4: chiavi in quest'ordine, nessun campo del consenso. */
export const canonicalCheckpoint = (r) =>
  JSON.stringify({
    tenantSlug: r.tenantSlug,
    eventType: r.eventType,
    eventTimestamp: r.eventTimestamp,
    schemaVersion: SCHEMA_V4,
    lastDeletedHash: r.lastDeletedHash,
    deletedCount: r.deletedCount,
    fromTs: r.fromTs,
    toTs: r.toTs,
    anchorPath: r.anchorPath,
    retentionDays: r.retentionDays,
  })

/** Il checkpoint che dichiara la ripartenza di una catena (la prima riga non parte da GENESIS), o `null`. */
export const ripartenzaDi = (righe, genesis) => {
  const prima = righe[0]
  if (!prima || prima.prevHash === genesis) return null
  const indice = righe.findIndex((r) => eCheckpoint(r) && r.lastDeletedHash === prima.prevHash)
  return indice === -1 ? null : { indice, riga: righe[indice] }
}

/** Le righe tagliate: la somma dei `deletedCount` dei checkpoint ESEGUITI (l'ultima riga tolta non c'è più). */
export const righeTagliate = (righe) => {
  const presenti = new Set(righe.map((r) => r.hash))
  return righe.filter((r) => eCheckpoint(r) && !presenti.has(r.lastDeletedHash)).reduce((s, r) => s + r.deletedCount, 0)
}

/**
 * L'entry di un'àncora per questa catena, o `null`: v2 per `tenantRef`, v1 per `tenantSlug`.
 * ⚠️ `ancora` è già una delle NOSTRE (installazione giusta): lo filtra chi chiama.
 */
export const entryPerLaCatena = (documento, catena) =>
  documento.entries.find((e) => (documento.schemaVersion === 2 ? e.tenantRef === catena.tenantRef : e.tenantSlug === catena.tenantSlug)) ?? null

/**
 * I tre controlli di C3 su ogni checkpoint di una catena. ⇒ elenco di problemi (vuoto = regge).
 * - `righe`: la catena, in ordine; `indiceDi`: hash → posizione.
 * - `ancore`: le NOSTRE, con `anchoredAt` anteriore al riferimento, come `[{ percorso, documento }]`.
 * - `riferimento`: l'istante del giudizio, in ms — `exportedAt` per un export, l'ora del verificatore
 *   per `verify-anchors`. Non viene dal DB.
 * - `retentionDaysMinimo`: la conservazione che la policy ammette, da una fonte che chi ha il DB non
 *   scrive: l'intestazione dell'export, o la costante del verificatore.
 *
 * 🔴 OGNI TEMPO DEI CONTROLLI VIENE DAL REPO, MAI DALLA RIGA (C1 di CRI2 sul codice di B2). La prima
 * versione confrontava l'àncora nominata con `cp.eventTimestamp`, che è una colonna del DB: chi l'ha in
 * mano datava il checkpoint fra un anno, nominava l'àncora di ieri e tagliava consensi di cinque
 * giorni fa, con tutti e tre i verificatori verdi. ⇒ La conservazione si misura contro l'àncora che
 * COPRE il checkpoint — il primo impegno esterno scritto dopo di lui — o contro `riferimento` se non
 * c'è ancora; e la data del checkpoint non può superare nessuno dei due.
 */
export const controllaCheckpoint = ({ righe, indiceDi, ancore, catena, riferimento, retentionDaysMinimo }) => {
  const problemi = []
  righe.forEach((cp, i) => {
    if (!eCheckpoint(cp)) return
    const etichetta = `checkpoint alla riga ${i + 1}`
    // La conservazione dichiarata non è sotto quella della policy (C2): da 365 a 731 giorni è un buco.
    if (!(cp.retentionDays >= retentionDaysMinimo)) {
      problemi.push(`${etichetta}: dichiara ${cp.retentionDays} giorni di conservazione, la policy ne vuole ${retentionDaysMinimo}`)
    }
    // (i) l'àncora nominata esiste e la sua testa è l'ultima riga tagliata
    const nominata = ancore.find((a) => a.percorso === cp.anchorPath)
    const entry = nominata ? entryPerLaCatena(nominata.documento, catena) : null
    if (!nominata) {
      problemi.push(`${etichetta}: l'àncora nominata ${cp.anchorPath} non è nel clone`)
      return
    }
    if (entry?.headHash !== cp.lastDeletedHash) {
      problemi.push(`${etichetta}: la testa di ${cp.anchorPath} per questa catena non è l'ultima riga tagliata`)
    }
    // La copertura: fra le àncore la cui testa sta al checkpoint o dopo, la PRIMA nel tempo. È il primo
    // impegno esterno scritto dopo il checkpoint, cioè la data più vicina a quella vera della riga.
    const copertura = ancore
      .filter((a) => {
        const e = entryPerLaCatena(a.documento, catena)
        return e !== null && (indiceDi.get(e.headHash) ?? -1) >= i
      })
      .map((a) => Date.parse(a.documento.anchoredAt))
      .sort((a, b) => a - b)[0]
    // (iii) se il taglio è avvenuto, un'àncora posteriore copre il checkpoint
    const eseguito = !indiceDi.has(cp.lastDeletedHash)
    if (eseguito && copertura === undefined) {
      problemi.push(`${etichetta}: il taglio è avvenuto ma nessuna àncora copre il checkpoint (prima si ancora, poi si taglia)`)
    }
    // (ii) contro il repo: l'àncora nominata è più vecchia della conservazione rispetto alla copertura,
    // o al riferimento se il checkpoint è pendente. E la riga non si data dopo ciò che la prova.
    const quando = copertura ?? riferimento
    const ancorataIl = Date.parse(nominata.documento.anchoredAt)
    if (!(ancorataIl <= quando - cp.retentionDays * GIORNO_MS)) {
      problemi.push(`${etichetta}: ${cp.anchorPath} è più recente della conservazione dichiarata (${cp.retentionDays} giorni) rispetto all'àncora che copre il checkpoint`)
    }
    if (!(cp.eventTimestamp <= quando) || !(cp.eventTimestamp <= riferimento)) {
      problemi.push(`${etichetta}: è datato dopo l'àncora che lo copre, o dopo il momento della verifica`)
    }
    if (!(cp.toTs < ancorataIl)) {
      problemi.push(`${etichetta}: l'ultima riga tagliata (toTs) non precede l'àncora che la copre`)
    }
  })
  return problemi
}
