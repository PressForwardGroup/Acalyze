# School accounts (step 6)

Open **School accounts** (principal and finance officer). Switch it on for a school under **Platform admin -> Schools -> Modules -> School accounts**.

## Set up first (Setup tab)
1. **Add your money accounts**: for example "Equity bank account", "Petty cash", "M-Pesa Paybill". Give each an **opening balance** and the date the books start.
2. **Choose which fee payments each account receives** (cash, M-Pesa, bank, cheque, other). A method belongs to one account only. If your Paybill settles into the bank, tick M-Pesa on the bank account. Fee receipts then appear in that account's cashbook by themselves.
3. **Vote heads** (Budget tab) start with a usual set (Operations, Repairs and maintenance, Utilities, Feeding...). Add, rename or switch off as you like.
4. The **principal** sets the **voucher approval limit** (Setup). Vouchers up to that amount are approved straight away; larger ones wait for the principal. 0 means every voucher needs approval.

## Budget
Enter a budget per vote head for the year. Each head shows what is **committed** (vouchers waiting or approved but not paid), **spent** (paid) and **available**. A voucher that would go past a head's budget is flagged **Over budget** so the principal sees it when approving. It is flagged, not blocked. A head with no budget has no limit.

## Payment vouchers
1. The finance officer prepares a voucher: vote head, payee, what it is for, amount, supplier invoice reference. It gets a number such as RVS-PV-000012.
2. If it needs approval it goes to the principal's **Approvals** page. The principal's own vouchers are approved immediately.
3. Once approved, **Pay** it: choose the account, how (cash, cheque, M-Pesa...), the reference and date. Only now does it leave the cashbook and count as spent.
4. **Print** gives a voucher with the amount in words and lines for prepared by, approved by, and the payee's signature.

## Other income
Fees count automatically. Record everything else under **Other income**: grants, donations, hire of the hall or bus, farm or canteen sales, interest. A mistake is **reversed**, never deleted.

## Cashbook
One per account, with money in, money out and a running balance, for any dates. It contains fee receipts (reversed receipts stay, with a matching entry out), refunds, other income, paid vouchers and transfers. **+ Move money between accounts** records banking cash or drawing petty cash. **Print** gives a sheet.

## Bank statement matching
1. Download your statement from the bank as **CSV** and choose it under **Bank statement**. Acalyze finds the Date, Description and Debit/Credit (or Amount) columns by their headings. Lines already imported are skipped, so overlapping statements are safe.
2. Lines are matched automatically to cashbook entries with the same amount within a few days. A receipt number, M-Pesa code or cheque number in the description settles a tie.
3. Anything left can be matched by hand (**Match...**), ignored, or undone.
4. "**In the books but not on the statement**" lists money in transit, such as a cheque not yet cashed.

## Not included yet
Payroll, a supplier ledger and pending-bills report, a trial balance and journals, and everything for public schools (capitation, procurement, stores) which is step 7. Bank statements must be CSV; if your bank's file is not read correctly, send me an example with the names and amounts blanked out.
