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

function consoleaction(args, rights, sessionid, parent) {
    isWsconnection = false;
    wscon = parent;
    _sessionid = sessionid;
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

    switch (fnname) {
        case 'readOmni':
            readOmniFile();
        break;
        default:
            // Unknown action; ignore silently
        break;
    }
}

function readOmniFile() {
    var cacheKey = 'plugin_OmniOSVersion_cache';
    var cached = db.Get(cacheKey);
    if (cached && cached.version !== undefined) {
        sendVersion(cached.version);
        return;
    }
    var version = null;
    try {
        if (fs.existsSync('/etc/OmniOS')) {
            var content = fs.readFileSync('/etc/OmniOS').toString();
            var lines = content.split(/\r?\n/);
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
                }
            });
            if (version == null) version = firstPair;
        }
    } catch (e) {
        // Fail silently; will send null
    }
    db.Put(cacheKey, { version: version });
    sendVersion(version);
}

function sendVersion(version) {
    try {
        mesh.SendCommand({
            action: 'plugin',
            plugin: 'omniosversion',
            pluginaction: 'omniData',
            sessionid: _sessionid,
            tag: 'console',
            version: version === undefined ? null : version
        });
    } catch (e) {
        // Ignore send failures
    }
}
