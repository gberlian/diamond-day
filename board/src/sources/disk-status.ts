import { readDiskStatus, type DiskStatus } from "../disk-status.ts";
import type { Source } from "./types.ts";
export const diskSource: Source<DiskStatus> = {
  read(config) {
    if (!config.integrations.diskStatus.enabled) return null;
    return readDiskStatus(config.integrations.diskStatus.path);
  },
};
