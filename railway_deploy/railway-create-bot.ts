#!/usr/bin/env -S node --import tsx
/**
 * Создание нового инстанса OpenClaw (бота) на Railway через GraphQL API.
 *
 * Обязательные переменные при создании: OPENCLAW_GATEWAY_TOKEN.
 * TELEGRAM_BOT_TOKEN и TELEGRAM_ALLOW_FROM опциональны.
 * См. README.md в этой папке.
 *
 * Использование:
 *   RAILWAY_TOKEN=xxx TELEGRAM_ALLOW_FROM=123456789 TELEGRAM_BOT_TOKEN=xxx pnpm exec tsx railway_deploy/railway-create-bot.ts --project-id <PROJECT_ID>
 *   или
 *   pnpm exec tsx railway_deploy/railway-create-bot.ts --token xxx --project-id xxx --telegram-token xxx [--gateway-token xxx]
 *
 * Опции:
 *   --token, -t          Railway API token (или RAILWAY_TOKEN)
 *   --project-id, -p     ID проекта Railway (обязательно)
 *   --environment-id, -e ID окружения (по умолчанию — первое в проекте)
 *   --no-volume          Не создавать Railway Volume (по умолчанию volume создаётся)
 *   --volume-mount-path  Путь монтирования volume (или RAILWAY_VOLUME_MOUNT_PATH; по умолчанию /data)
 *   --volume-name        Имя volume (или RAILWAY_VOLUME_NAME; по умолчанию <service-name>-state)
 *   --telegram-token     Токен бота Telegram (или TELEGRAM_BOT_TOKEN); опционально
 *   --telegram-allow-from Telegram user id для channels.telegram.allowFrom (или TELEGRAM_ALLOW_FROM)
 *   --gateway-token      OPENCLAW_GATEWAY_TOKEN (если не задан — генерируется)
 *   --service-name       Имя сервиса (по умолчанию openclaw-<4 hex>)
 *   --source             github | docker (по умолчанию github)
 *   --repo               Для source=github: owner/repo (или RAILWAY_GITHUB_REPO; по умолчанию oponfil/openclaw)
 *   --branch             Ветка (по умолчанию main)
 *   --image              Для source=docker: образ, например openclaw/openclaw:latest
 *   --setup-password     SETUP_PASSWORD (опционально)
 *   --no-wait            Не ждать завершения деплоя
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Загрузить .env из папки railway_deploy (рядом со скриптом)
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(scriptDir, ".env") });

const RAILWAY_GRAPHQL = "https://backboard.railway.com/graphql/v2";

type RailwayResponse<T> = { data?: T; errors?: { message: string }[] };

async function graphql<T>(
  token: string,
  operation: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const body = { query: operation, variables };
  const res = await fetch(RAILWAY_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Railway API HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as RailwayResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Railway GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  if (json.data === undefined) {
    throw new Error("Railway API: no data in response");
  }
  return json.data as T;
}

const SHORT_OPTS: Record<string, string> = {
  t: "token",
  p: "projectid",
  e: "environmentid",
};

function parseArgs(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-wait") {
      out[a.slice(2).replace(/-/g, "")] = true;
    } else if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "");
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else if (a.length === 2 && a.startsWith("-") && a[1] !== "-") {
      const shortKey = SHORT_OPTS[a[1]];
      if (shortKey) {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("-")) {
          out[shortKey] = next;
          i++;
        }
      }
    }
  }
  return out;
}

function getOpt(
  args: Record<string, string | boolean>,
  envKey: string,
  argKey: string,
  required: boolean,
): string | undefined {
  const v = process.env[envKey] ?? args[argKey];
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (required && !s) {
    console.error(`Missing required: --${argKey.replace(/([A-Z])/g, "-$1").toLowerCase()} or ${envKey}`);
    process.exit(1);
  }
  return s || undefined;
}

function generateGatewayToken(): string {
  return randomBytes(32).toString("hex");
}

/** Из env или "https://github.com/owner/repo" получает "owner/repo". */
function parseRepo(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  const s = value.trim();
  const m = /github\.com[/:](\S+?\/\S+?)(?:\.git)?\/?$/i.exec(s);
  if (m) return m[1].replace(/\.git$/, "");
  if (/^[\w.-]+\/[\w.-]+$/.test(s)) return s;
  return null;
}

function escapeGraphqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function deleteServiceBestEffort(token: string, serviceId: string): Promise<boolean> {
  const escapedServiceId = escapeGraphqlString(serviceId);
  const attempts: Array<() => Promise<unknown>> = [
    () =>
      graphql<{ serviceDelete: boolean }>(
        token,
        `mutation($id: String!) { serviceDelete(id: $id) }`,
        { id: serviceId },
      ),
    () =>
      graphql<{ serviceDelete: { id: string } }>(
        token,
        `mutation($id: String!) { serviceDelete(id: $id) { id } }`,
        { id: serviceId },
      ),
    () =>
      graphql<{ serviceDelete: boolean }>(
        token,
        `mutation { serviceDelete(id: "${escapedServiceId}") }`,
        {},
      ),
  ];

  let lastErr: string | null = null;
  for (let round = 1; round <= 5; round++) {
    for (const attempt of attempts) {
      try {
        await attempt();
        return true;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (round < 5) {
      await sleep(2000 * round);
    }
  }
  if (lastErr) {
    console.error("Service delete last error:", lastErr.slice(0, 200));
  }
  return false;
}

async function deleteVolumeBestEffort(token: string, volumeId: string): Promise<boolean> {
  const escapedVolumeId = escapeGraphqlString(volumeId);
  const attempts: Array<() => Promise<unknown>> = [
    () =>
      graphql<{ volumeDelete: boolean }>(
        token,
        `mutation($id: String!) { volumeDelete(id: $id) }`,
        { id: volumeId },
      ),
    () =>
      graphql<{ volumeDelete: { id: string } }>(
        token,
        `mutation($id: String!) { volumeDelete(id: $id) { id } }`,
        { id: volumeId },
      ),
    () =>
      graphql<{ volumeDelete: boolean }>(
        token,
        `mutation { volumeDelete(id: "${escapedVolumeId}") }`,
        {},
      ),
  ];

  // Railway may need delay after service deletion before volume can be removed; API is often flaky (400).
  let lastErr: string | null = null;
  for (let round = 1; round <= 5; round++) {
    for (const attempt of attempts) {
      try {
        await attempt();
        return true;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (round < 5) {
      await sleep(3000 * round);
    }
  }
  if (lastErr) {
    console.error("Volume delete last error:", lastErr.slice(0, 200));
  }
  return false;
}

function extractRailwayTraceId(message: string): string | null {
  const m = /"traceId":"([^"]+)"/.exec(message);
  return m?.[1] ?? null;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeServiceReadiness(baseUrl: string): Promise<string | null> {
  const probes = ["/healthz", "/", "/openclaw", "/openclaw/"];
  for (const probe of probes) {
    try {
      const res = await fetch(`${baseUrl}${probe}`, { redirect: "manual" });
      // 2xx/3xx means app is serving traffic.
      if (res.status >= 200 && res.status < 400) {
        return `${probe} -> ${res.status}`;
      }
      // 401/403 still confirms the app stack is up and handling requests.
      if (res.status === 401 || res.status === 403) {
        return `${probe} -> ${res.status}`;
      }
    } catch {
      // ignore transient dns/network failures and try next probe
    }
  }
  return null;
}

async function createVolumeWithRetry(params: {
  token: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  mountPath: string;
  name: string;
}): Promise<string> {
  const { token, projectId, environmentId, serviceId, mountPath, name } = params;
  const maxAttempts = 5;
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // First try with name; on final fallback also try without name (some envs reject it).
    for (const withName of [true, false]) {
      try {
        const input: Record<string, string> = {
          projectId,
          environmentId,
          serviceId,
          mountPath,
        };
        if (withName) {
          input.name = name;
        }
        const volumeRes = await graphql<{ volumeCreate: { id: string } }>(
          token,
          `mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }`,
          { input },
        );
        return volumeRes.volumeCreate?.id ?? "";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const traceId = extractRailwayTraceId(msg);
        lastErr = new Error(msg);
        console.warn(
          `volumeCreate attempt ${attempt}/${maxAttempts} (${withName ? "with name" : "without name"}) failed${traceId ? ` (traceId=${traceId})` : ""}: ${msg.slice(0, 180)}`,
        );
      }
    }
    if (attempt < maxAttempts) {
      // Handle API eventual consistency after serviceCreate/serviceConnect.
      await sleep(2000 * attempt);
    }
  }
  throw lastErr ?? new Error("volumeCreate failed");
}

async function main() {
  const args = parseArgs();
  const token =
    getOpt(args, "RAILWAY_TOKEN", "token", true) ?? (args.token as string | undefined);
  const projectId = getOpt(args, "RAILWAY_PROJECT_ID", "projectid", true);
  const environmentId = getOpt(args, "RAILWAY_ENVIRONMENT_ID", "environmentid", false);
  const telegramToken = getOpt(args, "TELEGRAM_BOT_TOKEN", "telegramtoken", false);
  const telegramAllowFrom = getOpt(args, "TELEGRAM_ALLOW_FROM", "telegramallowfrom", false);
  let gatewayToken = getOpt(args, "OPENCLAW_GATEWAY_TOKEN", "gatewaytoken", false);
  if (!gatewayToken) {
    gatewayToken = generateGatewayToken();
    console.log("Generated OPENCLAW_GATEWAY_TOKEN (save it):", gatewayToken);
  }
  const serviceName =
    (typeof args.servicename === "string" ? args.servicename : null) ??
    `openclaw-${randomBytes(2).toString("hex")}`;
  const source = (typeof args.source === "string" ? args.source : "github") as "github" | "docker";
  const repoRaw =
    getOpt(args, "RAILWAY_GITHUB_REPO", "repo", false) ?? (typeof args.repo === "string" ? args.repo : null);
  const repo = parseRepo(repoRaw) ?? "oponfil/openclaw";
  const branch = (typeof args.branch === "string" ? args.branch : null) ?? "main";
  const image = typeof args.image === "string" ? args.image : null;
  const setupPassword = typeof args.setuppassword === "string" ? args.setuppassword : null;
  const noVolume = Boolean(args.novolume);
  const volumeMountPath = getOpt(args, "RAILWAY_VOLUME_MOUNT_PATH", "volumemountpath", false) ?? "/data";
  const volumeName =
    getOpt(args, "RAILWAY_VOLUME_NAME", "volumename", false) ??
    `${serviceName}-state`;
  const noWait = Boolean(args.nowait);

  if (!token || !projectId) {
    console.error("Usage: --token (or RAILWAY_TOKEN) and --project-id (or RAILWAY_PROJECT_ID) are required.");
    process.exit(1);
  }
  if (!noVolume) {
    console.log("Persistent volume enabled:", volumeName, "mountPath:", volumeMountPath);
  }
  let envId = environmentId as string | undefined;
  if (!envId) {
    const envs = await graphql<{ project: { environments: { edges: { node: { id: string } }[] } } }>(
      token,
      `query($projectId: String!) { project(id: $projectId) { environments { edges { node { id } } } } }`,
      { projectId },
    );
    const first = envs.project?.environments?.edges?.[0]?.node?.id;
    if (!first) {
      console.error("No environments in project. Create one in Railway dashboard.");
      process.exit(1);
    }
    envId = first;
    console.log("Using environment:", envId);
  }

  let serviceId: string | undefined;
  let volumeId: string | undefined;
  let shouldDeleteServiceOnFailure = false;
  try {
    // 1. Create service (для GitHub — сначала пустой, затем serviceConnect; иначе serviceCreate с source)
    if (source === "docker" && image) {
      const createInput: Record<string, unknown> = {
        projectId,
        name: serviceName,
        source: { image },
      };
      const createRes = await graphql<{ serviceCreate: { id: string; name: string } }>(
        token,
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
        { input: createInput },
      );
      serviceId = createRes.serviceCreate?.id!;
      shouldDeleteServiceOnFailure = true;
      console.log("Created service:", createRes.serviceCreate?.name, serviceId);
    } else {
      // Пустой сервис без source (избегаем 400 от serviceCreate с GitHub source)
      const createRes = await graphql<{ serviceCreate: { id: string; name: string } }>(
        token,
        `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
        { input: { projectId, name: serviceName } },
      );
      serviceId = createRes.serviceCreate?.id!;
      shouldDeleteServiceOnFailure = true;
      console.log("Created empty service:", createRes.serviceCreate?.name, serviceId);
      // Подключить GitHub репо (input в теле мутации — так Railway рекомендует при 400)
      const connectMutation = `mutation { serviceConnect(id: "${escapeGraphqlString(serviceId)}", input: { repo: "${escapeGraphqlString(repo)}", branch: "${escapeGraphqlString(branch)}" }) { id name } }`;
      try {
        await graphql<{ serviceConnect: { id: string; name: string } }>(token, connectMutation, {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        let details = `serviceConnect failed: ${msg}`;
        if (msg.includes("Problem processing request") || msg.includes("400")) {
          details += `\nПопробуйте подключить репо вручную в дашборде: Settings → Connect Repo → ${repo}`;
        }
        throw new Error(details);
      }
      console.log("Connected repo:", repo, branch);
    }

    // 2. Create persistent volume (default)
    if (!noVolume) {
      volumeId = await createVolumeWithRetry({
        token,
        projectId,
        environmentId: envId,
        serviceId,
        mountPath: volumeMountPath,
        name: volumeName,
      });
      console.log("Created volume:", volumeId, "mountPath:", volumeMountPath);
    } else {
      console.warn("Volume creation disabled via --no-volume (state may be ephemeral).");
    }

    // 3. Set variables: берём Shared Variables окружения и добавляем/переопределяем свои
    let variables: Record<string, string> = {};
    try {
      const shared = await graphql<{ variables: Record<string, string> }>(
        token,
        `query($projectId: String!, $environmentId: String!) {
          variables(projectId: $projectId, environmentId: $environmentId)
        }`,
        { projectId, environmentId: envId },
      );
      if (shared.variables && typeof shared.variables === "object") {
        variables = { ...shared.variables };
        console.log("Loaded Shared Variables:", Object.keys(variables).join(", ") || "(none)");
      }
    } catch (e) {
      console.log("Shared Variables not loaded (using only script vars):", (e as Error).message);
    }
    variables.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    variables.OPENCLAW_STATE_DIR = volumeMountPath;
    if (telegramAllowFrom) variables.TELEGRAM_ALLOW_FROM = telegramAllowFrom;
    if (telegramToken) variables.TELEGRAM_BOT_TOKEN = telegramToken;
    if (setupPassword) variables.SETUP_PASSWORD = setupPassword;

    await graphql(
      token,
      `mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }`,
      {
        input: {
          projectId,
          environmentId: envId,
          serviceId,
          variables,
        },
      },
    );
    console.log("Set variables:", Object.keys(variables).join(", "));

    // 4. Trigger deploy (serviceInstanceRedeploy для сервиса в окружении)
    try {
      await graphql(
        token,
        `mutation($environmentId: String!, $serviceId: String!) { serviceInstanceRedeploy(environmentId: $environmentId, serviceId: $serviceId) }`,
        { environmentId: envId, serviceId },
      );
      console.log("Deploy triggered");
    } catch (e) {
      console.log("Redeploy skipped (first build may start from source):", (e as Error).message);
    }

    // 5. Generate Railway domain (*.up.railway.app). ServiceDomainCreateInput: serviceId + environmentId (без serviceInstanceId)
    let url: string | null = null;
    const domainInput = { serviceId, environmentId: envId };
    for (const attempt of [
      () =>
        graphql<{ serviceDomainCreate: { domain: string } }>(
          token,
          `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
          { input: domainInput },
        ),
      () => {
        const q = `mutation { serviceDomainCreate(input: { serviceId: "${escapeGraphqlString(serviceId)}", environmentId: "${escapeGraphqlString(envId)}" }) { domain } }`;
        return graphql<{ serviceDomainCreate: { domain: string } }>(token, q, {});
      },
    ]) {
      try {
        const domainRes = await attempt();
        if (domainRes?.serviceDomainCreate?.domain) {
          url = `https://${domainRes.serviceDomainCreate.domain}`;
          console.log("Domain:", url);
          break;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (url === null) console.warn("Domain create attempt:", msg.slice(0, 120));
      }
    }
    if (!url) {
      throw new Error("Domain not created via API.");
    }

    if (!noWait) {
      const waitTimeoutMs = 900_000; // 15 min for first cold build in Railway
      console.log("Waiting for deployment (polling every 15s, max 15 min)...");
      const deadline = Date.now() + waitTimeoutMs;
      let lastStatus = "";
      let ready = false;
      let consecutivePollingApiFailures = 0;
      let healthOnlyMode = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15_000));
        if (!healthOnlyMode) {
          try {
            const list = await graphql<{
              deployments: { edges: { node: { id: string; status: string } }[] };
            }>(
              token,
              `query($input: DeploymentListInput!) {
                deployments(input: $input) {
                  edges { node { id status } }
                }
              }`,
              {
                input: { projectId, environmentId: envId, serviceId, first: 1 },
              },
            );
            consecutivePollingApiFailures = 0;
            const status = list.deployments?.edges?.[0]?.node?.status ?? "";
            if (status !== lastStatus) {
              console.log("Deployment status:", status);
              lastStatus = status;
            }
            if (status === "SUCCESS") {
              console.log("\nReady.");
              ready = true;
              break;
            }
            if (status === "FAILED" || status === "CRASHED") {
              throw new Error(`Deployment failed with status: ${status}`);
            }
          } catch (pollErr) {
            const msg = pollErr instanceof Error ? pollErr.message : String(pollErr);
            if (msg.startsWith("Deployment failed with status:")) {
              // Propagate terminal deployment failures to outer cleanup logic.
              throw pollErr instanceof Error ? pollErr : new Error(msg);
            }
            consecutivePollingApiFailures += 1;
            const traceId = extractRailwayTraceId(msg);
            console.warn(
              `Deployment status poll failed${traceId ? ` (traceId=${traceId})` : ""}; will retry: ${msg.slice(0, 180)}`,
            );
            if (consecutivePollingApiFailures >= 5) {
              healthOnlyMode = true;
              console.warn(
                "Deployment API keeps failing; switching to health-only readiness checks.",
              );
            }
          }
        }

        // Always try HTTP readiness probes; in health-only mode this is the primary signal.
        const readinessProbe = await probeServiceReadiness(url);
        if (readinessProbe) {
          console.log(
            healthOnlyMode
              ? `Readiness probe passed in health-only mode (${readinessProbe}).`
              : `Readiness probe passed (${readinessProbe}).`,
          );
          ready = true;
          break;
        }
      }
      if (!ready) {
        throw new Error("Timed out waiting for deployment readiness (SUCCESS/HTTP probes).");
      }
    }

    shouldDeleteServiceOnFailure = false;
    console.log("\n---");
    console.log("OPENCLAW_GATEWAY_TOKEN (сохраните для входа в Control UI / API):", gatewayToken);
    // Control UI по умолчанию в корне домена; при gateway.controlUi.basePath="/openclaw" — тогда /openclaw
    console.log("Control UI:", url);
    console.log("Домен начнёт отвечать после завершения первого деплоя (~10 мин). Статус — в дашборде Railway.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Provisioning failed:", msg);

    if (shouldDeleteServiceOnFailure && serviceId) {
      console.error("Attempting cleanup: deleting created service", serviceId);
      const deleted = await deleteServiceBestEffort(token, serviceId);
      if (deleted) {
        console.error("Cleanup successful: service deleted.");
        // Give Railway time to detach volume before volumeDelete.
        if (volumeId) {
          console.error("Waiting 10s before volume cleanup...");
          await sleep(10_000);
        }
      } else {
        console.error("Cleanup failed: could not delete service automatically.");
      }
    }

    if (volumeId) {
      console.error("Attempting cleanup: deleting created volume", volumeId);
      const volumeDeleted = await deleteVolumeBestEffort(token, volumeId);
      if (volumeDeleted) {
        console.error("Cleanup successful: volume deleted.");
      } else {
        console.error("Cleanup warning: could not delete volume automatically.");
      }
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
