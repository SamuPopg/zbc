import { createRequire } from "node:module";
import type { BrowserAutomation, BrowserAutomationPage } from "./browserAutomation.js";
import type { LocalApiStartResponse } from "./types.js";

type FetchLike = typeof fetch;

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener?: (event: string, listener: (event: unknown) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}

type WebSocketFactory = (url: string) => WebSocketLike;

export interface NativeCdpConnectOptions {
  fetchImpl?: FetchLike;
  webSocketFactory?: WebSocketFactory;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
}

interface PendingCommand {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type CdpEventListener = (params: Record<string, unknown>) => void;

const DEFAULT_CONNECT_TIMEOUT_MS = 8000;
const DEFAULT_COMMAND_TIMEOUT_MS = 10000;
const NETWORK_IDLE_MS = 750;
const require = createRequire(import.meta.url);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function addWebSocketListener(
  socket: WebSocketLike,
  event: string,
  listener: (event: unknown) => void
): void {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(event, listener);
    return;
  }
  if (typeof socket.on === "function") {
    socket.on(event, (...args) => listener(args.length === 1 ? args[0] : args));
    return;
  }
  throw new Error("WebSocket implementation does not support event listeners");
}

function messageToString(event: unknown): string {
  const data = isRecord(event) && "data" in event ? event.data : event;
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }
  return String(data);
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const webSocketCtor = (globalThis as {
    WebSocket?: new (url: string) => WebSocketLike;
  }).WebSocket;
  if (webSocketCtor) {
    return new webSocketCtor(url);
  }

  const wsModule = require("ws") as
    | (new (url: string) => WebSocketLike)
    | { default?: new (url: string) => WebSocketLike };
  const wsCtor = typeof wsModule === "function" ? wsModule : wsModule.default;
  if (!wsCtor) {
    throw new Error("WebSocket implementation is not available");
  }
  return new wsCtor(url);
}

