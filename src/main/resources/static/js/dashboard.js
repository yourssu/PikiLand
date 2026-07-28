function getCsrfHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const tokenMeta = document.querySelector("meta[name='_csrf']");
    const headerMeta = document.querySelector("meta[name='_csrf_header']");
    if (tokenMeta && headerMeta) {
        const token = tokenMeta.getAttribute("content");
        const headerName = headerMeta.getAttribute("content");
        if (token && headerName) {
            headers[headerName] = token;
        }
    }
    return headers;
}

function handlePemFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        const hiddenEl = document.getElementById('sys-githubPrivateKeyContent');
        if (hiddenEl) {
            hiddenEl.value = content;
        }
        const statusEl = document.getElementById('pem-file-status');
        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.textContent = '✅ Private Key file (' + file.name + ') loaded successfully (' + content.length + ' bytes)';
        }
        showToast("Private key file loaded successfully!");
    };
    reader.readAsText(file);
}

function updateRepoUiFromDto(dto) {
    if (!dto || !dto.fullName) return;
    const fullName = dto.fullName;

    // Toggle sync
    const toggle = document.getElementById('toggle-' + fullName);
    if (toggle) {
        toggle.checked = dto.active;
        if (dto.hasAppInstalled !== undefined) {
            toggle.setAttribute('data-installed', dto.hasAppInstalled);
        }
    }

    // Form inputs sync
    const slack = document.getElementById('slack-' + fullName);
    if (slack) slack.value = dto.slackWebhookUrl || '';

    const model = document.getElementById('model-' + fullName);
    if (model) model.value = dto.customModel || '';

    const baseUrl = document.getElementById('baseUrl-' + fullName);
    if (baseUrl) baseUrl.value = dto.customBaseUrl || '';

    const harness = document.getElementById('harness-' + fullName);
    if (harness) harness.value = dto.harnessCmd || '';

    const ralph = document.getElementById('ralph-' + fullName);
    if (ralph) ralph.value = dto.ralphMaxRetries || 3;

    // Inferred harness banner live sync
    const inferredBox = document.getElementById('inferred-box-' + fullName);
    const inferredCmd = document.getElementById('inferred-cmd-' + fullName);
    if (inferredBox && inferredCmd) {
        if (dto.inferredHarnessCmd && dto.inferredHarnessCmd.trim().length > 0) {
            inferredCmd.textContent = dto.inferredHarnessCmd;
            inferredBox.style.display = 'block';
        } else {
            inferredBox.style.display = 'none';
        }
    }

    // Harness status badge sync
    const harnessBadge = document.querySelector(`.status-badge-harness[data-repo='${fullName}']`);
    if (harnessBadge && dto.harnessStatus) {
        harnessBadge.textContent = 'Harness: ' + dto.harnessStatus;
        harnessBadge.className = 'badge status-badge-harness ' + 
            (dto.harnessStatus === 'ACTIVE' ? 'badge-active' : (dto.harnessStatus === 'PENDING_CONFIRMATION' ? 'badge-pending' : 'badge-none'));
    }

    const sourceBadge = document.querySelector(`.status-badge-source[data-repo='${fullName}']`);
    if (sourceBadge) {
        if (dto.harnessSource && dto.harnessSource !== 'NONE') {
            sourceBadge.textContent = 'Source: ' + dto.harnessSource;
            sourceBadge.style.display = 'inline-block';
        } else {
            sourceBadge.style.display = 'none';
        }
    }
}

function saveSettings(repoFullName) {
    const active = document.getElementById('toggle-' + repoFullName).checked;
    const slackUrl = document.getElementById('slack-' + repoFullName).value;
    const customModel = document.getElementById('model-' + repoFullName).value;
    const baseUrlInput = document.getElementById('baseUrl-' + repoFullName);
    const customBaseUrl = baseUrlInput ? baseUrlInput.value : '';
    const harnessCmd = document.getElementById('harness-' + repoFullName).value;
    const ralphInput = document.getElementById('ralph-' + repoFullName);
    const ralphMaxRetries = ralphInput ? parseInt(ralphInput.value, 10) || 3 : 3;

    const payload = {
        fullName: repoFullName,
        active: active,
        slackWebhookUrl: slackUrl,
        customModel: customModel,
        customBaseUrl: customBaseUrl,
        harnessCmd: harnessCmd,
        ralphMaxRetries: ralphMaxRetries
    };

    fetch('/api/settings', {
        method: 'POST',
        headers: getCsrfHeaders(),
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error("Failed to save settings");
        }
    })
    .then(updatedDto => {
        showToast("Settings saved and synced with backend!");
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error saving settings:', error);
        showToast("Failed to save settings.", true);
    });
}

