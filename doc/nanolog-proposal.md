# Proposal: nanolog — standalone лог-сервер в Docker

## Мотивация

Сейчас вся функциональность логирования (приём, хранение, UI-просмотр, экспорт) встроена в `YobaPub.Proxy`. Это удобно для одного проекта, но при появлении других сервисов каждому придётся дублировать ту же инфраструктуру. Вынос логов в отдельный Docker-сервис **nanolog** даёт:

- **Переиспользование** — любой сервис отправляет логи по HTTP, получает UI из коробки
- **Изоляция** — данные логов и их хранилище не мешают основному приложению
- **Независимый деплой** — обновление UI логов не требует редеплоя основного сервиса
- **Масштабируемость** — один nanolog может обслуживать несколько сервисов

## Архитектура

```
Приложение A ─── POST /api/log ───►┌───────────────┐
Приложение B ─── POST /api/log ───►│   nanolog      │◄── браузер (UI)
.NET apps ────── ILoggerProvider ──►│   :5000        │
                                    └───────┬───────┘
                                            │
                                        LiteDB
                                      /data/nanolog.db
```

### Что переносим из YobaPub.Proxy

| Компонент | Исходный файл | Изменения при переносе |
|-----------|---------------|----------------------|
| `LogEntry` | `LogStore.cs:8-22` | Namespace → `Nanolog` |
| `LogStore` | `LogStore.cs:24-126` | Убрать зависимость от `AdminOptions` → `NanologOptions` |
| `MainDb` | `MainDb.cs` | Аналогично |
| `DebugSettingsStore` + `AppSettings` | `DebugSettingsStore.cs` | Как есть |
| `UserSettings` + `UserSettingsStore` | `UserSettingsStore.cs` | Как есть |
| `LiteDbLoggerProvider` | `LiteDbLoggerProvider.cs` | Как есть (для логирования самого nanolog) |
| `LogRetentionService` | `LogRetentionService.cs` | Убрать `PlaybackErrorStore` — оставить только логи |
| `LogsQuery` + `LogsViewModel` | `Models/LogsQuery.cs` | Namespace |
| `StringExtensions` | `StringExtensions.cs` | Namespace |
| `DateTimeOffsetExtensions` | `DateTimeOffsetExtensions.cs` | Namespace |
| `LogsController` | `Controllers/LogsController.cs` | Route `/admin/logs` → `/logs` |
| `AuthController` | `Controllers/AuthController.cs` | Route `/admin/login` → `/login` |
| `SettingsController` | `Controllers/SettingsController.cs` | Оставить только timezone + debug toggle + max entries |
| `POST /api/log` endpoint | `Program.cs:93-116` | Как есть |
| `Index.cshtml` | `Views/Logs/Index.cshtml` | Убрать "YobaPub" из заголовка → "Nanolog" |
| `Entry.cshtml` | `Views/Logs/Entry.cshtml` | URL-ы без `/admin` prefix |
| `_Rows.cshtml` | `Views/Logs/_Rows.cshtml` | URL-ы без `/admin` prefix |
| `_Layout.cshtml` | `Views/Shared/_Layout.cshtml` | Убрать nav-ссылки на VIP, Ошибки CDN |
| `_ViewImports.cshtml` | `Views/_ViewImports.cshtml` | Namespace |
| `admin.css` | `wwwroot/css/admin.css` | Вычистить стили VIP-страницы |
| `admin.js` | `wwwroot/js/admin.js` | Как есть |
| `htmx.min.js` | `wwwroot/js/htmx.min.js` | Как есть |

### Что НЕ переносим

- `UniversalProxyMiddleware`, `HlsRewriter`, `ProxyConfig` — proxy-функциональность
- `PlaybackErrorStore`, `PlaybackErrorEntry` — специфика YobaPub
- `VipLoginStore`, `VipController` — специфика YobaPub
- `AdminController` (если содержит только YobaPub-специфичное)
- Вся фронтенд-часть (`src/front/`)

## Сводная таблица задач

