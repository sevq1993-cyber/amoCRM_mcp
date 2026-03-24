# amoCRM MCP Server

[![CI](https://github.com/sevq1993-cyber/amoCRM_mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/sevq1993-cyber/amoCRM_mcp/actions/workflows/ci.yml)
![Node 22](https://img.shields.io/badge/node-22.x-43853d?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-active-0d8a72)

> 🚀 Готовый к мультиарендной работе MCP-сервер для amoCRM с `stdio`, Streamable HTTP, локальным OIDC/OAuth, обработкой webhook-событий, аудитом действий и поддержкой PostgreSQL/Redis.

Поддерживается **Gulian Digital LLC**.

## ✨ Что внутри

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
2. Заполни amoCRM-параметры, когда будешь готов подключать реальный аккаунт.
3. Установи зависимости и запусти HTTP-сервер.

```bash
cp .env.example .env
npm install
npm run dev:http
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

Поднять локальную инфраструктуру:

```bash
docker compose up -d postgres redis
```

## 🔐 Важно по безопасности

- Реальные amoCRM-секреты и production-токены нельзя хранить в Git.
- В репозиторий должен попадать только `.env.example`, а не рабочий `.env`.
- Перед production-развёртыванием нужно заменить dev-настройки OIDC.
- Для реальной эксплуатации лучше использовать PostgreSQL и Redis вместо in-memory режима.

## ✅ Что уже подготовлено для GitHub

В репозитории уже есть:

- GitHub Actions CI для `npm run check` и `npm run build`
- `CODEOWNERS` для понятной ответственности и review-flow
- шаблоны Issues для багов и новых возможностей
- шаблон Pull Request, чтобы изменения были оформлены аккуратно
- метаданные пакета с привязкой к GitHub-репозиторию

## 🤝 Как вносить изменения

Смотри [`CONTRIBUTING.md`](./CONTRIBUTING.md) для локального запуска, правил по веткам и оформления Pull Request.
