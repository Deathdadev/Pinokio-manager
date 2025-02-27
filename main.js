const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const { promisify } = require('util');
const stream = require('stream');
const pipeline = promisify(stream.pipeline);
const extract = require('extract-zip');
const { spawn } = require('child_process');
const { opendir, readFile, access, constants } = require('fs/promises');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure auto-updater logging
log.transports.file.level = "debug";
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update-status', { status: 'checking' });
});

autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-status', { 
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseName: info.releaseName,
        releaseDate: info.releaseDate
    });
});

autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-status', { status: 'not-available' });
});

autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('update-status', { 
        status: 'error',
        error: err.message
    });
});

autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('update-status', {
        status: 'downloading',
        progress: progressObj
    });
});

autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-status', {
        status: 'downloaded',
        version: info.version
    });
});

// IPC handlers for auto-updater
ipcMain.handle('check-for-updates', async () => {
    try {
        return await autoUpdater.checkForUpdates();
    } catch (error) {
        console.error('Error checking for updates:', error);
        throw error;
    }
});

ipcMain.handle('download-update', async () => {
    try {
        return await autoUpdater.downloadUpdate();
    } catch (error) {
        console.error('Error downloading update:', error);
        throw error;
    }
});

ipcMain.handle('quit-and-install', () => {
    autoUpdater.quitAndInstall(false, true);
});

// Configuration manager
const configPath = path.join(app.getPath('userData'), 'config.json');
let appConfig = {
    pinokioPath: 'C:\\pinokio', // Default path
    pinokioExePath: path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Pinokio', 'Pinokio.exe'),
    lastKnownVersion: null,
    initialized: false,
    cache: {
        pinokioVersion: null,
        lastStorageCalculation: null,
        lastStorageUpdate: null,
        systemInfo: null,
        lastUpdate: null
    }
};

