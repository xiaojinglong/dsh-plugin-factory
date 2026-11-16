const fs = require('node:fs');
const path = require('node:path');

const cases = [
  ['add', 'Add two numbers', 'return { value: Number(args.a) + Number(args.b) }', "assert.equal((await execute({ a: 2, b: 3 })).value, 5)"],
  ['sub', 'Subtract numbers', 'return { value: Number(args.a) - Number(args.b) }', "assert.equal((await execute({ a: 5, b: 3 })).value, 2)"],
  ['mul', 'Multiply numbers', 'return { value: Number(args.a) * Number(args.b) }', "assert.equal((await execute({ a: 4, b: 3 })).value, 12)"],
  ['div', 'Divide numbers', 'return { value: Number(args.a) / Number(args.b) }', "assert.equal((await execute({ a: 8, b: 2 })).value, 4)"],
  ['mod', 'Modulo numbers', 'return { value: Number(args.a) % Number(args.b) }', "assert.equal((await execute({ a: 7, b: 3 })).value, 1)"],
  ['max', 'Maximum value', 'return { value: Math.max(...(args.list || []).map(Number)) }', "assert.equal((await execute({ list: [1, 9, 3] })).value, 9)"],
  ['min', 'Minimum value', 'return { value: Math.min(...(args.list || []).map(Number)) }', "assert.equal((await execute({ list: [1, 9, 3] })).value, 1)"],
  ['avg', 'Average value', 'const v=(args.list||[]).map(Number); return { value: v.reduce((a,b)=>a+b,0)/v.length }', "assert.equal((await execute({ list: [2, 4, 6] })).value, 4)"],
  ['median', 'Median value', 'const v=(args.list||[]).map(Number).sort((a,b)=>a-b); const m=Math.floor(v.length/2); return { value: v.length%2?v[m]:(v[m-1]+v[m])/2 }', "assert.equal((await execute({ list: [1, 3, 2] })).value, 2)"],
  ['round', 'Round number', 'return { value: Math.round(Number(args.a)) }', "assert.equal((await execute({ a: 2.6 })).value, 3)"],
  ['ceil', 'Ceil number', 'return { value: Math.ceil(Number(args.a)) }', "assert.equal((await execute({ a: 2.1 })).value, 3)"],
  ['floor', 'Floor number', 'return { value: Math.floor(Number(args.a)) }', "assert.equal((await execute({ a: 2.9 })).value, 2)"],
  ['abs', 'Absolute number', 'return { value: Math.abs(Number(args.a)) }', "assert.equal((await execute({ a: -4 })).value, 4)"],
  ['clamp', 'Clamp number', 'const n=Number(args.a); return { value: Math.min(Number(args.max), Math.max(Number(args.min), n)) }', "assert.equal((await execute({ a: 12, min: 0, max: 10 })).value, 10)"],
  ['percent', 'Percent of number', 'return { value: Number(args.a) * Number(args.b) / 100 }', "assert.equal((await execute({ a: 200, b: 15 })).value, 30)"],
  ['upper', 'Uppercase text', 'return { text: String(args.text || "").toUpperCase() }', `assert.equal((await execute({ text: "abc" })).text, "ABC")`],
  ['lower', 'Lowercase text', 'return { text: String(args.text || "").toLowerCase() }', `assert.equal((await execute({ text: "ABC" })).text, "abc")`],
  ['title', 'Title case text', 'return { text: String(args.text || "").replace(/\\b\\w/g, (c) => c.toUpperCase()) }', `assert.equal((await execute({ text: "hello world" })).text, "Hello World")`],
  ['trim', 'Trim text', 'return { text: String(args.text || "").trim() }', `assert.equal((await execute({ text: "  a  " })).text, "a")`],
  ['reverse', 'Reverse text', 'return { text: String(args.text || "").split("").reverse().join("") }', `assert.equal((await execute({ text: "abc" })).text, "cba")`],
  ['length', 'Text length', 'return { value: String(args.text || "").length }', `assert.equal((await execute({ text: "abc" })).value, 3)`],
  ['contains', 'Contains text', 'return { value: String(args.text || "").includes(String(args.needle || "")) }', `assert.equal((await execute({ text: "abc", needle: "b" })).value, true)`],
  ['startswith', 'Starts with', 'return { value: String(args.text || "").startsWith(String(args.needle || "")) }', `assert.equal((await execute({ text: "abc", needle: "a" })).value, true)`],
  ['endswith', 'Ends with', 'return { value: String(args.text || "").endsWith(String(args.needle || "")) }', `assert.equal((await execute({ text: "abc", needle: "c" })).value, true)`],
  ['replace', 'Replace text', 'return { text: String(args.text || "").split(String(args.from || "")).join(String(args.to || "")) }', `assert.equal((await execute({ text: "a-b", from: "-", to: "_" })).text, "a_b")`],
  ['join', 'Join list', 'return { text: (args.list || []).map(String).join(String(args.sep ?? ",")) }', `assert.equal((await execute({ list: ["a", "b"], sep: "-" })).text, "a-b")`],
  ['split', 'Split text', 'return { list: String(args.text || "").split(String(args.sep ?? ",")) }', `assert.deepEqual((await execute({ text: "a,b", sep: "," })).list, ["a", "b"])`],
  ['repeat', 'Repeat text', 'return { text: String(args.text || "").repeat(Number(args.n || 1)) }', `assert.equal((await execute({ text: "a", n: 3 })).text, "aaa")`],
  ['padstart', 'Pad start', 'return { text: String(args.text || "").padStart(Number(args.n || 0), String(args.ch || "0")) }', `assert.equal((await execute({ text: "7", n: 3, ch: "0" })).text, "007")`],
  ['padend', 'Pad end', 'return { text: String(args.text || "").padEnd(Number(args.n || 0), String(args.ch || "0")) }', `assert.equal((await execute({ text: "7", n: 3, ch: "0" })).text, "700")`],
];

const workflows = cases.map(([id, title, body, testBody]) => {
  const tool = `case_${id}`;
  return {
    id: `case-${id}`,
    name: title,
    spec: {
      description: title,
      permissions: { filesystem: [], network: [] },
      tools: [{ name: tool, description: title, parameters: {} }],
      acceptance: ['computed result is correct'],
    },
    files: [
      { path: 'lib/impl.js', content: `export async function execute(args = {}) {\n  ${body}\n}\n` },
      { path: 'tests/impl.test.mjs', content: `import test from 'node:test'\nimport assert from 'node:assert'\nimport { execute } from '../lib/impl.js'\ntest('${title}', async () => { ${testBody} })\n` },
    ],
  };
});

const out = path.join(__dirname, 'workflows-extra.json');
fs.writeFileSync(out, JSON.stringify(workflows, null, 2) + '\n', 'utf8');
console.log(`wrote ${workflows.length} workflows to ${out}`);
