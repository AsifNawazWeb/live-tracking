# Location Tracker

Disclosed employee location tracking for a courier business.

- **Android app** (employee's phone): first launch shows a short registration form (name, email, UK National Insurance number, phone, consent tick) — submit and tracking starts automatically, no server URL or codes to type.
- **Node.js server**: ingests locations and serves the owner dashboard.
- **Owner dashboard**: password-protected live map (all couriers), today's trails, per-employee history playback and CSV export. Shows each employee's email / NI / phone / device; details can be edited after registration.
- **Kill switch**: deactivating an employee in the dashboard makes their app stop reporting within ~60 s.

> Tracking is disclosed by design: the consent checkbox on the registration form, the persistent notification, and Android's own location icon are all visible to the employee. Covert tracking is neither implemented nor supported.

---

## 1. Run the server (local)

```bash
cd server
npm install
cp .env.example .env      # then edit: set ADMIN_USER, ADMIN_PASSWORD_HASH, SESSION_SECRET
node -e "console.log(require('bcrypt').hashSync('your_password', 12))"   # make the hash
node src/index.js
```

Dashboard: http://localhost:3000/admin — log in with the credentials you configured.

No `.env` yet? The server still boots with `admin` / `admin` — change it before real use.

### Enable employees' phones to reach the server

While the server runs on your PC, only phones on the **same Wi-Fi** can send data.

1. Find your PC's LAN IP: `hostname -I` (Linux) or `ipconfig` (Windows), e.g. `192.168.1.10`.
2. Bake that URL into the APK at build time (next section) — employees never type it.
3. If it doesn't connect, allow port 3000 through your firewall.

Remote tracking (from anywhere) needs the server on a VPS with HTTPS — see §5.

---

## 2. Employees: self-registration (no access tokens to hand out)

Employees register themselves — the server URL is baked into the app, and the **first page** the app opens is a registration form:

- Full name
- Email address (unique — reinstalling on a new phone re-links the same person, no duplicates)
- **UK National Insurance number** (validated: e.g. `AB123456C`)
- UK phone number
- Consent tick ("I consent to my location being tracked") — required, tracking starts immediately after submit

The device model (e.g. "Pixel 7") is auto-attached. Everything appears instantly on the dashboard's live map under their name; rename or correct details any time via **Employees → Edit**.

Optionally set `REGISTRATION_KEY` in `server/.env` and build the APK with the same value — then only your APK can register (blocks random public signups).

Prefer the API instead?

```bash
curl -c jar.txt -d 'username=admin&password=YOURPASS' http://localhost:3000/login
curl -b jar.txt -H 'Content-Type: application/json' \
  -d '{"name":"Ali"}' http://localhost:3000/api/employees
```

---

## 3. Build + install the app

No Android Studio needed — the included GitHub Actions workflow builds the APK for you:

1. Push this repo to GitHub.
2. Actions → "Build Android APK" → enter your **Server URL** (e.g. `https://tracker.yourdomain.com`) and optionally the `REGISTRATION_KEY` → download artifact `work-tracker-apk` → `app-debug.apk`.
   The server URL and registration key are **baked into the APK** — nothing for employees to configure. Defaults (no input): `http://192.168.1.10:3000`.
   (Or build locally: `cd android && gradle assembleDebug -PSERVER_URL=https://tracker.yourdomain.com -PREGISTRATION_KEY=yourkey`.)

On the employee's phone:

1. Copy `app-debug.apk` to the phone (WhatsApp/USB/Drive), tap it, allow "install unknown apps" when prompted.
2. Open **Work Tracker** → the **registration form** is the first page → fill in the 5 fields, tick consent → **Submit & start tracking**.
3. Grant Android's prompts: location (choose **"Allow all the time"** if asked), notifications, battery exemption.
4. "Tracking active" notification appears. GPS is sent every 60 s — foreground, background, locked.

Reinstalling the app (new phone or wipe): the same email re-registers and resumes the same employee record. Changing the baked-in server needs a new APK, not a reinstall.

---

## 4. Dashboard

- **Live map tab** — courier positions, "live"/"no signal" badges, battery, today's trails; auto-refreshes every 30 s and pushes instantly via WebSocket.
- **Employees tab** — self-registered employees appear automatically with name, email, NI number, phone and device; Edit to correct/rename; deactivate/activate (kill switch); Delete.
- **History tab** — pick employee + time range → route on map, start/end pins, CSV export.

## 5. Production on a VPS (~$5/mo, any provider)

```bash
# on the VPS (Ubuntu):
git clone <your-repo> && cd location-tracker/server
npm install && cp .env.example .env   # set strong SESSION_SECRET + ADMIN creds
node src/index.js                     # or: npm i -g pm2 && pm2 start src/index.js --name tracker
```

Point a domain at the VPS and put HTTPS in front (required if you ever use the browser geolocation variant; the Android app works over plain HTTP too but HTTPS is strongly recommended):

```bash
apt install caddy
# /etc/caddy/Caddyfile:
#   tracker.yourdomain.com {
#     reverse_proxy 127.0.0.1:3000
#   }
systemctl reload caddy
```

Then the baked-in app server URL becomes `https://tracker.yourdomain.com` (rebuild the APK with it), and set `cookie.secure` accordingly (patch `index.js`: `cookie: { maxAge, secure: true }`).

---

## 6. API reference

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/register` | optional `X-Registration-Key` | self-registration `{name, email, ni_number, phone, device_name, consent}` → upserts by email, returns `{token, active}` |
| `POST /api/v1/location` | device token | `{token, lat, lng, accuracy?, speed?, bearing?, battery?}` → saves + broadcasts |
| `GET /api/v1/ping?token=` | device token | server liveness + active check (app boot retry) |
| `POST /login` | — | admin login (form) |
| `GET /api/live` | session | latest position per active employee |
| `GET /api/employees` | session | list w/ last location |
| `POST /api/employees` | session | create → returns `device_token` (manual/code path for pre-installed phones) |
| `PATCH /api/employees/:id` | session | `{"active":false}` = kill switch; also `name`, `email`, `ni_number`, `phone`, `device_name` |
| `DELETE /api/employees/:id` | session | delete + history |
| `GET /api/employees/:id/locations?from=&to=` | session | history JSON |
| `GET /api/employees/:id/locations.csv` | session | CSV export |
| `WS /live` | open | browser push of `{type:"location",...}` |

## 7. Roadmap / limitations

- iOS not supported (Android only)
- Designated-route overlay + deviation alerts
