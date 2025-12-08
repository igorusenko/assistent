# 🚀 Развертывание на VPS

Полная инструкция по развертыванию голосового ассистента на VPS сервере (Hostinger и другие).

## 📋 Требования

- VPS сервер с Ubuntu/Debian (рекомендуется Ubuntu 20.04+)
- Доступ по SSH к серверу
- OpenAI API ключ (будет передан отдельно)
- Доменное имя (опционально, но рекомендуется)

---

## ⚡ Быстрый старт (5 минут)

### 1. Подключение к серверу
```bash
ssh root@your-server-ip
```

### 2. Установка Node.js (если не установлен)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Должно быть v20.x.x или выше
```

### 3. Загрузка проекта
```bash
cd /var/www
git clone <repository-url> voice-assistant
cd voice-assistant
# или загрузите файлы через SCP/FTP
```

### 4. Настройка переменных окружения
```bash
cp env.template .env
nano .env
```

**Вставьте переданные вам ключи:**
```env
OPENAI_API_KEY=sk-...  # Вставьте переданный API ключ
PORT=3000
NODE_ENV=production
AUTOMATION_ID=...     # Если был передан (опционально)
```

Сохраните (Ctrl+O, Enter, Ctrl+X).

### 5. Установка и запуск
```bash
npm install --production
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # выполните выведенную команду
```

### 6. Настройка Nginx
```bash
sudo apt-get install -y nginx
sudo cp nginx.conf /etc/nginx/sites-available/voice-assistant
sudo nano /etc/nginx/sites-available/voice-assistant  # замените example.com на ваш домен/IP
sudo ln -s /etc/nginx/sites-available/voice-assistant /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 7. Firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 8. Проверка
```bash
pm2 status
curl http://localhost:3000/health
```

Откройте в браузере: `http://your-server-ip` или `http://your-domain.com`

---

## 📖 Подробная инструкция

### Шаг 1: Подключение к серверу

```bash
ssh root@your-server-ip
# или
ssh username@your-server-ip
```

### Шаг 2: Установка Node.js

Проверьте, установлен ли Node.js:
```bash
node -v
```

Если не установлен:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Должно быть v20.x.x или выше
npm -v
```

### Шаг 3: Загрузка проекта

**Вариант A: Через Git (рекомендуется)**
```bash
sudo apt-get update
sudo apt-get install -y git
cd /var/www
git clone your-repository-url voice-assistant
cd voice-assistant
```

**Вариант B: Через SCP**
На вашем компьютере:
```bash
tar -czf voice-assistant.tar.gz --exclude='node_modules' --exclude='.env' .
scp voice-assistant.tar.gz root@your-server-ip:/var/www/
```

На сервере:
```bash
cd /var/www
tar -xzf voice-assistant.tar.gz
cd voice-assistant
```

### Шаг 4: Настройка переменных окружения

```bash
cp env.template .env
nano .env
```

Добавьте:
```env
OPENAI_API_KEY=sk-ваш-ключ-здесь
PORT=3000
NODE_ENV=production
AUTOMATION_ID=ваш-id-здесь  # опционально
```

**Важно:** Ключи должны быть переданы вам отдельно через безопасный канал. Вставьте их в файл `.env`.

### Шаг 5: Установка зависимостей

```bash
npm install --production
```

### Шаг 6: Установка и настройка PM2

PM2 обеспечивает автозапуск и перезапуск при сбоях.

```bash
# Установка PM2
sudo npm install -g pm2

# Запуск приложения
pm2 start ecosystem.config.js

# Сохранение конфигурации
pm2 save

# Настройка автозапуска (выполните команду, которую выведет PM2)
pm2 startup
```

### Шаг 7: Настройка Nginx

```bash
# Установка Nginx
sudo apt-get update
sudo apt-get install -y nginx

# Копирование конфигурации
sudo cp nginx.conf /etc/nginx/sites-available/voice-assistant

# Редактирование (замените example.com на ваш домен или IP)
sudo nano /etc/nginx/sites-available/voice-assistant

# Активация
sudo ln -s /etc/nginx/sites-available/voice-assistant /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# Проверка и перезагрузка
sudo nginx -t
sudo systemctl reload nginx
```

### Шаг 8: Настройка Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
sudo ufw status
```

