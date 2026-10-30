# Spy & Impostor — Real-time multiplayer starter

A browser-based Node.js + Express + Socket.IO implementation of the approved Spy & Impostor game.

## Requirements
- Node.js 20+
- npm

## Run locally
```bash
npm install
npm start
```
Open http://localhost:3000 in multiple browser windows/devices. For devices on the same network, use the host computer's LAN IP and port 3000. Allow inbound TCP 3000 in the host firewall.

## Room-name validation
Room names must match `^[A-Za-z0-9_]{1,10}$`. Spaces and punctuation are rejected. Uniqueness is case-insensitive. The six-character joining code is generated separately.

## Current implementation
- 2–8 player rooms and six-character joining codes
- 1–10 character room names using letters, digits, and underscore
- Host-created rooms and lobby
- Five rounds, related secret-word pairs, one Spy per round
- Private role/word delivery
- Clue submission, timed discussion chat, Spy word guess, anonymous voting
- Three revert tokens per player, shared across the tournament
- Special two-player duel scoring
- Live scoreboard and round reveal

## Deployment
This is a source-code starter, not a hosted public game. Deploy the Node service to a persistent Node.js host that supports WebSockets (for example, Render, Railway, Fly.io, or a VPS). Set the service start command to `npm start` and expose the assigned `PORT`.

## Production hardening still required
Before public launch, add persistent storage, authenticated/reconnectable player identities, robust disconnect and host-transfer handling, rate limiting, input moderation, automated tests, server-side event authorization audits, and a proper revote flow for tied votes. The current in-memory room state is lost on server restart.

## Deploy to Render
1. Push the contents of this folder to a GitHub repository.
2. In Render, choose **New > Web Service** and connect that repository.
3. Render can detect `render.yaml`; otherwise use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/health`
4. Deploy and open the generated `https://...onrender.com` URL.
5. Test with at least two devices and separate browsers. Socket.IO uses the same origin and WebSocket upgrade automatically.

The current starter keeps rooms and scores in process memory. A server restart clears active games. For a public production launch, add persistent storage and shared coordination (for example Redis) before running multiple instances. Also complete the security and disconnect/reconnect hardening listed above.
