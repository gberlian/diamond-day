import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
export const home = () => path.resolve(process.env.HOME || process.env.USERPROFILE || homedir());
export const installDir = () => path.join(home(), '.diamond-day');
export const loopback = 'localhost';
export type Settings = {root: string; port: number; runtime: string; runtimeArgs: string[]; token: string; ownsRoot: boolean; agent: string};
export function settings(): Settings {
  const file = path.join(installDir(), 'settings.json');
  if (!existsSync(file)) throw new Error('Run the diamond-day installer first.');
  const s = JSON.parse(readFileSync(file,'utf8')) as Settings;
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error('Invalid board port');
  return s;
}
export const url = (s: Settings) => `http://${loopback}:${s.port}`;
