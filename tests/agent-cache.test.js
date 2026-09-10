'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../modules_meshcore/omniosversion.js'), 'utf8');
const cases = [
    {action: 'readOmni', file: '/etc/OmniOS', key: 'plugin_OmniOSVersion_cache', content: 'OMNIOS_VER="2.0"'},
    {action: 'readLaunchpad', file: '/home/user/launchpad/scripts/config.sh', key: 'plugin_OmniOSVersion_launchpad_cache',
        content: '# launchpad_ver=old\nexport launchpad_ver="2.0"'}
];
function agent(store, files, options = {}) {
    const reads = [], responses = [];
    const context = {module: {exports: {}}, require(name) {
        if (name === 'SimpleDataStore') return {Shared: () => ({Get: key => store.get(key), Put: (key, value) => store.set(key, JSON.stringify(value))})};
        if (name === 'MeshAgent') return {SendCommand() {}};
        if (name === 'fs') return {
            existsSync: file => files.has(file),
            readFileSync(file) {reads.push(file); if (options.readError) throw Error('read failed'); return files.get(file);},
            statSync: () => ({mtime: new Date(0)})
        };
        throw Error(name);
    }};
    vm.runInNewContext(source, context);
    return {reads, responses, act(action, force = false) {
        context.module.exports.consoleaction({pluginaction: action, force, requestId: 'request'}, 0, 'session', {
            SendCommand: msg => responses.push(JSON.parse(JSON.stringify(msg)))
        });
        return responses.at(-1);
    }};
}
for (const c of cases) {
    test(c.action + ' parses persistent JSON cache and reuses it after module reload', () => {
        const store = new Map(), files = new Map([[c.file, c.content]]);
        const first = agent(store, files);
        assert.equal(first.act(c.action).version, '2.0');
        const second = agent(store, files);
        assert.equal(second.act(c.action).version, '2.0');
        assert.equal(second.reads.length, 0);
        assert.equal(second.responses[0].requestId, 'request');
    });
    test(c.action + ' refreshes malformed, old-schema and expired caches', () => {
        for (const raw of ['not json', 'null', JSON.stringify({version: 'old'}),
            JSON.stringify({version: 'old', time: Date.now() - 60001}), JSON.stringify({version: {}, time: Date.now()})]) {
            const store = new Map([[c.key, raw]]), a = agent(store, new Map([[c.file, c.content]]));
            assert.equal(a.act(c.action).version, '2.0');
            assert.equal(a.reads.length, 1);
        }
    });
    test(c.action + ' force bypasses fresh cache and read errors do not overwrite it', () => {
        const raw = JSON.stringify({version: 'old', time: Date.now()}), store = new Map([[c.key, raw]]);
        const a = agent(store, new Map([[c.file, c.content]]));
        assert.equal(a.act(c.action).version, 'old');
        assert.equal(a.act(c.action, true).version, '2.0');
        const saved = store.get(c.key), failed = agent(store, new Map([[c.file, c.content]]), {readError: true});
        assert(failed.act(c.action, true).error.includes('read failed'));
        assert.equal(store.get(c.key), saved);
    });
}
test('application timestamp metadata and comments are not displayed as applications', () => {
    const a = agent(new Map(), new Map([['/var/nr/apps.ver', '# Updated: today\n# comment: hidden\nOmniPack=2.0\nUpdater: 3.0']]));
    const reply = a.act('readApps');
    assert.deepEqual(reply.apps, [{name: 'OmniPack', version: '2.0'}, {name: 'Updater', version: '3.0'}]);
    assert.equal(reply.updated, 'Updated: today');
});
