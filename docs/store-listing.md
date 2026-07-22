# Chrome Web Store listing draft

Reference copy for the Developer Dashboard's "Store listing" and "Privacy
practices" tabs. Nothing here is submitted automatically — paste it in by
hand at https://chrome.google.com/webstore/devconsole when publishing.

## Store listing tab

**Category:** Productivity

**Language:** English (United States)

**Short description** (≤ 132 characters, shown in search results):

    Bulk prompt automation for chat.qwen.ai video generation. Queue prompts, generate in bulk, download the results.

**Detailed description:**

    Qwen Video Factory automates bulk text-to-video generation on
    chat.qwen.ai. Load a list of prompts, walk away, come back to generated
    (and optionally downloaded) results.

    FEATURES

    - Bulk prompt queue — paste or upload a list of prompts, set a min/max
      delay between them, then Start. The queue runs unattended: types each
      prompt, submits it, and waits for the result before moving on.
    - Pause / Resume / Stop / Clear queue at any point. A queue stopped by
      the daily limit (or manually) stays in place so you can resume it once
      your quota resets, instead of losing progress.
    - Auto-pause on focus loss — automatically pauses if the chat.qwen.ai tab
      isn't active (Chrome throttles background-tab timers), and resumes the
      moment it's focused again.
    - Auto Download — automatically saves each finished video into a chosen
      subfolder with zero-padded filenames (001.mp4, 002.mp4, ...).
    - Reference images — optionally attach an image to each queued prompt.
    - Optional account rotation — if you load a plaintext accounts file, the
      queue can log into the next account when chat.qwen.ai's daily
      generation limit is hit and keep going. Without a loaded accounts file,
      the queue simply stops cleanly at the limit. See the Privacy Policy for
      exactly how loaded credentials are handled (in-memory only, never
      written to disk by this extension).

    Qwen Video Factory runs entirely in your own browser, against your own
    chat.qwen.ai account. It has no backend server and does not transmit
    your prompts, results, or credentials anywhere other than chat.qwen.ai.

    Not affiliated with, endorsed by, or produced by Alibaba Cloud or the
    Qwen team.

**Single purpose statement** (required field, one or two sentences):

    Automates bulk submission of text-to-video prompts on chat.qwen.ai —
    queueing, submitting, and downloading generation results on the user's
    own account — so the user doesn't have to submit each prompt by hand.

## Privacy practices tab

**Host permission justification (`https://chat.qwen.ai/*`):**

    Required to read the prompt composer and generation results, and to
    submit queued prompts, on chat.qwen.ai — this is the extension's entire
    purpose. No other host is accessed for reading or modifying page
    content.

**Permission justifications:**

- `storage` — saves the user's queue settings (delay range, download folder
  name, auto-download toggle) locally via `chrome.storage`, so they persist
  between side panel sessions. Never transmitted anywhere.
- `downloads` — used only when the user enables Auto Download, to save their
  own generated videos to a folder they choose.
- `sidePanel` — displays the queue controls in Chrome's side panel so the
  user can monitor and control a running queue.

**Remote code:** No remote code is executed. All logic ships in the package.

**Data usage disclosures** (check against docs/privacy.html, keep in sync if
that file changes):

| Data type | Collected? | Notes |
|---|---|---|
| Personally identifiable information | Yes, if used | Only if the user opts into loading an accounts file (email addresses), for the sole purpose of logging into their own chat.qwen.ai accounts. Never transmitted to the developer. |
| Authentication information | Yes, if used | Only if the user opts into the account-rotation feature. Credentials are kept in-memory in the side panel only, typed into chat.qwen.ai's own login form, and never written to disk or transmitted anywhere else. |
| Website content | Yes | Reads chat.qwen.ai page content (composer state, generation results, daily-limit messaging) to drive the queue. |
| Personal communications, health, financial, location, web history, user activity | No | Not accessed. |

Certifications to check (all true as of this writing):
- Does not sell or transfer user data to third parties outside approved use cases.
- Does not use or transfer user data for purposes unrelated to the item's core functionality.
- Does not use or transfer user data to determine creditworthiness or for lending purposes.

## Assets still needed (manual, outside this repo)

- At least one screenshot, 1280×800 or 640×400, showing the side panel in
  use against a real chat.qwen.ai tab.
- Privacy policy URL: `https://s4ndm4ndev.github.io/QwenVideoFactory/privacy.html`
  — requires GitHub Pages enabled on this repo (Settings → Pages → Deploy
  from branch → `master` / `/docs`). Confirm the URL resolves before pasting
  it into the dashboard; update `PRIVACY_POLICY_URL` in
  `sidepanel/sidepanel.js` and this file if the actual hosting URL differs.
- A one-time $5 Chrome Web Store developer registration fee, and the actual
  dashboard submission — both require the developer's own Google account and
  cannot be done on their behalf.
