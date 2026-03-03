import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
    // 窗口控制
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    // 聊天
    execute: (payload) => ipcRenderer.invoke('claude-execute', payload),
    stream: (payload) => ipcRenderer.invoke('claude-stream', payload),
    stopStream: () => ipcRenderer.invoke('claude-stream-stop'),
    clearHistory: (sessionId) => ipcRenderer.invoke('clear-history', sessionId),
    confirmTool: (confirmId, approved) => ipcRenderer.invoke('tool-confirm-response', confirmId, approved),
    // 文件夹选择
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    // Git
    getGitStatus: (cwd) => ipcRenderer.invoke('git-status', cwd),
    // 连接检测
    checkApiConnection: (config) => ipcRenderer.invoke('check-api-connection', config),
    // MCP 测试
    testMcpConnection: (config) => ipcRenderer.invoke('test-mcp-connection', config),
    // 对话导出
    exportChat: (data) => ipcRenderer.invoke('export-chat', data),
    // 安全存储（加密 API Key）
    secureStoreSet: (key, value) => ipcRenderer.invoke('secure-store-set', key, value),
    secureStoreGet: (key) => ipcRenderer.invoke('secure-store-get', key),
    secureStoreDelete: (key) => ipcRenderer.invoke('secure-store-delete', key),
    // 流式事件
    onStreamData: (callback) => {
        ipcRenderer.on('claude-stream-data', (_event, data) => callback(data));
    },
    onStreamError: (callback) => {
        ipcRenderer.on('claude-stream-error', (_event, error) => callback(error));
    },
    onStreamEnd: (callback) => {
        ipcRenderer.on('claude-stream-end', (_event, code) => callback(code));
    },
    removeStreamListeners: () => {
        ipcRenderer.removeAllListeners('claude-stream-data');
        ipcRenderer.removeAllListeners('claude-stream-error');
        ipcRenderer.removeAllListeners('claude-stream-end');
    },
});
