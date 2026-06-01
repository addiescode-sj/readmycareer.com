"""
RAGAS-based RAG Retrieval Quality Evaluation Script

Evaluation Metrics:
- Faithfulness       : Degree to which the generated answer is faithful to the context (Hallucination detection)
- Answer Relevancy   : How relevant the answer is to the given question
- Context Precision  : The proportion of actually relevant contexts among retrieved contexts
- Context Recall     : How much of the information required for the correct answer is included in the context
- Reference Grounding: For cases that target the seeded reference corpus (README §2,
                       the report files synced from Google Drive), the share of cases
                       where retrieval actually returned a `doc_type == "reference"`
                       chunk. This verifies the uploaded report files are being used,
                       not just present.

Execution:
    cd eval
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    python ragas_eval.py
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

# Load root .env
load_dotenv(Path(__file__).parent.parent / ".env")

# ── Environment variable validation ──────────────────────────────────────────

GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY")
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_INDEX_NAME = os.environ.get("PINECONE_INDEX_NAME")

missing = [k for k, v in {
    "GOOGLE_API_KEY": GOOGLE_API_KEY,
    "PINECONE_API_KEY": PINECONE_API_KEY,
    "PINECONE_INDEX_NAME": PINECONE_INDEX_NAME,
}.items() if not v]

if missing:
    print(f"Error: The following environment variables are not set: {', '.join(missing)}")
    print("Please check your root .env file.")
    sys.exit(1)

# ── Dependency imports ────────────────────────────────────────────────────────

try:
    from pinecone import Pinecone
    from ragas import evaluate
    from ragas.metrics import (
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    )
    from ragas.llms import LangchainLLMWrapper
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
    from datasets import Dataset
except ImportError as e:
    print(f"Missing dependencies: {e}")
    print("Please run 'pip install -r requirements.txt'.")
    sys.exit(1)

# ── Client initialization ─────────────────────────────────────────────────────

# RAGAS scoring LLM. Defaults to the project's standard model (proven available with the
# project's GOOGLE_API_KEY, unlike the older gemini-2.0 line); override with EVAL_RAGAS_MODEL.
RAGAS_LLM_MODEL = os.environ.get("EVAL_RAGAS_MODEL", "gemini-3.1-flash-lite-preview")

print(f"Initializing clients (RAGAS LLM: {RAGAS_LLM_MODEL})...")

llm = LangchainLLMWrapper(
    ChatGoogleGenerativeAI(
        model=RAGAS_LLM_MODEL,
        google_api_key=GOOGLE_API_KEY,
        temperature=0,
    )
)

embeddings = LangchainEmbeddingsWrapper(
    GoogleGenerativeAIEmbeddings(
        model="models/text-embedding-004",
        google_api_key=GOOGLE_API_KEY,
    )
)

pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index(PINECONE_INDEX_NAME)

# Integrated index settings — must match the app's career-knowledge-base skill. The index
# embeds text server-side (llama-text-embed-v2) and rejects client-supplied vectors, so
# retrieval goes through index.search(inputs={"text": ...}), not index.query(vector=...).
TEXT_FIELD = os.environ.get("PINECONE_TEXT_FIELD", "text")
PINECONE_NAMESPACE = os.environ.get("PINECONE_NAMESPACE", "__default__")

# ── RAG search functions ──────────────────────────────────────────────────────

def retrieve_contexts(
    query: str, top_k: int = 5, doc_type: str | None = None
) -> tuple[list[str], list[dict]]:
    """
    Embeds a query and retrieves relevant contexts from Pinecone.

    Returns (contexts, matches_meta), where matches_meta carries the per-match
    metadata needed to assess reference grounding: doc_type, tags, score.
    When `doc_type` is "jd" or "reference", a metadata filter restricts retrieval
    to that document type (mirrors the career-knowledge-base `searchRecords` tool).

    Uses integrated-inference search (server-side embedding) — the index rejects
    client-supplied vectors, so we must NOT embed the query ourselves.
    """
    search_filter = (
        {"doc_type": {"$eq": doc_type}} if doc_type in ("jd", "reference") else None
    )
    response = index.search(
        namespace=PINECONE_NAMESPACE,
        top_k=top_k,
        inputs={"text": query},
        filter=search_filter,
        fields=[TEXT_FIELD, "doc_type", "title", "chunk_index", "tags"],
    )

    hits = response["result"]["hits"]
    contexts: list[str] = []
    matches_meta: list[dict] = []
    for hit in hits:
        f = hit.get("fields", {}) or {}
        text = f.get(TEXT_FIELD)
        if text:
            contexts.append(text)
        # tags are stored as a comma-joined string by the upsert pipeline
        raw_tags = f.get("tags", "")
        tags = [t for t in raw_tags.split(",") if t] if isinstance(raw_tags, str) else list(raw_tags or [])
        matches_meta.append(
            {
                "doc_type": f.get("doc_type", ""),
                "title": f.get("title", ""),
                "tags": tags,
                # SDK 9 serializes hit id/score as id_/score_ in dict form.
                "score": hit.get("score_", hit.get("_score")),
            }
        )
    return contexts, matches_meta


def generate_rag_answer(question: str, contexts: list[str]) -> str:
    """Generates a RAG-based answer using Gemini Flash"""
    if not contexts:
        return "No relevant information found."

    context_str = "\n---\n".join(contexts)
    prompt = f"""Based on the following context, provide a clear and specific answer to the question.
