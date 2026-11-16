# Excel status mark

Portable DSH Host plugin. Registers `excel_status_mark`.

- Input: `.xlsx` with `order_id`, `amount`, `status`
- Rules: `amount <= 0` → `异常-待核对`; `amount >= 100` → `高额-已标记`; else `正常`
- Output: new xlsx; input unchanged
- No service, no port, no factory runtime
