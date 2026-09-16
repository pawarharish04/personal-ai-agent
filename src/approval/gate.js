const crypto = require('crypto');

class ApprovalGate {
  constructor(db, getWindow) {
    this.db = db;
    this.getWindow = getWindow;
    this.pendingRequests = new Map(); // id -> { resolve, toolName, params }
  }

  /**
   * Request user approval for a risky tool call.
   * Blocks execution until the user confirms or denies in the UI.
   * Writes decision + outcome to local audit_log (with risk_level from db.js map).
   */
  async requestApproval(toolName, params, executeFn) {
    const id = crypto.randomUUID();
    const window = typeof this.getWindow === 'function' ? this.getWindow() : this.getWindow;

    if (!window) {
      // No window available — decline for safety
      this.db.logAudit(toolName, params, 'declined', 'No window available for approval');
      return {
        success: false,
        error: 'Approval dialog unavailable. Action declined for privacy and security.'
      };
    }

    // Create approval promise — resolved by handleUserResponse
    const approvalPromise = new Promise((resolve) => {
      this.pendingRequests.set(id, { resolve, toolName, params });
    });

    window.webContents.send('approval:request', { id, toolName, params });

    const { approved } = await approvalPromise;

    if (!approved) {
      this.db.logAudit(toolName, params, 'declined', 'User denied action');
      return {
        success: false,
        userDeclined: true,
        message: `Action '${toolName}' was DECLINED by the user.`
      };
    }

    // User approved — log first, then execute, then update outcome
    const auditId = this.db.logAudit(toolName, params, 'approved');

    try {
      const result = await executeFn(params);
      this.db.updateAuditOutcome(auditId, 'success');
      return { success: true, result };
    } catch (err) {
      this.db.updateAuditOutcome(auditId, `failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /** Called by IPC listener when user clicks Approve or Deny in the UI. */
  handleUserResponse(id, approved) {
    if (this.pendingRequests.has(id)) {
      const request = this.pendingRequests.get(id);
      this.pendingRequests.delete(id);
      request.resolve({ approved });
    }
  }
}

module.exports = { ApprovalGate };
