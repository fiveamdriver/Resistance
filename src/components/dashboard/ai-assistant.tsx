"use client";

import { useState } from "react";

import { getCannedResponse } from "@/lib/ai/canned-assistant";

interface Message {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "What connects to U7?",
  "What components are on the 5V rail?",
  "What design-review risks should I check?",
];

export function AiAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Ask a question about your design. Try a sample question below to explore the interface.",
    },
  ]);
  const [input, setInput] = useState("");

  function send(question: string) {
    const q = question.trim();
    if (!q) return;
    const reply = getCannedResponse(q);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "assistant", text: reply.text },
    ]);
    setInput("");
  }

  return (
    <div className="flex h-[28rem] flex-col rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <span
              className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-brand text-white"
                  : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[#94a3b8]"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-[rgba(255,255,255,0.06)] p-3">
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
            className="flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-white placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)]"
          />
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
