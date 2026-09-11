# RAG evaluation report

The controlled fixture contains 20 questions covering factual retrieval, maintenance intervals, procedures, machine specificity, all six UI languages, deliberate no-answer questions, authorization boundaries, prompt injection, and page attribution. Expected facts refer only to named fixture documents; production manual facts are not invented.

The automated contract suite validates permission filters, exact-machine preference, same-type fallback, thresholds, deduplication, abstention, source metadata, multilingual instructions, and prompt-injection isolation. Tests mock Gemini and Atlas so CI remains deterministic and free of provider cost.

A live quality score is intentionally not reported until the controlled documents have been indexed in an isolated Atlas environment. To complete that evaluation, create isolated fixture machines, upload the named documents, wait for `READY`, execute every case from `test/fixtures/rag-evaluation.json`, and record top-K source match, cited page, abstention, unsupported claims, and forbidden-source leakage. Calibrate `RAG_MIN_SCORE` on a validation subset and report an untouched test subset separately.

Release criteria are 100% authorization and injection safety, 100% intended no-answer abstention, and a measured retrieval/source-attribution result on the isolated fixture. These live measurements remain pending.
