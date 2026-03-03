# Отличия этого форка от upstream OpenClaw

Этот репозиторий — форк [openclaw/openclaw](https://github.com/openclaw/openclaw). Ниже перечислены **все изменения**, которые мы сохраняем относительно оригинального проекта. Документ нужен, чтобы при очередном слиянии с upstream (`git merge upstream/main`) не потерять наши правки и осознанно разрешать конфликты.

---

## 1. Docker и деплой (Railway / облако)

### 1.1 Dockerfile

| Что | Upstream | Наш форк |
|-----|----------|----------|
| Конфиг по умолчанию | Нет предустановленного конфига в образе | Сначала копируем `config/openclaw.railway.build.json` (минимальный, без `plugins.allow`), ставим ClawRouter, затем подменяем на `config/openclaw.railway.json` (см. [1.2](#12-configopenclawrailwayjson)) |
| Entrypoint | Нет (прямой `CMD`) | `ENTRYPOINT ["/app/scripts/docker/entrypoint-with-browser.sh"]` |
| Установка в образе | — | Устанавливаем `gosu`; **Chromium + Xvfb** ставятся при сборке (`OPENCLAW_INSTALL_BROWSER=1`), чтобы контейнер в Railway стартовал за секунды и health check проходил (без этого при первом запуске ставится браузер 1–2 мин). |
| Пользователь по умолчанию | `node` | `USER root`, чтобы entrypoint при первом запуске мог установить Chromium, затем процесс запускается от `node` через `gosu` |
| Порт шлюза | 18789 (loopback) | **8080** по умолчанию; в облаке — переменная **PORT** (entrypoint и start-gateway.sh пробрасывают её; health check на этом порту). При необходимости в Railway Variables задать **PORT=8080**. |
| Привязка | loopback (127.0.0.1) по умолчанию | `--bind lan` (0.0.0.0), чтобы шлюз был доступен снаружи контейнера |
| HEALTHCHECK | На порт 18789 | На порт **8080** (`http://127.0.0.1:8080/healthz`) |
| CMD | `node openclaw.mjs gateway --allow-unconfigured` | `node openclaw.mjs gateway --allow-unconfigured --bind lan --port 8080` |
| Плагин ClawRouter | Нет | Установка в образ: `openclaw plugins install @blockrun/clawrouter --pin` (модель по умолчанию `blockrun/auto`) |

### 1.2 config/openclaw.railway.json

Файл подкладывается в образ как дефолтный конфиг (`/app/.openclaw/openclaw.json`), чтобы:

- В облаке/Railway не требовать интерактивного pairing устройств:  
  `gateway.controlUi.dangerouslyDisableDeviceAuth: true`
- Задать свои настройки каналов (например, `channels.telegram.allowFrom`) под наш аккаунт.
- **ClawRouter (BlockRunAI):** плагин `clawrouter` включён, модель по умолчанию — `blockrun/auto` (умный роутинг по цене/качеству). Оплата — USDC по протоколу x402 на **Base**. Ключ кошелька создаётся автоматически при первом запуске (`~/.openclaw/blockrun/wallet.key`); в переменные окружения ничего добавлять не нужно. **Без пополнения** работает бесплатный тир (модель `gpt-oss-120b`, профиль `/model free`) — можно пользоваться сразу. Пополнить можно любой суммой (от $5 хватает на тысячи запросов). Профили: `/model auto`, `/model eco`, `/model premium`, `/model free`.

Содержимое файла — наш собственный конфиг; при merge с upstream этот файл обычно не трогают.

### 1.3 scripts/docker/entrypoint-with-browser.sh

Скрипт entrypoint для контейнера:

- Если контейнер запущен от **root**: при первом запуске при необходимости ставит Chromium и Xvfb в кэш пользователя `node` (`PLAYWRIGHT_BROWSERS_PATH`), затем выполняет `CMD` от пользователя `node` через `gosu`.
- Если контейнер запущен не от root — просто выполняет `CMD` как есть.

Так мы можем не включать браузер в образ при сборке (`OPENCLAW_INSTALL_BROWSER`), а установить его при первом старте (например, на Railway), когда нет интерактивного `docker run`.

---

## 2. Тесты

### 2.1 src/dockerfile.test.ts

Дополнительный тест, проверяющий нашу кастомизацию Dockerfile:

- **"includes entrypoint for optional runtime browser install when run as root"** — наличие в Dockerfile строк про `gosu`, `entrypoint-with-browser.sh` и `ENTRYPOINT [...]`.

Остальные тесты в этом файле (нормализация прав плагинов, Docker GPG fingerprint) совпадают с upstream; при merge мы объединяем их с нашим тестом про entrypoint.

---

## 3. Как обновляться с upstream

1. Подтянуть изменения:  
   `git fetch upstream`  
   `git merge upstream/main`
2. При конфликтах в первую очередь проверить:
   - **Dockerfile** — сохранить блоки с `config/openclaw.railway.json`, gosu, entrypoint, `--port 8080`, `--bind lan`, HEALTHCHECK на 8080.
   - **src/dockerfile.test.ts** — сохранить тест про entrypoint и дописать/объединить новые тесты из upstream.
3. После разрешения конфликтов:  
   `git add ...` → `git commit` → `git push origin main`.

---

## 4. Краткий чеклист наших отличий

- [ ] **Dockerfile**: предустановка `config/openclaw.railway.json`, установка плагина **ClawRouter** (`openclaw plugins install @blockrun/clawrouter --pin`), gosu, entrypoint `entrypoint-with-browser.sh`, `USER root`, порт **8080**, `--bind lan`, HEALTHCHECK на 8080.
- [ ] **config/openclaw.railway.json** и **config/openclaw.railway.build.json**: наш конфиг (build — минимальный для установки плагина; railway.json — полный: device auth, каналы, clawrouter, `blockrun/auto`).
- [ ] **scripts/docker/entrypoint-with-browser.sh**: установка Chromium при первом запуске от root, запуск CMD от `node` через gosu.
- [ ] **src/dockerfile.test.ts**: тест на наличие entrypoint/gosu в Dockerfile.

Если что-то из этого списка исчезло после merge — вернуть вручную и зафиксировать в этом документе.
