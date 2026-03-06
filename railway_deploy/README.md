# Деплой инстанса по заказу (Railway)

**Цель:** по запросу пользователя (например из Telegram) поднимать **отдельный инстанс** OpenClaw на Railway — свой процесс, свой контейнер, полная изоляция.

## Что умеет Railway

- **Public API (GraphQL):** `https://backboard.railway.com/graphql/v2`. Для создания сервисов нужен **Account** или **Workspace** токен ([railway.com/account/tokens](https://railway.com/account/tokens)); Project token недостаточен.
- **Создание сервиса:** мутация `serviceCreate` — пустой сервис или из Docker-образа; для GitHub скрипт создаёт пустой сервис и подключает репо через `serviceConnect`.
- **Деплой:** запуск деплоя для сервиса в окружении (environment), получение deployment id; статусы: `BUILDING`, `DEPLOYING`, `SUCCESS`, `FAILED`, `SLEEPING` и др.
- **Управление:** redeploy, restart, rollback, stop, логи (build/runtime/HTTP).

Документация: [Manage Deployments](https://docs.railway.com/integrations/api/manage-deployments), [Manage Services](https://docs.railway.com/integrations/api/manage-services), [API Cookbook](https://docs.railway.com/guides/api-cookbook).

## Тома (Volume) через API: размер и лимиты

- **Создание тома:** мутация `volumeCreate` (GraphQL). Обязательные поля: `projectId`, `environmentId`, `serviceId`, `mountPath`. Опционально: `name`, `region`. Документация: [Manage Volumes](https://docs.railway.com/integrations/api/manage-volumes), [Volumes reference](https://docs.railway.com/volumes/reference).
- **Размер при создании через API задать нельзя.** При создании тома размер берётся по умолчанию для плана подписки; в мутации нет параметра `size`/`sizeMB`. После создания объём можно увеличить (live resize), уменьшить — нельзя.
- **Дефолтный размер по плану (минимум по факту):**
  - Free / Trial: **0,5 GB**
  - Hobby: **5 GB**
  - Pro: **50 GB**
- **Максимум:** на плане Pro пользователь может сам увеличить том до **250 GB**. Выше 250 GB — только по запросу в [Central Station](https://station.railway.com/questions) (для Pro) или через Slack (Enterprise при committed spend от $2 000/мес).
- **Лимит числа томов на проект:** Free 1, Trial 3, Hobby 10, Pro 20.
- **Биллинг:** по фактически использованному месту (GB·мин), не по выделенному размеру. Неиспользованное место не тарифицируется.

Для автоматического сценария «инстанс по заказу»: после `serviceCreate` вызывать `volumeCreate` с нужным `mountPath` (например `/data` или `OPENCLAW_STATE_DIR`); размер будет дефолтным для плана, при необходимости увеличить позже через дашборд или API (если Railway добавит изменение размера в API).

## Сценарий «инстанс по заказу»

1. Пользователь (например в Telegram) запрашивает «создать мой инстанс» или первый раз пишет боту.
2. Бэкенд (отдельный сервис или тот же gateway) вызывает Railway API: создать сервис из шаблона/репо OpenClaw (или из того же Docker-образа), задать переменные окружения. **При создании обязательно передать:**
   - **OPENCLAW_GATEWAY_TOKEN** — токен аутентификации gateway (генерировать при создании инстанса, хранить в БД в привязке к сервису/пользователю).
   - **TELEGRAM_BOT_TOKEN** — токен бота Telegram для этого инстанса (берётся из настроек бота или из общего пула токенов).
   Дополнительно при необходимости: `OPENCLAW_STATE_DIR`, `SETUP_PASSWORD`, свой volume.
3. Скрипт запускает деплой и создаёт домен `*.up.railway.app` через API; домен начнёт отвечать после завершения деплоя (~10 мин). Сохраняем маппинг: `user_id` / `telegram_id` → `railway_service_id` и/или URL инстанса.
4. Дальше запросы этого пользователя направляются на **его** URL (прокси или редирект), либо бот отдаёт ссылку «Твой OpenClaw: https://xxx.up.railway.app».

**Плюсы:** полная изоляция (свой процесс, свой диск/volume), привычная модель «один инстанс на пользователя».

**Минусы:** каждый сервис — отдельное потребление ресурсов и биллинг; холодный старт при первом деплое (обычно ~10 мин); нужно хранить маппинг user → service/URL и решать, когда останавливать/удалять неиспользуемые сервисы (Railway может переводить в SLEEPING, но политики и лимиты нужно учитывать).

## Скрипт автоматического создания бота

В этой папке лежит скрипт `railway-create-bot.ts`, который через Railway GraphQL API создаёт сервис, задаёт переменные, создаёт домен и запускает деплой. Переменные окружения для нового сервиса берутся из **Shared Variables** проекта (PORT, OPENCLAW_STATE_DIR, OPENCLAW_WORKSPACE_DIR, OPENCLAW_GATEWAY_CONTROL_UI_DANGEROUSLY_DISABLE_DEVICE_AUTH и т.д.); скрипт добавляет только **OPENCLAW_GATEWAY_TOKEN** и при наличии **TELEGRAM_BOT_TOKEN**.

**Порядок действий скрипта:**

1. Читает `.env` и аргументы; проверяет `RAILWAY_TOKEN` и `RAILWAY_PROJECT_ID`. При отсутствии `OPENCLAW_GATEWAY_TOKEN` генерирует его и выводит в лог.
2. Определяет окружение (environment): если не передан `--environment-id`, запрашивает у Railway список окружений проекта и берёт первое.
3. Создаёт сервис в Railway: для GitHub — сначала пустой сервис (`serviceCreate` без source), затем подключение репо (`serviceConnect`); для Docker — один вызов `serviceCreate` с source. Имя по умолчанию `openclaw-` + 4 hex; репо по умолчанию `oponfil/openclaw`, ветка `main`.
4. Запрашивает **Shared Variables** окружения, объединяет их с переменными скрипта (OPENCLAW_GATEWAY_TOKEN, при наличии TELEGRAM_BOT_TOKEN и SETUP_PASSWORD) и записывает в созданный сервис (`variableCollectionUpsert`).
5. Запускает деплой, создаёт домен `*.up.railway.app` (`serviceDomainCreate`). Домен создаётся сразу, но **начнёт отвечать только после завершения первого деплоя** (обычно ~10 мин); статус смотрите в дашборде Railway. При 400 на создании домена — добавить вручную (Settings → Domains).
6. При отсутствии `--no-wait` пытается опрашивать статус деплоя (при ошибке API опрос пропускается).
7. Выводит в лог **OPENCLAW_GATEWAY_TOKEN** и ссылки на Control UI и /setup.

**Переменные окружения:** скопируйте `.env.example` в `.env` и заполните обязательные поля (`RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`). **TELEGRAM_BOT_TOKEN** опционален — если не задан, инстанс создаётся без Telegram; токен можно добавить позже в Railway (Variables). Если **OPENCLAW_GATEWAY_TOKEN** не задан, он генерируется автоматически и в конце работы выводится в лог — сохраните его для входа в Control UI и API.

**Запуск из корня репозитория:**

```bash
# Токен Railway: railway.com/account/tokens (Account или Workspace token)
# Project ID: в дашборде проекта Cmd/Ctrl+K → Copy Project ID
pnpm exec tsx railway_deploy/railway-create-bot.ts --project-id "<PROJECT_ID>"
# или
npx tsx railway_deploy/railway-create-bot.ts --project-id "<PROJECT_ID>"
```

Если в `railway_deploy/.env` заполнены `RAILWAY_TOKEN` и `RAILWAY_PROJECT_ID`, можно запустить без флагов: `pnpm exec tsx railway_deploy/railway-create-bot.ts` или `npx tsx railway_deploy/railway-create-bot.ts`.

**Имя сервиса:** по умолчанию `openclaw-` + 4 случайных hex-символа (например `openclaw-a3f2`). Своё имя — флаг `--service-name my-bot`.

**Опции:** `--environment-id` (иначе берётся первое окружение проекта), `--setup-password`, `--service-name`, `--repo owner/repo` (или **RAILWAY_GITHUB_REPO**), `--source docker --image ...`, `--no-wait`. Полный список — в заголовке `railway-create-bot.ts`.

### Ошибка «Problem processing request» (HTTP 400)

Скрипт обходит известную проблему API: при создании сервиса **из GitHub** он сначала создаёт пустой сервис, затем подключает репо через `serviceConnect` (так рекомендует Railway при 400). Если 400 появляется на этапе `serviceConnect`, проверьте: репо в списке в дашборде (Configure GitHub App / Refresh), токен — **Account** или **Workspace** ([railway.com/account/tokens](https://railway.com/account/tokens)). Репо можно подключить вручную в дашборде (Settings → Connect Repo).