| # | Что сделать | Сложность | Описание |
|:-:|-------------|:---------:|----------|
| 1 | Создать проект `Nanolog` | 1 | `dotnet new web`, добавить LiteDB, настроить csproj |
| 2 | Перенести модели и storage | 1 | `LogEntry`, `LogStore`, `MainDb`, `DebugSettingsStore`, `UserSettingsStore` |
| 3 | Перенести extensions | 1 | `StringExtensions`, `DateTimeOffsetExtensions` |
| 4 | Создать `NanologOptions` | 1 | Конфиг: `DbPath`, `RetentionDays`, `Username`, `Password`, `MaxLogEntries` |
| 5 | Перенести `LogRetentionService` | 1 | Убрать `PlaybackErrorStore`, оставить только логи |
| 6 | Перенести контроллеры | 2 | `LogsController` (route → `/logs`), `AuthController` (→ `/login`), `SettingsController` (только лог-настройки) |
| 7 | Перенести views | 2 | Адаптировать URL-ы, убрать YobaPub-специфику из layout и nav |
| 8 | Перенести static assets | 2 | CSS (вычистить VIP/CDN-стили), JS, htmx |
| 9 | Написать `Program.cs` | 2 | DI, auth, `POST /api/log`, static files |
| 10 | Добавить `Dockerfile` | 1 | Multi-stage build, volume `/data` |
| 11 | Адаптировать YobaPub.Proxy | 2 | Заменить встроенные логи на HTTP-отправку в nanolog |
| 12 | Добавить поле `Source` | 1 | Чтобы различать логи от разных приложений |

## Детальный план

### Шаг 1 — Создать проект

Структура:
```
src/back/Nanolog/
├── Nanolog.csproj
├── Program.cs
├── NanologOptions.cs
├── LogEntry.cs
├── LogStore.cs
├── MainDb.cs
├── DebugSettingsStore.cs
├── UserSettingsStore.cs
├── LiteDbLoggerProvider.cs
├── LogRetentionService.cs
├── StringExtensions.cs
├── DateTimeOffsetExtensions.cs
├── Controllers/
│   ├── LogsController.cs
│   ├── AuthController.cs
│   └── SettingsController.cs
├── Models/
│   ├── LogsQuery.cs
│   └── SettingsViewModel.cs
├── Views/
│   ├── _ViewImports.cshtml
│   ├── Shared/
│   │   └── _Layout.cshtml
│   ├── Logs/
│   │   ├── Index.cshtml
│   │   ├── Entry.cshtml
│   │   └── _Rows.cshtml
│   ├── Auth/
│   │   └── Login.cshtml
│   └── Settings/
│       └── Index.cshtml
├── wwwroot/
│   ├── css/
│   │   └── admin.css
│   └── js/
│       ├── admin.js
│       └── htmx.min.js
└── Dockerfile
```

### Шаг 2 — NanologOptions

Вместо `AdminOptions` (который содержит proxy-специфику) — чистый конфиг для логов:

```csharp
public class NanologOptions
{
    public string DbPath { get; init; } = "/data/nanolog.db";
    public string MainDbPath { get; init; } = "/data/main.db";
    public int RetentionDays { get; init; } = 60;
    public int MaxLogEntries { get; init; } = 2000;
    public string Username { get; init; } = "admin";
    public string Password { get; init; } = "secret";
}
```

Конфигурация через environment variables (Docker-friendly):

```yaml
environment:
  Nanolog__DbPath: /data/nanolog.db
  Nanolog__RetentionDays: 30
  Nanolog__Username: admin
  Nanolog__Password: ${NANOLOG_PASSWORD}
```

### Шаг 3 — Добавить поле Source

Чтобы один экземпляр nanolog мог обслуживать несколько приложений, добавить поле `Source` в `LogEntry`:

```csharp
public class LogEntry
{
    // ... существующие поля ...
    public string Source { get; set; } = "";  // "yobapub", "other-app", ...
}
```

- `POST /api/log` принимает опциональный `source` в JSON
- UI получает колонку/фильтр по Source
- Серверные логи (через `LiteDbLoggerProvider`) автоматически ставят `Source = "nanolog"`