function loadSystemSettings() {
    const appIdEl = document.getElementById('sys-githubAppId');
    if (!appIdEl) return; // Not admin UI

    fetch('/api/settings/system')
    .then(response => {
        if (response.ok) return response.json();
        throw new Error("Failed to load system settings");
    })
    .then(data => {
        if (data) {
            document.getElementById('sys-githubAppId').value = data.githubAppId || '';
            document.getElementById('sys-githubWebhookSecret').value = data.githubWebhookSecret || '';
            document.getElementById('sys-githubClientId').value = data.githubClientId || '';
            document.getElementById('sys-githubClientSecret').value = data.githubClientSecret || '';
            document.getElementById('sys-githubPrivateKeyContent').value = data.githubPrivateKeyContent || '';
            
            const statusEl = document.getElementById('pem-file-status');
            if (statusEl && data.githubPrivateKeyContent && data.githubPrivateKeyContent.trim().length > 0) {
                statusEl.style.display = 'block';
                statusEl.textContent = '✅ Previously configured: Private Key (.pem) is registered in server.';
            }
        }
    })
    .catch(err => {
        console.log("System settings load info:", err.message);
    });
}

function saveSystemSettings() {
    const payload = {
        githubAppId: document.getElementById('sys-githubAppId').value,
        githubWebhookSecret: document.getElementById('sys-githubWebhookSecret').value,
        githubClientId: document.getElementById('sys-githubClientId').value,
        githubClientSecret: document.getElementById('sys-githubClientSecret').value,
        githubPrivateKeyContent: document.getElementById('sys-githubPrivateKeyContent').value
    };

    fetch('/api/settings/system', {
        method: 'POST',
        headers: getCsrfHeaders(),
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            showToast("Central System Settings updated and synced!");
        } else {
            showToast("Failed to save central system settings.", true);
        }
    })
    .catch(err => {
        console.error('Error saving system settings:', err);
        showToast("Network error occurred.", true);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    loadSystemSettings();
});

function approveHarness(repoFullName) {
    fetch('/api/settings/harness/approve', {
        method: 'POST',
        headers: getCsrfHeaders(),
        body: JSON.stringify({ fullName: repoFullName })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error("Failed to approve harness");
        }
    })
    .then(updatedDto => {
        showToast("Harness command approved and synced with backend!");
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error approving harness:', error);
        showToast("Failed to approve harness command.", true);
    });
}

function inferHarness(repoFullName) {
    showToast("Inferring test command...");
    fetch('/api/settings/harness/infer', {
        method: 'POST',
        headers: getCsrfHeaders(),
        body: JSON.stringify({ fullName: repoFullName })
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        } else {
            throw new Error("Failed to infer test command");
        }
    })
    .then(updatedDto => {
        if (updatedDto.inferredHarnessCmd && updatedDto.inferredHarnessCmd.trim().length > 0) {
            showToast("Test command inferred: " + updatedDto.inferredHarnessCmd);
        } else if (updatedDto.inferenceMessage) {
            showToast(updatedDto.inferenceMessage, true);
        } else {
            showToast("No test command inferred from repository files.", true);
        }
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error inferring harness:', error);
        showToast("Failed to infer test command.", true);
    });
}

function handleToggleChange(inputEl) {
    const isInstalled = inputEl.getAttribute('data-installed') === 'true';
    const repoFullName = inputEl.getAttribute('data-repo');

    if (!isInstalled && inputEl.checked) {
        inputEl.checked = false; // Revert toggle
        showToast("⚠️ PikiLand GitHub App이 미설치된 저장소입니다. [🔑 Install App] 버튼을 눌러 먼저 권한을 부여해 주세요.", true);
        alert("⚠️ [PikiLand App 미설치 경고]\n\n" + repoFullName + " 저장소에 PikiLand GitHub App 권한이 부여되지 않았습니다.\n\n[🔑 Install App] 링크를 클릭하여 먼저 GitHub App을 저장소에 설치해 주세요.");
        return;
    }

    // Persist and sync toggle state to backend immediately
    saveSettings(repoFullName);
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    if (isError) {
        toast.classList.add('error');
    } else {
        toast.classList.remove('error');
    }
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

