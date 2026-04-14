# Design: Versioning, CI/CD, and Release Pipeline

## Status: Draft

## Overview

Внедрить GitVersion для автоматического семантического версионирования. На основе версии:
- бэкенд отдает `/api/about` с метаданными сборки
- фронт запекает версию при сборке (compile-time)
- Docker-образы тегируются semver
- APK и Tizen .wgt собираются и публикуются как GitHub Release по тегу

---

## 1. GitVersion

### Почему GitVersion

- Не нужно тегировать каждый коммит — версия вычисляется из истории и веток
- Поддерживает GitFlow / GitHub Flow из коробки
- Генерирует JSON со всеми нужными полями (~28 переменных)
- Официальный GitHub Action (`gittools/actions`)
- Можно выгрузить как JSON (для бэка) или dotenv (для фронт-сборки)

### Стартовая версия

Максимальный тег в репозитории: `v1.7.0` (+ `1.7.1` без префикса). 146 коммитов после `v1.7.0`.

Стартовая версия: **`next-version: 2.0.0`** — мажорный бамп, чтобы гарантированно не пересечься с историей.

### Режим: ContinuousDelivery

`mode: ContinuousDelivery` — каждый коммит на не-release ветке получает pre-release суффикс с инкрементирующимся номером (e.g. `2.0.1-feature-foo.3`). На master при наличии тега — чистый semver (`2.0.0`). Без тега на master — `2.0.1-1`, `2.0.1-2`, ... Тег фиксирует релизную точку.

### Конфигурация

Файл `GitVersion.yml` в корне репозитория:

```yaml
mode: ContinuousDelivery
next-version: 2.0.0
tag-prefix: '[vV]?'

branches:
  main:
    regex: '^master$|^main$'
    increment: Patch
    label: ''
    is-main-branch: true

  feature:
    regex: '^features?[/-](?<BranchName>.+)'
    increment: Inherit
    label: '{BranchName}'

  release:
    regex: '^releases?[/-](?<BranchName>.+)'
    increment: Minor
    label: rc
    is-release-branch: true

  hotfix:
    regex: '^hotfix(es)?[/-](?<BranchName>.+)'
    increment: Patch
    label: hotfix
```

### Используемые поля из JSON-вывода

| Поле | Пример (master) | Пример (feature) | Где используется |
|---|---|---|---|
| `SemVer` | `2.0.0` | `2.0.1-my-feature.3` | Docker-тег, фронт, бэк about |
| `FullSemVer` | `2.0.0` | `2.0.1-my-feature.3+5` | InformationalVersion, .NET assembly |
| `MajorMinorPatch` | `2.0.0` | `2.0.1` | APK versionName (без pre-release) |
| `Sha` | `28c853...` | `28c853...` | `/api/about` |
| `ShortSha` | `28c8531` | `28c8531` | `/api/about`, Docker-тег |
| `CommitDate` | `2026-04-02` | `2026-04-02` | `/api/about` (дата коммита = дата сборки приблизительно) |
| `PreReleaseLabel` | `""` | `my-feature` | Определение: release или pre-release |
| `WeightedPreReleaseNumber` | `55000` | `30003` | APK `versionCode` (монотонно растёт, учитывает вес ветки) |
| `BranchName` | `master` | `feature/my-feature` | Информационно |

### APK versionCode

Android требует `versionCode` — целое число, строго возрастающее.

`WeightedPreReleaseNumber` — сумма `pre-release-weight` ветки и `PreReleaseNumber`. На master (weight=55000) это 55000, на feature (weight=30000) — 30001, 30002, ... Гарантирует что master-версия всегда "выше" feature-версии.

Если `WeightedPreReleaseNumber` окажется недостаточно предсказуемым — fallback на `github.run_number`.

---

## 2. Prepare-скрипт: подстановка версии

### Концепция

Один скрипт `scripts/prepare-version.sh`, вызываемый перед publish и release job'ами. Принимает JSON от GitVersion, генерирует артефакты для каждого компонента.

### Входные данные

GitVersion JSON (полный вывод `gitversion /output json`), сохранённый в файл:

```bash
gitversion /output json > version.json
```

### Что делает скрипт

