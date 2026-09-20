import fs from "node:fs";
import path from "node:path";
import type { PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import { resolveZulipDataDir } from "./zulip/data-dir.js";

const RUNTIME_KEY = "__openclaw_zulip_runtime__";
const FALLBACK_KEY = "__openclaw_zulip_runtime_fallback__";

/** Chunk size used by the CLI fallback when the host would not supply one. */
const FALLBACK_CHUNK_LIMIT = 4000;

/**
 * Registers the host-provided plugin runtime.
 *
 * Called from the gateway registration path (`registerFull`). The gateway
 * runtime is always authoritative and takes precedence over the CLI fallback.
 */
export function setZulipRuntime(next: PluginRuntime) {
  (globalThis as any)[RUNTIME_KEY] = next;
}

/**
 * Clears the registered runtime and the cached CLI fallback.
 * Intended for tests and hot reloads.
 */
export function clearZulipRuntime() {
  delete (globalThis as any)[RUNTIME_KEY];
  delete (globalThis as any)[FALLBACK_KEY];
}

/** True when a host runtime has been registered (i.e. gateway registration ran). */
export function isZulipRuntimeRegistered(): boolean {
  return Boolean((globalThis as any)[RUNTIME_KEY]);
}

/**
 * Returns the plugin runtime.
 *
 * Order:
 *  1. the runtime the host registered during gateway startup (authoritative)
 *  2. a minimal CLI fallback, built once and cached (#285)
 *
 * `openclaw message send --channel zulip` loads the plugin entry and dispatches
 * channel actions **without** running gateway registration, so the singleton is
 * never set. Throwing in that situation made every CLI send fail outright, so a
 * deliberately small fallback is provided instead: config, logging, paths and
 * the `channel.text` helpers needed to format and chunk outbound text.
 *
 * Gateway-only subsystems (mentions, reply dispatch, session routing, pairing
 * and remote-media fetch) are intentionally absent: the monitor and reply
 * pipeline only run inside the gateway, where the real runtime is registered.
 */
export function getZulipRuntime(): PluginRuntime {
  const runtime = (globalThis as any)[RUNTIME_KEY];
  if (runtime) {
    return runtime;
  }
  let fallback = (globalThis as any)[FALLBACK_KEY];
  if (!fallback) {
    fallback = buildCliRuntimeFallback();
    (globalThis as any)[FALLBACK_KEY] = fallback;
  }
  return fallback;
}

/**
 * Reads the OpenClaw config file used by the CLI fallback.
 *
 * Returns an empty object when the file is missing, unreadable or invalid, so
 * env-var credentials (`ZULIP_URL` / `ZULIP_EMAIL` / `ZULIP_API_KEY`) still
 * resolve for the default account instead of failing the whole send.
 */
export function readOpenClawConfigFile(filePath?: string): Record<string, unknown> {
  const file = filePath ?? path.join(resolveZulipDataDir(undefined), "openclaw.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatArg(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function makeConsoleLogger(moduleName?: string) {
  const prefix = moduleName ? `[${moduleName}] ` : "";
  const format = (args: unknown[]) => prefix + args.map(formatArg).join(" ");
  return {
    debug: (..._args: unknown[]) => undefined,
    info: (...args: unknown[]) => {
      try {
        console.log(format(args));
      } catch {
        // logging must never break a send
      }
    },
    warn: (...args: unknown[]) => {
      try {
        console.warn(format(args));
      } catch {
        // ignore
      }
    },
    error: (...args: unknown[]) => {
      try {
        console.error(format(args));
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Conservative, markdown-agnostic chunking used only by the CLI fallback.
 * The gateway path always uses the host's markdown-aware chunker instead.
 */
function chunkByLength(text: string, limit?: number): string[] {
  const size =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : FALLBACK_CHUNK_LIMIT;
  if (text.length <= size) {
    return [text];
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }
  return chunks;
}

function buildCliRuntimeFallback(): PluginRuntime {
  const logger = makeConsoleLogger("zulip");
  return {
    config: {
      current: () => readOpenClawConfigFile(),
    },
    logging: {
      getChildLogger: (opts?: { module?: string }) => makeConsoleLogger(opts?.module ?? "zulip"),
      shouldLogVerbose: () => false,
    },
    log: (...args: unknown[]) => logger.info(...args),
    error: (...args: unknown[]) => logger.error(...args),
    paths: { dataDir: resolveZulipDataDir(undefined) },
    channel: {
      text: {
        // Table conversion and chunk modes are host features; the CLI fallback
        // leaves text untouched and chunks purely by length so sends still work.
        resolveMarkdownTableMode: () => "off",
        convertMarkdownTables: (text: string) => text,
        resolveChunkMode: () => "length",
        resolveTextChunkLimit: (
          _cfg: unknown,
          _channel: unknown,
          _accountId: unknown,
          opts?: { fallbackLimit?: number },
        ) => (typeof opts?.fallbackLimit === "number" ? opts.fallbackLimit : FALLBACK_CHUNK_LIMIT),
        chunkMarkdownText: (text: string, limit?: number) => chunkByLength(text, limit),
        chunkMarkdownTextWithMode: (text: string, limit?: number) => chunkByLength(text, limit),
        hasControlCommand: () => false,
      },
      activity: {
        record: () => undefined,
      },
    },
  } as unknown as PluginRuntime;
}
