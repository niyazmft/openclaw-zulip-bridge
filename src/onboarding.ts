import type { ChannelOnboardingAdapter, OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { ZulipAccountConfig, ZulipConfig } from "./types.js";
import { promptAccountId } from "./onboarding-helpers.js";
import {
  getZulipEnvSecret,
  hasZulipEnvSecrets,
  listZulipAccountIds,
  resolveDefaultZulipAccountId,
  resolveZulipAccount,
} from "./zulip/accounts.js";
import { createZulipClient, fetchZulipSubscriptions } from "./zulip/client.js";
import { maskPII } from "./zulip/monitor-helpers.js";
import { probeZulip } from "./zulip/probe.js";

const channel = "zulip" as const;

async function noteZulipSetup(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) In Zulip: Settings -> Bots -> Add a new bot (Generic bot recommended).",
      "2) Copy the bot's Email, API Key, and Server URL.",
      "",
      "Security Recommendation:",
      "Use environment variables to avoid storing secrets in plaintext on disk.",
      "Required variables: ZULIP_API_KEY, ZULIP_EMAIL, ZULIP_URL",
      "",
      "Tip: the bot must be a member of any stream you want it to monitor.",
      "Docs: https://docs.openclaw.ai/channels/zulip",
    ].join("\n"),
    "Zulip Setup",
  );
}

async function warnPlaintextSecrets(prompter: WizardPrompter): Promise<boolean | symbol> {
  await prompter.note(
    "WARNING: Entering credentials here will store them in plaintext in your configuration file. This is suboptimal for security.",
    "Security Warning",
  );
  return await prompter.confirm({
    message: "Are you sure you want to proceed with config-file storage?",
    initialValue: false,
  });
}

