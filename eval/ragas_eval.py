"""
RAGAS-based RAG Retrieval Quality Evaluation Script

Evaluation Metrics:
- Faithfulness       : Degree to which the generated answer is faithful to the context (Hallucination detection)
- Answer Relevancy   : How relevant the answer is to the given question
- Context Precision  : The proportion of actually relevant contexts among retrieved contexts
- Context Recall     : How much of the information required for the correct answer is included in the context

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

def retrieve_contexts(query: str, top_k: int = 5) -> list[str]:
    """Embeds a query and retrieves relevant contexts from Pinecone"""
    embedding = embeddings.embed_query(query)
    results = index.query(
        vector=embedding,
        top_k=top_k,
        include_metadata=True,
    )
    contexts = [
        m.metadata.get("text", "")
        for m in results.matches
        if m.metadata and m.metadata.get("text")
    ]
    return contexts


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

def build_eval_dataset(test_cases_path: str) -> Dataset:
    """Runs the RAG pipeline over test cases from a file to build the evaluation dataset"""
    with open(test_cases_path, encoding="utf-8") as f:
        test_cases = json.load(f)

    print(f"\nProcessing {len(test_cases)} test cases...")

    rows = []
    for i, tc in enumerate(test_cases, 1):
        print(f"  [{i}/{len(test_cases)}] {tc['question'][:50]}...")

        contexts = retrieve_contexts(tc["contexts_query"])
        answer = generate_rag_answer(tc["question"], contexts)

        rows.append({
            "question": tc["question"],
            "answer": answer,
            "contexts": contexts if contexts else ["No context"],
            "ground_truth": tc["ground_truth"],
        })

    return Dataset.from_list(rows)

# ── Evaluation execution ──────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("readmycareer.com — RAGAS Retrieval Quality Evaluation")
    print("=" * 60)

    # Build dataset
    dataset_path = Path(__file__).parent / "eval_dataset.json"
    dataset = build_eval_dataset(str(dataset_path))

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

    print("-" * 60)
    print(f"  Minimum Threshold: {THRESHOLD}")
    print(f"  Overall Result: {'✅ ALL PASSED' if all_pass else '❌ PARTIAL FAILURE — Improvements needed in chunking/embedding/prompting'}")

    # ── Save CSV ──────────────────────────────────────────────────────────────
    output_path = Path(__file__).parent / "ragas_results.csv"
    result.to_pandas().to_csv(output_path, index=False, encoding="utf-8-sig")
    print(f"\nDetailed results: {output_path}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())