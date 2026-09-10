"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../omniosversion.js'), 'utf8');
const plugin = 'omniosversion', readAction = 'getOmni';
const nodeid = 'node/test/device';
function setup(access = true, rights = 16) {
    const sent = [], replies = [], otherReplies = [], checks = [], timers = [];
    const agent = { dbNodeKey: nodeid, send: data => sent.push(JSON.parse(data)) };
    const ws = { sessionId: 'session', send: data => replies.push(JSON.parse(data)) };
    const user = { _id: 'user/test/operator' }, domain = { id: 'test' };
    const webserver = {
        wsagents: { [nodeid]: agent },
        wssessions2: { session: ws, forged: { send: data => otherReplies.push(JSON.parse(data)) } },
        GetNodeWithRights(d, u, id, callback) {
            checks.push({d, u, id});
            callback(access ? { _id: nodeid, meshid: 'mesh/test/group' } : null, rights, access);
        }
    };
    const context = { module: {exports: {}}, require, console: {log() {}}, setTimeout(fn, ms) { const timer = {fn, ms}; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cancelled = true; } };
    vm.runInNewContext(source, context);
    const obj = context.module.exports[plugin]({ parent: {debug() {}, webserver} });
    const browser = {user, domain, ws};
    return {obj, browser, webserver, agent, sent, replies, otherReplies, checks, timers, setAccess(value) { access = value; }};
}
test('denies inaccessible nodes before reading caches or contacting agents', () => {
    const h = setup(false);
    if (h.obj.cache) h.obj.cache[nodeid] = {version: 'private', time: Date.now()};
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    assert.equal(h.checks.length, 1);
    assert.equal(h.sent.length, 0);
    assert(!JSON.stringify(h.replies).includes('private'));
    assert(h.replies.length > 0);
});
test('uses authenticated socket session instead of a supplied sessionid', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid, sessionid: 'forged'}, h.browser, h.webserver);
    assert.equal(h.checks.length, 1);
    assert.equal(h.checks[0].u, h.browser.user);
    assert.equal(h.checks[0].d, h.browser.domain);
    const cmd = h.sent[0];
    h.obj.serveraction({pluginaction: plugin === 'omniosversion' ? 'omniData' : 'exportCapabilitiesResult',
        requestId: cmd.requestId, version: 'ok', settingsOnly: true, arbitraryWindow: true}, h.agent, h.webserver);
    assert.equal(h.otherReplies.length, 0);
    assert(h.replies.length > 0);
});
test('agent cannot submit browser actions for another device', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid, sessionid: 'forged'}, h.agent, h.webserver);
    assert.equal(h.sent.length, 0);
    assert.equal(h.otherReplies.length, 0);
});
test('browser cannot impersonate an agent result', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: plugin === 'omniosversion' ? 'omniData' : 'exportCapabilitiesResult',
        nodeid, version: 'forged', settingsOnly: true}, h.browser, h.webserver);
    assert.equal(h.sent.length, 0);
    assert.equal(h.replies.length, 0);
});

function agentReply(h, requestId) {
    h.obj.serveraction({pluginaction: plugin === 'omniosversion' ? 'omniData' : 'exportCapabilitiesResult',
        requestId, version: 'fresh', settingsOnly: true, arbitraryWindow: true}, h.agent, h.webserver);
}
test('offline requests fail immediately without leaving a pending operation', () => {
    const h = setup();
    delete h.webserver.wsagents[nodeid];
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    assert.equal(h.sent.length, 0);
    assert(h.replies.at(-1).data.error.includes('offline'));
    assert.equal(h.timers.length, 0);
});
test('timeout clears pending state and a late reply cannot complete its replacement', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    const oldId = h.sent[0].requestId;
    h.timers[0].fn();
    assert(h.replies.at(-1).data.error);
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    const newId = h.sent[1].requestId;
    assert.notEqual(newId, oldId);
    const count = h.replies.length;
    agentReply(h, oldId);
    h.timers[0].fn();
    assert.equal(h.replies.length, count);
    agentReply(h, newId);
    assert.equal(h.replies.length, count + 1);
    assert(!h.replies.at(-1).data.error);
});
test('rechecks device access before delivering a delayed result', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    h.setAccess(false);
    agentReply(h, h.sent[0].requestId);
    assert.equal(h.replies.at(-1).data.error, 'Access denied');
    assert(!JSON.stringify(h.replies).includes('fresh'));
});
test('ignores replies from a replaced agent connection', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    h.webserver.wsagents[nodeid] = {dbNodeKey: nodeid, send() {}};
    const count = h.replies.length;
    agentReply(h, h.sent[0].requestId);
    assert.equal(h.replies.length, count);
});

test('forced refresh supersedes an old read and does not reuse stale data', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    h.obj.serveraction({pluginaction: readAction, nodeid, force: true}, h.browser, h.webserver);
    assert.equal(h.sent.length, 2);
    const count = h.replies.length;
    agentReply(h, h.sent[0].requestId);
    assert.equal(h.replies.length, count);
    agentReply(h, h.sent[1].requestId);
    assert.equal(h.replies.length, count + 1);
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    assert.equal(h.sent.length, 2);
    h.obj.cache[nodeid].time = Date.now() - 60001;
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    assert.equal(h.sent.length, 3);
});

test('a new connection can immediately replace an outstanding read on the old agent', () => {
    const h = setup();
    h.obj.serveraction({pluginaction: readAction, nodeid}, h.browser, h.webserver);
    const oldId = h.sent[0].requestId;
    const replacement = {dbNodeKey: nodeid, send: data => h.sent.push(JSON.parse(data))};
    h.webserver.wsagents[nodeid] = replacement;
    h.obj.serveraction({pluginaction: readAction, nodeid, force: true}, h.browser, h.webserver);
    assert.equal(h.sent.length, 2);
    assert.notEqual(h.sent[1].requestId, oldId);
    h.obj.serveraction({pluginaction: plugin === 'omniosversion' ? 'omniData' : 'exportCapabilitiesResult',
        requestId: h.sent[1].requestId, version: 'new connection', settingsOnly: true, arbitraryWindow: true}, replacement, h.webserver);
    assert(!h.replies.at(-1).data.error);
});
