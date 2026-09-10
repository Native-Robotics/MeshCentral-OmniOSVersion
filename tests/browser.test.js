'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const plugin = require('../omniosversion.js').omniosversion({parent: {webserver: {}, debug() {}}});
function browser() {
    const messages = [], timers = [], inserted = [];
    const ids = ['omniosVersionTableRow', 'omniosLaunchpadTableRow', 'omniosAppsTableRow', 'omniossendlogsTableRow'];
    const rows = ids.map(id => ({id, cells: [{textContent: ''}, {innerHTML: ''}]}));
    let existing = true, removals = 0;
    const tbody = {children: [], insertAdjacentHTML: (where, html) => inserted.push(html)};
    rows.forEach(row => { row.parentNode = {removeChild() {removals++;}}; });
    const table = {querySelector: selector => selector === 'tbody' ? tbody :
        (existing ? rows.find(row => '#' + row.id === selector) : null)};
    const context = {pluginHandler: {omniosversion: {}}, document: {}, currentNode: {_id: 'node/test/one'},
        Q: () => ({querySelector: () => table}), console: {log() {}},
        meshserver: {send: msg => messages.push(JSON.parse(JSON.stringify(msg)))},
        setTimeout(fn, ms) {timers.push({fn, ms}); return timers.length;}};
    vm.createContext(context);
    for (const name of plugin.exports) context.pluginHandler.omniosversion[name] = vm.runInContext('(' + plugin[name].toString() + ')', context);
    return {h: context.pluginHandler.omniosversion, context, messages, timers, rows, inserted,
        get removals() {return removals;}, setExisting(value) {existing = value;}};
}
function result(b, request, data) {
    b.h.inventoryResult(request.pluginaction, {data: {nodeid: request.nodeid, clientRequestId: request.clientRequestId, ...data}});
}
test('serialized browser functions show errors, recover after timeout and reject late results', () => {
    const b = browser();
    b.h.onDeviceRefreshEnd();
    assert.equal(b.messages.length, 3);
    const old = b.messages[0];
    b.timers[0].fn();
    assert(b.rows[0].cells[1].innerHTML.includes('timed out'));
    b.h.requestOmni(true);
    const fresh = b.messages.at(-1);
    result(b, old, {version: 'old'});
    assert(b.rows[0].cells[1].innerHTML.includes('timed out'));
    result(b, fresh, {version: '2.0'});
    assert.equal(b.rows[0].cells[1].innerHTML, '2.0');
});
test('inventory refresh keeps existing rows and the neighboring Export row in place', () => {
    const b = browser(), original = b.rows.slice();
    b.h.onDeviceRefreshEnd();
    result(b, b.messages[0], {version: '<script>bad</script>'});
    result(b, b.messages[1], {version: '2.0'});
    result(b, b.messages[2], {apps: [{name: 'OmniPack', version: '1.0'}], received: Date.now()});
    assert.equal(b.removals, 0);
    assert.deepEqual(b.rows, original);
    assert(b.rows[0].cells[1].innerHTML.includes('&lt;script&gt;'));
    assert(b.rows[2].cells[1].innerHTML.includes('OmniPack'));
    b.setExisting(false);
    b.h.injectGeneral();
    assert(b.inserted[0].includes('omniosAppsTableRow'));
});
test('navigation and missing currentNode do not accept an unrelated inventory response', () => {
    const b = browser();
    b.h.requestOmni();
    const first = b.messages[0];
    b.context.currentNode = {_id: 'node/test/two'};
    result(b, first, {version: 'one'});
    assert.equal(b.rows[0].cells[1].innerHTML, '');
    assert.equal(b.h.nodeCache[first.nodeid].version, 'one');
    delete b.context.currentNode;
    b.h.onDeviceRefreshEnd();
    b.h.refreshAll();
    assert.equal(b.messages.length, 1);
});
