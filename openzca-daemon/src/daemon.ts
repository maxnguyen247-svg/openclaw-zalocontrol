import readline from 'readline';

/**
 * ZcaDaemon Worker Process
 *
 * Runs as a persistent child process. Accepts newline-delimited JSON commands
 * from parent via stdin; replies with JSON acks via stdout.
 *
 * Because the daemon is a single long-lived process, there is no per-message
 * Node.js startup overhead. The key invariant: commands are processed
 * SEQUENTIALLY in the order received — the parent is responsible for
 * pipelining writes (which it does via sendChunks). This gives us
 * Zalo delivery-order guarantees with no extra locking on the daemon side.
 */

type SendCmd = {
    action: 'send';
    reqId: string;
    threadId: string;
    text: string;
};

type Cmd = SendCmd;

// ── Simulated Zalo session (replace with real zca-js API calls) ──────────────

async function sendViaZalo(threadId: string, text: string): Promise<string> {
    // Real implementation: await zaloApi.sendMessage(threadId, text);
    await new Promise(resolve => setTimeout(resolve, 150)); // simulated network RTT
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function main() {
    // Signal readiness to parent
    process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    // Process commands sequentially (preserves Zalo delivery order)
    // The parent pipelines writes so we receive them rapidly; we resolve each
    // in-order and ack immediately — enabling the parent's Promise.all to
    // resolve sooner than fully sequential round-trips would allow.
    for await (const line of rl) {
        if (!line.trim()) continue;
        let cmd: Cmd | null = null;
        try {
            cmd = JSON.parse(line);
        } catch {
            process.stdout.write(JSON.stringify({ error: 'parse_error' }) + '\n');
            continue;
        }

        if (!cmd) continue;

        if (cmd.action === 'send') {
            try {
                const msgId = await sendViaZalo(cmd.threadId, cmd.text);
                process.stdout.write(
                    JSON.stringify({ reqId: cmd.reqId, success: true, msgId }) + '\n'
                );
            } catch (err: any) {
                process.stdout.write(
                    JSON.stringify({ reqId: cmd.reqId, error: err.message }) + '\n'
                );
            }
        }
    }
}

main().catch(err => {
    process.stderr.write(JSON.stringify({ type: 'fatal', error: String(err) }) + '\n');
    process.exit(1);
});
