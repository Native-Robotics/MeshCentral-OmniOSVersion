"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const pluginName = 'omniosversion';
test('browser, server and agent complete the correlated protocol round trip', () => {
    const nodeid = 'node/test/device', processes = [], store = new Map(), transcript = [];
    const fakeTimers = {setTimeout() {return 1;}, clearTimeout() {}};
    let server, agentModule, browser;
    const agent = {dbNodeKey: nodeid, send(raw) {
        const message = JSON.parse(raw);
        agentModule.consoleaction(message, message.rights, message.sessionid, {
            SendCommand: reply => server.serveraction(JSON.parse(JSON.stringify(reply)), agent, web)
        });
    }};
    const ws = {sessionId: 'session', send(raw) {
        const message = JSON.parse(raw);
        transcript.push(message);
        browser.pluginHandler[pluginName][message.method](null, message);
    }};
    const web = {wsagents: {[nodeid]: agent}, wssessions2: {session: ws},
        GetNodeWithRights(domain, user, id, callback) {callback({_id: id, meshid: 'mesh/test/group'}, 16, true);}};
    const agentContext = {module: {exports: {}}, ...fakeTimers, require(name) {
        if (name === 'SimpleDataStore') return {Shared: () => ({Get: key => store.get(key), Put: (key, value) => store.set(key, JSON.stringify(value))})};
        if (name === 'MeshAgent') return {SendCommand() {}};
        if (name === 'fs') return {existsSync: () => true, statSync: () => ({mtime: new Date(0)}), readFileSync(file) {
            if (file === '/etc/OmniOS') return 'OMNIOS_VER=2.0';
            if (file.endsWith('/config.sh')) return 'launchpad_ver=3.0';
            if (file.endsWith('apps.ver')) return 'OmniPack=4.0';
            return 'SERIAL=test';
        }};
        if (name === 'child_process') return {execFile(file, args) {
            const p = new EventEmitter(); p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
            processes.push({p, args}); return p;
        }};
        throw Error(name);
    }};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../modules_meshcore/omniosversion.js'), 'utf8'), agentContext);
    agentModule = agentContext.module.exports;
    const serverContext = {module: {exports: {}}, require, console: {log() {}}, ...fakeTimers};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../omniosversion.js'), 'utf8'), serverContext);
    server = serverContext.module.exports[pluginName]({parent: {webserver: web, debug() {}}});
    browser = {pluginHandler: {[pluginName]: {}}, currentNode: {_id: nodeid}, console: {log() {}}, ...fakeTimers,
        meshserver: {send: message => server.serveraction(JSON.parse(JSON.stringify(message)),
            {ws, user: {_id: 'user/test/operator'}, domain: {id: 'test'}}, web)}};
    vm.createContext(browser);
    for (const name of server.exports) browser.pluginHandler[pluginName][name] = vm.runInContext('(' + server[name].toString() + ')', browser);
    const h = browser.pluginHandler[pluginName];
    h.onDeviceRefreshEnd();
    if (pluginName === 'omniossendlogs') {
        const probe = processes.shift();
        probe.p.stdout.emit('data', '--log-window --settings-only 30m 2h'); probe.p.emit('exit', 0);
        assert.equal(h.windowCapability[nodeid], true);
        h.triggerExport('60m');
        const operation = processes.shift();
        assert(operation.args[3].endsWith('--mode server -l 60m'));
        operation.p.emit('exit', 0);
        assert.equal(h.exportStatus[nodeid].status, 'success');
        assert.equal(Object.keys(server.inflight).length, 0);
    } else {
        assert.equal(h.nodeCache[nodeid].version, '2.0');
        assert.equal(h.nodeLaunchpadCache[nodeid].version, '3.0');
        assert.equal(h.nodeAppsCache[nodeid].apps[0].name, 'OmniPack');
        assert.equal(Object.keys(server.requests).length, 0);
    }
    assert(transcript.every(message => typeof message.data.clientRequestId === 'string'));
});
