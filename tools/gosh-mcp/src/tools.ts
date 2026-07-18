import { z } from 'zod';

const directionSchema = z.enum(['left', 'right', 'up', 'down']);
const splitDirectionSchema = z.enum(['vertical', 'horizontal']);

const loadStateSchema = z.enum(['load', 'idle']);

const browserTargetFields = {
  tabId: z.string().min(1).optional(),
  paneId: z.string().min(1).optional(),
};

function browserTargetSchema<T extends z.ZodRawShape>(extra: T) {
  return z
    .object({ ...browserTargetFields, ...extra })
    .strict()
    .refine((v) => Boolean(v.tabId || v.paneId), { message: 'tabId or paneId is required' });
}

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
  'browser.navigate',
  'browser.back',
  'browser.forward',
  'browser.reload',
  'browser.waitFor',
  'browser.snapshot',
  'browser.query',
  'browser.click',
  'browser.type',
  'browser.press',
  'browser.getUrl',
  'browser.getTitle',
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
  | 'gosh_pane_close'
  | 'gosh_browser_navigate'
  | 'gosh_browser_back'
  | 'gosh_browser_forward'
  | 'gosh_browser_reload'
  | 'gosh_browser_wait_for'
  | 'gosh_browser_snapshot'
  | 'gosh_browser_query'
  | 'gosh_browser_click'
  | 'gosh_browser_type'
  | 'gosh_browser_press'
  | 'gosh_browser_get_url'
  | 'gosh_browser_get_title';

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
  {
    name: 'gosh_browser_navigate',
    method: 'browser.navigate',
    description: 'Navigate a browser tab or pane to a URL.',
    paramsSchema: browserTargetSchema({ url: z.string().min(1) }),
    toParams: (args) => browserTargetSchema({ url: z.string().min(1) }).parse(args),
  },
  {
    name: 'gosh_browser_back',
    method: 'browser.back',
    description: 'Go back in browser tab or pane history.',
    paramsSchema: browserTargetSchema({}),
    toParams: (args) => browserTargetSchema({}).parse(args),
  },
  {
    name: 'gosh_browser_forward',
    method: 'browser.forward',
    description: 'Go forward in browser tab or pane history.',
    paramsSchema: browserTargetSchema({}),
    toParams: (args) => browserTargetSchema({}).parse(args),
  },
  {
    name: 'gosh_browser_reload',
    method: 'browser.reload',
    description: 'Reload the active page in a browser tab or pane.',
    paramsSchema: browserTargetSchema({}),
    toParams: (args) => browserTargetSchema({}).parse(args),
  },
  {
    name: 'gosh_browser_wait_for',
    method: 'browser.waitFor',
    description: 'Wait for a selector, text, or load state in a browser tab or pane.',
    paramsSchema: browserTargetSchema({
      selector: z.string().min(1).optional(),
      text: z.string().optional(),
      loadState: loadStateSchema.optional(),
      timeoutMs: z.number().int().positive().optional(),
      pollIntervalMs: z.number().int().positive().optional(),
    }),
    toParams: (args) =>
      browserTargetSchema({
        selector: z.string().min(1).optional(),
        text: z.string().optional(),
        loadState: loadStateSchema.optional(),
        timeoutMs: z.number().int().positive().optional(),
        pollIntervalMs: z.number().int().positive().optional(),
      }).parse(args),
  },
  {
    name: 'gosh_browser_snapshot',
    method: 'browser.snapshot',
    description: 'Capture a bounded semantic accessibility tree from a browser tab or pane.',
    paramsSchema: browserTargetSchema({
      maxNodes: z.number().int().positive().optional(),
      maxBytes: z.number().int().positive().optional(),
    }),
    toParams: (args) =>
      browserTargetSchema({
        maxNodes: z.number().int().positive().optional(),
        maxBytes: z.number().int().positive().optional(),
      }).parse(args),
  },
  {
    name: 'gosh_browser_query',
    method: 'browser.query',
    description: 'Query browser tab or pane nodes by role, name, text, or selector.',
    paramsSchema: browserTargetSchema({
      role: z.string().min(1).optional(),
      name: z.string().optional(),
      text: z.string().optional(),
      selector: z.string().min(1).optional(),
    }),
    toParams: (args) =>
      browserTargetSchema({
        role: z.string().min(1).optional(),
        name: z.string().optional(),
        text: z.string().optional(),
        selector: z.string().min(1).optional(),
      }).parse(args),
  },
  {
    name: 'gosh_browser_click',
    method: 'browser.click',
    description: 'Click a browser element by snapshot ref.',
    paramsSchema: browserTargetSchema({ ref: z.string().min(1) }),
    toParams: (args) => browserTargetSchema({ ref: z.string().min(1) }).parse(args),
  },
  {
    name: 'gosh_browser_type',
    method: 'browser.type',
    description: 'Type text into a browser input by snapshot ref.',
    paramsSchema: browserTargetSchema({
      ref: z.string().min(1),
      text: z.string(),
      clear: z.boolean().optional(),
    }),
    toParams: (args) =>
      browserTargetSchema({
        ref: z.string().min(1),
        text: z.string(),
        clear: z.boolean().optional(),
      }).parse(args),
  },
  {
    name: 'gosh_browser_press',
    method: 'browser.press',
    description: 'Press a key on a browser element by snapshot ref.',
    paramsSchema: browserTargetSchema({
      ref: z.string().min(1),
      key: z.string().min(1),
    }),
    toParams: (args) =>
      browserTargetSchema({
        ref: z.string().min(1),
        key: z.string().min(1),
      }).parse(args),
  },
  {
    name: 'gosh_browser_get_url',
    method: 'browser.getUrl',
    description: 'Get the current URL of a browser tab or pane.',
    paramsSchema: browserTargetSchema({}),
    toParams: (args) => browserTargetSchema({}).parse(args),
  },
  {
    name: 'gosh_browser_get_title',
    method: 'browser.getTitle',
    description: 'Get the current document title of a browser tab or pane.',
    paramsSchema: browserTargetSchema({}),
    toParams: (args) => browserTargetSchema({}).parse(args),
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
