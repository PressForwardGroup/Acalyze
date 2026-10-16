import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { authRouter } from './routes/auth.js';
import { registrationRouter } from './routes/registration.js';
import { organizationsRouter } from './routes/organizations.js';
import { analyticsRouter } from './routes/analytics.js';
import { settingsRouter } from './routes/settings.js';
import { chatRouter } from './routes/chat.js';
import { parentsRouter } from './routes/parents.js';
import { centersRouter } from './routes/centers.js';
import { classesRouter } from './routes/classes.js';
import { subjectsRouter } from './routes/subjects.js';
import { teachersRouter } from './routes/teachers.js';
import { studentsRouter } from './routes/students.js';
import { examsRouter } from './routes/exams.js';
import { marksRouter } from './routes/marks.js';
import { remarksRouter } from './routes/remarks.js';
import { resultsRouter } from './routes/results.js';
import { editRequestsRouter } from './routes/editRequests.js';
import { reportCardRouter } from './routes/reportCard.js';
import { studentTransferRouter } from './routes/studentTransfer.js';
import { passwordRequestsRouter } from './routes/passwordRequests.js';
import { ensureSchema } from './lib/autoMigrate.js';
import { rateLimit } from './lib/rateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Safety net: an error thrown inside an async Express route handler that
// isn't wrapped (see lib/asyncHandler.js — every route below is wrapped, but
// this is a second line of defense for anything that slips through, now or
// in a future change) becomes an "unhandled rejection." In Node, that can
// terminate the entire process by default — turning one bad request into
// total downtime (a 502) for every user until the platform restarts it.
// Logging it here instead keeps the process, and everyone else's requests,
// alive.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (recovered, process kept running):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (recovered, process kept running):', err);
});

const app = express();
app.disable('x-powered-by');
// Baseline security headers (the API uses Bearer tokens, not cookies, so CORS stays open).
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Strict-Transport-Security': 'max-age=15552000; includeSubDomains', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  next();
});
app.use(cors());
app.use(express.json({ limit: '3mb' }));   // whole-school marks CSVs and logos exceed the 100kb default

app.get('/health', (req, res) => res.json({ ok: true }));

app.set('trust proxy', 1); // behind Render's proxy, so req.ip is the real client
app.use('/auth/login', rateLimit({ max: 10 }));
app.use('/auth/set-password', rateLimit({ max: 10 }));
app.use('/password-requests/forgot', rateLimit({ max: 5 }));
app.use('/register-school', rateLimit({ windowMs: 3_600_000, max: 5, message: 'Too many registrations from this connection. Please try again later.' }));
app.use('/auth', authRouter);
app.use('/register-school', registrationRouter);
app.use('/organizations', organizationsRouter);
app.use('/analytics', analyticsRouter);
app.use('/school-settings', settingsRouter);
app.use('/chat', chatRouter);
app.use('/parents', parentsRouter);
app.use('/centers', centersRouter);
app.use('/classes', classesRouter);
app.use('/subjects', subjectsRouter);
app.use('/teachers', teachersRouter);
app.use('/students', studentsRouter);
app.use('/exams', examsRouter);
app.use('/marks', marksRouter);
app.use('/remarks', remarksRouter);
app.use('/results', resultsRouter);
app.use('/edit-requests', editRequestsRouter);
app.use('/report-card', reportCardRouter);
app.use('/student-transfer', studentTransferRouter);
app.use('/password-requests', passwordRequestsRouter);

// The frontend (public/index.html) is served by this same app — one service,
// one URL, no separate static host and no CORS setup needed. API routes are
// registered above this, so they always take priority over the static file.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Centralized error handler — keeps internal error detail out of API responses.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large. Try splitting it into smaller files.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read.' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3001;

// Set up the database automatically before accepting any requests — see
// lib/autoMigrate.js. This is what lets the app work on Render's free plan,
// which has no Shell access to run migration/seed commands by hand.
ensureSchema()
  .then(() => {
    app.listen(port, () => console.log(`Acalyze backend listening on :${port}`));
  })
  .catch((err) => {
    console.error('Failed to set up the database on startup:', err);
    process.exit(1);
  });