Do not speculate on information not present in the context.

Context:
{context_str}

Question: {question}

Answer:"""

    response = llm.llm.invoke(prompt)
    return response.content

# ── Evaluation dataset construction ──────────────────────────────────────────

def build_eval_dataset(test_cases_path: str) -> tuple[Dataset, list[dict]]:
    """
    Runs the RAG pipeline over test cases from a file to build the evaluation
    dataset. Also returns per-case citation records — which Pinecone sources each
    answer is grounded in — used to compute the Grounding / Citation Rate
    (independent of the RAGAS metrics; the retrieval-level inverse of hallucination).
    """
    with open(test_cases_path, encoding="utf-8") as f:
        test_cases = json.load(f)

    print(f"\nProcessing {len(test_cases)} test cases...")

    rows = []
    citation_records: list[dict] = []
    for i, tc in enumerate(test_cases, 1):
        print(f"  [{i}/{len(test_cases)}] {tc['question'][:50]}...")

        contexts, matches_meta = retrieve_contexts(
            tc["contexts_query"], doc_type=tc.get("doc_type")
        )
        answer = generate_rag_answer(tc["question"], contexts)

        rows.append({
            "question": tc["question"],
            "answer": answer,
            "contexts": contexts if contexts else ["No context"],
            "ground_truth": tc["ground_truth"],
        })

        # Citation record for EVERY case: which sources were retrieved (title, type, score).
        # `grounded` applies only to cases that explicitly target the reference corpus.
        expected_doc_type = tc.get("expected_doc_type")
        grounded = (
            any(m["doc_type"] == expected_doc_type for m in matches_meta)
            if expected_doc_type
            else None
        )
        expected_tags = set(tc.get("expected_tags", []))
        retrieved_tags = {t for m in matches_meta for t in m["tags"]}
        cited = [m for m in matches_meta if m.get("title")]
        citation_records.append({
            "question": tc["question"][:60],
            "category": tc.get("category", ""),
            "expected_doc_type": expected_doc_type or "",
            "grounded": grounded,
            "num_sources": len(cited),
            "cited_sources": "; ".join(
                f"{m['title']} [{m['doc_type']}|{(m['score'] or 0):.2f}]" for m in cited[:3]
            ),
            "tag_overlap": (bool(expected_tags & retrieved_tags) if expected_tags else None),
        })

    return Dataset.from_list(rows), citation_records

# ── Evaluation execution ──────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("readmycareer.com — RAGAS Retrieval Quality Evaluation")
    print("=" * 60)

    # Build dataset
    dataset_path = Path(__file__).parent / "eval_dataset.json"
    dataset, citation_records = build_eval_dataset(str(dataset_path))
    # Reference-targeted cases drive the grounding rate; all cases drive citation coverage.
    grounding_records = [r for r in citation_records if r["expected_doc_type"]]

    print("\nRunning RAGAS evaluation (using Gemini Flash)...")

    result = evaluate(
        dataset=dataset,
        metrics=[
            faithfulness,
            answer_relevancy,
            context_precision,
            context_recall,
        ],
        llm=llm,
        embeddings=embeddings,
    )

    # ── Print results ─────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("Evaluation Results")
    print("=" * 60)

    metrics = {
        "Faithfulness       (No Hallucination)": result.get("faithfulness", 0),
        "Answer Relevancy   (Query Suitability)": result.get("answer_relevancy", 0),
        "Context Precision  (No Noise)": result.get("context_precision", 0),
        "Context Recall     (No Missing Info)": result.get("context_recall", 0),
    }

    all_pass = True
    THRESHOLD = 0.70

    for name, score in metrics.items():
        status = "✅ PASS" if score >= THRESHOLD else "❌ FAIL"
        if score < THRESHOLD:
            all_pass = False
        print(f"  {name}: {score:.4f}  {status}")

    # ── Citation coverage (all cases) ──────────────────────────────────────────
    # Share of cases whose answer is backed by ≥1 retrieved source. A retrieval-level
    # inverse-of-hallucination signal that complements RAGAS Faithfulness.
    if citation_records:
        cited = sum(1 for r in citation_records if r["num_sources"] > 0)
        citation_rate = cited / len(citation_records)
        print(
            f"  Citation Coverage  (Answer has a source): {citation_rate:.4f}  "
            f"[{cited}/{len(citation_records)} cases]"
        )

    # ── Grounding / Citation Rate (reference-corpus targeted cases only) ────────
    # Verifies that the report files synced from Google Drive (doc_type ==
    # "reference") are actually being retrieved for the cases that need them, and
    # surfaces the exact sources each answer is grounded in.
    REF_GROUNDING_THRESHOLD = 0.80
    if grounding_records:
        grounded = sum(1 for r in grounding_records if r["grounded"])
        grounding_rate = grounded / len(grounding_records)
        status = "✅ PASS" if grounding_rate >= REF_GROUNDING_THRESHOLD else "❌ FAIL"
        if grounding_rate < REF_GROUNDING_THRESHOLD:
            all_pass = False
        print(
            f"  Grounding / Citation Rate (Corpus Used): {grounding_rate:.4f}  {status}"
            f"  [{grounded}/{len(grounding_records)} cases, threshold {REF_GROUNDING_THRESHOLD}]"
        )
        for r in grounding_records:
            tag_note = (
                "" if r["tag_overlap"] is None
                else (" / tags ✓" if r["tag_overlap"] else " / tags ✗")
            )
            src = f"  ← {r['cited_sources']}" if r["cited_sources"] else ""
            print(
                f"      - {r['category']}: "
                f"{'grounded' if r['grounded'] else 'NOT grounded'}{tag_note}{src}"
            )
    else:
        print("  Grounding / Citation Rate: SKIP (no reference-targeted cases in dataset)")

    print("-" * 60)
    print(f"  Minimum Threshold: {THRESHOLD} (RAGAS) / {REF_GROUNDING_THRESHOLD} (Grounding / Citation)")
    print(f"  Overall Result: {'✅ ALL PASSED' if all_pass else '❌ PARTIAL FAILURE — Improvements needed in chunking/embedding/prompting/corpus sync'}")

    # ── Save CSV ──────────────────────────────────────────────────────────────
    output_path = Path(__file__).parent / "ragas_results.csv"
    result.to_pandas().to_csv(output_path, index=False, encoding="utf-8-sig")
    print(f"\nDetailed results: {output_path}")

    # Per-case citation/grounding records (which sources each answer used).
    import csv as _csv
    citation_path = Path(__file__).parent / "grounding_results.csv"
    with open(citation_path, "w", newline="", encoding="utf-8-sig") as f:
        fieldnames = [
            "question", "category", "expected_doc_type",
            "grounded", "num_sources", "cited_sources", "tag_overlap",
        ]
        writer = _csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in citation_records:
            writer.writerow(r)
    print(f"Grounding / citation records: {citation_path}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())