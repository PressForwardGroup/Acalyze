# M-Pesa (step 4)

Each school uses **its own Paybill**. Parents pay into the school's account; Acalyze never holds the money. Acalyze only learns about each payment and records it against the right student.

## What it does
- **Pay from the app:** the parent taps **Pay with M-Pesa**, gets a prompt on their phone, enters their PIN, and the payment is recorded with a receipt by itself.
- **Pay straight to the Paybill:** if a parent pays the Paybill with the admission number as the account, the payment is matched to the student automatically ("rvs 001", "RVS-001" and "rvs001" are the same number).
- **Needs your attention** (M-Pesa tab): payments that match no student, or where a parent says "I already paid", wait for the finance officer to **Assign** them to a student or **Set aside** with a reason.
- **Never twice:** the same M-Pesa code can never be recorded twice, even if Safaricom sends it twice, or it was already typed in by hand.

## Setting it up on the server (once, by you)
1. Make a secret and add it in Render as `MPESA_SECRET_KEY`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   It encrypts every school's keys in the database. Keep it safe. If it is lost, schools must enter their keys again.
2. Make sure `APP_URL` is set to the app's address (https). Safaricom posts payment messages there.
3. In **Platform admin -> Schools -> Modules**, tick **M-Pesa payments** for the school.

## Setting it up for a school (principal or finance officer)
Needs the school's own Paybill with Daraja access from Safaricom (a bank Paybill such as a bank's shared number cannot be used).
1. Fees & payments -> **M-Pesa** tab. Enter the Paybill number, choose **Test (sandbox)** first, and paste the consumer key, consumer secret and passkey from the Daraja account. Tick **switched on**, **Save**.
2. **Test my keys**: Safaricom should accept them.
3. **Register payment addresses**: tells Safaricom where to send payments made straight to the Paybill.
4. Add the Paybill and "account = admission number" under **How parents pay** (Charges tab).
5. Try a test payment. When it works, switch the mode to **Live** with the live keys and register the addresses again.

## Please test before real use
I built this from Safaricom's published Daraja design and tested the parts that can be tested without Safaricom (request building, reading messages, matching, security, double-posting). It has **not** been run against Safaricom's servers. Test in sandbox first and expect small fixes.

Things to check with Safaricom:
- STK payment prompts must be enabled for the Paybill, and its Daraja go-live must be approved.
- **Registering the payment addresses a second time in live mode may be refused** until Safaricom clears the old registration. Treat **Make new secret addresses** as a last resort.
- The account reference on a payment prompt is limited to 12 characters. Longer admission numbers are cut for the prompt, but the payment still goes to the right student.

## Safety
- Keys are encrypted before they are stored, are never shown again after saving, and never appear in the audit log.
- The addresses Safaricom posts to contain a secret only your Paybill knows. Anything else gets "not found".
- Everything that arrives is stored first, so nothing is lost. Anything odd is left for the finance officer.
