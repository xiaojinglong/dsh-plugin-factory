export const name = 'portable-host-spike'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'portable_ping',
    description: 'Return a fixed portable bundle result.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute() { return 'portable-ok' },
  })
}
