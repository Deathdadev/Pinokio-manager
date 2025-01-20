const { ipcRenderer } = require('electron');
const marked = require('marked');
const path = require('path');

// Theme handling
const themeToggle = document.getElementById('themeToggle');
let currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);

themeToggle.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    localStorage.setItem('theme', currentTheme);
});

// Window control buttons
document.getElementById('closeBtn').addEventListener('click', () => ipcRenderer.invoke('close-window'));
document.getElementById('minimizeBtn').addEventListener('click', () => ipcRenderer.invoke('minimize-window'));
document.getElementById('maximizeBtn').addEventListener('click', () => ipcRenderer.invoke('maximize-window'));

// Navigation
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const viewId = item.dataset.view;
        
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        
        views.forEach(view => {
            view.classList.remove('active');
            if (view.id === viewId) {
                view.classList.add('active');
            }
        });
    });
});

// Quick action buttons
document.getElementById('launchPinokioBtn').addEventListener('click', async () => {
    try {
        await ipcRenderer.invoke('launch-pinokio');
    } catch (error) {
        alert('Failed to launch Pinokio: ' + error.message);
    }
});

document.getElementById('quickUpdateBtn').addEventListener('click', async () => {
    try {
        const latestRelease = await ipcRenderer.invoke('get-latest-release');
        const systemArch = await ipcRenderer.invoke('get-system-arch');
        const asset = latestRelease.assets.find(a => a.name.includes(systemArch));
        
        if (asset) {
            await ipcRenderer.invoke('install-version', {
                url: asset.browser_download_url,
                filename: asset.name
            });
            alert('Update completed successfully!');
            window.location.reload();
        } else {
            alert('No compatible version found');
        }
    } catch (error) {
        alert('Update failed: ' + error.message);
    }
});

document.getElementById('experimentalUpdateBtn').addEventListener('click', async () => {
    try {
        const experimentalReleases = await ipcRenderer.invoke('get-experimental-releases');
        const systemArch = await ipcRenderer.invoke('get-system-arch');
        
        if (experimentalReleases && experimentalReleases.length > 0) {
            const latestExperimental = experimentalReleases[0];
            const asset = latestExperimental.assets.find(a => a.name.includes(systemArch));
            
            if (asset) {
                await ipcRenderer.invoke('install-version', {
                    url: asset.browser_download_url,
                    filename: asset.name
                });
                alert('Experimental update completed successfully!');
                window.location.reload();
            } else {
                alert('No compatible experimental version found');
            }
        } else {
            alert('No experimental releases available');
        }
    } catch (error) {
        alert('Update failed: ' + error.message);
    }
});

// Variables for update functionality
let selectedVersion = null;
const installButton = document.getElementById('installButton');
const updatesList = document.getElementById('updatesList');
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');

// Format bytes to human readable size
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format memory usage
function formatMemoryUsage(used, total) {
    const percentage = ((used / total) * 100).toFixed(1);
    return `${formatBytes(used)} / ${formatBytes(total)} (${percentage}%)`;
}

// App initialization
let appConfig = null;

async function initializeApp() {
    try {
        const config = await ipcRenderer.invoke('get-app-config');
        appConfig = config;
        
        if (!config.initialized) {
            document.getElementById('initOverlay').classList.add('active');
        }
    } catch (error) {
        console.error('Error loading app config:', error);
    }
}

// Handle initialization form
document.getElementById('initializeApp').addEventListener('click', async () => {
    const pinokioPath = document.getElementById('pinokioPath').value;
    
    try {
        const result = await ipcRenderer.invoke('initialize-app', {
            pinokioPath
        });
        
        if (result.success) {
            appConfig = result.config;
            document.getElementById('initOverlay').classList.remove('active');
            updateAllInfo();
        } else {
            alert('Failed to initialize: ' + result.error);
        }
    } catch (error) {
        alert('Failed to initialize: ' + error.message);
    }
});

