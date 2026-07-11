# frontedo-anchors

Ancore WORM-ish della hash-chain consensi Frontedo (piano: docs/consent-anchor-worm-plan.md nel repo backend).

- **Append-only**: ogni file `anchors/<installation>/<yyyy>/<mm>/<dd>/<runId>.json` e CREATE-ONCE — mai update/delete (il verifier cammina la history git e tratta qualsiasi modifica/cancellazione come FAIL).
- **Contenuto**: SOLO `{schemaVersion, installationId, entries:[{tenantSlug, anchoredCount, headEventId, headHash}], anchoredAt}`. **Zero PII.**
- Repo PUBBLICO by design: auditabilita esterna delle ancore.
