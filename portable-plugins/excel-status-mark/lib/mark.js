import fs from 'node:fs/promises'
import ExcelJS from 'exceljs'

export async function markWorkbook(inputPath, outputPath) {
  if (!inputPath) throw new Error('缺少 input_path')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(inputPath)
  const ws = wb.getWorksheet('Orders') || wb.worksheets[0]
  if (!ws) throw new Error('Excel 没有工作表')
  const header = ws.getRow(1).values.filter(Boolean).map(String)
  const col = (name) => header.indexOf(name) + 1
  const idCol = col('order_id')
  const amountCol = col('amount')
  const statusCol = col('status')
  if (!idCol || !amountCol || !statusCol) throw new Error('需要 order_id/amount/status 列')
  const rows = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const id = String(row.getCell(idCol).value ?? '')
    if (!id) return
    const amount = Number(row.getCell(amountCol).value)
    const before = String(row.getCell(statusCol).value ?? '')
    const after = amount <= 0 ? '异常-待核对' : amount >= 100 ? '高额-已标记' : '正常'
    rows.push({ order_id: id, amount, before, after })
    if (before !== after) row.getCell(statusCol).value = after
  })
  const out = outputPath || inputPath.replace(/\.xlsx$/i, '-marked.xlsx')
  await fs.mkdir(out.replace(/[\\/][^\\/]+$/, ''), { recursive: true }).catch(() => {})
  await wb.xlsx.writeFile(out)
  return { input_path: inputPath, output_path: out, total: rows.length, changed: rows.filter((r) => r.before !== r.after).length, rows }
}
