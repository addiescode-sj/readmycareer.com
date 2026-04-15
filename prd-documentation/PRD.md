# [PRD] Personal Career Manager AI Agent

## 1. Product Summary
Objective: To objectively analyze the gap between the user's current competencies (AS-IS) and the target company's Job Description (TO-BE), and provide a hyper-personalized career roadmap and actionable learning plan to bridge this gap within a specified job search timeframe.

### Target Users:

Mid-level developers with 3-7 years of experience preparing for a career transition.

Job seekers who require highly tailored preparation based on the specific requirements of target companies (e.g., Fintech company or Global Tech companies).

Professionals planning to achieve high level of base salary and benefits in limited time, who need systematic, timeline-based management.

### Core Problems to Solve:

The difficulty for candidates in objectively identifying specific technical stacks and competencies they lack when reading extensive JDs.

The absence of a concrete, daily/weekly execution plan (Action Plan) for studying and preparing, despite having a set timeframe for the job search.

## 2. User Journey
- Data Input: The user uploads their resume (PDF/Text) or manually inputs their technical stack and project experience into the chatbot.

- Goal Setting: The user inputs the desired target company, specific role (e.g., Product Engineer), and the target job search duration (e.g., 1 month).

- RAG-based Analysis: The agent queries the Vector DB for the latest JDs related to the target company/role and conducts a comparative analysis against the user's specifications.

- Roadmap Delivery: Based on the analyzed gap, the AI generates a comprehensive timeline table, a weekly to-do list, and a daily study log template.

- Visualization & Interaction: The user toggles the generated markdown table into a visual chart, asks follow-up questions regarding the details, and interacts with the chatbot to refine the plan.

## 3. Core Feature Specs
### 1. Profile-JD Gap Analysis Module (RAG Engine)
- Description: Matches the user's resume data with JD data in the Vector DB to derive 'Current Competencies', 'Lacking Competencies', and 'Priorities for Improvement'.

- Quality Standards:

Must go beyond simple keyword matching and logically compare the depth of the user's project experience with the technical requirements demanded by the JD.

Gap analysis results must always include 'evidence' (e.g., explicitly stating which requirement from which JD the gap is based on).

### 2. Multimodal Roadmap Generator (Output Generator)
- Timeline Table: Outputs a markdown table categorizing the job search period into distinct phases such as 'Preparation - Intensive Study - Application & Interview'.

- Toggle Visualization Guardrails: Visualizes progress aligned with the current date (System Date) and generates structured data fully compatible with rendering libraries like Mermaid.js or custom UI components.

- Weekly To-do List: Proposes mandatory action items for each week based on the lacking competencies identified from the JD (e.g., "Build a RAG pipeline project using Next.js App Router").

- Daily Study Log: Generates a text template summarizing the day's learning content, alongside a checklist required to advance to the next step.

### Interactive Career Coaching (Chat)
- Description: Dynamically restructures the roadmap in real-time based on user feedback (e.g., If the user states, "I am already familiar with this concept," the AI adjusts the plan accordingly).

- Response Quality: Leverages the high inference speed of Gemini Fast (Flash) mode to propose partial plan revisions within 3 seconds.

## 4. Technical Requirements
### 1. Model & Prompt Engineering
Gemini Fast Mode Integration: Utilizes the large context window to input the user's lengthy resume and the full texts of multiple JDs into a single inference process.

Few-shot Prompting:

Includes reference examples in the system prompt to guarantee output consistency (e.g., [Input: Junior Frontend / Target: Toss] -> [Output: Analysis Table Sample]).

Strictly enforces JSON output formatting to prevent rendering errors in the frontend visualization components.

### 2. RAG Pipeline Construction
Data Source: Crawls role-specific JDs from major recruitment platforms, embeds the text data, and stores it in a vector database like Supabase Vector or Pinecone.

Retrieval Strategy: Employs 'tech stack combinations' as search queries—rather than relying solely on job titles—to retrieve the most relevant JDs and successful applicant cases.

### 3. Frontend & Data Visualization
Tech Stack: Next.js, Tailwind CSS, Shadcn UI (Optimized for a Vibe Coding environment to ensure rapid MVP development).

Visualization Logic: The client-side application parses the AI-generated Markdown/JSON data and renders it into an interactive, toggleable timeline view.