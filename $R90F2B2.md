# 💰 Expense Tracker

A small expense tracker. People create an account, save their expenses, and see reports
(this month, all time, by category, by month). Admins get a panel to see all users and manage them.

- **Frontend:** plain HTML, CSS and JavaScript (`frontend/`)
- **Backend:** Node.js + Express (`backend/`)
- **Database:** PostgreSQL

```
backendTest/
├── backend/
│   ├── server.js        ← starts the API (and serves the frontend locally)
│   ├── db.js            ← database connection, creates tables on startup
│   ├── schema.sql       ← the tables (users, expenses)
│   ├── middleware.js    ← login check + admin check
│   ├── routes/          ← auth, expenses, reports, admin
│   └── .env.example     ← copy to .env and fill in
├── frontend/
│   ├── index.html       ← log in / create account
│   ├── dashboard.html   ← add expenses, list, reports
│   ├── admin.html       ← admin panel
│   ├── style.css
│   └── js/config.js     ← ⚠️ put your Render URL here before deploying
└── netlify.toml         ← tells Netlify to publish the frontend folder
```

---

## 1. Run it on your computer

You need **Node.js 20+**. For the database you don't have to install PostgreSQL on Windows:
just create the free Neon database (step 2A below) and use its connection string locally too.

```bash
cd backend
npm install
copy .env.example .env      # on Mac/Linux: cp .env.example .env
```

Open `backend/.env` and fill in:

| Variable       | What to put                                                                 |
|----------------|-----------------------------------------------------------------------------|
| `DATABASE_URL` | Your Neon connection string                                                 |
| `JWT_SECRET`   | A long random string (see the command below)                                |
| `ADMIN_EMAIL`  | Your email. The account registered with this email becomes **admin**        |
| `FRONTEND_URL` | Leave empty locally                                                         |

Generate a good `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Start it:

```bash
npm run dev
```

Open **http://localhost:3000** and create an account with your `ADMIN_EMAIL`. You'll land on the admin panel.
The tables are created automatically the first time the server starts.

---

## 2. Put it online (free): Neon + Render + Netlify

Do the steps **in this order**, because each one needs a URL from the one before.

### Step 0: Push the project to GitHub

Render and Netlify both deploy from GitHub. Create an **empty** repo on github.com, then:

```bash
git add .
git commit -m "Expense tracker app"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

(`.env` is in `.gitignore`, so your secrets are **not** uploaded. Keep it that way.)

### Step A: Database on Neon

1. Sign up at **https://neon.tech** and create a project (pick the region closest to your users).
2. On the project dashboard click **Connect** and copy the connection string.
   It looks like `postgresql://neondb_owner:...@ep-xxxx-pooler.....neon.tech/neondb?sslmode=require`
3. (Optional) Change `sslmode=require` to `sslmode=verify-full`. It works the same and hides a harmless warning in the logs.

That's it. You don't need to create tables; the backend does that on startup.

### Step B: Backend on Render

1. Sign up at **https://render.com** with your GitHub account.
2. **New → Web Service** → pick your repo.
3. Fill in:
   | Setting            | Value          |
   |--------------------|----------------|
   | Root Directory     | `backend`      |
   | Runtime            | Node           |
   | Build Command      | `npm install`  |
   | Start Command      | `npm start`    |
   | Instance Type      | Free           |
4. Under **Environment Variables** add:
   - `DATABASE_URL`: the Neon connection string
   - `JWT_SECRET`: a long random string (a **different** one from your local one is fine)
   - `ADMIN_EMAIL`: your email
   - `FRONTEND_URL`: leave it out for now (you'll add it in step D)
5. Click **Create Web Service** and wait for the deploy to show **Live**.
6. Copy your URL, e.g. `https://expense-api-xyz.onrender.com`.
   Check it works: open `https://expense-api-xyz.onrender.com/api/health` and you should see `{"ok":true}`.

### Step C: Frontend on Netlify

1. Open `frontend/js/config.js` and replace the placeholder with your Render URL (no `/` at the end):
   ```js
   const PRODUCTION_API_URL = 'https://expense-api-xyz.onrender.com';
   ```
   You can also change `CURRENCY` there (e.g. `'EUR'`, `'AFN'`, `'PKR'`).
2. Commit and push:
   ```bash
   git commit -am "Set production API URL"
   git push
   ```
3. Sign up at **https://netlify.com** → **Add new site → Import an existing project** → GitHub → pick your repo.
   Netlify reads `netlify.toml` and publishes the `frontend` folder automatically. Leave the build command empty.
4. Deploy. You'll get a URL like `https://your-site.netlify.app`. You can rename it under **Site configuration → Change site name**.

### Step D: Lock the backend to your site

Back in Render → your service → **Environment** → add:

- `FRONTEND_URL` = `https://your-site.netlify.app`

Save (Render redeploys). Now only your Netlify site can call the API from a browser.

**Done!** Open your Netlify URL, register with your `ADMIN_EMAIL`, and share the link.

---

## 3. Things to know about the free hosting

- **Render free servers go to sleep** after ~15 minutes with no visitors. The next visitor waits
  ~30–60 seconds while it wakes up. The app shows a "Waking up the server…" message so people know to wait.
  To avoid this, upgrade the Render service to the paid **Starter** plan (about $7/month).
- **Don't use Render's free PostgreSQL** for this. Free Render databases expire after 30 days. Neon's free plan doesn't.
- **Neon free** also sleeps when idle, but it wakes up in under a second, so you won't notice.
- Every `git push` redeploys automatically on both Render and Netlify.

### Is there a simpler or better setup?

Your plan (**Netlify + Render + Neon**) is a good free setup. Two alternatives:

- **Simpler: everything on Render.** The backend already serves the `frontend` folder, so you can skip
  Netlify completely. Do steps A and B, put the Render URL in `config.js` and push, then open your Render URL.
  One site, one URL, no `FRONTEND_URL` needed.
- **No sleeping, still cheap:** keep Neon and Netlify, and put the backend on a paid Render Starter instance
  (or Railway, which bills by usage at around $5/month). Do this once real people depend on the app.

---

## 4. Making someone an admin

- Whoever registers with `ADMIN_EMAIL` becomes admin automatically. If that account already exists,
  it is promoted the next time the server starts.
- After that, admins can promote or demote other users from the **Admin panel**.

## API reference

| Method | Path                      | Who    | What                                  |
|--------|---------------------------|--------|---------------------------------------|
| POST   | `/api/auth/register`      | anyone | `{ name, email, password }`           |
| POST   | `/api/auth/login`         | anyone | `{ email, password }` → token         |
| GET    | `/api/auth/me`            | user   | current user                          |
| GET    | `/api/expenses?month=YYYY-MM` | user | your expenses (month optional)      |
| POST   | `/api/expenses`           | user   | `{ amount, category, description, spent_on }` |
| DELETE | `/api/expenses/:id`       | user   | delete one of your expenses           |
| GET    | `/api/reports`            | user   | totals, by category, by month         |
| GET    | `/api/admin/stats`        | admin  | number of users / expenses / total    |
| GET    | `/api/admin/users`        | admin  | all users with their totals           |
| PATCH  | `/api/admin/users/:id`    | admin  | `{ role: "user" \| "admin" }`         |
| DELETE | `/api/admin/users/:id`    | admin  | delete user and their expenses        |
| GET    | `/api/admin/expenses`     | admin  | 50 most recently added expenses       |

Logged-in requests send `Authorization: Bearer <token>`.
