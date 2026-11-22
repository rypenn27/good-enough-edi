# Good Enough EDI

A proof of concept of an EDI mapping application for freight. It receives X12 204, 990, 214, 210 and 997 files from trading partners, checks them against each partner's guideline, maps them into JSON a TMS can use, and answers each file with a 997.

React + Vite front end and a small Node + Express server, all plain JavaScript. Data is stored in a JSON file. There's no real SFTP or AS2 yet: a local inbox folder stands in for partners' SFTP folders.

## Run it

```
npm install
npm run dev
```

Then open http://localhost:5175. `npm run dev` starts both the web app (port 5175) and the API server (port 3002).

## Try the inbox

When the server starts it creates a folder per partner:

```
edi-inbox/
  atlas/
    inbound/    drop files here
    outbound/   997s and other files sent to the partner
    archive/    processed files
    error/      files that couldn't be read, with a .txt saying why
  northline/
  ...
```

Copy a file from `samples/` into a partner's `inbound` folder. Within a few seconds the server:

1. moves it to `archive`
2. matches it to the partner by the sender ID in the ISA segment
3. checks it against that partner's guideline and runs their mapping
4. writes a 997 accepting or rejecting it to `outbound`
5. shows it in the app, with a notice that a new file arrived

| Sample | Drop it in | What happens |
|---|---|---|
| `northline-204-good.edi` | `edi-inbox/northline/inbound` | Accepted; 997 acceptance written |
| `atlas-204-bad.edi` | `edi-inbox/atlas/inbound` | Fails validation (missing pickup date, 4-digit ZIP); 997 rejection written |
| `wrong-folder-204.edi` | `edi-inbox/atlas/inbound` | Sent by Northline, so it's moved to `error` with an explanation |

You can also paste or choose a file with **Upload a file** on the Transactions page.

## Talking to a TMS

**New files go to the TMS by webhook.** When an inbound file passes its checks, the server posts it, mapped to JSON, to every active webhook on the API & webhooks page. If the webhook doesn't answer with a 2xx it tries twice more (after 5 and 30 seconds), then marks the file "TMS delivery failed" and raises an alert. Fix the webhook and press Reprocess to send it again.

| Event | When |
|---|---|
| `transaction.received` | A file passed its checks (the JSON includes the mapped load) |
| `transaction.failed` | A file failed validation |
| `transaction.sent` | A file was sent to a partner |
| `ack.received` | A partner's 997 arrived and was matched to the file it answers |

**The TMS sends files out through the API.** Send the API key (API & webhooks page) in an `X-API-Key` header:

```
POST http://localhost:3002/api/outbound
{ "partnerId": "northline", "set": "990", "env": "production",
  "fields": { "shipmentId": "30201", "action": "A" } }
```

| Set | Fields |
|---|---|
| 990 | `shipmentId`, `action` (`A` accept, `D` decline) |
| 214 | `shipmentId`, `status` (e.g. `AF`, `X1`, `D1`), `city`, `state` |
| 210 | `invoice`, `shipmentId`, `amount` (dollars) |

The file is checked against the partner's guideline, written to their `outbound` folder, and waits for their 997. When the 997 arrives in `inbound`, it's matched by group control number and the file is marked acknowledged or rejected. No 997 after 30 minutes raises an alert.

**Test TMS.** The Test TMS page is a pretend TMS built in. The sample webhook points at it, so you can try the whole loop on one PC:

1. Upload `samples/northline-204-good.edi` to `northline/inbound` (over SFTP or by copying)
2. The load appears on Test TMS. Press **Accept** and a 990 lands in `northline/outbound`
3. Open that 990 and press **Partner's 997: accept** to download the reply the partner would send
4. Upload that 997 to `northline/inbound`. The 990 changes to Acknowledged

"Pretend the TMS is down" makes the Test TMS refuse webhooks, to see failed deliveries and alerts.

## SFTP with SFTPGo

Partners can also send files over real SFTP. [SFTPGo](https://github.com/drakkan/sftpgo) (free, open source) runs as a Windows service:

- SFTP on port 2022, web admin at http://localhost:8080/web/admin
- One SFTPGo user per partner, whose home folder is `edi-inbox/<partner>`
- Partners can upload to `inbound` and download or delete from `outbound`. They can't see what's in `archive` or `error`

So a partner's SFTP upload lands in `inbound`, the server picks it up, and the 997 waits in `outbound` for them to download.

To set it up on another PC, install it (`winget install drakkan.SFTPGo`), create the admin account on the web admin's first-run page, then add a user per partner with those folders and permissions.

## What's here

| Page | What it does |
|---|---|
| Transactions | Every file in and out, with filters, counts and file upload |
| Transaction detail | Raw X12 with problem lines highlighted, a readable view, the JSON sent to the TMS, envelope IDs, timeline, and Reprocess / Mark resolved / Send again |
| Trading partners | Partner list, add a partner, and each partner's IDs, connection, transaction sets, onboarding checklist and contacts |
| Connections | The local inbox folders, the planned SFTP server and AS2 station, and each partner's connection |
| Mappings | Mapping editor that turns an inbound 204 into a TMS load, with live results against a sample file |
| Guidelines | The checks each partner's files must pass |
| Alerts | Failed files, rejections, late 997s, unreadable inbox files and broken connections |
| API & webhooks | API key and webhook addresses for the TMS |
| Settings | Company details, your EDI IDs, and a reset back to the sample data |
| Test TMS | A pretend TMS: loads it received by webhook, with Accept / Decline, status and invoice buttons |

Production and Test are switched in the sidebar.

## Code layout

- `server/index.js`: API routes and the inbox scan loop
- `server/inbox.js`: partner folders, picking up files, writing outbound files
- `server/process.js`: matching, checking, 997s (sent and received), outbound files and transaction actions
- `server/webhooks.js`: sends events to the TMS webhooks, with retries
- `server/mockTms.js`: the Test TMS's webhook receiver
- `server/db.js`: reads and writes `data/db.json`
- `src/lib/x12.js`: builds, reads and checks X12 files, and runs mappings (used by both server and browser)
- `src/data/sample.js`: sample partners, guidelines, mappings and files (all fictional)
- `src/store.jsx`: loads data from the API, polls for changes, saves edits
- `src/pages/`: one file per page

`data/` and `edi-inbox/` are created when the server first runs and aren't committed.

## Notes

The guideline rules here are written for this app. Real partner guidelines come from the licensed X12 standard, so set them up from each partner's own document.
