function getJsonHeaders() {
    return { 'Content-Type': 'application/json' };
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
            statusEl.textContent = '✅ 개인키 파일 (' + file.name + ') 로드 완료 (' + content.length + ' 바이트)';
        }
        showToast("개인키 파일이 성공적으로 로드되었습니다.");
    };
    reader.readAsText(file);
}

let toastTimer = null;

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
        if (dto.harnessStatus === 'PENDING_CONFIRMATION' && dto.inferredHarnessCmd && dto.inferredHarnessCmd.trim().length > 0) {
            inferredCmd.textContent = dto.inferredHarnessCmd;
            inferredBox.style.display = 'block';
        } else {
            inferredBox.style.display = 'none';
        }
    }

    // Failed inference banner live sync
    const failedBox = document.getElementById('failed-box-' + fullName);
    if (failedBox) {
        failedBox.style.display = dto.harnessStatus === 'FAILED' ? 'block' : 'none';
    }

    // Harness status badge sync
    const harnessBadge = document.querySelector(`.status-badge-harness[data-repo='${fullName}']`);
    if (harnessBadge && dto.harnessStatus) {
        harnessBadge.textContent = '하네스: ' + dto.harnessStatus;
        harnessBadge.className = 'badge status-badge-harness ' + 
            (dto.harnessStatus === 'ACTIVE' ? 'badge-active' : (dto.harnessStatus === 'PENDING_CONFIRMATION' ? 'badge-pending' : 'badge-none'));
    }

    const sourceBadge = document.querySelector(`.status-badge-source[data-repo='${fullName}']`);
    if (sourceBadge) {
        if (dto.harnessSource && dto.harnessSource !== 'NONE') {
            sourceBadge.textContent = '출처: ' + dto.harnessSource;
            sourceBadge.style.display = 'inline-block';
        } else {
            sourceBadge.style.display = 'none';
        }
    }

    // EC2 status badge sync
    const ec2Badge = document.querySelector(`.status-badge-ec2[data-repo='${fullName}']`);
    if (ec2Badge) {
        ec2Badge.style.display = dto.logIngestActive ? 'inline-flex' : 'none';
    }
}

function saveSettings(repoFullName, triggeredFromToggle = false) {
    const toggleEl = document.getElementById('toggle-' + repoFullName);
    const active = toggleEl ? toggleEl.checked : false;
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

    const saveBtn = document.querySelector(`.btn-save[data-repo='${repoFullName}']`);
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
    }

    return fetch('/api/settings', {
        method: 'POST',
        headers: getJsonHeaders(),
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
        showToast("설정이 저장되었습니다.");
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error saving settings:', error);
        if (triggeredFromToggle && toggleEl) {
            toggleEl.checked = !active; // Rollback toggle state on error
        }
        showToast("설정 저장에 실패했습니다.", true);
    })
    .finally(() => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '설정 저장';
        }
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

            if (document.getElementById('sys-pikilandServerUrl')) document.getElementById('sys-pikilandServerUrl').value = data.pikilandServerUrl || '';
            if (document.getElementById('sys-globalAiBaseUrl')) document.getElementById('sys-globalAiBaseUrl').value = data.globalAiBaseUrl || '';
            if (document.getElementById('sys-globalAiApiKey')) document.getElementById('sys-globalAiApiKey').value = data.globalAiApiKey || '';
            if (document.getElementById('sys-globalAiModel')) document.getElementById('sys-globalAiModel').value = data.globalAiModel || '';
            
            const statusEl = document.getElementById('pem-file-status');
            if (statusEl && data.githubPrivateKeyContent && data.githubPrivateKeyContent.trim().length > 0) {
                statusEl.style.display = 'block';
                statusEl.textContent = '✅ 서버에 개인키(.pem)가 등록되어 있습니다.';
            }
        }
    })
    .catch(err => {
        console.log("System settings load info:", err.message);
    });
}

