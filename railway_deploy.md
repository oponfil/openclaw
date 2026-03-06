# Деплой инстанса по заказу (Railway)

**Цель:** по запросу пользователя (например из Telegram) поднимать **отдельный инстанс** OpenClaw на Railway — свой процесс, свой контейнер, полная изоляция.

## Что умеет Railway

- **Public API (GraphQL):** `https://backboard.railway.com/graphql/v2`, авторизация через [project token](https://railway.com/account/tokens).
- **Создание сервиса:** мутация `serviceCreate` — можно создать сервис из:
  - GitHub-репозитория (repo, branch, root directory),
  - Docker-образа,
  - пустого сервиса (настроить позже).
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
3. Запускается деплой; после `SUCCESS` у сервиса появляется домен (Settings → Domains). Сохраняем маппинг: `user_id` / `telegram_id` → `railway_service_id` и/или URL инстанса.
4. Дальше запросы этого пользователя направляются на **его** URL (прокси или редирект), либо бот отдаёт ссылку «Твой OpenClaw: https://xxx.up.railway.app».

**Плюсы:** полная изоляция (свой процесс, свой диск/volume), привычная модель «один инстанс на пользователя».

**Минусы:** каждый сервис — отдельное потребление ресурсов и биллинг; холодный старт при первом деплое (1–5+ минут); нужно хранить маппинг user → service/URL и решать, когда останавливать/удалять неиспользуемые сервисы (Railway может переводить в SLEEPING, но политики и лимиты нужно учитывать).

## План задач (кратко)

1. **Интеграция с Railway API:** вызовы для создания сервиса, задания переменных (**OPENCLAW_GATEWAY_TOKEN**, **TELEGRAM_BOT_TOKEN**), при необходимости создание тома.
2. **Маппинг пользователь → инстанс:** хранить в БД/конфиге соответствие `user_id` / `telegram_id` → `railway_service_id`, URL инстанса.
3. **Сценарий по запросу:** по первому сообщению или команде «создать инстанс» — создание сервиса, ожидание деплоя, выдача пользователю ссылки на его OpenClaw.
4. **Политики сна/удаления:** когда останавливать или удалять неиспользуемые сервисы (опционально на первом этапе).
