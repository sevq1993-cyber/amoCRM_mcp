# Changelog

Все заметные изменения в этом репозитории фиксируются здесь.

Формат:
- `Added` для новых возможностей
- `Changed` для переработок существующего поведения
- `Fixed` для исправлений
- `Security` для security-related правок
- `Docs` для документации и workflow

## [Unreleased]

### Added

- Добавлен server-side amoCRM install flow: `/oauth/amocrm/start` и callback со `state`.
- Добавлены route-level и contract-level тесты для HTTP auth, MCP access policy, webhook validation и runtime parity.
- Добавлен `CHANGELOG.md` и правило поддерживать историю изменений в PR workflow.

### Changed

- Dashboard теперь требует bearer auth, редактирует секреты и показывает только доступный токену tenant/client inventory.
- HTTP MCP работает в fail-closed режиме: без bearer auth нет доступа к tools и tenant execution.
- `amocrm_raw_request` больше не обходит границу `crm.read` и `admin.read`.
- `.env` теперь реально подхватывается из корня репозитория.
- README, CONTRIBUTING, Docker path и CI smoke приведены к фактическому запуску.

### Fixed

- Исправлены amoCRM payload contracts для webhook sync и task completion.
- Parser webhook-событий больше не падает на невалидных timestamp.
- `EventService.replay()` теперь отдаёт typed `event_not_found`, а не generic error.
- Invalid bearer token теперь возвращает `WWW-Authenticate`, а не просто `401`.
- Закрыто cross-tenant чтение/управление через admin routes и dashboard inventory.

### Security

- Убран вывод `access_token`, `refresh_token`, `clientSecret` и других секретов из dashboard.
- Webhook ingestion требует `WEBHOOK_SHARED_SECRET` и installation/account binding.
- Webhook token редактируется в логах, ответах и audit-related surfaces.
- `/oauth/amocrm/start` требует admin bearer, если сервер слушает не loopback host.

### Docs

- README стал короче и понятнее для GitHub-витрины.
- Внутренний PR flow теперь явно требует обновлять changelog при изменении поведения, конфига или security-модели.

## [0.1.0] - 2026-03-25

### Added

- Базовый MCP сервер для amoCRM с `stdio` и Streamable HTTP.
- Локальный OIDC/OAuth контур для dev/test сценариев.
- AmoCRM client layer, webhook parser, event store, audit trail и local dashboard.
- In-memory режим по умолчанию и адаптеры под PostgreSQL/Redis.

### Docs

- Подготовлен GitHub-репозиторий, CI, templates, CODEOWNERS и базовая документация проекта.
