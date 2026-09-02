import { ApprovalStore } from '../core/approvals.js'

export async function approveCommand(token: string) {
  if (!token) {
    console.error('Usage: fourier approve <token>')
    process.exit(1)
  }

  const approvals = new ApprovalStore('.fourier')
  const result = approvals.approve(token)

  if (!result.ok) {
    console.error(`Approval rejected: ${result.reason}`)
    process.exit(1)
  }

  console.log('Approval Granted:')
  console.log(JSON.stringify({ status: 'approved', proposal: result.approval.proposal }, null, 2))
}