### Шаг 4 — Адаптировать Layout

Текущий `_Layout.cshtml` содержит навигацию: Логи → Ошибки CDN → VIP → Настройки.

В nanolog оставить:
```html
<nav class="admin-nav">
    <a href="/logs">Логи</a>
    <a href="/settings">Настройки</a>
    <form action="/logout" method="post">
        <button type="submit" class="danger">Выйти</button>
    </form>
</nav>
```

### Шаг 5 — Адаптировать URL-ы в Views

Все URL-ы теряют prefix `/admin`:

| Было | Стало |
|------|-------|
| `/admin/logs` | `/logs` |
| `/admin/logs/{id}` | `/logs/{id}` |
| `/admin/logs/{id}/text` | `/logs/{id}/text` |
| `/admin/logs/more` | `/logs/more` |
| `/admin/logs/download` | `/logs/download` |
| `/admin/logs/clear` | `/logs/clear` |
| `/admin/login` | `/login` |
| `/admin/settings` | `/settings` |

### Шаг 6 — Dockerfile

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:9.0-alpine AS build
WORKDIR /src
COPY Nanolog.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:9.0-alpine
WORKDIR /app
COPY --from=build /app .
VOLUME /data
EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000
ENTRYPOINT ["dotnet", "Nanolog.dll"]
```

### Шаг 7 — Адаптировать YobaPub.Proxy

После выноса nanolog, в `YobaPub.Proxy` удаляем:
- `LogStore.cs`, `MainDb.cs`, `DebugSettingsStore.cs`, `UserSettingsStore.cs`
- `LiteDbLoggerProvider.cs`, `LogRetentionService.cs`
- `StringExtensions.cs`, `DateTimeOffsetExtensions.cs`
- `Controllers/LogsController.cs`, `Controllers/SettingsController.cs`
- `Views/Logs/`, `Views/Settings/`
- Связанные стили и JS из admin.css/admin.js
- `POST /api/log` endpoint из `Program.cs`

Вместо этого — HTTP-forwarding:

```csharp
// Program.cs — форвардинг клиентских логов в nanolog
app.MapPost("/api/log", async (HttpContext ctx, IHttpClientFactory factory) =>
{
    using var client = factory.CreateClient();
    var body = await new StreamReader(ctx.Request.Body).ReadToEndAsync();
    await client.PostAsync("http://nanolog:5000/api/log",
        new StringContent(body, System.Text.Encoding.UTF8, "application/json"));
    return Results.Ok();
});
```

Для серверных логов YobaPub — или аналогичный HTTP logger provider, или напрямую `POST /api/log`.

### Шаг 8 — docker-compose

```yaml
services:
  yobapub:
    build: ./src/back/YobaPub.Proxy
    ports: ["8080:8080"]
    depends_on: [nanolog]

  nanolog:
    build: ./src/back/Nanolog
    ports: ["5000:5000"]
    volumes:
      - nanolog-data:/data
    environment:
      Nanolog__Username: admin
      Nanolog__Password: ${NANOLOG_PASSWORD:-secret}
      Nanolog__RetentionDays: 30

volumes:
  nanolog-data:
