/**
* @description MeshCentral OmniOS Version plugin (agent side)
*/

"use strict";
var mesh;
var _sessionid;
var isWsconnection = false;
var wscon = null;
var db = require('SimpleDataStore').Shared();
var fs = require('fs');

function dbg(msg) {
    try {
        require('MeshAgent').SendCommand({ action: 'msg', type: 'console', value: '[omniosversion-agent] ' + msg });
    } catch (e) { }
}

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
    
    // Безопасная проверка и инициализация args['_']
    if (typeof args['_'] == 'undefined') {
        args['_'] = [];
        args['_'][1] = args.pluginaction;
        args['_'][2] = null;
        args['_'][3] = null;
        args['_'][4] = null;
        isWsconnection = true;
    }

    var fnname = args['_'][1];
    mesh = parent;
    
    dbg('consoleaction called with action: ' + fnname);

    switch (fnname) {
        case 'readOmni':
            dbg('readOmni action called');
            readOmniFile();
        break;
        case 'readLaunchpad':
            dbg('readLaunchpad action called');
            readLaunchpadFile();
        break;
        case 'readApps':
            dbg('readApps action called');
            readAppsFile();
        break;
        default:
            dbg('Unknown action: ' + fnname);
        break;
    }
}

function readOmniFile() {
    dbg('readOmniFile called');
    var cacheKey = 'plugin_OmniOSVersion_cache';
    var cached = db.Get(cacheKey);
    if (cached && cached.version !== undefined) {
        dbg('Found cached version: ' + cached.version);
        sendVersion(cached.version);
        return;
    }
    dbg('No cache found, reading file /etc/OmniOS');
    var version = null;
    try {
        if (fs.existsSync('/etc/OmniOS')) {
            dbg('File /etc/OmniOS exists, reading...');
            var content = fs.readFileSync('/etc/OmniOS').toString();
            dbg('File content length: ' + content.length);
            var lines = content.split(/\r?\n/);
            dbg('Number of lines: ' + lines.length);
            var firstPair = null;
            lines.forEach(function (line) {
                if (!line) return;
                var parts = line.split('=');
                if (parts.length < 2) return;
                var key = parts[0].trim();
                var val = parts.slice(1).join('=').trim();
                if (!firstPair) firstPair = val;
                if (key.toUpperCase() === 'OMNIOS_VER') {
                    version = val;
                    dbg('Found OMNIOS_VER: ' + version);
                }
            });
            if (version == null) {
                version = firstPair;
                dbg('No OMNIOS_VER found, using first value: ' + version);
            }
        } else {
            dbg('File /etc/OmniOS does not exist');
        }
    } catch (e) {
        dbg('Error reading file: ' + e.message);
    }
    dbg('Caching version: ' + version);
    db.Put(cacheKey, { version: version });
    sendVersion(version);
}

function sendVersion(version) {
    dbg('sendVersion called with version: ' + version);
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'omniData',
            sessionid: _sessionid,
            tag: 'console',
            version: version === undefined ? null : version
        };
        dbg('Sending command to server: ' + JSON.stringify(cmd));
        mesh.SendCommand(cmd);
        dbg('Command sent successfully');
    } catch (e) {
        dbg('Error sending version: ' + e.message);
    }
}