async function fetchJsonVersion(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`CDP version endpoint failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    if (!isRecord(body)) {
      throw new Error("CDP version endpoint returned a non-object response");
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`CDP version endpoint timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveWebSocketDebuggerUrl(
  started: LocalApiStartResponse,
  options: NativeCdpConnectOptions
): Promise<string> {
  if (started.wsPuppeteer) {
    return started.wsPuppeteer;
  }
  if (!started.debugPort) {
    throw new Error(
      `profile ${started.profileId} has no wsPuppeteer and no debugPort for native CDP fallback`
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const body = await fetchJsonVersion(
    `http://127.0.0.1:${started.debugPort}/json/version`,
    fetchImpl,
    timeoutMs
  );
  const wsUrl = body.webSocketDebuggerUrl;
  if (typeof wsUrl !== "string" || wsUrl.length === 0) {
    throw new Error(
      `profile ${started.profileId} CDP version endpoint did not return webSocketDebuggerUrl`
    );
  }
  return wsUrl;
}

class CdpConnection {
  private socket: WebSocketLike;
  private nextId = 1;
  private pending = new Map<number, PendingCommand>();
  private eventListeners = new Map<string, Set<CdpEventListener>>();
  private defaultCommandTimeoutMs: number;

  private constructor(socket: WebSocketLike, defaultCommandTimeoutMs: number) {
    this.socket = socket;
    this.defaultCommandTimeoutMs = defaultCommandTimeoutMs;

    addWebSocketListener(socket, "message", (event) => this.handleMessage(event));
    addWebSocketListener(socket, "error", (event) => this.rejectAll(errorMessage(event)));
    addWebSocketListener(socket, "close", () => this.rejectAll("CDP WebSocket closed"));
  }

  static connect(
    wsUrl: string,
    options: NativeCdpConnectOptions
  ): Promise<CdpConnection> {
    const socket = (options.webSocketFactory ?? defaultWebSocketFactory)(wsUrl);
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`native CDP WebSocket connect timed out after ${connectTimeoutMs}ms`));
      }, connectTimeoutMs);

      addWebSocketListener(socket, "open", () => {
        clearTimeout(timer);
        resolve(new CdpConnection(socket, commandTimeoutMs));
      });
      addWebSocketListener(socket, "error", (event) => {
        clearTimeout(timer);
        reject(new Error(`native CDP WebSocket connect failed: ${errorMessage(event)}`));
      });
    });
  }

  send(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs = this.defaultCommandTimeoutMs
  ): Promise<Record<string, unknown>> {
    const id = this.nextId;
    this.nextId += 1;

    const payload: Record<string, unknown> = { id, method };
    if (params) {
      payload.params = params;
    }
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native CDP command "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(payload));
    });
  }

  onEvent(
    method: string,
    sessionId: string | undefined,
    listener: CdpEventListener
  ): () => void {
    const key = this.eventKey(method, sessionId);
    const listeners = this.eventListeners.get(key) ?? new Set<CdpEventListener>();
    listeners.add(listener);
    this.eventListeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(key);
      }
    };
  }

  waitForAnyEvent(
    methods: string[],
    sessionId: string | undefined,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const disposers: Array<() => void> = [];
      const timer = setTimeout(() => {
        for (const dispose of disposers) {
          dispose();
        }
        reject(new Error(`native CDP event wait timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const done = (): void => {
        clearTimeout(timer);
        for (const dispose of disposers) {
          dispose();
        }
        resolve();
      };

      for (const method of methods) {
        disposers.push(this.onEvent(method, sessionId, done));
      }
    });
  }

  close(): void {
    this.rejectAll("native CDP connection closed");
    this.socket.close();
  }

  private handleMessage(event: unknown): void {
    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(messageToString(event));
      if (!isRecord(parsed)) {
        return;
      }
      message = parsed;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (isRecord(message.error)) {
          pending.reject(new Error(String(message.error.message ?? JSON.stringify(message.error))));
        } else {
          pending.resolve(isRecord(message.result) ? message.result : {});
        }
      }
    }

    if (typeof message.method === "string") {
      const sessionId = typeof message.sessionId === "string" ? message.sessionId : undefined;
      const params = isRecord(message.params) ? message.params : {};
      for (const key of [
        this.eventKey(message.method, sessionId),
        this.eventKey(message.method, undefined)
      ]) {
        for (const listener of this.eventListeners.get(key) ?? []) {
          listener(params);
        }
      }
    }
  }

  private rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private eventKey(method: string, sessionId: string | undefined): string {
    return `${sessionId ?? "browser"}:${method}`;
  }
}

class NativeCdpPage implements BrowserAutomationPage {
  private inflightRequests = new Set<string>();
  private lastNetworkActivity = Date.now();
  private disposers: Array<() => void> = [];

  constructor(
    private connection: CdpConnection,
    private sessionId: string,
    private targetId: string,
    private commandTimeoutMs: number
  ) {
    this.disposers.push(
      connection.onEvent("Network.requestWillBeSent", sessionId, (params) => {
        const requestId = params.requestId;
        if (typeof requestId === "string") {
          this.inflightRequests.add(requestId);
        }
        this.lastNetworkActivity = Date.now();
      }),
      connection.onEvent("Network.loadingFinished", sessionId, (params) => {
        const requestId = params.requestId;
        if (typeof requestId === "string") {
          this.inflightRequests.delete(requestId);
        }
        this.lastNetworkActivity = Date.now();
      }),
      connection.onEvent("Network.loadingFailed", sessionId, (params) => {
        const requestId = params.requestId;
        if (typeof requestId === "string") {
          this.inflightRequests.delete(requestId);
        }
        this.lastNetworkActivity = Date.now();
      })
    );
  }

  async goto(url: string, timeout?: number): Promise<void> {
    const timeoutMs = timeout ?? this.commandTimeoutMs;
    const lifecycle = this.connection.waitForAnyEvent(
      ["Page.domContentEventFired", "Page.loadEventFired"],
      this.sessionId,
      timeoutMs
    );
    await this.connection.send("Page.navigate", { url }, this.sessionId, timeoutMs);
    await lifecycle;
  }

  async waitForNetworkIdleOrDelay(): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (
        this.inflightRequests.size === 0 &&
        Date.now() - this.lastNetworkActivity >= NETWORK_IDLE_MS
      ) {
        break;
      }
      await wait(100);
    }
    await wait(3000);
  }

  async wait(ms: number): Promise<void> {
    await wait(ms);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await wait(ms);
  }

  async evaluate(script: string | ((...args: unknown[]) => unknown)): Promise<unknown> {
    const expression =
      typeof script === "function" ? `(${script.toString()})()` : script;
    return this.evaluateExpression(expression, this.commandTimeoutMs);
  }

  async bodyText(timeout?: number): Promise<string> {
    const value = await this.evaluateExpression(
      "document.body ? document.body.innerText : ''",
      timeout ?? this.commandTimeoutMs
    );
    return typeof value === "string" ? value : "";
  }

  async close(): Promise<void> {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers = [];
    await this.connection.send("Target.detachFromTarget", { sessionId: this.sessionId }).catch(() => undefined);
    await this.connection.send("Target.closeTarget", { targetId: this.targetId }).catch(() => undefined);
  }

  private async evaluateExpression(
    expression: string,
    timeoutMs: number
  ): Promise<unknown> {
    const result = await this.connection.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      },
      this.sessionId,
      timeoutMs
    );

    if (isRecord(result.exceptionDetails)) {
      throw new Error(`native CDP evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
    }

    const remoteObject = isRecord(result.result) ? result.result : {};
    if (Object.prototype.hasOwnProperty.call(remoteObject, "value")) {
      return remoteObject.value;
    }
    if (typeof remoteObject.unserializableValue === "string") {
      return remoteObject.unserializableValue;
    }
    return undefined;
  }
}

export class NativeCdpAutomation implements BrowserAutomation {
  constructor(
    private connection: CdpConnection,
    private commandTimeoutMs: number
  ) {}

  async newPage(): Promise<BrowserAutomationPage> {
    const target = await this.connection.send(
      "Target.createTarget",
      { url: "about:blank" },
      undefined,
      this.commandTimeoutMs
    );
    const targetId = target.targetId;
    if (typeof targetId !== "string" || targetId.length === 0) {
      throw new Error("native CDP Target.createTarget did not return targetId");
    }

    const attach = await this.connection.send(
      "Target.attachToTarget",
      { targetId, flatten: true },
      undefined,
      this.commandTimeoutMs
    );
    const sessionId = attach.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("native CDP Target.attachToTarget did not return sessionId");
    }

    await this.connection.send("Page.enable", undefined, sessionId, this.commandTimeoutMs);
    await this.connection.send("Runtime.enable", undefined, sessionId, this.commandTimeoutMs);
    await this.connection.send("Network.enable", undefined, sessionId, this.commandTimeoutMs);

    return new NativeCdpPage(this.connection, sessionId, targetId, this.commandTimeoutMs);
  }

  async close(): Promise<void> {
    this.connection.close();
  }
}

export async function connectNativeCdp(
  started: LocalApiStartResponse,
  options: NativeCdpConnectOptions = {}
): Promise<BrowserAutomation> {
  const wsUrl = await resolveWebSocketDebuggerUrl(started, options);
  const connection = await CdpConnection.connect(wsUrl, options);
  return new NativeCdpAutomation(
    connection,
    options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
  );
}
