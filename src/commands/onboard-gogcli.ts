import fs from "node:fs";
import path from "node:path";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { resolveUserPath } from "../utils.js";
import { detectBinary } from "./onboard-helpers.js";

function gogCredentialsPaths(): string[] {
  const paths: string[] = [];
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) {
    paths.push(path.join(xdg, "gogcli", "credentials.json"));
  }
  paths.push(resolveUserPath("~/.config/gogcli/credentials.json"));
  if (process.platform === "darwin") {
    paths.push(resolveUserPath("~/Library/Application Support/gogcli/credentials.json"));
  }
  return paths;
}

function hasGogCredentials(): boolean {
  return gogCredentialsPaths().some((p) => fs.existsSync(p));
}

async function listGogAccounts(): Promise<string[]> {
  try {
    const result = await runCommandWithTimeout(["gog", "auth", "list"], { timeoutMs: 10_000 });
    if (result.code !== 0 || !result.stdout.trim()) {
      return [];
    }
    // Each line that contains an "@" is treated as a configured account.
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("@"));
  } catch {
    return [];
  }
}

export async function setupGogcliOAuth(
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<void> {
  const hasGog = await detectBinary("gog");
  if (!hasGog) {
    return;
  }

  const credentialsExist = hasGogCredentials();
  const accounts = await listGogAccounts();

  if (credentialsExist && accounts.length > 0) {
    await prompter.note(
      [
        `gogcli is configured with ${accounts.length} account${accounts.length > 1 ? "s" : ""}:`,
        ...accounts.map((a) => `  ${a}`),
        "",
        "Tip: set GOG_ACCOUNT=you@gmail.com to avoid repeating --account.",
      ].join("\n"),
      "gogcli",
    );
    return;
  }

  const wantSetup = await prompter.confirm({
    message: "Set up gogcli OAuth for Gmail, Calendar, Drive, Contacts, Sheets, and Docs?",
    initialValue: true,
  });
  if (!wantSetup) {
    return;
  }

  if (!credentialsExist) {
    await prompter.note(
      [
        "gogcli needs a Google OAuth 2.0 client credentials file.",
        "",
        "Steps to create one:",
        "1. Open https://console.cloud.google.com/",
        "2. Create or select a project",
        "3. Enable the APIs you need (Gmail, Calendar, Drive, etc.)",
        "4. Go to APIs & Services → Credentials",
        "5. Click Create Credentials → OAuth 2.0 Client ID",
        "6. Choose Desktop app, then download the JSON file",
      ].join("\n"),
      "Google OAuth credentials",
    );

    const credPathRaw = String(
      await prompter.text({
        message: "Path to downloaded client_secret.json",
        placeholder: "~/Downloads/client_secret_*.json",
        validate: (v) => {
          const resolved = resolveUserPath(v.trim());
          if (!fs.existsSync(resolved)) {
            return `File not found: ${resolved}`;
          }
          return undefined;
        },
      }),
    );

    const credPath = resolveUserPath(credPathRaw.trim());
    const spin = prompter.progress("Registering gogcli credentials…");
    const result = await runCommandWithTimeout(["gog", "auth", "credentials", credPath], {
      timeoutMs: 30_000,
    });
    if (result.code !== 0) {
      spin.stop("Failed to register credentials");
      runtime.error(result.stderr || result.stdout || "gog auth credentials failed");
      return;
    }
    spin.stop("Credentials registered");
  }

  if (accounts.length === 0) {
    const accountRaw = String(
      await prompter.text({
        message: "Gmail account to authorize",
        placeholder: "you@gmail.com",
        validate: (v) => (v.trim().includes("@") ? undefined : "Enter a valid email address"),
      }),
    );
    const account = accountRaw.trim();

    await prompter.note(
      [
        "A browser will open for Google sign-in.",
        "Grant the requested permissions, then return here.",
      ].join("\n"),
      "Browser OAuth",
    );

    const spin = prompter.progress(`Authorizing ${account}…`);
    const result = await runCommandWithTimeout(
      ["gog", "auth", "add", account, "--services", "gmail,calendar,drive,contacts,docs,sheets"],
      { timeoutMs: 10 * 60_000 },
    );
    if (result.code !== 0) {
      spin.stop("Authorization failed");
      runtime.error(result.stderr || result.stdout || "gog auth add failed");
      return;
    }
    spin.stop(`Authorized ${account}`);
  }

  const finalAccounts = await listGogAccounts();
  await prompter.note(
    [
      "gogcli is ready.",
      "",
      finalAccounts.length > 0
        ? `Accounts: ${finalAccounts.join(", ")}`
        : "Run `gog auth list` to verify your account.",
      "",
      "Use the gog skill in agents to access Gmail, Calendar, Drive, and more.",
    ].join("\n"),
    "gogcli ready",
  );
}