### Шаг 9: Настройка SSL (HTTPS) - рекомендуется

```bash
# Установка Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Получение сертификата
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Проверка автопродления
sudo certbot renew --dry-run
```

### Шаг 10: Проверка работы

```bash
# Статус приложения
pm2 status

# Логи
pm2 logs voice-assistant

# Health check
curl http://localhost:3000/health
```

Откройте в браузере: `http://your-server-ip` или `https://your-domain.com`

---

## 🔑 Информация о ключах

### Какие ключи нужны

1. **OPENAI_API_KEY** (обязательно) - ключ для доступа к OpenAI API
   - Формат: `sk-...` (начинается с `sk-`)
   - Должен быть передан вам отдельно через безопасный канал

2. **AUTOMATION_ID** (опционально) - ID автоматизации из n8n

### Как вставить ключи

1. Создайте файл `.env` из шаблона:
   ```bash
   cp env.template .env
   ```

2. Откройте файл:
   ```bash
   nano .env
   ```

3. Вставьте переданные ключи вместо `your-openai-api-key-here`

4. Сохраните (Ctrl+O, Enter, Ctrl+X)

---

## 🔧 Полезные команды

### Управление приложением
```bash
pm2 status              # Статус
pm2 logs voice-assistant # Логи
pm2 restart voice-assistant # Перезапуск
pm2 stop voice-assistant   # Остановка
pm2 monit               # Мониторинг
```

### Обновление приложения
```bash
pm2 stop voice-assistant
git pull  # или загрузите новые файлы
npm install --production
pm2 restart voice-assistant
```

### Использование скрипта автоматического развертывания
```bash
chmod +x deploy.sh
bash deploy.sh
```

---

## ❓ Решение проблем

### Приложение не запускается
```bash
# Проверьте логи
pm2 logs voice-assistant --lines 50

# Проверьте переменные окружения
cat .env

# Проверьте, что порт свободен
sudo netstat -tulpn | grep 3000
```

### WebSocket не работает
- Убедитесь, что в Nginx правильно настроены заголовки для WebSocket
- Проверьте логи: `sudo tail -f /var/log/nginx/error.log`
- Убедитесь, что используется правильный протокол (ws:// или wss://)

### Порт занят
```bash
sudo netstat -tulpn | grep 3000
# Если порт занят, измените PORT в .env
```

### Проблемы с правами доступа
```bash
sudo chown -R $USER:$USER /var/www/voice-assistant
```

### Проверка конфигурации Nginx
```bash
sudo nginx -t
```

---

## 📤 Передача проекта другому лицу

Если вы передаете проект другому человеку:

1. **Передайте все файлы проекта** (кроме `node_modules/` и `.env`)
2. **Передайте ключи отдельно** через безопасный канал (Telegram, Signal и т.д.)
3. **Сообщите получателю**, что нужно:
   - Прочитать этот файл (DEPLOY.md)
   - Создать `.env` файл из `env.template`
   - Вставить переданные ключи

**Пример сообщения для получателя:**
```
Привет! 

Передаю тебе готовое приложение голосового ассистента.

📦 Что делать:
1. Прочитай файл DEPLOY.md - там пошаговая инструкция
2. Ключи передам отдельно в следующем сообщении
3. Следуй инструкциям в DEPLOY.md

🔑 Ключи отправлю отдельно!
```

---

## 📊 Мониторинг

```bash
# PM2 мониторинг
pm2 monit

# Системные ресурсы
htop
# или
top
```

---

## 💾 Резервное копирование

Рекомендуется настроить регулярное резервное копирование:

```bash
# Создайте скрипт бэкапа
nano /root/backup-voice-assistant.sh
```

Добавьте:
```bash
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf "$BACKUP_DIR/voice-assistant-$DATE.tar.gz" /var/www/voice-assistant
```

Настройте cron:
```bash
crontab -e
# Добавьте: 0 2 * * * /root/backup-voice-assistant.sh
```

---

**Готово! Ваш голосовой ассистент должен быть доступен на вашем сервере. 🎉**
