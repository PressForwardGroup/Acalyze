# Roles, modules, approvals and the audit log

## Who can do what
| Account | Sees | Can change |
|---|---|---|
| **School admin / deputy** | Everything academic | Everything academic. **No finance.** |
| **Principal / head / owner** | Everything academic (read only) and all finance | Finance, staff accounts, approvals |
| **Finance officer** (bursar) | Fees and payments only (plus class and student lists for the fee screens) | Fees and payments. Voiding a payment needs the principal's approval |
| Teachers, parents | As before | As before |

- Staff accounts are made under **Staff accounts** (school admin or principal). A new person signs in with the temporary password and must choose their own.
- Accounts are switched off, never deleted, so records keep their author. A school always keeps at least one working school admin.
- **Until a school creates a principal or finance account, its school admin keeps access to Fees.** Once one exists, Fees disappears from the school admin's menu and the server refuses it.
- Opening a school as Acalyze support is recorded in that school's audit log.

## Modules
The platform admin picks what each school gets: **Platform admin -> Schools -> Modules**. Tick "Choose modules myself", or leave it unticked to follow the school's plan, as before. A school never sees a module that is switched off. "Coming soon" modules can be ticked now, so the choice is recorded.

## Approvals
Money actions that need a second person go to **Approvals** (principal) or **My requests** (finance officer). The person who asked cannot approve their own request. Today the only action wired in is voiding a payment; more (waivers, refunds, vouchers) plug into the same system. If a school has no principal account, the finance officer acts directly.

## Audit log
**Audit log** shows who did what and when: staff changes, passwords, sign-outs, settings, fee charges and payments, approvals, and support access. Money entries are visible to the principal only.

## Security
- Passwords: at least 8 characters, with a letter and a number.
- **Sign out of all other devices**: in the Password dialog.
- Resetting someone's password, switching an account off or changing its type signs them out everywhere.

## Database
`db/migrations/004_roles_audit_approvals.sql` runs by itself when the app starts. It adds columns to `admins` and `organizations` and creates `audit_log`, `approval_requests` and `session_resets`. Existing accounts keep working as school admins.
