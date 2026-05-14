const fs = require('fs');
let code = fs.readFileSync('src/zulip/monitor.ts', 'utf8');

const search = `      // ⚡ Bolt Optimization: Skip disk read if user is already allowed via config
      // We only need to check the store allowlist if they aren't authorized yet.
      // This saves a filesystem access on the hot path for authorized users.
      if (!senderAllowedForCommands || !groupAllowedForCommands) {
        const storeAllowFrom = normalizeAllowList(
          await core.channel.pairing.readAllowFromStore("zulip").catch(() => []),
        );
        effectiveAllowFrom = Array.from(new Set([...configAllowFrom, ...storeAllowFrom]));
        effectiveGroupAllowFrom = Array.from(new Set([...effectiveGroupAllowFrom, ...storeAllowFrom]));

        senderAllowedForCommands = isSenderAllowed({ senderId, senderName, allowFrom: effectiveAllowFrom });
        groupAllowedForCommands = isSenderAllowed({ senderId, senderName, allowFrom: effectiveGroupAllowFrom });
      }`;

const replace = `      // ⚡ Bolt Optimization: Skip disk read if user is already allowed via config
      // We only need to check the store allowlist if they aren't authorized yet.
      // This saves a filesystem access on the hot path for authorized users.
      if ((kind === "dm" && !senderAllowedForCommands) || (kind !== "dm" && !groupAllowedForCommands)) {
        const storeAllowFrom = normalizeAllowList(
          await core.channel.pairing.readAllowFromStore("zulip").catch(() => []),
        );
        effectiveAllowFrom = Array.from(new Set([...configAllowFrom, ...storeAllowFrom]));
        effectiveGroupAllowFrom = Array.from(new Set([...effectiveGroupAllowFrom, ...storeAllowFrom]));

        senderAllowedForCommands = isSenderAllowed({ senderId, senderName, allowFrom: effectiveAllowFrom });
        groupAllowedForCommands = isSenderAllowed({ senderId, senderName, allowFrom: effectiveGroupAllowFrom });
      }`;

if (code.includes(search)) {
  code = code.replace(search, replace);
  fs.writeFileSync('src/zulip/monitor.ts', code);
  console.log('Patched monitor.ts again');
} else {
  console.log('Search string not found');
}
