// ==========================================================================
// Agent tool layer tests — registry validation, policy gating, protocol
// marshalling and the bounded agent loop.
//
// The loop is exercised with a scripted `callModel`, so no network and no DOM
// are involved: this is the contract that keeps a tool-driving assistant from
// looping forever or calling something it was never offered.
// ==========================================================================

import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry, isMutatingTool, isReadOnlyTool, validateToolArgs } from '@/core/ai/tools/registry';
import { errorResult, parseDataUrl, textResult, textWithImage } from '@/core/ai/tools/types';
import {
  MAX_STEPS,
  parseArgs,
  runAgent,
  selectTools,
  toOpenAiTools,
} from '@/core/ai/agent';
import {
  buildSystemPrompt,
  parseChatResponse,
  requestHasImages,
  userMessageWithImages,
  type ChatMessage,
  type ChatResponse,
} from '@/core/ai/protocol';
import type { ToolDefinition, ToolResult } from '@/core/ai/tools/types';

// ---- registry ---------------------------------------------------------------

describe('tool registry', () => {
  const echo: ToolDefinition = {
    name: 'echo',
    description: 'echo back',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, count: { type: 'integer' } },
      required: ['text'],
    },
  };

  it('validates required fields and primitive types', () => {
    expect(validateToolArgs(echo.inputSchema, { text: 'hi' })).toBeNull();
    expect(validateToolArgs(echo.inputSchema, {})).toContain('missing required argument "text"');
    expect(validateToolArgs(echo.inputSchema, { text: 'hi', count: 1.5 })).toContain('must be an integer');
    expect(validateToolArgs(echo.inputSchema, { text: 5 })).toContain('must be a string');
    // unknown keys are tolerated: MCP servers publish schemas we forward verbatim
    expect(validateToolArgs(echo.inputSchema, { text: 'hi', extra: true })).toBeNull();
  });

  it('invokes a handler and wraps thrown errors as tool results', async () => {
    const reg = new ToolRegistry();
    reg.register({ definition: echo, handler: (args) => textResult(String(args.text)) });
    const ok = await reg.invoke('echo', { text: 'ping' });
    expect(ok.isError).toBeFalsy();
    expect(ok.content[0]).toEqual({ type: 'text', text: 'ping' });

    reg.register({
      definition: { ...echo, name: 'boom' },
      handler: () => {
        throw new Error('kaput');
      },
    });
    const failed = await reg.invoke('boom', { text: 'x' });
    expect(failed.isError).toBe(true);
    expect(String((failed.content[0] as { text: string }).text)).toContain('kaput');
  });

  it('refuses unknown tools and non-object arguments', async () => {
    const reg = new ToolRegistry();
    reg.register({ definition: echo, handler: () => textResult('x') });
    expect((await reg.invoke('nope', {})).isError).toBe(true);
    expect((await reg.invoke('echo', 'not json')).isError).toBe(true);
    // a JSON-encoded object string is accepted (models sometimes double-encode)
    expect((await reg.invoke('echo', '{"text":"a"}')).isError).toBeFalsy();
  });

  it('gates mutating tools on the allowed set, never read-only ones', async () => {
    const reg = new ToolRegistry();
    reg.register({ definition: { ...echo, name: 'list_plugins' }, handler: () => textResult('ok') });
    reg.register({ definition: { ...echo, name: 'set_plugin_params' }, handler: () => textResult('ok') });
    const allowed = new Set(['list_plugins']);
    expect((await reg.invoke('list_plugins', { text: 'x' }, { allowed })).isError).toBeFalsy();
    const blocked = await reg.invoke('set_plugin_params', { text: 'x' }, { allowed });
    expect(blocked.isError).toBe(true);
    expect(String((blocked.content[0] as { text: string }).text)).toContain('not enabled');
  });

  it('replaceSource swaps one tool source without touching the other', () => {
    const reg = new ToolRegistry();
    reg.register({ definition: { ...echo, name: 'a', source: 'host' }, handler: () => textResult('') });
    reg.register({ definition: { ...echo, name: 'b', source: 'mcp' }, handler: () => textResult('') });
    reg.replaceSource('mcp', [{ definition: { ...echo, name: 'c', source: 'mcp' }, handler: () => textResult('') }]);
    expect(reg.list().map((t) => t.name).sort()).toEqual(['a', 'c']);
  });

  it('classifies the built-in host tools', () => {
    expect(isReadOnlyTool('list_plugins')).toBe(true);
    expect(isReadOnlyTool('get_canvas_snapshot')).toBe(true);
    expect(isMutatingTool('set_plugin_params')).toBe(true);
    expect(isMutatingTool('run_code')).toBe(true);
    expect(isMutatingTool('list_plugins')).toBe(false);
  });
});

