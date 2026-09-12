# ER Navigator: the 15-minute demo script

For a hands-on session with ED staff on the hosted demo copy at **https://demo-nav.towardpcc.com**.
Fifteen minutes of presenting, then the room signs in and tries it.

The order below is the order of `tests/demo/demo.spec.ts`, the script the app was actually walked
through at the Phase 11 gate and run again on the Phase 13 case sheet, so nothing here is a screen
that has never been opened.

---

## Before the room arrives

- The demo instance is seeded: four demo accounts and about ten invented patients, backdated so the
  board shows every elapsed colour, a few already resolved, one with a referral. Every resolved one
  carries the times its outcome needs, so **Reopen case** on a seeded row shows the plain
  confirmation and not a list. If the board is empty or stale, re-seed it (`docs/RUNBOOK.md`,
  "Demo instance") before anyone walks in.
- Every page carries the banner **DEMO: invented patients only**. Check it is there. If it is not,
  stop: you may be on the real board.
- Auto-deploy is off on the demo application and nobody pushes to `main` from the start of the
  session until it ends.
- Have the four usernames and the one shared password written where you can read them out, and a
  sheet for collecting names, usernames and work email addresses at the end.
- Your own phone with the site on the home screen, mirrored to the screen if the room has one.

| Username | Who they are | What they can do |
| --- | --- | --- |
| `demo.nav.a` | Demo Navigator A | Open, work and resolve cases |
| `demo.nav.b` | Demo Navigator B | The same |
| `demo.charge` | Demo Charge Nurse | The above, plus review, void, export and the report |
| `demo.lead` | Demo Leadership (read-only) | Look at everything, change nothing |

## Say these three lines out loud, early and again at the handoff

1. **Every patient here is invented.** The MRNs all start 999999, which no real record number does,
   and the banner at the top of every screen says so.
2. **This copy sends no email.** The 6-hour alerts are recorded and shown, and the Emailed column
   reads "–". That is correct on the demo, not a fault.
3. **Nothing typed here reaches the real system.** This is a separate site with its own database.
   Type what you like. Nothing here is a patient record.

---

## 0 to 2 min. The problem this replaces

No screen yet. Talk to the room.

> Today a long ED stay is chased in the WhatsApp group. Somebody types an MRN and a sentence.
> The next shift scrolls back to find out what happened. At the end of the month, somebody
> reconstructs the picture by reading the group.
>
> Three things go wrong with that. It is a phone group holding patient identifiers. Nothing is
> counted, so we cannot say where the hours actually go. And a message scrolls away, so a handover
> is somebody's memory of a thread.
>
> This app is the same job with the same words you already use: the same stages, the same delay
> reasons, the same dispositions. It is the group, made countable, and it does not ask you to type
> a patient's name.

Say what this is **not**: not a clinical record, not a replacement for the hospital system, not
something that treats anyone. It records where the time goes.

## 2 to 4 min. Signing in, on a phone

On your phone, mirrored if you can. Go to **demo-nav.towardpcc.com**, sign in as `demo.nav.a`.

Point at, in this order: the banner; the board with its open cases longest-waiting first; the line
under the title, "N open · N past 6h · N past 12h"; and the colour of the pill beside each row.

> This is a phone app that happens to run in the browser. Add it to the home screen once and it
> opens with no browser bar. The Share button, then Add to Home Screen, on an iPhone.

Say that a real account makes you set your own password the first time you sign in, because an
admin reads the first one out to you. The demo accounts skip that step so fifteen people are not
all sent to the same screen in the next ten minutes.

## 4 to 7 min. A navigator opens a case

Still as `demo.nav.a`. Tap **+ New case**.

- Type an MRN. Say it while you type: **MRN only, never a name.** Point at the hint under every
  free-text box on this page.
- Set the **registration time**. Tap the **6h ago** chip. Point at the line that updates:
  "Waiting 6h 00m so far". Say: the clock starts at registration, not at the moment we noticed, so
  this field is the one that has to be honest.
