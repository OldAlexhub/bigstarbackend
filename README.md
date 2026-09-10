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
MONGO_URL=
JWT_SECRET=
JWT_EXPIRES_IN=
PORT=3001
CLIENT_URL=http://localhost:3000
```

`CLIENT_URL` is optional in the current implementation but recommended outside local development so credentialed CORS requests are limited to the deployed client origin.

Start the server:

```powershell
npm start
```

The client development configuration expects the API at `http://localhost:3001`.

## Validation and maintenance

```powershell
npm test
npm run migrate:daily-issue-dedup
```

Run the migration command only when upgrading data created before the unique daily-issue identity constraint. It is safe to rerun and keeps the preferred issue record when duplicates exist.

## Technology

- Node.js with ES modules
- Express 5
- MongoDB / Mongoose 9
- JWT stored in an HTTP-only cookie
- PDFKit and SheetJS for report exports

---

Developed by **Mohamed Gad** for **Big Star Transit LLC**.
