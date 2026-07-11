"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Compact styling for assistant markdown — chat bubbles, not documents.
// GFM tables are the main event; keep everything tight and readable.
const markdownComponents: Components = {
  h1: ({ children }) => (
    <div className="mb-1 mt-2 text-sm font-semibold text-[#c8d3e0]">
      {children}
    </div>
  ),
  h2: ({ children }) => (
    <div className="mb-1 mt-2 text-sm font-semibold text-[#c8d3e0]">
      {children}
    </div>
  ),
  h3: ({ children }) => (
    <div className="mb-1 mt-2 text-[13px] font-semibold text-[#c8d3e0]">
      {children}
    </div>
  ),
  p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>
  ),
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
    <tr className="border-b border-[rgba(255,255,255,0.06)] last:border-0">
      {children}
    </tr>
  ),
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
};

// Mirrors of the server shapes (assistant-service.ts).
interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatMessageVM {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "pending" | "failed";
  error: string | null;
  createdAt: string;
}

interface AssistantProgress {
  phase: string;
  toolCalls: number;
  startedAt: number;
}

interface ConversationDetail {
  id: string;
  title: string;
  messages: ChatMessageVM[];
  pending: boolean;
  progress: AssistantProgress | null;
}

const SUGGESTIONS = [
  "What connects to U7?",
  "What components are on the 5V rail?",
  "What design-review risks should I check?",
];

const POLL_MS = 2000;

