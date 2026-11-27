/**
 * Small MCP JSON-RPC 2.0 stdio transport. MCP stdio uses ONE JSON message per
 * newline (not LSP Content-Length framing). Stdout is protocol-only.
 *
 * No MCP SDK runtime dependency: the registry already owns validation and tools.
 */
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { context, MissingEntity, type DomainContext } from "../domain/fsreader.ts";
import { invoke, isOperation, operationNames, operations } from "../domain/ops.ts";
import { CodexGateInputError } from "../domain/codex-gate.ts";
import { schemaJson } from "./http.ts";

type RpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };
type RpcError = { code: number; message: string; data?: unknown };
const fail = (id: string | number | null, code: number, message: string, data?: unknown) => ({
  jsonrpc: "2.0" as const, id, error: { code, message, ...(data === undefined ? {} : { data }) },
});
const ok = (id: string | number | null, result: unknown) => ({ jsonrpc: "2.0" as const, id, result });

export const toolsList = () => operationNames.map((name) => {
  // MCP structuredContent and outputSchema require an object at the root.
  // Wrap even array-valued domain results, but keep content[0].text as the raw
  // domain result so HTTP, CLI and MCP agree without transport-specific data.
  const { $schema: _, ...resultSchema } = schemaJson(operations[name].output);
  return {
    name, description: operations[name].description,
    inputSchema: schemaJson(operations[name].input),
    outputSchema: {
      type: "object", properties: { result: resultSchema },
      required: ["result"], additionalProperties: false,
    },
  };
});

export function mcpMessage(request: unknown, ctx: DomainContext = context()): unknown | null {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    return fail(null, -32600, "Invalid Request");
  }
  const r = request as Partial<RpcRequest>;
  if (r.jsonrpc !== "2.0" || typeof r.method !== "string" ||
      (r.id !== undefined && r.id !== null && typeof r.id !== "string" && typeof r.id !== "number")) {
    return fail(null, -32600, "Invalid Request");
  }
  // Notifications never receive a response.
  if (r.id === undefined) return null;
  switch (r.method) {
    case "initialize":
      return ok(r.id, {
        protocolVersion: typeof r.params?.protocolVersion === "string"
          ? (["2025-06-18", "2025-03-26", "2024-11-05"].includes(r.params.protocolVersion)
            ? r.params.protocolVersion : "2025-06-18")
          : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ray-board", version: "1.0.0" },
      });
    case "ping": return ok(r.id, {});
    case "tools/list": return ok(r.id, { tools: toolsList() });
    case "tools/call": {
      const name: unknown = r.params?.name;
      if (typeof name !== "string" || !isOperation(name)) {
        return fail(r.id, -32602, "Unknown tool name");
      }
      try {
        const result = invoke(name, r.params?.arguments ?? {}, ctx);
        return ok(r.id, {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: { result },
          isError: false,
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return fail(r.id, -32602, "Invalid tool input", { issues: error.issues });
        }
        if (error instanceof MissingEntity) return fail(r.id, -32602, error.message);
        if (error instanceof CodexGateInputError) return fail(r.id, -32602, error.message);
        return fail(r.id, -32603, "Internal error");
      }
    }
    default: return fail(r.id, -32601, "Method not found");
  }
}

export async function serveMcp(ctx: DomainContext = context()): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let response: unknown;
    try { response = mcpMessage(JSON.parse(line), ctx); }
    catch { response = fail(null, -32700, "Parse error"); }
    if (response !== null) process.stdout.write(JSON.stringify(response) + "\n");
  }
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  await serveMcp();
}
