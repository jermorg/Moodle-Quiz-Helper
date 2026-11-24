<div align="center">
  <h1>Moodle Quiz Helper — Sync Server</h1>
  <p>
    <b>Легкий REST API сервер на Node.js та вбудованому SQLite для синхронізації бази питань і статистики тестів між користувачами розширення Moodle Quiz Helper.</b>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 22+">
    <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express">
    <img src="https://img.shields.io/badge/SQLite-node:sqlite-003b57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite">
    <img src="https://img.shields.io/badge/Docker-Alpine-2496ed?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
  </p>

  <p>
    <a href="https://github.com/jermorg/Moodle-Quiz-Helper">← Повернутися до клієнтського розширення</a>
  </p>
</div>

---

## 📑 Зміст

- [Як працює сервер](#architecture)
- [Змінні середовища](#env)
- [Запуск через Docker (рекомендовано)](#docker)
- [Запуск через Node.js](#nodejs)
- [Налаштування HTTPS (Mixed Content)](#https)
- [Специфікація REST API](#api)

---

<a id="architecture"></a>
## ⚙️ Як працює сервер

Сервер (`index.js`) побудований на базі **Express** та вбудованого модуля **`node:sqlite`**, тому не потребує встановлення зовнішніх баз даних. Усі дані зберігаються в одному файлі `data/quiz.db`.

- **Авторизація:** усі запити захищені статичним токеном у заголовку `Authorization: Bearer <API_TOKEN>`.
- **Транзакційне злиття (`POST /api/sync`):** під час прийому нових питань сервер об'єднує масиви `correct_answers` та `wrong_answers` із наявними записами. Якщо варіант підтверджено як правильний, він автоматично видаляється зі списку помилкових (`wrong_answers`).
- **Прив'язка до тестів:** таблиця `test_questions` пов'язує питання з конкретним `test_id` курсу, що дозволяє розширенню показувати прогрес проходження кожного тесту (`total` та `solved`).
- **Інкрементальна віддача (`GET /api/db`):** клієнти завантажують лише записи, у яких `updated_at > since`, що мінімізує навантаження на мережу.

---

<a id="env"></a>
## 🔑 Змінні середовища

Перед запуском необхідно задати змінні середовища (через файл `.env` або параметри контейнера):

| Змінна | Обов'язкова | За замовчуванням | Опис |
| :--- | :---: | :---: | :--- |
| `API_TOKEN` | **Так** | — | Секретний ключ доступу. Якщо не заданий, сервер завершить роботу при старті. |
| `PORT` | Ні | `3000` | Порт, на якому сервер приймає HTTP-запити. |

Приклад файлу `.env`:

```env
PORT=3000
API_TOKEN=ваш_складний_секретний_токен
```

Згенерувати надійний токен можна командою:
```bash
openssl rand -hex 24
```

---

<a id="docker"></a>
## 🐳 Запуск через Docker (рекомендовано)

У репозиторії є готовий `Dockerfile` на базі `node:22-alpine`. База даних створюється в `/app/data/quiz.db`, тому обов'язково примонтуйте локальну директорію `./data`, щоб дані зберігалися після перезапуску контейнера.

### 1. Через `docker compose`

Створіть файл `docker-compose.yml`:

```yaml
services:
  moodle-sync:
    build: .
    container_name: moodle-sync-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - API_TOKEN=ваш_складний_секретний_токен
    volumes:
      - ./data:/app/data
```

Зберіть і запустіть контейнер:

```bash
docker compose up -d --build
```

### 2. Через `docker run`

```bash
docker build -t moodle-sync-server .

docker run -d \
  --name moodle-sync-server \
  --restart unless-stopped \
  -p 3000:3000 \
  -e API_TOKEN="ваш_складний_секретний_токен" \
  -v $(pwd)/data:/app/data \
  moodle-sync-server
```

---

<a id="nodejs"></a>
## 🟢 Запуск через Node.js

> ⚠️ **Вимога до версії:** оскільки використовується вбудований модуль `node:sqlite`, необхідний **Node.js 22.5+** (рекомендовано Node.js 22 LTS).

1. Клонуйте гілку `server`:
   ```bash
   git clone -b server https://github.com/jermorg/Moodle-Quiz-Helper.git moodle-sync-server
   cd moodle-sync-server
   ```
2. Встановіть залежності:
   ```bash
   npm install --omit=dev
   ```
3. Створіть файл `.env` із `API_TOKEN` та запустіть сервер:
   ```bash
   node index.js
   ```
   У консолі з'явиться повідомлення:
   `Moodle Sync API (CommonJS) listening on port 3000`

---

<a id="https"></a>
## 🔒 Налаштування HTTPS (важливо для браузера)

Оскільки сам портал Moodle працює по захищеному протоколу `https://`, браузер заблокує запити розширення до сервера, якщо вказати звичайну HTTP-адресу за IP (політика *Mixed Content*).

- **Локально** (`http://localhost:3000` або `http://127.0.0.1:3000`) — працює напряму без додаткових налаштувань.
- **Для публічного доступу групи** — закрийте порт `3000` через reverse-proxy з SSL-сертифікатом:
  - **Cloudflare Tunnel (`cloudflared`)** — найшвидший спосіб отримати `https://` домен без відкриття портів на роутері чи VPS;
  - **Nginx Proxy Manager** або **Caddy** — автоматичний випуск сертифікатів Let's Encrypt.

---

<a id="api"></a>
## 🔌 Специфікація REST API

Усі запити повинні містити заголовок `Authorization: Bearer <API_TOKEN>`.

| Метод | Ендпоінт | Параметри / Тіло запиту | Відповідь |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/ping` | — | `{ "status": "ok", "totalQuestions": 150, "totalTests": 12 }` |
| `GET` | `/api/db` | `?since=<timestamp>` | `{ "serverTime": 1730000000000, "items": [...], "tests": {...} }` |
| `POST` | `/api/sync` | `{ "testId": "123", "items": [...] }` | `{ "status": "ok", "merged": 10, "total": 155, "tests": {...} }` |
