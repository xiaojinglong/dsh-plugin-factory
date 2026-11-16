import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { markWorkbook } from './lib/mark.js'

const SKILL_FILE = fileURLToPath(new URL('./skills/excel-status-mark/SKILL.md', import.meta.url))

export const name = 'excel-status-mark-portable'
export const inject = ['tools', 'skills']

export function apply(ctx) {
  ctx.skills.register({
    name: 'excel-status-mark',
    description: 'Mark order statuses in an xlsx and write a new file without modifying the input.',
    whenToUse: 'Use when a user needs order statuses marked in an Excel workbook.',
    source: 'runtime',
    content: fs.readFileSync(SKILL_FILE, 'utf8'),
    resourceBase: { kind: 'directory', path: path.dirname(SKILL_FILE) },
    invocation: { modelInvocable: true, userInvocable: false },
  })
  ctx.tools.register({
    name: 'excel_status_mark',
    description: 'Read an order xlsx, mark status by amount, and write a new xlsx. The input file is not modified.',
    parameters: {
      input_path: { type: 'string', required: true, description: 'Absolute path to the input .xlsx' },
      output_path: { type: 'string', required: false, description: 'Output .xlsx path; defaults to <input>-marked.xlsx' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      return markWorkbook(args.input_path, args.output_path)
    },
  })
}
