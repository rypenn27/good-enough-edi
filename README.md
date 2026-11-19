# Good Enough EDI

A proof of concept of an EDI mapping application for freight. It receives X12 204, 990, 214, 210 and 997 files from trading partners, checks them against each partner's guideline, and maps them into JSON a TMS can use.

This is the **front end only** (React + Vite, plain JavaScript). It runs on sample data saved in your browser. There's no backend yet, so nothing is really sent over SFTP or AS2.

## Run it

```
npm install
npm run dev
```

Then open http://localhost:5175.

## What's here

| Page | What it does |
|---|---|
| Transactions | Every file in and out, with filters, counts and **Upload a file** (paste or choose X12; it's matched to a partner by ISA sender ID and checked against their guideline) |
| Transaction detail | Raw X12 with problem lines highlighted, a readable view, the JSON sent to the TMS, envelope IDs, timeline, and Reprocess / Mark resolved / Send again |
| Trading partners | Partner list, add a partner, and each partner's IDs, connection, transaction sets, onboarding checklist and contacts |
| Connections | Your SFTP server and AS2 station, plus each partner's connection and health |
| Mappings | Mapping editor that turns an inbound 204 into a TMS load, with live results against a sample file |
| Guidelines | The checks each partner's files must pass |
| Alerts | Failed files, rejections, late 997s and broken connections |
| API & webhooks | API key and webhook addresses for the TMS |
| Settings | Company details, your EDI IDs, and a reset for the sample data |

Production and Test are switched in the sidebar.

## Code layout

- `src/lib/x12.js`: builds, reads and checks X12 files, and runs mappings
- `src/data/sample.js`: sample partners, guidelines, mappings and files (all fictional)
- `src/store.jsx`: app state, saved to localStorage
- `src/pages/`: one file per page
- `src/components/ui.jsx`: shared pieces (status pills, tabs, modal, page header)

## Planned backend

SFTP via SFTPGo and AS2 via OpenAS2, both handing files to a Node API that does the checking and mapping server-side, with 997s sent automatically.

The guideline rules here are written for the app. Real partner guidelines come from the licensed X12 standard, so set them up from each partner's own document.
