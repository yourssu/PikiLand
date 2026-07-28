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
            showToast("Settings updated successfully!");
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast("Failed to save settings.", true);
        }
    })
    .catch(error => {
        console.error('Error saving settings:', error);
        showToast("Network error occurred.", true);
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
            showToast("Central System Settings updated successfully!");
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
            showToast("Harness command approved and activated!");
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast("Failed to approve harness command.", true);
        }
    })
    .catch(error => {
        console.error('Error approving harness:', error);
        showToast("Network error occurred.", true);
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
            showToast("Test command inferred!");
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showToast("Failed to infer test command.", true);
        }
    })
    .catch(error => {
        console.error('Error inferring harness:', error);
        showToast("Network error occurred.", true);
    });
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    if (isError) {
        toast.classList.add('error');
    } else {
        toast.classList.remove('error');
    }
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

