# Chat QnA Agent Development

This skill provides specialized context for developing or modifying the `ChatQnAAgent` in the readmycareer.com project.

## Responsibilities
Handles user Q&A interactions leveraging session context (resume, gap analysis, career plan) and provides conversational support with sources and follow-up suggestions.

## I/O Specifications
- **Input**: `user_message`, `session_context` (resume_json, gap_analysis, career_plan, chat_history)
- **Output**: `ChatQnAOutput` (stored in `session.chat_history`)
- **Location**: `agents/chat-qna/index.ts`
- **Config**: `.antigravity/agents/chat-qna.yaml`

## Guidelines
- **Data Transfer**: Always use `agents/types.ts` schemas.
- **State Management**: The output must update the chat history properly.
- **Dependencies**: Relies on MCP tools for external context retrieval if needed. Must not access Vector DB or file system directly.