- Chips: **CTAS**, the **ED area**, and **Shift**. Point at the shift: it is the one box on this
  page that fills itself in, from the shift this navigator last recorded, which is why it is on
  the front of the sheet and not behind a tap.
- **Patient journey**, the block under it, is the one to slow down on. Say: this is the stay in
  the order it happens, and it is the same block on a new case and on a worked one. Nothing in it
  is required to open the case.
- **Where is the delay?** Tap a stage, tap a reason under it. Tap a second reason and show that the
  app now asks which is the **primary** one. Say: that is the field the reports count.
- Open **More to record** and show what is behind it: the working diagnosis, the payer, pain
  management and case management. Say: the four things nobody fills at the bedside, and the
  section opens itself on any case that already carries one of them.
- Tap **Open case** at the foot of the screen.
- Add one update in the Updates box, with an action tag, and tap **Add**.

Two things to say while you do it: an update cannot be edited or deleted afterwards, and if
somebody else saves the case while you have it open the app refuses your save and tells you who
changed it, rather than quietly overwriting one of you.

## 7 to 9 min. The board at its busiest

Go back to the board.

- **The colours.** Green under 4 hours, amber from 4, red from 6, purple from 12, near-black from
  24. Point at one of each on the seeded rows.
- **The counts line**, again, now that the colours mean something.
- Tap a row's **Summary** and show the one-screen picture of a case, with a **Copy** button that
  puts it on the clipboard as text for pasting into a message.
- **Filter**: narrow to one stage, for example Admission process, and show the count line change.
- **The handover sheet.** Open the menu at the top right and tap **Print handover**. Show the print
  preview: the same rows in the same order, plain black and white, with a line saying the board was
  filtered when it was printed. Say: that is shift change, on paper, without anyone retyping it.

## 9 to 11 min. Working a case through to Resolve

Open one of the seeded open cases.

- Point at the **jump strip** under the header: Delay, Teams, Tests, Times, Updates, Resolve. A
  worked case is several screens long and this is how a nurse gets down it in one tap. **Times**
  lands on **Patient journey**.
- In **Patient journey**, tap **Now** on Triage. Watch the row collapse to one line with an
  **Edit** button while the tint moves to the next empty step. Say: the sheet is always pointing
  at the one thing the case is waiting for, and nothing recorded is ever lost by collapsing.
- Show **Check these times** if you can make it appear by putting a result before its order. Say:
  it warns, it does not block, and the pair is left out of the averages.
- Now the part worth the room's attention. Choose a **Final disposition** and show that **Mark
  resolved** is dead, with the grey line under it naming what is missing: "Before resolving,
  enter: ...". Show the **needed to resolve** tags that appear on those steps up in the journey
  block, fill them, and watch the button come alive. Say: the app asks for the times that outcome
  actually needs and hides the ones it cannot have.
- In **Resolve case**, point at **Left ED**: it is shown here but not typed here, with a **Now**
  button and a line saying it is recorded in Patient journey above. Add a resolution note and tap
  **Mark resolved**.
- Show **Reopen case** on the resolved row. It asks twice, and the line above it names the times
  the case would owe before it could be closed again. Say: reopening is allowed, and it is never
  a surprise.
- Say that nothing here is ever deleted. A case opened by mistake is voided with a reason, by a
  charge nurse, and stays on the record.

## 11 to 13 min. The charge nurse reviews and exports

Sign out and sign in as `demo.charge` (or use a second phone, which is more convincing).

- The **Resolved** tab, and **Mark reviewed** on one of the seeded resolved cases. Say: that is the
  charge nurse's sign-off, and it is in the audit log with a name and a time.
- The **Export** page. Show the date range and the same filter bar as the board, then download the
  workbook. Open it if the room has a laptop: Summary, Cases, Consults, Investigations, Updates,
  plus the Adaa ED KPI and QCH navigator sheet formats.