export const zulipOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listZulipAccountIds(cfg).some((accountId) => {
      const account = resolveZulipAccount({ cfg, accountId });
      return Boolean(account.apiKey && account.email && account.baseUrl);
    });
    return {
      channel,
      configured,
      statusLines: [`Zulip: ${configured ? "configured" : "needs api key + email + url"}`],
      selectionHint: configured ? "configured" : "needs setup",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds, env }) => {
    const override = accountOverrides.zulip?.trim();
    const defaultAccountId = resolveDefaultZulipAccountId(cfg);
    let accountId = override ? normalizeAccountId(override) : defaultAccountId;
    if (shouldPromptAccountIds && !override) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "Zulip",
        currentId: accountId,
        listAccountIds: listZulipAccountIds,
        defaultAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveZulipAccount({
      cfg: next,
      accountId,
    });
    const accountConfigured = Boolean(
      resolvedAccount.apiKey && resolvedAccount.email && resolvedAccount.baseUrl,
    );
    const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv = allowEnv && hasZulipEnvSecrets();
    const hasConfigValues =
      Boolean(resolvedAccount.config.apiKey) ||
      Boolean(resolvedAccount.config.email) ||
      Boolean(resolvedAccount.config.url);

    let apiKey: string | null = null;
    let email: string | null = null;
    let baseUrl: string | null = null;
    let useEnv = false;

    if (!accountConfigured) {
      await noteZulipSetup(prompter);
    }

    let verified = false;
    let skipVerification = false;
    let declinedEnv = false;

    while (!verified && !skipVerification) {
      if (allowEnv && !apiKey && !useEnv && !declinedEnv) {
        if (canUseEnv && !hasConfigValues) {
          const keepEnv = await prompter.confirm({
            message: "ZULIP_API_KEY + ZULIP_EMAIL + ZULIP_URL detected. Use env vars?",
            initialValue: true,
          });
          if (typeof keepEnv === "symbol") {
            return { cfg, accountId };
          }
          if (keepEnv) {
            apiKey = getZulipEnvSecret("ZULIP_API_KEY") ?? null;
            email = getZulipEnvSecret("ZULIP_EMAIL") ?? null;
            baseUrl = getZulipEnvSecret("ZULIP_URL") ?? null;
            useEnv = true;
          } else {
            declinedEnv = true;
          }
        }

        if (!useEnv && !declinedEnv) {
          const chooseEnv = await prompter.confirm({
            message: "Would you like to use environment variables for credentials (recommended)?",
            initialValue: true,
          });
          if (typeof chooseEnv === "symbol") {
            return { cfg, accountId };
          }
          if (chooseEnv) {
            await prompter.note(
              "Please set ZULIP_API_KEY, ZULIP_EMAIL, and ZULIP_URL in your environment and restart OpenClaw.",
              "Environment Variables",
            );
            return { cfg, accountId };
          } else {
            declinedEnv = true;
          }
        }

        if (declinedEnv) {
          const confirmed = await warnPlaintextSecrets(prompter);
          if (typeof confirmed === "symbol" || !confirmed) {
            return { cfg, accountId };
          }
        }
      } else if (!allowEnv && !apiKey) {
        const confirmed = await warnPlaintextSecrets(prompter);
        if (typeof confirmed === "symbol" || !confirmed) {
          return { cfg, accountId };
        }
      }

      if (accountConfigured && !apiKey) {
        const keep = await prompter.confirm({
          message: "Zulip credentials already configured. Keep them?",
          initialValue: true,
        });
        if (typeof keep === "symbol") {
          return { cfg, accountId };
        }
        if (keep) {
          apiKey = resolvedAccount.apiKey ?? null;
          email = resolvedAccount.email ?? null;
          baseUrl = resolvedAccount.baseUrl ?? null;
          verified = true;
          break;
        } else {
          const resApiKey = await prompter.text({
            message: "Enter Zulip API key",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          });
          if (typeof resApiKey === "symbol") {
            return { cfg, accountId };
          }
          apiKey = String(resApiKey).trim();

          const resEmail = await prompter.text({
            message: "Enter Zulip bot email",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          });
          if (typeof resEmail === "symbol") {
            return { cfg, accountId };
          }
          email = String(resEmail).trim();

          const resBaseUrl = await prompter.text({
            message: "Enter Zulip base URL",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          });
          if (typeof resBaseUrl === "symbol") {
            return { cfg, accountId };
          }
          baseUrl = String(resBaseUrl).trim();
        }
      } else if (!apiKey) {
        const resApiKey = await prompter.text({
          message: "Enter Zulip API key",
          initialValue: apiKey ?? undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        });
        if (typeof resApiKey === "symbol") {
          return { cfg, accountId };
        }
        apiKey = String(resApiKey).trim();

        const resEmail = await prompter.text({
          message: "Enter Zulip bot email",
          initialValue: email ?? undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        });
        if (typeof resEmail === "symbol") {
          return { cfg, accountId };
        }
        email = String(resEmail).trim();

        const resBaseUrl = await prompter.text({
          message: "Enter Zulip base URL",
          initialValue: baseUrl ?? undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        });
        if (typeof resBaseUrl === "symbol") {
          return { cfg, accountId };
        }
        baseUrl = String(resBaseUrl).trim();
      }

      if (apiKey && email && baseUrl) {
        const probe = await probeZulip(baseUrl, email, apiKey);
        if (probe.ok) {
          verified = true;
          await prompter.note(`Successfully verified Zulip credentials for ${maskPII(probe.bot?.email)}.`);
        } else {
          await prompter.note(`Verification failed: ${probe.error}`, "Zulip Verification");
          const retry = await prompter.confirm({
            message: "Re-enter credentials?",
            initialValue: true,
          });
          if (typeof retry === "symbol") {
            return { cfg, accountId };
          }
          if (!retry) {
            skipVerification = true;
          } else {
            // Re-prompt specifically for strings. Env vars are skipped if useEnv is reset.
            useEnv = false;
            apiKey = useEnv ? null : apiKey;
            email = useEnv ? null : email;
            baseUrl = useEnv ? null : baseUrl;

            const editApiKey = await prompter.text({
              message: "Edit Zulip API key",
              initialValue: apiKey ?? undefined,
              validate: (value) => (value?.trim() ? undefined : "Required"),
            });
            if (typeof editApiKey === "symbol") return { cfg, accountId };
            apiKey = String(editApiKey).trim();

            const editEmail = await prompter.text({
              message: "Edit Zulip bot email",
              initialValue: email ?? undefined,
              validate: (value) => (value?.trim() ? undefined : "Required"),
            });
            if (typeof editEmail === "symbol") return { cfg, accountId };
            email = String(editEmail).trim();

            const editBaseUrl = await prompter.text({
              message: "Edit Zulip base URL",
              initialValue: baseUrl ?? undefined,
              validate: (value) => (value?.trim() ? undefined : "Required"),
            });
            if (typeof editBaseUrl === "symbol") return { cfg, accountId };
            baseUrl = String(editBaseUrl).trim();
          }
        }
      } else {
        verified = true;
      }
    }

    let streams: string[] | undefined;
    if (verified && apiKey && email && baseUrl) {
      try {
        const client = createZulipClient({ baseUrl, email, apiKey });
        const subscriptions = await fetchZulipSubscriptions(client);
        const streamNames = subscriptions
          .map((s) => s.name)
          .filter((name): name is string => Boolean(name));

        if (streamNames.length > 0) {
          const streamInput = await prompter.text({
            message: "Which streams should the bot monitor? (comma-separated)",
            placeholder: "e.g. bot-testing, announcements",
            hint: `Subscribed streams: ${streamNames.join(", ")}`,
            initialValue: streamNames.join(", "),
          });
          if (typeof streamInput === "symbol") {
            return { cfg, accountId };
          }
          if (streamInput?.trim()) {
            streams = streamInput
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }
        } else {
          await prompter.note(
            "The bot is not yet subscribed to any streams. You can add them later in the config.",
            "Zulip Streams",
          );
        }
      } catch (err) {
        // Log error but don't fail onboarding
        env.logger.error("Failed to fetch Zulip subscriptions during onboarding:", err);
      }
    }

    if (apiKey || email || baseUrl || streams) {
      const zulipSection = (next.channels?.zulip ?? {}) as ZulipConfig;
      const zulipAccounts = (zulipSection.accounts ?? {}) as Record<string, ZulipAccountConfig>;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            zulip: {
              ...zulipSection,
              enabled: true,
              ...(useEnv ? {} : { ...(apiKey ? { apiKey } : {}) }),
              ...(useEnv ? {} : { ...(email ? { email } : {}) }),
              ...(useEnv ? {} : { ...(baseUrl ? { url: baseUrl } : {}) }),
              ...(streams ? { streams } : {}),
            },
          },
        };
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            zulip: {
              ...zulipSection,
              enabled: true,
              accounts: {
                ...zulipAccounts,
                [accountId]: {
                  ...zulipAccounts[accountId],
                  enabled: zulipAccounts[accountId]?.enabled ?? true,
                  ...(apiKey ? { apiKey } : {}),
                  ...(email ? { email } : {}),
                  ...(baseUrl ? { url: baseUrl } : {}),
                  ...(streams ? { streams } : {}),
                },
              },
            },
          },
        };
      }
    }

    return { cfg: next, accountId };
  },
  disable: (cfg: OpenClawConfig) => {
    const zulipSection = (cfg.channels?.zulip ?? {}) as ZulipConfig;
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        zulip: { ...zulipSection, enabled: false },
      },
    };
  },
};
