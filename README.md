# MeshCentral OmniOS Version

Shows OmniOS, Launchpad and application versions on the device General tab. The MeshAgent reads the inventory files on the device; the MeshCentral plugin checks device visibility before returning inventory to a browser.

## Inventory sources

| Row | Device source |
|---|---|
| OmniOS | `/etc/OmniOS`, `OMNIOS_VER` or the first parsed value |
| Launchpad | `/home/user/launchpad/scripts/config.sh`, `launchpad_ver` assignment |
| Apps | `/var/nr/apps.ver`, application name/version pairs |

Quoted version values are unquoted, commented-out Launchpad assignments are ignored, and application timestamp/comment lines are excluded from the application list. Missing inventory is shown as `None`; read, offline and request failures are shown as errors.

## Caching and refresh

- OmniOS and Launchpad values are cached for one minute on the agent and server. Agent cache entries are parsed from JSON and checked for field types and age; old cache formats are read again from the source files.
- Application inventory is cached on the server for 24 hours; the agent reads it on each request. The displayed update time is the time MeshCentral received that inventory.
- **Refresh** bypasses the caches for all three inventories. A stable agent-core connection also triggers fresh inventory reads.
- Read errors do not overwrite the agent cache with a successful null result.
- Requests time out after 30 seconds on the server, with a 35-second browser fallback. They can then be retried without restarting MeshCentral.
- Replies are matched by agent connection and request ID. Late responses and old timers cannot overwrite a newer request. Existing rows update in place so the adjacent SendLogs Export row remains in position.

## Installation and update

Enable plugins in MeshCentral and install through the plugin manager. For manual installation, use `<meshcentral-data>/plugins/omniosversion/` and register `omniosversion` through the plugin database or `settings.plugins.list`.

Version 0.5.0 requires coordinated server/agent/browser updates because replies now include request IDs:

1. Copy the updated files into the installed plugin directory and use **Reload** for the server plugin.
2. Rebuild and synchronize the agent core on a test device from an authenticated admin browser console:

   ```javascript
   meshserver.send({action: 'uploadagentcore', type: 'default', nodeids: ['node/<domain>/<device-id>']});
   ```

3. Wait for the core to become stable, fully reload the device page and verify all three inventory rows and **Refresh**.

In this MeshCentral checkout, `distributeCore()` synchronizes an already built bundle; it does not rebuild edited agent module files. Avoid redistributing cores during another plugin's active device operation.

## Access

Users must be able to see the requested device in their authenticated domain. The server checks access before serving caches or requesting agent data, and checks it again before delivering results. A browser-supplied session ID cannot redirect the reply to another session. The agent process must have read access to the inventory files.

No admin panel or additional plugin configuration is required.

## Development

Run tests with Node.js 18 or newer:

```sh
node --test tests/*.test.js
```

Tests cover authorization, persistent-cache migration/expiry/force refresh, read failures, request timeouts and stale replies, serialized browser functions, stable row updates, and the full protocol round trip with mocked device I/O. A deployment check on an actual OmniOS device is still required to validate its MeshAgent runtime and filesystem.