document.getElementById('browsePinokioPath').addEventListener('click', async () => {
    const result = await ipcRenderer.invoke('browse-directory');
    if (result) {
        document.getElementById('pinokioPath').value = result;
    }
});

// Update system information without relying on Pinokio
async function updateSystemInfo() {
    try {
        // Get system info directly from OS
        const sysInfo = await ipcRenderer.invoke('get-system-info');
        await ipcRenderer.invoke('update-system-cache', sysInfo);
        
        // Update basic information
        document.getElementById('platform').textContent = sysInfo.platform;
        document.getElementById('arch').textContent = sysInfo.arch;
        
        // Try to get Pinokio-specific info
        try {
            const response = await fetch('http://localhost/pinokio/info');
            const pinokioInfo = await response.json();
            document.getElementById('pinokioVersion').textContent = pinokioInfo.version.pinokio;
            document.getElementById('installPath').textContent = pinokioInfo.home;
            
            // Cache the Pinokio info
            await ipcRenderer.invoke('update-pinokio-cache', {
                version: pinokioInfo.version.pinokio,
                home: pinokioInfo.home
            });
            
            // Remove warning if it exists
            const warningDiv = document.querySelector('.pinokio-warning');
            if (warningDiv) {
                warningDiv.remove();
            }
        } catch (error) {
            // Get the cached values from config
            const config = await ipcRenderer.invoke('get-app-config');
            
            // Display cached values with indicator
            document.getElementById('pinokioVersion').textContent = 
                `${config.cache.pinokioVersion || 'Not Available'} ${config.cache.pinokioVersion ? '(cached)' : ''}`;
            document.getElementById('installPath').textContent = 
                `${config.pinokioPath} (cached)`;
            
            // Show warning about Pinokio not running
            showPinokioOfflineWarning();
        }
        
        // Update all hardware info
        updateCPUInfo(sysInfo.cpu);
        updateMemoryInfo(sysInfo.memory);
        updateGPUInfo(sysInfo.graphics);
        updateDisplayInfo(sysInfo.graphics);
        
    } catch (error) {
        console.error('Error updating system info:', error);
    }
}

function showPinokioOfflineWarning() {
    let warningDiv = document.querySelector('.pinokio-warning');
    if (!warningDiv) {
        warningDiv = document.createElement('div');
        warningDiv.className = 'warning-box pinokio-warning';
        document.querySelector('#overview .card').insertBefore(warningDiv, document.querySelector('#overview .info-grid'));
    }
    warningDiv.innerHTML = `
        <h3>⚠️ Pinokio Not Running</h3>
        <p>Some information may not be up to date because Pinokio is not running. You can:</p>
        <ol style="margin: 12px 0; padding-left: 24px;">
            <li style="margin-bottom: 8px;">Launch Pinokio to get real-time information</li>
            <li style="margin-bottom: 8px;">Continue using the app with potentially outdated information</li>
        </ol>
        <button class="action-button" onclick="document.getElementById('launchPinokioBtn').click()">Launch Pinokio</button>
    `;
}

