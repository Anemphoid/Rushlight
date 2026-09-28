// The three faces of a persistence vote:
//  - ballot:   you have a message in the chat, so you're asked
//  - progress: you started the vote and it's still open
//  - result:   you started it and it has been decided (shown once)
function PersistenceVote({ mode, proposal, onVote, onWithdraw, onHide, onClose }) {
  const kind = proposal.type === 'channel' ? 'channel' : 'room'
  const counts = `${proposal.agree} of ${proposal.total} agree · ${proposal.decline} decline · ${proposal.pending} waiting`

  if (mode === 'ballot') {
    return (
      <div className="poll-backdrop">
        <div className="poll-card">
          <h2>Keep history in "{proposal.name}"?</h2>
          <p className="settings-note">
            {proposal.proposer} wants this {kind} to keep its history. You have a message in it, so
            you get a vote. If it passes, what's been said here is saved permanently. If not, it
            clears itself as usual.
          </p>
          <p className="settings-note">{counts}</p>
          <div className="create-form-actions">
            <button type="button" className="btn-secondary" onClick={() => onVote('decline')}>
              Decline
            </button>
            <button type="button" className="btn-primary" onClick={() => onVote('agree')}>
              Agree
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (mode === 'progress') {
    return (
      <div className="poll-backdrop">
        <div className="poll-card">
          <h2>Vote on "{proposal.name}"</h2>
          <p className="settings-note">
            Everyone with a message in this {kind} has been asked. It passes once more than half
            agree, and fails as soon as that can't happen. Unanswered votes expire after a few
            minutes.
          </p>
          <p className="settings-note">{counts}</p>
          <div className="create-form-actions">
            <button type="button" className="btn-secondary" onClick={onWithdraw}>
              Cancel vote
            </button>
            <button type="button" className="btn-primary" onClick={onHide}>
              Hide
            </button>
          </div>
        </div>
      </div>
    )
  }

  const outcome = {
    passed: `"${proposal.name}" now keeps its history.`,
    failed: `Not enough people agreed, so "${proposal.name}" stays ephemeral.`,
    expired: `The vote ran out of time, so "${proposal.name}" stays ephemeral.`,
    cancelled: `The vote was cancelled, so "${proposal.name}" is unchanged.`
  }[proposal.status]

  return (
    <div className="poll-backdrop">
      <div className="poll-card">
        <h2>{proposal.status === 'passed' ? 'Vote passed' : 'Vote closed'}</h2>
        <p className="settings-note">{outcome}</p>
        <div className="create-form-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}

export default PersistenceVote
