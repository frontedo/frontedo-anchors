# frontedo-anchors

Le **àncore** dei registri delle installazioni Frontedo: ogni giorno, per ogni installazione, l'hash
della riga più recente di ogni registro. Un'àncora scritta qui **non si può riscrivere di nascosto**: il
ramo `main` non accetta force-push né cancellazioni, nemmeno dagli amministratori, quindi ogni modifica
a un file resterebbe nella storia pubblica del repository. Chi scrive le àncore crea ogni file una volta
sola e non lo tocca più. Per questo il gestore di un registro non può cambiarne il passato senza che si
veda.

*The anchors of the registers of Frontedo installations: every day, the hash of the latest row of each
register. An anchor written here cannot be rewritten silently: the branch refuses force-pushes and
deletions, so any change to a file would stay in the public history. Whoever runs a register cannot
change its past without it showing.*

## Verificare il registro dei consensi

Se sei il titolare di un sito Frontedo, puoi scaricare il registro dei consensi dal pannello e
verificarlo **da solo**, sul tuo computer. Serve solo [Node](https://nodejs.org) 20 o più recente.

    git clone https://github.com/frontedo/frontedo-anchors
    node frontedo-anchors/verificatore/verifica-registro-consensi.mjs registro.jsonl frontedo-anchors

| exit | esito |
|---|---|
| 0 | **VERIFICATO**: ogni riga si ricalcola, e ogni àncora anteriore all'export trova la sua testa nel file |
| 1 | **FALLITO**: una riga cambiata o mancante, o un taglio della conservazione che non regge |
| 2 | **NESSUNA ÀNCORA**: il file è coerente, ma senza prova esterna non prova niente |

Il clone va fatto **al momento della verifica**: un clone vecchio non vede le àncore recenti.

Il formato del file, la regola dell'hash con i suoi vettori di prova, e cosa la verifica prova e cosa
no sono in [`verificatore/LEGGIMI.md`](verificatore/LEGGIMI.md). Da lì si può scrivere un verificatore
proprio, in qualunque linguaggio.

## Cosa c'è qui

    anchors/<installazione>/<anno>/<mese>/<giorno>/<ora>.json    le àncore del registro dei consensi
    activity-anchors/…                                            le àncore del registro delle attività
    verificatore/                                                 il verificatore e il suo LEGGIMI

Dal settembre 2026 le àncore sono **pseudonime**: la cartella e le voci portano un HMAC al posto dei
nomi dell'installazione e dei siti, e nessun conteggio. Chi ha la chiave (il gestore e il titolare,
tramite l'export) sa quale pseudonimo è il suo. Le àncore precedenti, in una cartella col nome
dell'installazione, restano leggibili e verificabili.

## Cosa queste àncore non provano

- le righe scritte **dopo** l'ultima àncora (al più un giorno);
- **che si sia continuato ad ancorare**: il repository impedisce di riscrivere un'àncora, non di
  smettere di scriverne;
- **che un'àncora non sia stata cambiata dopo la sua creazione**: il verificatore legge i file come sono
  oggi. Per questo si guarda la storia del file, `git log -- <file>`: un'àncora onesta ha **un solo**
  commit. ⚠️ **Senza `--follow`**: le àncore di due giorni vicini si somigliano, e `--follow` scambia la
  seconda per una copia della prima, mostrando due commit dove ce n'è uno;
- il contenuto di un consenso al di là di ciò che il registro contiene: il registro prova quale scelta è
  stata registrata e quando, non che il visitatore abbia letto un'informativa.