function activeKey(projectId: string): string {
  return `assistant-active-${projectId}`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatElapsed(startedAt: number): string {
  const s = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function AiAssistant({ projectId }: { projectId: string }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageVM[]>([]);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<AssistantProgress | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/assistant/conversations`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        conversations: ConversationSummary[];
      };
      setConversations(data.conversations);
    } catch {
      // Sidebar refresh is best-effort.
    }
  }, [projectId]);

  const applyDetail = useCallback((detail: ConversationDetail) => {
    setMessages(detail.messages.filter((m) => m.status !== "pending"));
    setPending(detail.pending);
    setProgress(detail.progress);
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      setActiveId(id);
      setError(null);
      sessionStorage.setItem(activeKey(projectId), id);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/assistant/conversations/${id}`
        );
        if (res.status === 404) {
          sessionStorage.removeItem(activeKey(projectId));
          setActiveId(null);
          setMessages([]);
          setPending(false);
          return;
        }
        if (!res.ok) return;
        applyDetail((await res.json()) as ConversationDetail);
      } catch {
        // Leave whatever is on screen; polling/re-open can retry.
      }
    },
    [projectId, applyDetail]
  );

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setPending(false);
    setProgress(null);
    setError(null);
    sessionStorage.removeItem(activeKey(projectId));
  }

  async function removeConversation(id: string) {
    await fetch(`/api/projects/${projectId}/assistant/conversations/${id}`, {
      method: "DELETE",
    }).catch(() => {});
    if (id === activeId) newChat();
    void refreshConversations();
  }

  // Mount: sidebar + re-open the last conversation (re-attaching to any
  // reply that kept generating server-side while this tab was unmounted).
  useEffect(() => {
    void refreshConversations();
    const saved = sessionStorage.getItem(activeKey(projectId));
    if (saved) void openConversation(saved);
  }, [projectId, refreshConversations, openConversation]);

  // While a reply is pending, poll the conversation for progress + result.
  useEffect(() => {
    if (!pending || !activeId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/assistant/conversations/${activeId}`
        );
        if (!res.ok || cancelled) return;
        const detail = (await res.json()) as ConversationDetail;
        if (cancelled) return;
        applyDetail(detail);
        if (!detail.pending) void refreshConversations();
      } catch {
        // Transient poll failure — keep polling.
      }
    };
    const interval = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pending, activeId, projectId, applyDetail, refreshConversations]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;

    setInput("");
    setError(null);
    setPending(true);
    setProgress(null);
    // Optimistic user bubble; the poll/response replaces local state wholesale.
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: q,
        status: "complete",
        error: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    try {
      const res = await fetch(`/api/projects/${projectId}/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, message: q }),
      });
      if (res.status === 409) return; // already generating — the poll attaches
      const data = await res.json();
      if (!res.ok)
        throw new Error(data?.error ?? "The assistant request failed");

      const convoId = (data as { conversationId: string }).conversationId;
      if (!activeId) {
        setActiveId(convoId);
        sessionStorage.setItem(activeKey(projectId), convoId);
      }
      // Authoritative refresh (also clears the pending flag).
      const detailRes = await fetch(
        `/api/projects/${projectId}/assistant/conversations/${convoId}`
      );
      if (detailRes.ok)
        applyDetail((await detailRes.json()) as ConversationDetail);
      else setPending(false);
      void refreshConversations();
    } catch (err) {
      setPending(false);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Connection error — check the server logs."
      );
    }
  }

  const showSuggestions = !activeId && messages.length === 0;

  return (
    // Height tracks the viewport so the input bar stays on screen in windowed
    // views (fixed heights hid it below the fold); floor keeps tiny windows
    // usable. 38rem ≈ the chrome above this panel (header, folder card, tabs).
    <div className="flex h-[max(20rem,calc(100dvh_-_38rem))] rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
      {/* Sidebar — conversation history */}
      <aside className="flex w-48 shrink-0 flex-col border-r border-[rgba(255,255,255,0.06)] sm:w-56">
        <div className="p-2">
          <button
            onClick={newChat}
            className="w-full rounded-md border border-[rgba(255,255,255,0.1)] px-3 py-1.5 text-sm text-[#F5F0E8] transition-colors hover:border-brand hover:text-brand"
          >
            + New chat
          </button>
        </div>
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 && (
            <p className="px-1 pt-2 text-xs text-[#4a5568]">
              No conversations yet.
            </p>
          )}
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                c.id === activeId
                  ? "bg-[rgba(255,255,255,0.08)] text-[#F5F0E8]"
                  : "text-[#94a3b8] hover:bg-[rgba(255,255,255,0.04)]"
              }`}
            >
              <button
                onClick={() => void openConversation(c.id)}
                className="min-w-0 flex-1 text-left"
                title={c.title}
              >
                <span className="block truncate">{c.title}</span>
                <span className="block text-[11px] text-[#4a5568]">
                  {relativeTime(c.updatedAt)}
                </span>
              </button>
              <button
                onClick={() => void removeConversation(c.id)}
                title="Delete conversation"
                className="hidden shrink-0 rounded px-1 text-[#4a5568] hover:text-red-300 group-hover:block"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Chat pane */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && !pending && (
            <div className="text-left">
              <span className="inline-block max-w-[80%] rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-[#94a3b8]">
                Ask a question about your design. Conversations are saved in the
                sidebar so you can pick them back up any time.
              </span>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={m.role === "user" ? "text-right" : "text-left"}
            >
              <span
                className={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "whitespace-pre-wrap bg-brand text-[#F5F0E8]"
                    : m.status === "failed"
                      ? "border border-red-500/30 bg-red-500/10 text-red-300"
                      : "border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] text-[#94a3b8]"
                }`}
              >
                {m.role === "assistant" ? (
                  m.status === "failed" ? (
                    (m.error ?? "The reply failed. Ask again.")
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={markdownComponents}
                    >
                      {m.content}
                    </ReactMarkdown>
                  )
                ) : (
                  m.content
                )}
              </span>
            </div>
          ))}
          {pending && (
            <div className="text-left">
              <span className="inline-block max-w-[80%] rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-[#94a3b8]">
                <span className="mr-1 inline-block animate-pulse">▋</span>
                {progress?.phase ?? "Thinking"}…
                {progress && (
                  <span className="ml-2 text-xs text-[#4a5568]">
                    {progress.toolCalls} tool call
                    {progress.toolCalls === 1 ? "" : "s"} ·{" "}
                    {formatElapsed(progress.startedAt)}
                  </span>
                )}
                <span className="mt-1 block text-xs text-[#4a5568]">
                  Runs on the server — switch tabs freely; the answer will be
                  here when you come back.
                </span>
              </span>
            </div>
          )}
        </div>

        <div className="border-t border-[rgba(255,255,255,0.06)] p-3">
          {error && (
            <p className="mb-2 text-xs text-red-300" role="alert">
              {error}
            </p>
          )}
          {showSuggestions && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
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
              void send(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your project…"
              disabled={pending}
              className="flex-1 rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm text-[#F5F0E8] placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)] disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-[#F5F0E8] transition-colors hover:bg-brand-dark disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
