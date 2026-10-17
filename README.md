# Acalyze

Exam results, report cards, analytics and school life for many separate schools on one platform. Supports 8-4-4 (Forms) and CBC (Grades).

## Who signs in

| Role | Signs in with | Can |
|---|---|---|
| **Platform admin** (you) | email | approve school registrations, set each school's plan and price per student, invoice, suspend a school, open a school to help them |
| **School admin** | email | run their own school: setup, Excel import, marks, analytics, report cards, parents, fees, attendance, calendar, approvals, subscription |
| **Teacher** | email | enter marks and take attendance for their classes; class teachers see class results and write comments; message parents |
| **Parent** | phone number | view their own children's report cards, trend, attendance and fees (with receipts); message teachers |

Students never sign in.

## How schools are kept apart

Every school is an `organization`. Every table that holds school data carries `organization_id`, and every query filters by the
`organizationId` inside the signed token, never by anything the browser sends. A school can't see, move or message into another school.
Suspending a school locks all its users out within ~30 seconds.

## Plans (what a school pays for is what it gets)

| Plan | Includes |
|---|---|
| Analytics | grading, report cards, admin dashboard, Excel import/export, early-warning list, calendar |
| Analytics + Parents | + parent accounts and report cards, attendance registers (parents see their child's) |
| Full Suite | + parent-teacher messaging, school fees with receipts (+ SMS alerts when set up) |
| Custom | everything; you set the price |

You pick the plan and price per student for each school (Platform > Schools > Plan & price). The server enforces it. A school with no plan
set yet gets everything. The rules live in one file: `src/lib/plans.js`.

## What's in it

- **Grading:** 8-4-4 (12 grades; Mathematics + best six count; at least 7 subjects, else "W") and CBC (8 levels; exactly 7 subjects). Position is across the whole grade, with stream position alongside; ties share a place. Marks can be out of any number; a scale check warns when a paper looks mis-scaled.
- **Excel import:** read a school's existing marks workbook (one sheet per class) in the browser; preview and check before anything is saved. Classes, subjects and students are created or matched; stream spellings are tidied.
- **Report cards:** Classic (the printed Kenyan form) or Modern (on-screen), chosen per school. Print a class, a whole grade, or filter by overall grade. Save as PDF (up to 60 at a time), print, or download a printable file.
- **Analytics:** podium, class comparison, subject champions, grade distribution, most improved and biggest drops, who missed the exam.
- **Students to watch:** an early-warning list from recent exams. Plain rules with the reason spelled out for each student; not a prediction model.
- **Attendance:** one-tap daily registers for teachers; school-wide rates and frequent absentees for admins; parents see their child's record.
- **Fees:** charges per year (for everyone or one grade), payments with auto-numbered receipts, balances, collection rates, CSV export. Parents see their child's statement and can print receipts.
- **Calendar:** terms, exams, holidays, meetings (some can be staff-only).
- **Your data:** a school can download everything it owns as an Excel file.
- **Light and dark themes**, in the brand colours (navy, green, gold, red); contrast is checked by a test.

## Run it locally

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL etc.  (needs a Postgres database)
npm run dev              # first boot builds the schema and creates your platform admin
npm test                 # 83 tests, no database needed
```

Open http://localhost:3001 . With `SEED_DEMO=true` you also get a demo school (`admin@demo.acalyze.app` / `Demo@2026`, parent `0712000010` / `Demo@2026`).

## Layout

```
db/schema.sql        the whole database (version 1); db/migrations/ holds later changes
src/lib/             grading.js (the rules), results.js (rankings), analytics.js, risk.js, importer.js, fees.js, attendance.js, plans.js, scope.js
src/routes/          one file per area of the API
public/              the web app: index.html, css/app.css, js/ (api, ui + charts, excel parser, views/*)
test/                tests: grading, results, import, risk, fees/attendance, report cards, theme contrast, SQL-vs-schema, frontend-to-API wiring
```

## Changing the database later

Add a numbered file in `db/migrations/` (e.g. `002_add_something.sql`). It is applied once, in order, inside a transaction on the next start. See `db/migrations/README.md`.

## Not built yet

- **Daraja (automatic M-Pesa confirmation):** subscription payments are confirmed by hand ("Mark paid"). Invoices are ready for it.
- **SMS and WhatsApp alerts:** need a provider account. Until then parent password help goes through the school admin.
- **Teacher timetable, library, transport:** not planned yet.
- The database schema is new and **not compatible with the old MOHI database**; use a fresh, empty one.