function readLaunchpadFile() {
    dbg('readLaunchpadFile called');
    var cacheKey = 'plugin_OmniOSVersion_launchpad_cache';
    var cached = db.Get(cacheKey);
    if (cached && cached.version !== undefined) {
        dbg('Found cached launchpad version: ' + cached.version);
        sendLaunchpadVersion(cached.version);
        return;
    }
    dbg('No cache found, reading file /home/user/launchpad/scripts/config.sh');
    var version = null;
    try {
        var path = '/home/user/launchpad/scripts/config.sh';
        if (fs.existsSync(path)) {
            dbg('File ' + path + ' exists, reading...');
            var content = fs.readFileSync(path).toString();
            dbg('File content length: ' + content.length);
            var lines = content.split(/\r?\n/);
            dbg('Number of lines: ' + lines.length);
            lines.forEach(function (line) {
                if (!line) return;
                var trimmed = line.trim();
                if (trimmed.indexOf('launchpad_ver=') !== -1) {
                    var parts = trimmed.split('=');
                    if (parts.length >= 2) {
                        version = parts.slice(1).join('=').trim();
                        dbg('Found launchpad_ver: ' + version);
                    }
                }
            });
        } else {
            dbg('File ' + path + ' does not exist');
        }
    } catch (e) {
        dbg('Error reading launchpad file: ' + e.message);
    }
    dbg('Caching launchpad version: ' + version);
    db.Put(cacheKey, { version: version });
    sendLaunchpadVersion(version);
}

function sendLaunchpadVersion(version) {
    dbg('sendLaunchpadVersion called with version: ' + version);
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'launchpadData',
            sessionid: _sessionid,
            tag: 'console',
            version: version === undefined ? null : version
        };
        dbg('Sending launchpad command to server: ' + JSON.stringify(cmd));
        mesh.SendCommand(cmd);
        dbg('Launchpad command sent successfully');
    } catch (e) {
        dbg('Error sending launchpad version: ' + e.message);
    }
}

// Reads application versions from /var/nr/apps.ver and sends them back
function readAppsFile() {
    dbg('readAppsFile called');
    var path = '/var/nr/apps.ver';
    var apps = [];
    var updated = null;
    try {
        if (fs.existsSync(path)) {
            dbg('File ' + path + ' exists, reading...');
            var content = fs.readFileSync(path).toString();
            dbg('File content length: ' + content.length);
            var lines = content.split(/\r?\n/);
            lines.forEach(function (line) {
                if (!line) return;
                var trimmed = line.trim();
                if (trimmed.length === 0) return;
                // Try to detect an update timestamp line
                if (!updated && /update|updated|date|timestamp/i.test(trimmed)) {
                    updated = trimmed.replace(/^\s*[-#;]*/,'').trim();
                }
                // Parse possible formats: key=value, name: version, "Name version: x", "Name x.y.z"
                var name = null, version = null;
                if (trimmed.indexOf('=') !== -1) {
                    var partsEq = trimmed.split('=');
                    name = partsEq[0].trim();
                    version = partsEq.slice(1).join('=').trim();
                } else if (trimmed.indexOf(':') !== -1) {
                    var partsCol = trimmed.split(':');
                    name = partsCol[0].trim();
                    version = partsCol.slice(1).join(':').trim();
                } else {
                    // Fallback: split by whitespace, last token as version
                    var partsWs = trimmed.split(/\s+/);
                    if (partsWs.length >= 2) {
                        version = partsWs.pop();
                        name = partsWs.join(' ');
                    }
                }
                if (name && version) {
                    apps.push({ name: name, version: version });
                }
            });
            // If no explicit updated found, use file mtime
            try {
                var stat = fs.statSync(path);
                if (stat && stat.mtime) {
                    updated = updated || ('Updated: ' + new Date(stat.mtime.getTime()).toISOString());
                }
            } catch (e2) { }
        } else {
            dbg('File ' + path + ' does not exist');
        }
    } catch (e) {
        dbg('Error reading apps file: ' + e.message);
    }
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'appsData',
            sessionid: _sessionid,
            tag: 'console',
            apps: apps,
            updated: updated
        };
        dbg('Sending appsData to server: ' + JSON.stringify({ pluginaction: cmd.pluginaction, count: apps.length, updated: updated }));
        mesh.SendCommand(cmd);
    } catch (e3) {
        dbg('Error sending appsData: ' + e3.message);
    }
}

dbg('omniosversion module loaded');

module.exports = { consoleaction : consoleaction };