// ---- content blocks ---------------------------------------------------------

describe('tool content blocks', () => {
  it('splits a base64 data URL into mime + payload', () => {
    expect(parseDataUrl('data:image/png;base64,AAAA')).toEqual({ mimeType: 'image/png', data: 'AAAA' });
    // non-base64 data URLs are rejected rather than mislabelled
    expect(parseDataUrl('data:image/png,raw')).toBeNull();
    expect(parseDataUrl('not-a-data-url')).toBeNull();
  });

  it('attaches an image block only when the data URL parses', () => {
    const withImg = textWithImage('shot', 'data:image/png;base64,QQ==');
    expect(withImg.content).toHaveLength(2);
    expect(withImg.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: 'QQ==' });
    const noImg = textWithImage('shot', 'garbage');
    expect(noImg.content).toHaveLength(1);
  });
});

// ---- protocol ---------------------------------------------------------------

describe('chat protocol', () => {
  it('parses text, tool calls and finish reason', () => {
    const parsed = parseChatResponse({
      choices: [
        {
          message: {
            content: 'thinking…',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'list_plugins', arguments: '{"a":1}' } },
              // a proxy that passes arguments through as an object
              { function: { name: 'get_plugin_params', arguments: { pluginId: 'p' } } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    expect(parsed.text).toBe('thinking…');
    expect(parsed.toolCalls).toHaveLength(2);
    expect(parsed.toolCalls[0]!.function.arguments).toBe('{"a":1}');
    expect(parsed.toolCalls[1]!.function.arguments).toBe('{"pluginId":"p"}');
    // a missing id must not produce an undefined key the service would reject
    expect(parsed.toolCalls[1]!.id).toBe('call_1');
    expect(parsed.finishReason).toBe('tool_calls');
    expect(parsed.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('tolerates null content and multipart content arrays', () => {
    expect(parseChatResponse({ choices: [{ message: { content: null } }] }).text).toBe('');
    expect(
      parseChatResponse({
        choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }],
      }).text,
    ).toBe('ab');
    expect(() => parseChatResponse({})).toThrow(/choices/);
  });

  it('builds image parts and detects them', () => {
    const plain = userMessageWithImages('hi', []);
    expect(plain.content).toBe('hi');
    expect(requestHasImages([plain])).toBe(false);
    const withImg = userMessageWithImages('see', ['data:image/png;base64,QQ==']);
    expect(requestHasImages([withImg])).toBe(true);
    expect(withImg.content).toEqual([
      { type: 'text', text: 'see' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QQ==' } },
    ]);
  });

  it('system prompt reflects the operate/vision policy', () => {
    expect(buildSystemPrompt('zh-CN', { canOperate: true, vision: true })).toContain('工具');
    expect(buildSystemPrompt('zh-CN', { canOperate: false, vision: false })).toContain('只读');
    expect(buildSystemPrompt('en-US', { canOperate: false, vision: false })).toContain('read-only');
    expect(buildSystemPrompt('en-US', { canOperate: true, vision: true })).toContain('screenshots');
  });

  it('maps descriptors into the OpenAI functions dialect', () => {
    const specs = toOpenAiTools([
      { name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(specs[0]!.type).toBe('function');
    expect(specs[0]!.function.name).toBe('t');
    expect(specs[0]!.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

// ---- agent loop -------------------------------------------------------------

const TOOLS: ToolDefinition[] = [
  { name: 'list_plugins', description: 'read', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'set_plugin_params',
    description: 'write',
    inputSchema: { type: 'object', properties: { params: { type: 'object' } } },
  },
  { name: 'get_canvas_snapshot', description: 'vision', inputSchema: { type: 'object', properties: {} } },
];

function reply(partial: Partial<ChatResponse>): ChatResponse {
  return { text: '', toolCalls: [], finishReason: 'stop', ...partial };
}

describe('agent loop', () => {
  it('returns immediately when the model answers without tools', async () => {
    const invoke = vi.fn(async (_name: string, _args: unknown): Promise<ToolResult> => textResult(''));
    const result = await runAgent({
      locale: 'en-US',
      prompt: 'hello',
      tools: TOOLS,
      canOperate: true,
      vision: false,
      invokeTool: invoke,
      callModel: async () => reply({ text: 'hi there' }),
    });
    expect(result.text).toBe('hi there');
    expect(result.calls).toHaveLength(0);
    expect(result.truncated).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('runs a tool and feeds its result back to the model', async () => {
    const seen: ChatMessage[][] = [];
    let turn = 0;
    const result = await runAgent({
      locale: 'en-US',
      prompt: 'which plugins exist?',
      tools: TOOLS,
      canOperate: true,
      vision: false,
      invokeTool: async (name, args) => {
        expect(name).toBe('list_plugins');
        expect(args).toEqual({});
        return textResult('{"plugins":["a"]}');
      },
      callModel: async (messages) => {
        seen.push(messages.map((m) => ({ ...m })));
        turn += 1;
        if (turn === 1) {
          return reply({
            toolCalls: [{ id: 'x', type: 'function', function: { name: 'list_plugins', arguments: '{}' } }],
            finishReason: 'tool_calls',
          });
        }
        return reply({ text: 'There is one plugin: a.' });
      },
    });
    expect(result.text).toBe('There is one plugin: a.');
    expect(result.calls).toEqual([
      { name: 'list_plugins', args: {}, isError: false, summary: '{"plugins":["a"]}', hasImage: false },
    ]);
    // second request must carry the assistant tool_calls turn and the tool reply
    const second = seen[1]!;
    expect(second.at(-2)?.role).toBe('assistant');
    expect(second.at(-2)?.tool_calls?.[0]?.id).toBe('x');
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'x', content: '{"plugins":["a"]}' });
  });

  it('reports an errored tool call to the model instead of aborting', async () => {
    let turn = 0;
    const result = await runAgent({
      locale: 'en-US',
      prompt: 'do it',
      tools: TOOLS,
      canOperate: true,
      vision: false,
      invokeTool: () => errorResult('no such plugin'),
      callModel: async () => {
        turn += 1;
        if (turn === 1) {
          return reply({
            toolCalls: [{ id: 'e', type: 'function', function: { name: 'set_plugin_params', arguments: '{"params":{}}' } }],
          });
        }
        return reply({ text: 'I could not find that plugin.' });
      },
    });
    expect(result.calls[0]!.isError).toBe(true);
    expect(result.calls[0]!.summary).toContain('no such plugin');
    expect(result.text).toBe('I could not find that plugin.');
  });

  it(`stops at the ${MAX_STEPS}-step cap and reports truncation`, async () => {
    let turn = 0;
    const notices: string[] = [];
    const result = await runAgent({
      locale: 'en-US',
      prompt: 'spin',
      tools: TOOLS,
      canOperate: true,
      vision: false,
      invokeTool: () => textResult('again'),
      onEvent: (e) => {
        if (e.type === 'notice') notices.push(e.text);
      },
      callModel: async () => {
        turn += 1;
        return reply({
          toolCalls: [{ id: `s${turn}`, type: 'function', function: { name: 'list_plugins', arguments: '{}' } }],
        });
      },
    });
    expect(turn).toBe(MAX_STEPS);
    expect(result.truncated).toBe(true);
    expect(result.text).toBe('');
    expect(result.calls).toHaveLength(MAX_STEPS);
    expect(notices).toHaveLength(1);
  });

  it('hides mutating and vision tools from the model when unauthorized', async () => {
    let offered: string[] = [];
    await runAgent({
      locale: 'en-US',
      prompt: 'x',
      tools: TOOLS,
      canOperate: false,
      vision: false,
      invokeTool: () => textResult(''),
      callModel: async (_m, tools) => {
        offered = tools.map((t) => t.function.name);
        return reply({ text: 'ok' });
      },
    });
    expect(offered).toEqual(['list_plugins']);
    expect(selectTools(TOOLS, { canOperate: true, vision: true }).map((t) => t.name)).toHaveLength(3);
  });

  it('parses malformed tool arguments as an empty object', () => {
    expect(parseArgs('')).toEqual({});
    expect(parseArgs('{oops')).toEqual({});
    expect(parseArgs('[1,2]')).toEqual({});
    expect(parseArgs('{"a":1}')).toEqual({ a: 1 });
  });
});
