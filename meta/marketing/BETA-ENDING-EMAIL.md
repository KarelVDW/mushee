# Beta-ending announcement — ready to paste

Two variants for the admin console's **Announcements** page (audience filter:
plan `Beta`). Pick the one matching the decision in
`deploy/runbooks/end-of-beta-launch.md` §3; the wording tracks
`meta/marketing/LAUNCH-KIT.md` §5. Body syntax is the tool's own: blank lines
separate paragraphs, `{{name}}` = first name, `**bold**` and
`[label](https://…)` work. Announcements are service e-mail (no unsubscribe
link). Variant A qualifies outright — it is about the recipient's own account.
Variant B mixes in an offer (the code), so keep that paragraph to the one
factual sentence below and have the lawyer's pass in the runbook §1 checklist
cover it.

Replace `{{date}}`, `{{CODE}}` and `{{X}}` by hand before sending; the tool only
substitutes `{{name}}`. Send a test copy to yourself first. The plan figures
(Beta 30 min/day, Sketch 3 min/day and 5 scores, Songwriter 20 min/day) follow
`apps/web/src/lib/plans.ts` and the `subscription_tiers` rows — re-check them
against production before pasting.

---

## Variant A — grandfather (beta tier stays at 30 min/day)

**Subject:** You were here first — Solkey opens up on {{date}}

```
Hi {{name}},

Solkey leaves closed beta on **{{date}}** and opens to everyone. You helped shape it: the phone layout, MIDI and MusicXML import, transpose and the instrument list all came out of beta feedback. Thank you.

**What changes for you: nothing.** Your Beta plan keeps its 30 minutes of recording a day, for as long as you keep the account. That is more than the paid Songwriter plan gets, and it stays that way.

Everything else stays too: your scores, your settings, your exports. New plans and minute packs are listed at [solkey.io/pricing](https://solkey.io/pricing) if you ever want more, but you do not have to do anything.

If anything looks wrong after {{date}}, reply to this mail — it reaches me directly.

Karel
```

(≈130 words)

---

## Variant B — migrate to the free Sketch plan

**Subject:** You were here first — what changes for your Solkey account on {{date}}

```
Hi {{name}},

Solkey leaves closed beta on **{{date}}** and opens to everyone. You helped shape it: the phone layout, MIDI and MusicXML import, transpose and the instrument list all came out of beta feedback. Thank you.

**What changes for you:** on {{date}} your account moves to the free **Sketch** plan — 3 minutes of recording a day and up to 5 scores. Every score you made stays, as do your settings and exports; nothing is deleted. If you have more than 5 scores, they all stay open and editable — you just cannot create a new one until you are under the limit or on a paid plan.

As a thank-you for being here first, code **{{CODE}}** gives you {{X}} months of Songwriter (20 min/day) free. Redeem it at [solkey.io/pricing](https://solkey.io/pricing) before {{date}} and the switch will not interrupt you at all.

If anything looks wrong after the change, reply to this mail — it reaches me directly.

Karel
```

(≈135 words)

---

## Send timing

- **Announcement: 7 days before the flip**, Tuesday–Thursday, 09:00–10:00
  Europe/Brussels (beta users are mostly EU; mid-morning midweek gets read,
  Monday and Friday get buried). A week gives Variant B recipients time to
  redeem the code, or to export or tidy scores if they want to get under the
  Sketch limit (nothing is capped or deleted — see the body).
- **Reminder (Variant B only): the morning of the flip**, same slot, same body
  with the subject `Reminder: your Solkey account moves to Sketch today`. Skip
  for Variant A — nothing happens to them. **Send the reminder before running
  the Beta → Sketch tier migration** (runbook §3): the audience filter is by
  current plan, so after the migration it matches nobody. Check the live
  recipient count is non-zero before sending.
- Do not send on flip day itself in Variant A; send once, then leave them
  alone. One mail, one decision.
- Follow the runbook on partial failures: never re-send to the same filter; use
  the history row's **"Resend to N not reached"**.
