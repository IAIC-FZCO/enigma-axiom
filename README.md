# ENIGMA Axiom — Chrome extension

Reach your goals with ChatGPT, Claude, Gemini & Deepseek — and independently verify every step. *Per aspera ad astra.*

**ENIGMA Axiom** adds two things on top of the major AI chat assistants:

- **A goal layer** — turn an objective into a structure of goals and tasks; the "E" engine proposes the breakdown and flags what's missing.
- **An independent verification layer** — citations and claims in an AI's answer are checked against authoritative sources (Crossref, PubMed, OpenAlex, arXiv, CourtListener) and an independent panel of models — never the AI grading its own work.

> Never let an AI grade its own homework.

Website: https://axiom.enigma.ist · Privacy: https://axiom.enigma.ist/privacy

This repository contains the **source of the browser extension** (the client). Verification runs against the hosted API at `api.enigma.ist`.

## Supported sites
ChatGPT (chatgpt.com, chat.openai.com), Claude (claude.ai), Gemini (gemini.google.com), Deepseek (chat.deepseek.com). More AI surfaces are added inductively.

## Build from source
Requirements: Node.js >= 20.

```bash
npm install
npm run build      # outputs an unpacked MV3 extension to dist/
```

Load it in Chrome: open `chrome://extensions` -> enable **Developer mode** -> **Load unpacked** -> select `dist/`.

## Permissions
- `storage` — save your settings locally.
- `activeTab` — act on the AI answer in the tab you are viewing.
- host access to the supported AI sites (read the visible answer to find citations) + `api.enigma.ist` (verification) + `enigma.ist` (sign-in).

The extension reads only the visible answer text on the supported sites and sends only the specific claim or citation you choose to verify. Nothing is auto-sent or rewritten.

## License
© 2026 IAIC AI Research & Trading FZCO (Dubai). Source published for transparency. All rights reserved unless a separate LICENSE file states otherwise.
