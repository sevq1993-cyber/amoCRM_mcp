# amoCRM MCP Server

[![CI](https://github.com/sevq1993-cyber/amoCRM_mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sevq1993-cyber/amoCRM_mcp/actions/workflows/ci.yml)
![Node 22](https://img.shields.io/badge/node-22.x-43853d?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-internal%20development-0d8a72)

> Внутренний MCP-сервер для amoCRM с `stdio`, Streamable HTTP, локальным OIDC/OAuth, webhook ingestion, аудитом и tenant-aware access model.

Поддерживается **Gulian Digital LLC**.

## Кратко

- Статус: internal development
- Основной сценарий: локальная разработка и проверка amoCRM integration до серверного развёртывания
- Полная история изменений: [CHANGELOG.md](./CHANGELOG.md)
- Текущий baseline: hardened local auth, guarded dashboard, tenant-scoped MCP и webhook token redaction

## Обновления

В этом репозитории изменения фиксируются не только в git commit’ах, но и в читаемом виде.

- `Added` — новые функции, инструменты, маршруты и возможности
- `Changed` — переработка существующего поведения и контрактов
- `Fixed` — исправления багов и регрессий
- `Security` — изменения в auth, access control, webhook trust model и защите секретов
- `Docs` — обновления README, CI, Docker, runbook и внутреннего workflow

Главная точка для истории изменений: [CHANGELOG.md](./CHANGELOG.md).
Если в проекте меняется поведение, конфиг, безопасность или внешний контракт, это должно отражаться и там, и при необходимости в этом README.

## Последнее обновление

- Закрыт публичный доступ к `/dashboard`, убраны секреты и лишний tenant inventory.
- HTTP MCP переведён в fail-closed режим без bearer auth.
- Добавлен server-side amoCRM install flow со `state`.
- Webhook ingestion теперь проверяет token и installation/account binding.
- README, CI и локальный runbook приведены к фактическому поведению.

Для полного списка изменений по шагам смотри [CHANGELOG.md](./CHANGELOG.md).

## Что внутри

- 🤖 `stdio` для локальных MCP-агентов и desktop-инструментов
- 🌐 Streamable HTTP для удалённых MCP-клиентов
- 🔐 Встроенный локальный OIDC/OAuth-контур для разработки и тестирования
- 🔄 Подключение amoCRM через OAuth с обменом и обновлением токенов
- 📩 Приём webhook-событий с нормализованным хранением
- 🧾 Журнал аудита для операций записи
- 🖥️ Локальная панель по адресу `/dashboard`
- 🗃️ Хранение в памяти по умолчанию и опциональная связка PostgreSQL + Redis

## 🧱 Структура проекта

```text
src/
├── amocrm/         клиент amoCRM API
├── auth/           HTTP bearer auth и локальный OIDC
├── events/         парсинг webhook и сервис событий
├── http/           Fastify-приложение и локальная панель
├── mcp/            MCP-инструменты и ресурсы
├── observability/  логирование
├── persistence/    хранение в памяти и PostgreSQL адаптеры
├── runtime/        bootstrap и сборка контекста приложения
└── utils/          общие утилиты
```

## ⚡ Быстрый старт

1. Скопируй `.env.example` в `.env`.
2. Заполни amoCRM-параметры и базовые локальные значения.
3. Установи зависимости и запусти HTTP-сервер.

```bash
cp .env.example .env
npm install
npm run dev:http
```

Приложение автоматически читает `.env` из корня репозитория.

Для запуска уже собранной версии:

```bash
npm run build
npm run start:http
```

Открой локальную панель:

```text
http://localhost:3000/dashboard
```

## 🔌 Основные эндпоинты

- Панель: `http://localhost:3000/dashboard`
- MCP HTTP: `http://localhost:3000/mcp`
- Health: `http://localhost:3000/healthz`
- Readiness: `http://localhost:3000/readyz`
- OIDC discovery: `http://localhost:3000/.well-known/openid-configuration`
- Метаданные OAuth protected resource: `http://localhost:3000/.well-known/oauth-protected-resource/mcp`
- Callback amoCRM: `http://localhost:3000/oauth/amocrm/callback`
- Webhook endpoint: `http://localhost:3000/webhooks/amocrm`
  При регистрации webhook сервер сам добавляет `?token=<WEBHOOK_SHARED_SECRET>`, но этот токен не должен светиться в логах, UI или аудит-трейле.

## 🧪 Скрипты

```bash
npm run dev:http
npm run dev:stdio
npm run build
npm run start:http
npm run start:stdio
npm run test
npm run check
```

## ⚙️ Локальные значения по умолчанию

- Тенант по умолчанию: `local-default`
- Локальная админ-учётка: `local-admin`
- `client_id` локального OAuth-клиента: `local-dev-client`
- `client_secret` локального OAuth-клиента: `local-dev-secret`
- Redirect URI по умолчанию: `http://127.0.0.1:8787/callback`

## 🗄️ Режимы хранения

- Локальный режим по умолчанию: хранение и кэш в памяти
- Серверный режим: PostgreSQL + Redis через `POSTGRES_URL` и `REDIS_URL`

## 🐳 Docker

Собрать образ приложения:

```bash
docker build -t amocrm-mcp .
```

Поднять весь локальный стек, включая приложение:

```bash
docker compose up --build
```

Если нужен только инфраструктурный слой, можно поднять отдельно Postgres и Redis.

## 🔐 Важно по безопасности

- Это внутренний репозиторий Gulian Digital LLC, а не публичный open-source проект.
- Реальные amoCRM-секреты и production-токены нельзя хранить в Git.
- В репозиторий должен попадать только `.env.example`, а не рабочий `.env`.
- Перед серверным развёртыванием нужен отдельный hardening pass для OIDC, webhook trust model и network exposure.
- Для webhook ingestion используй отдельный `WEBHOOK_SHARED_SECRET`, а не значения по умолчанию.
- Для реальной эксплуатации лучше использовать PostgreSQL и Redis вместо in-memory режима.

## ✅ Что уже подготовлено для внутреннего GitHub workflow

В репозитории уже есть:

- GitHub Actions CI для `npm run check` и `npm run build`
- `CODEOWNERS` для понятной ответственности и review-flow
- шаблоны Issues для багов и новых возможностей
- шаблон Pull Request, чтобы изменения были оформлены аккуратно
- метаданные пакета с привязкой к GitHub-репозиторию

## 🤝 Как вносить изменения

Смотри [`CONTRIBUTING.md`](./CONTRIBUTING.md) для локального запуска, внутреннего review-flow и оформления Pull Request.
