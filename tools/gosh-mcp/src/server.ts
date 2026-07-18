import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { GoshControlClient } from './client.js';
import { GoshRpcError } from './rpc.js';
import {
  GOSH_MCP_TOOLS,
  assertToolMethodsAreProtocolMethods,
  getToolByName,
  mcpInputSchema,
} from './tools.js';

export type CreateGoshMcpServerOptions = {
  client: GoshControlClient;
};

export function createGoshMcpServer(options: CreateGoshMcpServerOptions): McpServer {
  assertToolMethodsAreProtocolMethods();
  const server = new McpServer({
    name: 'gosh-mcp',
    version: '0.1.0',
  });

  for (const tool of GOSH_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: mcpInputSchema(tool.paramsSchema),
      },
      async (args, extra): Promise<CallToolResult> => {
        const definition = getToolByName(tool.name);
        if (!definition) {
          return toolError(`Unknown tool: ${tool.name}`);
        }
        try {
          const params = definition.toParams(args ?? {});
          const result = await options.client.call(definition.method, params, {
            signal: extra.signal,
          });
          return structuredResult(result);
        } catch (error) {
          return rpcErrorToToolResult(error);
        }
      },
    );
  }

  return server;
}

export async function runGoshMcpServer(client: GoshControlClient): Promise<void> {
  const server = createGoshMcpServer({ client });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function structuredResult(result: unknown): CallToolResult {
  const structuredContent =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { result };
  return {
    content: [
      {
        type: 'text',
        text: 'ok',
      },
    ],
    structuredContent,
  };
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { error: message },
  };
}

function rpcErrorToToolResult(error: unknown): CallToolResult {
  if (error instanceof GoshRpcError) {
    return {
      isError: true,
      content: [{ type: 'text', text: error.message }],
      structuredContent: {
        code: error.code,
        message: error.message,
        data: error.data ?? null,
      },
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      isError: true,
      content: [{ type: 'text', text: 'Request cancelled' }],
      structuredContent: { cancelled: true },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolError(message);
}
