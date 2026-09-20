import os from "node:os";
import path from "node:path";

/**
 * Minimal runtime shape needed to resolve the plugin data directory.
 */
export type DataDirRuntime =
  | { paths?: { dataDir?: string | null } | null | undefined }
  | null
  | undefined;

/**
 * Resolves the plugin's data directory consistently across hosts.
 *
 * Priority:
 *   1. Host-provided `runtime.paths.dataDir` (containers, standard installs)
 *   2. `~/.openclaw` (Termux/Android and other hosts that do not expose `dataDir`)
 *   3. `${os.tmpdir()}/openclaw-zulip` (last resort; explicitly not persistent)
 *
 * Before this helper the three persistence users disagreed:
 *   - dedupe store   → `~/.openclaw`
 *   - queue manager  → `${os.tmpdir()}/openclaw-zulip`
 *   - audit logger   → hard-coded `/tmp/openclaw-zulip`
 *
 * On Android there is no `/tmp`, so the audit logger silently dropped every
 * event (its failure is swallowed by design), and on container hosts the queue
 * and audit log landed in a tmpfs that is wiped whenever the container is
 * recreated. Sharing one resolver fixes both and keeps `dataDir` authoritative
 * wherever the host provides it.
 */
export function resolveZulipDataDir(runtime: DataDirRuntime): string {
  const fromHost = runtime?.paths?.dataDir;
  const trimmed = typeof fromHost === "string" ? fromHost.trim() : "";
  if (trimmed) {
    return trimmed;
  }
  const home = os.homedir();
  if (home) {
    return path.join(home, ".openclaw");
  }
  return path.join(os.tmpdir(), "openclaw-zulip");
}

/**
 * Convenience wrapper for persistent plugin state files (dedupe, queue).
 */
export function resolveZulipStatePath(runtime: DataDirRuntime, filename: string): string {
  return path.join(resolveZulipDataDir(runtime), filename);
}
