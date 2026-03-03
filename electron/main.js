import { app, BrowserWindow, ipcMain, dialog, safeStorage } from 'electron';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const userDataPath = path.join(app.getPath('appData'), 'claude-code-gui');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);
// GPU 加速可配置：默认禁用以解决 Windows GPU 缓存权限问题
// 用户可在 userData/gpu-config.json 中设置 { "disableGpu": false } 来启用
const GPU_CONFIG_PATH = path.join(userDataPath, 'gpu-config.json');
let disableGpu = true;
try {
    if (fs.existsSync(GPU_CONFIG_PATH)) {
        const gpuCfg = JSON.parse(fs.readFileSync(GPU_CONFIG_PATH, 'utf-8'));
        if (gpuCfg.disableGpu === false)
            disableGpu = false;
    }
}
catch { /* 使用默认值 */ }
if (disableGpu) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
}
// ── 默认值（仅作 fallback，实际由前端传入）────────────────
// claude-code-router 常见模型格式："provider,model"（你的环境里 dwf 可用）
const DEFAULT_MODEL = 'dwf,glm-5';
const MAX_TOOL_ROUNDS = 30;
// ── 危险命令判断 ────────────────────────────────────────
const SAFE_TOOLS = new Set(['read_file', 'list_dir', 'search_files']);
function isToolSafe(toolName, _input) {
    return SAFE_TOOLS.has(toolName);
}
// 等待前端确认
const pendingConfirmations = new Map();
function requestToolConfirmation(sender, confirmId, toolName, input) {
    return new Promise((resolve) => {
        pendingConfirmations.set(confirmId, { resolve });
        sender.send('claude-stream-data', JSON.stringify({
            type: 'tool_confirm',
            confirmId,
            toolName,
            input,
        }));
    });
}
// ── 全局状态 ────────────────────────────────────────────
let mainWindow = null;
const activeAbortControllers = new Map();
const conversationHistories = new Map();
const DEFAULT_API_CONFIG = {
    endpoint: 'http://127.0.0.1:3456',
    key: '',
    format: 'anthropic',
};
function parseEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        return {
            protocol: url.protocol,
            hostname: url.hostname,
            port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
            basePath: url.pathname.replace(/\/$/, ''),
        };
    }
    catch {
        return { protocol: 'http:', hostname: '127.0.0.1', port: 3456, basePath: '' };
    }
}
// ── 工具定义（Anthropic 格式）──────────────────────────
const TOOLS_ANTHROPIC = [
    {
        name: 'bash',
        description: '在工作目录执行 shell 命令。用于运行脚本、安装依赖、编译、测试、git 操作等。',
        input_schema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的 shell 命令' },
            },
            required: ['command'],
        },
    },
    {
        name: 'read_file',
        description: '读取指定文件的内容。路径相对于工作目录或绝对路径。',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' },
            },
            required: ['file_path'],
        },
    },
    {
        name: 'write_file',
        description: '将内容写入指定文件。会创建不存在的目录。路径相对于工作目录或绝对路径。',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' },
                content: { type: 'string', description: '要写入的完整文件内容' },
            },
            required: ['file_path', 'content'],
        },
    },
    {
        name: 'edit_file',
        description: '对文件进行精确的字符串替换。用 old_string 定位要替换的内容，用 new_string 替换它。',
        input_schema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' },
                old_string: { type: 'string', description: '要被替换的原始字符串（必须精确匹配）' },
                new_string: { type: 'string', description: '替换后的新字符串' },
            },
            required: ['file_path', 'old_string', 'new_string'],
        },
    },
    {
        name: 'list_dir',
        description: '列出目录内容，递归显示文件树。路径相对于工作目录或绝对路径。',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: '目录路径，默认为工作目录根' },
            },
            required: [],
        },
    },
    {
        name: 'search_files',
        description: '在工作目录中搜索包含指定模式的文件。返回匹配的文件名和行号。',
        input_schema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '搜索的正则表达式或字符串' },
                path: { type: 'string', description: '搜索的目录路径，默认为工作目录' },
            },
            required: ['pattern'],
        },
    },
];
// ── 工具定义（OpenAI 格式）──────────────────────────────
function convertToolsToOpenAI() {
    return TOOLS_ANTHROPIC.map((tool) => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
        },
    }));
}
// ── System prompt ───────────────────────────────────────
function buildSystemPrompt(cwd) {
    const osType = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const arch = process.arch;
    const shell = process.platform === 'win32' ? 'PowerShell / cmd' : 'bash / zsh';
    return `你是一个强大的编程助手，类似于 Claude Code。你在用户的项目目录中工作。

操作系统: ${osType} (${arch})
Shell: ${shell}
当前工作目录: ${cwd}

你可以使用以下工具来完成任务：
- bash: 执行 shell 命令（安装依赖、编译、运行测试、git 操作等）
- read_file: 读取文件内容
- write_file: 创建或覆盖文件
- edit_file: 精确替换文件中的字符串片段
- list_dir: 列出目录结构
- search_files: 在文件中搜索内容

重要规则：
1. 在修改文件之前，先用 read_file 读取它的当前内容
2. 优先使用 edit_file 进行精确修改，而不是用 write_file 覆盖整个文件
3. 所有相对路径都基于工作目录: ${cwd}
4. 执行命令前考虑安全性，不要执行危险的命令
5. 分步骤完成复杂任务，每步都向用户说明你在做什么
6. 如果遇到错误，分析原因并尝试修复
7. 使用与当前操作系统兼容的命令（当前为 ${osType}，请使用 ${shell} 语法）`;
}
// ── 工具执行 ────────────────────────────────────────────
function resolvePath(filePath, cwd) {
    const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(cwd, filePath);
    const normalizedCwd = path.resolve(cwd);
    // 校验解析后的路径在 cwd 范围内，防止路径遍历攻击
    if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
        throw new Error(`路径越界: ${filePath} 解析为 ${resolved}，不在工作目录 ${normalizedCwd} 内`);
    }
    return resolved;
}
async function executeTool(toolName, input, cwd, abortCtrl) {
    switch (toolName) {
        case 'bash': {
            return new Promise((resolve) => {
                const cmd = input.command || '';
                const child = spawn(cmd, [], {
                    shell: true,
                    cwd,
                    env: { ...process.env },
                    timeout: 60000,
                });
                let stdout = '';
                let stderr = '';
                let killed = false;
                // 监听中止信号，定时检查 abortCtrl
                const abortCheck = setInterval(() => {
                    if (abortCtrl?.aborted && !killed) {
                        killed = true;
                        child.kill('SIGTERM');
                        setTimeout(() => { if (!child.killed)
                            child.kill('SIGKILL'); }, 3000);
                        clearInterval(abortCheck);
                    }
                }, 200);
                child.stdout?.on('data', (d) => { stdout += d.toString(); });
                child.stderr?.on('data', (d) => { stderr += d.toString(); });
                child.on('close', (code) => {
                    clearInterval(abortCheck);
                    let result = '';
                    if (killed)
                        result += '[user aborted]\n';
                    if (stdout)
                        result += stdout;
                    if (stderr)
                        result += (result ? '\n' : '') + `[stderr] ${stderr}`;
                    result += `\n[exit code: ${code}]`;
                    if (result.length > 20000) {
                        result = result.slice(0, 20000) + '\n... (output truncated)';
                    }
                    resolve(result);
                });
                child.on('error', (err) => {
                    clearInterval(abortCheck);
                    resolve(`[error] ${err.message}`);
                });
            });
        }
        case 'read_file': {
            try {
                const fullPath = resolvePath(input.file_path || '', cwd);
                if (!fs.existsSync(fullPath)) {
                    return `[error] 文件不存在: ${fullPath}`;
                }
                const content = fs.readFileSync(fullPath, 'utf-8');
                if (content.length > 100000) {
                    return content.slice(0, 100000) + '\n... (file truncated, too large)';
                }
                return content;
            }
            catch (err) {
                return `[error] ${err.message}`;
            }
        }
        case 'write_file': {
            try {
                const fullPath = resolvePath(input.file_path || '', cwd);
                const dir = path.dirname(fullPath);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                fs.writeFileSync(fullPath, input.content || '', 'utf-8');
                return `文件已写入: ${fullPath}`;
            }
            catch (err) {
                return `[error] ${err.message}`;
            }
        }
        case 'edit_file': {
            try {
                const fullPath = resolvePath(input.file_path || '', cwd);
                if (!fs.existsSync(fullPath)) {
                    return `[error] 文件不存在: ${fullPath}`;
                }
                const content = fs.readFileSync(fullPath, 'utf-8');
                const oldStr = input.old_string || '';
                const newStr = input.new_string || '';
                if (!content.includes(oldStr)) {
                    return `[error] 在文件中找不到要替换的字符串。请检查 old_string 是否精确匹配。`;
                }
                // 检测匹配次数
                const matchCount = content.split(oldStr).length - 1;
                let updated;
                if (input.replace_all) {
                    // 替换所有匹配
                    updated = content.split(oldStr).join(newStr);
                    fs.writeFileSync(fullPath, updated, 'utf-8');
                    return `文件已修改: ${fullPath} (替换了 ${matchCount} 处)`;
                }
                else {
                    // 只替换第一个匹配，但提示多匹配情况
                    updated = content.replace(oldStr, newStr);
                    fs.writeFileSync(fullPath, updated, 'utf-8');
                    if (matchCount > 1) {
                        return `文件已修改: ${fullPath} (注意: 找到 ${matchCount} 处匹配，仅替换了第 1 处。如需全部替换，请设置 replace_all: true)`;
                    }
                    return `文件已修改: ${fullPath}`;
                }
            }
            catch (err) {
                return `[error] ${err.message}`;
            }
        }
        case 'list_dir': {
            try {
                const targetPath = resolvePath(input.path || '.', cwd);
                if (!fs.existsSync(targetPath)) {
                    return `[error] 目录不存在: ${targetPath}`;
                }
                const result = [];
                const walk = (dir, prefix, depth) => {
                    if (depth > 3 || result.length > 500)
                        return;
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    const filtered = entries.filter((e) => !['node_modules', '.git', 'dist', '__pycache__', '.next', '.nuxt', 'vendor', '.venv', 'venv'].includes(e.name));
                    for (const entry of filtered) {
                        if (result.length > 500) {
                            result.push('... (tree truncated)');
                            return;
                        }
                        const isDir = entry.isDirectory();
                        result.push(`${prefix}${isDir ? '📁 ' : '  '}${entry.name}`);
                        if (isDir) {
                            walk(path.join(dir, entry.name), prefix + '  ', depth + 1);
                        }
                    }
                };
                walk(targetPath, '', 0);
                return result.join('\n') || '(empty directory)';
            }
            catch (err) {
                return `[error] ${err.message}`;
            }
        }
        case 'search_files': {
            return new Promise((resolve) => {
                const searchPath = resolvePath(input.path || '.', cwd);
                const pattern = input.pattern || '';
                const isWin = process.platform === 'win32';
                const cmd = isWin
                    ? `findstr /s /n /r /c:"${pattern.replace(/"/g, '\\"')}" "${searchPath}\\*"`
                    : `grep -rn "${pattern.replace(/"/g, '\\"')}" "${searchPath}" --include="*" 2>/dev/null`;
                const child = spawn(cmd, [], { shell: true, cwd, timeout: 15000 });
                let output = '';
                child.stdout?.on('data', (d) => { output += d.toString(); });
                child.stderr?.on('data', (d) => { output += d.toString(); });
                child.on('close', () => {
                    if (!output.trim()) {
                        resolve('没有找到匹配的结果');
                    }
                    else if (output.length > 20000) {
                        resolve(output.slice(0, 20000) + '\n... (results truncated)');
                    }
                    else {
                        resolve(output);
                    }
                });
                child.on('error', (err) => {
                    resolve(`[error] ${err.message}`);
                });
            });
        }
        default:
            return `[error] 未知工具: ${toolName}`;
    }
}
// ── HTTP 请求辅助 ───────────────────────────────────────
function makeRequest(options, body) {
    return new Promise((resolve, reject) => {
        const reqModule = options.protocol === 'https:' ? https : http;
        const req = reqModule.request({
            hostname: options.hostname,
            port: options.port,
            path: options.path,
            method: options.method,
            headers: options.headers,
        }, (res) => resolve(res));
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
// ── Anthropic 格式流式调用 ──────────────────────────────
function callAnthropicStream(body, apiConfig, abortCtrl, onText, onToolUse, onUsage) {
    return new Promise((resolve, reject) => {
        const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint);
        const reqModule = protocol === 'https:' ? https : http;
        const bodyBuffer = Buffer.from(body, 'utf-8');
        const req = reqModule.request({
            hostname,
            port,
            path: `${basePath}/v1/messages`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodyBuffer.length,
                'Authorization': `Bearer ${apiConfig.key}`,
                'x-api-key': apiConfig.key || 'dummy',
                'anthropic-version': '2023-06-01',
            },
            timeout: 120000,
        }, (res) => {
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', (chunk) => { errBody += chunk.toString(); });
                res.on('end', () => reject(new Error(`API 错误 ${res.statusCode}: ${errBody}`)));
                return;
            }
            let sseBuffer = '';
            const contentBlocks = [];
            let currentToolUse = null;
            let stopReason = null;
            let totalInputTokens = 0;
            let totalOutputTokens = 0;
            res.on('data', (chunk) => {
                sseBuffer += chunk.toString();
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: '))
                        continue;
                    const data = line.slice(6).trim();
                    if (!data || data === '[DONE]')
                        continue;
                    try {
                        const evt = JSON.parse(data);
                        if (evt.type === 'message_start' && evt.message?.usage) {
                            totalInputTokens = evt.message.usage.input_tokens || 0;
                        }
                        else if (evt.type === 'content_block_start') {
                            if (evt.content_block?.type === 'tool_use') {
                                currentToolUse = {
                                    id: evt.content_block.id,
                                    name: evt.content_block.name,
                                    jsonBuf: '',
                                };
                            }
                        }
                        else if (evt.type === 'content_block_delta') {
                            if (evt.delta?.type === 'text_delta' && evt.delta?.text) {
                                onText(evt.delta.text);
                            }
                            else if (evt.delta?.type === 'input_json_delta' && evt.delta?.partial_json && currentToolUse) {
                                currentToolUse.jsonBuf += evt.delta.partial_json;
                            }
                        }
                        else if (evt.type === 'content_block_stop') {
                            if (currentToolUse) {
                                let parsedInput = {};
                                try {
                                    parsedInput = JSON.parse(currentToolUse.jsonBuf);
                                }
                                catch { /* empty */ }
                                const block = {
                                    type: 'tool_use',
                                    id: currentToolUse.id,
                                    name: currentToolUse.name,
                                    input: parsedInput,
                                };
                                contentBlocks.push(block);
                                onToolUse(currentToolUse.id, currentToolUse.name, parsedInput);
                                currentToolUse = null;
                            }
                        }
                        else if (evt.type === 'message_delta') {
                            if (evt.delta?.stop_reason) {
                                stopReason = evt.delta.stop_reason;
                            }
                            if (evt.usage?.output_tokens) {
                                totalOutputTokens = evt.usage.output_tokens;
                            }
                        }
                    }
                    catch {
                        // skip parse errors
                    }
                }
            });
            res.on('end', () => {
                if (totalInputTokens > 0 || totalOutputTokens > 0) {
                    onUsage(totalInputTokens, totalOutputTokens);
                }
                resolve({ stopReason, contentBlocks });
            });
            res.on('error', reject);
        });
        abortCtrl.destroy = () => { req.destroy(); };
        req.on('timeout', () => {
            req.destroy(new Error('API 请求超时 (120s 无数据)'));
        });
        req.on('error', reject);
        req.write(bodyBuffer);
        req.end();
    });
}
// ── OpenAI 格式流式调用 ─────────────────────────────────
function convertMessagesToOpenAI(messages, systemPrompt) {
    const result = [];
    // system message
    if (systemPrompt) {
        result.push({ role: 'system', content: systemPrompt });
    }
    for (const msg of messages) {
        if (msg.role === 'user') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'user', content: msg.content });
            }
            else {
                // 可能包含 tool_result
                const toolResults = msg.content
                    .filter((b) => b.type === 'tool_result');
                if (toolResults.length > 0) {
                    for (const tr of toolResults) {
                        result.push({
                            role: 'tool',
                            content: tr.content || '',
                            tool_call_id: tr.tool_use_id || '',
                        });
                    }
                }
                else {
                    // 纯文本 content blocks
                    const text = msg.content
                        .filter((b) => b.type === 'text')
                        .map((b) => b.text)
                        .join('');
                    result.push({ role: 'user', content: text });
                }
            }
        }
        else if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
                result.push({ role: 'assistant', content: msg.content });
            }
            else {
                const textParts = msg.content
                    .filter((b) => b.type === 'text')
                    .map((b) => b.text)
                    .join('');
                const toolCalls = msg.content
                    .filter((b) => b.type === 'tool_use')
                    .map((b) => ({
                    id: b.id,
                    type: 'function',
                    function: {
                        name: b.name,
                        arguments: JSON.stringify(b.input),
                    },
                }));
                const assistantMsg = { role: 'assistant' };
                if (textParts)
                    assistantMsg.content = textParts;
                if (toolCalls.length > 0)
                    assistantMsg.tool_calls = toolCalls;
                result.push(assistantMsg);
            }
        }
    }
    return result;
}
function callOpenAIStream(messages, systemPrompt, model, apiConfig, abortCtrl, onText, onToolUse, onUsage) {
    return new Promise((resolve, reject) => {
        const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint);
        const reqModule = protocol === 'https:' ? https : http;
        const openaiMessages = convertMessagesToOpenAI(messages, systemPrompt);
        const openaiTools = convertToolsToOpenAI();
        const body = JSON.stringify({
            model,
            max_tokens: 8192,
            stream: true,
            stream_options: { include_usage: true },
            messages: openaiMessages,
            tools: openaiTools,
        });
        const bodyBuffer = Buffer.from(body, 'utf-8');
        const req = reqModule.request({
            hostname,
            port,
            path: `${basePath}/v1/chat/completions`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodyBuffer.length,
                'Authorization': `Bearer ${apiConfig.key}`,
            },
            timeout: 120000,
        }, (res) => {
            if (res.statusCode !== 200) {
                let errBody = '';
                res.on('data', (chunk) => { errBody += chunk.toString(); });
                res.on('end', () => reject(new Error(`API 错误 ${res.statusCode}: ${errBody}`)));
                return;
            }
            let sseBuffer = '';
            const contentBlocks = [];
            // 跟踪 OpenAI 的工具调用（流式拼接）
            const toolCallBuffers = new Map();
            const finalizedToolIds = new Set();
            let stopReason = null;
            const finalizeToolBuffer = (buf) => {
                if (!buf.id || finalizedToolIds.has(buf.id))
                    return;
                finalizedToolIds.add(buf.id);
                let parsedInput = {};
                try {
                    parsedInput = JSON.parse(buf.argsBuf);
                }
                catch { /* empty */ }
                const block = {
                    type: 'tool_use',
                    id: buf.id,
                    name: buf.name,
                    input: parsedInput,
                };
                contentBlocks.push(block);
                onToolUse(buf.id, buf.name, parsedInput);
            };
            res.on('data', (chunk) => {
                sseBuffer += chunk.toString();
                const lines = sseBuffer.split('\n');
                sseBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: '))
                        continue;
                    const data = line.slice(6).trim();
                    if (!data || data === '[DONE]')
                        continue;
                    try {
                        const evt = JSON.parse(data);
                        // 处理 usage（OpenAI 在最后一个 chunk 中返回）
                        if (evt.usage) {
                            onUsage(evt.usage.prompt_tokens || 0, evt.usage.completion_tokens || 0);
                        }
                        const choice = evt.choices?.[0];
                        if (!choice)
                            continue;
                        const delta = choice.delta;
                        if (!delta)
                            continue;
                        // 文本内容
                        if (delta.content) {
                            onText(delta.content);
                        }
                        // 工具调用
                        if (delta.tool_calls) {
                            for (const tc of delta.tool_calls) {
                                const idx = tc.index ?? 0;
                                if (tc.id) {
                                    // 新的工具调用开始 — 先完成之前所有低索引的缓冲
                                    for (const [existingIdx, existingBuf] of toolCallBuffers) {
                                        if (existingIdx < idx) {
                                            finalizeToolBuffer(existingBuf);
                                        }
                                    }
                                    toolCallBuffers.set(idx, {
                                        id: tc.id,
                                        name: tc.function?.name || '',
                                        argsBuf: tc.function?.arguments || '',
                                    });
                                }
                                else {
                                    // 追加参数片段
                                    const buf = toolCallBuffers.get(idx);
                                    if (buf && tc.function?.arguments) {
                                        buf.argsBuf += tc.function.arguments;
                                    }
                                }
                            }
                        }
                        // 完成原因
                        if (choice.finish_reason) {
                            // 立即完成所有剩余的工具调用缓冲
                            for (const [, buf] of toolCallBuffers) {
                                finalizeToolBuffer(buf);
                            }
                            if (choice.finish_reason === 'tool_calls') {
                                stopReason = 'tool_use'; // 统一为 Anthropic 格式
                            }
                            else if (choice.finish_reason === 'stop') {
                                stopReason = 'end_turn';
                            }
                            else {
                                stopReason = choice.finish_reason;
                            }
                        }
                    }
                    catch {
                        // skip parse errors
                    }
                }
            });
            res.on('end', () => {
                // 安全网：完成所有未处理的工具调用
                for (const [, buf] of toolCallBuffers) {
                    finalizeToolBuffer(buf);
                }
                resolve({ stopReason, contentBlocks });
            });
            res.on('error', reject);
        });
        abortCtrl.destroy = () => { req.destroy(); };
        req.on('timeout', () => {
            req.destroy(new Error('API 请求超时 (120s 无数据)'));
        });
        req.on('error', reject);
        req.write(bodyBuffer);
        req.end();
    });
}
// ── 非流式 API 调用 ─────────────────────────────────────
function callAPI(body, apiConfig) {
    return new Promise((resolve, reject) => {
        const { hostname, port, basePath, protocol } = parseEndpoint(apiConfig.endpoint);
        const reqModule = protocol === 'https:' ? https : http;
        const bodyBuffer = Buffer.from(body, 'utf-8');
        const isOpenAI = apiConfig.format === 'openai';
        const reqPath = isOpenAI
            ? `${basePath}/v1/chat/completions`
            : `${basePath}/v1/messages`;
        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': String(bodyBuffer.length),
        };
        if (isOpenAI) {
            headers['Authorization'] = `Bearer ${apiConfig.key}`;
        }
        else {
            // 一些代理仅支持 Bearer，另一些仅支持 x-api-key；这里同时发提高兼容性
            headers['Authorization'] = `Bearer ${apiConfig.key}`;
            headers['x-api-key'] = apiConfig.key || 'dummy';
            headers['anthropic-version'] = '2023-06-01';
        }
        const req = reqModule.request({ hostname, port, path: reqPath, method: 'POST', headers }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk.toString(); });
            res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }));
        });
        req.on('error', reject);
        req.write(bodyBuffer);
        req.end();
    });
}
// ── 窗口状态持久化 ──────────────────────────────────────
const WINDOW_STATE_PATH = path.join(userDataPath, 'window-state.json');
function loadWindowState() {
    try {
        if (fs.existsSync(WINDOW_STATE_PATH)) {
            return JSON.parse(fs.readFileSync(WINDOW_STATE_PATH, 'utf-8'));
        }
    }
    catch { /* ignore */ }
    return { width: 1200, height: 800, isMaximized: false };
}
function saveWindowState(win) {
    try {
        const bounds = win.getBounds();
        const state = {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            isMaximized: win.isMaximized(),
        };
        fs.writeFileSync(WINDOW_STATE_PATH, JSON.stringify(state), 'utf-8');
    }
    catch { /* ignore */ }
}
// ── 窗口 ────────────────────────────────────────────────
function createWindow() {
    const savedState = loadWindowState();
    mainWindow = new BrowserWindow({
        x: savedState.x,
        y: savedState.y,
        width: savedState.width,
        height: savedState.height,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#1a1a2e',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (savedState.isMaximized) {
        mainWindow.maximize();
    }
    // 保存窗口状态
    mainWindow.on('close', () => {
        if (mainWindow)
            saveWindowState(mainWindow);
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}
app.whenReady().then(createWindow);
// ── 优雅退出：清理所有活跃资源 ────────────────────────
function cleanupAllResources() {
    // 中止所有活跃的流式连接
    for (const [id, ctrl] of activeAbortControllers) {
        ctrl.aborted = true;
        ctrl.destroy?.();
        activeAbortControllers.delete(id);
    }
    // 拒绝所有待确认的工具
    for (const [id, pending] of pendingConfirmations) {
        pending.resolve(false);
        pendingConfirmations.delete(id);
    }
    // 清空对话历史（内存释放）
    conversationHistories.clear();
}
app.on('before-quit', () => {
    cleanupAllResources();
});
app.on('window-all-closed', () => {
    cleanupAllResources();
    if (process.platform !== 'darwin')
        app.quit();
});
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
// ── 窗口控制 ────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized())
        mainWindow.unmaximize();
    else
        mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());
// ── 安全存储（API Key 加密）────────────────────────────
const SECURE_STORE_PATH = path.join(userDataPath, 'secure-keys.json');
ipcMain.handle('secure-store-set', async (_event, key, value) => {
    try {
        if (safeStorage.isEncryptionAvailable()) {
            const encrypted = safeStorage.encryptString(value);
            let store = {};
            try {
                if (fs.existsSync(SECURE_STORE_PATH)) {
                    store = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'));
                }
            }
            catch { /* ignore */ }
            store[key] = encrypted.toString('base64');
            fs.writeFileSync(SECURE_STORE_PATH, JSON.stringify(store), 'utf-8');
            return { success: true };
        }
        return { success: false, error: 'Encryption not available' };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
ipcMain.handle('secure-store-get', async (_event, key) => {
    try {
        if (safeStorage.isEncryptionAvailable() && fs.existsSync(SECURE_STORE_PATH)) {
            const store = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'));
            if (store[key]) {
                const decrypted = safeStorage.decryptString(Buffer.from(store[key], 'base64'));
                return { success: true, value: decrypted };
            }
        }
        return { success: true, value: '' };
    }
    catch (err) {
        return { success: false, value: '', error: err.message };
    }
});
ipcMain.handle('secure-store-delete', async (_event, key) => {
    try {
        if (fs.existsSync(SECURE_STORE_PATH)) {
            const store = JSON.parse(fs.readFileSync(SECURE_STORE_PATH, 'utf-8'));
            delete store[key];
            fs.writeFileSync(SECURE_STORE_PATH, JSON.stringify(store), 'utf-8');
        }
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// ── 选择文件夹 ──────────────────────────────────────────
ipcMain.handle('select-folder', async () => {
    if (!mainWindow)
        return { canceled: true, path: '' };
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: '选择项目工作目录',
    });
    if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, path: '' };
    }
    return { canceled: false, path: result.filePaths[0] };
});
// ── 停止当前请求 ────────────────────────────────────────
ipcMain.handle('claude-stream-stop', async (event) => {
    const ctrl = activeAbortControllers.get(event.sender.id);
    if (ctrl) {
        ctrl.aborted = true;
        ctrl.destroy?.();
    }
    // 拒绝所有待确认的工具
    for (const [id, pending] of Array.from(pendingConfirmations)) {
        pending.resolve(false);
        pendingConfirmations.delete(id);
    }
    return { success: true };
});
// ── 工具确认响应 ────────────────────────────────────────
ipcMain.handle('tool-confirm-response', async (_event, confirmId, approved) => {
    const pending = pendingConfirmations.get(confirmId);
    if (pending) {
        pending.resolve(approved);
        pendingConfirmations.delete(confirmId);
    }
    return { success: true };
});
// ── Git 状态 ────────────────────────────────────────────
ipcMain.handle('git-status', async (_event, cwd) => {
    return new Promise((resolve) => {
        const workdir = cwd?.trim() || undefined;
        const validCwd = workdir && fs.existsSync(workdir) && fs.statSync(workdir).isDirectory() ? workdir : undefined;
        const git = spawn('git', ['status', '--short', '--branch'], {
            shell: true,
            cwd: validCwd,
        });
        let output = '';
        let error = '';
        git.stdout.on('data', (d) => { output += d.toString(); });
        git.stderr.on('data', (d) => { error += d.toString(); });
        git.on('close', (code) => {
            if (code === 0)
                resolve({ success: true, output: output.trim() || '工作区干净' });
            else
                resolve({ success: false, output: (error || output || 'Git 状态读取失败').trim() });
        });
        git.on('error', (err) => resolve({ success: false, output: err.message }));
    });
});
// ── 连接检测 ────────────────────────────────────────────
ipcMain.handle('check-api-connection', async (_event, config) => {
    const startTime = Date.now();
    try {
        const { hostname, port, basePath, protocol } = parseEndpoint(config.endpoint);
        const reqModule = protocol === 'https:' ? https : http;
        return await new Promise((resolve) => {
            const req = reqModule.request({
                hostname,
                port,
                path: `${basePath}/v1/models`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${config.key}`,
                    'x-api-key': config.key || 'dummy',
                },
                timeout: 5000,
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk.toString(); });
                res.on('end', () => {
                    const latency = Date.now() - startTime;
                    // 任何 HTTP 响应都说明服务器在运行（包括 401/404 等）
                    resolve({ connected: true, latency });
                });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ connected: false, latency: Date.now() - startTime, error: '连接超时 (5s)' });
            });
            req.on('error', (err) => {
                resolve({ connected: false, latency: Date.now() - startTime, error: err.message });
            });
            req.end();
        });
    }
    catch (err) {
        return { connected: false, latency: Date.now() - startTime, error: err.message };
    }
});
// ── MCP 连接测试 ────────────────────────────────────────
ipcMain.handle('test-mcp-connection', async (_event, config) => {
    return new Promise((resolve) => {
        if (!config.command.trim()) {
            resolve({ connected: false, error: '命令不能为空' });
            return;
        }
        const argsArray = config.args.trim().split(/\s+/).filter(Boolean);
        const child = spawn(config.command, argsArray, {
            shell: true,
            timeout: 5000,
        });
        let gotOutput = false;
        child.stdout?.on('data', () => { gotOutput = true; });
        child.stderr?.on('data', () => { gotOutput = true; });
        child.on('error', (err) => {
            resolve({ connected: false, error: err.message });
        });
        // 等待 2 秒，如果进程还在运行说明连接成功
        setTimeout(() => {
            if (!child.killed) {
                child.kill();
                resolve({ connected: true });
            }
        }, 2000);
        child.on('close', (code) => {
            if (code === 0 || gotOutput) {
                resolve({ connected: true });
            }
            else {
                resolve({ connected: false, error: `进程退出码: ${code}` });
            }
        });
    });
});
// ── 对话导出 ────────────────────────────────────────────
ipcMain.handle('export-chat', async (_event, data) => {
    try {
        if (!mainWindow)
            return { success: false, error: '窗口不存在' };
        const result = await dialog.showSaveDialog(mainWindow, {
            title: '导出对话',
            defaultPath: `${data.title || 'chat'}-${new Date().toISOString().slice(0, 10)}.md`,
            filters: [
                { name: 'Markdown', extensions: ['md'] },
                { name: '所有文件', extensions: ['*'] },
            ],
        });
        if (result.canceled || !result.filePath) {
            return { success: false, error: '用户取消' };
        }
        // 构建 Markdown 内容
        let md = `# ${data.title || '对话记录'}\n\n`;
        md += `> 模型: ${data.model} | 导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
        md += `---\n\n`;
        for (const msg of data.messages) {
            const time = new Date(msg.timestamp).toLocaleString('zh-CN');
            if (msg.role === 'user') {
                md += `## 用户 <sub>${time}</sub>\n\n`;
                md += `${msg.content}\n\n`;
            }
            else {
                md += `## Claude <sub>${time}</sub>\n\n`;
                if (msg.blocks && msg.blocks.length > 0) {
                    for (const block of msg.blocks) {
                        if (block.type === 'text' && block.content) {
                            md += `${block.content}\n\n`;
                        }
                        else if (block.type === 'tool_call') {
                            md += `### 工具调用: ${block.toolName}\n\n`;
                            if (block.toolName === 'bash') {
                                md += `\`\`\`bash\n${block.input?.command || ''}\n\`\`\`\n\n`;
                            }
                            else {
                                md += `\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\`\n\n`;
                            }
                        }
                        else if (block.type === 'tool_result') {
                            md += `<details>\n<summary>输出 (${block.toolName})</summary>\n\n\`\`\`\n${block.output || ''}\n\`\`\`\n\n</details>\n\n`;
                        }
                        else if (block.type === 'round') {
                            md += `---\n*第 ${block.round} 轮思考*\n\n`;
                        }
                    }
                }
                else {
                    md += `${msg.content}\n\n`;
                }
            }
            md += `---\n\n`;
        }
        fs.writeFileSync(result.filePath, md, 'utf-8');
        return { success: true, path: result.filePath };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// ── 核心：Agentic 流式对话（支持工具调用循环）──────────
ipcMain.handle('claude-stream', async (event, payload) => {
    const abortCtrl = { aborted: false };
    activeAbortControllers.set(event.sender.id, abortCtrl);
    const prompt = (typeof payload === 'string' ? payload : payload.prompt) || '';
    const model = (typeof payload === 'string' ? DEFAULT_MODEL : payload.model) || DEFAULT_MODEL;
    const cwd = (typeof payload === 'string' ? '' : payload.cwd) || '';
    const sessionId = (typeof payload === 'string' ? 'default' : payload.sessionId) || 'default';
    const skipPermissions = (typeof payload === 'string' ? false : payload.skipPermissions) || false;
    // 解析 API 配置
    const apiConfig = {
        endpoint: (typeof payload === 'string' ? '' : payload.apiEndpoint) || DEFAULT_API_CONFIG.endpoint,
        key: (typeof payload === 'string' ? '' : payload.apiKey) ?? DEFAULT_API_CONFIG.key,
        format: (typeof payload === 'string' ? 'anthropic' : payload.apiFormat) || DEFAULT_API_CONFIG.format,
    };
    if (!cwd || !fs.existsSync(cwd)) {
        event.sender.send('claude-stream-error', '请先在设置中选择一个有效的工作目录');
        event.sender.send('claude-stream-end', 1);
        return { code: 1 };
    }
    // 维护多轮对话历史
    if (!conversationHistories.has(sessionId)) {
        conversationHistories.set(sessionId, []);
    }
    const history = conversationHistories.get(sessionId);
    history.push({ role: 'user', content: prompt });
    // ── 上下文窗口管理：估算 token 数，超限时截断早期消息 ──
    const MAX_CONTEXT_CHARS = 400000; // ~100k tokens (粗估 1 token ≈ 4 chars)
    const estimateChars = (msgs) => {
        let total = 0;
        for (const m of msgs) {
            if (typeof m.content === 'string') {
                total += m.content.length;
            }
            else {
                for (const b of m.content) {
                    if (b.type === 'text')
                        total += b.text.length;
                    else if (b.type === 'tool_use')
                        total += JSON.stringify(b.input).length + 100;
                    else if (b.type === 'tool_result')
                        total += b.content.length;
                }
            }
        }
        return total;
    };
    while (history.length > 2 && estimateChars(history) > MAX_CONTEXT_CHARS) {
        // 保留第一条 user 消息和最后几轮，从前面开始删除
        history.splice(1, 2); // 删除一对 user+assistant
        event.sender.send('claude-stream-data', JSON.stringify({
            type: 'text',
            content: '\n[系统: 对话历史过长，已自动截断早期消息以节省上下文空间]\n',
        }));
    }
    const systemPrompt = buildSystemPrompt(cwd);
    try {
        let round = 0;
        while (round < MAX_TOOL_ROUNDS) {
            if (abortCtrl.aborted) {
                event.sender.send('claude-stream-end', 0);
                break;
            }
            round++;
            const orderedBlocks = [];
            // 通知前端当前轮次
            if (round > 1) {
                event.sender.send('claude-stream-data', JSON.stringify({
                    type: 'round',
                    round,
                }));
            }
            // 按流式事件顺序追加文本/工具块（保持原始交错顺序）
            const appendText = (text) => {
                const last = orderedBlocks[orderedBlocks.length - 1];
                if (last && last.type === 'text') {
                    last.text += text;
                }
                else {
                    orderedBlocks.push({ type: 'text', text });
                }
                event.sender.send('claude-stream-data', JSON.stringify({ type: 'text', content: text }));
            };
            const appendToolUse = (id, name, input) => {
                orderedBlocks.push({ type: 'tool_use', id, name, input });
                event.sender.send('claude-stream-data', JSON.stringify({
                    type: 'tool_call',
                    toolId: id,
                    toolName: name,
                    input,
                }));
            };
            const reportUsage = (inputTokens, outputTokens) => {
                event.sender.send('claude-stream-data', JSON.stringify({
                    type: 'usage',
                    inputTokens,
                    outputTokens,
                }));
            };
            let streamResult = null;
            // 带重试的流式调用（最多重试 2 次，对 5xx / 网络错误 / 429）
            const MAX_RETRIES = 2;
            let lastError = null;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                if (abortCtrl.aborted)
                    break;
                if (attempt > 0) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
                    event.sender.send('claude-stream-data', JSON.stringify({
                        type: 'text',
                        content: `\n[系统: API 请求失败，${delay / 1000}s 后重试 (${attempt}/${MAX_RETRIES})...]\n`,
                    }));
                    await new Promise(r => setTimeout(r, delay));
                    if (abortCtrl.aborted)
                        break;
                    // 重试时清空本轮已收集的 blocks（避免重复）
                    orderedBlocks.length = 0;
                }
                try {
                    if (apiConfig.format === 'openai') {
                        streamResult = await callOpenAIStream(history, systemPrompt, model, apiConfig, abortCtrl, appendText, appendToolUse, reportUsage);
                    }
                    else {
                        const body = JSON.stringify({
                            model, max_tokens: 8192, stream: true,
                            system: systemPrompt, tools: TOOLS_ANTHROPIC, messages: history,
                        });
                        streamResult = await callAnthropicStream(body, apiConfig, abortCtrl, appendText, appendToolUse, reportUsage);
                    }
                    lastError = null;
                    break; // 成功，跳出重试循环
                }
                catch (err) {
                    lastError = err;
                    const msg = lastError.message || '';
                    // 仅对 5xx、429、网络错误重试
                    const isRetryable = /5\d{2}|429|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|超时/i.test(msg);
                    if (!isRetryable || attempt >= MAX_RETRIES) {
                        throw lastError;
                    }
                }
            }
            if (abortCtrl.aborted && !streamResult) {
                event.sender.send('claude-stream-end', 0);
                break;
            }
            if (!streamResult) {
                // 一般只会发生在中途被 abort（或极端情况下未能成功发起请求）
                if (lastError)
                    throw lastError;
                event.sender.send('claude-stream-end', 1);
                break;
            }
            const { stopReason } = streamResult;
            // 合入 stream 中发现的额外 blocks（安全网）
            for (const block of streamResult.contentBlocks) {
                if (block.type === 'tool_use' && !orderedBlocks.find((b) => b.type === 'tool_use' && b.id === block.id)) {
                    orderedBlocks.push(block);
                }
            }
            // 按原始顺序构建 assistant 消息
            if (orderedBlocks.length > 0) {
                history.push({ role: 'assistant', content: orderedBlocks });
            }
            // 提取工具调用
            const allToolUses = orderedBlocks.filter((b) => b.type === 'tool_use');
            // 如果没有工具调用，完成
            if (stopReason !== 'tool_use' || allToolUses.length === 0) {
                break;
            }
            // 执行所有工具调用并回传结果
            if (abortCtrl.aborted)
                break;
            const toolResults = [];
            for (const tu of allToolUses) {
                if (abortCtrl.aborted)
                    break;
                // 非只读工具需要用户确认（除非 skipPermissions）
                let approved = true;
                if (!isToolSafe(tu.name, tu.input) && !skipPermissions) {
                    const confirmId = `confirm-${Date.now()}-${tu.id}`;
                    approved = await requestToolConfirmation(event.sender, confirmId, tu.name, tu.input);
                }
                if (!approved) {
                    event.sender.send('claude-stream-data', JSON.stringify({
                        type: 'tool_result',
                        toolId: tu.id,
                        toolName: tu.name,
                        output: '[用户拒绝执行此操作]',
                        isError: true,
                    }));
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: tu.id,
                        content: '[error] 用户拒绝执行此操作',
                    });
                    continue;
                }
                const result = await executeTool(tu.name, tu.input, cwd, abortCtrl);
                const shortResult = result.length > 2000
                    ? result.slice(0, 2000) + '\n... (output truncated in display)'
                    : result;
                event.sender.send('claude-stream-data', JSON.stringify({
                    type: 'tool_result',
                    toolId: tu.id,
                    toolName: tu.name,
                    output: shortResult,
                    isError: result.startsWith('[error]'),
                }));
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tu.id,
                    content: result,
                });
            }
            // 把工具结果作为 user 消息加入历史
            history.push({ role: 'user', content: toolResults });
        }
        activeAbortControllers.delete(event.sender.id);
        event.sender.send('claude-stream-end', 0);
        return { code: 0 };
    }
    catch (err) {
        activeAbortControllers.delete(event.sender.id);
        event.sender.send('claude-stream-error', err.message);
        event.sender.send('claude-stream-end', 1);
        return { code: 1 };
    }
});
// ── 非流式执行（保留兼容，现已接入对话历史）──────────────
ipcMain.handle('claude-execute', async (_event, payload) => {
    const prompt = (typeof payload === 'string' ? payload : payload.prompt) || '';
    const model = (typeof payload === 'string' ? DEFAULT_MODEL : payload.model) || DEFAULT_MODEL;
    const sessionId = (typeof payload === 'string' ? 'execute-default' : payload.sessionId) || 'execute-default';
    const cwd = (typeof payload === 'string' ? '' : payload.cwd) || '';
    const apiConfig = {
        endpoint: (typeof payload === 'string' ? '' : payload.apiEndpoint) || DEFAULT_API_CONFIG.endpoint,
        key: (typeof payload === 'string' ? '' : payload.apiKey) ?? DEFAULT_API_CONFIG.key,
        format: (typeof payload === 'string' ? 'anthropic' : payload.apiFormat) || DEFAULT_API_CONFIG.format,
    };
    // 维护对话历史
    if (!conversationHistories.has(sessionId)) {
        conversationHistories.set(sessionId, []);
    }
    const history = conversationHistories.get(sessionId);
    history.push({ role: 'user', content: prompt });
    const systemPrompt = cwd ? buildSystemPrompt(cwd) : '';
    try {
        let messages;
        if (apiConfig.format === 'openai') {
            messages = convertMessagesToOpenAI(history, systemPrompt);
        }
        else {
            messages = history;
        }
        const bodyObj = {
            model,
            max_tokens: 8192,
            messages,
        };
        if (apiConfig.format !== 'openai' && systemPrompt) {
            bodyObj.system = systemPrompt;
        }
        const body = JSON.stringify(bodyObj);
        const res = await callAPI(body, apiConfig);
        // 检查 HTTP 状态码
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return { success: false, output: `API 错误 (HTTP ${res.statusCode}): ${res.data.slice(0, 500)}` };
        }
        const result = JSON.parse(res.data);
        // 适配 OpenAI 和 Anthropic 格式
        let text = '';
        if (apiConfig.format === 'openai') {
            text = result.choices?.[0]?.message?.content || '';
        }
        else {
            text = result.content?.[0]?.text || '';
        }
        // 将助手回复加入历史
        history.push({ role: 'assistant', content: text });
        return { success: true, output: text };
    }
    catch (err) {
        return { success: false, output: `错误: ${err.message}` };
    }
});
// ── 清除会话历史 ────────────────────────────────────────
ipcMain.handle('clear-history', async (_event, sessionId) => {
    if (sessionId)
        conversationHistories.delete(sessionId);
    else
        conversationHistories.clear();
    return { success: true };
});
