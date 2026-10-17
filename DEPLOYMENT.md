# Deploying Acalyze on Render

1. Put this folder in a GitHub repository.
2. In Render: **New > Blueprint**, choose the repo. It reads `render.yaml` and creates the web service and a Postgres database.
3. When asked, fill in: `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` (this is YOUR sign-in), `PAYBILL_NUMBER`, `SUPPORT_EMAIL` and `SUPPORT_PHONE` (shown to school admins as Acalyze support), `APP_URL`.
   Leave `SEED_DEMO` as `false` for production (set it to `true` for one deploy if you want a demo school to try).
4. Deploy. On first start the app builds the whole database and creates your platform admin. Open the URL and sign in with your email and password.

## Before real schools rely on it

- **The free Render database is for trying things out.** Free databases are limited in lifetime and have no real backup guarantees. Check Render's current free-tier terms,
  and move to a paid database with automatic backups before a school enters real marks.
- Use a long `PLATFORM_ADMIN_PASSWORD` and change it after the first sign-in (profile menu, Password).
- Add a custom domain in Render (e.g. `app.acalyze.com`) and set `APP_URL` to it.
- Optional: set `RESEND_API_KEY` and `MAIL_FROM` so password-reset temporary passwords are also emailed.

## First-run checklist (about 15 minutes)

This has been tested in logic (83 automated tests, including a check that every screen calls a real server route) but **not yet in a real browser against a real database**. Please walk through it once:

1. Sign in as platform admin. Overview loads with no errors.
2. Open the home page in a private window, **Register your school** with a test school.
3. Back as platform admin: **Registrations > Approve**. Copy the sign-in message it shows.
4. **Schools > Plan & price**: choose a plan and a price.
5. Sign in (private window) as the new school admin. Add a class ("Form 3 West"), subjects (use "Add the standard 8-4-4 subjects"), a teacher, and students (try the CSV import with a parent phone).
6. Create an exam, assign the teacher to a class+subject, sign in as the teacher and enter marks.
7. As admin: **Results & analytics**, then **Report cards**: print one, download a PDF, and try the "printable file".
8. Publish the exam, then sign in as a parent (phone + temporary password). Choose a password, view the card, try messages (needs the Full Suite plan).
9. As platform admin: **Suspend** the school, and confirm its users are locked out. Reactivate.
10. Switch the browser to dark mode (or use the toggle) and check each page reads well.
11. **Excel import:** as a school admin open *Import from Excel*, choose your marks workbook, fix any flagged "out of" values, press *Check*, then *Import now*. Open *Students*, *Results & analytics* and *Report cards* and look at the data.
12. **Students to watch:** with two exams entered (the demo school has them), open *Students to watch* and read a few reasons. Do they make sense?
13. **Attendance:** sign in as a teacher, take a register, then as the parent see it under the child's report card (needs the Analytics + Parents plan or above).
14. **Fees (Full Suite):** add a charge, record a payment, print the receipt, then check the parent's view shows the balance.
15. **Calendar:** add an event, mark one "staff only", and confirm the parent can't see that one.
16. **Your data:** Settings > *Download Excel* and open the file.

Optional emails: set `RESEND_API_KEY` and `MAIL_FROM` and a new school's sign-in details are emailed when you approve it, and registrations send you a notice (to `PLATFORM_ADMIN_EMAIL`).

Tell me anything that looks wrong and what you saw on screen.
