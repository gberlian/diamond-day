# Countdown

Open `index.html` in a browser or serve it with any static web host. A link with `?to=2027-01-01T00:00` sets a target; without a target the clock counts down to the next New Year. The date field updates the clock and address.

From the project folder, `bun site/test/e2e.mjs` runs five real browser checks and writes two screenshots in `site/test/shots/`. Install Chrome, Edge or Chromium first; set `CHROME` to the browser executable if discovery fails. Node 22+ can run the same script. Pass a public HTTPS address as the final argument to check a deployed page. The test starts a temporary loopback server for a local run and stops it afterwards.
