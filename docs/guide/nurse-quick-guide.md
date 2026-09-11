# ER Navigator: the one-page guide for navigators

**MRN only, never a name.** No patient name, no national ID, no Iqama number and no date of
birth goes into this app, anywhere, ever. Not in a case, not in an update, not in a note. The MRN
is how a patient is identified here, and every free-text box on the screen says so under it.

This is the whole app in one page. Print it and keep it at the navigator desk.

---

## 1. Signing in, on your own phone

Open **nav.towardpcc.com**. Type your username and your password and tap **Sign in**. The eye
button beside the password shows what you typed, which is useful when the ward is dark and you
are typing fast.

Tick **Remember this device** only on a phone that is yours and nobody else's. On the desk
computer, leave it unticked.

Put it on your home screen so it opens like an app, without the browser bar:

- **iPhone:** in Safari, tap the Share button, then **Add to Home Screen**.
- **Android:** the board itself offers an **Install** button the first time. Tap it. If you missed
  it, use the browser menu and **Install app** or **Add to Home screen**.

Five wrong passwords in a minute from the same place, and the app stops answering for a minute.
Ten wrong passwords, and the account is locked for fifteen minutes. Wait, or ask for a reset.

## 2. Change your password the first time

When an admin creates your account, or resets it, you are given a temporary password that is read
out to you once. The first time you sign in with it, the app takes you straight to **Your account**
and keeps taking you there until you set your own. Nothing else opens until you do.

You can reach the same screen at any time: tap the circle with your initials at the top right, then
**Account and password**.

Set a password only you know. The audit log names your account for everything done with it, so a
password that is still being passed around the ward desk is a problem for you, not for the app.

## 3. Opening a case

Tap **+ New case** (the button floating at the bottom right of the board; on a laptop it sits at
the foot of the left-hand rail, just above the block with your name in it).

- **MRN (digits only).** Digits, nothing else. No name in this box and no name anywhere else.
- **Registration time.** This is where the clock starts, so it has to be the real registration
  time, not the time you are typing. The quick chips set it to **4h**, **6h**, **8h** or **12h**
  ago, and **-30m** and **+30m** nudge it. The line under the field shows what you have just
  claimed: "Waiting 6h 20m so far". If that number looks wrong, the time is wrong.
- **Navigator** is you, filled in from your sign-in. **Shift** is Morning, Evening or Night.

Then the chips. Tap to choose, tap the chosen chip again to clear it:

- **CTAS** 1 to 5, if you know it.
- **Working diagnosis (optional):** one line, what the patient came in with, for example "chest
  pain, for admission". It is a clinical line, not an identifier, so no name goes in it either.
- **ED area:** where the patient is.
- **Payer:** Government, Insured or Self-pay.

**Where is the delay?** Tap every stage that applies, then the reasons under each one. The stages
are Registration, Triage, Resus room, Exam room, Investigations, Referral / consulted team,
Disposition decision, Admission process, Discharge process, and Administrative / coordination. If
you tap more than one reason, choose the **primary** one underneath: that is the one the reports
count. If nothing on the list fits, use the stage's **Other** chip and describe it in one line.

Some reasons open more of the form. A referral reason asks for the department or consulted team; an
investigation reason opens the investigation times (ordered, collected, received, resulted, or the
imaging chain with its preliminary read).

The button at the foot of the screen says **Open case**. It stays dead until the MRN is in and at
least one delay reason is chosen, and the grey line under it says which one is missing.

If a **Check these times** panel appears, read it. It means two times are out of order, for
example a result before its order. You can still save; the out-of-order pair is simply left out of
the averages.

## 4. Updates and delay reasons as the shift moves

Open the case from the board. On a phone, the strip of chips under the header jumps you straight
down the page: **Delay**, **Teams**, **Tests**, **Times**, **Updates**, **Resolve**. Use it. A
worked case is several screens long.

- **Updates:** type what changed in the "What changed?" box and tap **Add**. Pick an **Action
  taken** chip if the update describes one; leave it blank if it does not. An update cannot be
  edited or deleted once added, so read it before you tap Add. MRN only, no names.
