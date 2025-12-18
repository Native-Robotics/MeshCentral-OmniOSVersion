/**
* @description MeshCentral OmniOS Version Plugin
*/

"use strict";

module.exports.omniosversion = function (parent) {
    var obj = {};
    obj.parent = parent;
    obj.meshServer = parent.parent;
    obj.debug = obj.meshServer.debug;
    obj.cache = {}; // nodeid => { version, time }
        obj.appsCache = {}; // nodeid => { apps, updated, time }
    obj.pending = {}; // nodeid => [sessionIds]
        obj.pendingApps = {}; // nodeid => [sessionIds]
    obj.inflight = {}; // nodeid => boolean
        obj.inflightApps = {}; // nodeid => boolean
        obj.appsTtlMs = 24 * 60 * 60 * 1000; // 24h TTL; manual refresh available
    obj.exports = [
      'onDeviceRefreshEnd',
      'omniData',
      'requestOmni',
            'appsData',
            'requestApps',
            'refreshApps',
      'injectGeneral',
      'escapeHtml'
    ];

    // --- server-side helpers ---
    obj.sendToSession = function (sessionid, myparent, msg, grandparent) {
        if (sessionid && grandparent && grandparent.wssessions2 && grandparent.wssessions2[sessionid]) {
            try { grandparent.wssessions2[sessionid].send(JSON.stringify(msg)); return; } catch (e) { }
        }
        if (myparent && myparent.ws) {
            try { myparent.ws.send(JSON.stringify(msg)); } catch (e) { }
        }
    };

    obj.queueSession = function (nodeid, sessionid) {
        if (!nodeid || !sessionid) return;
        if (!obj.pending[nodeid]) obj.pending[nodeid] = [];
        if (obj.pending[nodeid].indexOf(sessionid) === -1) obj.pending[nodeid].push(sessionid);
    };

    obj.flushPending = function (nodeid, msg, grandparent) {
        if (!nodeid || !obj.pending[nodeid]) return;
        obj.pending[nodeid].forEach(function (sess) {
            if (grandparent && grandparent.wssessions2 && grandparent.wssessions2[sess]) {
                try { grandparent.wssessions2[sess].send(JSON.stringify(msg)); } catch (e) { }
            }
        });
        delete obj.pending[nodeid];
    };

    obj.queueSessionApps = function (nodeid, sessionid) {
        if (!nodeid || !sessionid) return;
        if (!obj.pendingApps[nodeid]) obj.pendingApps[nodeid] = [];
        if (obj.pendingApps[nodeid].indexOf(sessionid) === -1) obj.pendingApps[nodeid].push(sessionid);
    };

    obj.flushPendingApps = function (nodeid, msg, grandparent) {
        if (!nodeid || !obj.pendingApps[nodeid]) return;
        obj.pendingApps[nodeid].forEach(function (sess) {
            if (grandparent && grandparent.wssessions2 && grandparent.wssessions2[sess]) {
                try { grandparent.wssessions2[sess].send(JSON.stringify(msg)); } catch (e) { }
            }
        });
        delete obj.pendingApps[nodeid];
    };

    obj.requestFromAgent = function (nodeid) {
        obj.debug('omniosversion', 'requestFromAgent called for:', nodeid);
        if (!nodeid) {
            obj.debug('omniosversion', 'requestFromAgent: no nodeid');
            return;
        }
        if (obj.inflight[nodeid]) {
            obj.debug('omniosversion', 'requestFromAgent: already in flight for', nodeid);
            return;
        }
        obj.inflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) { 
            obj.debug('omniosversion', 'requestFromAgent: agent not found for', nodeid);
            obj.inflight[nodeid] = false; 
            return; 
        }
        try {
            obj.debug('omniosversion', 'requestFromAgent: sending readOmni command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'readOmni' }));
        } catch (e) {
            obj.debug('omniosversion', 'requestFromAgent: error sending to agent', nodeid, e);
            obj.inflight[nodeid] = false;
        }
    };

    obj.requestAppsFromAgent = function (nodeid) {
        obj.debug('omniosversion', 'requestAppsFromAgent called for:', nodeid);
        if (!nodeid) { obj.debug('omniosversion', 'requestAppsFromAgent: no nodeid'); return; }
        if (obj.inflightApps[nodeid]) { obj.debug('omniosversion', 'requestAppsFromAgent: already inflight for', nodeid); return; }
        obj.inflightApps[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) { obj.debug('omniosversion', 'requestAppsFromAgent: agent not found for', nodeid); obj.inflightApps[nodeid] = false; return; }
        try {
            obj.debug('omniosversion', 'requestAppsFromAgent: sending readApps command to', nodeid);
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'readApps' }));
        } catch (e) {
            obj.debug('omniosversion', 'requestAppsFromAgent: error sending to agent', nodeid, e);
            obj.inflightApps[nodeid] = false;
        }
    };

    // --- hooks ---
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        obj.debug('omniosversion', 'hook_agentCoreIsStable called for node:', myparent.dbNodeKey);
        obj.requestFromAgent(myparent.dbNodeKey);
        obj.requestAppsFromAgent(myparent.dbNodeKey);
    };

    obj.serveraction = function (command, myparent, grandparent) {
        obj.debug('omniosversion', 'serveraction called with pluginaction:', command.pluginaction);
        switch (command.pluginaction) {
            case 'getOmni': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                obj.debug('omniosversion', 'getOmni request for node:', nodeid);
                if (!nodeid) {
                    obj.debug('omniosversion', 'getOmni: no nodeid');
                    return;
                }
                var cached = obj.cache[nodeid];
                var msg = { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: nodeid, version: null } };
                if (cached) {
                    obj.debug('omniosversion', 'getOmni: returning cached version:', cached.version);
                    msg.data.version = cached.version;
                    obj.sendToSession(command.sessionid, myparent, msg, grandparent);
                    return;
                }
                obj.debug('omniosversion', 'getOmni: no cache, queuing session and requesting from agent');
                obj.queueSession(nodeid, command.sessionid);
                obj.sendToSession(command.sessionid, myparent, { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: nodeid, version: null } }, grandparent);
                obj.requestFromAgent(nodeid);
                break;
            }
            case 'omniData': {
                var node = myparent.dbNodeKey;
                obj.debug('omniosversion', 'omniData received from agent:', node, 'version:', command.version);
                if (!node) {
                    obj.debug('omniosversion', 'omniData: no node');
                    return;
                }
                obj.cache[node] = { version: (command.version === null ? null : command.version || null), time: Date.now() };
                var outMsg = { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: node, version: obj.cache[node].version } };
                obj.debug('omniosversion', 'omniData: flushing to pending sessions');
                obj.flushPending(node, outMsg, grandparent);
                obj.inflight[node] = false;
                break;
            }
            case 'getApps': {
                var nodeid2 = command.nodeid || myparent.dbNodeKey;
                var force = !!command.force;
                obj.debug('omniosversion', 'getApps request for node:', nodeid2, 'force:', force);
                if (!nodeid2) { obj.debug('omniosversion', 'getApps: no nodeid'); return; }
                var cachedApps = obj.appsCache[nodeid2];
                var fresh = cachedApps && ((Date.now() - cachedApps.time) < obj.appsTtlMs);
                var msgApps = { action: 'plugin', plugin: 'omniosversion', method: 'appsData', data: { nodeid: nodeid2, apps: (cachedApps ? cachedApps.apps : null), updated: (cachedApps ? cachedApps.updated : null) } };
                if (cachedApps && fresh && !force) {
                    obj.debug('omniosversion', 'getApps: returning cached apps; count:', (cachedApps.apps ? cachedApps.apps.length : 0));
                    obj.sendToSession(command.sessionid, myparent, msgApps, grandparent);
                    return;
                }
                obj.debug('omniosversion', 'getApps: cache miss/stale or force; queuing and requesting from agent');
                obj.queueSessionApps(nodeid2, command.sessionid);
                // Send immediate response with current (possibly null) cache to update UI
                obj.sendToSession(command.sessionid, myparent, msgApps, grandparent);
                obj.requestAppsFromAgent(nodeid2);
                break;
            }
            case 'appsData': {
                var node3 = myparent.dbNodeKey;
                if (!node3) { obj.debug('omniosversion', 'appsData: no node'); return; }
                var appsArr = Array.isArray(command.apps) ? command.apps : [];
                var upd = command.updated || null;
                obj.appsCache[node3] = { apps: appsArr, updated: upd, time: Date.now() };
                var outMsg2 = { action: 'plugin', plugin: 'omniosversion', method: 'appsData', data: { nodeid: node3, apps: appsArr, updated: upd } };
                obj.debug('omniosversion', 'appsData: received; apps:', appsArr.length, 'updated:', upd);
                obj.flushPendingApps(node3, outMsg2, grandparent);
                obj.inflightApps[node3] = false;
                break;
            }
        }
    };

    // --- client-side helpers ---
    obj.escapeHtml = function (unsafe) {
        if (unsafe == null) return '';
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    };

    obj.injectGeneral = function () {
        console.log('[omniosversion] injectGeneral called');
        if (typeof document === 'undefined') {
            console.log('[omniosversion] document is undefined');
            return;
        }
        if (!currentNode) {
            console.log('[omniosversion] currentNode is undefined');
            return;
        }

        // Получаем данные OmniOS
        var data = (pluginHandler.omniosversion.nodeCache || {})[currentNode._id];
        var text = 'Loading...';
        if (data) {
            text = (data.version == null || data.version === '') ? 'None' : pluginHandler.omniosversion.escapeHtml(String(data.version));
            console.log('[omniosversion] displaying version:', text);
        } else {
            console.log('[omniosversion] no omni data in cache for node:', currentNode._id);
        }

        // Получаем данные Apps
        var appsCache = (pluginHandler.omniosversion.nodeAppsCache || {})[currentNode._id];
        var appsHtml = 'Loading...';
        var appsCount = 0;
        var updatedTxt = '';
        if (appsCache) {
            if (Array.isArray(appsCache.apps) && appsCache.apps.length > 0) {
                appsCount = appsCache.apps.length;
                // Align Name and Version using monospace preformatted block
                var lines = [];
                var maxNameLen = 0;
                appsCache.apps.forEach(function (x) {
                    var name = (x.name || '').trim();
                    var version = (x.version || '').trim();
                    maxNameLen = Math.max(maxNameLen, name.length);
                    lines.push({ name: name, version: version });
                });
                var padded = lines.map(function (l) {
                    var spaces = Array((maxNameLen - l.name.length) + 2).join(' '); // 2-space gap
                    var s = l.name + spaces + l.version;
                    return pluginHandler.omniosversion.escapeHtml(s);
                }).join('\n');
                appsHtml = '<pre style="margin:0; white-space: pre; font-family: monospace;">' + padded + '</pre>';
            } else {
                appsHtml = 'None';
            }
            if (appsCache.updated) { updatedTxt = ' (Last updated: ' + pluginHandler.omniosversion.escapeHtml(String(appsCache.updated)) + ')'; }
        } else {
            console.log('[omniosversion] no apps data in cache for node:', currentNode._id);
        }

        // Вставка в таблицу внутри p10html
        var table = null;
        var p10html = Q('p10html');
        if (p10html) {
            table = p10html.querySelector('table');
            if (table) {
                console.log('[omniosversion] Found table in p10html');
                // Удаляем существующую строку если есть
                var existingRow = table.querySelector('#omniosVersionTableRow');
                if (existingRow && existingRow.parentNode) existingRow.parentNode.removeChild(existingRow);
                var existingAppsRow = table.querySelector('#omniosAppsTableRow');
                if (existingAppsRow && existingAppsRow.parentNode) existingAppsRow.parentNode.removeChild(existingAppsRow);
                
                // Создаём новую строку в стиле MeshCentral
                var row = '<tr id="omniosVersionTableRow"><td class="style7">OmniOS</td><td class="style9">' + text + '</td></tr>';
                var refreshLink = '<a href="#" onclick="pluginHandler.omniosversion.refreshApps(); return false;">Refresh</a>';
                var appsRow = '<tr id="omniosAppsTableRow"><td class="style7">Apps' + (appsCount ? (' (' + appsCount + ')') : '') + '</td><td class="style9">' + appsHtml + '<div style="margin-top:4px;color:#888;">' + refreshLink + (updatedTxt ? (' • ' + updatedTxt) : '') + '</div></td></tr>';
                
                // Вставляем в начало таблицы (после первой строки если она есть)
                var tbody = table.querySelector('tbody') || table;
                if (tbody.children.length > 0) {
                    tbody.children[0].insertAdjacentHTML('afterend', row + appsRow);
                } else {
                    tbody.insertAdjacentHTML('beforeend', row + appsRow);
                }
                console.log('[omniosversion] Table row injected');
            } else {
                console.log('[omniosversion] Table not found in p10html');
            }
        } else {
            console.log('[omniosversion] p10html element not found');
        }
    };

    // --- client-side events ---
    obj.onDeviceRefreshEnd = function () {
        console.log('[omniosversion] onDeviceRefreshEnd called, currentNode:', currentNode ? currentNode._id : 'undefined');
        if (typeof meshserver === 'undefined') {
            console.log('[omniosversion] meshserver is undefined');
            return;
        }
        pluginHandler.omniosversion.nodeCache = pluginHandler.omniosversion.nodeCache || {};
        pluginHandler.omniosversion.injectGeneral();
        pluginHandler.omniosversion.requestOmni();
        pluginHandler.omniosversion.nodeAppsCache = pluginHandler.omniosversion.nodeAppsCache || {};
        pluginHandler.omniosversion.requestApps();
    };

    obj.requestOmni = function () {
        console.log('[omniosversion] requestOmni called');
        if (typeof meshserver === 'undefined' || !currentNode) {
            console.log('[omniosversion] meshserver or currentNode undefined');
            return;
        }
        console.log('[omniosversion] sending getOmni request for node:', currentNode._id);
        meshserver.send({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'getOmni', nodeid: currentNode._id });
    };

    obj.omniData = function (state, msg) {
        console.log('[omniosversion] omniData received:', msg);
        if (!msg || !msg.data || !msg.data.nodeid) {
            console.log('[omniosversion] omniData: invalid message structure');
            return;
        }
        pluginHandler.omniosversion.nodeCache = pluginHandler.omniosversion.nodeCache || {};
        pluginHandler.omniosversion.nodeCache[msg.data.nodeid] = msg.data;
        console.log('[omniosversion] omniData: cached version for', msg.data.nodeid, ':', msg.data.version);
        pluginHandler.omniosversion.injectGeneral();
    };

    obj.requestApps = function (force) {
        console.log('[omniosversion] requestApps called; force:', !!force);
        if (typeof meshserver === 'undefined' || !currentNode) {
            console.log('[omniosversion] meshserver or currentNode undefined');
            return;
        }
        meshserver.send({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'getApps', nodeid: currentNode._id, force: !!force });
    };

    obj.refreshApps = function () {
        console.log('[omniosversion] refreshApps clicked');
        // Use pluginHandler to avoid scope issues in some MeshCentral builds
        if (typeof pluginHandler !== 'undefined' && pluginHandler.omniosversion && typeof pluginHandler.omniosversion.requestApps === 'function') {
            pluginHandler.omniosversion.requestApps(true);
        } else {
            // Fallback to local method if available
            if (typeof obj.requestApps === 'function') { obj.requestApps(true); }
        }
    };

    obj.appsData = function (state, msg) {
        console.log('[omniosversion] appsData received:', msg);
        if (!msg || !msg.data || !msg.data.nodeid) { console.log('[omniosversion] appsData: invalid message'); return; }
        pluginHandler.omniosversion.nodeAppsCache = pluginHandler.omniosversion.nodeAppsCache || {};
        pluginHandler.omniosversion.nodeAppsCache[msg.data.nodeid] = { apps: (msg.data.apps || []), updated: (msg.data.updated || null) };
        pluginHandler.omniosversion.injectGeneral();
    };

    return obj;
};