function saveSystemSettings() {
    const saveBtn = document.querySelector('.btn-save-system');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = '저장 중...';
    }

    const payload = {
        githubAppId: document.getElementById('sys-githubAppId').value,
        githubWebhookSecret: document.getElementById('sys-githubWebhookSecret').value,
        githubClientId: document.getElementById('sys-githubClientId').value,
        githubClientSecret: document.getElementById('sys-githubClientSecret').value,
        githubPrivateKeyContent: document.getElementById('sys-githubPrivateKeyContent').value,
        pikilandServerUrl: document.getElementById('sys-pikilandServerUrl') ? document.getElementById('sys-pikilandServerUrl').value : '',
        globalAiBaseUrl: document.getElementById('sys-globalAiBaseUrl') ? document.getElementById('sys-globalAiBaseUrl').value : '',
        globalAiApiKey: document.getElementById('sys-globalAiApiKey') ? document.getElementById('sys-globalAiApiKey').value : '',
        globalAiModel: document.getElementById('sys-globalAiModel') ? document.getElementById('sys-globalAiModel').value : ''
    };

    fetch('/api/settings/system', {
        method: 'POST',
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    })
    .then(response => {
        if (response.ok) {
            showToast("시스템 설정이 저장되었습니다.");
        } else {
            showToast("중앙 시스템 설정 저장에 실패했습니다.", true);
        }
    })
    .catch(err => {
        console.error('Error saving system settings:', err);
        showToast("네트워크 오류가 발생했습니다.", true);
    })
    .finally(() => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = '💾 시스템 설정 저장';
        }
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const iconEl = document.getElementById('theme-icon');
    const textEl = document.getElementById('theme-text');
    if (iconEl && textEl) {
        if (theme === 'light') {
            iconEl.textContent = '🌙';
            textEl.textContent = '다크 모드로 전환';
        } else {
            iconEl.textContent = '☀️';
            textEl.textContent = '라이트 모드로 전환';
        }
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem('pikiland-theme') || 'dark';
    applyTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('pikiland-theme', newTheme);
    applyTheme(newTheme);
}

function initRepoOwnerTabs() {
    const tabsBar = document.getElementById('repo-tabs-bar');
    if (!tabsBar) return;

    const cards = document.querySelectorAll('.repo-card[data-owner]');
    if (cards.length === 0) return;

    const ownersMap = new Map();
    cards.forEach(card => {
        const owner = card.getAttribute('data-owner');
        if (owner) {
            ownersMap.set(owner, (ownersMap.get(owner) || 0) + 1);
        }
    });

    tabsBar.innerHTML = '';

    // "All Repositories" Tab
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'owner-tab-btn active';
    allBtn.setAttribute('data-target-owner', 'all');
    allBtn.innerHTML = `🌐 전체 저장소 <span style="opacity: 0.7; font-size: 0.8em;">(${cards.length})</span>`;
    allBtn.onclick = () => switchOwnerTab('all');
    tabsBar.appendChild(allBtn);

    // Individual Owner Tabs
    ownersMap.forEach((count, owner) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'owner-tab-btn';
        btn.setAttribute('data-target-owner', owner);
        btn.innerHTML = `📁 ${owner} <span style="opacity: 0.7; font-size: 0.8em;">(${count})</span>`;
        btn.onclick = () => switchOwnerTab(owner);
        tabsBar.appendChild(btn);
    });
}

function switchOwnerTab(selectedOwner) {
    const tabBtns = document.querySelectorAll('.owner-tab-btn');
    tabBtns.forEach(btn => {
        if (btn.getAttribute('data-target-owner') === selectedOwner) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const cards = document.querySelectorAll('.repo-card[data-owner]');
    cards.forEach(card => {
        const cardOwner = card.getAttribute('data-owner');
        if (selectedOwner === 'all' || cardOwner === selectedOwner) {
            card.style.display = 'flex';
        } else {
            card.style.display = 'none';
        }
    });
}

function approveHarness(repoFullName) {
    const btn = document.querySelector(`.btn-approve-harness[data-repo='${repoFullName}']`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = '승인 중...';
    }

    return fetch('/api/settings/harness/approve', {
        method: 'POST',
        headers: getJsonHeaders(),
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
        showToast("하네스 명령어가 승인되었습니다.");
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error approving harness:', error);
        showToast("하네스 명령어 승인에 실패했습니다.", true);
    })
    .finally(() => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '추론된 명령어 승인';
        }
    });
}

function inferHarness(repoFullName) {
    const btn = document.querySelector(`.btn-infer-harness[data-repo='${repoFullName}']`);
    if (btn) {
        btn.disabled = true;
        btn.textContent = '추론 중...';
    }

    showToast("테스트 명령어 추론 중...");
    return fetch('/api/settings/harness/infer', {
        method: 'POST',
        headers: getJsonHeaders(),
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
            showToast("테스트 명령어 추론 완료: " + updatedDto.inferredHarnessCmd);
        } else if (updatedDto.inferenceMessage) {
            showToast(updatedDto.inferenceMessage, true);
        } else {
            showToast("저장소 파일에서 테스트 명령어를 추론할 수 없습니다.", true);
        }
        updateRepoUiFromDto(updatedDto);
    })
    .catch(error => {
        console.error('Error inferring harness:', error);
        showToast("테스트 명령어 추론에 실패했습니다.", true);
    })
    .finally(() => {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '명령어 재추론';
        }
    });
}