```bash
#!/bin/bash
set -euo pipefail

VERSION_JSON="${1:?Usage: prepare-version.sh <version.json>}"

# Читаем нужные поля из JSON
SEMVER=$(jq -r '.SemVer' "$VERSION_JSON")
FULL_SEMVER=$(jq -r '.FullSemVer' "$VERSION_JSON")
SHA=$(jq -r '.Sha' "$VERSION_JSON")
SHORT_SHA=$(jq -r '.ShortSha' "$VERSION_JSON")
COMMIT_DATE=$(jq -r '.CommitDate' "$VERSION_JSON")
BRANCH=$(jq -r '.BranchName' "$VERSION_JSON")
MAJOR=$(jq -r '.Major' "$VERSION_JSON")
MINOR=$(jq -r '.Minor' "$VERSION_JSON")
PATCH=$(jq -r '.Patch' "$VERSION_JSON")
WEIGHTED=$(jq -r '.WeightedPreReleaseNumber' "$VERSION_JSON")
PRE_RELEASE_LABEL=$(jq -r '.PreReleaseLabel' "$VERSION_JSON")

BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# ── 1. Бэкенд: копируем полный GitVersion JSON как есть ──
cp "$VERSION_JSON" src/back/YobaPub.Proxy/version.json

echo "Backend: src/back/YobaPub.Proxy/version.json"

# ── 2. Фронт: .env файл для webpack ──
cat > src/front/.env <<EOF
GITVERSION_SEMVER=$SEMVER
GITVERSION_FULL_SEMVER=$FULL_SEMVER
GITVERSION_SHA=$SHA
GITVERSION_SHORT_SHA=$SHORT_SHA
GITVERSION_COMMIT_DATE=$COMMIT_DATE
GITVERSION_BUILD_DATE=$BUILD_DATE
EOF

echo "Frontend: src/front/.env"

# ── 3. Tizen: обновить version в config.xml ──
sed -i "s/version=\"[^\"]*\"/version=\"$MAJOR.$MINOR.$PATCH\"/" \
  src/tizen-widget/src/config.xml

echo "Tizen: config.xml version=$MAJOR.$MINOR.$PATCH"

# ── 4. APK: gradle.properties с версией ──
cat > src/apk/version.properties <<EOF
versionName=$SEMVER
versionCode=$WEIGHTED
EOF

echo "APK: src/apk/version.properties versionName=$SEMVER versionCode=$WEIGHTED"

# ── 5. Экспорт переменных для CI (GitHub Actions) ──
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "semVer=$SEMVER"
    echo "fullSemVer=$FULL_SEMVER"
    echo "sha=$SHA"
    echo "shortSha=$SHORT_SHA"
    echo "commitDate=$COMMIT_DATE"
    echo "buildDate=$BUILD_DATE"
    echo "weightedPreReleaseNumber=$WEIGHTED"
    echo "majorMinorPatch=$MAJOR.$MINOR.$PATCH"
    echo "preReleaseLabel=$PRE_RELEASE_LABEL"
  } >> "$GITHUB_OUTPUT"
fi

echo "Done: SemVer=$SEMVER"
```

### Почему один скрипт

- Единая точка правды — все 4 компонента (бэк, фронт, tizen, apk) версионируются из одного источника
- Воспроизводимость — можно запустить локально: `gitversion /output json > v.json && ./scripts/prepare-version.sh v.json`
- При разделении бэка и фронта — скрипт разбивается на части, но формат входа остаётся тем же

---

## 3. Бэкенд: `/api/about`

### Механизм инжекта версии

Prepare-скрипт генерирует `src/back/YobaPub.Proxy/version.json`. Файл включается в publish output через `.csproj`:

```xml
<ItemGroup>
  <None Include="version.json" CopyToOutputDirectory="PreserveNewest" Condition="Exists('version.json')" />
</ItemGroup>
```

В Docker-образе файл оказывается в `/app/version.json` рядом с DLL.

### Формат `version.json`

Полный JSON от GitVersion (~28 полей) копируется как есть. Содержит `SemVer`, `FullSemVer`, `Sha`, `ShortSha`, `CommitDate`, `BranchName`, `Major`, `Minor`, `Patch` и т.д.

