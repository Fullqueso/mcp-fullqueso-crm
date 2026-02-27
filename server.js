#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env only in local development
const envPath = join(__dirname, '.env');
if (existsSync(envPath)) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: envPath });
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import {
  allTools,
  handleGenerate239,
  handleGetCounters,
  handleReconcile239,
  handleFullReport239,
} from './tools/reporte-239/index.js';

// Validate required env
if (!process.env.CRM_BASE_URL) {
  console.error('ERROR: CRM_BASE_URL environment variable is required.');
  console.error('Set it in .env or pass via MCP client config.');
  process.exit(1);
}

const server = new Server(
  { name: 'mcp-fullqueso-crm', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ─── List Tools ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools,
}));

// ─── Call Tool ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'generate_239':
        result = await handleGenerate239(args);
        break;
      case 'get_counters':
        result = await handleGetCounters(args);
        break;
      case 'reconcile_239':
        result = await handleReconcile239(args);
        break;
      case 'full_report_239':
        result = await handleFullReport239(args);
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error in ${name}: ${error.message}` }],
      isError: true,
    };
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`mcp-fullqueso-crm server running (CRM: ${process.env.CRM_BASE_URL})`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
