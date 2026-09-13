# RAG Evaluation Report

## Scope

The project-controlled fixture contains 20 questions covering direct facts, maintenance intervals, procedures, exact-machine context, multilingual retrieval, intentional no-answer cases, role restrictions, source attribution, and malicious instructions embedded in documents. All facts use explicitly labelled controlled fixture identifiers, so the suite makes no claim about real IPROTEX procedures.

## Method

Automated contract tests verify fixture integrity, locale/category coverage, grounding requirements, retrieval filtering, thresholding, same-machine-type fallback, source metadata, abstention, and prompt-injection boundaries. Gemini and Atlas calls are mocked in regular CI. A production-quality score must be generated later by loading the controlled fixture documents into an isolated Atlas database and running every question through the real embedding and generation models.

## Current result

| Check                                      | Result                           |
| ------------------------------------------ | -------------------------------- |
| Dataset integrity                          | 20/20 cases valid                |
| Required categories                        | Covered                          |
| Six application locales                    | Covered                          |
| Grounded cases require evidence and source | Pass                             |
| No-answer cases require abstention         | Pass                             |
| Operator/Admin authorization contract      | Pass in focused service tests    |
| Prompt-injection precedence                | Pass in focused prompt tests     |
| Real Atlas top-K retrieval rate            | Not measured in this environment |
| Real Gemini grounded-answer correctness    | Not measured in this environment |

## Release gate

Do not report a retrieval accuracy or grounded-answer accuracy percentage until the isolated live evaluation is run. Before production, create a test machine and controlled documents in a non-production database, index them using the configured Gemini embedding model, execute all 20 cases, and record expected-source top-K success, abstention, authorization leakage, source attribution, and reviewer-rated answer consistency.