### Endpoint

Minimal API в `Program.cs`. Файл читается один раз при старте и кэшируется:

```csharp
app.MapGet("/api/about", () =>
{
    var path = Path.Combine(AppContext.BaseDirectory, "version.json");
    if (!File.Exists(path))
        return Results.Json(new { semVer = "dev", sha = "", shortSha = "", commitDate = "", buildDate = "", branch = "" });
    var json = File.ReadAllText(path);
    return Results.Content(json, "application/json");
});
```

Endpoint публичный, без авторизации.

### Будущее разделение бэка и фронта

`version.json` привязан к артефакту сборки. Если бэк и фронт разнесутся — каждый pipeline запустит свой prepare-скрипт (или его часть) и получит свой `version.json`.

---

## 4. Фронт: версия при сборке

### Механизм

Prepare-скрипт генерирует `src/front/.env`. Webpack читает его через `dotenv` или через Docker build args.

**Вариант для Docker-сборки** (текущая архитектура — фронт собирается внутри Docker):

Dockerfile передаёт build args → env vars → webpack DefinePlugin.

**Вариант для локальной/CI-сборки**:

Webpack читает `process.env.GITVERSION_*`, которые выставлены из `.env` или CI environment.

### webpack.config.js — изменения

Текущий `getAppVersion()` остаётся как fallback для локальной разработки:

```js
function getVersionInfo() {
  var semVer = process.env.GITVERSION_SEMVER;
  if (semVer) {
    return {
      version: semVer,
      sha: process.env.GITVERSION_SHA || '',
      shortSha: process.env.GITVERSION_SHORT_SHA || '',
      commitDate: process.env.GITVERSION_COMMIT_DATE || '',
      buildDate: process.env.GITVERSION_BUILD_DATE || '',
    };
  }
  // fallback для локальной разработки
  return {
    version: getAppVersion(),  // существующая функция: count-hash (date)
    sha: '', shortSha: '', commitDate: '', buildDate: '',
  };
}

// в plugins:
new webpack.DefinePlugin({
  __APP_VERSION__: JSON.stringify(info.version),
  __BUILD_SHA__: JSON.stringify(info.sha),
  __BUILD_SHORT_SHA__: JSON.stringify(info.shortSha),
  __BUILD_DATE__: JSON.stringify(info.buildDate),
})
```

### globals.d.ts

```ts
declare var __APP_VERSION__: string;
declare var __BUILD_SHA__: string;
declare var __BUILD_SHORT_SHA__: string;
declare var __BUILD_DATE__: string;
```

### settings.ts

Отображение: `2.0.0 (28c8531)` — или просто `__APP_VERSION__` если SHA пустой (dev mode).

---

## 5. Docker (app)

### Теги

| Условие | Теги |
|---|---|
| Push в master | `:latest`, `:<semver>`, `:sha-<shortSha>` |
| Push тега `v*` | `:latest`, `:<semver>`, `:sha-<shortSha>` |

SemVer-тег на master без тега (ContinuousDelivery) будет `2.0.1-1` и т.д.
При push тега `v2.0.1` — чистый `2.0.1`.

### Dockerfile — изменения

Заменить `ARG APP_VERSION` на набор `GITVERSION_*` args:

```dockerfile
# Stage 1: Build frontend
FROM node:24-alpine AS frontend
WORKDIR /src
COPY src/front/package.json src/front/package-lock.json ./
RUN npm ci
COPY src/front/ .

ARG GITVERSION_SEMVER=dev
ARG GITVERSION_SHA=unknown
ARG GITVERSION_SHORT_SHA=unknown
ARG GITVERSION_COMMIT_DATE=unknown
ARG GITVERSION_BUILD_DATE=unknown
ENV GITVERSION_SEMVER=$GITVERSION_SEMVER
ENV GITVERSION_SHA=$GITVERSION_SHA
ENV GITVERSION_SHORT_SHA=$GITVERSION_SHORT_SHA
ENV GITVERSION_COMMIT_DATE=$GITVERSION_COMMIT_DATE
ENV GITVERSION_BUILD_DATE=$GITVERSION_BUILD_DATE

RUN npx webpack --mode production

# Stage 2: Build backend
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY src/back/YobaPub.Proxy/YobaPub.Proxy.csproj .
RUN dotnet restore
COPY src/back/YobaPub.Proxy/ .
RUN dotnet publish -c Release -o /app

# Stage 3: Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app .
COPY --from=frontend /src/dist/release wwwroot/
VOLUME ["/logs", "/keys/dataprotection"]
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "YobaPub.Proxy.dll"]
```

