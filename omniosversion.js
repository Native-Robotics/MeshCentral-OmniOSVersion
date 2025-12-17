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
      'requestOmni'
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
        if (!nodeid) return;
        if (obj.inflight[nodeid]) return;
        obj.inflight[nodeid] = true;
        var agent = obj.meshServer.webserver.wsagents[nodeid];
        if (agent == null) { obj.inflight[nodeid] = false; return; }
        try {
            agent.send(JSON.stringify({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'readOmni' }));
        } catch (e) {
            obj.inflight[nodeid] = false;
        }
    };

    // --- hooks ---
    obj.hook_agentCoreIsStable = function (myparent, gp) {
        obj.requestFromAgent(myparent.dbNodeKey);
    };

    obj.serveraction = function (command, myparent, grandparent) {
        switch (command.pluginaction) {
            case 'getOmni': {
                var nodeid = command.nodeid || myparent.dbNodeKey;
                if (!nodeid) return;
                var cached = obj.cache[nodeid];
                var msg = { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: nodeid, version: null } };
                if (cached) {
                    msg.data.version = cached.version;
                    obj.sendToSession(command.sessionid, myparent, msg, grandparent);
                    return;
                }
                obj.queueSession(nodeid, command.sessionid);
                obj.sendToSession(command.sessionid, myparent, { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: nodeid, version: null } }, grandparent);
                obj.requestFromAgent(nodeid);
                break;
            }
            case 'omniData': {
                var node = myparent.dbNodeKey;
                if (!node) return;
                obj.cache[node] = { version: (command.version === null ? null : command.version || null), time: Date.now() };
                var outMsg = { action: 'plugin', plugin: 'omniosversion', method: 'omniData', data: { nodeid: node, version: obj.cache[node].version } };
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
        if (typeof document === 'undefined') return;
        if (!currentNode) return;
        var holder = null;
        var holderC = Q('p10html3');
        if (holderC) holder = holderC.querySelector('.p10html3left');
        if (!holder) return;

        var existing = holder.querySelector('#omniosVersionRow');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        var data = (pluginHandler.omniosversion.nodeCache || {})[currentNode._id];
        var label = 'OmniOS';
        var text = 'Loading...';
        if (data) {
            text = (data.version == null || data.version === '') ? 'None' : obj.escapeHtml(String(data.version));
        }

        var tpl = '<div id="omniosVersionRow" class="p10l">' + label + ': ' + text + '</div>';
        holder.insertAdjacentHTML('beforeend', tpl);
    };

    // --- client-side events ---
    obj.onDeviceRefreshEnd = function () {
        if (typeof meshserver === 'undefined') return;
        pluginHandler.omniosversion.nodeCache = pluginHandler.omniosversion.nodeCache || {};
        obj.injectGeneral();
        obj.requestOmni();
    };

    obj.requestOmni = function () {
        if (typeof meshserver === 'undefined' || !currentNode) return;
        meshserver.send({ action: 'plugin', plugin: 'omniosversion', pluginaction: 'getOmni', nodeid: currentNode._id });
    };

    obj.omniData = function (state, msg) {
        if (!msg || !msg.data || !msg.data.nodeid) return;
        pluginHandler.omniosversion.nodeCache = pluginHandler.omniosversion.nodeCache || {};
        pluginHandler.omniosversion.nodeCache[msg.data.nodeid] = msg.data;
        obj.injectGeneral();
    };

    return obj;
};