function handleToggleChange(inputEl) {
    const isInstalled = inputEl.getAttribute('data-installed') === 'true';
    const repoFullName = inputEl.getAttribute('data-repo');

    if (!isInstalled && inputEl.checked) {
        inputEl.checked = false; // Revert toggle
        showToast("⚠️ PikiLand GitHub App이 미설치된 저장소입니다. [🔑 앱 설치하기] 버튼을 눌러 먼저 권한을 부여해 주세요.", true);
        return;
    }

    // Persist and sync toggle state to backend immediately with rollback support
    saveSettings(repoFullName, true);
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }

    toast.textContent = message;
    if (isError) {
        toast.classList.add('error');
    } else {
        toast.classList.remove('error');
    }
    toast.classList.add('show');
    
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
        toastTimer = null;
    }, 3500);
}

// EC2 Fluent Bit Provisioning Modal Handlers
async function openProvisionModal(repoName, btnEl = null) {
    const modalRepoName = document.getElementById('modal-repo-name');
    const modalRepoDisplay = document.getElementById('modal-repo-display');
    const ipInput = document.getElementById('modal-ec2-ip');
    const logPathInput = document.getElementById('modal-log-path');
    const modal = document.getElementById('provision-modal');

    if (modalRepoName) modalRepoName.value = repoName;
    if (modalRepoDisplay) modalRepoDisplay.value = repoName;

    let existingIp = '';
    let existingLogPath = '';

    if (btnEl) {
        existingIp = btnEl.getAttribute('data-ec2-ip') || '';
        existingLogPath = btnEl.getAttribute('data-log-path') || '';
    }

    if (ipInput) ipInput.value = existingIp;
    if (logPathInput) {
        if (existingLogPath) {
            logPathInput.value = existingLogPath;
        } else {
            logPathInput.value = '/var/log/production/*.log';
        }
    }

    if (modal) modal.style.display = 'flex';
    
    // If no custom log path was set before, dynamically infer from repo files
    if (!existingLogPath) {
        try {
            const res = await fetch('/api/settings/infer-log-path?repo=' + encodeURIComponent(repoName));
            if (res.ok) {
                const data = await res.json();
                if (data.inferredLogPath && logPathInput) {
                    logPathInput.value = data.inferredLogPath;
                }
            }
        } catch (e) {
            console.warn('Failed to infer log path via API, using default', e);
        }
    }
}

function updateFileLabel(input) {
    const label = document.getElementById('pem-file-label');
    if (!label) return;
    if (input.files && input.files[0]) {
        label.textContent = '✅ ' + input.files[0].name;
        label.style.color = 'var(--primary-solid)';
    } else {
        label.textContent = '📁 클릭하여 SSH 개인키 파일을 선택하세요';
        label.style.color = 'var(--text-dim)';
    }
}

function closeProvisionModal() {
    const modal = document.getElementById('provision-modal');
    if (modal) modal.style.display = 'none';
    const fileInput = document.getElementById('modal-pem-key');
    if (fileInput) fileInput.value = '';
    const label = document.getElementById('pem-file-label');
    if (label) {
        label.textContent = '📁 클릭하여 SSH 개인키 파일을 선택하세요';
        label.style.color = 'var(--text-dim)';
    }
}

function handleModalBackdropClick(e) {
    if (e.target && e.target.id === 'provision-modal') {
        closeProvisionModal();
    }
}

