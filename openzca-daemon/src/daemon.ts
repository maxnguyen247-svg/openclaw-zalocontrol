import readline from 'readline';

/**
 * ZcaDaemon Worker Process
 * Keeps a persistent loop to process sending commands without Node startup overheads.
 */

// A mock generic API instance that theoretically holds the Zalo session
class ZaloSession {
    connected = false;

    async connect() {
        // In real openzca, this restores the session context using zca-js
        this.connected = true;
    }

    async sendText(threadId: string, text: string) {
        // Mock Zalo sending delay
        return new Promise(resolve => setTimeout(resolve, 150));
    }
}

async function main() {
    const session = new ZaloSession();
    await session.connect();

    // Notify parent that we are ready
    console.log(JSON.stringify({ type: 'ready' }));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        if (!line.trim()) return;
        try {
            const cmd = JSON.parse(line);
            
            if (cmd.action === 'send') {
                await session.sendText(cmd.threadId, cmd.text);
                
                // Acknowledge sending back to the parent client
                console.log(JSON.stringify({ 
                    reqId: cmd.reqId, 
                    success: true, 
                    msgId: `msg_${Date.now()}` 
                }));
            }
        } catch (err: any) {
            // Echo error back matching the line if possible
            console.log(JSON.stringify({ 
                error: err.message || 'Unknown error parse loop' 
            }));
        }
    });
}

main().catch(err => {
    console.error(JSON.stringify({ type: 'fatal', error: err.message }));
    process.exit(1);
});
