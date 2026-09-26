# Solkey — Public launch kit

Copy and checklists for the day the beta gate comes off. Everything here is
grounded in what the product does on `master` today and in the current
catalogue (Sketch free · Songwriter $9 · Studio $19 · Arranger $49 · packs
$6/$15/$39 — see `apps/web/src/lib/plans.ts`). Companion docs:
[ICP.md](./ICP.md) (who), [INFLUENCERS.md](./INFLUENCERS.md) (through whom),
`deploy/runbooks/end-of-beta-launch.md` (the technical flip).

Drafted 2026-09-05; every block is meant to be edited, not pasted.

---

## 1. Positioning

**One-liner:** Solkey turns what you play or sing into sheet music, live.

**Longer:** Hum it, sing it, or play it — Solkey listens and writes the notation
in front of your eyes, bar by bar. Fix a note with a keystroke, transpose,
change the key or meter, hear it back with real instrument sounds, and export
MusicXML, PDF or MIDI. In the browser, on your phone, saved as you go.

**The three proof points** (use in every asset, in this order):

1. _Live_ — the notes appear while you're still playing, not after an upload.
2. _Editable_ — it lands in a real editor, so the transcription's mistakes are a
   keystroke away from fixed (this is the difference from transcription apps).
3. _Portable_ — MusicXML/PDF/MIDI out, MusicXML/MIDI in; nothing is locked in.

**What we don't claim:** perfect transcription, chords/polyphony, drums, tempo
detection. The demo shows a monophonic line (voice, whistle, one instrument).

---

## 2. Announcement post (blog / newsletter, ~300 words)

> **Solkey is open to everyone.**
>
> For the last two months a small group of beta users has been humming,
> whistling and playing into Solkey and watching sheet music appear. Today the
> waitlist is gone: anyone can sign up, and the free Sketch plan is free
> forever.
>
> Solkey started from one frustration: the slowest part of writing music down
> is _writing it down_. Voice memos pile up, ideas die between the shower and
> the piano, and note entry in notation software is a skill of its own. So
> Solkey listens instead. Press record, play or sing, and the notation is
> written live — then you correct it the way you'd correct a typo.
>
> What's in it today: live audio-to-notation for a single melodic line; a
> keyboard-first editor with real engraving rules (beaming, ties, accidentals,
> tuplets); key, clef, meter and tempo changes; transpose and minimize
> accidentals; playback with real instrument sounds and a metronome; MusicXML
> and MIDI import; MusicXML, PDF and MIDI export; autosave; and a phone layout
> that reflows the score instead of shrinking it.
>
> Pricing is about one thing: how much you record. Sketch is free with three
> minutes of recording a day and five scores. Songwriter ($9/month) gives you
> twenty minutes a day and unlimited scores; Studio ($19) three hours; Arranger
> ($49) eight. Prefer no subscription? One-time minute packs start at $6 and
> never expire. Editing, playback and export are unlimited on every plan.
>
> Beta users: thank you. [What happens to your account →] _(link to §5 email or
> a help page; decide grandfathering first — runbook §3.)_
>
> Try it: [solkey.io](https://solkey.io) — no card needed.

---

## 3. Product Hunt

**Name:** Solkey
**Tagline (60 chars max):** Hum or play a melody, get editable sheet music — live
**Topics:** Music, Productivity, Education, Web App

**Description (260 chars max):**
Solkey listens while you sing, whistle or play and writes the notation in
real time. Fix notes with keystrokes, transpose, hear it back, export
MusicXML/PDF/MIDI. Browser + phone. Free plan, no card.

**First comment (maker):**

> Hi PH — I'm Karel, the maker. I built Solkey because I kept losing melodies
> between having them and writing them down. Notation software assumes you
> already think in noteheads; recording apps give you an audio file you still
> have to transcribe. Solkey sits in between: it transcribes _while_ you play,
> into an editor, so the mistakes it makes (it will make some — it's one melodic
> line at a time, no chords yet) are a keystroke away from fixed.
>
> Things I'd love feedback on: how it does on _your_ instrument or voice, the
> phone layout, and whether the pricing-by-recording-time model feels fair.
> Sketch is free forever (3 min of recording a day). Ask me anything.

**Gallery order:** 1) 15-second hum-to-notation clip, 2) editor with a fix
being made, 3) phone layout, 4) export menu, 5) pricing.

