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

dbg('omniosversion module loaded');

module.exports = { consoleaction : consoleaction };
