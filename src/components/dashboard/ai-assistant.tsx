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
      text: "AI assistant not connected yet. Try a sample question below — responses are canned placeholders for Phase 1.",
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
    <div className="flex h-[28rem] flex-col rounded-lg border border-slate-200 bg-white">
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
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-brand hover:text-brand"
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
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <button
            type="submit"
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
