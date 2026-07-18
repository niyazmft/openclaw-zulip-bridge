import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSafeLocalFile } from "../src/zulip/fs-utils.js";

test("readSafeLocalFile rejects symlinks", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-symlink-test-"));
  const realFile = path.join(dir, "real.txt");
  const symlinkFile = path.join(dir, "link.txt");

  await fs.writeFile(realFile, "hello");
  await fs.symlink(realFile, symlinkFile);

  try {
    await assert.rejects(
      readSafeLocalFile(symlinkFile),
      /Symlinks are not allowed/,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("readSafeLocalFile allows regular files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zulip-symlink-test-"));
  const realFile = path.join(dir, "real.txt");

  await fs.writeFile(realFile, "hello world");

  try {
    const buffer = await readSafeLocalFile(realFile);
    assert.strictEqual(buffer.toString(), "hello world");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