// Function to display cached storage values
async function displayCachedStorage() {
    const storageInfo = document.getElementById('storageInfo');
    const config = await ipcRenderer.invoke('get-app-config');
    const cachedStorage = config.cache.lastStorageCalculation;
    
    if (cachedStorage) {
        let html = `
            <div class="storage-overview">
                <div class="info-item total-storage">
                    <div class="info-label">Total Storage Usage (cached)</div>
                    <div class="info-value">${formatBytes(cachedStorage.totalSize)} / ${formatBytes(cachedStorage.systemDriveSize.total)} 
                        (${((cachedStorage.totalSize / cachedStorage.systemDriveSize.total) * 100).toFixed(1)}%)</div>
                    <div class="storage-bar">
                        <div class="storage-bar-fill" style="width: ${((cachedStorage.totalSize / cachedStorage.systemDriveSize.total) * 100)}%"></div>
                    </div>
                    <small>Last updated: ${new Date(cachedStorage.timestamp).toLocaleString()}</small>
                </div>
            </div>
            <div class="storage-folders">
        `;

        // Add folder breakdown from cache
        if (cachedStorage.folderSizes) {
            cachedStorage.folderSizes.forEach(folder => {
                html += `
                    <div class="folder-item">
                        <div class="folder-content">
                            <div class="folder-info">
                                <div class="folder-name">
                                    <span class="folder-icon">${folder.icon}</span>
                                    ${folder.name}
                                </div>
                                <div class="folder-size">${formatBytes(folder.size)} (${folder.percentage}%)</div>
                            </div>
                            ${folder.subDirs ? `
                                <button class="expand-button" data-folder="api">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                        <polyline points="6 9 12 15 18 9"></polyline>
                                    </svg>
                                </button>
                            ` : ''}
                        </div>
                        ${folder.subDirs ? `
                            <div class="apps-list" data-folder="api">
                                ${folder.subDirs.map(subDir => `
                                    <div class="app-item">
                                        <div class="app-content">
                                            <div class="app-info">
                                                <div class="app-name">
                                                    <span class="folder-icon">📦</span>
                                                    ${subDir.name}
                                                </div>
                                                <div class="app-size">${formatBytes(subDir.size)} (${subDir.percentage}%)</div>
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            });
        }

        html += `</div>`;
        storageInfo.innerHTML = html;

        // Add click handlers for expand buttons
        document.querySelectorAll('[data-folder="api"].expand-button').forEach(btn => {
            btn.onclick = () => {
                const appsList = btn.closest('.folder-item').querySelector('.apps-list');
                const isExpanded = appsList.classList.toggle('expanded');
                btn.classList.toggle('expanded', isExpanded);
            };
        });
    }
}

// Update the storage information section
async function updateStorageInfo(skipCachedDisplay = false) {
    const storageInfo = document.getElementById('storageInfo');
    const recalculateBtn = document.getElementById('recalculateStorage');
    
    if (!appConfig?.initialized) {
        showNotInitializedWarning(storageInfo);
        return;
    }

    // Show cached values first if this isn't triggered by the recalculate button
    if (!skipCachedDisplay) {
        await displayCachedStorage();
    }
    
    try {
        recalculateBtn.classList.add('loading');
        recalculateBtn.disabled = true;
        recalculateBtn.textContent = 'Calculating...';

        let pinokioPath = appConfig.pinokioPath;
        let usingCachedPath = true;
        
        // Try to get updated path from Pinokio if running
        try {
            const response = await fetch('http://localhost/pinokio/info');
            const data = await response.json();
            pinokioPath = data.home;
            usingCachedPath = false;
        } catch (error) {
            // Show warning that we're using saved path
            showPinokioOfflineWarning();
        }
        
        // Get system drive info
        const systemDriveSize = await ipcRenderer.invoke('get-drive-info', pinokioPath.split(':')[0]);
        
        // Define base folders to check with icons
        const folders = [
            { name: 'Cache', path: '\\cache', icon: '📁' },
            { name: 'Bin', path: '\\bin', icon: '🗑️' },
            { name: 'Drive', path: '\\drive', icon: '💾' },
            { name: 'API', path: '\\api', icon: '🔌' },
            { name: 'Logs', path: '\\logs', icon: '📝' }
        ];

        // Get total size of Pinokio directory and individual folders
        const pinokioSize = await ipcRenderer.invoke('get-directory-size', pinokioPath);
        const usagePercentage = (pinokioSize / systemDriveSize.total) * 100;

        // Calculate sizes for all folders
        const folderSizes = await Promise.all(
            folders.map(async folder => {
                const folderPath = pinokioPath + folder.path;
                const size = await ipcRenderer.invoke('get-directory-size', folderPath);
                
                // If this is the API folder, get its subdirectories
                if (folder.name === 'API') {
                    try {
                        const subDirs = await ipcRenderer.invoke('get-subdirectories', folderPath);
                        const subDirSizes = await Promise.all(
                            subDirs.map(async dir => {
                                const subDirSize = await ipcRenderer.invoke('get-directory-size', `${folderPath}\\${dir}`);
                                return {
                                    name: dir,
                                    size: subDirSize,
                                    percentage: ((subDirSize / size) * 100).toFixed(1)
                                };
                            })
                        );
                        return { ...folder, size, percentage: ((size / pinokioSize) * 100).toFixed(1), subDirs: subDirSizes };
                    } catch (error) {
                        console.error('Error getting API subdirectories:', error);
                        return { ...folder, size, percentage: ((size / pinokioSize) * 100).toFixed(1), subDirs: [] };
                    }
                }
                
                return { 
                    ...folder, 
                    size,
                    percentage: ((size / pinokioSize) * 100).toFixed(1)
                };
            })
        );

        // Cache the storage calculation results
        await ipcRenderer.invoke('update-storage-cache', {
            totalSize: pinokioSize,
            systemDriveSize: systemDriveSize,
            folderSizes,
            timestamp: Date.now()
        });

        // Build the HTML
        let html = `
            <div class="storage-overview">
                <div class="info-item total-storage">
                    <div class="info-label">Total Storage Usage ${usingCachedPath ? '(using cached path)' : ''}</div>
                    <div class="info-value">${formatBytes(pinokioSize)} / ${formatBytes(systemDriveSize.total)} (${usagePercentage.toFixed(1)}%)</div>
                    <div class="storage-bar">
                        <div class="storage-bar-fill" style="width: ${usagePercentage}%"></div>
                    </div>
                </div>
            </div>
            <div class="storage-folders">
        `;

        // Add folder breakdown
        folderSizes.forEach(folder => {
            html += `
                <div class="folder-item">
                    <div class="folder-content">
                        <div class="folder-info">
                            <div class="folder-name">
                                <span class="folder-icon">${folder.icon}</span>
                                ${folder.name}
                            </div>
                            <div class="folder-size">${formatBytes(folder.size)} (${folder.percentage}%)</div>
                        </div>
                        ${folder.subDirs ? `
                            <button class="expand-button" data-folder="api">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <polyline points="6 9 12 15 18 9"></polyline>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
                    ${folder.subDirs ? `
                        <div class="apps-list" data-folder="api">
                            ${folder.subDirs.map(subDir => `
                                <div class="app-item">
                                    <div class="app-content">
                                        <div class="app-info">
                                            <div class="app-name">
                                                <span class="folder-icon">📦</span>
                                                ${subDir.name}
                                            </div>
                                            <div class="app-size">${formatBytes(subDir.size)} (${subDir.percentage}%)</div>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        });

        html += `
            </div>
        `;

        storageInfo.innerHTML = html;

        // Add click handlers for expand buttons
        document.querySelectorAll('[data-folder="api"].expand-button').forEach(btn => {
            btn.onclick = () => {
                const appsList = btn.closest('.folder-item').querySelector('.apps-list');
                const isExpanded = appsList.classList.toggle('expanded');
                btn.classList.toggle('expanded', isExpanded);
            };
        });

        // Remove any existing warning
        const warningDiv = document.querySelector('#storage .warning-box');
        if (warningDiv) {
            warningDiv.remove();
        }

    } catch (error) {
        console.error('Error updating storage info:', error);
        
        if (!skipCachedDisplay) {
            // Only show cached values if we haven't already
            await displayCachedStorage();
        }
        
        let warningDiv = document.querySelector('#storage .warning-box');
        if (!warningDiv) {
            warningDiv = document.createElement('div');
            warningDiv.className = 'warning-box';
            document.querySelector('#storage .card').insertBefore(warningDiv, storageInfo);
        }
        
        if (error.message === 'Failed to fetch' || error.message.includes('ECONNREFUSED')) {
            warningDiv.innerHTML = `
                <h3>⚠️ Using Saved Path</h3>
                <p>Calculating storage based on saved Pinokio path: ${appConfig.pinokioPath}</p>
                <p>Note: This information might not be accurate if Pinokio's location has changed.</p>
            `;
        } else {
            warningDiv.innerHTML = `
                <h3>⚠️ Error Calculating Storage</h3>
                <p>An error occurred while calculating storage usage:</p>
                <div class="code-block">${error.message}</div>
            `;
        }
    } finally {
        recalculateBtn.classList.remove('loading');
        recalculateBtn.disabled = false;
        recalculateBtn.textContent = 'Recalculate';
    }
}

function showNotInitializedWarning(container) {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'warning-box not-initialized';
    warningDiv.innerHTML = `
        <h3>⚠️ App Not Initialized</h3>
        <p>Please initialize the app with your Pinokio installation path to use this feature.</p>
        <button class="action-button" onclick="document.getElementById('initOverlay').classList.add('active')">Initialize Now</button>
    `;
    
    container.parentElement.insertBefore(warningDiv, container);
    container.innerHTML = `
        <div class="info-item">
            <div class="info-value">Initialize app to view storage information</div>
            <div class="storage-bar">
                <div class="storage-bar-fill" style="width: 0%"></div>
            </div>
        </div>
    `;
}

// Function to update all information
async function updateAllInfo() {
    await updateSystemInfo();
    loadUpdates();
    // Show cached storage values immediately and then recalculate
    await displayCachedStorage();
    updateStorageInfo();
}

// Update memory information periodically
function updateMemoryInfo() {
    fetch('http://localhost/pinokio/info')
        .then(response => response.json())
        .then(data => {
            const memoryInfo = document.getElementById('memoryInfo');
            const memUsage = formatMemoryUsage(data.mem.used, data.mem.total);
            const memPercentage = (data.mem.used / data.mem.total) * 100;
            
            memoryInfo.innerHTML = `
                <div class="info-item">
                    <div class="info-label">Memory Usage</div>
                    <div class="info-value">${memUsage}</div>
                    <div class="storage-bar">
                        <div class="storage-bar-fill" style="width: ${memPercentage}%"></div>
                    </div>
                </div>
            `;
        })
        .catch(error => console.error('Error updating memory info:', error));
}

function updateCPUInfo(cpuInfo) {
    const cpuInfoElement = document.getElementById('cpuInfo');
    cpuInfoElement.innerHTML = `
        <div class="info-item">
            <div class="info-label">Processor</div>
            <div class="info-value">${cpuInfo.brand}</div>
        </div>
        <div class="info-item">
            <div class="info-label">Cores</div>
            <div class="info-value">${cpuInfo.cores} (${cpuInfo.physicalCores} Physical)</div>
        </div>
        <div class="info-item">
            <div class="info-label">Speed</div>
            <div class="info-value">${cpuInfo.speed} GHz</div>
        </div>
        <div class="info-item">
            <div class="info-label">Socket</div>
            <div class="info-value">${cpuInfo.socket}</div>
        </div>
    `;
}

function updateGPUInfo(gpuInfo) {
    const gpuInfoElement = document.getElementById('gpuInfo');
    gpuInfoElement.innerHTML = gpuInfo.controllers.map(gpu => `
        <div class="gpu-card">
            <div class="gpu-icon">GPU</div>
            <div>
                <div class="version-tag">${gpu.model}</div>
                <div class="version-type">VRAM: ${formatBytes(gpu.vram * 1024 * 1024)}</div>
            </div>
        </div>
    `).join('');
}

function updateDisplayInfo(displayInfo) {
    const displayInfoElement = document.getElementById('displayInfo');
    displayInfoElement.innerHTML = displayInfo.displays.map(display => `
        <div class="info-item">
            <div class="info-label">${display.model}</div>
            <div class="info-value">
                ${display.currentResX}x${display.currentResY} @ ${display.currentRefreshRate}Hz
                ${display.main ? '(Main Display)' : ''}
            </div>
        </div>
    `).join('');
}

function createUpdateOption(release, type, systemArch, currentVersion) {
    const option = document.createElement('div');
    option.className = 'update-option';
    
    const asset = release.assets.find(a => a.name.includes(systemArch));
    const isCompatible = !!asset;
    const isCurrentVersion = release.tag_name === currentVersion;

    const releaseNotes = release.body || 'No release notes available.';
    const parsedNotes = marked.parse(releaseNotes);

    option.innerHTML = `
        <div class="version-tag">${release.tag_name} ${isCurrentVersion ? '(Current)' : ''}</div>
        <div class="version-type">${type} Release ${isCompatible ? '' : '(Incompatible)'}</div>
        <div class="release-notes expanded markdown-body">
            ${parsedNotes}
        </div>
        ${isCompatible && !isCurrentVersion ? `
            <button class="action-button install-button">Install ${release.tag_name}</button>
        ` : isCurrentVersion ? `
            <div class="info-value">You are already on this version.</div>
        ` : ''}
    `;

    if (isCompatible && !isCurrentVersion) {
        const installButton = option.querySelector('.install-button');
        installButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            
            try {
                installButton.disabled = true;
                installButton.textContent = `Installing ${release.tag_name}...`;
                installButton.classList.add('loading');
                
                // Find the correct asset for the current system architecture
                const relevantAsset = release.assets.find(a => a.name.includes(systemArch));
                if (!relevantAsset) {
                    throw new Error('No compatible version found for your system');
                }

                await ipcRenderer.invoke('install-version', {
                    url: relevantAsset.browser_download_url,
                    filename: relevantAsset.name
                });
                
                alert(`Successfully installed Pinokio ${release.tag_name}`);
                window.location.reload();
            } catch (error) {
                console.error('Installation error:', error);
                alert(`Installation failed: ${error.message}`);
                installButton.disabled = false;
                installButton.textContent = `Install ${release.tag_name}`;
                installButton.classList.remove('loading');
            }
        });
    }

    return option;
}

async function loadUpdates() {
    try {
        const [currentVersion, latestRelease, experimentalReleases, systemArch] = await Promise.all([
            ipcRenderer.invoke('get-current-version'),
            ipcRenderer.invoke('get-latest-release'),
            ipcRenderer.invoke('get-experimental-releases'),
            ipcRenderer.invoke('get-system-arch')
        ]);

        updatesList.innerHTML = '';

        if (latestRelease) {
            const stableOption = createUpdateOption(latestRelease, 'Stable', systemArch, currentVersion);
            updatesList.appendChild(stableOption);
        }

        if (experimentalReleases && experimentalReleases.length > 0) {
            experimentalReleases.forEach(release => {
                const experimentalOption = createUpdateOption(release, 'Experimental', systemArch, currentVersion);
                updatesList.appendChild(experimentalOption);
            });
        }

        if (updatesList.children.length === 0) {
            updatesList.innerHTML = '<div class="error">No compatible updates found</div>';
        }
    } catch (error) {
        console.error('Error loading updates:', error);
        updatesList.innerHTML = `<div class="error">Error loading updates: ${error.message}</div>`;
    }
}

// Check for updates button handler
checkUpdatesBtn.addEventListener('click', () => {
    const updatesNavItem = document.querySelector('[data-view="updates"]');
    updatesNavItem.click();
    loadUpdates();
});

// Peer Checker functionality
let peerCheckData = null;

// Initialize peer checker when view is selected
document.querySelector('[data-view="peers"]').addEventListener('click', () => {
    // Only reset if there's no previous check data
    if (!peerCheckData) {
        document.getElementById('confirmCheck').checked = false;
        document.getElementById('runPeerCheck').disabled = true;
        document.getElementById('resultsCard').style.display = 'none';
        document.getElementById('peerResults').classList.remove('active');
        
        // Reset the status displays only if they haven't been checked
        if (document.getElementById('driveDir').textContent === 'Not checked yet') {
            document.getElementById('driveDir').textContent = 'Not checked yet';
            document.getElementById('peerDir').textContent = 'Not checked yet';
            document.getElementById('jsonFile').textContent = 'Not checked yet';
        }
    } else {
        // If we have previous check data, make sure the results are visible
        document.getElementById('resultsCard').style.display = 'block';
        document.getElementById('peerResults').classList.add('active');
    }
});

// Handle confirmation checkbox
document.getElementById('confirmCheck').addEventListener('change', (e) => {
    const runButton = document.getElementById('runPeerCheck');
    runButton.disabled = !e.target.checked;
});

async function initPeerCheck() {
    const driveDir = document.getElementById('driveDir');
    const peerDir = document.getElementById('peerDir');
    const jsonFile = document.getElementById('jsonFile');
    
    try {
        // First check if Pinokio is running
        try {
            await fetch('http://localhost/pinokio/info');
        } catch (error) {
            driveDir.textContent = 'Error: Pinokio must be running to use the peer checker';
            peerDir.textContent = 'Error: Pinokio must be running';
            jsonFile.textContent = 'Error: Pinokio must be running';
            document.getElementById('runPeerCheck').disabled = true;
            document.getElementById('confirmCheck').disabled = true;
            return false;
        }

        peerCheckData = await ipcRenderer.invoke('init-peer-check');
        
        driveDir.textContent = peerCheckData.driveBase;
        peerDir.textContent = peerCheckData.peersExist ? 
            peerCheckData.peerDir : 
            peerCheckData.peerDir + ' (Directory not created yet)';
        jsonFile.textContent = peerCheckData.jsonFile;
        document.getElementById('confirmCheck').disabled = false;
        
        return true;
    } catch (error) {
        driveDir.textContent = `Error: ${error.message}`;
        peerDir.textContent = 'Error: Could not initialize peer checker';
        jsonFile.textContent = 'Error: Could not initialize peer checker';
        document.getElementById('runPeerCheck').disabled = true;
        document.getElementById('confirmCheck').disabled = true;
        return false;
    }
}

function addResultItem(containerId, text, type = 'info', isLoading = false) {
    const container = document.getElementById(containerId);
    const item = document.createElement('div');
    item.className = `result-item ${type}${isLoading ? ' loading' : ''}`;
    
    // Add appropriate icon based on type
    const icon = document.createElement('span');
    if (isLoading) {
        icon.textContent = '⟳';
        icon.className = 'spinning';
    } else {
        switch(type) {
            case 'success':
                icon.textContent = '✓';
                break;
            case 'error':
                icon.textContent = '✗';
                break;
            case 'warning':
                icon.textContent = '⚠';
                break;
            default:
                icon.textContent = 'ℹ';
        }
    }
    
    const textSpan = document.createElement('span');
    textSpan.textContent = text;
    
    item.appendChild(icon);
    item.appendChild(textSpan);
    container.appendChild(item);
    
    return item;
}

// Helper function to add delay between operations
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPeerCheck() {
    if (!document.getElementById('confirmCheck').checked) {
        return;
    }

    const runButton = document.getElementById('runPeerCheck');
    const confirmCheck = document.getElementById('confirmCheck');

    // Update button state
    runButton.disabled = true;
    confirmCheck.disabled = true;
    runButton.classList.add('loading');
    runButton.textContent = 'Initializing Check...';

    // Show the results card
    document.getElementById('resultsCard').style.display = 'block';
    
    // Only clear previous results if starting a new check
    if (!peerCheckData || confirm('Do you want to clear previous results and start a new check?')) {
        document.querySelectorAll('.results-section').forEach(el => el.innerHTML = '');
    }
    
    document.getElementById('peerResults').classList.add('active');

    try {
        // Initialize peer check if needed
        if (!peerCheckData) {
            if (!await initPeerCheck()) {
                throw new Error('Failed to initialize peer check');
            }
        }

        // Step 1: Directory Check
        addResultItem('dirResults', 'Initializing directory scan...', 'info', true);
        await delay(500);
        
        const dirs = await ipcRenderer.invoke('get-peer-dirs', peerCheckData.peerDir);
        document.getElementById('dirResults').innerHTML = '';
        runButton.textContent = 'Scanning Directories...';
        
        if (dirs.length === 0) {
            if (!peerCheckData.peersExist) {
                addResultItem('dirResults', 'Peers directory has not been created yet - this is normal if you haven\'t shared any models between apps', 'info');
            } else {
                addResultItem('dirResults', 'No peer directories found in existing peers directory', 'warning');
            }
        } else {
            addResultItem('dirResults', `Found ${dirs.length} peer directories:`, 'success');
            for (const dir of dirs) {
                await delay(100);
                addResultItem('dirResults', dir, 'info');
            }
        }

        // Step 2: JSON Check
        await delay(300);
        runButton.textContent = 'Reading JSON...';
        addResultItem('jsonResults', 'Reading drives.json...', 'info', true);
        const json = await ipcRenderer.invoke('read-drives-json', peerCheckData.jsonFile);
        document.getElementById('jsonResults').innerHTML = '';
        
        const repoCount = Object.keys(json).length;
        addResultItem('jsonResults', `Found ${repoCount} repositories in drives.json:`, 'success');
        for (const key of Object.keys(json)) {
            await delay(100);
            addResultItem('jsonResults', key, 'info');
        }

        // Step 3: Duplicates Check
        await delay(300);
        runButton.textContent = 'Checking Duplicates...';
        addResultItem('dupeResults', 'Checking for duplicate entries...', 'info', true);
        const duplicates = await ipcRenderer.invoke('check-duplicates', { 
            json, 
            jsonFile: peerCheckData.jsonFile 
        });
        document.getElementById('dupeResults').innerHTML = '';
        
        if (Object.keys(duplicates).length === 0) {
            addResultItem('dupeResults', 'No duplicate entries found in drives.json', 'success');
        } else {
            addResultItem('dupeResults', `Found ${Object.keys(duplicates).length} duplicates:`, 'error');
            for (const dupe of Object.keys(duplicates)) {
                await delay(100);
                addResultItem('dupeResults', `${dupe} (${duplicates[dupe].length} occurrences)`, 'error');
            }
        }

        // Step 4: Orphans Check
        await delay(300);
        runButton.textContent = 'Checking Orphans...';
        addResultItem('orphanResults', 'Checking for orphaned entries...', 'info', true);
        const orphans = await ipcRenderer.invoke('check-orphans', {
            dirs,
            jsonFile: peerCheckData.jsonFile
        });
        document.getElementById('orphanResults').innerHTML = '';

        if (orphans.dirToJson.length === 0 && orphans.jsonToDir.length === 0) {
            addResultItem('orphanResults', 'All directories and JSON entries are properly linked', 'success');
        } else {
            if (orphans.dirToJson.length > 0) {
                addResultItem('orphanResults', 'Directories not found in drives.json:', 'error');
                for (const dir of orphans.dirToJson) {
                    await delay(100);
                    addResultItem('orphanResults', dir, 'error');
                }
            }
            if (orphans.jsonToDir.length > 0) {
                addResultItem('orphanResults', 'JSON entries without corresponding directories:', 'error');
                for (const dir of orphans.jsonToDir) {
                    await delay(100);
                    addResultItem('orphanResults', dir, 'error');
                }
            }
        }

    } catch (error) {
        addResultItem('dirResults', `Error during peer check: ${error.message}`, 'error');
    } finally {
        await delay(300);
        runButton.disabled = false;
        confirmCheck.disabled = false;
        runButton.classList.remove('loading');
        runButton.textContent = 'Run Directory Check';
    }
}

// Add the click handler for the run button
document.getElementById('runPeerCheck').addEventListener('click', runPeerCheck);

// Add event listener for recalculate button
document.getElementById('recalculateStorage').addEventListener('click', () => {
    updateStorageInfo(true); // Skip showing cached values when manually recalculating
});

// Initialize the app
initializeApp();
updateAllInfo();

// Set up periodic updates with different intervals
setInterval(() => {
    if (appConfig?.initialized) {
        updateSystemInfo();
    }
}, 5000);