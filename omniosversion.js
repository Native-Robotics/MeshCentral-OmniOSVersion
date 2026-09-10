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
    obj.launchpadCache = {}; // nodeid => { version, time }
    obj.appsCache = {}; // nodeid => { apps, updated, time }
    obj.appsTtlMs = 24 * 60 * 60 * 1000; // Manual refresh bypasses this cache.
    obj.exports = [
        'onDeviceRefreshEnd',
        'requestInventory',
        'inventoryResult',
        'omniData',
        'requestOmni',
        'launchpadData',
        'requestLaunchpad',
        'appsData',
        'requestApps',
        'refreshAll',
        'injectGeneral',
        'escapeHtml'
    ];

    // MeshCentral dispatches browser plugin actions without checking node rights.
    // Use connection identity here; never accept a payload session or agent identity.
    obj.serveraction = function (command, myparent, grandparent) {
        if (!command || !myparent) return;
        var action = command.pluginaction;
        var requests = ["getOmni", "getLaunchpad", "getApps"];
        var results = ["omniData", "launchpadData", "appsData"];
        if (results.indexOf(action) !== -1) {
            if (!myparent.dbNodeKey || obj.meshServer.webserver.wsagents[myparent.dbNodeKey] !== myparent) return;
            handleAction(command, myparent, grandparent);
            return;
        }
        if (requests.indexOf(action) === -1 || myparent.dbNodeKey || !myparent.user || !myparent.domain || !myparent.ws) return;
        var nodeid = command.nodeid;
        function deny(message) {
            var method = { getOmni: 'omniData', getLaunchpad: 'launchpadData', getApps: 'appsData' }[action];
            try { myparent.ws.send(JSON.stringify({ action: 'plugin', plugin: 'omniosversion', method: method,
                data: { nodeid: nodeid, clientRequestId: command.clientRequestId, status: 'error', error: message, message: message } })); } catch (e) { }
        }
        if (typeof nodeid !== 'string' || nodeid.length > 128 || nodeid.split('/').length !== 3 ||
            nodeid.split('/')[0] !== 'node' || nodeid.split('/')[1] !== myparent.domain.id) {
            deny('Invalid device'); return;
        }
        obj.meshServer.webserver.GetNodeWithRights(myparent.domain, myparent.user, nodeid, function (node, rights, visible) {
            if (!node || !visible) { deny('Access denied'); return; }
            var validated = { pluginaction: action, nodeid: node._id,
                force: command.force === true,
                clientRequestId: typeof command.clientRequestId === 'string' ? command.clientRequestId.slice(0, 100) : undefined };
            handleAction(validated, myparent, grandparent);
        });
    };

    var requestPrefix = require('crypto').randomBytes(12).toString('hex');
    var requestSequence = 0;
    obj.requests = {};
    var channels = {
        getOmni: {action: 'readOmni', result: 'omniData', cache: 'cache', ttl: 60000},
        getLaunchpad: {action: 'readLaunchpad', result: 'launchpadData', cache: 'launchpadCache', ttl: 60000},
        getApps: {action: 'readApps', result: 'appsData', cache: 'appsCache', ttl: obj.appsTtlMs}
    };
    function respond(client, method, data) {
        if (!client) return;
        var web = obj.meshServer.webserver;
        if (web.wssessions2[client.ws.sessionId] !== client.ws) return;
        web.GetNodeWithRights(client.domain, client.user._id, client.nodeid, function (node, rights, visible) {
            var payload = node && visible ? Object.assign({}, data) : {error: 'Access denied'};
            payload.nodeid = client.nodeid;
            payload.clientRequestId = client.clientRequestId;
            try { client.ws.send(JSON.stringify({ action: 'plugin', plugin: 'omniosversion', method: method, data: payload })); } catch (e) { }
        });
    }
    function complete(entry, data) {
        if (obj.requests[entry.key] !== entry) return;
        clearTimeout(entry.timer);
        delete obj.requests[entry.key];
        entry.clients.forEach(function (client) { respond(client, entry.channel.result, data); });
    }
    function requestInventory(kind, nodeid, force, client) {
        var channel = channels[kind], cache = obj[channel.cache][nodeid];
        if (!force && cache && Date.now() >= cache.time && Date.now() - cache.time < channel.ttl) {
            respond(client, channel.result, cache);
            return;
        }
        var key = kind + ':' + nodeid, active = obj.requests[key];
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        var clients = active ? active.clients.filter(function (c) { return !client || c.ws !== client.ws; }) : [];
        if (client) clients.push(client);
        if (active && active.agent === agent && (!force || active.force)) { active.clients = clients; return; }
        // A forced refresh supersedes an older non-forced request, preserving its waiters.
        if (active) { clearTimeout(active.timer); delete obj.requests[key]; }
        if (!agent) { clients.forEach(function (c) { respond(c, channel.result, {error: 'Device is offline'}); }); return; }
        var entry = {id: requestPrefix + '-' + (++requestSequence), key: key, channel: channel,
            clients: clients, agent: agent, nodeid: nodeid, force: force};
        obj.requests[key] = entry;
        entry.timer = setTimeout(function () { complete(entry, {error: 'Inventory request timed out; use Refresh'}); }, 30000);
        try { agent.send(JSON.stringify({action: 'plugin', plugin: 'omniosversion', pluginaction: channel.action,
            requestId: entry.id, force: force === true})); }
        catch (e) { complete(entry, {error: 'Cannot contact device'}); }
    }
    obj.hook_agentCoreIsStable = function (agent) {
        if (!agent || obj.meshServer.webserver.wsagents[agent.dbNodeKey] !== agent) return;
        Object.keys(channels).forEach(function (kind) { requestInventory(kind, agent.dbNodeKey, true, null); });
    };
    function handleAction(command, myparent, grandparent) {
        var channel = channels[command.pluginaction];
        if (channel) {
            requestInventory(command.pluginaction, command.nodeid, command.force === true,
                {nodeid: command.nodeid, ws: myparent.ws, user: myparent.user, domain: myparent.domain,
                    clientRequestId: command.clientRequestId});
            return;
        }
        var kinds = Object.keys(channels);
        for (var i = 0; i < kinds.length; i++) {
            channel = channels[kinds[i]];
            if (channel.result !== command.pluginaction) continue;
            var entry = obj.requests[kinds[i] + ':' + myparent.dbNodeKey];
            if (!entry || entry.agent !== myparent || command.requestId !== entry.id) return;
            if (command.error) {
                delete obj[channel.cache][entry.nodeid];
                complete(entry, {error: String(command.error).slice(0, 4096)});
                return;
            }
            var data = {time: Date.now()};
            if (kinds[i] === 'getApps') {
                if (!Array.isArray(command.apps)) { complete(entry, {error: 'Invalid application inventory response'}); return; }
                data.apps = command.apps.filter(function (app) {
                    return app && typeof app.name === 'string' && typeof app.version === 'string';
                }).slice(0, 1000).map(function (app) { return {name: app.name.slice(0, 256), version: app.version.slice(0, 256)}; });
                data.updated = typeof command.updated === 'string' ? command.updated.slice(0, 256) : null;
                data.received = data.time;
            } else {
                if (command.version !== null && typeof command.version !== 'string') {
                    complete(entry, {error: 'Invalid version response'}); return;
                }
                data.version = command.version === null ? null : command.version.slice(0, 256);
            }
            obj[channel.cache][entry.nodeid] = data;
            complete(entry, data);
            return;
        }
    }

    // --- client-side helpers ---
    obj.escapeHtml = function (unsafe) {
        if (unsafe == null) return '';
        return String(unsafe)
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
        if (typeof currentNode === 'undefined' || !currentNode) {
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

        if (data && data.error) text = 'Error: ' + pluginHandler.omniosversion.escapeHtml(data.error);

        // Получаем данные Launchpad
        var launchpadData = (pluginHandler.omniosversion.nodeLaunchpadCache || {})[currentNode._id];
        var launchpadText = 'Loading...';
        if (launchpadData) {
            launchpadText = (launchpadData.version == null || launchpadData.version === '') ? 'None' : pluginHandler.omniosversion.escapeHtml(String(launchpadData.version));
            console.log('[omniosversion] displaying launchpad version:', launchpadText);
        } else {
            console.log('[omniosversion] no launchpad data in cache for node:', currentNode._id);
        }

        if (launchpadData && launchpadData.error) launchpadText = 'Error: ' + pluginHandler.omniosversion.escapeHtml(launchpadData.error);

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
            if (appsCache.received) {
                var d = new Date(appsCache.received);
                var pad = function (n) { return (n < 10 ? '0' : '') + n; };
                var receivedTxt = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
                updatedTxt = ' (Last updated: ' + receivedTxt + ')';
            }
        } else {
            console.log('[omniosversion] no apps data in cache for node:', currentNode._id);
        }

        if (appsCache && appsCache.error) appsHtml = 'Error: ' + pluginHandler.omniosversion.escapeHtml(appsCache.error);

        // Вставка в таблицу внутри p10html
        var table = null;
        var p10html = Q('p10html');
        if (p10html) {
            table = p10html.querySelector('table');
            if (table) {
                console.log('[omniosversion] Found table in p10html');
                // Удаляем существующие строки если есть
                var existingRow = table.querySelector('#omniosVersionTableRow');
                var existingLaunchpadRow = table.querySelector('#omniosLaunchpadTableRow');
                var existingAppsRow = table.querySelector('#omniosAppsTableRow');
                
                // Создаём новые строки в стиле MeshCentral
                var row = '<tr id="omniosVersionTableRow"><td class="style7">OmniOS</td><td class="style9">' + text + '</td></tr>';
                var launchpadRow = '<tr id="omniosLaunchpadTableRow"><td class="style7">Launchpad</td><td class="style9">' + launchpadText + '</td></tr>';
                var refreshLink = '<a href="#" onclick="pluginHandler.omniosversion.refreshAll(); return false;">Refresh</a>';
                var appsRow = '<tr id="omniosAppsTableRow"><td class="style7">Apps' + (appsCount ? (' (' + appsCount + ')') : '') + '</td><td class="style9">' + appsHtml + '<div style="margin-top:4px;color:#888;">' + refreshLink + (updatedTxt ? (' • ' + updatedTxt) : '') + '</div></td></tr>';
                
                // Keep stable rows in place so another plugin's Export row stays after Apps.
                if (existingRow && existingLaunchpadRow && existingAppsRow) {
                    existingRow.cells[1].innerHTML = text;
                    existingLaunchpadRow.cells[1].innerHTML = launchpadText;
                    existingAppsRow.cells[0].textContent = 'Apps' + (appsCount ? (' (' + appsCount + ')') : '');
                    existingAppsRow.cells[1].innerHTML = appsHtml + '<div style="margin-top:4px;color:#888;">' + refreshLink + (updatedTxt ? (' • ' + updatedTxt) : '') + '</div>';
                    return;
                }
                [existingRow, existingLaunchpadRow, existingAppsRow].forEach(function (r) {
                    if (r && r.parentNode) r.parentNode.removeChild(r);
                });

                // Вставляем в начало таблицы (после первой строки если она есть)
                var tbody = table.querySelector('tbody') || table;
                if (tbody.children.length > 0) {
                    tbody.children[0].insertAdjacentHTML('afterend', row + launchpadRow + appsRow);
                } else {
                    tbody.insertAdjacentHTML('beforeend', row + launchpadRow + appsRow);
                }
                console.log('[omniosversion] Table row injected');
            } else {
                console.log('[omniosversion] Table not found in p10html');
            }
        } else {
            console.log('[omniosversion] p10html element not found');
        }
    };

    obj.onDeviceRefreshEnd = function () {
        var h = pluginHandler.omniosversion;
        h.injectGeneral();
        h.requestOmni();
        h.requestLaunchpad();
        h.requestApps();
    };
    obj.requestOmni = function (force) { pluginHandler.omniosversion.requestInventory('getOmni', force); };
    obj.requestLaunchpad = function (force) { pluginHandler.omniosversion.requestInventory('getLaunchpad', force); };
    obj.requestApps = function (force) { pluginHandler.omniosversion.requestInventory('getApps', force); };
    obj.refreshAll = function () {
        var h = pluginHandler.omniosversion;
        h.requestOmni(true); h.requestLaunchpad(true); h.requestApps(true);
    };
    obj.requestInventory = function (kind, force) {
        if (typeof meshserver === 'undefined' || typeof currentNode === 'undefined' || !currentNode) return;
        var h = pluginHandler.omniosversion, nodeid = currentNode._id, key = kind + ':' + nodeid;
        h.inventoryRequests = h.inventoryRequests || {};
        if (h.inventoryRequests[key] && !force) return;
        h.requestSequence = (h.requestSequence || 0) + 1;
        var id = Date.now() + '-' + h.requestSequence;
        h.inventoryRequests[key] = id;
        function fail(message) { h.inventoryResult(kind, {data: {nodeid: nodeid, clientRequestId: id, error: message}}); }
        try { meshserver.send({action: 'plugin', plugin: 'omniosversion', pluginaction: kind,
            nodeid: nodeid, force: force === true, clientRequestId: id}); }
        catch (e) { fail('Cannot contact MeshCentral'); }
        setTimeout(function () {
            if (h.inventoryRequests[key] === id) fail('Inventory request timed out; use Refresh');
        }, 35000);
    };
    obj.inventoryResult = function (kind, msg) {
        if (!msg || !msg.data || !msg.data.nodeid) return;
        var h = pluginHandler.omniosversion, data = msg.data, key = kind + ':' + data.nodeid;
        if (!h.inventoryRequests || !h.inventoryRequests[key] || h.inventoryRequests[key] !== data.clientRequestId) return;
        delete h.inventoryRequests[key];
        var name = {getOmni: 'nodeCache', getLaunchpad: 'nodeLaunchpadCache', getApps: 'nodeAppsCache'}[kind];
        h[name] = h[name] || {};
        h[name][data.nodeid] = data;
        if (typeof currentNode !== 'undefined' && currentNode && currentNode._id === data.nodeid) h.injectGeneral();
    };
    obj.omniData = function (state, msg) { pluginHandler.omniosversion.inventoryResult('getOmni', msg); };
    obj.launchpadData = function (state, msg) { pluginHandler.omniosversion.inventoryResult('getLaunchpad', msg); };
    obj.appsData = function (state, msg) { pluginHandler.omniosversion.inventoryResult('getApps', msg); };

    return obj;
};
