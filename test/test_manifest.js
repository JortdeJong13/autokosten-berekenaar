/**
 * Manifest validation. Catches the class of bug where a script is added to the
 * codebase but never wired into the manifest (which makes the UI silently fail
 * at runtime), plus references to files that don't exist.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const exists = (p) => fs.existsSync(path.join(ROOT, p));

console.log('manifest');
console.log(JSON.stringify(manifest, null, 2).slice(0, 0)); // keep output tidy

test('is valid JSON with required keys', () => {
  assert.ok(manifest.manifest_version, 'manifest_version missing');
  assert.ok(manifest.name, 'name missing');
  assert.ok(manifest.version, 'version missing');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'version must be x.y.z');
});

test('every referenced file exists', () => {
  const referenced = [
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ].filter(Boolean);

  for (const file of referenced) {
    assert.ok(exists(file), `referenced file is missing: ${file}`);
  }
});

test('the popup loads every shared module it depends on', () => {
  const html = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
  for (const dep of ['kenteken.js', 'vehicle.js', 'options.js', 'calculator-form.js']) {
    assert.match(html, new RegExp(dep.replace('.', '\\.')), `popup must load utils/${dep}`);
  }
  assert.match(html, /form\.css/, 'popup must load content/form.css');
});

test('shared utils are loaded wherever they are used, and in order', () => {
  // calculator-form.js calls VehicleUtils; anwb.js calls OptionsUtils. Both
  // must be present and loaded first, or the caller gets undefined at init.
  const popupHtml = fs.readFileSync(path.join(ROOT, 'popup', 'popup.html'), 'utf8');
  assert.match(popupHtml, /vehicle\.js/, 'popup loads the form but not vehicle.js');
  assert.match(popupHtml, /options\.js/, 'popup must load utils/options.js');

  for (const cs of manifest.content_scripts) {
    if (cs.js.includes('utils/calculator-form.js')) {
      assert.ok(cs.js.includes('utils/vehicle.js'),
        'a content script loading calculator-form.js must also load utils/vehicle.js');
      assert.ok(cs.js.indexOf('utils/vehicle.js') < cs.js.indexOf('utils/calculator-form.js'),
        'utils/vehicle.js must load before utils/calculator-form.js');
    }
    if (cs.js.includes('content/anwb.js')) {
      assert.ok(cs.js.includes('utils/options.js'),
        'the ANWB script uses OptionsUtils, so options.js must be loaded');
      assert.ok(cs.js.indexOf('utils/options.js') < cs.js.indexOf('content/anwb.js'),
        'utils/options.js must load before content/anwb.js');
    }
  }
});

test('the AutoScout content script loads the shared form and its styles', () => {
  const cs = manifest.content_scripts.find((entry) =>
    entry.matches.some((m) => m.includes('autoscout24'))
  );
  assert.ok(cs, 'no AutoScout24 content script');

  assert.ok(cs.js.includes('utils/calculator-form.js'),
    'AutoScout24 content script must load utils/calculator-form.js before content/autoscout.js');
  assert.ok(cs.js.indexOf('utils/calculator-form.js') < cs.js.indexOf('content/autoscout.js'),
    'utils/calculator-form.js must be listed before content/autoscout.js');
  assert.ok(cs.css.includes('content/form.css'),
    'AutoScout24 content script must load content/form.css');
});

test('the ANWB content script has its dependencies in order', () => {
  const cs = manifest.content_scripts.find((entry) => entry.matches.some((m) => m.includes('anwb')));
  assert.ok(cs, 'no ANWB content script');

  const order = cs.js;
  assert.ok(order.indexOf('utils/dom-utils.js') < order.indexOf('content/anwb.js'),
    'utils/dom-utils.js must load before content/anwb.js');
  assert.ok(order.indexOf('utils/kenteken.js') < order.indexOf('content/anwb.js'),
    'utils/kenteken.js must load before content/anwb.js');
});

test('host permissions cover both sites', () => {
  const hosts = manifest.host_permissions.join(' ');
  assert.match(hosts, /autoscout24\.nl/, 'missing autoscout24.nl host permission');
  assert.match(hosts, /anwb\.nl/, 'missing anwb.nl host permission');
});

test('does not request unnecessary permissions', () => {
  const allowed = new Set(['storage', 'activeTab', 'tabs']);
  for (const perm of manifest.permissions) {
    assert.ok(allowed.has(perm), `unexpected permission: ${perm}`);
  }
});

console.log(`\n${passed} manifest checks passed`);
