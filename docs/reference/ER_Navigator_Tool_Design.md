# ER Navigator Tracking Tool — Data Model Design (Draft v3 for Review)

Based on the WhatsApp history and your feedback, the current process
tracks *one thing*: a patient exceeded 6 hours, and someone re-posts free
text about it until it resolves. The redesign below turns that into a
**living case record** — one row per patient case that gets *updated* in
place as the shift progresses, instead of re-typed from scratch each time.
Every field is a tap/dropdown selection wherever possible, with a
mandatory-but-lightweight "Other" escape hatch that feeds a review queue so
new patterns become permanent categories instead of getting lost in free text.

All department names, ward names, and delay phrasing below were pulled
directly from your WhatsApp group's actual message history, not invented —
flagged items are the few I added for secondary-hospital completeness and
need your confirmation.

---

## 1. Design philosophy

- **Tap, don't type.** Every categorical field is a dropdown or button. Free
  text is optional and only appears for "Other" or a short resolution note.
- **One living record per case, not repeated posts.** A Navigator opens a
  case once at flag time, then just updates its status as it moves.
- **Multiple concurrent delay reasons allowed.** A case can be tagged with
  more than one active reason at once (e.g. "no bed" AND "awaiting consulted
  team plan" at the same time) — this is a multi-select, not a single dropdown.
- **Every category has an "Other — please specify" option.** Anything typed
  into "Other" lands in a lightweight review queue for you to periodically
  promote into a real category.
- **The taxonomy follows the patient's actual path**, as you described it:
  Registration (where the length-of-stay clock starts) → Triage → then
  splits to either the Resus room or an Exam room → then the rest of the
  journey (investigations, referral, disposition, admission/discharge).

---

## 2. Case record — core fields (every case)

| Field | Type | Notes |
|---|---|---|
| MRN | digits only, any length, required | Only patient identifier stored; letters rejected at entry |
| Registration time | datetime, editable | **This is the length-of-stay clock start.** Navigators may open a case late, so this is entered manually and can be earlier than the time the case was created |
| Time flagged (>6H) | datetime, auto | Set when Navigator opens the case |
| Navigator (creator) | dropdown (staff list) | Auto-filled from login if the tool has accounts |
| Shift | dropdown: Morning / Evening / Night | |
| **Current journey stage(s)** | multi-select (see Section 3) | Where the delay is happening — can be more than one at once |
| **Delay reason(s)** | multi-select, dependent on selected stage(s) | Second-level detail, one or more per stage |
| Reason = Other | free text, conditional | Only shown if "Other" selected; goes to review queue |
| Department/team involved | multi-select (see Section 4) | Shown when a referral/consultation-stage reason is selected |
| Referral tracking number | text, conditional | Shown when a "Referred out" reason or a transfer disposition is selected |
| Receiving facility | text, conditional | Shown alongside the referral tracking number |
| Medical Admin on-call informed at | time, optional | Simple timestamp — logged when the on-call admin is notified, not a tiered escalation category |
| Status | dropdown: Open / Resolved | Drives whether it still shows on the live dashboard |
| **Update log** | repeatable timestamped sub-entries | Each update captures what changed and when — this replaces "re-posting" |
| Final disposition | dropdown (see Section 5) | Filled when status = Resolved |
| Total ED length of stay | auto-calculated | Registration time to disposition time |
| Resolution note | free text, optional | One short closing note |

---

## 3. Journey stage → delay reason taxonomy

Registration → Triage → **Resus room** or **Exam room** → the rest. Each row
below is a stage with its own multi-select list of specific reasons. Every
stage also gets "Other — please specify."

**A. Registration** *(LOS clock starts here)*
- Registration desk/system delay
- Missing/incorrect patient information
- Other

**B. Triage**
- Waiting for triage nurse availability
- Re-triage required
- Other

**C. Resus room**
- No resus bay available
- Equipment/monitor not available
- Other

**D. Exam room**
- No exam room available
- Waiting for isolation/negative pressure room
- Other

**E. Investigations**
- Lab: delay in sample collection (draw from patient)
- Lab: delay in sample transport/pickup to lab
- Lab: delay in lab receiving specimen
- Lab: delay in processing (received, awaiting analysis)
- Lab: delay in results release/reporting back to ED
- Imaging acquisition delay (scan not yet done — CT / US / X-ray / KUB, sub-select)
- Imaging report delay (scan done, report pending)
- Waiting for transport to imaging
- Other

**F. Referral / Consulted team** *(pairs with Section 4 — department involved)*
- Awaiting consulted team response/callback
- Consulted team seen patient, awaiting plan
- Referral sent, awaiting acceptance by receiving team
- Disagreement between teams on ownership
- Other

**G. Disposition decision**
- Plan made, awaiting written admission order
- Awaiting senior/attending sign-off
- Other

**H. Admission process**
- No bed available on accepting ward
- Bed available, awaiting transport/porter
- Bed available, awaiting nursing handover
- Referred out — no bed in accepting department, transfer to another facility being arranged (e.g. Al Mouwasat, Erada)
- Referred out — care required not available on-site
- Waiting for Regional Coordination Center (RCC) / transfer acceptance
- Other

**I. Discharge process**
- Awaiting discharge paperwork/prescription
- Awaiting pharmacy
- Awaiting patient transport home
- Patient signing DAMA (discharge against medical advice)
- Social/family factor delaying discharge
- Other

**J. Administrative/coordination**
- Bed coordinator office delay
- Fax/communication breakdown between units
- System/network downtime
- Other

---

## 4. Department / consulted team involved

Pulled from your WhatsApp history — **please confirm this is complete**:

- MROD (Medical Registrar/Resident On Duty — first-line medical on-call)
- Internal Medicine (IM)
- General Surgery (GS)
- ICU
- CCU
- Orthopedics
- Urology
- Neurology / Neurosurgery
- OB/GYN
- Psychiatry (typically external referral, e.g. Erada hospital)
- Radiology (consult, not just imaging read)
- Respiratory Therapy (RT)

*Added for secondary-hospital completeness — confirm if relevant at QCH:*
ENT, Ophthalmology, Pediatrics, Dermatology, Other — please specify.

## 5. Final disposition

- Admitted — ward (dropdown, see Section 6)
- Discharged home
- Discharged — DAMA
- Transferred to another facility (name)
- Left without being seen
- Other

## 6. Ward list (for "Admitted to")

Pulled from your WhatsApp history:
- FMW (Female Medical Ward)
- MMW (Male Medical Ward)
- FSW (Female Surgical Ward)
- MSW (Male Surgical Ward)
- ICU
- CCU
- SDU (Step Down Unit)
- OBW (OB Ward)
- Isolation/negative pressure room (tag alongside any ward)

---

## Open questions for you

1. **RCC** — I read this as "Regional Coordination Center" (the office that
   arranges inter-facility transfer/ambulance) from the Erada hospital
   context. Correct me if that's wrong.
2. Is the department list in Section 4 the complete set QCH actually
   refers out to, or are there others I'm missing?
3. Anything in the ward list (Section 6) missing — e.g. a dedicated
   Pediatric ward, or Peds going to a general ward?

Once you've marked this up, I'll build the prototype Excel version with
these exact fields, multi-select tagging, and dropdowns so you can test it
before we touch the website.
