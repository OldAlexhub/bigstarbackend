import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import cookieParser from "cookie-parser"
import helmet from "helmet"
import connectTodb from "./db/connectTodb.js"
import authRoutes from "./routes/authRoutes.js"
import divisionsRoutes from "./routes/divisionsRoutes.js"
import routesRoutes from "./routes/routesRoutes.js"
import operatorsRoutes from "./routes/operatorsRoutes.js"
import vehiclesRoutes from "./routes/vehiclesRoutes.js"
import runCutsRoutes from "./routes/runCutsRoutes.js"
import runCutDaysRoutes from "./routes/runCutDaysRoutes.js"
import trackerRoutes from "./routes/trackerRoutes.js"
import settingsRoutes from "./routes/settingsRoutes.js"
import dailyIssuesRoutes from "./routes/dailyIssuesRoutes.js"
import reportsRoutes from "./routes/reportsRoutes.js"
import providersRoutes from "./routes/providersRoutes.js"
import networkSuccessRoutes from "./routes/networkSuccessRoutes.js"
import emailTemplatesRoutes from "./routes/emailTemplatesRoutes.js"
import homeSummaryRoutes from "./routes/homeSummaryRoutes.js"
import eltReportingRoutes from "./routes/eltReportingRoutes.js"
import leaderboardRoutes from "./routes/leaderboardRoutes.js"
import usersRoutes from "./routes/usersRoutes.js"
import { scheduleWeeklyFinalization } from "./jobs/finalizeWeeks.js"
import { scheduleAssignmentRollover } from "./jobs/rolloverAssignments.js"
import {fileURLToPath} from "url"
import path from "path"


dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000


// origin: true reflects whichever site made the request (needed alongside
// credentials: true — a literal "*" can't be combined with cookies). Set
// CLIENT_URL to lock this down to just the deployed client's real origin.
app.use(cors({ origin: process.env.CLIENT_URL || true, credentials: true }))
// Helmet's default Cross-Origin-Resource-Policy ("same-origin") blocks the
// browser from reading fetch responses from a different origin — needed
// here since the client is deployed separately from this API.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }))
app.use(cookieParser())
// express.json()'s default 100kb limit is easily exceeded by a large KPI
// import confirmation (hundreds/thousands of rows in one JSON body) - 10mb
// matches the file-upload size limit already allowed for the raw workbook.
app.use(express.json({ limit: "10mb" }))

app.use("/api/auth", authRoutes)
app.use("/api/divisions", divisionsRoutes)
app.use("/api/routes", routesRoutes)
app.use("/api/operators", operatorsRoutes)
app.use("/api/vehicles", vehiclesRoutes)
app.use("/api/run-cuts", runCutsRoutes)
app.use("/api/run-cut-days", runCutDaysRoutes)
app.use("/api/tracker", trackerRoutes)
app.use("/api/settings", settingsRoutes)
app.use("/api/daily-issues", dailyIssuesRoutes)
app.use("/api/reports", reportsRoutes)
app.use("/api/providers", providersRoutes)
app.use("/api/network-success/email-templates", emailTemplatesRoutes)
app.use("/api/network-success", networkSuccessRoutes)
app.use("/api/home-summary", homeSummaryRoutes)
app.use("/api/elt-reporting", eltReportingRoutes)
app.use("/api/leaderboard", leaderboardRoutes)
app.use("/api/users", usersRoutes)

const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "public")
app.use(express.static(publicDirectory))

app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(publicDirectory, "index.html"), (err) => {
    if (err) res.status(404).end()
  })
})

connectTodb().then(() => {
    scheduleWeeklyFinalization()
    scheduleAssignmentRollover()
})


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