> `version.json` для бэка: prepare-скрипт кладёт его в `src/back/YobaPub.Proxy/` перед Docker build, `.csproj` копирует в output → попадает в `/app/`.

---

## 6. Build-env образ (APK + Tizen)

### Концепция

Сборка APK требует Android SDK + JDK, сборка Tizen — Tizen Studio CLI. Установка этих инструментов в каждом CI-прогоне — медленно и хрупко (внешние URL, размер скачивания).

Решение: один Docker-образ с обоими SDK, хранится в `ghcr.io`, обновляется редко по тегу.

### Dockerfile: `docker/build-env.Dockerfile`

```dockerfile
FROM eclipse-temurin:17-jdk-jammy

# ── Common tools ──
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip zip expect libncurses5 gettext \
      ruby libxml2-utils python3 ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# ── Android SDK ──
ENV ANDROID_HOME=/opt/android-sdk
ENV PATH="${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools:${PATH}"

ARG CMDLINE_TOOLS_VERSION=11076708
RUN mkdir -p "${ANDROID_HOME}/cmdline-tools" && \
    curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" \
      -o /tmp/cmdline-tools.zip && \
    unzip -q /tmp/cmdline-tools.zip -d "${ANDROID_HOME}/cmdline-tools" && \
    mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest" && \
    rm /tmp/cmdline-tools.zip

RUN yes | sdkmanager --licenses > /dev/null 2>&1 && \
    sdkmanager "platforms;android-35" "build-tools;35.0.0"

# ── Tizen Studio CLI ──
ENV TIZEN_HOME=/opt/tizen-studio
ENV PATH="${TIZEN_HOME}/tools/ide/bin:${TIZEN_HOME}/tools:${PATH}"

ARG TIZEN_STUDIO_VERSION=6.0
RUN curl -fsSL \
      "https://download.tizen.org/sdk/Installer/tizen-studio_${TIZEN_STUDIO_VERSION}/web-cli_Tizen_Studio_${TIZEN_STUDIO_VERSION}_ubuntu-64.bin" \
      -o /tmp/tizen-installer.bin && \
    chmod +x /tmp/tizen-installer.bin && \
    /tmp/tizen-installer.bin --accept-license ${TIZEN_HOME} && \
    rm /tmp/tizen-installer.bin

WORKDIR /build
```

**Образ**: `ghcr.io/<repo>-build-env:latest`
**Триггер сборки**: тег `build-env-docker-*`
**Размер**: ~2.3 GB (JDK 17 + Android SDK 35 + Tizen Studio CLI 6.0)

### CI: сборка и публикация

Отдельный workflow `.github/workflows/build-env.yml`:

```yaml
name: Build Env Image

on:
  push:
    tags:
      - 'build-env-docker-*'

permissions:
  packages: write

jobs:
  build-env:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & push
        run: |
          IMAGE="ghcr.io/${{ github.repository }}-build-env"
          TAG="${GITHUB_REF_NAME#build-env-docker-}"
          docker build \
            -f docker/build-env.Dockerfile \
            -t "$IMAGE:$TAG" \
            -t "$IMAGE:latest" \
            .
          docker push "$IMAGE" --all-tags
```

**Использование**:
```bash
git tag build-env-docker-1 && git push origin build-env-docker-1
```

При обновлении SDK / Tizen Studio — бампнуть суффикс: `build-env-docker-2`.

---

## 7. Release pipeline: APK + Tizen .wgt

### Триггер

Push тега `v*` (e.g. `v2.0.0`).

### 7.1 APK (Android TV)

#### build.gradle.kts — изменения

Prepare-скрипт генерирует `src/apk/version.properties`. Gradle читает его:

