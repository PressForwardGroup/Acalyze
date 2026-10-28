# Acalyze roadmap

Updated at the end of every step. Numbers (#) are from the original to-do list.

## Finance (main focus)
| Step | What | Status |
|---|---|---|
| 1 | Foundation: roles, modules, approvals framework, audit log, security | Built |
| 2 | Fee structure, drafts and publishing, "fees cleared" tag, statements | Built |
| 3 | Payments: reversals, credits, oldest charges first, vote head and term report | Built |
| 4 | M-Pesa: Paybill settings, pay from the app, automatic matching, attention queue | Built. **Needs sandbox testing** |
| 5 | Waivers, bursaries, refunds, defaulters and overdue ageing, daily cash-up, cleared tag for class teachers | Built |
| 6 | School accounts: budget, expenses, vouchers, cashbook, bank statement import | Not started |
| 7 | Public-school extras: capitation, procurement, stores, board approvals | Not started |

## Leftovers from the steps, and where they go
- Instalment plans and late-fee rules: not built. Decide if wanted.
- Carrying balances into the next term or year, write-offs: **year-end step** (with #11 student status and promotion), after step 5.
- Parent choosing which term to pay for: decide after M-Pesa testing.
- "Hold report cards until fees are cleared" (optional setting): not built. Decide if wanted.
- Content-security policy, audit of marks changes: security and academic phases.

## Core product (after finance)
#10 make the privacy page true (delete-a-school tool, staff-access record, booking cleanup, terms, contact), #11 student status and promotion, #13 school details on documents, #14 subject list per student, #15 exam weighting and cumulative positions, #18 security hardening (rest), #22 parents compare with class average, #23 Gradebook features, #26 CBC comments, #24 Kiswahili, #25 offline marks entry, #28 attendance on report cards, #29 calendar reminders and export, #16 WhatsApp share button for results, #20 predictive analytics, #38 timetable, exam timetable, duty roster, library, transport, boarding, discipline, health. Also: support contact for teachers, unique Meet link per booking, phone alerts for bookings.

## Last (as decided)
- Bulk SMS (#2) and everything that needs it: #3 WhatsApp, #4 two-factor, SMS fee reminders, absence alerts, result alerts.
- Reach and proof (schools, testimonials, demo video), published prices (#36), App Store and Play Store (#8), and the real database / paid hosting: #5 Neon, paid Render, #31 real-database test pass, #32 backups and CI, #33 database and load tests, #34 phone and accessibility check.

## Yours (not code)
#35 legal and data protection, #36 business registration and prices, #37 guides and support channel. The Render settings, the Ndovo login, domains, logo, Google Search Console.

## Won't do
Student learning product (#21 quizzes for students).

## Not yet run against the real thing
Steps 1 to 5 pass automated checks and were viewed in a browser with simulated data. None has run on the real server and database, and step 4 has not talked to Safaricom. Test lists are in ROLES.md, FEES.md, PAYMENTS.md, MPESA.md and ADJUSTMENTS.md.
