import { markWorkbook } from './lib/mark.js'

export const name = 'excel-status-mark-portable'
export const inject = ['tools']

export function apply(ctx) {
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
