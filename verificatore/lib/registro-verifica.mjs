// IL VERIFICATORE INDIPENDENTE DEL REGISTRO DEI CONSENSI — la logica pura (24/09, registro A).
//
// ⭐ INDIPENDENTE vuol dire tre cose, e tutte e tre sono vincoli su questo file:
//   1. NON importa niente dal backend: il canonical è RISCRITTO qui, dal contratto pubblico (il LEGGIMI;
//      nel codice del backend `docs/registro-consensi-formato.md`). Un caso int prova che coincide con
//      `audit.ts`. ⚠️ E vive anche nel repo pubblico delle àncore: → `prepara-verificatore-pubblico.mjs`.
//   2. NON usa dipendenze: solo `node:crypto`. Il titolare lo esegue con Node, e lo legge in pochi minuti.
//   3. NON si fida del nostro server: ricalcola gli hash dal file e li confronta con le àncore di un repo
//      che non controlliamo da soli (branch protection, create-once).
//
// ⚠️ COSA NON PROVA, e va detto a chi lo usa (C1 di CRI2):
//   - le righe scritte DOPO l'ultima àncora non hanno prova esterna: è la «finestra non provata»,
//     dichiarata nel referto;
//   - il repo delle àncore lo scriviamo noi: il WORM impedisce di riscriverlo, non di smettere di scriverlo.
//     Un tenant senza àncore è un ESITO da riportare, non un verde;
//   - un clone del repo vecchio non vede le àncore recenti: si verifica su un clone fresco.

import { createHash } from 'node:crypto'

import {
  canonicalCheckpoint,
  CHECKPOINT,
  controllaCheckpoint,
  problemaDelCheckpoint,
  ripartenzaDi,
  righeTagliate,
  SCHEMA_V4,
} from './registro-checkpoint.mjs'

export const GENESIS = 'GENESIS'

/**
 * Il canonical di una riga, BYTE PER BYTE come lo scrive il backend: `JSON.stringify` di ECMAScript
 * (niente spazi, caratteri non ASCII NON scappati), chiavi in quest'ordine, e il blocco della versione.
 * ⛔ Nessuna normalizzazione Unicode: si hasha la stringa così com'è (lo slug di una Property può non
 * essere ASCII).
 */
export const canonicalRiga = (r) => {
  // V4, il checkpoint della conservazione: canonical suo (`registro-checkpoint.mjs`).
  if (r.schemaVersion === SCHEMA_V4 || r.eventType === CHECKPOINT) {
    const problema = r.schemaVersion === SCHEMA_V4 ? problemaDelCheckpoint(r) : 'un checkpoint deve avere schemaVersion 4'
    if (problema !== null) throw new Error(`schema 4 malformata: ${problema}`)
    return canonicalCheckpoint(r)
  }
  const base = {
    tenantSlug: r.tenantSlug,
    eventType: r.eventType,
    subjectPseudonym: r.subjectPseudonym,
    categories: { analytics: r.categories.analytics, marketing: r.categories.marketing },
    locale: r.locale,
    bannerVersion: r.bannerVersion,
    policyVersion: r.policyVersion,
    bannerTextHash: r.bannerTextHash,
    ipTruncated: r.ipTruncated,
    eventTimestamp: r.eventTimestamp,
  }
  if (r.schemaVersion == null) {
    return JSON.stringify(base)
  }
  // ⛔ Come il backend: una struttura malformata è un FAIL, mai riparata in un valore che verifica.
  // Senza, una riga con `deferred: 2` e un hash calcolato su quel valore passerebbe qui e non là.
  if (r.schemaVersion === 2 || r.schemaVersion === 3) {
    if (typeof r.deferred !== 'boolean') throw new Error(`schema ${r.schemaVersion} malformata: deferred non è un boolean`)
    if (r.clientReportedAt !== null && !Number.isInteger(r.clientReportedAt)) {
      throw new Error(`schema ${r.schemaVersion} malformata: clientReportedAt non è null né un intero`)
    }
  }
  if (r.schemaVersion === 2) {
    if (r.deferred !== (r.clientReportedAt !== null)) {
      throw new Error('schema 2 malformata: deferred e clientReportedAt non concordano')
    }
    return JSON.stringify({ ...base, schemaVersion: 2, deferred: r.deferred, clientReportedAt: r.clientReportedAt })
  }
  if (r.schemaVersion === 3) {
    if (typeof r.providersHash !== 'string' || !/^[0-9a-f]{64}$/.test(r.providersHash)) {
      throw new Error('schema 3 malformata: providersHash non è uno sha256 esadecimale')
    }
    return JSON.stringify({
      ...base,
      schemaVersion: 3,
      deferred: r.deferred,
      clientReportedAt: r.clientReportedAt,
      providersHash: r.providersHash,
    })
  }
  throw new Error(`schemaVersion sconosciuta: ${JSON.stringify(r.schemaVersion)}`)
}

