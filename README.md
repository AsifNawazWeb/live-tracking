# Location Tracker

Disclosed employee location tracking for a courier business.

- **Android app** (employee's phone): shows a one-time consent screen ("This app tracks your location"), then a foreground service reports GPS every 60 seconds — while the phone is locked, all day — with the mandatory Android notification visible.
- **Node.js server**: ingests locations and serves the owner dashboard.
- **Owner dashboard**: password-protected live map (all couriers), today's trails, per-employee history playback and CSV export.
- **Kill switch**: deactivating an employee in the dashboard makes their app stop reporting within ~60 s.

> Tracking is disclosed by design: the consent screen, the persistent notification, and Android's own location icon are all visible to the employee. Covert tracking is neither implemented nor supported.

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
2. In the app, enter server URL `http://192.168.1.10:3000`.
3. If it doesn't connect, allow port 3000 through your firewall.

Remote tracking (from anywhere) needs the server on a VPS with HTTPS — see §5.

---

## 2. Create an employee + activation code

Dashboard → **Employees** tab → enter the name → **Add employee**.

The highlighted box shows the **activation code** (with a copy button) and it later appears under the employee's name in the list. One employee = one phone. In the same tab you can also:

- **Deactivate / Activate** — the kill switch: a deactivated employee's phone stops reporting within ~60 s; re-activating resumes automatically within ~15 min.
- **Delete** — removes the employee and all their history.

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
2. Actions → "Build Android APK" → download artifact `work-tracker-apk` → `app-debug.apk`.
   (Or build locally: install Android SDK, then `cd android && gradle assembleDebug`.)

On the employee's phone:

1. Copy `app-debug.apk` to the phone (WhatsApp/USB/Drive), tap it, allow "install unknown apps" when prompted.
2. Open **Work Tracker** → consent screen ("This app tracks your location") → **Accept**.
3. Enter **Server URL** and the employee's **activation code** from step 2 → **Start tracking**.
4. Grant Android's prompts: location (choose **"Allow all the time"** if asked), notifications, battery exemption.
5. "Tracking active" notification appears. GPS is sent every 60 s — foreground, background, locked.

Changing the server or code later: clear the app from Settings, or reinstall.

---

## 4. Dashboard

- **Live map tab** — courier positions, "live"/"no signal" badges, battery, today's trails; auto-refreshes every 30 s and pushes instantly via WebSocket.
- **Employees tab** — add employees (activation code + copy), deactivate/activate (kill switch), delete.
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

Then the app's Server URL becomes `https://tracker.yourdomain.com`, and set `cookie.secure` accordingly (patch `index.js`: `cookie: { maxAge, secure: true }`).

---

## 6. API reference

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/location` | device token | `{token, lat, lng, accuracy?, speed?, bearing?, battery?}` → saves + broadcasts |
| `GET /api/v1/ping?token=` | device token | server liveness + active check (app boot retry) |
| `POST /login` | — | admin login (form) |
| `GET /api/live` | session | latest position per active employee |
| `GET /api/employees` | session | list w/ last location |
| `POST /api/employees` | session | create → returns `device_token` (activation code) |
| `PATCH /api/employees/:id` | session | `{"active":false}` = kill switch |
| `DELETE /api/employees/:id` | session | delete + history |
| `GET /api/employees/:id/locations?from=&to=` | session | history JSON |
| `GET /api/employees/:id/locations.csv` | session | CSV export |
| `WS /live` | open | browser push of `{type:"location",...}` |

## 7. Roadmap / limitations

- iOS not supported (Android only)
- Designated-route overlay + deviation alerts
