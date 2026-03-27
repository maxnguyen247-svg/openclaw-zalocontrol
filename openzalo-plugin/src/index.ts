import { OpenZcaDaemonClient } from './client.js';

// OpenClaw Channel Plugin Entry Point
// This matches standard plugin layout

export const openzaloPlugin = {
    id: 'openzalo',
    client: OpenZcaDaemonClient
};

export default {
    id: "openzalo",
    name: "OpenZalo Daemon Mode",
    description: "Fast Zalo messaging via persistent daemon architecture",
    plugin: openzaloPlugin
};