```kotlin
val versionProps = Properties().also { props ->
    val f = rootProject.file("version.properties")
    if (f.exists()) f.inputStream().use { props.load(it) }
}

defaultConfig {
    applicationId = "su.p3o.yobapub"
    minSdk = 21
    targetSdk = 35
    versionCode = (versionProps.getProperty("versionCode"))?.toIntOrNull() ?: 1
    versionName = versionProps.getProperty("versionName") ?: "0.1.0-dev"
    buildConfigField("String", "APP_URL", "\"https://yobapub.3po.su\"")
}
```

Signing config:

```kotlin
signingConfigs {
    create("release") {
        val ksPath = System.getenv("ANDROID_KEYSTORE_PATH")
        if (ksPath != null) {
            storeFile = file(ksPath)
            storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
}

buildTypes {
    release {
        isMinifyEnabled = false
        signingConfig = signingConfigs.getByName("release")
    }
}
```

### 7.2 Tizen .wgt (подписанный)

Author-сертификат генерируется внутри build-env контейнера при каждой сборке. Для side-load самоподписной cert функционально идентичен — важна валидность подписи, а не identity.

Distributor — стандартный из Tizen SDK (пароль `tizenpkcs12passfordsigner`).

Никаких Tizen-секретов в GitHub не нужно.

```bash
# Внутри контейнера:
tizen certificate -a yobapub -p yobapub123 -f author

AUTHOR_P12="/home/builder/tizen-studio-data/keystore/author/author.p12"
DIST_P12="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.p12"
DIST_CA="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-ca.cer"

# profiles.xml с текстовыми паролями (не .pwd файлы — они Windows DPAPI)
cat > profiles.xml <<EOF
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<profiles active="yobapub" version="3.1">
<profile name="yobapub">
<profileitem ca="" distributor="0" key="$AUTHOR_P12" password="yobapub123" rootca=""/>
<profileitem ca="$DIST_CA" distributor="1" key="$DIST_P12" password="tizenpkcs12passfordsigner" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile>
</profiles>
EOF

tizen cli-config "default.profiles.path=..."
tizen package -t wgt -s yobapub -- build
```

### 7.3 GitHub Release

```yaml
- uses: softprops/action-gh-release@v2
  with:
    tag_name: ${{ github.ref_name }}
    name: "v${{ env.SEMVER }}"
    generate_release_notes: true
    files: |
      yobapub-androidtv-${{ env.SEMVER }}.apk
      yobapub-tizen-${{ env.SEMVER }}.wgt
```

---

## 8. Итоговая структура CI

### `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [master]
    tags: ['v*']
  pull_request:

permissions:
  contents: write
  packages: write

