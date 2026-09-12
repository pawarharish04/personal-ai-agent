document.addEventListener('DOMContentLoaded', async () => {
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const messagesList = document.getElementById('messages-list');
  const chatContainer = document.getElementById('chat-container');

  // Modal elements
  const approvalModal = document.getElementById('approval-modal');
  const approvalToolName = document.getElementById('approval-tool-name');
  const approvalToolParams = document.getElementById('approval-tool-params');
  const btnApprove = document.getElementById('btn-approve');
  const btnDecline = document.getElementById('btn-decline');

  let currentApprovalId = null;

  // Load existing history if available
  try {
    const history = await window.api.getHistory();
    if (history && history.length > 0) {
      history.forEach(msg => appendMessage(msg.role, msg.content));
    }
  } catch (err) {
    console.error('Failed to load chat history:', err);
  }

  // Listen for approval requests from Approval Gate (Main process)
  window.api.onApprovalRequest((request) => {
    currentApprovalId = request.id;
    approvalToolName.textContent = request.toolName;
    approvalToolParams.textContent = JSON.stringify(request.params, null, 2);
    approvalModal.classList.remove('hidden');
  });

  // Modal Approve Button
  btnApprove.addEventListener('click', () => {
    if (currentApprovalId) {
      window.api.respondApproval({ id: currentApprovalId, approved: true });
      approvalModal.classList.add('hidden');
      currentApprovalId = null;
    }
  });

  // Modal Decline Button
  btnDecline.addEventListener('click', () => {
    if (currentApprovalId) {
      window.api.respondApproval({ id: currentApprovalId, approved: false });
      approvalModal.classList.add('hidden');
      currentApprovalId = null;
    }
  });

  // Handle Form Submission
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    // Append user message
    appendMessage('user', text);
    messageInput.value = '';
    messageInput.disabled = true;
    sendBtn.disabled = true;

    // Append typing indicator
    const typingElem = showTypingIndicator();

    try {
      const response = await window.api.sendMessage(text);
      removeTypingIndicator(typingElem);
      appendMessage('assistant', response.content);
    } catch (err) {
      removeTypingIndicator(typingElem);
      appendMessage('assistant', `⚠️ **Client Error:** ${err.message}`);
    } finally {
      messageInput.disabled = false;
      sendBtn.disabled = false;
      messageInput.focus();
      scrollToBottom();
    }
  });

  // Handle Enter key for submit (Shift+Enter for new line)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  function appendMessage(role, content) {
    if (typeof content !== 'string') return;
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message-item', role);

    const senderSpan = document.createElement('span');
    senderSpan.classList.add('message-sender');
    senderSpan.textContent = role === 'user' ? 'You' : 'Claude Assistant';

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    contentDiv.textContent = content;

    msgDiv.appendChild(senderSpan);
    msgDiv.appendChild(contentDiv);
    messagesList.appendChild(msgDiv);

    scrollToBottom();
  }

  function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.classList.add('typing-indicator');
    indicator.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    chatContainer.appendChild(indicator);
    scrollToBottom();
    return indicator;
  }

  function removeTypingIndicator(indicator) {
    if (indicator && indicator.parentNode) {
      indicator.parentNode.removeChild(indicator);
    }
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
});
