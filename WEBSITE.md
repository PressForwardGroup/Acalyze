# The website and bookings

The public website is a **separate project** (`acalyze-website`, its own folder and GitHub repo, hosted on its own address).
This app is where people **log in**; the website is where people **find you, book a demo and register**.

```
www.acalyze.com        the website  (home, book a demo, privacy policy)
app.acalyze.com        this app     (log in, register, everything after)
```

- The website's **Log in** and **Register your school** buttons open this app.
- This app's sign-in and register pages link back to the website (set `SITE_URL`, see below).
- The website's booking calendar talks to **this app's server**, which stores the bookings and sends the alerts.

## When someone books
1. They get an email saying the request was received.
2. **You get an email** (to `NOTIFY_EMAIL`) and a red number on **Bookings** in the platform admin menu. If you have Acalyze open, a notice also pops up within a minute.
3. Open **Bookings**, then **Confirm** or **Decline**. Confirming emails them the details: your Google Meet link, the office address, or "we will call you".
4. Nobody can book a time that is already taken.

## Settings on this app (Render -> Environment, all optional)
- `SITE_URL`: your website's address (for example `https://www.acalyze.com`). Turns on the links back to the website and the "choose another time" link in decline emails.
- `NOTIFY_EMAIL`: where booking alerts go (falls back to `PLATFORM_ADMIN_EMAIL`).
- `MEET_LINK`: your Google Meet link, sent when a video booking is confirmed.
- `OFFICE_ADDRESS`: sent for face-to-face meetings.
- `BOOKING_DAYS`, `BOOKING_START_HOUR`, `BOOKING_END_HOUR`, `BOOKING_SLOT_MINUTES`, `BOOKING_LEAD_HOURS`, `BOOKING_MAX_DAYS`: your availability. Defaults: Monday to Friday, 9:00 to 17:00 East Africa Time, 30-minute slots, 4 hours notice, 30 days ahead.
- `APP_URL`: this app's own address (used in emails).
- Emails need `RESEND_API_KEY` and `MAIL_FROM`. As far as I know, Resend's test sender can only email your own address, which is enough for your alerts. Emails to the people who book need a verified domain in Resend.

Old links such as `yourapp.com/#/login` still work: the app's front address sends people on to `/app/`.
