import { describe, expect, it, vi } from "vitest";
import { connectNativeCdp } from "../src/nativeCdpAdapter.js";

type Listener = (event?: unknown) => void;

class FakeWebSocket {
  sent: string[] = [];
  private listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    setTimeout(() => this.emit("open"), 0);
  }

  addEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
    const message = JSON.parse(data) as {
      id: number;
      method: string;
      sessionId?: string;
      params?: Record<string, unknown>;
    };

    if (message.method === "Target.createTarget") {
      this.respond(message.id, { targetId: "TARGET_1" });
      return;
    }
    if (message.method === "Target.attachToTarget") {
      this.respond(message.id, { sessionId: "SESSION_1" });
      return;
    }
    if (message.method === "Page.navigate") {
      this.respond(message.id, { frameId: "FRAME_1" });
      this.message({
        method: "Page.domContentEventFired",
        params: {},
        sessionId: message.sessionId
      });
      return;
    }
    if (message.method === "Runtime.evaluate") {
      const expression = String(message.params?.expression ?? "");
      this.respond(
        message.id,
        {
          result: {
            type: "string",
            value: expression.includes("document.body") ? "visible body text" : "evaluated"
          }
        }
      );
      return;
    }

    this.respond(message.id, {});
  }

  close = vi.fn(() => {
    this.emit("close", { code: 1000, reason: "" });
  });

  private respond(id: number, result: unknown): void {
    this.message({ id, result });
  }

  private message(payload: unknown): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  private emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

describe("connectNativeCdp", () => {
  it("creates a CDP page that can navigate, evaluate and read body text", async () => {
    let socket: FakeWebSocket | undefined;
    const automation = await connectNativeCdp(
      {
        profileId: "PROFILE_ID_1",
        wsPuppeteer: "ws://127.0.0.1:54425/devtools/browser/abc",
        raw: {}
      },
      {
        webSocketFactory: (url) => {
          socket = new FakeWebSocket(url);
          return socket;
        },
        connectTimeoutMs: 500,
        commandTimeoutMs: 500
      }
    );

    const page = await automation.newPage();
    await page.goto("https://www.browserscan.net/", 1000);

    await expect(page.evaluate("(() => 'evaluated')()")).resolves.toBe("evaluated");
    await expect(page.bodyText()).resolves.toBe("visible body text");

    await page.close();
    await automation.close();

    const sent = socket?.sent.map((item) => JSON.parse(item) as { method: string; params?: Record<string, unknown> });
    expect(sent?.map((item) => item.method)).toContain("Target.createTarget");
    expect(sent).toContainEqual(
      expect.objectContaining({
        method: "Page.navigate",
        params: expect.objectContaining({ url: "https://www.browserscan.net/" })
      })
    );
    expect(socket?.close).toHaveBeenCalled();
  });
});
