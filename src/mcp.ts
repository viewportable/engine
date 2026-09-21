#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createViewportableMcpServer } from './mcp-server.js';

void serveStdio(() => createViewportableMcpServer());
console.error('Viewportable Engine MCP server running on stdio');
