import { fileURLToPath } from "node:url";
import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
export const home = () => path.resolve(process.env.HOME || process.env.USERPROFILE || homedir());
export const installDir = () => path.join(home(), '.arpe');
export const loopback = 'localhost';
export type Settings = {integrations?: Partial<Integrations>; codeRoot?: string; root: string; port: number; sharePort?: number; shareOrigin?: string; claudeProjectsDir?: string; usageProxyDb?: string; usageProxyPrices?: string; runtime: string; runtimeArgs: string[]; token: string; ownsRoot: boolean; agent: string};
export function settings(): Settings {
  const file = path.join(installDir(), 'settings.json');
  if (!existsSync(file)) throw new Error('Run the arpe installer first.');
  const s = JSON.parse(readFileSync(file,'utf8')) as Settings;
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error('Invalid board port');
  if(s.sharePort!==undefined&&(!Number.isInteger(s.sharePort)||s.sharePort<1||s.sharePort>65535||s.sharePort===s.port))throw new Error("Invalid share port");
  return s;
}
export const url = (s: Settings) => `http://${loopback}:${s.port}`;

export type OptionalSource = { enabled: boolean; path?: string; url?: string };
export type Integrations = {
  handoffQueues: OptionalSource; usageProxy: OptionalSource; restarter: OptionalSource;
  diskStatus: OptionalSource; codexGate: OptionalSource; ledger: OptionalSource; chatAsk: OptionalSource;
  openWith: "off" | "system" | "md-aio";
};
export type BoardConfig = {
  raysRoot: string; codeRoot: string; claudeProjectsDir: string; dataDir: string;
  port: number; host: string; integrations: Integrations; actions: boolean; proxyOrigin?: string;
};

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const demoRoot = path.join(repoRoot, 'demo');
export function loadConfig(): BoardConfig {
  let s: Settings | undefined; try { s = settings(); } catch {}
  const i = s?.integrations ?? {};
  const source = (v: OptionalSource | undefined): OptionalSource => v?.enabled === true && typeof v.path === 'string' && path.isAbsolute(v.path) && existsSync(v.path) ? {enabled:true,path:v.path} : {enabled:false};
  // Public kit does not ship the external machine automation. Only read-only usage is supported.
  const off = (): OptionalSource => ({enabled:false});
  return {raysRoot:s?.root ?? path.join(home(),'rays'), codeRoot:s?.codeRoot ?? path.join(home(),'code'),
    claudeProjectsDir:s?.claudeProjectsDir ?? path.join(home(),'.claude','projects'), dataDir:installDir(),
    host:loopback,port:s?.port ?? 5195,actions:true,integrations:{handoffQueues:off(),usageProxy:source(i.usageProxy),restarter:off(),diskStatus:off(),codexGate:off(),ledger:off(),chatAsk:off(),openWith:'off'}};
}
