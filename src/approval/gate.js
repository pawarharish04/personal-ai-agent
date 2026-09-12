const crypto = require('crypto');

class ApprovalGate {
  constructor(db, getWindow) {
    this.db = db;
    this.getWindow = getWindow;
    this.pendingRequests = new Map(); // id -> { resolve, reject, toolName, params }
  }

  /**
   * Request user approval for a risky tool call.
   * Sends IPC request to renderer and waits for user response.
   * Log decision to local audit log table in SQLite.
   */
  async requestApproval(toolName, params, executeFn) {
    const id = crypto.randomUUID();
    const window = typeof this.getWindow === 'function' ? this.getWindow() : this.getWindow;

    if (!window) {
      // If no window available, default to decline for safety
      this.db.logAudit(toolName, params, 'declined', 'No window available for approval');
      return {
        success: false,
        error: 'Approval dialog unavailable. Action declined for privacy and security.'
      };
    }

    // Create approval promise
    const approvalPromise = new Promise((resolve) => {
      this.pendingRequests.set(id, { resolve, toolName, params });
    });

    // Send request to Renderer UI
    window.webContents.send('approval:request', {
      id,
      toolName,
      params
    });

    // Wait for user decision from IPC
    const { approved } = await approvalPromise;

    if (!approved) {
      // User declined
      this.db.logAudit(toolName, params, 'declined', 'User denied action');
      return {
        success: false,
        userDeclined: true,
        message: `Action '${toolName}' was DECLINED by the user.`
      };
    }

    // User approved - log decision and execute
    const auditId = this.db.logAudit(toolName, params, 'approved');

    try {
      const result = await executeFn(params);
      this.db.db.prepare('UPDATE audit_log SET outcome = ? WHERE id = ?').run('success', auditId);
      return {
        success: true,
        result
      };
    } catch (err) {
      const errorMsg = `failed: ${err.message}`;
      this.db.db.prepare('UPDATE audit_log SET outcome = ? WHERE id = ?').run(errorMsg, auditId);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Handle user response from IPC ('approval:response')
   */
  handleUserResponse(id, approved) {
    if (this.pendingRequests.has(id)) {
      const request = this.pendingRequests.get(id);
      this.pendingRequests.delete(id);
      request.resolve({ approved });
    }
  }
}

module.exports = { ApprovalGate };
