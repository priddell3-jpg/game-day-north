# Security

Game Day North stores no accounts, passwords, payment details, location history,
or private user records. Team, service, spoiler, and display preferences remain
on the viewer's device in `localStorage`.

The iOS app ships its HTML, CSS, JavaScript, and fonts inside the signed app. It
does not load executable application code from the public website. Remote hosts
provide schedule and live-score JSON only; native requests are HTTPS-only and
restricted to the hosts listed in `src/native-bridge.js`. External links open in
the system browser rather than inside the app WebView.

Do not commit API keys, Apple signing certificates, provisioning profiles,
tokens, or `.env` files. Client-side files and an installed app can always be
inspected, so a secret needed by a future data provider belongs in a protected
server environment and must never be bundled into this repository's web or iOS
assets.

## Reporting a vulnerability

Please do not disclose a possible vulnerability in a public issue. If GitHub's
Security tab offers **Report a vulnerability**, use that private form. Otherwise,
contact the repository owner privately before publishing details.
