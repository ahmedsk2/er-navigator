# Phase 8 brief: what the ED reports and the collection sheets ask of ER Navigator

Written 2026-09-09 from four files Ahmed provided: the Qatif Health Network monthly deck
`ER2026-March.pptx` ("ER Journey KPI", whole-ED data from the hospital system), the weekly
management deck `ED_Delayed_first week of septemper2026.pptx` (the ≥6 h tickets, i.e. exactly what
this app replaces), the national `Data Collection-ED (ED-Adaa) Updated.xlsx` form (per-patient rows
that roll up to eight ED KPIs per CTAS level, with benchmarks) and `AUGUST ,QCH,.xlsx`, the
navigators' current per-patient log for August (214 rows, 71 columns, dropdown vocabularies).

The files themselves are not committed: the August sheet carries patient names and the deck
carries MRNs. Nothing in this document, the code or the tests repeats a patient identifier.

## 1. What each source measures

**Weekly delayed-tickets deck (the one this app is for).** Headline: tickets this week, episodes
after merging a duplicate, median and mean ED stay, range, share of tickets at 10 h or more, the
longest stay. A histogram of stay bands (6–<8, 8–<10, 10–<12, 12+ h). A "delay pathway"
classification, several per ticket: CT / imaging, ED front-end (bed or first assessment),
inpatient bed / transfer, consultation / decision, technical / capacity, patient / social /
payment, laboratory, ultrasound. A ranked table of the longest stays (MRN, stay, pathways,
documented action, outcome). One slide per top case with its time sequence: arrival, each order
and result, each referral and review, each decision and fax, with the interval between steps. An
"operational responses" chart: case / bed management, external transfer / fax / RCC, leadership
escalation, forced / safety admission, PRO / social work, DAMA management, and the share of
episodes with no documented action (37 %). An appendix ranking every ticket.

**Monthly ER Journey deck (whole ED, 9,962 patients in March).** Patients by CTAS; admitted vs
not; by ED area (RAZ, paediatric, male, female, triage, pooling, resuscitation, OB-GYN, cold case,
procedure, respiratory, negative pressure, psychiatry); door-to-disposition over 4 h (13 %), the
same split by CTAS, by area, by specialty and by admitting ward; the Adaa time bands per CTAS
(within 4 h, 4–6, 6–12, 12–24, 24–48); KPI 5 per CTAS; admissions to AICU / PICU / NICU / ward
within 30 min, 1 h, 1–4 h, over 4 h; consultations per CTAS and by specialty, admitted or not;
CT orders per CTAS; average wait from physical exam to consultation.

**Adaa form.** Per patient: registration time, triage time, CTAS, physician exam time, sickle-cell
treatment identified, painkiller prescribed and given (pethidine dose), decision time, admission
type (ICU / NICU / PICU / ward), discharge type (DAMA, LAMA, home, another facility, deceased,
referred to UCC), disposition time. KPIs: 1 door-to-doctor, 2 doctor-to-decision, 3
decision-to-disposition, 4 % non-urgent (CTAS 4–5), 5 % door-to-disposition within 4 h, 6 % LAMA
and DAMA, 7 mortality, 8 door-to-painkiller; benchmarks per KPI (world class / acceptable / needs
improvement / unacceptable); admissions-to-unit bands; the "treated within" bands.

**August navigator sheet.** Per patient: area assigned, treating ER physician, CTAS, arrival,
seen by MD, treatment plan shared, lab order and completion and a delay reason over 1 h, up to two
images (type, order, done, preliminary report, official report, delay reason over 90 min), ER-MD
decision and time and a delay reason over 2 h 30, up to two consultations (time, specialty,
response time, additional investigation asked, result, decision, delay reason over 1 h), final
decision, disposition time, instructions given, family engagement, admission order time, ward,
referral to case management (case manager or complex-care coordinator, criteria, action, name,
call and reply times), time to ward, delay-to-ward reason over 30 min, comments, navigator(s),
reviewed by. Dropdown vocabularies for every delay reason.

## 2. What the app already holds (no change needed)

