import { z } from 'zod';

const directionSchema = z.enum(['left', 'right', 'up', 'down']);
const splitDirectionSchema = z.enum(['vertical', 'horizontal']);

export const GOSH_MCP_PROTOCOL_METHODS = [
  'workspace.listTabs',
  'workspace.listPanes',
  'terminal.read',
  'terminal.send',
  'terminal.run',
  'pane.split',
  'pane.resize',
  'pane.focus',
  'pane.zoom',
  'pane.close',
] as const;

export type GoshMcpProtocolMethod = (typeof GOSH_MCP_PROTOCOL_METHODS)[number];

export type GoshMcpToolName =
  | 'gosh_list_workspaces'
  | 'gosh_list_panes'
  | 'gosh_terminal_read'
  | 'gosh_terminal_send'
  | 'gosh_terminal_run'
  | 'gosh_pane_split'
  | 'gosh_pane_resize'
  | 'gosh_pane_focus'
  | 'gosh_pane_zoom'
  | 'gosh_pane_close';

export type GoshMcpToolDefinition = {
  name: GoshMcpToolName;
  method: GoshMcpProtocolMethod;
  description: string;
  paramsSchema: z.ZodTypeAny;
  toParams: (args: unknown) => Record<string, unknown>;
};

export const GOSH_MCP_TOOLS: GoshMcpToolDefinition[] = [
  {
    name: 'gosh_list_workspaces',
    method: 'workspace.listTabs',
    description: 'List Gosh terminal tabs (workspace sessions).',
    paramsSchema: z.object({}).strict(),
    toParams: () => ({}),
  },
  {
    name: 'gosh_list_panes',
    method: 'workspace.listPanes',
    description: 'List panes, optionally filtered by tab id.',
    paramsSchema: z
      .object({
        tabId: z.string().min(1).optional(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z.object({ tabId: z.string().min(1).optional() }).strict().parse(args);
      return parsed.tabId ? { tabId: parsed.tabId } : {};
    },
  },
  {
    name: 'gosh_terminal_read',
    method: 'terminal.read',
    description: 'Read captured terminal text from a pane.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
        maxBytes: z.number().int().positive().optional(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          paneId: z.string().min(1),
          maxBytes: z.number().int().positive().optional(),
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_terminal_send',
    method: 'terminal.send',
    description: 'Send raw terminal input to a pane.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
        data: z.string(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          paneId: z.string().min(1),
          data: z.string(),
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_terminal_run',
    method: 'terminal.run',
    description: 'Run a shell command in a pane and wait for OSC 133 completion.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
        command: z.string().min(1),
        timeoutMs: z.number().int().positive().optional(),
        maxOutputBytes: z.number().int().positive().optional(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          paneId: z.string().min(1),
          command: z.string().min(1),
          timeoutMs: z.number().int().positive().optional(),
          maxOutputBytes: z.number().int().positive().optional(),
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_pane_split',
    method: 'pane.split',
    description: 'Split the active tab layout vertically or horizontally.',
    paramsSchema: z
      .object({
        tabId: z.string().min(1).optional(),
        direction: splitDirectionSchema,
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          tabId: z.string().min(1).optional(),
          direction: splitDirectionSchema,
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_pane_resize',
    method: 'pane.resize',
    description: 'Resize a pane in the given direction.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
        direction: directionSchema,
        amount: z.number().finite().optional(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          paneId: z.string().min(1),
          direction: directionSchema,
          amount: z.number().finite().optional(),
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_pane_focus',
    method: 'pane.focus',
    description: 'Focus a pane.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z.object({ paneId: z.string().min(1) }).strict().parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_pane_zoom',
    method: 'pane.zoom',
    description: 'Zoom or unzoom a pane.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
        zoomed: z.boolean().optional(),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z
        .object({
          paneId: z.string().min(1),
          zoomed: z.boolean().optional(),
        })
        .strict()
        .parse(args);
      return parsed;
    },
  },
  {
    name: 'gosh_pane_close',
    method: 'pane.close',
    description: 'Close a pane.',
    paramsSchema: z
      .object({
        paneId: z.string().min(1),
      })
      .strict(),
    toParams: (args) => {
      const parsed = z.object({ paneId: z.string().min(1) }).strict().parse(args);
      return parsed;
    },
  },
];

export const GOSH_MCP_TOOL_NAMES = GOSH_MCP_TOOLS.map((tool) => tool.name);

const GOSH_MCP_PROTOCOL_METHOD_SET = new Set<string>(GOSH_MCP_PROTOCOL_METHODS);

export function assertToolMethodsAreProtocolMethods(): void {
  for (const tool of GOSH_MCP_TOOLS) {
    if (!GOSH_MCP_PROTOCOL_METHOD_SET.has(tool.method)) {
      throw new Error(`Tool ${tool.name} maps to unknown protocol method ${tool.method}`);
    }
  }
}

export function getToolByName(name: string): GoshMcpToolDefinition | undefined {
  return GOSH_MCP_TOOLS.find((tool) => tool.name === name);
}

export function mcpInputSchema(schema: z.ZodTypeAny): z.ZodRawShape {
  if (schema instanceof z.ZodObject) {
    return schema.shape;
  }
  return {};
}
