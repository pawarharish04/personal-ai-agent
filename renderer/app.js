document.addEventListener('DOMContentLoaded', async () => {
  const chatForm = document.getElementById('chat-form');
  const messageInput = document.getElementById('message-input');
  const sendBtn = document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');
  const messagesList = document.getElementById('messages-list');
  const chatContainer = document.getElementById('chat-container');
  const newChatBtn = document.getElementById('new-chat-btn');

  let isPttActive = false;
  let wasVoiceTriggered = false;
  let recognition = null;
  let autoSendTimeout = null;

  // Initialize Speech Recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        messageInput.value = finalTranscript.trim();
        // Reset and start auto-send countdown when final result is received
        clearTimeout(autoSendTimeout);
        autoSendTimeout = setTimeout(() => {
          if (messageInput.value.trim() && !isPttActive) {
            chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
          }
        }, 1000);
      }
    };
    
    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      stopPtt();
    };
  }

  // Handle manual typing during countdown
  messageInput.addEventListener('input', () => {
    if (autoSendTimeout) {
      clearTimeout(autoSendTimeout);
      autoSendTimeout = null;
    }
  });

  function startPtt() {
    if (isPttActive || !recognition) return;
    isPttActive = true;
    wasVoiceTriggered = true;
    clearTimeout(autoSendTimeout);
    micBtn.className = 'mic-button listening';
    messageInput.placeholder = 'Listening...';
    try {
      recognition.start();
    } catch (e) {
      // already started
    }
  }

  function stopPtt() {
    if (!isPttActive || !recognition) return;
    isPttActive = false;
    micBtn.className = 'mic-button processing';
    messageInput.placeholder = 'Processing...';
    try {
      recognition.stop();
    } catch (e) {
      // already stopped
    }
    // Revert to idle after a short delay if no submit happens
    setTimeout(() => {
      if (micBtn.className.includes('processing')) {
        micBtn.className = 'mic-button idle';
        messageInput.placeholder = 'Ask me anything or hold Right Alt to speak...';
      }
    }, 2000);
  }

  // IPC Hooks
  if (window.api.onPttStart) window.api.onPttStart(startPtt);
  if (window.api.onPttStop) window.api.onPttStop(stopPtt);

  // Mouse Hold PTT
  micBtn.addEventListener('mousedown', startPtt);
  micBtn.addEventListener('mouseup', stopPtt);
  micBtn.addEventListener('mouseleave', stopPtt);

  // New Chat
  newChatBtn.addEventListener('click', async () => {
    // Idempotency check: If there are no messages, we are already in a new chat
    if (messagesList.querySelectorAll('.message-row').length === 0) {
      return;
    }

    await window.api.clearHistory();
    messagesList.innerHTML = '';
    const welcomeCard = document.querySelector('.welcome-card');
    if (welcomeCard) welcomeCard.style.display = 'block';
    
    // Refresh sidebar with no active session (or create a new dummy one)
    const sessionsList = document.getElementById('sessions-list');
    Array.from(sessionsList.children).forEach(child => child.classList.remove('active'));
    
    const newItem = document.createElement('div');
    newItem.className = 'session-item active';
    newItem.textContent = 'Current Session';
    sessionsList.insertBefore(newItem, sessionsList.firstChild);
  });

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
      const welcomeCard = document.querySelector('.welcome-card');
      if (welcomeCard) welcomeCard.style.display = 'none';
      history.forEach(msg => appendMessage(msg.role, msg.content));
    }
  } catch (err) {
    console.error('Failed to load chat history:', err);
  }

  // Load sessions for sidebar
  async function loadSessionsSidebar(activeSessionId = null) {
    try {
      const sessions = await window.api.getSessions();
      const sessionsList = document.getElementById('sessions-list');
      sessionsList.innerHTML = '';
      
      // Add current session fallback if empty
      if (!sessions || sessions.length === 0) {
        const item = document.createElement('div');
        item.className = 'session-item active';
        item.textContent = 'Current Session';
        sessionsList.appendChild(item);
        return;
      }

      sessions.forEach((sess, idx) => {
        const item = document.createElement('div');
        // Assume first session is active if none provided
        const isActive = activeSessionId ? sess.id === activeSessionId : idx === 0;
        item.className = 'session-item' + (isActive ? ' active' : '');
        item.title = new Date(sess.started_at).toLocaleString();

        const titleSpan = document.createElement('span');
        titleSpan.className = 'session-title';
        // Trim title
        let displayTitle = sess.title || 'New Chat';
        if (displayTitle.length > 25) displayTitle = displayTitle.substring(0, 25) + '...';
        titleSpan.textContent = displayTitle;

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'session-delete-btn';
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        deleteBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm("Delete this chat? This can't be undone.")) {
            const res = await window.api.deleteSession(sess.id);
            if (res.wasActive) {
              messagesList.innerHTML = '';
              const welcomeCard = document.querySelector('.welcome-card');
              if (welcomeCard) welcomeCard.style.display = 'block';
            }
            loadSessionsSidebar(res.wasActive ? null : activeSessionId);
          }
        });

        item.appendChild(titleSpan);
        item.appendChild(deleteBtn);
        
        item.addEventListener('click', async () => {
          messagesList.innerHTML = '';
          const welcomeCard = document.querySelector('.welcome-card');
          if (welcomeCard) welcomeCard.style.display = 'none';
          
          const history = await window.api.loadSession(sess.id);
          history.forEach(msg => appendMessage(msg.role, msg.content));
          
          loadSessionsSidebar(sess.id); // refresh active state
        });
        
        sessionsList.appendChild(item);
      });
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }

  loadSessionsSidebar();

  // ── Storage Health Badge ────────────────────────────────────────────
  const storageBadge = document.getElementById('storage-badge');
  const storageBanner = document.getElementById('storage-banner');
  const storageBannerText = document.getElementById('storage-banner-text');

  async function updateStorageHealth() {
    try {
      const health = await window.api.getStorageHealth();
      if (!health || !storageBadge) return;

      storageBadge.textContent = `⚙ ${health.usedMB} MB / ${health.hardCapMB} MB`;
      storageBadge.className = 'storage-badge';
      storageBanner.className = 'storage-banner hidden';

      if (health.status === 'over_hard_cap') {
        storageBadge.classList.add('critical');
        storageBannerText.textContent =
          `⚠️ Storage is full (${health.usedMB} MB / ${health.hardCapMB} MB). Old sessions will be summarized automatically on next restart.`;
        storageBanner.classList.remove('hidden');
        storageBanner.classList.add('critical');
      } else if (health.status === 'over_soft_cap') {
        storageBadge.classList.add('warning');
        storageBannerText.textContent =
          `⚠️ Storage usage high (${health.usedMB} MB / ${health.softCapMB} MB soft cap). Maintenance will run automatically.`;
        storageBanner.classList.remove('hidden');
      } else if (health.status === 'approaching_limit') {
        storageBadge.classList.add('warning');
        // No banner — badge colour is enough signal at this stage
      }
    } catch (err) {
      console.error('Storage health check failed:', err);
    }
  }

  // Initial check on load, then refresh every 5 minutes
  updateStorageHealth();
  setInterval(updateStorageHealth, 5 * 60 * 1000);

  // Hard-cap event pushed from main process after maintenance
  window.api.onStorageWarning((health) => {
    if (storageBadge) {
      storageBadge.textContent = `⚙ ${health.usedMB} MB / ${health.hardCapMB} MB`;
      storageBadge.className = 'storage-badge critical';
    }
    if (storageBanner) {
      storageBannerText.textContent =
        `⚠️ Storage is over hard cap (${health.usedMB} MB). Please review old data.`;
      storageBanner.className = 'storage-banner critical';
    }
  });


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
    const welcomeCard = document.querySelector('.welcome-card');
    if (welcomeCard) welcomeCard.style.display = 'none';
    messageInput.value = '';
    messageInput.disabled = true;
    sendBtn.disabled = true;

    // Append typing indicator
    const typingElem = showTypingIndicator();

    // Reset mic button state if this was a voice submission
    micBtn.className = 'mic-button idle';
    messageInput.placeholder = 'Ask me anything or hold Right Alt to speak...';

    // Cancel any ongoing speech synthesis
    window.speechSynthesis.cancel();

    try {
      const response = await window.api.sendMessage(text);
      removeTypingIndicator(typingElem);
      appendMessage('assistant', response.content);
      
      // Refresh sidebar so the new chat shows up immediately
      loadSessionsSidebar();
      
      // Speak the response if triggered by voice
      if (wasVoiceTriggered && response.content) {
        const utterance = new SpeechSynthesisUtterance(response.content);
        window.speechSynthesis.speak(utterance);
      }
    } catch (err) {
      removeTypingIndicator(typingElem);
      appendMessage('assistant', `⚠️ **Client Error:** ${err.message}`);
    } finally {
      wasVoiceTriggered = false; // Reset for next turn
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
    msgDiv.classList.add('message-row', `message-${role}`);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-bubble', 'message-content');
    
    if (role === 'assistant' && window.marked) {
      contentDiv.innerHTML = window.marked.parse(content);
    } else {
      contentDiv.textContent = content;
    }

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
