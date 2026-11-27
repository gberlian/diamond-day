import { z } from "zod";
import { context, MissingEntity, type DomainContext } from "../domain/fsreader.ts";
import { invoke, isOperation, operationNames, operations } from "../domain/ops.ts";
import { CodexGateInputError } from "../domain/codex-gate.ts";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "no-store" },
});

/** Zod 4 is already a JSON Schema generator; no second schema library is needed. */
export const schemaJson = (schema: z.ZodType): Record<string, any> =>
  z.toJSONSchema(schema) as Record<string, any>;

const wireSchema = (opName: keyof typeof operations) => schemaJson(operations[opName].input);

/** Schema-driven URL/CLI scalar conversion: MCP already supplies native JSON values. */
export function decodeStringFields(name: keyof typeof operations, pairs: [string, string][]): Record<string, unknown> {
  const properties = wireSchema(name).properties ?? {};
  const unknown = [...new Set(pairs.map(([key]) => key).filter((key) =>
    !Object.prototype.hasOwnProperty.call(properties, key)))];
  if (unknown.length) throw new z.ZodError([{
    code: "unrecognized_keys", keys: unknown, path: [],
    message: `Unrecognized key(s): ${unknown.join(", ")}`,
  }]);
  const args: Record<string, unknown> = Object.create(null);
  for (const [key, raw] of pairs) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = [args[key], raw]; // invalid type, reported by Zod
      continue;
    }
    const property = properties[key] as Record<string, unknown> | undefined;
    if (property?.type === "number" || property?.type === "integer") {
      args[key] = raw.trim() === "" ? NaN : Number(raw);
    } else if (property?.type === "boolean") {
      args[key] = raw === "true" ? true : raw === "false" ? false : raw;
    } else {
      args[key] = raw;
    }
  }
  return args;
}

export function openApiDocument() {
  const paths: Record<string, any> = {};
  for (const name of operationNames) {
    const op = operations[name];
    const input = wireSchema(name);
    const required = new Set<string>(input.required ?? []);
    paths[`/api/${name}`] = {
      get: {
        operationId: name, description: op.description, summary: name,
        parameters: Object.entries(input.properties ?? {}).map(([param, schema]) => ({
          name: param, in: "query", required: required.has(param),
          schema, description: (schema as { description?: string }).description,
        })),
        responses: {
          "200": { description: "Validated domain result", content: {
            "application/json": { schema: schemaJson(op.output) },
          } },
          "400": { description: "Invalid query", content: { "application/json": { schema: {
            type: "object", properties: { error: { type: "string" }, issues: { type: "array", items: { type: "object" } } },
            required: ["error", "issues"],
          } } } },
          "404": { description: "Ray or handoff not found" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Ray Domain API", version: "1.0.0", description: "Ray views and Codex admission gate" },
    paths,
  };
}

/** Return null for non-domain paths; caller retains /board and proxy routing. */
export function handleApi(request: Request, ctx: DomainContext = context()): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== "/api/openapi.json" && !url.pathname.startsWith("/api/")) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (url.pathname === "/api/openapi.json") return json(openApiDocument());
  const name = url.pathname.slice("/api/".length);
  if (!isOperation(name)) return null; // permits existing /api/board and unrelated proxy APIs
  try {
    const input = decodeStringFields(name, [...url.searchParams.entries()]);
    return json(invoke(name, input, ctx));
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: "invalid_input", issues: error.issues }, 400);
    if (error instanceof MissingEntity) return json({ error: "not_found", message: error.message }, 404);
    if (error instanceof CodexGateInputError) return json({ error: "invalid_caller", message: error.message }, 400);
    return json({ error: "internal_error" }, 500);
  }
}
