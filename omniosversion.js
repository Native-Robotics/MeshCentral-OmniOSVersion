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
    obj.pending = {}; // nodeid => [sessionIds]
    obj.inflight = {}; // nodeid => boolean
    obj.exports = [
      'onDeviceRefreshEnd',
      'omniData',
      'requestOmni',
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

    // --- hooks ---
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        obj.debug('omniosversion', 'hook_agentCoreIsStable called for node:', myparent.dbNodeKey);
        obj.requestFromAgent(myparent.dbNodeKey);
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

        // Получаем данные
        var data = (pluginHandler.omniosversion.nodeCache || {})[currentNode._id];
        var text = 'Loading...';
        if (data) {
            text = (data.version == null || data.version === '') ? 'None' : pluginHandler.omniosversion.escapeHtml(String(data.version));
            console.log('[omniosversion] displaying version:', text);
        } else {
            console.log('[omniosversion] no data in cache for node:', currentNode._id);
        }

        // Вариант 1: Вставка в таблицу внутри p10html
        var table = null;
        var p10html = Q('p10html');
        if (p10html) {
            table = p10html.querySelector('table');
            if (table) {
                console.log('[omniosversion] Found table in p10html');
                // Удаляем существующую строку если есть
                var existingRow = table.querySelector('#omniosVersionTableRow');
                if (existingRow && existingRow.parentNode) existingRow.parentNode.removeChild(existingRow);
                
                // Создаём новую строку
                var row = '<tr id="omniosVersionTableRow"><td style="width:100px"><b>OmniOS:</b></td><td>' + text + '</td></tr>';
                
                // Вставляем в начало таблицы (после первой строки если она есть)
                var tbody = table.querySelector('tbody') || table;
                if (tbody.children.length > 0) {
                    tbody.children[0].insertAdjacentHTML('afterend', row);
                } else {
                    tbody.insertAdjacentHTML('beforeend', row);
                }
                console.log('[omniosversion] Table row injected');
            } else {
                console.log('[omniosversion] Table not found in p10html');
            }
        } else {
            console.log('[omniosversion] p10html element not found');
        }

        // Вариант 2: Вставка в .p10html3left (оригинальный вариант)
        var holder = null;
        var holderC = Q('p10html3');
        if (holderC) holder = holderC.querySelector('.p10html3left');
        if (holder) {
            var existing = holder.querySelector('#omniosVersionRow');
            if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

            var tpl = '<div id="omniosVersionRow" class="p10l">OmniOS: ' + text + '</div>';
            holder.insertAdjacentHTML('beforeend', tpl);
            console.log('[omniosversion] HTML div injected in p10html3left');
        } else {
            console.log('[omniosversion] holder element (.p10html3left) not found');
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

    return obj;
};
