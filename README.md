# GreenFuel — Centralized Invoicing & Sales Management System

## Project Structure

```
greenfuel-project/
├── backend/
│   ├── config.php              ← DB connection, session, helpers
│   └── routes/
│       ├── auth.php            ← Login / logout / session
│       ├── transactions.php    ← POS save, list, verify
│       ├── analytics.php       ← Totals, rankings, forecasts, insights
│       ├── branches.php        ← Branch list, fuel prices
│       ├── shifts.php          ← Shift records, verification
│       └── reports.php         ← Weekly report generation & submission
├── frontend/
│   ├── index.html              ← Main app (all pages)
│   ├── css/
│   │   └── style.css           ← All styles
│   └── js/
│       ├── api.js              ← API call helpers
│       └── app.js              ← All page logic & charts
└── database/
    └── schema.sql              ← Run once to create all tables
```

---

## Setup with XAMPP (Local Development)

### Step 1 — Install XAMPP
Download from https://www.apachefriends.org and install.

### Step 2 — Start Services
Open XAMPP Control Panel and click **Start** on:
- Apache
- MySQL

### Step 3 — Copy Project Files
Copy the entire `greenfuel-project` folder into:
```
C:\xampp\htdocs\greenfuel\
```
So the structure looks like:
```
C:\xampp\htdocs\greenfuel\
    backend\
    frontend\
    database\
```

### Step 4 — Create Database
1. Open your browser and go to: http://localhost/phpmyadmin
2. Click **SQL** tab at the top
3. Copy and paste the contents of `database/schema.sql`
4. Click **Go** to run it

This creates the `greenfuel` database with all tables and sample data.

### Step 5 — Open the App
Go to: **http://localhost/greenfuel/frontend/**

---

## Seed Accounts

The schema creates sample owner, manager, and cashier accounts with bcrypt-hashed passwords.
For security, default passwords are not published in this README. Set or reset passwords through the database migration/reset flow before using the system in a demo or production server.

---

## Database Configuration

Use environment variables for deployed servers:

```bash
GREENFUEL_ENV=production
GREENFUEL_DB_HOST=localhost
GREENFUEL_DB_NAME=greenfuel
GREENFUEL_DB_USER=greenfuel_app
GREENFUEL_DB_PASS=change-this-password
GREENFUEL_ALLOWED_ORIGINS=https://your-domain.example
```

Local XAMPP fallback values still exist for development only. In production, the app refuses to run with `root` or a blank database password.

---

## How It Works

### Frontend → Backend Flow
1. User opens `frontend/index.html` in browser
2. JS calls PHP API via `fetch()` in `js/api.js`
3. PHP routes in `backend/routes/` handle each request
4. PHP queries MySQL and returns JSON
5. JS renders the response into the page

### API Base URL
The `api.js` file sets:
```js
const BASE_URL = '../backend/routes';
```
This works when files are served from XAMPP at `localhost/greenfuel/frontend/`.

If you deploy to a web host, update `BASE_URL` to match your domain:
```js
const BASE_URL = 'https://yourdomain.com/greenfuel/backend/routes';
```

---

## Deployment to Web Hosting (Hostinger, InfinityFree, etc.)

1. Upload the entire `greenfuel-project` folder via FTP or File Manager
2. Create a MySQL database in your hosting control panel
3. Import `database/schema.sql` via phpMyAdmin
4. Edit `backend/config.php` with your hosting DB credentials
5. Update `BASE_URL` in `frontend/js/api.js` to your domain
6. Access via your domain URL

---

## Features

- **POS Terminal** — Select fuel, enter liters, auto-compute total, save to DB
- **Manager Dashboard** — Today's stats, 7-day trend chart, fuel mix, recent transactions
- **Records Log** — Filterable transaction history by date and fuel type
- **Weekly Report** — Aggregated weekly sales with fuel breakdown and daily summary
- **Shift Verification** — Review and approve/flag pending shift records
- **Owner Dashboard** — Multi-branch trend, network-wide stats, insight banner
- **Branch Comparison** — Revenue rankings with medals, bar chart, detailed table
- **Demand Forecasting** — 3-day moving average per branch, stock suggestions
- **Analytics** — Demand alerts, fuel revenue chart, daily volume trend, AI insights
- **Branch Management** — All branch stats and rankings

---

## Tech Stack

- **Frontend** — Vanilla HTML, CSS, JavaScript (no framework needed)
- **Charts** — Chart.js 4.4.1 (loaded from CDN)
- **Backend** — PHP 8+ with PDO
- **Database** — MySQL 5.7+ / MariaDB 10+
- **Session** — PHP native sessions

---

## PHP Version Requirement

PHP 8.0 or higher (uses `match`, named args, union types).
XAMPP 8.x includes PHP 8 by default.
