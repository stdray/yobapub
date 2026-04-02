# YobaPub Android TV Installer (Windows)

Установка приложения YobaPub на Android TV.

## Подготовка телевизора

### Включить режим разработчика

1. **Settings** > **Device Preferences** > **About**
2. Найдите пункт **Build** (или **Build number**) и нажмите на него **7 раз**
3. Появится сообщение "You are now a developer!"

### Включить отладку по сети

1. **Settings** > **Device Preferences** > **Developer Options**
2. Включите **Network debugging** (или **ADB debugging** + **ADB over network**)
3. На экране отобразится IP-адрес и порт (например `192.168.1.139:45967`)

> На некоторых моделях пункт называется иначе: "Wireless debugging", "Debug over Wi-Fi", "ADB debugging over network". Суть одна — разрешить подключение по сети.

## Установка

1. Скачайте [`androidtv-from-windows.zip`](https://github.com/stdray/yobapub/raw/master/installers/androidtv-from-windows.zip) и распакуйте в любую папку
2. Запустите `install.bat`
3. Скрипт предложит скачать последнюю версию автоматически (или положите `.apk` из [Releases](https://github.com/stdray/yobapub/releases) в папку заранее)

## Что делает скрипт

1. Сканирует локальную сеть на порт 5555 (стандартный ADB)
2. Подключается к найденным устройствам
3. Предлагает выбрать устройство
4. Скачивает или использует локальный `.apk`
5. Устанавливает и запускает

## Обновление

Запустите `install.bat` снова — скрипт предложит скачать последнюю версию. Обновление ставится поверх, данные сохраняются.

## Устранение проблем

| Проблема | Решение |
|----------|---------|
| Устройство не найдено | Убедитесь что включена отладка по сети (см. выше) |
| "unauthorized" при подключении | На ТВ появится запрос "Allow USB debugging?" — нажмите "Allow" |
| Подключение отклонено | ТВ и компьютер должны быть в одной сети |
| Устройство найдено, но порт другой | Введите адрес вручную (IP:PORT) когда скрипт предложит |

## Структура папки

```
androidtv-from-windows/
  install.bat         -- запуск установки
  install.ps1         -- скрипт установки
  README.md           -- эта инструкция
  adb.exe             -- Android Debug Bridge
  AdbWinApi.dll       -- зависимости adb
  AdbWinUsbApi.dll
  libwinpthread-1.dll
  *.apk               -- приложение (скачивается автоматически или из Releases)
```
