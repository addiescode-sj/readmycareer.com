import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ExternalJdResult {
  doc_id: string;
  doc_type: "jd";
  title: string;
  chunk_index: number;
  score: number;
  text: string;
  metadata: {
    source: "google_search";
    target_company: string;
    target_role: string;
    grounding_urls?: string[];
  };
}

/**
 * Uses Gemini's Google Search grounding to fetch a JD summary for the given
 * target_company/target_role from the web and returns it in a JdSearchResult-compatible structure.
 * Called as a fallback when the Pinecone Vector DB returns 0 hits.
 */
export async function searchJdFromGoogle(
  targetRole: string,
  targetCompany: string
): Promise<ExternalJdResult[]> {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[externalJdSearch] GOOGLE_API_KEY 미설정 — 빈 배열 반환");
    return [];
  }

  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel(
    {
      model: "gemini-3.1-flash-lite-preview",
      tools: [{ googleSearch: {} } as any],
    } as any
  );

  const prompt = `
"${targetCompany}" 회사의 "${targetRole}" 포지션 채용 공고(Job Description)를 Google 검색으로 찾아,
지원자 준비에 필요한 정보를 아래 JSON 구조로 정리하세요. JSON만 출력하세요.

{
  "title": "${targetCompany} ${targetRole}",
  "responsibilities": ["주요 업무 1", "..."],
  "required_qualifications": ["필수 자격 요건 1", "..."],
  "preferred_qualifications": ["우대 사항 1", "..."],
  "tech_stack": ["사용 기술 1", "..."],
  "culture_keywords": ["조직문화/핵심가치 키워드 1", "..."],
  "summary": "해당 직무 한 줄 요약"
}

- 실제 공고가 검색되지 않으면 해당 회사·직무에 대한 공개된 정보(블로그, 회사 소개, 업계 자료)를 근거로 합리적으로 추정하세요.
- 한국어로 작성하세요.
`.trim();

  try {
    const SEARCH_TIMEOUT = 20_000;
    const result = await Promise.race([
      model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      } as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Google Search 시간 초과")), SEARCH_TIMEOUT)
      ),
    ]);

    const response: any = result.response;
    const text: string = response.text?.() ?? "";

    const groundingMetadata =
      response.candidates?.[0]?.groundingMetadata ??
      response.candidates?.[0]?.grounding_metadata;
    const groundingUrls: string[] =
      groundingMetadata?.groundingChunks
        ?.map((c: any) => c?.web?.uri)
        .filter((u: any): u is string => typeof u === "string") ?? [];

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = { summary: cleaned };
    }

    const bodyText = JSON.stringify(parsed, null, 2);

    const jd: ExternalJdResult = {
      doc_id: `google_${Date.now()}`,
      doc_type: "jd",
      title: (parsed.title as string) || `${targetCompany} ${targetRole}`,
      chunk_index: 0,
      score: 0.7,
      text: bodyText,
      metadata: {
        source: "google_search",
        target_company: targetCompany,
        target_role: targetRole,
        grounding_urls: groundingUrls,
      },
    };

    console.log(
      `[externalJdSearch] Google Search 폴백 완료 — grounding_urls=${groundingUrls.length}`
    );
    return [jd];
  } catch (err: any) {
    console.error("[externalJdSearch] 호출 실패:", err?.message ?? err);
    return [];
  }
}