/** SHA-256 esadecimale dei byte UTF-8 di `prevHash|canonical`. */
export const hashRiga = (prevHash, r) => createHash('sha256').update(`${prevHash}|${canonicalRiga(r)}`, 'utf8').digest('hex')

/**
 * Ricalcola UNA catena (le righe di un `tenantSlug`, nell'ordine del file) da GENESIS, o dall'ultima
 * riga tolta se un checkpoint dichiara la ripartenza.
 * ⇒ `{ problemi, indiceDi, ripartenza }`: `indiceDi` mappa l'hash DICHIARATO di ogni riga alla sua
 * posizione (0-based); che l'hash sia valido lo dicono i `problemi`, e con un problema il referto
 * fallisce comunque.
 */
export const verificaCatena = (righe) => {
  const problemi = []
  const indiceDi = new Map()
  const ripartenza = ripartenzaDi(righe, GENESIS)
  let atteso = ripartenza?.riga.lastDeletedHash ?? GENESIS
  righe.forEach((r, i) => {
    try {
      if (hashRiga(r.prevHash, r) !== r.hash) {
        problemi.push(`riga ${i + 1}: MANOMESSA (l'hash non si ricalcola dai suoi campi)`)
      }
    } catch (e) {
      problemi.push(`riga ${i + 1}: ${e.message}`)
    }
    // Un prevHash sbagliato copre tre casi, tutti FAIL: una riga cancellata in mezzo, un fork, un
    // riordino del file.
    if (r.prevHash !== atteso) {
      problemi.push(`riga ${i + 1}: ANELLO MANCANTE (prevHash non è l'hash della riga precedente)`)
    }
    if (!indiceDi.has(r.hash)) {
      indiceDi.set(r.hash, i)
    }
    atteso = r.hash
  })
  return { indiceDi, problemi, ripartenza }
}

const aggiungi = (mappa, chiave, valore) => {
  const lista = mappa.get(chiave) ?? []
  lista.push(valore)
  mappa.set(chiave, lista)
}

/**
 * Il referto completo di un export contro le àncore.
 * - `intestazione`: la prima riga dell'export.
 * - `righe`: le altre, nell'ordine del file.
 * - `ancore`: `[{ percorso, documento }]`, cioè i JSON del repo delle àncore (cartella `anchors/`).
 * ⇒ `{ esito: 'verificato' | 'nessuna-ancora' | 'fallito', catene: [...], problemi: [...] }`.
 */
