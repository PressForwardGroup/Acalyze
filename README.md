# Acalyze

Exam results, report cards and analytics for many separate schools on one platform. Supports 8-4-4 (Forms) and CBC (Grades).

## Who signs in

| Role | Signs in with | Can |
|---|---|---|
| **Platform admin** (you) | email | approve school registrations, set each school's plan and price per student, invoice, suspend a school, open a school to help them |
| **School admin** | email | run their own school: classes, subjects, teachers, students, exams, marks upload, analytics, report cards, parents, approvals, subscription |
| **Teacher** | email | enter marks for assigned class+subject pairs; class teachers see class results and write comments; message parents |
| **Parent** | phone number | view their own children's published report cards and trend; message their children's teachers |

Students never sign in.

## How schools are kept apart

Every school is an `organization`. Every table that holds school data carries `organization_id`, and every query filters by the
`organizationId` inside the signed token, never by anything the browser sends. A school can't see, move or message into another school.
Suspending a school locks all its users out within ~30 seconds.

## Plans (what a school pays for is what it gets)

| Plan | Includes |
|---|---|
| Analytics | grading, report cards, admin dashboard |
| Analytics + Parents | + parent accounts and report cards |
| Full Suite | + parent–teacher messaging (+ SMS alerts when set up) |
| Custom | everything; you set the price |

You pick the plan and price per student for each school (Platform → Schools → Plan & price). The server enforces it: a school without
"Parents" can't create parent accounts or sign them in; without "Full Suite" there is no chat. A school with no plan set yet gets everything.

## Grading

- **8-4-4:** 12 grades (E to A). Sciences (Maths, Biology, Physics, Chemistry) use stricter boundaries. Mathematics + the best six other subjects count (at least 7 subjects needed, else "W").
- **CBC:** 8 levels (BE2 to EE1). Exactly 7 subjects: Maths, Kiswahili, English, CSL + 3 others.
- Position is across the whole grade (all streams), with stream position alongside; ties share a place.
- Marks can be entered out of any number (e.g. 30); a scale check warns when a paper looks mis-scaled.

## Report cards

Two templates, chosen per school: **Classic** (the printed Kenyan form) and **Modern** (on-screen). Print a class, a whole grade, or filter by
overall grade. Save as PDF (up to 60 at a time), print, or download a printable file.

## Run it locally

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL etc.  (needs a Postgres database)
npm run dev              # first boot builds the schema and creates your platform admin
npm test                 # 27 tests, no database needed
```

Open http://localhost:3001 . With `SEED_DEMO=true` you also get a demo school (`admin@demo.acalyze.app` / `Demo@2026`).

## Layout

```
db/schema.sql        the whole database
src/lib/             grading.js (the rules), results.js (rankings), analytics.js, plans.js, scope.js (tenant scoping)
src/routes/          one file per area of the API
public/              the web app: index.html, css/app.css, js/ (api, ui + charts, views/*)
test/                tests: grading, results, report cards, SQL-vs-schema, rate limiting
```

## Not built yet

- **Daraja (automatic M-Pesa confirmation):** payments are confirmed by hand ("Mark paid"). The invoice model is ready for it.
- **SMS alerts:** needs an SMS provider. Parent password help goes through the school admin until then.
- The database schema is new and **not compatible with the old MOHI database**; use a fresh, empty one.