---

## 4. Social posts

**X / Threads (thread starter):**

> Hum a melody into your laptop. Watch it become sheet music while you're still
> humming. Then fix a note like fixing a typo. That's Solkey, and as of today
> it's open to everyone — free plan, no card. solkey.io [clip]

**LinkedIn (educators angle, ICP 2/3):**

> Music teachers: what if a student could play a phrase and immediately see
> what they _actually_ played, in notation, next to what's written? Solkey does
> live audio-to-notation in the browser — no install, works on the studio iPad
> and the school Chromebook. Out of beta today, free plan included. I'd love to
> hear how it holds up in a real lesson.

**Reddit (r/musictheory, r/Songwriting, r/WeAreTheMusicMakers — read each
sub's self-promo rules first; prefer a demo + honest limitations post):**

> I built a browser tool that writes notation live while you sing or play
> (single melodic line — no chords or drums yet). It drops into an editor so
> you can fix its mistakes and export MusicXML/PDF/MIDI. Free tier is 3 min of
> recording a day. Honest question for this sub: what would make you trust a
> transcription enough to hand it to another player? [clip]

**Short-form (TikTok/Reels/Shorts) script, 20 s:** phone propped on a piano →
finger presses record → whistle four bars → cut to the staff filling in →
"wrong note" → arrow-key fix → play back with a flute sound → "solkey.io, free".

---

## 5. Beta-user email (send before the flip — runbook §3)

Subject: **You were here first — what changes when Solkey opens up**

> Hi {{name}},
>
> Solkey is coming out of closed beta on {{date}}. You helped shape it: the
> phone layout, MIDI/MusicXML import, transpose and the instrument list all
> came out of beta feedback. Thank you.
>
> What changes for you: {{ONE OF:}}
>
> - _(grandfather)_ nothing — your Beta plan keeps its 30 minutes of recording
>   a day, for as long as you keep the account.
> - _(migrate)_ on {{date}} your account moves to the free Sketch plan (3 min
>   of recording a day, up to 5 scores). Every score you made stays. As a
>   thank-you, code **{{CODE}}** gives you {{X}} months of Songwriter free.
>
> Everything else stays: your scores, your settings, your exports. If anything
> looks wrong after the switch, reply to this mail — it reaches me directly.
>
> Karel

---

## 6. Press / directory blurb (100 words)

> Solkey (solkey.io) is a browser-based sheet-music editor with live
> audio-to-notation: sing, whistle or play a melody and the notation is written
> in real time, ready to edit, play back and export as MusicXML, PDF or MIDI.
> Built for songwriters who think by ear, music students who transcribe, and
> teachers who need custom material fast, it runs without installation on
> laptops and phones. Solkey is made in Aalst, Belgium, by Karel Van De Winkel,
> and offers a free plan alongside paid plans priced by daily recording time.

---

## 7. Launch-day checklist (marketing side; the technical flip is the runbook)

Before:

- [ ] Decide beta users' fate (runbook §3) → finalize §5 email, schedule it.
- [ ] Record the 15-second hero clip and the 20-second short (same take).
- [ ] `/pricing` copy sanity check with `NEXT_PUBLIC_BETA_MODE=false` (tier
      ladder + FAQ visible; JSON-LD offers present).
- [ ] Product Hunt draft scheduled (Tuesday–Thursday, 00:01 PT).
- [ ] Support inbox reachable: `support@` / `hello@` aliases live (master-todo
      item 1).
- [ ] PostHog: Error tracking enabled; a dashboard with signups, recordings
      started, checkout started (events already emitted — see notes.md).

Day:

- [ ] Flip (runbook §4), smoke, then publish: PH → X/Threads → LinkedIn →
      Reddit (staggered, so replies are manageable).
- [ ] Reply to every comment within the hour for the first 6 hours.
- [ ] Watch signups + SendGrid activity (CAPTCHA keys set? runbook §1).

Week after:

- [ ] Influencer outreach wave 1 (INFLUENCERS.md niche A, 5 creators) with the
      clip and a Songwriter code.
- [ ] Post a "what people recorded in week one" follow-up (with consent).