- **Delay reasons:** add or drop stages and reasons as the picture changes, and move the primary
  one if the real hold-up has moved. Then **Save changes**.
- If someone else saved the case while you had it open, the app says "This case was changed by
  <name> at <time>. Reload to continue." Nothing you typed is sent. Reload, look at what changed,
  and put your part in again. The app never merges two people's edits by guessing.
- At 4, 6, 12 and 24 hours the case raises a threshold alert. From 6 hours it also emails every
  charge nurse and admin who has an email address in the app. A case that is past a threshold shows a band at the
  top with an **Acknowledge** button. Acknowledging says a person has seen it; it does not stop the
  clock.

## 5. Resolving a case

In the **Resolve** section: choose the **Final disposition** (Admitted, Discharged home,
Discharged DAMA, Transferred to another facility, Left without being seen, Deceased, Referred to
UCC, or Other), the ward if the patient was admitted, whether instructions were given and family
engaged, and the time the patient **left the ED**. Add a resolution note if there is anything worth
saying. Then **Mark resolved**.

The stay is measured from registration to the time the patient left, so the departure time matters
as much as the registration time did.

A case opened twice by mistake is **voided**, not deleted, and only a charge nurse or an admin can
do it. Nothing in this app is ever deleted.

## 6. The board, and the handover sheet

The board lists open cases longest-waiting first. The line under the title reads, for example,
"14 open · 5 past 6h · 2 past 12h", and under that "Updated 21:40". If it says "Not updating since
21:12. Check the connection.", the rows on your screen are stale.

- **Search MRN** finds one patient.
- **Open / Resolved / All** switch what you are looking at.
- **Filter** narrows the board by stage, reason, ED area, department, CTAS, payer or disposition.

At shift change: tap the circle with your initials, then **Print handover**. The sheet is the same
rows in the same order, in plain black and white, with a line saying if the board was filtered or
searched when you printed it. Print it, hand it over, and it is the record of that moment.

## 7. What the colours mean

The pill beside each case is the time that patient has been in the ED.

| Colour | Time in the ED | What it is asking of you |
| --- | --- | --- |
| Green | under 4 hours | Nothing yet. It is on the board because a delay was flagged. |
| Amber | 4 hours and over | First threshold. Make sure the delay reason on the case is still the real one. |
| Red | 6 hours and over | The charge nurse and the medical admin on-call are emailed from here. Add an update saying where it stands. |
| Purple | 12 hours and over | Escalate by voice as well. Half a day in the ED needs a name attached to the next step. |
| Near-black | 24 hours and over | A full day. It belongs in the handover out loud, every shift, until it is resolved. |

Grey means the app has no time for that row.

## 8. On a shared computer

Sign out when you walk away: the circle with your initials, then **Log out**. Do not tick
"Remember this device" on a shared machine. Your session ends on its own after 12 hours of no use,
but that is not a substitute for signing out.

## 9. When the site is down

It happens for about a minute on the days a change is deployed, and it can happen for longer.

1. **Keep working the patient.** The app records the delay; it does not treat it.
2. **The WhatsApp group stays the fallback.** Post what you would have entered, using the MRN only,
   exactly as you would in the app.
3. **Enter it afterwards** with the real registration and event times, not the time you typed it
   in. That is what the quick chips and the time nudges are for.
4. **Tell the second-line contact below** if it is still down after a few minutes, and say what you
   see: a blank page, an error, or a screen that will not sign in.

If the app says "ER Navigator was updated" and reloads itself, that is a deploy. Anything you had
typed on that screen and not saved is gone; anything you saved is safe.

## 10. Who to contact

| For | Who | How |
| --- | --- | --- |
| A forgotten password, a locked account, a new starter | *(name to be filled in)* | *(extension / WhatsApp)* |
| Wrong data on a case, a case that will not save, the site down | *(name to be filled in)* | *(extension / WhatsApp)* |

Ahmed fills these two rows in before the guide is handed out. A guide that ends "ask someone" is a
guide nobody uses.

---

*Written 11 September 2026 for the app as built. If a screen does not match this page, the app is
right and this page is out of date: say so.*
