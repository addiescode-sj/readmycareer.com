"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import { Sparkles, ChevronDown, BookOpen } from "lucide-react";
import type { UIMessage } from "ai";

const MARKDOWN_ELEMENTS = [
  "p", "strong", "em", "ul", "ol", "li", "code", "pre", "blockquote", "a", "h1", "h2", "h3", "br",
] as const;

type SearchReferenceOutput = {
  results: { title: string; snippet: string }[];
};

/**
 * Renders one UIMessage's parts: markdown text, a collapsible reasoning ("thinking") block,
 * and a source card for the search_reference tool call. Shared by all chat surfaces so
 * generative-UI/reasoning-visibility rendering only lives in one place.
 */
export function ChatMessageParts({ message }: { message: UIMessage }) {
  return (
    <>
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return part.text ? (
            <div key={i} className="prose prose-sm max-w-none [&_p]:mb-1 [&_ul]:mb-1 [&_li]:mb-1">
              <ReactMarkdown skipHtml allowedElements={[...MARKDOWN_ELEMENTS]}>
                {part.text}
              </ReactMarkdown>
            </div>
          ) : null;
        }
        if (part.type === "reasoning") {
          return part.text ? (
            <ReasoningBlock key={i} text={part.text} streaming={part.state === "streaming"} />
          ) : null;
        }
        if (part.type === "tool-search_reference") {
          return <SearchReferenceCard key={i} state={part.state} output={part.output as SearchReferenceOutput | undefined} />;
        }
        return null;
      })}
    </>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useTranslations("ChatInterface");
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-2 rounded-xl border border-dashed border-primary/30 bg-primary/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-primary/80"
      >
        <Sparkles className={`w-3 h-3 ${streaming ? "animate-pulse" : ""}`} />
        {streaming ? t("thinking") : t("thoughtProcess")}
        <ChevronDown className={`w-3 h-3 ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <p className="px-3 pb-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
          {text}
        </p>
      )}
    </div>
  );
}

function SearchReferenceCard({
  state,
  output,
}: {
  state: string;
  output: SearchReferenceOutput | undefined;
}) {
  const t = useTranslations("ChatInterface");

  if (state !== "output-available") {
    return (
      <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-border/50 bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
        <BookOpen className="w-3 h-3 animate-pulse" />
        {t("searchingReferences")}
      </div>
    );
  }

  const results = output?.results ?? [];
  if (results.length === 0) return null;

  return (
    <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary/70">
        <BookOpen className="w-3 h-3" />
        {t("referencesUsed")}
      </p>
      <ul className="space-y-1">
        {results.map((r, i) => (
          <li key={i} className="text-[11px] text-foreground/80 line-clamp-2">
            <span className="font-semibold">{r.title}</span> — {r.snippet}
          </li>
        ))}
      </ul>
    </div>
  );
}
