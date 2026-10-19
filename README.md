# CubePilot for homee

**English** · [Deutsch](README.de.md)

Control your [homee](https://hom.ee) smart home from outside the homee app: a fast web UI for devices and
homeegrams (homee's automations), and an [MCP](https://modelcontextprotocol.io) server so AI assistants such as
Claude can read and edit your setup in plain language.

It talks to homee over the same WebSocket API the official app uses, locally in your home network or through the
homee cloud.

> **Unofficial project.** Not affiliated with or endorsed by homee GmbH. The homee API is undocumented and may change
> with any firmware update. Use at your own risk, and keep the automatic backups switched on.

## Features

### Web UI: control your devices
- Device dashboard grouped by category (shutters, lights, heating, plugs, security, sensors, remotes)
- Controls that fit each device type: on/off switches, dimmer and position sliders, open/stop/close for shutters,
  target temperature stepper, lock/unlock with confirmation
- Live updates over Server-Sent Events, so values change in the UI the moment homee reports them
- Device details: all values, measurements and technical attributes, plus a list of the homeegrams that use the device
- Search and category filters

### Web UI: edit homeegrams
- List of all homeegrams with a readable one-line summary of triggers, conditions and actions
- Search by name, device or time; filter by active/inactive; sort by name or last run
- Run, enable and disable homeegrams with one click
- Visual editor for triggers, conditions and actions: schedules (daily, weekdays, interval, once), sunrise/sunset
  with offset, device and group values, other homeegrams, webhooks, push notifications, time of day
- Schedules are edited in local time and converted to UTC using the offset on the date being edited
- Changes are collected as a draft, checked before saving and sent to homee as one change set
- Create, duplicate, rename and delete homeegrams

### Backup and restore
- Every backup holds all homeegrams, devices and groups as a JSON file in `data/backups/`
- Compare any backup with the current state: each homeegram is shown as unchanged, changed, deleted or new, with a
  before/after summary
- Restore single homeegrams or a selection; deleted ones are recreated, and references between homeegrams (e.g.
  "activate homeegram X") are remapped to the new IDs
- Download backups, or upload one from another machine
- Automatic backups are capped (newest 200 are kept); manual and uploaded backups are never removed

### Swap devices
- Replace an old device with a new one in **all** homeegrams in one step – after a new lock or sensor, or when every
  radiator had to be paired again after a router change
- Several old → new pairs at once; new devices of the same type that are not used anywhere yet are suggested first
- Attributes are matched by type (and instance, e.g. remote buttons); anything that has no counterpart on the new
  device is listed as a warning
- Optionally carries over group memberships (e.g. "Heating") and the device name (the old device gets "(old)")
- Full preview before anything changes, and a backup is taken first

### AI control via MCP
- An MCP server (stdio) that exposes your homee to Claude Code, Claude Desktop or any other MCP client
- Ask questions about your setup, switch devices, or create and change automations in natural language
- Writes go through the same backend as the UI, so backups, read-only mode and the audit log apply to the AI as well

### Safety and transparency
- Automatic backups before homeegrams change (at most every 2 minutes, always before deleting), plus manual backups
- Audit log of every write from the UI, the AI and the REST API, with source and details
- Read-only mode that blocks every write to homee
- Optional API token; required as soon as the backend listens on anything other than localhost
- Optional raw command console for exploring the homee API (off by default)

### Everything else
- User interface in English (default) and German, switchable at the bottom of the sidebar (DE/EN); the choice is remembered
- Works locally (homee IP) or remotely through the homee cloud (homee ID)
- REST API with live events, usable from your own scripts
- Device history and the homee diary, available through the API and MCP

## Architecture

```
packages/homee-client   Shared TypeScript homee client: login, WebSocket, state, readable views
backend                 Fastify REST API + live events (SSE), backups, audit log         → port 5311
frontend                Angular web UI: devices, homeegrams, backups, device swap, log   → port 5310
mcp                     MCP server (stdio) for AI assistants; talks to the backend
```

```
 Browser ──► frontend ──┐
                        ├──► backend ──► homee-client ──WebSocket──► homee (local or cloud)
 AI client ──► mcp ─────┘
```

## Requirements

- Node.js 24.15+ recommended (also supported: 22.22.3+ in the Node 22 line, or 26+)
- A homee with a **dedicated user** for this tool (create one in the homee app). homee allows only one connection per
  device name, so don't reuse the app's login on the same device name.

## Getting started

```bash
git clone https://github.com/dreaddy/cubepilot-for-homee.git
cd cubepilot-for-homee
npm run setup          # install dependencies, then asks for your homee login and writes .env
npm run probe          # test the connection: lists devices and homeegrams
npm start              # backend + frontend → http://localhost:5310
```

`npm run setup` runs a short setup wizard: local (homee IP) or cloud (homee ID), user name and password. It tests
the login before writing `.env`, and fills in the homee ID automatically. `npm start`, `npm run serve` and `npm run probe`
start the wizard too if `.env` is missing. Run `npm run configure` to change the login later; other settings in `.env`
are kept. The same is available in the web UI under **Setup** (small link at the bottom of the sidebar): it tests the
login, writes `.env` and reconnects the backend without a restart. A dedicated homee user is recommended, the admin
login works as well.

For a single process, `npm run serve` builds the frontend and serves everything from the backend on port 5311.
`npm start` reuses a backend that is already running (for example one started by the MCP server).

VS Code users get ready-made tasks and launch configurations in `.vscode/` (start everything, or debug the backend
with breakpoints).

## Configuration

All settings live in `.env` (it is git-ignored). See [.env.example](.env.example).

| Variable | Description |
|---|---|
| `HOMEE_MODE` | `local` (home network, uses `HOMEE_IP`) or `remote` (homee cloud, uses `HOMEE_ID`, works from anywhere) |
| `HOMEE_IP` | IP address of your homee (local mode) |
| `HOMEE_ID` | 12-character homee ID, found in the homee app under Settings → homee (remote mode) |
| `HOMEE_USER` / `HOMEE_PASSWORD` | the homee user created for this tool |
| `HOMEE_DEVICE_NAME` | device name shown in homee; only one connection per name is allowed |
| `BACKEND_HOST` / `BACKEND_PORT` | default `127.0.0.1:5311`. Any other host requires `API_TOKEN` |
| `API_TOKEN` | optional key, sent as `x-api-key` header. Enter it in the UI via **Key** |
| `READ_ONLY` | `true` blocks all writes to homee |
| `KEEP_AUTO_BACKUPS` | number of automatic backups to keep, default `200` |
| `MCP_AUTOSTART_BACKEND` | `true` (default): the MCP server starts the backend if it isn't running (local address only) |
| `ALLOW_RAW` | `true` enables raw commands (console page and `homee_raw_command`) |
| `HOMEE_BACKEND_URL` | backend URL used by the MCP server, default `http://127.0.0.1:5311` |

## AI integration (MCP)

The MCP server reads `.env` on its own. If the backend isn't running, the first MCP command starts it in the background
(log: `data/backend.log`) and waits until it is connected to homee. It keeps running afterwards, so the web UI stays
available; stop it with `npm run stop`. Set `MCP_AUTOSTART_BACKEND=false` to turn this off.

**Claude Code:** the server is already registered in [.mcp.json](.mcp.json). Open the project folder and approve
the server when Claude Code asks.

**Claude Desktop:** add this to `claude_desktop_config.json`, using the absolute path to your checkout:

```json
{
  "mcpServers": {
    "cubepilot": {
      "command": "npx",
      "args": ["tsx", "/path/to/cubepilot-for-homee/mcp/src/index.ts"]
    }
  }
}
```

### Tools

| Tool | Purpose |
|---|---|
| `homee_status` | connection state, homee version, read-only flag |
| `homee_list_devices`, `homee_get_device` | devices with their attributes and current values |
| `homee_set_attribute` | switch, dim, move or set a device value |
| `homee_list_homeegrams`, `homee_get_homeegram` | overview and details, optionally raw |
| `homee_play_homeegram`, `homee_set_homeegram_active` | run, enable or disable |
| `homee_create_homeegram`, `homee_update_homeegram`, `homee_delete_homeegram` | create, rename or change, delete |
| `homee_add_homeegram_item`, `homee_update_homeegram_item`, `homee_delete_homeegram_item` | edit single triggers, conditions and actions |
| `homee_save_homeegram_changes` | apply several item changes in one go |
| `homee_catalog` | numeric codes for item types, operators and attributes |
| `homee_history`, `homee_diary` | value history of devices and homeegrams, homee diary |
| `homee_backup`, `homee_list_backups` | create and list backups |
| `homee_compare_backup`, `homee_restore_homeegrams` | compare a backup with the current state, restore homeegrams |
| `homee_swap_devices_preview`, `homee_swap_devices` | preview and apply a device swap across all homeegrams |
| `homee_raw_command` | raw homee API command (only with `ALLOW_RAW=true`) |

### Example prompts

- *"Which homeegrams close the shutters in the evening?"*
- *"Move the morning lights homeegram to 7:45 am."*
- *"Create a homeegram that turns off all lights at 10 pm."*
- *"Is any window open right now?"*
- *"I replaced the bathroom radiator thermostat – swap the old one for the new one everywhere."*
- *"What did the evening homeegrams look like in yesterday's backup? Restore them."*

## REST API

The backend serves everything under `/api`. Send `x-api-key` if `API_TOKEN` is set.

| Method & path | Purpose |
|---|---|
| `GET /api/status` | connection and configuration state |
| `GET /api/nodes`, `GET /api/nodes/:id` | devices |
| `PUT /api/nodes/:id/attributes/:attributeId` | set a value (`{ "value": 1 }`) |
| `GET /api/nodes/:id/usage` | homeegrams that use a device |
| `GET /api/groups` | groups |
| `GET /api/homeegrams`, `GET /api/homeegrams/:id` | homeegrams (`?full=1`, `?raw=1`) |
| `POST /api/homeegrams` | create a homeegram |
| `PATCH /api/homeegrams/:id` | change fields such as the name |
| `POST /api/homeegrams/:id/changes` | apply a change set (add, update, remove items) |
| `POST /api/homeegrams/:id/play`, `/test` | run, or test run |
| `PUT /api/homeegrams/:id/active` | enable or disable |
| `DELETE /api/homeegrams/:id` | delete (a backup is taken first) |
| `POST`/`PUT`/`DELETE /api/homeegrams/:id/:kind[/:itemId]` | edit single items |
| `GET /api/history/:kind/:id`, `GET /api/diary` | history and diary |
| `GET`/`POST /api/backups`, `GET /api/backups/:file` | list, create and download backups |
| `GET /api/backups/:file/homeegrams` | compare a backup with the current state |
| `POST /api/backups/:file/restore` | restore homeegrams (`{ "ids": [1, 2] }`) |
| `POST /api/backups/import` | upload a backup file |
| `POST /api/swap/preview`, `POST /api/swap/apply` | device swap (`{ "pairs": [{ "from": 12, "to": 34 }], "groups": true, "rename": true }`) |
| `GET /api/audit` | audit log |
| `GET /api/catalog` | numeric codes |
| `GET /api/events` | live events (Server-Sent Events) |
| `POST /api/raw` | raw command (only with `ALLOW_RAW=true`) |

## Good to know

- **Daylight saving time:** recurring schedules use a fixed UTC time. Their local execution time can shift after a
  daylight saving change; review and save the schedule again if it should keep the same local wall-clock time.
- **Change sets are sequential, not transactional.** A failed save can leave some steps applied. The UI reports
  partial results; use the backup to inspect or restore the previous state.
- **Editing and deleting single homeegram items** (`PUT`/`DELETE homeegrams/<id>/<kind>/<item>`) is not documented by
  homee, but works (tested with homee 2.41.6: create, rename, add/change/delete items, delete).
- **Schedules** are stored by homee as an iCal RRULE with the time in **UTC** (11:30 CEST = `BYHOUR=9;BYMINUTE=30`).
  When changing a time, `dtstart` has to be updated too, otherwise homee calculates the next run from the old start.
  The UI and the backend handle this for you.
- **Time-of-day conditions** only accept *day* and *night*; homee rejects morning, noon, evening etc.
- A homeegram action can enable or disable another homeegram, but not play it. To chain homeegrams, use the trigger
  "homeegram was played" instead – it fires for any run, and not when the conditions were false.
- Conditions checked **"at start and end"** also stop delayed actions if they are no longer met when the delay runs out.
- homee's own **diary** only keeps the most recent entries. Homeegrams that run every minute push older entries out
  quickly, so prefer event triggers (e.g. "homee mode becomes …") over minute-by-minute schedules.
- The **console** (with `ALLOW_RAW=true`) lets you explore further API commands; `GET:` commands only read.
- Backups are written to `data/backups/`, the audit log to `data/audit.jsonl`. The `data/` folder is git-ignored.

## Security

- Credentials stay in `.env`, which is never committed.
- By default the backend only listens on `127.0.0.1`. If you expose it, set `API_TOKEN` and put it behind HTTPS.
- Keep `ALLOW_RAW=false` unless you are actively exploring the API.
- Give the homee user for this tool only the permissions it needs.

## Development checks

After installing both the root and frontend dependencies:

```bash
npm test              # regression tests; no homee connection or device commands
npm run typecheck
npm run build
npm audit
npm audit --prefix frontend
```

## Credits

The numeric codes of the homee API (enum tables) are read from the official homee web app at
[my.hom.ee](https://my.hom.ee/), which ships them with its JavaScript. After a homee update, refresh them with
`npm run update-enums` – the script downloads the web app, reads the `ENUMS` object as plain data (nothing is
executed) and regenerates `packages/homee-client/src/enums.ts`. Thanks to Micha for the hint.

The first version of the tables came from [homee-api](https://github.com/stfnhmplr/homee-api) by stfnhmplr (MIT).
See [third-party notices](THIRD_PARTY_NOTICES) for attribution.

## License

[MIT](LICENSE)