MRN; registration (door); triage; room (resus / exam) and isolation; first physician contact;
disposition decided; left ED; the admission chain (order, bed requested = fax, bed assigned,
handover); the transfer chain (requested, accepted, transport arrived, tracking number,
facility); disposition; ward; consults (department, consulted, seen, replied); investigations
(LAB ordered / collected / received / resulted; CT, US, XR ordered / done / reported); delay
reasons per stage from the locked taxonomy; free-text updates; medical admin informed; shift;
navigator; alerts at 6 / 12 / 24 h; audit of every change. The dashboard already has the
threshold table, the weekly chart, top reasons, stages, departments, consult and investigation
medians, the admission chain, shift, weekday, disposition, and drill-downs; the export has
Cases / Consults / Investigations / Updates / Summary; the print report exists.

Most of the two decks and most of the August sheet can therefore be produced from data the
navigators already enter, with one large exception: the whole-ED population figures (all 9,962
patients, % non-urgent, mortality, door-to-doctor for everyone) come from the hospital system,
not from navigators. ER Navigator reports on the cases it tracks and says so on every screen
that shows a KPI.

## 3. Ideas taken into the dashboard (built in Phase 8, no decision needed)

From the weekly deck:

1. Headline tiles for the range: cases, episodes (distinct MRNs), median and mean stay, range,
   share at 10 h or more, share at 12 h or more, the longest stay (linked), and the change
   against the previous period of the same length.