// Incident History Modal Handlers
async function openIncidentModal(repoName) {
    const modal = document.getElementById('incident-modal');
    const titleEl = document.getElementById('incident-modal-repo-title');
    const container = document.getElementById('incident-list-container');

    if (titleEl) titleEl.textContent = repoName + ' 인시던트 내역';
    if (container) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-dim); padding: 24px;">인시던트 내역을 조회 중입니다...</div>';
    }
    if (modal) modal.style.display = 'flex';

    try {
        const res = await fetch('/api/settings/incidents?repo=' + encodeURIComponent(repoName));
        if (!res.ok) throw new Error('인시던트 조회에 실패했습니다.');
        const list = await res.json();

        if (!container) return;

        if (!Array.isArray(list) || list.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-dim); padding: 32px 16px; background: var(--input-bg); border-radius: 8px; border: 1px dashed var(--border-color);">
                    <div style="font-size: 2rem; margin-bottom: 8px;">✨</div>
                    <strong style="color: var(--text-light); display: block; margin-bottom: 4px;">수집된 인시던트가 없습니다</strong>
                    <span style="font-size: 0.82rem;">CI 실패 또는 프로덕션 에러 로그가 감지되면 여기에 자동으로 기록됩니다.</span>
                </div>
            `;
            return;
        }

        container.innerHTML = list.map(item => {
            const shortHash = item.hash ? item.hash.substring(0, 10) + '...' : 'unknown';
            let stateBadgeClass = 'badge-none';
            let stateLabel = item.state;
            if (item.state === 'RESOLVED') {
                stateBadgeClass = 'badge-active';
                stateLabel = '✅ 해결 완료 (RESOLVED)';
            } else if (item.state === 'PR_CREATED') {
                stateBadgeClass = 'badge-info';
                stateLabel = '🚀 PR 생성됨 (PR_CREATED)';
            } else if (item.state === 'IN_PROGRESS') {
                stateBadgeClass = 'badge-pending';
                stateLabel = '⏳ 자가 치유 진행 중 (IN_PROGRESS)';
            } else if (item.state === 'FAILED') {
                stateBadgeClass = 'badge-none';
                stateLabel = '❌ 패치 실패 (FAILED)';
            }

            const seenDate = item.lastSeenAt ? new Date(item.lastSeenAt).toLocaleString() : '-';
            const prLinkHtml = item.prUrl
                ? `<a href="${item.prUrl}" target="_blank" rel="noreferrer" class="btn btn-secondary" style="font-size: 0.75rem; padding: 2px 8px; border-color: #6366f1; color: #818cf8; text-decoration: none;">🔗 패치 PR 보기</a>`
                : '';

            return `
                <div style="background: var(--input-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px 14px; font-size: 0.85rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 6px;">
                        <span class="badge ${stateBadgeClass}">${stateLabel}</span>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <span style="font-size: 0.75rem; color: var(--text-dim);">발생 횟수: <strong style="color: #fbbf24;">${item.occurrenceCount || 1}회</strong></span>
                            ${prLinkHtml}
                        </div>
                    </div>
                    <div style="font-family: monospace; font-size: 0.82rem; color: var(--text-light); word-break: break-all; margin-bottom: 6px; background: rgba(0,0,0,0.25); padding: 6px 8px; border-radius: 4px;">
                        ${escapeHtml(item.normalizedSignature || item.rawLog || 'Unknown signature')}
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim);">
                        <span>Fingerprint: <code>${shortHash}</code></span>
                        <span>최근 발생: ${seenDate}</span>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        if (container) {
            container.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">오류: ${err.message}</div>`;
        }
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function closeIncidentModal() {
    const modal = document.getElementById('incident-modal');
    if (modal) modal.style.display = 'none';
}

function handleIncidentModalBackdropClick(e) {
    if (e.target && e.target.id === 'incident-modal') {
        closeIncidentModal();
    }
}

async function submitEc2Provision() {
    const repoEl = document.getElementById('modal-repo-name');
    const ipEl = document.getElementById('modal-ec2-ip');
    const userEl = document.getElementById('modal-ssh-user');
    const logPathEl = document.getElementById('modal-log-path');
    const pemFileEl = document.getElementById('modal-pem-key');

    const repo = repoEl ? repoEl.value : '';
    const ip = ipEl ? ipEl.value.trim() : '';
    const user = userEl ? userEl.value.trim() : '';
    const logPath = logPathEl ? logPathEl.value.trim() : '';
    const pemFile = pemFileEl && pemFileEl.files ? pemFileEl.files[0] : null;

    if (!ip || !user || !pemFile) {
        showToast("EC2 IP, SSH 사용자명, 그리고 SSH 개인키 파일을 모두 입력해 주세요.", true);
        return;
    }

    const formData = new FormData();
    formData.append('repositoryFullName', repo);
    formData.append('ec2Ip', ip);
    formData.append('sshUser', user);
    formData.append('logPath', logPath);
    formData.append('pemKey', pemFile);

    const btn = document.querySelector('.btn-submit-provision');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 프로비저닝 중...';
    }

    try {
        const res = await fetch('/api/settings/provision-ec2', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (res.ok) {
            showToast("✅ EC2 Fluent Bit 프로비저닝이 완료되었습니다.");
            closeProvisionModal();
            const ec2Badge = document.querySelector('.status-badge-ec2[data-repo="' + repo + '"]');
            if (ec2Badge) ec2Badge.style.display = 'inline-flex';
        } else {
            showToast("❌ 프로비저닝 실패: " + (data.message || '알 수 없는 오류'), true);
        }
    } catch (err) {
        showToast("❌ 서버 통신 오류: " + err.message, true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '프로비저닝 시작';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadSystemSettings();
    initRepoOwnerTabs();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProvisionModal();
        closeIncidentModal();
    }
});


