import { spawn, ChildProcess } from 'child_process';
import readline from 'readline';

export class OpenZcaDaemonClient {
    private child: ChildProcess | null = null;
    private rl: readline.Interface | null = null;
    private pendingRequests = new Map<string, (result: any) => void>();
    private reqCounter = 0;

    constructor(private daemonPath: string) {}

    async start() {
        if (this.child) return;
        
        // Spawn the daemon node process
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
                if (response.reqId && this.pendingRequests.has(response.reqId)) {
                    this.pendingRequests.get(response.reqId)!(response);
                    this.pendingRequests.delete(response.reqId);
                }
            } catch (err) {
                console.error("OpenZcaDaemonClient: Failed to parse daemon output", err);
            }
        });
        
        // Wait for ready signal if needed or just return
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    async send(threadId: string, text: string): Promise<any> {
        if (!this.child) await this.start();
        
        const reqId = `req_${++this.reqCounter}`;
        const cmd = {
            action: 'send',
            reqId,
            threadId,
            text
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(reqId, resolve);
            // Write commands sequentially via stdin pipe
            this.child!.stdin!.write(JSON.stringify(cmd) + '\\n');
            
            // Timeout gracefully
            setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new Error("Daemon response timeout"));
                }
            }, 5000);
        });
    }

    stop() {
        if (this.child) {
            this.child.kill();
            this.child = null;
            this.rl?.close();
            this.rl = null;
        }
    }
}
