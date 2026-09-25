// verifica-registro-consensi — il verificatore che il TITOLARE esegue da solo, sul proprio computer.
//
//   git clone https://github.com/frontedo/frontedo-anchors
//   node frontedo-anchors/verificatore/verifica-registro-consensi.mjs <export.jsonl> frontedo-anchors
//
// Serve solo Node (≥ 20): nessuna dipendenza, nessuna rete, nessun accesso al nostro backend.
// Il formato del file e cosa la verifica prova (e cosa NON prova): il LEGGIMI accanto a questo file.
// ⚠️ QUESTO FILE VIVE IN DUE POSTI: nel codice del backend (`scripts/`) e, identico byte per byte, nel
// repo pubblico delle àncore (`verificatore/`), dove lo prende il titolare. La copia la prepara
// `scripts/prepara-verificatore-pubblico.mjs`, e un guard cross-repo le tiene uguali.
//
// Esito:
//   exit 0  VERIFICATO      ogni catena si ricalcola e ogni àncora anteriore all'export trova la sua testa
//   exit 1  FALLITO         una riga manomessa o mancante, una testa ancorata assente, un file incompleto
//   exit 2  NESSUNA ÀNCORA  le catene sono integre ma almeno una non ha prova esterna: NON è un verde
//
// ⚠️ Il clone va fatto ADESSO: un clone vecchio non vede le àncore recenti, e la finestra non provata
// risulterebbe più larga di quanto è.

import { existsSync, readdirSync, readFileSync } from 'node:fs'

import { leggiAncore, leggiExport, verificaRegistro } from './lib/registro-verifica.mjs'

const [fileExport, cartellaClone] = process.argv.slice(2)
if (!fileExport || !cartellaClone) {
  console.error('Uso: node verifica-registro-consensi.mjs <export.jsonl> <cartella del clone di frontedo-anchors>')
  process.exit(1)
}

let letto
try {
  letto = leggiExport(readFileSync(fileExport, 'utf8'))
} catch (e) {
  console.error(`✗ ${fileExport}: ${e.message}`)
  process.exit(1)
}
const { intestazione, righe } = letto
const { ancore, problemi: problemiAncore } = leggiAncore(cartellaClone, intestazione, { existsSync, readdirSync, readFileSync })
const referto = verificaRegistro({ intestazione, righe, ancore })

console.log(`Registro dei consensi — Property ${intestazione.property.id} («${intestazione.property.slug}»)`)
console.log(`Esportato il ${intestazione.exportedAt} · ${righe.length} righe · ${ancore.length} àncore lette dal clone`)
for (const c of referto.catene) {
  console.log(`\n▸ catena «${c.tenantSlug}»: ${c.righe} righe`)
  if (c.ripartenza !== null) {
    console.log(`  ↳ riparte da un taglio della conservazione, coperto da ${c.ripartenza.anchorPath}`)
  }
  if (c.ancoreCoperte > 0) {
    console.log(`  ↳ ${c.ancoreCoperte} àncore con la testa tolta dalla conservazione (coperte dal checkpoint)`)
  }
  if (c.ancoreVerificate === 0) {
    console.log('  ⚠ nessuna àncora: questa catena non ha prova esterna')
  } else {
    console.log(`  ✓ ${c.ancoreVerificate} àncore verificate, l'ultima del ${c.ultimaAncora}`)
    console.log(`  ⚠ finestra non provata: ${c.righeNonProvate} righe scritte dopo l'ultima testa ancorata`)
  }
  for (const p of c.problemi) console.log(`  ✗ ${p}`)
}
for (const p of [...problemiAncore, ...referto.problemi]) console.log(`✗ ${p}`)

const fallito = referto.esito === 'fallito' || problemiAncore.length > 0
if (fallito) {
  console.log('\nESITO: FALLITO')
  process.exit(1)
}
if (referto.esito === 'nessuna-ancora') {
  console.log('\nESITO: NESSUNA ÀNCORA — le catene sono integre, ma senza prova esterna non provano niente contro chi le custodisce')
  process.exit(2)
}
console.log('\nESITO: VERIFICATO')