jobs:
  # ─── Build & Test (.NET) ───
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: 10.0.x
      - run: dotnet build src/back/yobapub.sln -c Release
      - run: dotnet test src/back/YobaPub.Proxy.Tests/YobaPub.Proxy.Tests.csproj --no-build -c Release

  # ─── Docker publish + deploy (master & tags) ───
  publish:
    if: github.ref == 'refs/heads/master' || startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gittools/actions/gitversion/setup@v4
        with:
          versionSpec: '6.x'

      - id: gitversion
        uses: gittools/actions/gitversion/execute@v4

      # ── Prepare: подставить версию во все компоненты ──
      - name: Prepare version artifacts
        id: prepare
        run: |
          gitversion /output json > version.json
          chmod +x ./scripts/prepare-version.sh
          ./scripts/prepare-version.sh version.json

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & push Docker
        run: |
          IMAGE="ghcr.io/${{ github.repository }}"
          SEMVER="${{ steps.gitversion.outputs.semVer }}"
          SHORT_SHA="${{ steps.gitversion.outputs.shortSha }}"
          docker build \
            --build-arg GITVERSION_SEMVER="$SEMVER" \
            --build-arg GITVERSION_SHA="${{ steps.gitversion.outputs.sha }}" \
            --build-arg GITVERSION_SHORT_SHA="${{ steps.gitversion.outputs.shortSha }}" \
            --build-arg GITVERSION_COMMIT_DATE="${{ steps.gitversion.outputs.commitDate }}" \
            --build-arg GITVERSION_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            -t "$IMAGE:$SEMVER" \
            -t "$IMAGE:sha-$SHORT_SHA" \
            -t "$IMAGE:latest" \
            .
          docker push "$IMAGE" --all-tags

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DEPLOY_HOST }}
          username: ${{ secrets.DEPLOY_USERNAME }}
          password: ${{ secrets.DEPLOY_PASSWORD }}
          script: |
            IMAGE="ghcr.io/${{ github.repository }}:latest"
            CONTAINER_NAME="yobapub-proxy"
            PASSWORD="${{ secrets.DEPLOY_PASSWORD }}"
            run_sudo() { printf '%s\n' "$PASSWORD" | sudo -S -p '' "$@"; }
            run_sudo docker pull "$IMAGE"
            run_sudo docker stop "$CONTAINER_NAME" || true
            run_sudo docker rm "$CONTAINER_NAME" || true
            run_sudo docker run -d \
              --name "$CONTAINER_NAME" \
              --restart unless-stopped \
              -p 127.0.0.1:8080:8080 \
              -v /opt/yobapub/logs:/logs \
              -v /opt/yobapub/keys:/keys/dataprotection \
              -e Admin__Username="${{ secrets.ADMIN_USERNAME }}" \
              -e Admin__Password="${{ secrets.ADMIN_PASSWORD }}" \
              "$IMAGE"
            run_sudo docker system prune -a -f

  # ─── Release: APK + Tizen + GitHub Release (tags only) ───
  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: gittools/actions/gitversion/setup@v4
        with:
          versionSpec: '6.x'

      - id: gitversion
        uses: gittools/actions/gitversion/execute@v4

      # ── Prepare ──
      - name: Prepare version artifacts
        run: |
          gitversion /output json > version.json
          chmod +x ./scripts/prepare-version.sh
          ./scripts/prepare-version.sh version.json
          echo "SEMVER=${{ steps.gitversion.outputs.semVer }}" >> $GITHUB_ENV
          echo "WEIGHTED=${{ steps.gitversion.outputs.weightedPreReleaseNumber }}" >> $GITHUB_ENV

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      # ── APK (build inside apk-env container) ──
      - name: Decode keystore
        run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > /tmp/release.jks

      - name: Build APK
        run: |
          docker run --rm \
            -v "${{ github.workspace }}/src/apk:/build" \
            -v "/tmp/release.jks:/tmp/release.jks:ro" \
            -e ANDROID_KEYSTORE_PATH=/tmp/release.jks \
            -e ANDROID_KEYSTORE_PASSWORD="${{ secrets.ANDROID_KEYSTORE_PASSWORD }}" \
            -e ANDROID_KEY_ALIAS="${{ secrets.ANDROID_KEY_ALIAS }}" \
            -e ANDROID_KEY_PASSWORD="${{ secrets.ANDROID_KEY_PASSWORD }}" \
            -w /build \
            "ghcr.io/${{ github.repository }}-build-env:latest" \
            ./gradlew assembleRelease

      - name: Rename APK
        run: |
          mv src/apk/app/build/outputs/apk/release/app-release.apk \
             "yobapub-androidtv-$SEMVER.apk"

      # ── Tizen (build inside build-env container, cert generated on the fly) ──
      - name: Package Tizen widget
        run: |
          docker run --rm \
            -v "${{ github.workspace }}/src/tizen-widget:/build" \
            -w /build \
            "ghcr.io/${{ github.repository }}-build-env:latest" \
            bash -c '
              AUTHOR_P12="/home/builder/tizen-studio-data/keystore/author/author.p12"
              DIST_P12="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-signer.p12"
              DIST_CA="/opt/tizen-studio/tools/certificate-generator/certificates/distributor/tizen-distributor-ca.cer"

              tizen certificate -a yobapub -p yobapub123 -f author

              mkdir -p /tmp/tizen-profile
              cat > /tmp/tizen-profile/profiles.xml <<XMLEOF
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<profiles active="yobapub" version="3.1">
<profile name="yobapub">
<profileitem ca="" distributor="0" key="$AUTHOR_P12" password="yobapub123" rootca=""/>
<profileitem ca="$DIST_CA" distributor="1" key="$DIST_P12" password="tizenpkcs12passfordsigner" rootca=""/>
<profileitem ca="" distributor="2" key="" password="" rootca=""/>
</profile>
</profiles>
XMLEOF

              tizen cli-config "default.profiles.path=/tmp/tizen-profile/profiles.xml"
              rm -rf build
              cp -r src build
              tizen package -t wgt -s yobapub -- build
              mv build/*.wgt .
            '
          mv src/tizen-widget/*.wgt "yobapub-tizen-$SEMVER.wgt"

      # ── GitHub Release ──
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: "v${{ env.SEMVER }}"
          generate_release_notes: true
          files: |
            yobapub-androidtv-${{ env.SEMVER }}.apk
            yobapub-tizen-${{ env.SEMVER }}.wgt
```

### `.github/workflows/build-env.yml`

См. секцию 6.

---

## 9. Новые/изменяемые файлы

| Файл | Действие | Описание |
|---|---|---|
| `GitVersion.yml` | Создать | Конфигурация GitVersion |
| `scripts/prepare-version.sh` | Создать | Скрипт подстановки версии во все компоненты |
| `docker/build-env.Dockerfile` | Создать | Образ для сборки APK + Tizen (JDK 17 + Android SDK 35 + Tizen CLI) |
| `.github/workflows/ci.yml` | Переписать | build, publish (с prepare), release (build-env container) |
| `.github/workflows/build-env.yml` | Создать | Сборка build-env образа по тегу `build-env-docker-*` |
| `Dockerfile` | Изменить | `ARG APP_VERSION` → `ARG GITVERSION_*` |
| `src/back/YobaPub.Proxy/Program.cs` | Изменить | Добавить `GET /api/about` |
| `src/back/YobaPub.Proxy/YobaPub.Proxy.csproj` | Изменить | `<None Include="version.json" ...>` |
| `src/front/webpack.config.js` | Изменить | Читать `GITVERSION_*`, добавить `__BUILD_SHA__` etc. |
| `src/front/ts/types/globals.d.ts` | Изменить | Добавить `__BUILD_SHA__`, `__BUILD_SHORT_SHA__`, `__BUILD_DATE__` |
| `src/front/ts/pages/settings.ts` | Изменить | Показать `version (shortSha)` |
| `src/apk/app/build.gradle.kts` | Изменить | Динамические version/versionCode + signing |

---

## 10. Секреты GitHub

| Секрет | Статус |
|---|---|
| `DEPLOY_HOST` | Уже есть |
| `DEPLOY_USERNAME` | Уже есть |
| `DEPLOY_PASSWORD` | Уже есть |
| `ADMIN_USERNAME` | Уже есть |
| `ADMIN_PASSWORD` | Уже есть |
| `ANDROID_KEYSTORE_BASE64` | **Добавить** |
| `ANDROID_KEYSTORE_PASSWORD` | **Добавить** |
| `ANDROID_KEY_ALIAS` | **Добавить** |
| `ANDROID_KEY_PASSWORD` | **Добавить** |

> Tizen-секреты не нужны — author cert генерируется в контейнере, distributor стандартный из SDK.

---

## 11. Порядок реализации

1. **Build-env образы** — `docker/apk-env.Dockerfile`, `docker/tizen-env.Dockerfile`, `.github/workflows/build-env.yml`. Push теги `apk-env-docker-1` и `tizen-env-docker-1` для первичной сборки.
2. **GitVersion.yml** — создать конфиг, проверить локально `gitversion` → ожидаемый `2.0.0`
3. **scripts/prepare-version.sh** — скрипт подстановки
4. **Бэкенд** — `GET /api/about` + `.csproj` include `version.json`
5. **Фронт** — webpack DefinePlugin с `GITVERSION_*` + globals.d.ts + settings.ts
6. **Dockerfile** — новые build args
7. **CI: ci.yml** — publish job (GitVersion + prepare + Docker + deploy) + release job (apk-env/tizen-env containers + GitHub Release)
8. **build.gradle.kts** — динамические version + signing
9. **Секреты** — добавить в GitHub (keystore, Tizen certs)
10. **Тестирование** — push `apk-env-docker-1`/`tizen-env-docker-1` → push в master → push тега `v2.0.0` → проверить Docker-тег + GitHub Release
