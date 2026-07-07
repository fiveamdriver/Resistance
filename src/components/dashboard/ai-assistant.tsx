"use client";

import { useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
}

// Compact styling for assistant markdown — chat bubbles, not documents.
// GFM tables are the main event; keep everything tight and readable.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <div className="mb-1 mt-2 text-sm font-semibold text-[#c8d3e0]">{children}</div>
  ),
  h2: ({ children }) => (
    <div className="mb-1 mt-2 text-sm font-semibold text-[#c8d3e0]">{children}</div>
  ),
  h3: ({ children }) => (
    <div className="mb-1 mt-2 text-[13px] font-semibold text-[#c8d3e0]">{children}</div>
  ),
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  strong: ({ children }) => (
    <strong className="font-semibold text-[#c8d3e0]">{children}</strong>
  ),
  code: ({ children }) => (
    <code className="rounded bg-[rgba(255,255,255,0.07)] px-1 py-0.5 font-mono text-[12px] text-[#c8d3e0]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-[rgba(255,255,255,0.05)] p-2 font-mono text-[12px]">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-2 border-[rgba(255,255,255,0.08)]" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[rgba(255,255,255,0.15)] text-[#c8d3e0]">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-semibold">{children}</th>
  ),
  tr: ({ children }) => (
    <tr className="border-b border-[rgba(255,255,255,0.06)] last:border-0">{children}</tr>
  ),
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
};

interface ApiMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What connects to U7?",
  "What components are on the 5V rail?",
  "What design-review risks should I check?",
];

export function AiAssistant({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      role: "assistant",
      text: "Ask a question about your design. Try a sample question below to explore the interface.",
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hasSentMessage, setHasSentMessage] = useState(false);

  // API conversation history — not display state, no re-renders needed.
  // The initial greeting is UI-only and is not sent to the backend.
  const apiHistory = useRef<ApiMessage[]>([]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || streaming) return;

    setHasSentMessage(true);
    setInput("");
    setStreaming(true);

    // Append user bubble and an empty assistant bubble (filled while streaming).
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "assistant", text: "" },
    ]);

    const outgoing: ApiMessage[] = [
      ...apiHistory.current,
      { role: "user", content: q },
    ];

    try {
      const resp = await fetch(`/api/projects/${projectId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: outgoing }),
      });

      if (!resp.ok || !resp.body) {
        // The route sends a user-facing explanation (no API key, AI turned
        // off in Settings, …) as the plain-text body — show it, don't eat it.
        const detail = resp.ok ? "" : (await resp.text().catch(() => "")).trim();
        throw new Error(detail || `The assistant request failed (HTTP ${resp.status}).`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        const snapshot = assistantText;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", text: snapshot };
          return updated;
        });
      }

      apiHistory.current = [
        ...outgoing,
        { role: "assistant", content: assistantText },
      ];
    } catch (err) {
      const text =
        err instanceof Error && err.message
          ? err.message
          : "Connection error — check the server logs.";
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", text };
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex h-[28rem] flex-col rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => {
          const isStreamingBubble =
            streaming && i === messages.length - 1 && m.role === "assistant";
          return (
            <div
              key={i}
              className={m.role === "user" ? "text-right" : "text-left"}
            >
              <span
                className={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-brand text-[#F5F0E8]"
                    : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[#94a3b8]"
                }`}
              >
                {m.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {m.text}
                  </ReactMarkdown>
                ) : (
                  m.text
                )}
                {isStreamingBubble && (
                  <span className="ml-0.5 inline-block animate-pulse">▋</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[rgba(255,255,255,0.06)] p-3">
        {!hasSentMessage && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full border border-[rgba(255,255,255,0.08)] px-2.5 py-1 text-xs text-[#94a3b8] transition-colors hover:border-brand hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your project…"
            disabled={streaming}
            className="flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[#F5F0E8] placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)] disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#F5F0E8] transition-colors hover:bg-brand-dark disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
