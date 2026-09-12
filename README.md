# BigStar Operations Server

The Express and MongoDB backend for Big Star Transit's operations platform. It provides cookie-based authentication, role/section/division authorization, standing and dated run-cut management, issue synchronization, Vision/Ecolane Network Success ingestion, operational reporting and exports, audit logging, and scheduled assignment/weekly-summary jobs.

For the current operational specification, see [BigStar-Operations-Guide.md](../BigStar-Operations-Guide.md).

## Local development

Install dependencies:

```powershell
npm ci
```

Create a local `.env` file with the required values:

```dotenv
NODE_ENV=development
MONGO_URL=mongodb://127.0.0.1:27017/bigstar?replicaSet=rs0
JWT_SECRET=replace-with-at-least-32-random-characters
JWT_EXPIRES_IN=8h
PORT=3001
CLIENT_URL=http://localhost:3000
TRUST_PROXY=false
```

Use [`.env.example`](.env.example) as the complete template. `MONGO_URL` and `JWT_SECRET` are always required, and production requires a signing secret of at least 32 characters. MongoDB must be a replica set or sharded cluster because critical state transitions use transactions; startup rejects a standalone server. `CLIENT_URL` and an explicit `TRUST_PROXY` value are also required when `NODE_ENV=production`; use `false` when there is no reverse proxy, otherwise set the known proxy hop count or subnet so the shared MongoDB login limiter receives the correct client IP. Startup fails before binding a port when required configuration is missing or invalid.

Start the server:

```powershell
npm start
```

Use `npm run dev` for nodemon-based local development. The application connects to MongoDB before accepting HTTP traffic. `GET /api/health` reports readiness and returns `503` whenever the database is disconnected. `SIGINT` and `SIGTERM` stop scheduled jobs, drain the HTTP server, and disconnect MongoDB.

The client development configuration expects the API at `http://localhost:3001`.

## Validation and maintenance

```powershell
npm test
npm run migrate:daily-issue-dedup
npm run maintenance:create-admin
npm run maintenance:verify-production
```

Run the migration command only when upgrading data created before the unique daily-issue identity constraint. It is safe to rerun and keeps the preferred issue record when duplicates exist.

Run the production preflight against the target database before deployment. It is read-only and verifies transaction support plus the absence of duplicate deployed standby coverage that would prevent the protective unique index from being installed.

Historical scripts are organized and documented under [`scripts/`](scripts/README.md). The administrator maintenance command requires `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `ADMIN_NAME`; no credential is stored in source. Multi-document consistency risks identified during the production review are documented in [`docs/transaction-candidates.md`](docs/transaction-candidates.md).

## Technology

- Node.js with ES modules
- Express 5
- MongoDB / Mongoose 9
- JWT stored in an HTTP-only cookie
- PDFKit and the patched SheetJS 0.20.3 distribution for spreadsheet import/export

---

Developed by **Mohamed Gad** for **Big Star Transit LLC**.
