import readline from 'readline';

/**
 * ZcaDaemon Worker Process
 *
 * Runs as a persistent child process — no per-message Node.js startup overhead.
 * Accepts newline-delimited JSON commands from parent via stdin.
 * Replies with JSON acks via stdout.
 *
 * Commands are processed SEQUENTIALLY in arrival order, preserving Zalo
 * delivery guarantees. The parent pipelines writes (sendChunks) so network
 * latency for chunk N overlaps with processing N+1, N+2...
 */

type SendCmd = {
    action: 'send';
    reqId: string;
    threadId: string;
    text: string;
};

// ── Zalo session (replace with real zca-js API calls) ────────────────────────

async function sendViaZalo(threadId: string, text: string): Promise<string> {
    // Real usage: await zaloApi.sendMessage(threadId, text);
    await new Promise(resolve => setTimeout(resolve, 150));
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Main daemon loop ──────────────────────────────────────────────────────────

async function main() {
    process.stdout.write(JSON.stringify({ type: 'ready' }) + '\n');

    const rl = readline.createInterface({ input: process.stdin, terminal: false });

    for await (const line of rl) {
        if (!line.trim()) continue;
        let cmd: SendCmd | null = null;
        try {
            cmd = JSON.parse(line);
        } catch {
            process.stdout.write(JSON.stringify({ error: 'parse_error' }) + '\n');
            continue;
        }

        if (cmd?.action === 'send') {
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