- Say: every download and every printed report leaves an audit row saying who, when and over what
  range. Nobody pulls a spreadsheet of MRNs invisibly.

## 13 to 15 min. Leadership: the dashboard and the report

Sign in as `demo.lead`, the read-only account. Show that there is no **+ New case** button anywhere.

- **The dashboard.** Take it in this order and do not read every panel: cases past each threshold;
  the Adaa KPIs against their benchmarks; **Where the time goes**, the stay split into the front
  end, the decision, and after the decision; primary delay reason; longest stays; outcomes.
- Tap one drill-down and land on the list of cases behind the number. Say: every figure on this
  page opens into the cases it came from, so nobody has to trust a total.
- Say the honest caveat out loud: **tracked cases, not the whole ED**. This app knows about the
  patients a navigator flagged, not the nine thousand a month the hospital system holds. Any median
  under three cases prints "n<3" instead of a number, because three cases is not an average.
- Finish on **the printed report** at `/report`. Same figures, hospital header, generated-at stamp,
  ready for the weekly meeting. That is the last screen the room sees.

---

## The handoff: the rest of the session is theirs

> Everyone please sign in now. Pick one of these four accounts, the password is the same for all
> of them. Open a case, invent a patient, put a delay on it, add an update. You cannot break
> anything and you cannot reach the real system from here.

While they do it:

- Walk the room. The questions people ask with the phone in their hand are the ones worth writing
  down.
- Pass the sheet round and collect **name, the username they want, role, and their work email
  address**. That is the roster the real accounts get made from, and the email addresses are what
  the 6-hour alerts will go to.
- Note anything anybody had to be shown twice. That is a design defect, not a training gap.

Close with what happens next: real accounts, the reference lists checked against the hospital's own,
the alert recipients agreed, and a date. Do not promise a go-live date the hospital authorisation
has not given you.

---

## Questions to expect, and the honest answers

**"Who can see what I type?"**
Everyone signed in can see the board and the cases. Navigators open, edit and resolve. Charge
nurses also review, void and export. Leadership is read-only. Every change is written to an audit
log with your name and the time, and that log cannot be edited or deleted by anyone, including the
admin.

**"Do I have to type the patient's name?"**
No, and you must not. MRN only. No name, no national ID, no Iqama number, no date of birth, in any
box. Every free-text box says so under it, and the app warns you when it sees a ten-digit run.

**"What if I get the time wrong?"**
Fix it and save. The change is in the audit log with your name, which is the point: the record says
what was corrected and when, rather than pretending it was always right.

**"What happens when the site is down?"**
It goes down for about a minute when a change is deployed, and it can be down longer. Keep working
the patient. The WhatsApp group stays the fallback, MRN only as always, and the case goes in
afterwards with the real times. There is a monitor that pages when the site or the alerts worker
stops.

**"Who gets the emails?"**
From 6 hours, every charge nurse and admin who has an email address in the app. Who that is has
not been agreed yet. On this demo, nothing is sent at all.

**"How long is this kept?"**
Being agreed. The retention period is part of the hospital authorisation conversation and is not
decided yet. Say that plainly rather than guessing: nightly backups exist and are kept 30 days
locally and 14 in the cloud bucket, but how long a case itself is kept is Ahmed's and the
hospital's decision.

**"Is this replacing the WhatsApp group?"**
For tracking long stays, yes, that is the intention. For everything else the group does, no, and
the group stays the fallback when the site is down.

**"Can I use it on the ward computer?"**
Yes. Sign out when you walk away, and do not tick "Remember this device" on a shared machine.

**"What if two of us edit the same case?"**
The second save is refused with a message naming who changed it and when. Nothing is merged by
guesswork and nothing is silently overwritten.

---

*Written 11 September 2026 from `docs/specs/phase12-go-live-readiness.md` and
`tests/demo/demo.spec.ts`. If the demo instance has been re-seeded with different accounts, the
runbook's "Demo instance" section is what is true.*
