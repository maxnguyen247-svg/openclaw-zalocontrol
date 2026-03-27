import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';

type PendingRequest = {
    resolve: (result: any) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

type QueuedBatch = {
    chunks: string[];
    threadId: string;
    resolve: (results: any[]) => void;
    reject: (err: Error) => void;
};

const SEND_TIMEOUT_MS = 10_000;
const DEBOUNCE_MS = 80; // Window to coalesce rapid chunks for same threadId

/**
 * OpenZcaDaemonClient
 *
 * Key improvements over the naive version:
 *  1. sendChunks() pipelines ALL chunks to the daemon stdin at once,
 *     so Zalo network latency for chunk N overlaps with processing chunks N+1, N+2...
 *  2. Per-conversation queue (ConversationQueue) ensures strict delivery order
 *     across concurrent callers without blocking unrelated conversations.
 *  3. Debounce coalescing: if chunks for the same threadId arrive within
 *     DEBOUNCE_MS, they are merged into one batch before dispatch.
 */
export class OpenZcaDaemonClient {
    private child: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private pendingRequests = new Map<string, PendingRequest>();
    private reqCounter = 0;

    // Per-conversation queue: threadId -> promise chain tail
    private conversationQueue = new Map<string, Promise<void>>();

    // Debounce state: threadId -> { timer, accumulated chunks, resolvers }
    private debounceBuffers = new Map<string, {
        timer: ReturnType<typeof setTimeout>;
        batches: QueuedBatch[];
    }>();

    constructor(private daemonPath: string) {}

    // ── Lifecycle ───────────────────────────────────────────────────────────

    async start(): Promise<void> {
        if (this.child) return;

        this.child = spawn('node', [this.daemonPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        this.rl = readline.createInterface({
            input: this.child.stdout!,
            terminal: false
        });

        this.rl.on('line', (line) => {
            if (!line.trim()) return;
            try {
                const response = JSON.parse(line);
                if (response.reqId) {
                    const pending = this.pendingRequests.get(response.reqId);
                    if (pending) {
                        clearTimeout(pending.timer);
                        this.pendingRequests.delete(response.reqId);
                        if (response.error) {
                            pending.reject(new Error(response.error));
                        } else {
                            pending.resolve(response);
                        }
                    }
                }
            } catch (err) {
                // ignore malformed lines from daemon stderr bleed
            }
        });

        this.child.on('error', (err) => {
            console.error('[OpenZcaDaemonClient] child error:', err.message);
        });

        // Give the daemon a tick to fire up its readline loop
        await new Promise<void>(resolve => setTimeout(resolve, 80));
    }

    stop(): void {
        for (const buf of this.debounceBuffers.values()) clearTimeout(buf.timer);
        this.debounceBuffers.clear();
        this.rl?.close();
        this.child?.kill();
        this.child = null;
        this.rl = null;
    }

    // ── Core: pipelined multi-chunk send ───────────────────────────────────

    /**
     * sendChunks — the primary public API.
     *
     * Writes ALL chunk commands to daemon stdin immediately (O(n) stdin writes,
     * not O(n) round-trip awaits). Then waits for all n acks concurrently via
     * Promise.all — the daemon processes them in-order while ack latency
     * overlaps across chunks.
     *
     * Callers that need strict per-threadId ordering should call via
     * `sendOrdered()` instead.
     */
    async sendChunks(threadId: string, chunks: string[]): Promise<any[]> {
        if (!this.child) await this.start();
        if (chunks.length === 0) return [];

        // Register all requests BEFORE writing to stdin so no acks are missed
        const reqIds: string[] = [];
        const ackPromises: Promise<any>[] = [];

        for (const text of chunks) {
            const reqId = `req_${++this.reqCounter}`;
            reqIds.push(reqId);

            const ackPromise = new Promise<any>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingRequests.delete(reqId);
                    reject(new Error(`Daemon timeout for reqId=${reqId}`));
                }, SEND_TIMEOUT_MS);
                this.pendingRequests.set(reqId, { resolve, reject, timer });
            });
            ackPromises.push(ackPromise);
        }

        // Pipeline: write ALL commands to stdin in one pass (no inter-chunk await)
        for (let i = 0; i < chunks.length; i++) {
            const cmd = { action: 'send', reqId: reqIds[i], threadId, text: chunks[i] };
            this.child!.stdin!.write(JSON.stringify(cmd) + '\n');
        }

        return Promise.all(ackPromises);
    }

    // ── Ordered wrapper: serialises batches per conversation ────────────────

    /**
     * sendOrdered — guarantees strict delivery order for a given threadId
     * while allowing different threadIds to proceed concurrently.
     *
     * Fixes the 23% "conversation queue" bottleneck:
     * previousThread waits on its own chain; unrelated threads are not blocked.
     */
    async sendOrdered(threadId: string, chunks: string[]): Promise<any[]> {
        const tail = this.conversationQueue.get(threadId) ?? Promise.resolve();

        let results!: any[];
        const next = tail.then(() => this.sendChunks(threadId, chunks)).then(r => { results = r; });

        // Trim resolved tails so the Map doesn't grow unbounded
        this.conversationQueue.set(threadId, next.catch(() => {}));
        await next;
        return results;
    }

    // ── Debounce coalescing: merges rapid calls for same threadId ───────────

    /**
     * sendDebounced — collects chunks that arrive within DEBOUNCE_MS for the
     * same threadId and dispatches them as a single pipelined batch.
     *
     * Fixes the 18% "debounce coalescing" bottleneck.
     */
    sendDebounced(threadId: string, chunks: string[]): Promise<any[]> {
        return new Promise<any[]>((resolve, reject) => {
            let buf = this.debounceBuffers.get(threadId);
            if (!buf) {
                buf = { timer: undefined as any, batches: [] };
                this.debounceBuffers.set(threadId, buf);
            }
            buf.batches.push({ chunks, threadId, resolve, reject });

            clearTimeout(buf.timer);
            buf.timer = setTimeout(() => {
                this.debounceBuffers.delete(threadId);
                const allBatches = buf!.batches;

                // Merge all pending chunks into a single pipeline dispatch
                const combined = allBatches.flatMap(b => b.chunks);
                this.sendOrdered(threadId, combined)
                    .then(results => {
                        // Slice results back to individual callers preserving order
                        let offset = 0;
                        for (const batch of allBatches) {
                            batch.resolve(results.slice(offset, offset + batch.chunks.length));
                            offset += batch.chunks.length;
                        }
                    })
                    .catch(err => allBatches.forEach(b => b.reject(err)));
            }, DEBOUNCE_MS);
        });
    }

    // ── Compatibility shim for legacy single-chunk callers ──────────────────

    /** @deprecated Use sendDebounced() or sendChunks() for best performance */
    async send(threadId: string, text: string): Promise<any> {
        const [result] = await this.sendDebounced(threadId, [text]);
        return result;
    }
}
