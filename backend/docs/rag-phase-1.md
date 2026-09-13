# RAG Phase 1

## Architecture

NestJS owns ingestion because it already controls document authorization and protected storage. After a supported document is stored and its metadata exists, `DocumentIngestionService` reads its bytes through `DocumentsService`, extracts and normalizes text, creates deterministic overlapping chunks, requests Gemini embeddings, and installs a new chunk generation in MongoDB. The original document remains the source of truth and no binary data is copied into `knowledge_chunks`.

Supported formats are PDF, DOCX, and UTF-8 TXT. Scanned PDFs require a future OCR phase. XLS/XLSX and presentation formats remain available through existing document features but are not indexed.

## Configuration

- `GEMINI_API_KEY` is required and is shared with the existing Gemini integration.
- `GEMINI_EMBEDDING_MODEL` is optional and defaults to `gemini-embedding-001`.
- Embeddings contain exactly 768 dimensions.

Never expose the Gemini key to the frontend.

## MongoDB Atlas Vector Search

Create a Vector Search index named `knowledge_vector_index` on the `knowledge_chunks` collection. In Atlas, choose JSON Editor and paste [`config/atlas/knowledge-vector-index.json`](../config/atlas/knowledge-vector-index.json). The vector path, cosine similarity, and 768 dimensions must remain synchronized with `rag.constants.ts` and `EmbeddingService`.

Atlas Search indexes are cloud resources and are not created by Mongoose. A missing or building index produces a controlled service-unavailable error rather than an empty result.

## Lifecycle

- Create/upload: supported documents are indexed after the document row is created. Upload success remains valid if indexing fails; `rag_status` becomes `FAILED` with a safe error message.
- Update/publish/archive: the document is force-reindexed so metadata and role visibility remain current.
- Replace: the superseded document's chunks are removed and the new document is indexed.
- Delete: all chunks for the source document are removed before the document is deleted.
- Manual reindex: an authenticated Admin can call `POST /rag/documents/:id/index`.

Reindexing embeds a complete replacement first, then atomically installs it and deletes older generations in a MongoDB transaction. A failure preserves the last valid generation. Matching ready generations are reused unless a forced reindex is requested.

## Security and search

Chunks store lower-case application role values and machine metadata. Vector results never project raw embeddings or storage paths. Admin searches may span machines; Technician and Operator searches must provide their server-authorized machine scope. Phase 2 should expose retrieval only through a secured NestJS API which computes that scope from the authenticated user.

## Troubleshooting

- `Gemini embedding is not configured`: set `GEMINI_API_KEY` in the backend environment.
- `FAILED` with extraction error: confirm the file is PDF, DOCX, or valid UTF-8 TXT and contains selectable text.
- Vector index unavailable: create the Atlas index, wait for it to become Active, and confirm its name and dimensions.
- Existing uploaded documents: invoke the Admin reindex operation once per supported document or add a controlled migration job before Phase 2 rollout.

## Phase 2 retrieval and grounding

The existing authenticated `POST /ai-assistant/recommendations` endpoint now performs permission-aware retrieval before Gemini generation. The server derives the user and role from JWT claims. For a machine-scoped request it searches the exact machine first, then falls back only to documents for the same machine type within the caller's authorized machines. Weak retrieval returns a localized, ungrounded no-evidence response and does not call Gemini.

Optional retrieval configuration:

- `RAG_TOP_K` defaults to `5` (range 1–20).
- `RAG_NUM_CANDIDATES` defaults to `100` (up to 1000).
- `RAG_MIN_SCORE` defaults to `0.55` (range 0–1); evaluate this value on representative manuals before production use.

Responses include `grounded`, safe citation metadata in `sources`, and `retrieval.matched`. Embeddings, storage paths, role filters, and full chunk metadata are never returned. Retrieved text is marked as untrusted evidence in the Gemini system instruction so instructions embedded in documents cannot override assistant rules.

## End-user and administration workflow

The existing assistant displays a machine-context label, a documented-grounding badge, and clickable document/page/section sources. Source clicks use the existing authenticated document lookup and `DocumentAttachmentViewer`; the current PDF viewer does not expose an initial-page prop, so the modal displays the cited page as a navigation hint. Operator and Technician interfaces contain no indexing controls. The Admin Documents page displays `NOT_INDEXED`, `PROCESSING`, `READY`, and `FAILED`, chunk count and indexed time, with rate-limited Index/Reindex/Retry actions.

Role responsibilities:

- Operator consumes documentation for assigned machines and sees only accessible sources.
- Technician consumes permitted technical documentation with machine/work-order context.
- Admin manages document lifecycle and indexing.

Resource protections include a 2,000-character assistant DTO limit, per-user assistant throttling, a 10 MB upload limit, safe filename/MIME/magic-byte validation, bounded text extraction and chunking, idempotent generation keys, batched embeddings, bounded top-K/context, Admin-only throttled reindexing, and provider timeouts. TXT, PDF, and DOCX are ingestible. Scanned PDFs require OCR; legacy Office formats may be previewed but are not indexed.

## Soutenance summary

The RAG feature grounds the maintenance assistant in company manuals and SOPs without retraining Gemini. NestJS extracts documents, creates Gemini embeddings, stores them in MongoDB, retrieves authorized passages with Atlas Vector Search, and asks Gemini to explain only that evidence with traceable sources. Machine learning remains separate: the FastAPI model detects anomalies; RAG retrieves company knowledge; Gemini explains and summarizes documented guidance. This separation prevents an LLM explanation from being presented as the anomaly computation itself.
