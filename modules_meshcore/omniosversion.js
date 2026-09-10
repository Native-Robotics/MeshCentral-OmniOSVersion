/**
* @description MeshCentral OmniOS Version plugin (agent side)
*/

"use strict";
var mesh;
var _sessionid;
var _requestId;
var CACHE_TTL_MS = 60000;
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
    _requestId = typeof args.requestId === 'string' ? args.requestId : undefined;
    
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
    var force = !!args.force;
    mesh = parent;

    dbg('consoleaction called with action: ' + fnname + ', force: ' + force);

    switch (fnname) {
        case 'readOmni':
            dbg('readOmni action called');
            readOmniFile(force);
        break;
        case 'readLaunchpad':
            dbg('readLaunchpad action called');
            readLaunchpadFile(force);
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

function readCachedVersion(key) {
    try {
        var raw = db.Get(key);
        var cached = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (cached && (typeof cached.version === 'string' || cached.version === null) &&
            typeof cached.time === 'number' && Date.now() >= cached.time && Date.now() - cached.time < CACHE_TTL_MS) return cached;
    } catch (e) { }
    return null;
}

function saveVersion(key, version) {
    try { db.Put(key, { version: version, time: Date.now() }); } catch (e) { dbg('Cannot cache version: ' + e); }
}

function unquote(value) {
    if ((value.charAt(0) === '"' && value.slice(-1) === '"') ||
        (value.charAt(0) === "'" && value.slice(-1) === "'")) return value.slice(1, -1);
    return value;
}

function readOmniFile(force) {
    dbg('readOmniFile called, force: ' + !!force);
    var cacheKey = 'plugin_OmniOSVersion_cache';
    if (!force) {
        var cached = readCachedVersion(cacheKey);
        if (cached && cached.version !== undefined) {
            dbg('Found cached version: ' + cached.version);
            sendVersion(cached.version);
            return;
        }
    }
    dbg('Reading file /etc/OmniOS');
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
                if (!line || /^\s*#/.test(line)) return;
                var parts = line.split('=');
                if (parts.length < 2) return;
                var key = parts[0].trim();
                var val = unquote(parts.slice(1).join('=').trim());
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
        sendVersion(null, 'Cannot read OmniOS version: ' + e.message);
        return;
    }
    dbg('Caching version: ' + version);
    saveVersion(cacheKey, version);
    sendVersion(version);
}

function sendVersion(version, error) {
    dbg('sendVersion called with version: ' + version);
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'omniData',
            sessionid: _sessionid,
            requestId: _requestId,
            tag: 'console',
            error: error,
            version: version === undefined ? null : version
        };
        dbg('Sending command to server: ' + JSON.stringify(cmd));
        mesh.SendCommand(cmd);
        dbg('Command sent successfully');
    } catch (e) {
        dbg('Error sending version: ' + e.message);
    }
}

function readLaunchpadFile(force) {
    dbg('readLaunchpadFile called, force: ' + !!force);
    var cacheKey = 'plugin_OmniOSVersion_launchpad_cache';
    if (!force) {
        var cached = readCachedVersion(cacheKey);
        if (cached && cached.version !== undefined) {
            dbg('Found cached launchpad version: ' + cached.version);
            sendLaunchpadVersion(cached.version);
            return;
        }
    }
    dbg('Reading file /home/user/launchpad/scripts/config.sh');
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
                var match = trimmed.match(/^(?:export\s+)?launchpad_ver\s*=\s*(.*)$/);
                if (match) version = unquote(match[1].trim());
            });
        } else {
            dbg('File ' + path + ' does not exist');
        }
    } catch (e) {
        sendLaunchpadVersion(null, 'Cannot read Launchpad version: ' + e.message);
        return;
    }
    dbg('Caching launchpad version: ' + version);
    saveVersion(cacheKey, version);
    sendLaunchpadVersion(version);
}

function sendLaunchpadVersion(version, error) {
    dbg('sendLaunchpadVersion called with version: ' + version);
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'launchpadData',
            sessionid: _sessionid,
            requestId: _requestId,
            tag: 'console',
            error: error,
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
    var readError;
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
                if (/^(?:[-#;]\s*)*(?:last\s+)?(?:update(?:d)?|date|timestamp)\s*[:=]/i.test(trimmed)) {
                    updated = trimmed.replace(/^\s*[-#;]*/, '').trim();
                    return;
                }
                if (/^[#;]/.test(trimmed)) return;
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
        readError = 'Cannot read application versions: ' + e.message;
    }
    try {
        var cmd = {
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'appsData',
            sessionid: _sessionid,
            requestId: _requestId,
            tag: 'console',
            error: readError,
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