export const verificaRegistro = ({ intestazione, righe, ancore }) => {
  const problemi = []
  const esportatoIl = Date.parse(intestazione.exportedAt)
  if (Number.isNaN(esportatoIl)) {
    return { catene: [], esito: 'fallito', problemi: ['intestazione senza exportedAt valido'] }
  }
  const perSlug = new Map()
  for (const r of righe) aggiungi(perSlug, r.tenantSlug, r)
  // ⭐ Le NOSTRE àncore anteriori all'export: sono quelle la cui testa dev'essere nel file (o tagliata
  // da un checkpoint che regge).
  const nostre = ancore.filter(({ documento: d }) => {
    const quando = Date.parse(d?.anchoredAt)
    if (Number.isNaN(quando) || quando >= esportatoIl || !Array.isArray(d?.entries)) return false
    return (
      (d.schemaVersion === 2 && d.installationRef === intestazione.installationRef) ||
      (d.schemaVersion === 1 && d.installationId === intestazione.installationId)
    )
  })

  const catene = []
  for (const dichiarata of intestazione.catene) {
    const proprie = perSlug.get(dichiarata.tenantSlug) ?? []
    const esito = {
      tenantSlug: dichiarata.tenantSlug,
      righe: proprie.length,
      ancoreVerificate: 0,
      ultimaAncora: null,
      // La «finestra non provata» (C1): le righe DOPO la testa più avanzata fra quelle verificate.
      righeNonProvate: proprie.length,
      // Le àncore la cui testa è stata tolta dalla conservazione: né verificate né mancanti.
      ancoreCoperte: 0,
      ripartenza: null,
      problemi: [],
    }
    if (proprie.length !== dichiarata.righe) {
      esito.problemi.push(`l'intestazione dichiara ${dichiarata.righe} righe, il file ne contiene ${proprie.length}`)
    }
    const { indiceDi, problemi: problemiCatena, ripartenza } = verificaCatena(proprie)
    esito.problemi.push(...problemiCatena)
    // ⚠️ Il minimo di conservazione viene dall'INTESTAZIONE, che chi ha il DB non scrive (C2 di CRI2):
    // un file senza la dichiarazione non ammette nessun checkpoint.
    esito.problemi.push(
      ...controllaCheckpoint({
        righe: proprie,
        indiceDi,
        ancore: nostre,
        catena: dichiarata,
        riferimento: esportatoIl,
        retentionDaysMinimo: Number.isInteger(intestazione.retentionDays) ? intestazione.retentionDays : Number.POSITIVE_INFINITY,
      }),
    )
    if (ripartenza !== null) {
      esito.ripartenza = { anchorPath: ripartenza.riga.anchorPath, lastDeletedHash: ripartenza.riga.lastDeletedHash }
    }
    // Il confine del taglio: l'àncora nominata dal checkpoint della ripartenza. Una testa ancorata non
    // dopo di lei è stata tolta con lei.
    const nominata = ripartenza === null ? undefined : nostre.find((a) => a.percorso === ripartenza.riga.anchorPath)
    const confine = nominata === undefined ? Number.NaN : Date.parse(nominata.documento.anchoredAt)
    // Solo per le v1 NON coperte, che esistono fra il primo taglio e la fine delle v1: lì la somma è esatta.
    const tagliate = righeTagliate(proprie)

    // ⭐ TUTTE le àncore di questo tenant con `anchoredAt` PRIMA dell'export, non «quelle che trovo»:
    // una testa assente dal file vuol dire righe tolte dopo l'ancoraggio — o dalla conservazione.
    for (const { percorso, documento: d } of nostre) {
      const v2 = d.schemaVersion === 2
      for (const e of d.entries) {
        if (v2 && e.tenantRef !== dichiarata.tenantRef) continue
        if (!v2 && e.tenantSlug !== dichiarata.tenantSlug) continue
        // v2: la testa per HASH (il ricalcolo dell'intera catena qui sopra copre il suo prefisso).
        // v1: la testa per POSIZIONE, come la v1 è stata scritta (`id` non è nel file: l'ordine del
        // file è l'ordine per id), meno le righe che la conservazione ha tolto.
        const ordinale = v2 ? null : e.anchoredCount - tagliate
        const posizione = v2
          ? (indiceDi.get(e.headHash) ?? -1)
          : proprie[ordinale - 1]?.hash === e.headHash
            ? ordinale - 1
            : -1
        // La copertura si decide col TEMPO, v1 e v2 allo stesso modo (C3 di CRI2): l'ordinale con l'offset
        // smette di valere quando un taglio porta via i checkpoint di quelli precedenti.
        const coperta = ripartenza !== null && posizione === -1 && Date.parse(d.anchoredAt) <= confine
        if (posizione >= 0) {
          esito.ancoreVerificate += 1
          esito.righeNonProvate = Math.min(esito.righeNonProvate, proprie.length - (posizione + 1))
          esito.ultimaAncora = esito.ultimaAncora === null || d.anchoredAt > esito.ultimaAncora ? d.anchoredAt : esito.ultimaAncora
        } else if (coperta) {
          esito.ancoreCoperte += 1
        } else {
          esito.problemi.push(`${percorso}: la testa ancorata ${String(e.headHash).slice(0, 12)}… non è nel file — righe tolte dopo l'ancoraggio, o file incompleto`)
        }
      }
    }
    catene.push(esito)
  }
  for (const slug of perSlug.keys()) {
    if (!intestazione.catene.some((c) => c.tenantSlug === slug)) {
      problemi.push(`righe del tenant «${slug}» non dichiarate nell'intestazione`)
    }
  }
  const fallito = problemi.length > 0 || catene.some((c) => c.problemi.length > 0)
  // Un file senza catene non prova niente, esattamente come una catena senza àncore.
  const senzaAncore = catene.length === 0 || catene.some((c) => c.ancoreVerificate === 0)
  return { catene, esito: fallito ? 'fallito' : senzaAncore ? 'nessuna-ancora' : 'verificato', problemi }
}

