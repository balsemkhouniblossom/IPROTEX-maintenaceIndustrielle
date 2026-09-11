# IPROTEX RAG production and soutenance guide

## Roles and workflow

Admin uploads and publishes technical documents, monitors `Not indexed`, `Processing`, `Ready`, or `Failed`, and can index, reindex, or retry. Technicians and Operators ask questions from permitted machine context and can open cited sources. Only Admin sees indexing controls.

## Production controls

Gemini credentials remain server-side. Questions are limited to 2,000 characters by DTO validation and assistant requests use the existing per-user throttle and timeout. Admin indexing is limited to five requests per minute. Extraction has a five-million-character ceiling, chunks are bounded, embeddings are batched, unchanged generations are reused, context is limited by `RAG_TOP_K`, and responses exclude embeddings and private paths.

Configure `GEMINI_API_KEY`, `GEMINI_MODEL`, optional `GEMINI_EMBEDDING_MODEL`, `RAG_TOP_K`, `RAG_NUM_CANDIDATES`, and `RAG_MIN_SCORE`. Keep Atlas `knowledge_vector_index` aligned to 768 dimensions and verify it is Active before enabling RAG.

Source clicks reuse the protected document endpoint and existing viewer. The current PDF viewer has no external page-navigation input, so the cited page is displayed above the preview rather than forcing the renderer to that page.

JWT identity determines role and machine scope. Vector filters apply role and authorized machines before generation. Document text is untrusted evidence and cannot override system instructions. Deleted documents lose chunks; replacement installs a new atomic generation. Deleted, forbidden, and unavailable citations produce a safe UI error.

Known limitations include scanned PDFs without OCR, unsupported legacy-format ingestion, dependence on available documentation, and an uncalibrated default similarity threshold. Live Atlas/Gemini evaluation remains required before production release.

## Soutenance explanation

RAG grounds the IPROTEX assistant in traceable company manuals and SOPs. It reduces unsupported answers, supports questions in six languages, and cites evidence without retraining Gemini.

Machine Learning, RAG, and Gemini have separate responsibilities. FastAPI machine learning detects anomalies from compatible measurement data. NestJS RAG retrieves authorized company knowledge using Gemini embeddings and MongoDB Atlas Vector Search. Gemini explains and summarizes that evidence; it does not calculate or change an anomaly score.

The path is: document upload → extraction → chunking → Gemini embedding → MongoDB chunks → Atlas Vector Search → permission-aware retrieval → Gemini grounded answer → clickable protected sources.
