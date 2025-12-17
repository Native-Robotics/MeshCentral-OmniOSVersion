# MeshCentral OmniOS Version

The plugin shows the OmniOS version on the General tab of the "My Devices" page. The value is read from the `/etc/OmniOS` file on the agent and cached on the agent side.

## Features

- Displays after the tags/relay block.
- If `/etc/OmniOS` is missing, shows `None`.
- Per-agent caching: repeat requests avoid re-reading the file until the agent restarts.
- No admin panel or configuration.

## Installation

1. Copy the `MeshCentral-OmniOSVersion` folder into the MeshCentral plugins directory.
2. Restart MeshCentral to load the plugin.

## Usage

- Open a device on "My Devices" → General tab.
- The plugin automatically requests the version from the agent and shows `OmniOS: <version|None>`.

## Requirements

- The agent must be able to read `/etc/OmniOS`.

## Support

- Code comments and log messages are in English; UI text is in English here as well.
