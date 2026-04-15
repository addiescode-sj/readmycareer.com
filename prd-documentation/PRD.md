# [PRD] Personal Career Manager AI Agent

## 1. Product Summary
Objective: To objectively analyze the gap between the user's current competencies (AS-IS) and their target job description (TO-BE), and provide a hyper-personalized career roadmap and actionable learning plan to bridge this gap within a specified job search timeframe.

### Target Users:

Mid-level developers with 3-7 years of experience preparing for a career transition.

Job seekers who require highly tailored preparation based on the specific requirements of target companies (e.g., Fintech company or Global Tech companies).

Professionals planning to achieve high level of base salary and benefits in limited time, who need systematic, timeline-based management.

### Core Problems to Solve:

The difficulty for candidates in objectively identifying specific technical stacks and competencies they lack when reading extensive JDs.

The absence of a concrete, daily/weekly execution plan (Action Plan) for studying and preparing, despite having a set timeframe for the job search.

## 2. User Journey
- Data Input: The user uploads their resume (PDF/Text) or manually inputs their technical stack and project experience into the chatbot.

- Goal Setting: The user inputs the desired target company, specific role (e.g., Product Engineer), the target job search duration (e.g., 1 month), and **pastes the full text of the job description (JD) they are applying for**.

- JD-Based Gap Analysis: The agent compares the user's resume directly against the pasted JD text to identify competency gaps. Separately, it queries the Vector DB for career trend and industry reference documents to enrich the career planning step.

- Roadmap Delivery: Based on the analyzed gap, the AI generates a comprehensive timeline table, a weekly to-do list, and a daily study log template. Career trend references from the knowledge base are incorporated to ensure the plan reflects current industry practices.

- Visualization & Interaction: The user toggles the generated markdown table into a visual chart, asks follow-up questions regarding the details, and interacts with the chatbot to refine the plan.

## 3. Core Feature Specs
### 1. Profile-JD Gap Analysis Module
- Description: Matches the user's resume data with the **user-provided JD text** to derive 'Current Competencies', 'Lacking Competencies', and 'Priorities for Improvement'. The JD is pasted directly by the user rather than fetched from a database, ensuring the analysis always reflects the exact job being applied to.

- Quality Standards:

Must go beyond simple keyword matching and logically compare the depth of the user's project experience with the technical requirements demanded by the JD.

Gap analysis results must always include 'evidence' (e.g., explicitly stating which requirement from the JD the gap is based on).

### 2. Reference-Enhanced Career Planning
- Description: In addition to gap analysis, the system queries the Vector DB for career trend and industry reference documents (`doc_type: "reference"`) relevant to the target role and company. These references (e.g., current IT trends, in-demand skills, hiring patterns) supplement the career plan generation step, ensuring the roadmap is grounded in real-world market context.

- Retrieval Strategy: Hybrid search (dense vector + BM25 + reranking) is applied to retrieve the most relevant reference documents. If the search returns no results, career planning falls back gracefully to general knowledge.

### 3. Multimodal Roadmap Generator (Output Generator)
- Timeline Table: Outputs a markdown table categorizing the job search period into distinct phases such as 'Preparation - Intensive Study - Application & Interview'.

- Toggle Visualization Guardrails: Visualizes progress aligned with the current date (System Date) and generates structured data fully compatible with rendering libraries like Mermaid.js or custom UI components.

- Weekly To-do List: Proposes mandatory action items for each week based on the lacking competencies identified from the JD (e.g., "Build a RAG pipeline project using Next.js App Router").

- Daily Study Log: Generates a text template summarizing the day's learning content, alongside a checklist required to advance to the next step.

### 4. Interactive Career Coaching (Chat)
- Description: Dynamically restructures the roadmap in real-time based on user feedback (e.g., If the user states, "I am already familiar with this concept," the AI adjusts the plan accordingly).

- Response Quality: Leverages the high inference speed of Gemini Fast (Flash) mode to propose partial plan revisions within 3 seconds.

## 4. Technical Requirements
### 1. Model & Prompt Engineering
Gemini Fast Mode Integration: Utilizes the large context window to input the user's lengthy resume and the full texts of the pasted JD into a single inference process.

Few-shot Prompting:

Includes reference examples in the system prompt to guarantee output consistency (e.g., [Input: Junior Frontend / Target: Toss] -> [Output: Analysis Table Sample]).

Strictly enforces JSON output formatting to prevent rendering errors in the frontend visualization components.

### 2. RAG Pipeline — Reference Knowledge Base
Data Source: Career trend articles, industry reports, and role-specific knowledge documents are embedded and stored in the Vector DB (`doc_type: "reference"`). These are retrieved to supplement career plan generation, not for JD discovery.

Retrieval Strategy: Employs 'tech stack and role combinations' as search queries. Hybrid search (dense + BM25 + Pinecone reranking) ensures high-relevance retrieval.

JD Input: JD text is provided directly by the user (paste input) rather than retrieved from the Vector DB. This guarantees analysis fidelity — the system always analyzes the exact job the user is applying for.

### 3. Frontend & Data Visualization
Tech Stack: Next.js, Tailwind CSS, Shadcn UI (Optimized for a Vibe Coding environment to ensure rapid MVP development).

Visualization Logic: The client-side application parses the AI-generated Markdown/JSON data and renders it into an interactive, toggleable timeline view.
