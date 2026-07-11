/**
 * Assistant conversation lifecycle: history persists, a failed reply is
 * recorded on its row instead of vanishing, concurrent sends are rejected,
 * stale pending replies are reaped, and deletes cascade.
 *
 * Uses a bogus ANTHROPIC_API_KEY so the first real API call fails — that
 * exercises the failure-persistence path end-to-end without network access.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";

import {
  deleteConversation,
  getConversation,
  listConversations,
  sendMessage,
} from "./assistant-service";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

async function makeProject(): Promise<string> {
  const project = await prisma.project.create({
    data: { name: `test-${Math.random().toString(36).slice(2)}` },
  });
  return project.id;
}

describe("assistant conversation lifecycle", () => {
  it("persists the user turn and records the failure on the reply row", async () => {
    const projectId = await makeProject();

    await expect(
      sendMessage(projectId, null, "What connects to U7?")
    ).rejects.toThrow();

    const convos = await listConversations(projectId);
    expect(convos).toHaveLength(1);
    expect(convos[0].title).toBe("What connects to U7?");

    const detail = await getConversation(projectId, convos[0].id);
    expect(detail.pending).toBe(false);
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]).toMatchObject({
      role: "user",
      content: "What connects to U7?",
      status: "complete",
    });
    expect(detail.messages[1].role).toBe("assistant");
    expect(detail.messages[1].status).toBe("failed");
    expect(detail.messages[1].error).toBeTruthy();
  });

  it("truncates long first messages into the sidebar title", async () => {
    const projectId = await makeProject();
    const long = "x".repeat(200);
    await sendMessage(projectId, null, long).catch(() => {});
    const [convo] = await listConversations(projectId);
    expect(convo.title.length).toBeLessThanOrEqual(64);
    expect(convo.title.endsWith("…")).toBe(true);
  });

  it("rejects a send while a reply is still pending", async () => {
    const projectId = await makeProject();
    const convo = await prisma.conversation.create({
      data: { projectId, title: "t" },
    });
    await prisma.chatMessage.create({
      data: {
        conversationId: convo.id,
        role: "assistant",
        content: "",
        status: "pending",
      },
    });

    await expect(
      sendMessage(projectId, convo.id, "follow-up")
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "CHAT_BUSY"
    );
  });

  it("reaps a stale pending reply on read", async () => {
    const projectId = await makeProject();
    const convo = await prisma.conversation.create({
      data: { projectId, title: "t" },
    });
    await prisma.chatMessage.create({
      data: {
        conversationId: convo.id,
        role: "assistant",
        content: "",
        status: "pending",
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });

    const detail = await getConversation(projectId, convo.id);
    expect(detail.pending).toBe(false);
    expect(detail.messages[0].status).toBe("failed");
    expect(detail.messages[0].error).toMatch(/interrupted/);
  });

  it("scopes reads to the owning project and cascades deletes", async () => {
    const projectId = await makeProject();
    const otherProject = await makeProject();
    await sendMessage(projectId, null, "hello board").catch(() => {});
    const [convo] = await listConversations(projectId);

    await expect(getConversation(otherProject, convo.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof AppError && e.code === "NOT_FOUND"
    );
    // Wrong-project delete is a no-op; the conversation survives.
    await deleteConversation(otherProject, convo.id);
    expect(await listConversations(projectId)).toHaveLength(1);

    await deleteConversation(projectId, convo.id);
    expect(await listConversations(projectId)).toHaveLength(0);
    expect(
      await prisma.chatMessage.count({ where: { conversationId: convo.id } })
    ).toBe(0);
  });
});