// Load configuration
function loadConfig() {
    try {
        if (fs.existsSync(configPath)) {
            const data = fs.readFileSync(configPath, 'utf8');
            const savedConfig = JSON.parse(data);
            
            // Merge with default config to ensure all fields exist
            appConfig = {
                ...appConfig,
                ...savedConfig,
                cache: {
                    ...appConfig.cache,
                    ...(savedConfig.cache || {})
                }
            };
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}

// Save configuration
function saveConfig() {
    try {
        // Update last update timestamp
        appConfig.cache.lastUpdate = Date.now();
        fs.writeFileSync(configPath, JSON.stringify(appConfig, null, 2));
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

// Load config at startup
loadConfig();

// Add configuration IPC handlers
ipcMain.handle('get-app-config', () => {
    return appConfig;
});

ipcMain.handle('update-app-config', (event, newConfig) => {
    appConfig = { ...appConfig, ...newConfig };
    saveConfig();
    return appConfig;
});

ipcMain.handle('initialize-app', async (event, config) => {
    try {
        // Verify Pinokio path exists
        await access(config.pinokioPath, constants.R_OK);
        
        // Update config
        appConfig = { ...appConfig, ...config, initialized: true };
        saveConfig();
        
        return { success: true, config: appConfig };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

let mainWindow;

// Disable GPU acceleration since we don't need it for this app
app.disableHardwareAcceleration();

// Add this before creating the window
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'hidden',
        frame: false,
        backgroundColor: '#ffffff',
        icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// Window control handlers
ipcMain.handle('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.handle('maximize-window', () => {
    if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
});

ipcMain.handle('close-window', () => {
    mainWindow.close();
});

// Helper function to get Pinokio home directory
async function getPinokioHome() {
    try {
        const response = await axios.get('http://localhost/pinokio/info');
        return response.data.home;
    } catch (error) {
        // Silently handle connection refused error since it's expected when Pinokio isn't running
        if (error.code === 'ECONNREFUSED') {
            throw new Error('PINOKIO_NOT_RUNNING');
        }
        // For other errors, still throw but without logging
        throw new Error('Could not get Pinokio info. Make sure Pinokio is running.');
    }
}

// Helper function to check if Pinokio is running
async function isPinokioRunning() {
    try {
        await axios.get('http://localhost/pinokio/info');
        return true;
    } catch (error) {
        // Silently handle connection errors
        return false;
    }
}

// Launch Pinokio handler
ipcMain.handle('launch-pinokio', async () => {
    try {
        // Default Windows installation path
        const defaultWindowsPath = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Pinokio', 'Pinokio.exe');
        
        // Try the default path first
        if (fs.existsSync(defaultWindowsPath)) {
            const proc = spawn(defaultWindowsPath, [], {
                detached: true,
                stdio: 'ignore',
                cwd: path.dirname(defaultWindowsPath)
            });
            proc.unref();
            return;
        }

        // If default path doesn't exist, try getting Pinokio home and check other locations
        try {
            const pinokioPath = await getPinokioHome();
            const possiblePaths = [
                path.join(pinokioPath, 'Pinokio.exe'),
                path.join(pinokioPath, 'bin', 'Pinokio.exe'),
                path.join(pinokioPath, 'bin', 'pinokio.exe'),
                path.join(pinokioPath, 'pinokio.exe')
            ];

            const exePath = possiblePaths.find(p => fs.existsSync(p));
            
            if (exePath) {
                if (fs.existsSync(exePath) && fs.lstatSync(exePath).isFile()) {
                    const proc = spawn(exePath, [], {
                        detached: true,
                        stdio: 'ignore',
                        cwd: path.dirname(exePath)
                    });
                    proc.unref();
                } else {
                    throw new Error('Invalid executable path');
                }
                return;
            }
        } catch (error) {
            // Silently ignore getPinokioHome error and continue with fallback
        }

        // If no executable found, try launching via shell command
        const platform = os.platform();
        if (platform === 'win32') {
            spawn('cmd', ['/c', 'start', 'pinokio'], {
                detached: true,
                stdio: 'ignore',
                shell: true
            }).unref();
        } else if (platform === 'darwin') {
            spawn('open', ['-a', 'Pinokio'], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        } else {
            spawn('pinokio', [], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        }
    } catch (error) {
        // Silently handle launch errors since they're expected when Pinokio isn't installed
        throw new Error('Could not launch Pinokio. Please make sure it is installed.');
    }
});

// Directory size calculation
async function getDirectorySize(dirPath) {
    // Try to use native OS commands first for better performance
    if (process.platform === 'win32') {
        try {
            const { execFile } = require('child_process');
            const util = require('util');
            const execFileAsync = util.promisify(execFile);
            
            // Use PowerShell to calculate directory size (much faster than Node.js recursive approach)
            // Pass the path as a parameter to avoid command injection
            const { stdout } = await execFileAsync('powershell', [
                '-NoProfile',
                '-Command',
                '$path = $args[0]; (Get-ChildItem -Path $path -Recurse -Force | Measure-Object -Property Length -Sum).Sum',
                dirPath
            ]);
            
            const size = parseInt(stdout.trim()) || 0;
            return size;
        } catch (error) {
            // Fallback to Node.js implementation if PowerShell fails
            console.warn('PowerShell size calculation failed, falling back to Node.js:', error);
        }
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
        try {
            const { execFile } = require('child_process');
            const util = require('util');
            const execFileAsync = util.promisify(execFile);
            
            // Use du command on Unix-like systems
            const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
            const size = parseInt(stdout.split('\t')[0]);
            return size;
        } catch (error) {
            // Fallback to Node.js implementation if du fails
            console.warn('du size calculation failed, falling back to Node.js:', error);
        }
    }
    
    // Fallback to an optimized Node.js implementation
    let totalSize = 0;
    const stack = [dirPath];
    
    try {
        while (stack.length > 0) {
            const currentPath = stack.pop();
            const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
            
            // Process items in batches for better performance
            const batchSize = 100;
            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                
                // Process files and directories in parallel within each batch
                const promises = batch.map(async item => {
                    const fullPath = path.join(currentPath, item.name);
                    
                    if (item.isSymbolicLink()) {
                        return; // Skip symbolic links
                    }
                    
                    if (item.isFile()) {
                        const stats = await fs.promises.stat(fullPath);
                        totalSize += stats.size;
                    } else if (item.isDirectory()) {
                        stack.push(fullPath);
                    }
                });
                
                await Promise.all(promises);
            }
        }
        
        return totalSize;
    } catch (error) {
        console.error('Error calculating directory size:', error);
        return 0;
    }
}

ipcMain.handle('get-directory-size', async (event, dirPath) => {
    return await getDirectorySize(dirPath);
});

// IPC Handlers
ipcMain.handle('get-current-version', async () => {
    try {
        const response = await axios.get('http://localhost/pinokio/info');
        return response.data.version.pinokio;
    } catch (error) {
        // Silently handle error since it's handled in the UI
        return null;
    }
});

ipcMain.handle('get-latest-release', async () => {
    try {
        const response = await axios.get('https://api.github.com/repos/pinokiocomputer/pinokio/releases', {
            headers: {
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        // Get all releases and sort by creation date
        const releases = response.data;
        releases.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        // Return the latest release
        return releases[0];
    } catch (error) {
        // Silently handle error
        return null;
    }
});

ipcMain.handle('get-experimental-releases', async () => {
    try {
        const response = await axios.get('https://api.github.com/repos/cocktailpeanutlabs/p2/releases');
        return response.data;
    } catch (error) {
        console.error('Error fetching experimental releases:', error);
        return null;
    }
});

ipcMain.handle('get-system-arch', () => {
    const system = os.platform();
    const arch = os.arch();
    
    if (system === 'win32') {
        return arch === 'arm64' ? 'win32-arm64.zip' : 'win32.zip';
    } else if (system === 'darwin') {
        return arch === 'arm64' ? 'darwin-arm64.zip' : 'darwin-intel.zip';
    } else if (system === 'linux') {
        if (arch === 'x64') return 'x86_64.rpm';
        return arch === 'arm64' ? 'arm64.deb' : 'amd64.deb';
    }
    return null;
});

ipcMain.handle('install-version', async (event, { url, filename }) => {
    const tempDir = path.join(os.tmpdir(), 'pinokio-update');
    const downloadPath = path.join(tempDir, filename);

    try {
        // Create temp directory
        await fs.promises.mkdir(tempDir, { recursive: true });

        // Download file
        console.log(`Downloading ${filename}...`);
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });

        await pipeline(response.data, fs.createWriteStream(downloadPath));
        console.log('Download complete.');
        console.log(`Downloaded file is located at: ${downloadPath}`);
        console.log(`Extracted files will be in: ${tempDir}`);

        // Install based on file type
        if (filename.endsWith('.zip')) {
            // Clean the temp directory before extraction
            const existingFiles = await fs.promises.readdir(tempDir);
            for (const file of existingFiles) {
                if (file !== path.basename(downloadPath)) {
                    await fs.promises.rm(path.join(tempDir, file), { recursive: true, force: true });
                }
            }

            await extract(downloadPath, { dir: tempDir });
            
            // Get version from filename (e.g., Pinokio-3.2.218-win32.zip -> 3.2.218)
            const versionMatch = filename.match(/Pinokio-(\d+\.\d+\.\d+)/);
            const version = versionMatch ? versionMatch[1] : null;
            
            // Find and run setup
            const files = await fs.promises.readdir(tempDir);
            let setupFile;
            
            if (version) {
                // First try to find setup with exact version
                setupFile = files.find(f => 
                    f.toLowerCase().startsWith('pinokio setup') && 
                    f.toLowerCase().endsWith('.exe') && 
                    f.includes(version)
                );
            }
            
            // Fallback to any setup file if exact version not found
            if (!setupFile) {
                setupFile = files.find(f => 
                    f.toLowerCase().startsWith('pinokio setup') && 
                    f.toLowerCase().endsWith('.exe')
                );
            }
            
            if (setupFile) {
                const setupPath = path.join(tempDir, setupFile);
                console.log(`Running setup: ${setupPath}`);
                
                await new Promise((resolve, reject) => {
                    const setup = spawn(setupPath, [], {
                        detached: true,
                        stdio: 'ignore',
                        cwd: tempDir
                    });
                    
                    setup.on('error', reject);
                    setup.unref();
                    resolve();
                });
            } else {
                throw new Error('Setup file not found in package');
            }
        } else if (filename.endsWith('.deb')) {
            await new Promise((resolve, reject) => {
                const install = spawn('sudo', ['dpkg', '-i', downloadPath], {
                    stdio: 'inherit'
                });
                install.on('close', code => code === 0 ? resolve() : reject(new Error(`dpkg exited with code ${code}`)));
                install.on('error', reject);
            });
        } else if (filename.endsWith('.rpm')) {
            await new Promise((resolve, reject) => {
                const install = spawn('sudo', ['rpm', '-i', downloadPath], {
                    stdio: 'inherit'
                });
                install.on('close', code => code === 0 ? resolve() : reject(new Error(`rpm exited with code ${code}`)));
                install.on('error', reject);
            });
        }
    } catch (error) {
        console.error('Installation error:', error);
        throw error;
    } finally {
        // Attempt cleanup with delay and retry
        setTimeout(async () => {
            try {
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            } catch (error) {
                // If first attempt fails, try again after a longer delay
                setTimeout(async () => {
                    try {
                        await fs.promises.rm(tempDir, { recursive: true, force: true });
                    } catch (cleanupError) {
                        // Silently ignore cleanup errors on second attempt
                    }
                }, 5000); // 5 second delay for second attempt
            }
        }, 1000); // 1 second delay for first attempt
    }
});

// Get drive information
ipcMain.handle('get-drive-info', async (event, driveLetter) => {
    try {
        const si = require('systeminformation');
        const drives = await si.fsSize();
        
        // Validate driveLetter is a single character
        if (typeof driveLetter !== 'string' || driveLetter.length !== 1 || !/^[a-zA-Z]$/.test(driveLetter)) {
            throw new Error('Invalid drive letter format');
        }
        
        // Find the drive that matches the drive letter
        const drive = drives.find(d => {
            const mount = process.platform === 'win32' ? 
                d.mount.toLowerCase().charAt(0) : 
                d.mount;
            return mount === driveLetter.toLowerCase();
        });
        
        if (drive) {
            return {
                total: drive.size,
                free: drive.available,
                used: drive.used
            };
        }
        
        // Fallback to wmic on Windows
        if (process.platform === 'win32') {
            const { execFile } = require('child_process');
            const util = require('util');
            const execFileAsync = util.promisify(execFile);

            // Use sanitized drive letter
            const sanitizedDriveLetter = driveLetter.toUpperCase();
            
            const { stdout } = await execFileAsync('wmic', [
                'logicaldisk',
                'where',
                `DeviceID='${sanitizedDriveLetter}:'`,
                'get',
                'size,freespace',
                '/format:csv'
            ]);

            const lines = stdout.trim().split('\n');
            if (lines.length >= 2) {
                const [freeSpace, total] = lines[1].split(',').slice(1).map(Number);
                return {
                    total,
                    free: freeSpace,
                    used: total - freeSpace
                };
            }
        }
        
        throw new Error('Drive not found');
    } catch (error) {
        console.error('Error getting drive info:', error);
        throw error;
    }
});

// Get subdirectories
ipcMain.handle('get-subdirectories', async (event, dirPath) => {
    try {
        const items = await fs.promises.readdir(dirPath, { withFileTypes: true });
        return items
            .filter(item => item.isDirectory())
            .map(item => item.name);
    } catch (error) {
        console.error('Error getting subdirectories:', error);
        throw error;
    }
});

// Peer Checker Functions
async function findBase() {
    try {
        const pinokioPath = await getPinokioHome();
        const driveDir = path.join(pinokioPath, 'drive');
        
        try {
            await access(driveDir, constants.R_OK | constants.X_OK);
            return driveDir;
        } catch (err) {
            throw new Error('Drive directory not found in Pinokio path');
        }
    } catch (error) {
        throw new Error(`Could not find Pinokio drive directory: ${error.message}`);
    }
}

ipcMain.handle('init-peer-check', async () => {
    const driveBase = await findBase();
    if (!driveBase) {
        throw new Error("Could not find base directory");
    }

    const peerDir = path.join(driveBase, "drives", "peers");
    const jsonFile = path.join(driveBase, "drives.json");

    try {
        // First check the drive base and drives.json
        await Promise.all([
            access(driveBase, constants.R_OK | constants.X_OK),
            access(jsonFile, constants.F_OK | constants.R_OK)
        ]);

        // Check if peers directory exists, but don't fail if it doesn't
        let peersExist = false;
        try {
            await access(peerDir, constants.R_OK | constants.X_OK);
            peersExist = true;
        } catch (err) {
            // This is normal if no models have been shared
        }

        return {
            driveBase,
            peerDir,
            jsonFile,
            peersExist,
            status: 'success'
        };
    } catch (error) {
        throw new Error(`Sanity check failed: ${error.message}`);
    }
});

ipcMain.handle('get-peer-dirs', async (event, peerDir) => {
    const dirs = [];
    try {
        // First check if directory exists
        try {
            await access(peerDir, constants.R_OK | constants.X_OK);
        } catch (err) {
            // Return empty array if directory doesn't exist
            return dirs;
        }

        const dir = await opendir(peerDir);
        for await (const dirent of dir) {
            if (dirent.isDirectory()) dirs.push(dirent.name);
        }
        return dirs;
    } catch (err) {
        throw new Error(`Error reading directory: ${err.message}`);
    }
});

ipcMain.handle('read-drives-json', async (event, jsonFile) => {
    try {
        const content = await readFile(jsonFile, 'utf8');
        return JSON.parse(content);
    } catch (err) {
        throw new Error(`Invalid JSON detected: ${err.message}`);
    }
});

ipcMain.handle('check-orphans', async (event, { dirs, jsonFile }) => {
    let orphans = {
        dirToJson: [],
        jsonToDir: []
    };

    try {
        const rawFile = await readFile(jsonFile, 'utf8');

        // Dir to Json check
        for (const dir of dirs) {
            if (!rawFile.includes(dir)) {
                orphans.dirToJson.push(dir);
            }
        }

        // Json to dir check
        const regex = /[\\\/]{1}([a-z].[0-9]+)[\\\/]{1}/gm;
        const matched = new Set();
        let match;

        while ((match = regex.exec(rawFile)) !== null) {
            const dirName = match[1];
            if (!matched.has(dirName)) {
                matched.add(dirName);
                if (!dirs.includes(dirName)) {
                    orphans.jsonToDir.push(dirName);
                }
            }
        }

        return orphans;
    } catch (error) {
        throw new Error(`Error checking orphans: ${error.message}`);
    }
});

ipcMain.handle('check-duplicates', async (event, { json, jsonFile }) => {
    try {
        const rawFile = (await readFile(jsonFile)).toString();
        const duplicates = {};

        for (const e of Object.keys(json)) {
            const pattern = new RegExp("." + e + "*", "g");
            const matches = rawFile.match(pattern);
            if (matches && matches.length > 1) {
                duplicates[e] = matches;
            }
        }

        return duplicates;
    } catch (error) {
        throw new Error(`Error checking duplicates: ${error.message}`);
    }
});

// Add directory browser
ipcMain.handle('browse-directory', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    
    if (!result.canceled) {
        return result.filePaths[0];
    }
    return null;
});

// Update system information handler to include more details
ipcMain.handle('get-system-info', async () => {
    const si = require('systeminformation');
    
    try {
        const [cpu, mem, graphics] = await Promise.all([
            si.cpu(),
            si.mem(),
            si.graphics()
        ]);

        const cpuInfo = {
            brand: cpu.brand,
            cores: cpu.cores,
            physicalCores: cpu.physicalCores,
            speed: cpu.speed,
            socket: cpu.socket || 'Unknown'
        };

        const memInfo = {
            total: mem.total,
            free: mem.free,
            used: mem.used,
            active: mem.active,
            available: mem.available
        };

        const gpuInfo = {
            controllers: graphics.controllers.map(controller => ({
                model: controller.model,
                vendor: controller.vendor,
                vram: controller.vram,
                driverVersion: controller.driverVersion
            })),
            displays: graphics.displays.map(display => ({
                model: display.model || 'Generic Display',
                main: display.main,
                currentResX: display.currentResX,
                currentResY: display.currentResY,
                currentRefreshRate: display.currentRefreshRate,
                builtin: display.builtin
            }))
        };

        return {
            cpu: cpuInfo,
            memory: memInfo,
            graphics: gpuInfo,
            platform: os.platform(),
            arch: os.arch(),
            release: os.release()
        };
    } catch (error) {
        console.error('Error getting system info:', error);
        // Return basic info if detailed info fails
        return {
            cpu: {
                brand: os.cpus()[0].model,
                cores: os.cpus().length,
                physicalCores: os.cpus().length / (os.cpus()[0].model.includes('Intel') ? 2 : 1),
                speed: os.cpus()[0].speed / 1000,
                socket: 'Unknown'
            },
            memory: {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem(),
                active: os.totalmem() - os.freemem(),
                available: os.freemem()
            },
            graphics: {
                controllers: [],
                displays: []
            },
            platform: os.platform(),
            arch: os.arch(),
            release: os.release()
        };
    }
});

// Update cache with new Pinokio info
ipcMain.handle('update-pinokio-cache', (event, info) => {
    appConfig.cache.pinokioVersion = info.version;
    appConfig.cache.lastUpdate = Date.now();
    saveConfig();
    return appConfig;
});

// Update storage cache
ipcMain.handle('update-storage-cache', (event, storageInfo) => {
    appConfig.cache.lastStorageCalculation = storageInfo;
    appConfig.cache.lastStorageUpdate = Date.now();
    saveConfig();
    return appConfig;
});

// Update system info cache
ipcMain.handle('update-system-cache', (event, sysInfo) => {
    appConfig.cache.systemInfo = sysInfo;
    appConfig.cache.lastUpdate = Date.now();
    saveConfig();
    return appConfig;
}); 