# Study Quest

Full-stack study gamification app using Node.js + Express + SQLite.

## Run
1. Install Node.js 20+.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

For production, set a strong `SESSION_SECRET`, enable HTTPS, and configure secure cookies/reverse proxy.

### Included
- Register/login/logout with bcrypt password hashing
- Unique usernames at DB level
- Per-user profiles + public/private notes
- Timestamp-based study sessions (survive page/browser close)
- Server-side completion checks, XP, levels, daily stats, streaks and +3 spins
- Spin animation + study/rest/special events
- Friends and friend requests
- Top 100 leaderboard with level/streak/time sorting
- Responsive mobile-friendly UI
