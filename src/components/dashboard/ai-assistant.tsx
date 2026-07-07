"use client";

import { useRef, useState } from "react";

interface DisplayMessage {
  role: "user" | "assistant";
  text: string;
}

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
                className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-brand text-[#F5F0E8]"
                    : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[#94a3b8]"
                }`}
              >
                {m.text}
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