2. Stay-band histogram: 6–<8, 8–<10, 10–<12, 12–<24, 24+ h.
3. Pathways: for each stage of the locked taxonomy, the share of cases that carry at least one
   reason in it (several per case, like the deck's classification), with a drill-down.
4. Longest stays: a ranked table of the ten longest (MRN, stay, stages, outcome, last update),
   each linked to the case.
5. Actions documented: share of cases with at least one update, an escalation to medical admin,
   a fax / transfer step or a bed request, and the split by kind of action; the complement is the
   deck's "no operational action documented".
6. Outcome mix for the range: admitted, discharged, DAMA, transferred, other, still open.
7. Documentation completeness: cases with no reason, no disposition after 24 h, no update in
   the last 12 h while open, milestones out of order.
8. Repeat visits: MRNs with more than one case in the range.
9. Per-case time sequence: on the case page and on the print sheet, every recorded milestone in
   order with the interval from the previous one, which is the deck's per-case slide generated.

From the monthly deck and the Adaa form, on the tracked cases:

10. Adaa KPI panel: KPI 1 door-to-doctor, KPI 2 doctor-to-decision, KPI 3 decision-to-
    disposition (medians and the share within each benchmark band), KPI 5 share within 4 h and
    the "treated within" bands (4 h, 4–6, 6–12, 12–24, 24–48, 48+), KPI 6 share DAMA, each
    coloured by the Adaa benchmark; KPI 4 (% CTAS 4–5) once CTAS is recorded. Labelled
    "tracked cases, not the whole ED".
11. Admission-to-unit bands: admission order to left ED within 30 min, 1 h, 1–4 h, over 4 h, by
    ward type (ICU-type: ICU, CCU, PICU, NICU; ward).
12. QCH working targets from the August sheet, as compliance rates with drill-downs: lab result
    within 1 h of order; imaging official report within 90 min of order; consult response
    within 1 h; seen-to-decision within 2 h 30; admission order to leaving ED within 30 min.
13. Exam-to-consult interval: first physician contact to the consult request, by department
    (the March deck's "average waiting time for consultations from physical exam").
14. Imaging and lab turnaround distributions (not only medians): order to done, done to
    reported, with the share of CT reported within 90 min.
15. By CTAS and by ED area (counts and median stay), once those fields exist (Section 5).

## 4. What the exports become

The export page gets a format choice; the date range and status filter stay as they are.

- **ER Navigator workbook**: unchanged (Cases, Consults, Investigations, Updates, Summary).
- **Adaa ED KPIs workbook**: sheet `ED KPIs manual` with exactly the input columns A–T of the
  official form (Patient ID = MRN, date, registration time, calendar-day offsets, triage time,
  CTAS, physician exam time, sickle-cell, painkiller, pethidine, dose, painkiller time, decision
  time, admission type, discharge type, disposition time), one row per tracked case in the range,
  in the form's own value vocabulary, so the rows paste straight into the official file; a
  `KPI summary` sheet computed by the same formulas as the form (per CTAS and overall: totals,
  KPI 1–3 totals in minutes, the "treated within" bands, KPI 5 %, KPI 6 %, admissions-to-unit
  bands) with the benchmark colour; and a `Read me` sheet stating the population (tracked
  cases) and what is blank until recorded (painkiller, sickle-cell, deceased).
- **QCH navigator sheet workbook**: the August sheet's columns in its order, without the patient
  name column, filled from the app: date, MRN, area, CTAS, arrival, seen by MD, lab order /
  completion / delay reason, images 1 and 2 (type, order, done, preliminary, official, delay
  reason), ER-MD decision and time, seen-to-decide, decision delay reason, consultations 1 and 2
  (time, specialty, response, delay reason), consult-to-discharge, consult-to-admit, final
  decision, disposition time, door-to-disposition, admission order time, ward, time to ward,
  order-to-disposition hours, door-to-disposition for admitted, delay-to-ward reason, comments
  (the updates), navigator, reviewed by. Delay reasons are the case's taxonomy reasons for that
  stage. Columns the app does not record (physician, treatment plan shared, instructions,
  family engagement, case management) are present and blank until Section 5 is decided.

Every export is audited (`export.xlsx` with the format), counted by the same live count, and
built by the same streaming writer.

## 5. Data collection: fields the sheets have and the app does not

| Field (source) | Value | Proposal |
| --- | --- | --- |
| CTAS level 1–5 (all four sources) | Every KPI in both decks and the Adaa form is per CTAS | **Add now**: optional chip row in the case editor, in the export and the dashboard |
| ED area assigned (August sheet, March deck) | Where the delay happens; the March deck splits everything by it | **Add now**: an Admin-editable list seeded with Resuscitation, Acute, Rapid assessment zone, Pooling, Isolation, Negative pressure; optional chip row |
| Imaging preliminary (verbal) report time (August sheet, weekly deck) | The report delay is the commonest imaging pathway | **Add now**: optional time on CT / US / XR rows |
| Treating ER physician (August sheet) | Accountability for "delay from ER doctors' management" | **Ask**: it names staff on a delay record; if wanted, an Admin list of physicians, optional |
| Case management referral: to whom, criteria, action, call and reply times (August sheet, 58 of 214 rows) | A real step in the admission pathway at QCH | **Ask**: adds a block to the case editor and two milestones |
| Action taken on an update: escalation, bed management, fax / RCC, PRO / social work, forced / safety admission, DAMA counselling (weekly deck) | Makes "actions documented" precise instead of inferred | **Ask**: an optional chip on each update; the taxonomy is the deck's |
| Instructions given by doctor; family engagement (August sheet, ~200 of 214 filled) | Discharge-quality items the navigators already record | **Ask**: two optional yes / no / not sure fields at resolution |
| Disposition values Deceased, LAMA, Referred to UCC (Adaa) | Needed for KPI 6 and 7 as Adaa defines them | **Ask**: the disposition list is locked taxonomy; "Other" carries them today |
| Painkiller prescribed / given, pethidine dose, sickle-cell treatment (Adaa KPI 8) | National KPI, but a clinical record, not a navigation one | **Ask**: probably not for navigators; the export leaves the columns blank |
| MRI as an investigation type (August dropdown) | Nine rows in August used a second image; MRI appears in the list | **Ask**: taxonomy addition |
| Reviewed by (August sheet) | The weekly deck states every entry was reviewed | **Ask**: a supervisor "reviewed" mark per case, audited |
| Delay-reason vocabularies (August dropdowns) | Several QCH wordings are not in Appendix A (busy shift, technician acceptance, difficult IV line, payment, RRT or code blue on the ward, shift change, watcher needs single room) | Admin adds them as reasons under the matching stage; nothing to build |
| Wards beyond Appendix A (PMW, PSW, PICU, NICU, L&D, SCBU, OBN) | The March deck admits to them | Admin adds them; nothing to build |

## 6. Decisions recorded

- The whole-ED KPIs stay with the hospital system. The app labels every KPI as tracked cases.
- The weekly deck's pathway classification is expressed through the locked stage taxonomy, not
  a second classification.
- The Adaa export produces the official form's input columns and a computed summary rather than
  writing into the official workbook, whose 20,000 formula rows and external references do not
  survive a programmatic write reliably; pasting the rows takes a minute.
- The August sheet's patient name column is not reproduced, ever.
