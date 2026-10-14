import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pages = ['index.html', 'wide.html'];

function makeNode() {
  const classes = new Set();
  return {
    style: { display: '' },
    innerHTML: '',
    textContent: '',
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const active = force === undefined ? !classes.has(name) : Boolean(force);
        if (active) classes.add(name); else classes.delete(name);
        return active;
      },
      contains(name) { return classes.has(name); }
    },
    addEventListener() {}
  };
}

async function loadApp(name) {
  const html = await readFile(new URL('../' + name, import.meta.url), 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'inline app script must exist');
  const nodes = new Map();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode());
      return nodes.get(id);
    },
    querySelectorAll() { return []; }
  };
  const window = {};
  vm.runInNewContext(match[1], { document, window, console }, { filename: name });
  assert.ok(window.PdnHrApp, 'test app API is exposed');
  return { app: window.PdnHrApp, node: id => document.getElementById(id), html };
}

for (const name of pages) {
  test(`${name}: no FIO does not bypass special-category screening`, async () => {
    const { app, node } = await loadApp(name);
    app.wNext(1, 'assessment');
    assert.equal(node('w-q2').classList.contains('hidden'), false);
    app.wNext(2, 'fio_no');
    assert.equal(node('w-q3').classList.contains('hidden'), false, 'sensitive-data question must remain mandatory');
    assert.equal(node('w-q4').classList.contains('hidden'), true);
    app.wNext(3, 'sens_yes');
    assert.equal(node('w-q4').classList.contains('hidden'), false);
    app.wNext(4, 'chatgpt');
    assert.match(node('w-verdict').innerHTML, /Остановите передачу до согласования/);
    assert.equal(node('w-verdict').style.display, 'block');
  });

  test(`${name}: changing an earlier answer invalidates downstream sensitive data choice`, async () => {
    const { app, node } = await loadApp(name);
    app.wNext(1, 'resume');
    app.wNext(2, 'fio_yes');
    app.wNext(3, 'sens_yes');
    app.wNext(4, 'chatgpt');
    assert.match(node('w-verdict').innerHTML, /Категорически нельзя/);

    app.wNext(2, 'fio_no');
    assert.equal(node('w-q3').classList.contains('hidden'), false);
    app.wNext(3, 'sens_no');
    app.wNext(4, 'qwen');
    assert.match(node('w-verdict').innerHTML, /Нужна проверка перед загрузкой/);
    assert.doesNotMatch(node('w-verdict').innerHTML, /спецкатегории/);
  });

  test(`${name}: conservative document handling and reset keep working`, async () => {
    const { app, node } = await loadApp(name);
    app.wNext(1, 'contract');
    assert.match(node('w-verdict').innerHTML, /Остановите загрузку кадрового оригинала/);
    app.resetWizard();
    assert.equal(node('w-q1').classList.contains('hidden'), false);
    app.wNext(1, 'template');
    assert.equal(node('w-q2').classList.contains('hidden'), false);
    app.wNext(2, 'fio_no');
    app.wNext(3, 'sens_no');
    app.wNext(4, 'qwen');
    assert.match(node('w-verdict').innerHTML, /Нужна проверка перед загрузкой/);
  });

  test(`${name}: legal calculator is sourced, dated and contextualized`, async () => {
    const { html } = await loadApp(name);
    assert.match(html, /Нормы сверены по состоянию на 14\.10\.2026/);
    assert.match(html, /Калькулятор показывает только диапазоны санкций/);
    assert.doesNotMatch(html, /420-ФЗ · актуальная редакция/);
    assert.match(html, /rel="noopener noreferrer"/);
  });
}
