# Установка SSL-сертификата для yobapub.3po.su

## Предпосылки

- VPS с Ubuntu, nginx уже настроен как reverse proxy для контейнера
- Конфиг nginx: `/etc/nginx/sites-available/yobapub`
- Домен `yobapub.3po.su` направлен на IP сервера
- Docker-контейнер слушает на `127.0.0.1:8080`

## 1. Установить certbot

```bash
sudo apt install certbot python3-certbot-nginx
```

## 2. Получить сертификат

```bash
sudo certbot --nginx -d yobapub.3po.su
```

Certbot автоматически:
- получит сертификат от Let's Encrypt
- допишет в конфиг nginx (`/etc/nginx/sites-available/yobapub`) блок `listen 443 ssl`, пути к сертификатам и редирект 80 -> 443
- перезагрузит nginx

## 3. Проверить

```bash
# Конфиг nginx после certbot
cat /etc/nginx/sites-available/yobapub

# Статус сертификата
sudo certbot certificates
```

Сайт должен открываться по `https://yobapub.3po.su`.

## 4. Автопродление

Certbot настраивает автопродление через systemd timer. Проверить:

```bash
sudo systemctl status certbot.timer
```

Сертификаты Let's Encrypt действуют 90 дней, certbot продлевает их автоматически.

## 5. CI workflow

В `.github/workflows/ci.yml` порт контейнера привязан к localhost, чтобы трафик шёл только через nginx:

```yaml
-p 127.0.0.1:8080:8080
```
