#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { context, MissingEntity, type DomainContext } from "../domain/fsreader.ts";
import { invoke, isOperation, operationNames, operations } from "../domain/ops.ts";
import { CodexGateInputError } from "../domain/codex-gate.ts";
import { decodeStringFields, schemaJson } from "./http.ts";

export type CliResult = { code: number; stdout: string; stderr: string };
const success = (output: string): CliResult => ({ code: 0, stdout: output + "\n", stderr: "" });
const failure = (message: string, code = 2): CliResult => ({ code, stdout: "", stderr: message + "\n" });
const flagName = (property: string) => property.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const propertyName = (flag: string) => flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export function helpText(): string {
  const rows = [
    "Usage: rays <operation> [--flag value] [--json]",
    "Ray views and Codex gate. Set RAYS_ROOT or ray-board.config.json to choose ray folders.",
    "",
    "Operations:",
  ];
  for (const name of operationNames) {
    const properties = schemaJson(operations[name].input).properties ?? {};
    const required = new Set<string>(schemaJson(operations[name].input).required ?? []);
    const flags = Object.entries(properties)
      .map(([key, value]) => `--${flagName(key)}${required.has(key) ? " <value>" : " [value]"}`)
      .join(" ");
    rows.push(`  ${name}${flags ? " " + flags : ""}`);
    rows.push(`    ${operations[name].description}`);
  }
  rows.push("", "Use --json for machine-readable JSON, or --help for this generated help.");
  return rows.join("\n");
}

/** Generic compact table for any output schema; nested values are serialized in cells. */
export function asTable(value: unknown): string {
  const expand = (item: unknown, parent: Record<string, unknown> = {}): Record<string, unknown>[] => {
    if (Array.isArray(item)) return item.flatMap((entry) => expand(entry, parent));
    if (!item || typeof item !== "object") return [{ ...parent, value: item }];
    const object = item as Record<string, unknown>;
    const expandables = Object.entries(object).filter(([, val]) =>
      Array.isArray(val) && val.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry)));
    if (expandables.length === 1) {
      const [key, children] = expandables[0]!;
      const rest = Object.fromEntries(Object.entries(object).filter(([k]) => k !== key));
      const values = children as Record<string, unknown>[];
      return values.length ? values.flatMap((child) => expand(child, { ...parent, ...rest }))
        : [{ ...parent, ...rest }];
    }
    return [{ ...parent, ...object }];
  };
  const rowObjects = expand(value);
  if (!rowObjects.length) return "(none)";
  const keys = [...new Set(rowObjects.flatMap((r) => Object.keys(r)))];
  const cell = (x: unknown): string => x === null || x === undefined ? "-" :
    typeof x === "object" ? JSON.stringify(x) : String(x);
  const widths = keys.map((k) => Math.min(56, Math.max(k.length, ...rowObjects.map((r) => cell(r[k]).length))));
  const display = (text: string, n: number) =>
    (text.length > n ? text.slice(0, Math.max(0, n - 1)) + "…" : text).padEnd(n, " ");
  const line = (row: Record<string, unknown>) => keys.map((key, i) => display(cell(row[key]), widths[i]!)).join("  ").trimEnd();
  return [keys.map((key, i) => display(key, widths[i]!)).join("  ").trimEnd(),
    ...rowObjects.map(line)].join("\n");
}

export function runCli(argv: string[], ctx: DomainContext = context()): CliResult {
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") return success(helpText());
  const name = argv[0]!;
  if (!isOperation(name)) return failure(`Unknown operation: ${name}\n${helpText()}`);
  if (argv.slice(1).includes("--help")) return success(helpText());

  const properties = schemaJson(operations[name].input).properties ?? {};
  const pairs: [string, string][] = [];
  let json = false;
  for (let i = 1; i < argv.length; i++) {
    let flag = argv[i]!;
    if (flag === "--json") { json = true; continue; }
    if (!flag.startsWith("--")) return failure(`Unexpected argument: ${flag}`);
    const equals = flag.indexOf("=");
    const suppliedValue = equals < 0 ? undefined : flag.slice(equals + 1);
    if (equals >= 0) flag = flag.slice(0, equals);
    const property = propertyName(flag.slice(2));
    if (!Object.prototype.hasOwnProperty.call(properties, property)) return failure(`Unknown flag: ${flag}`);
    const value = suppliedValue ?? argv[++i];
    if (value === undefined || (suppliedValue === undefined && value.startsWith("--"))) {
      return failure(`Missing value for ${flag}`);
    }
    pairs.push([property, value]);
  }
  try {
    const output = invoke(name, decodeStringFields(name, pairs), ctx);
    return success(json ? JSON.stringify(output) : asTable(output));
  } catch (error) {
    if (error instanceof z.ZodError) return failure(JSON.stringify({ error: "invalid_input", issues: error.issues }));
    if (error instanceof MissingEntity) return failure(error.message, 1);
    if (error instanceof CodexGateInputError) return failure(error.message, 2);
    return failure("Internal error", 1);
  }
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.code;
}