/** Le righe di un export JSONL: la prima è l'intestazione. */
export const leggiExport = (testo) => {
  const righe = testo.split('\n').filter((r) => r.trim() !== '').map((r) => JSON.parse(r))
  const [intestazione, ...eventi] = righe
  if (intestazione?.formato !== 'frontedo-registro-consensi') {
    throw new Error("la prima riga non è l'intestazione di un export del registro dei consensi")
  }
  return { intestazione, righe: eventi }
}

/**
 * Le àncore dell'installazione dal clone del repo: le due cartelle `anchors/<installationRef>/` (v2) e
 * `anchors/<installationId>/` (v1, la storia), lette per intero. Solo `node:fs`.
 * ⇒ `{ ancore: [{ percorso, documento }], problemi }`: un file illeggibile NELLE NOSTRE cartelle è un
 * problema da riportare, non un file da saltare.
 */
export const leggiAncore = (cartellaClone, intestazione, fs) => {
  const ancore = []
  const problemi = []
  const radice = `${cartellaClone}/anchors`
  if (!fs.existsSync(radice)) {
    problemi.push(`${radice} non esiste: non è un clone del repo delle àncore`)
    return { ancore, problemi }
  }
  const cammina = (rel) => {
    const assoluto = `${radice}/${rel}`
    if (!fs.existsSync(assoluto)) return
    for (const voce of fs.readdirSync(assoluto, { withFileTypes: true })) {
      const figlio = `${rel}/${voce.name}`
      if (voce.isDirectory()) {
        cammina(figlio)
      } else if (voce.isFile() && voce.name.endsWith('.json')) {
        try {
          ancore.push({ percorso: `anchors/${figlio}`, documento: JSON.parse(fs.readFileSync(`${radice}/${figlio}`, 'utf8')) })
        } catch (e) {
          problemi.push(`anchors/${figlio}: illeggibile (${e.message})`)
        }
      }
    }
  }
  // ⛔ I due nomi vengono dal file, che il verificatore non si fida a priori: un nome con un separatore
  // porterebbe la lettura fuori da `anchors/`.
  for (const nome of [intestazione.installationRef, intestazione.installationId]) {
    if (typeof nome !== 'string' || nome === '' || /[\\/]|\.\./.test(nome)) {
      problemi.push(`nome di cartella non valido nell'intestazione: ${JSON.stringify(nome)}`)
    } else {
      cammina(nome)
    }
  }
  return { ancore, problemi }
}
