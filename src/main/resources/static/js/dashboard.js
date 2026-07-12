function saveSettings(repoFullName) {
    const active = document.getElementById('toggle-' + repoFullName).checked;
    const slackUrl = document.getElementById('slack-' + repoFullName).value;
    const customModel = document.getElementById('model-' + repoFullName).value;

    const payload = {
        fullName: repoFullName,
        active: active,
        slackWebhookUrl: slackUrl,
        customModel: customModel
    };

    fetch('/api/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            showToast("Settings updated successfully!");
        } else {
            showToast("Failed to save settings.", true);
        }
    })
    .catch(error => {
        console.error('Error saving settings:', error);
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
