#!/usr/bin/env -S node --import tsx
/**
 * Создание нового инстанса OpenClaw (бота) на Railway через GraphQL API.
 *
 * Обязательные переменные при создании: OPENCLAW_GATEWAY_TOKEN, TELEGRAM_BOT_TOKEN.
 * См. README.md в этой папке.
 *
 * Использование:
 *   RAILWAY_TOKEN=xxx TELEGRAM_BOT_TOKEN=xxx pnpm exec tsx railway_deploy/railway-create-bot.ts --project-id <PROJECT_ID>
 *   или
 *   pnpm exec tsx railway_deploy/railway-create-bot.ts --token xxx --project-id xxx --telegram-token xxx [--gateway-token xxx]
 *
 * Опции:
 *   --token, -t          Railway API token (или RAILWAY_TOKEN)
 *   --project-id, -p     ID проекта Railway (обязательно)
 *   --environment-id, -e ID окружения (по умолчанию — первое в проекте)
 *   --telegram-token     Токен бота Telegram (или TELEGRAM_BOT_TOKEN); опционально
 *   --gateway-token      OPENCLAW_GATEWAY_TOKEN (если не задан — генерируется)
 *   --service-name       Имя сервиса (по умолчанию openclaw-<4 hex>)
 *   --source             github | docker (по умолчанию github)
 *   --repo               Для source=github: owner/repo (или RAILWAY_GITHUB_REPO; по умолчанию oponfil/openclaw)
 *   --branch             Ветка (по умолчанию main)
 *   --image              Для source=docker: образ, например openclaw/openclaw:latest
 *   --setup-password     SETUP_PASSWORD для /setup
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

async function main() {
  const args = parseArgs();
  const token =
    getOpt(args, "RAILWAY_TOKEN", "token", true) ?? (args.token as string | undefined);
  const projectId = getOpt(args, "RAILWAY_PROJECT_ID", "projectid", true);
  const environmentId = getOpt(args, "RAILWAY_ENVIRONMENT_ID", "environmentid", false);
  const telegramToken = getOpt(args, "TELEGRAM_BOT_TOKEN", "telegramtoken", false);
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
  const noWait = Boolean(args.nowait);

  if (!token || !projectId) {
    console.error("Usage: --token (or RAILWAY_TOKEN) and --project-id (or RAILWAY_PROJECT_ID) are required.");
    process.exit(1);
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

  // 1. Create service (для GitHub — сначала пустой, затем serviceConnect; иначе serviceCreate с source)
  let serviceId: string;
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
    console.log("Created service:", createRes.serviceCreate?.name, serviceId);
  } else {
    // Пустой сервис без source (избегаем 400 от serviceCreate с GitHub source)
    const createRes = await graphql<{ serviceCreate: { id: string; name: string } }>(
      token,
      `mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
      { input: { projectId, name: serviceName } },
    );
    serviceId = createRes.serviceCreate?.id!;
    console.log("Created empty service:", createRes.serviceCreate?.name, serviceId);
    // Подключить GitHub репо (input в теле мутации — так Railway рекомендует при 400)
    const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const connectMutation = `mutation { serviceConnect(id: "${esc(serviceId)}", input: { repo: "${esc(repo)}", branch: "${esc(branch)}" }) { id name } }`;
    try {
      await graphql<{ serviceConnect: { id: string; name: string } }>(token, connectMutation, {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("serviceConnect failed:", msg);
      if (msg.includes("Problem processing request") || msg.includes("400")) {
        console.error("");
        console.error("Попробуйте подключить репо вручную в дашборде: Settings → Connect Repo →", repo);
      }
      process.exit(1);
    }
    console.log("Connected repo:", repo, branch);
  }

  // 2. Set variables: берём Shared Variables окружения и добавляем/переопределяем свои
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

  // 3. Trigger deploy (serviceInstanceRedeploy для сервиса в окружении)
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

  // 4. Generate Railway domain (*.up.railway.app). ServiceDomainCreateInput: serviceId + environmentId (без serviceInstanceId)
  let url: string | null = null;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const domainInput = { serviceId, environmentId: envId };
  for (const attempt of [
    () =>
      graphql<{ serviceDomainCreate: { domain: string } }>(
        token,
        `mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }`,
        { input: domainInput },
      ),
    () => {
      const q = `mutation { serviceDomainCreate(input: { serviceId: "${esc(serviceId)}", environmentId: "${esc(envId)}" }) { domain } }`;
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
    console.warn("Domain not created via API. Add in dashboard: service → Settings → Domains → Generate Domain.");
  }

  if (!noWait && url) {
    console.log("Waiting for deployment (polling every 15s, max 10 min)...");
    const deadline = Date.now() + 600_000;
    let lastStatus = "";
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 15_000));
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
        const status = list.deployments?.edges?.[0]?.node?.status ?? "";
        if (status !== lastStatus) {
          console.log("Deployment status:", status);
          lastStatus = status;
        }
        if (status === "SUCCESS") {
          console.log("\nReady.");
          break;
        }
        if (status === "FAILED" || status === "CRASHED") {
          console.error("Deployment failed.");
          process.exit(1);
        }
      }
    } catch (e) {
      console.warn("Polling skipped (check status in dashboard):", (e as Error).message.slice(0, 80));
    }
  }

  console.log("\n---");
  console.log("OPENCLAW_GATEWAY_TOKEN (сохраните для входа в Control UI / API):", gatewayToken);
  if (url) {
    console.log("Control UI:", `${url}/openclaw`);
    console.log("Setup wizard:", `${url}/setup`);
    console.log("Домен начнёт отвечать после завершения первого деплоя (~10 мин). Статус — в дашборде Railway.");
  } else {
    console.log("Домен не создан через API. Добавьте в дашборде: сервис → Settings → Domains → Generate Domain.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
