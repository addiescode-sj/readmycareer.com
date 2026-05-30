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

print("Initializing clients...")

llm = LangchainLLMWrapper(
    ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
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

# ── RAG search functions ──────────────────────────────────────────────────────

def retrieve_contexts(
    query: str, top_k: int = 5, doc_type: str | None = None
) -> tuple[list[str], list[dict]]:
    """
    Embeds a query and retrieves relevant contexts from Pinecone.

    Returns (contexts, matches_meta), where matches_meta carries the per-match
    metadata needed to assess reference grounding: doc_type, tags, score.
    When `doc_type` is "jd" or "reference", a metadata filter restricts retrieval
    to that document type (mirrors the career-knowledge-base `search` tool filter).
    """
    embedding = embeddings.embed_query(query)
    query_kwargs: dict = {
        "vector": embedding,
        "top_k": top_k,
        "include_metadata": True,
    }
    if doc_type in ("jd", "reference"):
        query_kwargs["filter"] = {"doc_type": {"$eq": doc_type}}

    results = index.query(**query_kwargs)

    contexts: list[str] = []
    matches_meta: list[dict] = []
    for m in results.matches:
        meta = m.metadata or {}
        if meta.get("text"):
            contexts.append(meta["text"])
        # tags are stored as a comma-joined string by the upsert pipeline
        raw_tags = meta.get("tags", "")
        tags = [t for t in raw_tags.split(",") if t] if isinstance(raw_tags, str) else list(raw_tags or [])
        matches_meta.append(
            {
                "doc_type": meta.get("doc_type", ""),
                "title": meta.get("title", ""),
                "tags": tags,
                "score": getattr(m, "score", None),
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
    dataset. Also returns per-case grounding records used to compute the
    Reference Grounding Rate (independent of the RAGAS metrics).
    """
    with open(test_cases_path, encoding="utf-8") as f:
        test_cases = json.load(f)

    print(f"\nProcessing {len(test_cases)} test cases...")

    rows = []
    grounding_records: list[dict] = []
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

        # Record grounding info only for cases that explicitly target the corpus.
        expected_doc_type = tc.get("expected_doc_type")
        if expected_doc_type:
            grounded = any(m["doc_type"] == expected_doc_type for m in matches_meta)
            expected_tags = set(tc.get("expected_tags", []))
            retrieved_tags = {t for m in matches_meta for t in m["tags"]}
            grounding_records.append({
                "category": tc.get("category", tc["question"][:40]),
                "expected_doc_type": expected_doc_type,
                "grounded": grounded,
                "tag_overlap": bool(expected_tags & retrieved_tags) if expected_tags else None,
            })

    return Dataset.from_list(rows), grounding_records

# ── Evaluation execution ──────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("readmycareer.com — RAGAS Retrieval Quality Evaluation")
    print("=" * 60)

    # Build dataset
    dataset_path = Path(__file__).parent / "eval_dataset.json"
    dataset, grounding_records = build_eval_dataset(str(dataset_path))

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

    # ── Reference Grounding (reference-corpus targeted cases only) ──────────────
    # Verifies that the report files synced from Google Drive (doc_type ==
    # "reference") are actually being retrieved for the cases that need them.
    REF_GROUNDING_THRESHOLD = 0.80
    if grounding_records:
        grounded = sum(1 for r in grounding_records if r["grounded"])
        grounding_rate = grounded / len(grounding_records)
        status = "✅ PASS" if grounding_rate >= REF_GROUNDING_THRESHOLD else "❌ FAIL"
        if grounding_rate < REF_GROUNDING_THRESHOLD:
            all_pass = False
        print(
            f"  Reference Grounding (Corpus Used): {grounding_rate:.4f}  {status}"
            f"  [{grounded}/{len(grounding_records)} cases, threshold {REF_GROUNDING_THRESHOLD}]"
        )
        for r in grounding_records:
            tag_note = (
                "" if r["tag_overlap"] is None
                else (" / tags ✓" if r["tag_overlap"] else " / tags ✗")
            )
            print(
                f"      - {r['category']}: "
                f"{'grounded' if r['grounded'] else 'NOT grounded'}{tag_note}"
            )
    else:
        print("  Reference Grounding: SKIP (no reference-targeted cases in dataset)")

    print("-" * 60)
    print(f"  Minimum Threshold: {THRESHOLD} (RAGAS) / {REF_GROUNDING_THRESHOLD} (Reference Grounding)")
    print(f"  Overall Result: {'✅ ALL PASSED' if all_pass else '❌ PARTIAL FAILURE — Improvements needed in chunking/embedding/prompting/corpus sync'}")

    # ── Save CSV ──────────────────────────────────────────────────────────────
    output_path = Path(__file__).parent / "ragas_results.csv"
    result.to_pandas().to_csv(output_path, index=False, encoding="utf-8-sig")
    print(f"\nDetailed results: {output_path}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())