```

## Что получает потребитель

1. **`docker pull nanolog`** — готовый лог-сервер с UI
2. **`POST /api/log`** — единственный контракт для отправки логов:
   ```json
   {
     "source": "my-app",
     "level": "Error",
     "category": "HttpClient",
     "message": "Connection refused",
     "deviceId": "optional",
     "traceId": "optional",
     "props": {},
     "clientTs": 1234567890
   }
   ```
3. **Web UI** на порту 5000 — фильтрация, поиск, автообновление, экспорт TSV, копирование
4. **Конфигурация** через environment variables — никаких файлов конфигурации

## Хранилище: LiteDB vs альтернативы

LiteDB удобен для прототипа (zero-config, embedded, single file), но у него есть ограничения, которые станут проблемой при использовании nanolog как общего лог-сервера:

| Проблема | Влияние |
|----------|---------|
| **Глобальный lock на запись** | Один writer — при активной записи логов от нескольких источников UI-запросы на чтение блокируются |
| **Полнотекстовый поиск** | Отсутствует — сейчас `Search` фильтрует через `string.Contains()` по всем записям в памяти |
| **Производительность на >100K записей** | `QueryWithCursor` загружает все записи в память и фильтрует через LINQ — O(N) на каждый запрос |
| **Нет WAL по умолчанию** | Риск потери данных при аварийном завершении |
| **Размер файла** | Не сжимает данные, файл БД растёт быстро; `Rebuild()` для компакции блокирует всю базу |

### Варианты замены

#### Embedded (in-process, один контейнер)

| Движок | FTS | Сжатие | .NET поддержка | Плюсы | Минусы |
|--------|:---:|:------:|:--------------:|-------|--------|
| **SQLite + FTS5** | FTS5 | Нет | `Microsoft.Data.Sqlite` — first-class | WAL, battle-tested, ~1MB, стандартный SQL | Row-oriented — без сжатия, диск растёт линейно |
| **DuckDB** | Базовый | Отличное (columnar) | `DuckDB.NET` — активно развивается | Колоночное сжатие 3-5x для повторяющихся строк, аналитические запросы | FTS слабее чем SQLite FTS5, native lib ~20MB |
| **Lucene.NET** | Отличный | Inverted index | `Lucene.Net` — нативный .NET | Лучший полнотекстовый поиск (релевантность, фразы, fuzzy), `SearchAfter` для пагинации | Выше сложность API, нужно управлять IndexWriter/Reader lifecycle |

#### Sidecar (второй процесс в контейнере)

| Движок | FTS | Сжатие | .NET поддержка | Плюсы | Минусы |
|--------|:---:|:------:|:--------------:|-------|--------|
| **VictoriaLogs** | LogsQL | Хорошее | HTTP API (нет SDK) | Создан специально для логов, ~15MB RAM idle, retention из коробки, single binary | Go binary, нужен supervisor (s6/tini), нет нативного .NET клиента |
| **OpenObserve** | Да | Хорошее | HTTP API (ES-compatible) | Logs + metrics + traces, Rust, ~100MB RAM | Тяжелее VictoriaLogs, молодой проект |

#### Не подходят

| Движок | Почему |
|--------|--------|
| **InfluxDB** | Только server mode, нет embedded. Заточен под метрики (числовые time-series), а не логи (текст + поиск) |
| **Loki** | Требует object storage (S3/filesystem), сложная настройка. Заточен под Grafana |
| **Elasticsearch / OpenSearch** | JVM, 500MB+ RAM minimum. Overkill |
| **ClickHouse** | Сервер, сотни MB RAM. chdb (embedded) — нет .NET bindings |
| **RocksDB / LevelDB / FASTER** | Key-value stores — слишком низкоуровневые, нет query engine, пришлось бы строить БД поверх |

### Рекомендация

**SQLite + FTS5** — оптимальный баланс для nanolog:
- Покрывает все требования (append, time-range, FTS, фильтрация, cursor pagination, retention)
- Минимальная сложность, первоклассная .NET-поддержка
- WAL-режим решает проблему concurrent read/write
- Миграция текущего `LogStore` несложная — API тот же (`Add`, `QueryWithCursor`, `FindById`, `DeleteOlderThan`), меняется только реализация
- Вместо `ApplyFilters()` на LINQ по всему массиву — SQL-запрос с индексами

Если со временем объёмы вырастут, миграция на DuckDB (сжатие) или VictoriaLogs (специализация) — задел на будущее, но не blocker для старта.

## Открытые вопросы

1. **API-ключи вместо/вместе с cookie-auth?** — сейчас UI защищён cookie-аутентификацией, но `POST /api/log` открыт. Для Docker-сети это нормально (сервисы в одной сети), но при публичном доступе нужен API-key header.
2. **Несколько source в одном UI** — достаточно ли колонки + фильтра, или нужны отдельные "пространства" с изолированным хранением?
