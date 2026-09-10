# Changelog

## 0.5.0

- Check device visibility before inventory reads and cached replies; use authenticated sessions and verify agent replies.
- Parse persistent JSON caches, validate their schema and age, expire version caches after one minute, and preserve force refresh.
- Correlate requests and replies; recover from timeouts/offline devices and ignore superseded results.
- Handle read failures explicitly, ignore commented-out version assignments and application timestamp metadata, and update UI rows in place.
- Update server, agent core and browser together for the correlated request protocol.
